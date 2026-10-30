// Exercise the real unified DO validator without connecting to a database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const source = fs.readFileSync('supabase/functions/api/_core/procurement/do_unified.handlers.ts', 'utf8');
const start = source.indexOf('async function prepareAndValidateDoLines(');
const end = source.indexOf('async function freezeDoSalesShipTo', start);
const code = transformSync(source.slice(start,end), { loader:'ts', format:'cjs' }).code;
let stock = 10000;
let sender = 'sender';
const stoLine = {id:'line',sto_id:'sto',material_id:'material',quantity:3000,balance_qty:3000,uom_code:'KG',transfer_price:72.2,gst_rate:18};
const depotLine = {id:'depot-line',so_id:'depot-so',material_id:'depot-material',quantity:75000,base_qty:75000,uom_code:'KG',rate:10,gst_rate:18};
const depotSo = {id:'depot-so',company_id:'sender',bill_to_type:'DEPOT'};
const depotAllocation = {id:'legacy-depot-allocation',so_id:'depot-so',so_line_id:'depot-line',allocated_qty:28000};
let cancelledDepotDrawn = new Map();
const tableRows = (table) => table==='stock_transfer_order_line' ? [stoLine]
  : table==='stock_transfer_order' ? [{id:'sto',sending_company_id:sender}]
  : table==='sales_order_line' ? [depotLine]
  : table==='sales_order' ? [depotSo]
  : table==='sales_order_map_allocation' ? [depotAllocation]
  : [];
const context = vm.createContext({
  QTY_TOL:0.000001, toTrimmedString:v=>String(v??'').trim(), toUpperTrimmedString:v=>String(v??'').trim().toUpperCase(),
  parsePositiveNumber:v=>Number(v)>0?Number(v):null,
  serviceRoleClient:{schema:()=>({from:table=>({select:()=>({in:()=>Promise.resolve({data:tableRows(table),error:null})})})})},
  fetchInChunks:async(ids,fn)=>(await fn(ids)).data,
  computeDrawnQtyByColumn:async(column,_ids,_excludeDcId,includeCancelled)=>column==='so_line_id'&&includeCancelled?cancelledDepotDrawn:new Map(), computeReservedQtyByPackingOrder:async()=>new Map(), computeDrawnQtyByFoPackingOrder:async()=>new Map(), computeProducedFgQtyByPackingOrder:async()=>new Map(),
  getAvailableQty:async()=>stock,
});
vm.runInContext(code,context);
const run = (rows) => context.prepareAndValidateDoLines('sender',rows);
const input = quantity=>({sto_line_id:'line',storage_location_id:'location',quantity});
const depotInput = quantity=>({so_line_id:'depot-line',storage_location_id:'location',quantity});
const legacyDepotInput = quantity=>({so_map_allocation_id:'legacy-depot-allocation',storage_location_id:'location',quantity});
(async()=>{
  const {prepared} = await run([input(3000)]);
  assert.equal(prepared[0].unitValue,72.2);
  assert.equal(prepared[0].unitValue*prepared[0].quantity,216600);
  assert.equal(prepared[0].gstRate,0);
  assert.equal(prepared[0].gstAmount,0);
  assert.equal(prepared[0].displayRateBasis,'BASE_UOM');
  await assert.rejects(run([input(2000),input(1500)]),/DO_QTY_EXCEEDS_BALANCE/);
  stock=2500;
  await assert.rejects(run([input(1500),input(1500)]),/INSUFFICIENT_STOCK/);
  stock=10000; sender='receiver';
  await assert.rejects(run([input(1000)]),/DO_SOURCE_COMPANY_MISMATCH/);
  sender='sender'; stock=100000; cancelledDepotDrawn=new Map([['depot-line',28000]]);
  const {prepared: depotPrepared}=await run([depotInput(47000)]);
  assert.equal(depotPrepared[0].soMapAllocationId,null);
  assert.equal(depotPrepared[0].soLineId,'depot-line');
  await assert.rejects(run([depotInput(47001)]),/DO_QTY_EXCEEDS_BALANCE/);
  const {prepared: legacyDepotPrepared}=await run([legacyDepotInput(47000)]);
  assert.equal(legacyDepotPrepared[0].soMapAllocationId,null);
  assert.equal(legacyDepotPrepared[0].soLineId,'depot-line');
  console.log('PASS: STO commercial values/split limits/scope; Depot ignores legacy maps and permanently deducts cancelled DO qty');
})().catch(error=>{console.error(error);process.exitCode=1;});
