import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpSelectionSection from "../../../components/forms/ErpSelectionSection.jsx";
import {
  formatCompanyAddress,
  formatCompanyLabel,
} from "../../../shared/companyDisplay.js";

const ACTIONS = [["VIEW","can_view","View"],["WRITE","can_write","Write"],["EDIT","can_edit","Edit"],["DELETE","can_delete","Delete"],["APPROVE","can_approve","Approve"],["EXPORT","can_export","Export"]];

async function readJsonSafe(r){try{return await r.clone().json();}catch{return null;}}
async function fetchApi(path,options){
  const r=await fetch(`${import.meta.env.VITE_API_BASE}${path}`,{credentials:"include",...options});
  const j=await readJsonSafe(r);
  if(!r.ok||!j?.ok){
    const code=j?.code??"REQUEST_FAILED";
    const req=j?.request_id?` | Req ${j.request_id}`:"";
    const trace=j?.decision_trace?` | ${j.decision_trace}`:"";
    const publicMessage=typeof j?.message==="string"&&j.message.trim().length>0?` | ${j.message.trim()}`:"";
    const error=new Error(`${code}${trace}${publicMessage}${req}`);
    error.code=code;
    error.requestId=j?.request_id??null;
    error.decisionTrace=j?.decision_trace??null;
    throw error;
  }
  return j.data??{};
}
const newCap=()=>({capability_code:"",capability_name:"",description:""});
const newDraft=(cap="",res="")=>({capability_code:cap,resource_code:res,can_view:false,can_write:false,can_edit:false,can_delete:false,can_approve:false,can_export:false,denied_actions:[]});
const rowDraft=(cap,row)=>({...newDraft(cap,row.resource_code),...row,denied_actions:Array.isArray(row.denied_actions)?row.denied_actions:[]});
const hasRule=(d)=>ACTIONS.some(([,k])=>Boolean(d[k]))||d.denied_actions.length>0;
const normalize=(value)=>String(value??"").trim().toLowerCase();

function classifyContext(row){
  if (row.department_code) return "DEPARTMENT";
  if (row.work_context_code === "GENERAL_OPS") return "GENERAL";
  return "MANUAL";
}

function recommendedCapabilityCodes(row){
  const code=String(row?.work_context_code??"").toUpperCase();
  if (code === "GENERAL_OPS") return ["CAP_HR_SELF_SERVICE"];
  if (code === "HR_APPROVER") return ["CAP_HR_APPROVER"];
  if (code === "HR_AUDIT") return ["CAP_HR_AUDIT_VIEW"];
  if (code === "HR_DIRECTOR") return ["CAP_HR_DIRECTOR"];
  return [];
}

export default function SACapabilityGovernance(){
  const navigate=useNavigate();
  const topRefs=useRef([]), searchRef=useRef(null), bindingSearchRef=useRef(null);
  const [companies,setCompanies]=useState([]),[caps,setCaps]=useState([]),[catalog,setCatalog]=useState([]),[contexts,setContexts]=useState([]),[capRows,setCapRows]=useState([]),[ctxCaps,setCtxCaps]=useState([]),[contextCapabilityMap,setContextCapabilityMap]=useState({});
  const [companyId,setCompanyId]=useState(""),[capCode,setCapCode]=useState(""),[ctxId,setCtxId]=useState(""),[projectCode,setProjectCode]=useState(""),[moduleCode,setModuleCode]=useState(""),[selectedResourceCode,setSelectedResourceCode]=useState("");
  const [search,setSearch]=useState(""),[drafts,setDrafts]=useState({}),[capDraft,setCapDraft]=useState(newCap()),[contextSearch,setContextSearch]=useState(""),[bindingSearch,setBindingSearch]=useState(""),[bindingDrawerOpen,setBindingDrawerOpen]=useState(false);
  const [loading,setLoading]=useState(true),[catalogLoading,setCatalogLoading]=useState(true),[saving,setSaving]=useState(false),[bindingLoading,setBindingLoading]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");

  async function loadBootstrap(){
    setLoading(true); setError("");
    try{
      const [companyData,capData]=await Promise.all([fetchApi("/api/admin/companies"),fetchApi("/api/admin/acl/capabilities")]);
      const nextCompanies=companyData.companies??[], nextCaps=capData.capabilities??[];
      setCompanies(nextCompanies); setCaps(nextCaps);
      if(!companyId) setCompanyId(nextCompanies[0]?.id??"");
      if(!capCode) setCapCode(nextCaps[0]?.capability_code??"");
    }catch(err){console.error("CAPABILITY_BOOTSTRAP_LOAD_FAILED",{message:err?.message??"REQUEST_FAILED",code:err?.code??null,requestId:err?.requestId??null,decisionTrace:err?.decisionTrace??null});setError(`Capability governance bootstrap could not be loaded. ${err.message??"REQUEST_FAILED"}`);}finally{setLoading(false);}
  }
  async function loadCatalog(){
    setCatalogLoading(true);
    try{const data=await fetchApi("/api/admin/approval/resource-policy"); setCatalog(data.resources??[]);}
    catch(err){console.error("CAPABILITY_CATALOG_LOAD_FAILED",{message:err?.message??"REQUEST_FAILED",code:err?.code??null,requestId:err?.requestId??null,decisionTrace:err?.decisionTrace??null});setCatalog([]); setError(`Capability resource catalog could not be loaded. ${err.message??"REQUEST_FAILED"}`);}
    finally{setCatalogLoading(false);}
  }
  async function loadCapRows(code=capCode){
    if(!code){setCapRows([]);return;}
    try{const data=await fetchApi(`/api/admin/acl/capability-actions?capability_code=${encodeURIComponent(code)}`); setCapRows(data.permissions??[]);}
    catch(err){console.error("CAPABILITY_ROWS_LOAD_FAILED",{capability_code:code||null,message:err?.message??"REQUEST_FAILED",code:err?.code??null,requestId:err?.requestId??null,decisionTrace:err?.decisionTrace??null});setCapRows([]); setError(`Capability action rows could not be loaded. ${err.message??"REQUEST_FAILED"}`);}
  }
  async function loadCompanyState(id=companyId){
    setBindingDrawerOpen(false);
    if(!id){setContexts([]); setCtxCaps([]); return;}
    try{
      const w=await fetchApi(`/api/admin/acl/work-contexts?company_id=${encodeURIComponent(id)}`);
      const next=w.work_contexts??[]; setContexts(next);
      setCtxId((cur)=>next.some((r)=>r.work_context_id===cur)?cur:next[0]?.work_context_id??"");
    }catch(err){console.error("COMPANY_CAPABILITY_STATE_LOAD_FAILED",{company_id:id||null,message:err?.message??"REQUEST_FAILED",code:err?.code??null,requestId:err?.requestId??null,decisionTrace:err?.decisionTrace??null});setContexts([]);setError(`Company capability state could not be loaded. ${err.message??"REQUEST_FAILED"}`);}
  }
  async function loadCtxCaps(id=ctxId){
    if(!id){setCtxCaps([]);return;}
    try{const d=await fetchApi(`/api/admin/acl/work-context-capabilities?work_context_id=${encodeURIComponent(id)}`); setCtxCaps(d.capabilities??[]);}
    catch(err){console.error("WORK_CONTEXT_CAPABILITIES_LOAD_FAILED",{work_context_id:id||null,message:err?.message??"REQUEST_FAILED",code:err?.code??null,requestId:err?.requestId??null,decisionTrace:err?.decisionTrace??null});setCtxCaps([]); setError(`Work-context capability bindings could not be loaded. ${err.message??"REQUEST_FAILED"}`);}
  }
  async function loadContextCapabilityMap(nextContexts=contexts){
    if(nextContexts.length===0){setContextCapabilityMap({}); return;}
    setBindingLoading(true);
    try{
      const settled=await Promise.allSettled(
        nextContexts.map(async (row)=>{
          const data=await fetchApi(`/api/admin/acl/work-context-capabilities?work_context_id=${encodeURIComponent(row.work_context_id)}`);
          return [row.work_context_id,(data.capabilities??[]).map((cap)=>cap.capability_code)];
        }),
      );
      const nextMap={};
      for(const result of settled){
        if(result.status==="fulfilled"){
          const [workContextId,attachedCodes]=result.value;
          nextMap[workContextId]=attachedCodes;
        }
      }
      setContextCapabilityMap(nextMap);
    }catch(err){
      console.error("CONTEXT_CAPABILITY_MAP_LOAD_FAILED",{message:err?.message??"REQUEST_FAILED",code:err?.code??null,requestId:err?.requestId??null,decisionTrace:err?.decisionTrace??null});
      setContextCapabilityMap({});
      setError(`Capability-to-context status could not be loaded. ${err.message??"REQUEST_FAILED"}`);
    }finally{
      setBindingLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void loadBootstrap(); void loadCatalog();},[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void loadCapRows(capCode);},[capCode]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void loadCompanyState(companyId);},[companyId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void loadCtxCaps(ctxId);},[ctxId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void loadContextCapabilityMap(contexts);},[contexts]);

  const capMap=useMemo(()=>new Map(capRows.map((r)=>[r.resource_code,r])),[capRows]);
  const projectOptions=useMemo(()=>[...new Set(catalog.map((r)=>r.project_code).filter(Boolean))].sort(),[catalog]);
  const moduleOptions=useMemo(()=>[...new Set(catalog.filter((r)=>!projectCode||r.project_code===projectCode).map((r)=>r.module_code).filter(Boolean))].sort(),[catalog,projectCode]);
  useEffect(()=>{if(moduleCode&&!moduleOptions.includes(moduleCode)) setModuleCode("");},[moduleOptions,moduleCode]);
  const filteredCatalog=useMemo(()=>{
    const needle=String(search??"").trim().toLowerCase();
    return catalog.filter((r)=>{
      if(projectCode&&r.project_code!==projectCode) return false;
      if(moduleCode&&r.module_code!==moduleCode) return false;
      if(!needle) return true;
      return [r.title,r.resource_code,r.route_path,r.project_code,r.module_code,r.module_name].filter(Boolean).some((v)=>String(v).toLowerCase().includes(needle));
    });
  },[catalog,search,projectCode,moduleCode]);
  const rows=useMemo(()=>filteredCatalog.map((resource)=>({resource,savedRow:capMap.get(resource.resource_code)??null,draft:drafts[resource.resource_code]??(capMap.has(resource.resource_code)?rowDraft(capCode,capMap.get(resource.resource_code)):newDraft(capCode,resource.resource_code))})),[filteredCatalog,drafts,capMap,capCode]);
  const { getRowProps } = useErpListNavigation(rows, {
    onActivate: (row) => setSelectedResourceCode(row?.resource?.resource_code ?? ""),
  });
  useEffect(()=>{
    if(!rows.length){setSelectedResourceCode(""); return;}
    if(!selectedResourceCode||!rows.some((r)=>r.resource.resource_code===selectedResourceCode)) setSelectedResourceCode(rows[0].resource.resource_code);
  },[rows,selectedResourceCode]);
  const selectedRow=useMemo(()=>rows.find((r)=>r.resource.resource_code===selectedResourceCode)??null,[rows,selectedResourceCode]);
  const selectedContext=useMemo(()=>contexts.find((row)=>row.work_context_id===ctxId)??null,[contexts,ctxId]);
  const attachedContextCount=useMemo(()=>Object.values(contextCapabilityMap).filter((codes)=>Array.isArray(codes)&&codes.includes(capCode)).length,[contextCapabilityMap,capCode]);
  const filteredContexts=useMemo(()=>{
    const needle=String(contextSearch??"").trim().toLowerCase();
    return contexts.filter((row)=>{
      if(!needle) return true;
      return [row.work_context_code,row.work_context_name,row.department_code,row.department_name,row.company_code,row.company_name]
        .filter(Boolean)
        .some((value)=>String(value).toLowerCase().includes(needle));
    });
  },[contexts,contextSearch]);
  const { getRowProps: getContextRowProps } = useErpListNavigation(filteredContexts, {
    onActivate: (row) => openBindingDrawer(row),
  });
  const filteredBindingCaps=useMemo(()=>{
    const needle=normalize(bindingSearch);
    return caps.filter((cap)=>{
      if(!needle) return true;
      return [cap.capability_code,cap.capability_name,cap.description]
        .filter(Boolean)
        .some((value)=>normalize(value).includes(needle));
    });
  },[caps,bindingSearch]);

  function updateDraft(resourceCode,updater){
    setDrafts((cur)=>{const base=cur[resourceCode]??(capMap.has(resourceCode)?rowDraft(capCode,capMap.get(resourceCode)):newDraft(capCode,resourceCode)); return {...cur,[resourceCode]:updater(base)};});
  }
  function updateAllow(resourceCode,key,checked,actionCode){
    updateDraft(resourceCode,(d)=>({...d,[key]:checked,denied_actions:(d.denied_actions??[]).filter((item)=>item!==actionCode)}));
  }
  function updateDeny(resourceCode,actionCode,checked){
    updateDraft(resourceCode,(d)=>{const denied=new Set(d.denied_actions??[]); if(checked) denied.add(actionCode); else denied.delete(actionCode); const next={...d,denied_actions:Array.from(denied)}; const actionEntry=ACTIONS.find(([code])=>code===actionCode); if(actionEntry) next[actionEntry[1]]=false; return next;});
  }
  async function postAndRefresh(path,payload,refreshFn,successMessage){
    setSaving(true); setError(""); setNotice("");
    try{const result=await fetchApi(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); console.info("CAPABILITY_GOVERNANCE_ACTION_RESULT",{path,requested:payload,persisted:result??null}); await refreshFn(); setNotice(successMessage);}
    catch(err){console.error("CAPABILITY_GOVERNANCE_ACTION_FAILED",{path,requested:payload,message:err?.message??"REQUEST_FAILED",code:err?.code??null,requestId:err?.requestId??null,decisionTrace:err?.decisionTrace??null});setError(`Governance request could not be completed. ${err.message??"REQUEST_FAILED"}`);}
    finally{setSaving(false);}
  }
  async function saveCap(){
    const code=capDraft.capability_code.trim().toUpperCase(), name=capDraft.capability_name.trim();
    if(!code||!name){setError("Capability code and capability name are required."); return;}
    setSaving(true); setError(""); setNotice("");
    try{
      const result=await fetchApi("/api/admin/acl/capabilities",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({capability_code:code,capability_name:name,description:capDraft.description.trim()})});
      console.info("CAPABILITY_PACK_SAVE_RESULT",{requested:{capability_code:code,capability_name:name,description:capDraft.description.trim()},persisted:result??null});
      await loadBootstrap(); setCapCode(code); setDrafts({}); setCapDraft(newCap()); setNotice(`Capability ${code} saved successfully.`);
    }catch(err){console.error("CAPABILITY_PACK_SAVE_FAILED",{requested:{capability_code:code,capability_name:name,description:capDraft.description.trim()},message:err?.message??"REQUEST_FAILED",code:err?.code??null,requestId:err?.requestId??null,decisionTrace:err?.decisionTrace??null});setError(`Capability pack could not be saved. ${err.message??"REQUEST_FAILED"}`);}finally{setSaving(false);}
  }
  async function saveMatrix(){
    if(!capCode){setError("Create or choose one capability pack first."); return;}
    if(!moduleCode){setError("Project and module choose na korle capability matrix save kora jabe na."); return;}
    if(!rows.length){setError("Selected project/module-er niche kono mapped business resource nei."); return;}
    setSaving(true); setError(""); setNotice("");
    try{
      for(const row of rows){
        const payload=row.draft, hadExisting=Boolean(row.savedRow), explicit=hasRule(payload);
        if(!explicit){ if(hadExisting){ await fetchApi("/api/admin/acl/capability-actions/disable",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({capability_code:capCode,resource_code:row.resource.resource_code})}); } continue; }
        await fetchApi("/api/admin/acl/capability-actions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({capability_code:capCode,resource_code:row.resource.resource_code,can_view:payload.can_view,can_write:payload.can_write,can_edit:payload.can_edit,can_delete:payload.can_delete,can_approve:payload.can_approve,can_export:payload.can_export,denied_actions:payload.denied_actions})});
      }
      console.info("CAPABILITY_MATRIX_SAVE_RESULT",{capability_code:capCode,module_code:moduleCode,project_code:projectCode||null});
      await loadCapRows(capCode); setNotice(`${capCode} capability-er jonno ${moduleCode} matrix save hoyeche.`);
    }catch(err){console.error("CAPABILITY_MATRIX_SAVE_FAILED",{capability_code:capCode,module_code:moduleCode,project_code:projectCode||null,selected_resource_code:selectedResourceCode||null,message:err?.message??"REQUEST_FAILED",code:err?.code??null,requestId:err?.requestId??null,decisionTrace:err?.decisionTrace??null});setError(`Capability matrix could not be saved. ${err.message??"REQUEST_FAILED"}`);}finally{setSaving(false);}
  }
  async function clearSelected(){
    if(!selectedRow) return;
    const ok=await openActionConfirm({eyebrow:"Capability Governance",title:"Clear Selected Resource Rule",message:`${selectedRow.resource.title} resource-er explicit capability rule clear korte chao?`,confirmLabel:"Clear",cancelLabel:"Cancel"});
    if(!ok) return;
    updateDraft(selectedRow.resource.resource_code,()=>newDraft(capCode,selectedRow.resource.resource_code));
  }
  function openBindingDrawer(row){
    setCtxId(row.work_context_id);
    setCtxCaps([]);
    setBindingSearch("");
    setBindingDrawerOpen(true);
    void loadCtxCaps(row.work_context_id);
  }
  async function toggleCapabilityForContext(workContextId, capabilityCode, attached, workContextCode){
    await postAndRefresh(
      attached?"/api/admin/acl/work-context-capabilities/unassign":"/api/admin/acl/work-context-capabilities/assign",
      {work_context_id:workContextId,capability_code:capabilityCode},
      async ()=>{
        await loadCtxCaps(workContextId);
        await loadContextCapabilityMap(contexts);
      },
      attached
        ?`Capability ${capabilityCode} removed from ${workContextCode}.`
        :`Capability ${capabilityCode} attached to ${workContextCode}.`,
    );
  }

  useErpScreenCommands([
    {id:"sa-capability-governance-control-panel",group:"Current Screen",label:"Go to SA control panel",keywords:["control panel","sa"],perform:()=>{openScreen("SA_CONTROL_PANEL",{mode:"replace"});navigate("/sa/control-panel");},order:10},
    {id:"sa-capability-governance-work-context-master",group:"Current Screen",label:"Open work context master",keywords:["work context","work scope","manual scope"],perform:()=>{openScreen("SA_WORK_CONTEXT_MASTER",{mode:"replace"});navigate("/sa/work-contexts");},order:20},
    {id:"sa-capability-governance-acl-version-center",group:"Current Screen",label:"Open ACL version center",keywords:["acl version","publish center","immutable version"],perform:()=>{openScreen("SA_ACL_VERSION_CENTER",{mode:"replace"});navigate("/sa/acl/version-center");},order:30},
  ]);
  useErpScreenHotkeys({refresh:{disabled:loading||catalogLoading,perform:()=>{void loadBootstrap(); void loadCatalog();}},focusSearch:{perform:()=>searchRef.current?.focus()},save:{disabled:saving,perform:()=>void saveMatrix()}});

  return (
    <ErpScreenScaffold
      eyebrow="SA Capability Governance"
      title="Screen Packs and Business-Area Binding"
      actions={[
        {key:"control-panel",label:"Control Panel",tone:"neutral",buttonRef:(el)=>{topRefs.current[0]=el;},onClick:()=>{openScreen("SA_CONTROL_PANEL",{mode:"replace"});navigate("/sa/control-panel");},onKeyDown:(e)=>handleLinearNavigation(e,{index:0,refs:topRefs.current,orientation:"horizontal"})},
        {key:"work-context-master",label:"Work Context Master",tone:"neutral",buttonRef:(el)=>{topRefs.current[1]=el;},onClick:()=>{openScreen("SA_WORK_CONTEXT_MASTER",{mode:"replace"});navigate("/sa/work-contexts");},onKeyDown:(e)=>handleLinearNavigation(e,{index:1,refs:topRefs.current,orientation:"horizontal"})},
        {key:"acl-version-center",label:"ACL Version Center",tone:"neutral",buttonRef:(el)=>{topRefs.current[2]=el;},onClick:()=>{openScreen("SA_ACL_VERSION_CENTER",{mode:"replace"});navigate("/sa/acl/version-center");},onKeyDown:(e)=>handleLinearNavigation(e,{index:2,refs:topRefs.current,orientation:"horizontal"})},
      ]}
      notices={[...(error?[{key:"error",tone:"error",message:error}]:[]),...(notice?[{key:"notice",tone:"success",message:notice}]:[])]}
      footerHints={["↑↓ Navigate", "F8 Refresh", "Ctrl+S Save", "Alt+Shift+F Search", "Esc Back", "Ctrl+K Command Bar"]}
    >
      <div className="grid gap-[var(--erp-section-gap)] xl:grid-cols-[1.15fr,0.85fr]">
        <section className="grid gap-[var(--erp-section-gap)]">
          <div className="grid gap-[var(--erp-section-gap)] border border-slate-300 bg-white p-3">
            <ErpSelectionSection label="Create Capability Pack" />
            <p className="text-xs text-slate-600">Start with CAP_HR_REQUESTER, CAP_HR_APPROVER, and CAP_HR_REPORT_VIEWER.</p>
            <div className="grid gap-[var(--erp-form-gap)]">
              <ErpDenseFormRow label="Capability Code" required>
                <input type="text" value={capDraft.capability_code} onChange={(e)=>setCapDraft((c)=>({...c,capability_code:e.target.value.toUpperCase()}))} placeholder="CAPABILITY_CODE" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Capability Name" required>
                <input type="text" value={capDraft.capability_name} onChange={(e)=>setCapDraft((c)=>({...c,capability_name:e.target.value}))} placeholder="Capability Name" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Description">
                <textarea value={capDraft.description} onChange={(e)=>setCapDraft((c)=>({...c,description:e.target.value}))} rows={2} placeholder="Description" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
              </ErpDenseFormRow>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving} onClick={()=>void saveCap()} className="border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-900">Save Pack</button>
              <button type="button" disabled={saving} onClick={()=>setCapDraft({capability_code:"CAP_HR_REQUESTER",capability_name:"HR Requester",description:"Requester access for leave and out work apply/my-request pages."})} className="border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">Requester</button>
              <button type="button" disabled={saving} onClick={()=>setCapDraft({capability_code:"CAP_HR_APPROVER",capability_name:"HR Approver",description:"Approver inbox and approval-history access for HR workflows."})} className="border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">Approver</button>
              <button type="button" disabled={saving} onClick={()=>setCapDraft({capability_code:"CAP_HR_REPORT_VIEWER",capability_name:"HR Report Viewer",description:"Register and reporting visibility without approval authority."})} className="border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">Report</button>
            </div>
          </div>
          <div className="grid gap-[var(--erp-section-gap)] border border-slate-300 bg-white p-3">
            <ErpSelectionSection label="Capability Matrix" />
            <div className="grid gap-[var(--erp-form-gap)]">
              <ErpDenseFormRow label="Capability">
                <ErpComboboxField
                  value={capCode}
                  onChange={(val) => setCapCode(val)}
                  options={caps.map((cap) => ({ value: cap.capability_code, label: `${cap.capability_code} | ${cap.capability_name}` }))}
                  blankLabel={caps.length === 0 ? "No capability pack yet" : "Choose capability"}
                  inputClassName="px-3 py-2 text-sm"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Project">
                <ErpComboboxField
                  value={projectCode}
                  onChange={(val) => setProjectCode(val)}
                  options={projectOptions.map((code) => ({ value: code, label: code }))}
                  blankLabel="All mapped projects"
                  inputClassName="px-3 py-2 text-sm"
                />
              </ErpDenseFormRow>
              <ErpDenseFormRow label="Module">
                <ErpComboboxField
                  value={moduleCode}
                  onChange={(val) => setModuleCode(val)}
                  options={moduleOptions.map((code) => ({ value: code, label: code }))}
                  blankLabel="Choose module"
                  inputClassName="px-3 py-2 text-sm"
                />
              </ErpDenseFormRow>
            </div>
            <QuickFilterInput label="Search Resources" value={search} onChange={setSearch} inputRef={searchRef} placeholder="Search inside the selected project/module" hint="First choose one module, then search inside that module." />
            <div className="flex items-center justify-between gap-3 border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span>{moduleCode ? "Arrow through rows, then edit the selected resource on the right." : "Choose one project and one exact module first."}</span>
              <button type="button" disabled={saving} onClick={()=>void saveMatrix()} className="border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-900">Save Matrix</button>
            </div>
          </div>
          <div className="border border-slate-300 bg-white">
            {!moduleCode ? (
              <div className="bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Project select korar por exact module choose koro. Tarpor oi module-er sob pages row hisebe asbe.
              </div>
            ) : catalogLoading ? (
              <div className="bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Loading mapped business resources.
              </div>
            ) : rows.length === 0 ? (
              <div className="bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Selected project/module-er niche visible mapped business resource paoa jayni.
              </div>
            ) : (
              <ErpDenseGrid
                columns={[
                  {
                    key: "resource",
                    label: "Resource",
                    render: ({ resource }) => (
                      <div>
                        <div className="font-semibold text-slate-900">{resource.title}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          {resource.resource_code}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {[resource.project_code, resource.module_code, resource.route_path]
                            .filter(Boolean)
                            .join(" | ")}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: "allow",
                    label: "Allow Flags",
                    render: ({ resource, draft }) => {
                      const available = new Set(resource.available_actions ?? []);
                      const enabled = ACTIONS.filter(([actionCode, key]) => available.has(actionCode) && Boolean(draft[key])).map(([, , label]) => label);
                      return enabled.length ? enabled.join(", ") : "No explicit allow";
                    },
                  },
                  {
                    key: "deny",
                    label: "Explicit Deny",
                    render: ({ draft }) => draft.denied_actions.length > 0 ? draft.denied_actions.join(", ") : "None",
                  },
                ]}
                rows={rows}
                rowKey={(row) => row.resource.resource_code}
                getRowProps={(row, index) => ({
                  ...getRowProps(index),
                  onClick: () => setSelectedResourceCode(row.resource.resource_code),
                  className:
                    row.resource.resource_code === selectedResourceCode ? "bg-sky-50" : "",
                })}
                onRowActivate={(row) => setSelectedResourceCode(row.resource.resource_code)}
                maxHeight="none"
              />
            )}
          </div>
        </section>
        <div className="grid gap-[var(--erp-section-gap)]">
          <section className="grid gap-[var(--erp-section-gap)] border border-slate-300 bg-white p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Selected Resource</div>
            <div className="text-sm font-semibold text-slate-900">{selectedRow?.resource?.title??"Advanced deny editor"}</div>
            {selectedRow?(
              <div className="grid gap-[var(--erp-section-gap)]">
                <div className="grid gap-1 text-xs text-slate-600">
                  <div>{selectedRow.resource.resource_code}</div>
                  <div>{[selectedRow.resource.project_code,selectedRow.resource.module_code,selectedRow.resource.route_path].filter(Boolean).join(" | ")}</div>
                </div>
                <div className="border border-slate-300">
                  <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] border-b border-slate-300 bg-slate-50 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <span>Action</span>
                    <span className="text-center">Allow</span>
                    <span className="text-center">Deny</span>
                  </div>
                  {ACTIONS.map(([actionCode,key,label])=>{
                    const available = new Set(selectedRow.resource.available_actions ?? []);
                    return (
                      <div key={`policy-${actionCode}`} className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-center border-b border-slate-200 px-2 py-[3px] text-[12px] text-slate-700 last:border-b-0">
                        <span>{label}</span>
                        <label className="flex justify-center">
                          <input type="checkbox" disabled={!available.has(actionCode)} checked={Boolean(selectedRow.draft[key])} onChange={(e)=>updateAllow(selectedRow.resource.resource_code,key,e.target.checked,actionCode)} className="h-4 w-4 cursor-pointer border-slate-300 bg-white text-emerald-600 disabled:cursor-not-allowed" />
                        </label>
                        <label className="flex justify-center">
                          <input type="checkbox" disabled={!available.has(actionCode)} checked={selectedRow.draft.denied_actions.includes(actionCode)} onChange={(e)=>updateDeny(selectedRow.resource.resource_code,actionCode,e.target.checked)} className="h-4 w-4 cursor-pointer border-slate-300 bg-white text-rose-600 disabled:cursor-not-allowed" />
                        </label>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] text-slate-500">Choose allow or deny per action. Deny clears allow for the same action.</div>
                  <button type="button" onClick={()=>void clearSelected()} className="border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-rose-700">Clear Rule</button>
                </div>
              </div>
            ):<div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">Matrix theke ekta resource row select koro. Tarpor allow/deny editor ekhanei khulbe.</div>}
          </section>
          <section className="grid gap-[var(--erp-section-gap)] border border-slate-300 bg-white p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Access Pack Coverage</div>
            <div className="text-sm font-semibold text-slate-900">{capCode||"Selected access pack summary"}</div>
            <div className="border border-slate-300 bg-white">
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]"><span className="text-[11px] text-slate-500">Selected Pack</span><span className="text-[11px] font-semibold text-slate-900">{capCode||"Choose capability"}</span></div>
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-2 py-[3px]"><span className="text-[11px] text-slate-500">Saved Rows</span><span className="text-[11px] font-semibold text-slate-900">{capRows.length}</span></div>
              <div className="flex items-baseline justify-between gap-2 px-2 py-[3px]"><span className="text-[11px] text-slate-500">Attached Contexts</span><span className="text-[11px] font-semibold text-slate-900">{bindingLoading?"...":attachedContextCount}</span></div>
            </div>
            <div className="mt-4 border border-slate-300 bg-white">
              {capRows.length===0?<div className="px-4 py-3 text-sm text-slate-500">এই capability pack-এ এখনো কোনো saved page/action row নেই। আগে left side matrix save করো.</div>:capRows.map((row)=><div key={row.resource_code} className="border-b border-slate-200 px-4 py-3 last:border-b-0"><div className="text-sm font-semibold text-slate-900">{row.resource_code}</div><div className="mt-1 text-xs text-slate-500">{ACTIONS.filter(([,key])=>row[key]).map(([, , label])=>label).join(", ")||"No allow flags"}{Array.isArray(row.denied_actions)&&row.denied_actions.length?` | Deny: ${row.denied_actions.join(", ")}`:""}</div></div>)}
            </div>
          </section>
          <section className="grid gap-[var(--erp-section-gap)] border border-slate-300 bg-white p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Business Areas</div>
            <div className="text-sm font-semibold text-slate-900">Open one business area, then choose access packs inside the drawer</div>
            <ErpDenseFormRow label="Company">
              <ErpComboboxField
                value={companyId}
                onChange={(val) => setCompanyId(val)}
                options={companies.map((c) => ({ value: c.id, label: formatCompanyLabel(c) }))}
                blankLabel="Choose company"
                inputClassName="px-3 py-2 text-sm"
              />
            </ErpDenseFormRow>
            <QuickFilterInput label="Search Contexts" value={contextSearch} onChange={setContextSearch} placeholder="Search by company, department, or context code" hint="GENERAL_OPS is company-wide. DEPT_* rows come from department setup." />
            <div className="border border-slate-300">
              {contexts.length===0?<div className="bg-slate-50 px-4 py-3 text-sm text-slate-500">No work context is currently defined for this company. Company and department setup first complete koro.</div>:filteredContexts.length===0?<div className="bg-slate-50 px-4 py-3 text-sm text-slate-500">Current search-e kono context match koreni.</div>:filteredContexts.map((row)=>{
                const attachedCodes=contextCapabilityMap[row.work_context_id]??[];
                const contextType=classifyContext(row);
                const recommendedCodes=recommendedCapabilityCodes(row);
                return <div key={row.work_context_id} className={`border-b last:border-b-0 ${ctxId===row.work_context_id?"border-sky-200 bg-sky-50":"border-slate-300 bg-white"}`}>
                  <button type="button" onClick={()=>openBindingDrawer(row)} {...getContextRowProps(filteredContexts.indexOf(row))} className="grid w-full grid-cols-[minmax(0,1.6fr)_120px_120px] items-start gap-3 px-2 py-[6px] text-left text-[12px] text-slate-800">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{row.work_context_code} | {row.work_context_name}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{formatCompanyLabel(row)}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.department_code?`${row.department_code} | ${row.department_name}`:"Company-wide context (GENERAL_OPS type)"}</div>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      <div className="font-semibold text-slate-900">{contextType==="GENERAL"?"General":contextType==="DEPARTMENT"?"Department":"Manual"}</div>
                      <div className="mt-1">{attachedCodes.length} pack{attachedCodes.length===1?"":"s"}</div>
                    </div>
                    <div className="text-[11px] text-slate-600">{recommendedCodes.length ? recommendedCodes.join(", ") : "No recommended default"}</div>
                  </button>
                </div>;
              })}
            </div>
            <div className="border border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              {ctxId&&ctxCaps.length>0?`Selected business area currently carries: ${ctxCaps.map((cap)=>cap.capability_code).join(", ")}`:"Open any business area row to inspect and manage its attached access packs."}
            </div>
          </section>
          <section className="grid gap-[var(--erp-section-gap)] border border-slate-300 bg-white p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">ACL Publish Flow</div>
            <div className="text-sm font-semibold text-slate-900">Versioning moved into its own desk</div>
            <div className="grid gap-[var(--erp-form-gap)] text-sm text-slate-700">
              <p>Use this workspace to change access packs and work-scope binding. Then open ACL Version Center to see which companies now require a fresh publish snapshot.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={()=>{openScreen("SA_ACL_VERSION_CENTER",{mode:"replace"});navigate("/sa/acl/version-center");}} className="border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-900">Open ACL Version Center</button>
                <button type="button" onClick={()=>{openScreen("SA_WORK_CONTEXT_MASTER",{mode:"replace"});navigate("/sa/work-contexts");}} className="border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">Review Work Context Master</button>
              </div>
            </div>
          </section>
        </div>
      </div>
      <DrawerBase
        visible={bindingDrawerOpen}
        title={selectedContext?`${selectedContext.work_context_code} | ${selectedContext.work_context_name}`:"Manage Work Scope Packs"}
        onEscape={()=>setBindingDrawerOpen(false)}
        initialFocusRef={bindingSearchRef}
        width="min(560px, calc(100vw - 24px))"
        actions={
          <button
            type="button"
            onClick={()=>setBindingDrawerOpen(false)}
            className="border border-sky-700 bg-sky-100 px-2 py-[3px] text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-950"
          >
            Done
          </button>
        }
      >
        {selectedContext?(
          <div className="grid gap-[var(--erp-section-gap)]">
            <div className="grid gap-[var(--erp-form-gap)] text-sm text-slate-700">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Scope Type</p>
                <p className="mt-1 font-semibold text-slate-900">
                  {classifyContext(selectedContext)==="GENERAL"?"General scope":classifyContext(selectedContext)==="DEPARTMENT"?"Department-derived scope":"Manual work scope"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Company</p>
                <p className="mt-1">{formatCompanyLabel(selectedContext)}</p>
                <p className="mt-1 text-xs text-slate-500">{formatCompanyAddress(selectedContext)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Department Link</p>
                <p className="mt-1">{selectedContext.department_code?`${selectedContext.department_code} | ${selectedContext.department_name}`:"No department link. This is a company-wide or manual scope."}</p>
              </div>
              {recommendedCapabilityCodes(selectedContext).length>0?(
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recommended First Pack</p>
                  <p className="mt-1 font-semibold text-emerald-800">{recommendedCapabilityCodes(selectedContext).join(", ")}</p>
                </div>
              ):null}
            </div>
            <div className="grid gap-[var(--erp-form-gap)]">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Search Packs</span>
                <input
                  ref={bindingSearchRef}
                  type="text"
                  value={bindingSearch}
                  onChange={(e)=>setBindingSearch(e.target.value)}
                  placeholder="Search by pack code, name, or description"
                  className="mt-2 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                />
              </label>
              <div className="border border-slate-300 bg-white">
                {filteredBindingCaps.length===0?(
                  <div className="px-4 py-3 text-sm text-slate-500">Current search-e kono capability pack match koreni.</div>
                ):filteredBindingCaps.map((cap)=>{
                  const attached=ctxCaps.some((item)=>item.capability_code===cap.capability_code);
                  const recommended=recommendedCapabilityCodes(selectedContext).includes(cap.capability_code);
                  return (
                    <div key={`${selectedContext.work_context_id}-${cap.capability_code}`} className={`grid gap-2 border-b px-3 py-2 last:border-b-0 ${recommended?"bg-emerald-50":"bg-white"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap gap-2">
                            <span className="text-sm font-semibold text-slate-900">{cap.capability_code}</span>
                            <span className="text-sm text-slate-600">{cap.capability_name}</span>
                            {recommended?<span className="border border-emerald-300 bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-900">Recommended</span>:null}
                            {attached?<span className="border border-violet-300 bg-violet-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-800">Attached</span>:null}
                          </div>
                          {cap.description?<p className="mt-2 text-xs leading-5 text-slate-500">{cap.description}</p>:null}
                        </div>
                        <button
                          type="button"
                          disabled={saving||bindingLoading}
                          onClick={()=>void toggleCapabilityForContext(selectedContext.work_context_id,cap.capability_code,attached,selectedContext.work_context_code)}
                          className={`border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] ${attached?"border-rose-300 bg-rose-50 text-rose-700":"border-emerald-300 bg-emerald-50 text-emerald-800"}`}
                        >
                          {attached?"Remove":"Attach"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ):(
          <div className="text-sm text-slate-500">Choose one work scope row first.</div>
        )}
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
