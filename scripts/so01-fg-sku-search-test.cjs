const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const source = fs.readFileSync('supabase/functions/api/_core/procurement/sales_order.handlers.ts', 'utf8');
const start = source.indexOf('async function readFgSkuRows(');
const end = source.indexOf('// §133.21', source.indexOf('FG SKU options could not be resolved.', start));
const code = transformSync(source.slice(start, end).replace('export async function', 'async function'), {loader:'ts'}).code;
let rows, failTable;
const calls = [];
class Query {
  constructor(table) { this.table=table; this.filters=[]; this.orders=[]; this.from=0; this.to=999; }
  select(value) { this.columns=value; return this; }
  eq(k,v) { this.filters.push([k,v,'eq']); return this; }
  is(k,v) { this.filters.push([k,v,'is']); return this; }
  in(k,v) { this.filters.push([k,v,'in']); return this; }
  order(k) { this.orders.push(k); return this; }
  range(a,b) { this.from=a; this.to=b; return this; }
  or(value) { this.orValue=value; return this; }
  then(resolve,reject) {
    calls.push({table:this.table,columns:this.columns,from:this.from,to:this.to});
    if (failTable===this.table) return Promise.resolve({data:null,error:{message:'test error'}}).then(resolve,reject);
    let result=[...(rows[this.table]??[])];
    const getFilter=k=>this.filters.find(([key])=>key===k)?.[1];
    if(this.columns.includes('mappings:')) {
      result=result.filter(r=>rows.material_company_ext.some(m=>m.material_id===r.id && m.status==='ACTIVE' && (!getFilter('mappings.company_id') || m.company_id===getFilter('mappings.company_id'))));
      if(this.filters.some(([k])=>k==='own')) result=result.filter(r=>!rows.material_company_ext.some(m=>m.material_id===r.id && m.status==='ACTIVE' && m.company_id===getFilter('own.company_id')));
    }
    for(const [k,v,op] of this.filters) {
      if(k.includes('.') || k==='own') continue;
      result=result.filter(r=>op==='in'?v.includes(r[k]):r[k]===v);
    }
    if(this.orValue) {
      const predicates=[...this.orValue.matchAll(/(\w+)\.ilike\.("(?:\\.|[^"\\])*")/g)].map(m=>{
        let pattern=JSON.parse(m[2]);
        const contains=pattern.startsWith('%') && pattern.endsWith('%');
        if(contains) pattern=pattern.slice(1,-1);
        pattern=pattern.replace(/\\(.)/g,'$1').toUpperCase();
        return r=>contains?String(r[m[1]]??'').toUpperCase().includes(pattern):String(r[m[1]]??'').toUpperCase()===pattern;
      });
      assert(predicates.length,'search must parse as quoted literal');
      result=result.filter(r=>predicates.some(p=>p(r)));
    }
    result.sort((a,b)=>{for(const k of this.orders){const d=String(a[k]).localeCompare(String(b[k]));if(d)return d;}return 0;});
    return Promise.resolve({data:result.slice(this.from,Math.min(this.to+1,this.from+1000)),error:null}).then(resolve,reject);
  }
}
const context=vm.createContext({Request, URL, FG_TYPES:new Set(['MTO','HPS','MTS','MTEST']),
  toTrimmedString:v=>String(v??'').trim(), toUpperTrimmedString:v=>String(v??'').trim().toUpperCase(),
  assertProcurementReadRole:()=>{}, getCompanyScope:async(ctx,id)=>{if(id!=='cmp6'&&id!=='cmp2')throw Error('FORBIDDEN');return id;},
  serviceRoleClient:{schema:()=>({from:t=>new Query(t)})},
  okResponse:data=>({ok:true,...data}), salesErrorResponse:(req,ctx,code,status)=>({ok:false,code,status}),
});
vm.runInContext(code,context);
const run=async(params={})=>context.listSalesOrderFgSkuOptionsHandler(new Request('https://test/sku?'+new URLSearchParams({company_id:'cmp6',fg_type:'MTO',...params})),{request_id:'test'});
function fixture(){
  rows={material_company_ext:Array.from({length:1100},(_,i)=>({material_id:'unrelated'+i,company_id:'cmp6',status:'ACTIVE'})),
    material_master:[{id:'sku',pace_code:'FG-00379',external_code:'6765SS06599',material_name:'Example',status:'ACTIVE',material_type:'FG',pack_code:'599'},
      {id:'shade',external_code:'6765SS06',material_type:'SFG'}],
    pack_code_master:[{id:'pack',pack_code:'599',pack_type:'BARREL',outer_uom_code:'BBL',active:true}],
    prodshade_pack_config:[{id:'cfg',material_id:'shade',pack_code_id:'pack',variant:null,active:true,pack_code:{pack_code:'599'}}],
    stroke_master:Array.from({length:1100},(_,i)=>({id:'stroke'+String(i).padStart(4,'0'),prodshade_material_id:'shade',company_id:'cmp6',status:'APPROVED',po_type:'MTEST'})),
    stroke_po_type_applicability:[{stroke_master_id:'stroke1099',target_po_type:'MTO',is_active:true}],
    material_uom_conversion:[{id:'conv',material_id:'sku',from_uom_code:'BBL',to_uom_code:'KG',conversion_factor:220,variable_conversion:true,active:true}]};
  rows.material_company_ext.push({material_id:'sku',company_id:'cmp6',status:'ACTIVE'});
}
(async()=>{
  fixture();
  let r=await run({q:'6765SS06599'});
  assert(r.ok,JSON.stringify(r)); assert.equal(r.data[0].id,'sku'); assert.equal(r.data[0].per_pack_qty,220); assert.equal(r.data[0].variable_conversion,true);
  assert.equal(r.data[0].prodshade_material_id,'shade'); assert.equal(r.data[0].own_company_mapping,true);
  assert(calls.some(c=>c.table==='stroke_master' && c.from>=1000),'related lookup must exceed row cap');
  const callsBeforeShortSearch=calls.length;
  assert.equal((await run()).data.length,0,'opening the picker must not read the full FG master');
  assert.equal((await run({q:'67'})).data.length,0,'short searches must not read the full FG master');
  assert.equal(calls.length,callsBeforeShortSearch,'short searches must perform no material or eligibility lookup');
  assert.equal((await run({fg_type:'HPS',q:'676'})).data.length,0);
  rows.stroke_po_type_applicability.push({stroke_master_id:'stroke1099',target_po_type:'HPS',is_active:true},{stroke_master_id:'stroke1099',target_po_type:'MTS',is_active:true});
  assert.equal((await run({fg_type:'HPS',q:'676'})).data.length,1); assert.equal((await run({fg_type:'MTS',q:'676'})).data.length,1);
  assert.equal((await run({company_id:'cmp2',q:'676'})).data.length,0);
  assert.equal((await run({q:'%_*,()"'})).data.length,0);
  assert.equal((await run({cursor:'own:-1'})).status,400); assert.equal((await run({fg_type:'INVALID'})).status,400);
  assert.equal((await run({company_id:'forbidden'})).ok,false);
  failTable='prodshade_pack_config'; assert.equal((await run({q:'676'})).ok,false); failTable=null;
  rows.pack_code_master[0].pack_type='MTEST';
  assert.equal((await run({fg_type:'MTEST',company_id:'cmp2',cursor:'other:0',q:'676'})).data.length,1);
  assert.equal((await run({fg_type:'MTO',q:'676'})).data.length,0);
  fixture(); rows.material_company_ext.push({material_id:'sku',company_id:'cmp2',status:'ACTIVE'});
  assert.equal((await run({cursor:'other:0',q:'676'})).data.length,0,'own mapping must not recur in other phase');
  rows.material_company_ext=rows.material_company_ext.filter(m=>m.material_id!=='sku'||m.company_id!=='cmp6');
  assert.equal((await run({cursor:'other:0',q:'676'})).data.length,1,'cross-company eligibility preserved');
  fixture(); rows.material_master[0].external_code+='V2'; rows.prodshade_pack_config[0].variant='V2';
  assert.equal((await run({q:'6765SS06599V2'})).data.length,1,'variant configuration');
  fixture();
  for(let i=0;i<1100;i++){
    rows.material_master.push({...rows.material_master[0],id:'bulk'+i,pace_code:'AA'+String(i).padStart(4,'0')});
    rows.material_company_ext.push({material_id:'bulk'+i,company_id:'cmp6',status:'ACTIVE'});
  }
  let cursor='own:0'; const seen=new Set(); let pages=0;
  do { r=await run({cursor,q:'Example'}); assert(r.ok,JSON.stringify(r)); for(const sku of r.data){assert(!seen.has(sku.id));seen.add(sku.id);}cursor=r.next_cursor;pages++;assert(pages<40); } while(cursor);
  assert.equal(seen.size,1101); assert(seen.has('sku'));
  assert.equal((await run({q:'does-not-exist'})).data.length,0);
  console.log('PASS: minimum-search guard, >1000 mappings/SKUs/strokes, search, variants, conversions, shared types, company isolation, cursor completeness, errors');
})().catch(e=>{console.error(e);process.exitCode=1;});

