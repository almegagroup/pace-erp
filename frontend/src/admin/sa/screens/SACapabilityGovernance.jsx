import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";

const ACTIONS = [["VIEW","can_view","View"],["WRITE","can_write","Write"],["EDIT","can_edit","Edit"],["DELETE","can_delete","Delete"],["APPROVE","can_approve","Approve"],["EXPORT","can_export","Export"]];

async function readJsonSafe(r){try{return await r.clone().json();}catch{return null;}}
async function fetchApi(path,options){
  const r=await fetch(`${import.meta.env.VITE_API_BASE}${path}`,{credentials:"include",...options});
  const j=await readJsonSafe(r);
  if(!r.ok||!j?.ok){const code=j?.code??"REQUEST_FAILED";const req=j?.request_id?` | Req ${j.request_id}`:"";const trace=j?.decision_trace?` | ${j.decision_trace}`:"";throw new Error(`${code}${trace}${req}`);}
  return j.data??{};
}
const newCap=()=>({capability_code:"",capability_name:"",description:""});
const newDraft=(cap="",res="")=>({capability_code:cap,resource_code:res,can_view:false,can_write:false,can_edit:false,can_delete:false,can_approve:false,can_export:false,denied_actions:[]});
const rowDraft=(cap,row)=>({...newDraft(cap,row.resource_code),...row,denied_actions:Array.isArray(row.denied_actions)?row.denied_actions:[]});
const hasRule=(d)=>ACTIONS.some(([,k])=>Boolean(d[k]))||d.denied_actions.length>0;

export default function SACapabilityGovernance(){
  const navigate=useNavigate();
  const topRefs=useRef([]), matrixRowRefs=useRef([]), searchRef=useRef(null);
  const [companies,setCompanies]=useState([]),[caps,setCaps]=useState([]),[catalog,setCatalog]=useState([]),[contexts,setContexts]=useState([]),[versions,setVersions]=useState([]),[capRows,setCapRows]=useState([]),[ctxCaps,setCtxCaps]=useState([]),[contextBindingMap,setContextBindingMap]=useState({});
  const [companyId,setCompanyId]=useState(""),[capCode,setCapCode]=useState(""),[ctxId,setCtxId]=useState(""),[projectCode,setProjectCode]=useState(""),[moduleCode,setModuleCode]=useState(""),[selectedResourceCode,setSelectedResourceCode]=useState("");
  const [search,setSearch]=useState(""),[drafts,setDrafts]=useState({}),[capDraft,setCapDraft]=useState(newCap()),[versionDescription,setVersionDescription]=useState(""),[contextSearch,setContextSearch]=useState("");
  const [loading,setLoading]=useState(true),[catalogLoading,setCatalogLoading]=useState(true),[saving,setSaving]=useState(false),[bindingLoading,setBindingLoading]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");

  async function loadBootstrap(){
    setLoading(true); setError("");
    try{
      const [companyData,capData]=await Promise.all([fetchApi("/api/admin/companies"),fetchApi("/api/admin/acl/capabilities")]);
      const nextCompanies=companyData.companies??[], nextCaps=capData.capabilities??[];
      setCompanies(nextCompanies); setCaps(nextCaps);
      if(!companyId) setCompanyId(nextCompanies[0]?.id??"");
      if(!capCode) setCapCode(nextCaps[0]?.capability_code??"");
    }catch(err){setError(`Capability governance bootstrap could not be loaded. ${err.message??"REQUEST_FAILED"}`);}finally{setLoading(false);}
  }
  async function loadCatalog(){
    setCatalogLoading(true);
    try{const data=await fetchApi("/api/admin/approval/resource-policy"); setCatalog(data.resources??[]);}
    catch(err){setCatalog([]); setError(`Capability resource catalog could not be loaded. ${err.message??"REQUEST_FAILED"}`);}
    finally{setCatalogLoading(false);}
  }
  async function loadCapRows(code=capCode){
    if(!code){setCapRows([]);return;}
    try{const data=await fetchApi(`/api/admin/acl/capability-actions?capability_code=${encodeURIComponent(code)}`); setCapRows(data.permissions??[]);}
    catch(err){setCapRows([]); setError(`Capability action rows could not be loaded. ${err.message??"REQUEST_FAILED"}`);}
  }
  async function loadCompanyState(id=companyId){
    if(!id){setContexts([]);setVersions([]);return;}
    try{
      const [w,v]=await Promise.all([fetchApi(`/api/admin/acl/work-contexts?company_id=${encodeURIComponent(id)}`),fetchApi(`/api/admin/acl/versions?company_id=${encodeURIComponent(id)}`)]);
      const next=w.work_contexts??[]; setContexts(next); setVersions(v.versions??[]);
      setCtxId((cur)=>next.some((r)=>r.work_context_id===cur)?cur:next[0]?.work_context_id??"");
    }catch(err){setContexts([]);setVersions([]);setError(`Company capability state could not be loaded. ${err.message??"REQUEST_FAILED"}`);}
  }
  async function loadCtxCaps(id=ctxId){
    if(!id){setCtxCaps([]);return;}
    try{const d=await fetchApi(`/api/admin/acl/work-context-capabilities?work_context_id=${encodeURIComponent(id)}`); setCtxCaps(d.capabilities??[]);}
    catch(err){setCtxCaps([]); setError(`Work-context capability bindings could not be loaded. ${err.message??"REQUEST_FAILED"}`);}
  }
  async function loadContextBindingMap(nextContexts=contexts, nextCapCode=capCode){
    if(!nextCapCode||nextContexts.length===0){setContextBindingMap({}); return;}
    setBindingLoading(true);
    try{
      const settled=await Promise.allSettled(
        nextContexts.map(async (row)=>{
          const data=await fetchApi(`/api/admin/acl/work-context-capabilities?work_context_id=${encodeURIComponent(row.work_context_id)}`);
          return [row.work_context_id,(data.capabilities??[]).some((cap)=>cap.capability_code===nextCapCode)];
        }),
      );
      const nextMap={};
      for(const result of settled){
        if(result.status==="fulfilled"){
          const [workContextId,isAttached]=result.value;
          nextMap[workContextId]=isAttached;
        }
      }
      setContextBindingMap(nextMap);
    }catch(err){
      setContextBindingMap({});
      setError(`Capability-to-context status could not be loaded. ${err.message??"REQUEST_FAILED"}`);
    }finally{
      setBindingLoading(false);
    }
  }
  useEffect(()=>{void loadBootstrap(); void loadCatalog();},[]);
  useEffect(()=>{void loadCapRows(capCode);},[capCode]);
  useEffect(()=>{void loadCompanyState(companyId);},[companyId]);
  useEffect(()=>{void loadCtxCaps(ctxId);},[ctxId]);
  useEffect(()=>{void loadContextBindingMap(contexts,capCode);},[contexts,capCode]);

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
  useEffect(()=>{
    if(!rows.length){setSelectedResourceCode(""); return;}
    if(!selectedResourceCode||!rows.some((r)=>r.resource.resource_code===selectedResourceCode)) setSelectedResourceCode(rows[0].resource.resource_code);
  },[rows,selectedResourceCode]);
  const selectedRow=useMemo(()=>rows.find((r)=>r.resource.resource_code===selectedResourceCode)??null,[rows,selectedResourceCode]);
  const attachedContextCount=useMemo(()=>Object.values(contextBindingMap).filter(Boolean).length,[contextBindingMap]);
  const filteredContexts=useMemo(()=>{
    const needle=String(contextSearch??"").trim().toLowerCase();
    return contexts.filter((row)=>{
      if(!needle) return true;
      return [row.work_context_code,row.work_context_name,row.department_code,row.department_name,row.company_code,row.company_name]
        .filter(Boolean)
        .some((value)=>String(value).toLowerCase().includes(needle));
    });
  },[contexts,contextSearch]);

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
    try{await fetchApi(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); await refreshFn(); setNotice(successMessage);}
    catch(err){setError(`Governance request could not be completed. ${err.message??"REQUEST_FAILED"}`);}
    finally{setSaving(false);}
  }
  async function saveCap(){
    const code=capDraft.capability_code.trim().toUpperCase(), name=capDraft.capability_name.trim();
    if(!code||!name){setError("Capability code and capability name are required."); return;}
    setSaving(true); setError(""); setNotice("");
    try{
      await fetchApi("/api/admin/acl/capabilities",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({capability_code:code,capability_name:name,description:capDraft.description.trim()})});
      await loadBootstrap(); setCapCode(code); setDrafts({}); setCapDraft(newCap()); setNotice(`Capability ${code} saved successfully.`);
    }catch(err){setError(`Capability pack could not be saved. ${err.message??"REQUEST_FAILED"}`);}finally{setSaving(false);}
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
      await loadCapRows(capCode); setNotice(`${capCode} capability-er jonno ${moduleCode} matrix save hoyeche.`);
    }catch(err){setError(`Capability matrix could not be saved. ${err.message??"REQUEST_FAILED"}`);}finally{setSaving(false);}
  }
  async function clearSelected(){
    if(!selectedRow) return;
    const ok=await openActionConfirm({eyebrow:"Capability Governance",title:"Clear Selected Resource Rule",message:`${selectedRow.resource.title} resource-er explicit capability rule clear korte chao?`,confirmLabel:"Clear",cancelLabel:"Cancel"});
    if(!ok) return;
    updateDraft(selectedRow.resource.resource_code,()=>newDraft(capCode,selectedRow.resource.resource_code));
  }

  useErpScreenCommands([{id:"sa-capability-governance-control-panel",group:"Current Screen",label:"Go to SA control panel",keywords:["control panel","sa"],perform:()=>{openScreen("SA_CONTROL_PANEL",{mode:"replace"});navigate("/sa/control-panel");},order:10}]);
  useErpScreenHotkeys({refresh:{disabled:loading||catalogLoading,perform:()=>{void loadBootstrap(); void loadCatalog();}},focusSearch:{perform:()=>searchRef.current?.focus()},save:{disabled:saving,perform:()=>void saveMatrix()}});

  return (
    <ErpScreenScaffold
      eyebrow="SA Capability Governance"
      title="Capability, Work Context, and ACL Version Control"
      description="Create reusable capability packs, fill them with mapped business-resource actions, attach them to work contexts, and freeze immutable ACL versions."
      actions={[{key:"control-panel",label:"Control Panel",tone:"neutral",buttonRef:(el)=>{topRefs.current[0]=el;},onClick:()=>{openScreen("SA_CONTROL_PANEL",{mode:"replace"});navigate("/sa/control-panel");},onKeyDown:(e)=>handleLinearNavigation(e,{index:0,refs:topRefs.current,orientation:"horizontal"})}]}
      notices={[...(error?[{key:"error",tone:"error",message:error}]:[]),...(notice?[{key:"notice",tone:"success",message:notice}]:[])]}
      metrics={[{key:"caps",label:"Capabilities",value:loading?"...":String(caps.length),tone:"sky",caption:"Available capability packs."},{key:"contexts",label:"Work Contexts",value:loading?"...":String(contexts.length),tone:"emerald",caption:"Contexts in selected company."},{key:"rows",label:"Capability Rows",value:loading?"...":String(capRows.length),tone:"amber",caption:"Rows for selected capability."},{key:"attached",label:"Attached Contexts",value:bindingLoading?"...":String(attachedContextCount),tone:"violet",caption:"Selected pack is currently attached here."}]}
    >
      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <ErpSectionCard eyebrow="Capability Actions" title="Capability matrix" description="Create one pack, choose one module, then set all page-action rows together instead of typing manual resource codes.">
          <div className="mb-6 grid gap-3 border border-slate-300 bg-slate-50 px-4 py-4">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Create Capability Pack</p><p className="mt-1 text-xs text-slate-600">Start with CAP_HR_REQUESTER, CAP_HR_APPROVER, and CAP_HR_REPORT_VIEWER.</p></div>
            <div className="grid gap-3 md:grid-cols-2">
              <input type="text" value={capDraft.capability_code} onChange={(e)=>setCapDraft((c)=>({...c,capability_code:e.target.value.toUpperCase()}))} placeholder="CAPABILITY_CODE" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
              <input type="text" value={capDraft.capability_name} onChange={(e)=>setCapDraft((c)=>({...c,capability_name:e.target.value}))} placeholder="Capability Name" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
            </div>
            <textarea value={capDraft.description} onChange={(e)=>setCapDraft((c)=>({...c,description:e.target.value}))} rows={2} placeholder="Description" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={saving} onClick={()=>void saveCap()} className="border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">Save Capability Pack</button>
              <button type="button" disabled={saving} onClick={()=>setCapDraft({capability_code:"CAP_HR_REQUESTER",capability_name:"HR Requester",description:"Requester access for leave and out work apply/my-request pages."})} className="border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Use Requester Template</button>
              <button type="button" disabled={saving} onClick={()=>setCapDraft({capability_code:"CAP_HR_APPROVER",capability_name:"HR Approver",description:"Approver inbox and approval-history access for HR workflows."})} className="border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Use Approver Template</button>
              <button type="button" disabled={saving} onClick={()=>setCapDraft({capability_code:"CAP_HR_REPORT_VIEWER",capability_name:"HR Report Viewer",description:"Register and reporting visibility without approval authority."})} className="border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Use Report Template</button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block"><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Capability</span><select value={capCode} onChange={(e)=>setCapCode(e.target.value)} className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none">{caps.length===0?<option value="">No capability pack yet</option>:null}{caps.map((cap)=><option key={cap.capability_code} value={cap.capability_code}>{cap.capability_code} | {cap.capability_name}</option>)}</select></label>
            <QuickFilterInput label="Search Resources" value={search} onChange={setSearch} inputRef={searchRef} placeholder="Search inside the selected project/module" hint="First choose one module, then search inside that module." />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block"><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Project</span><select value={projectCode} onChange={(e)=>setProjectCode(e.target.value)} className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"><option value="">All mapped projects</option>{projectOptions.map((code)=><option key={code} value={code}>{code}</option>)}</select></label>
            <label className="block"><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Module</span><select value={moduleCode} onChange={(e)=>setModuleCode(e.target.value)} className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none"><option value="">Choose module</option>{moduleOptions.map((code)=><option key={code} value={code}>{code}</option>)}</select></label>
          </div>
          <button type="button" disabled={saving} onClick={()=>void saveMatrix()} className="mt-4 border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">Save Capability Matrix</button>
          <div className="mt-6 overflow-x-auto border border-slate-300 bg-white">
            {!moduleCode?<div className="bg-slate-50 px-4 py-4 text-sm text-slate-500">Project select korar por exact module choose koro. Tarpor oi module-er sob pages row hisebe asbe.</div>:catalogLoading?<div className="bg-slate-50 px-4 py-4 text-sm text-slate-500">Loading mapped business resources.</div>:rows.length===0?<div className="bg-slate-50 px-4 py-4 text-sm text-slate-500">Selected project/module-er niche visible mapped business resource paoa jayni.</div>:<table className="min-w-full border-collapse text-sm text-slate-700"><thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"><tr><th className="border-b border-slate-300 px-4 py-3 text-left">Resource</th>{ACTIONS.map(([, , label])=><th key={label} className="border-b border-l border-slate-300 px-3 py-3 text-center">{label}</th>)}</tr></thead><tbody>{rows.map(({resource,draft},index)=>{const selected=resource.resource_code===selectedResourceCode;const available=new Set(resource.available_actions??[]);return(<tr key={resource.resource_code} className={selected?"bg-sky-50":"bg-white"}><td className="border-b border-slate-200 px-4 py-3 align-top" onClick={()=>setSelectedResourceCode(resource.resource_code)}><button ref={(el)=>{matrixRowRefs.current[index]=el;}} type="button" className="w-full cursor-pointer text-left"><div className="font-semibold text-slate-900">{resource.title}</div><div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{resource.resource_code}</div><div className="mt-1 text-xs text-slate-500">{[resource.project_code,resource.module_code,resource.route_path].filter(Boolean).join(" | ")}</div>{draft.denied_actions.length>0?<div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-rose-600">Explicit deny: {draft.denied_actions.join(", ")}</div>:null}</button></td>{ACTIONS.map(([actionCode,key])=><td key={`${resource.resource_code}-${actionCode}`} className="border-b border-l border-slate-200 px-3 py-3 text-center"><input type="checkbox" disabled={!available.has(actionCode)} checked={Boolean(draft[key])} onChange={(e)=>updateAllow(resource.resource_code,key,e.target.checked,actionCode)} className="h-4 w-4 cursor-pointer border-slate-300 bg-white text-emerald-600 disabled:cursor-not-allowed" /></td>)}</tr>);})}</tbody></table>}
          </div>
        </ErpSectionCard>
        <div className="grid gap-6">
          <ErpSectionCard eyebrow="Selected Resource" title={selectedRow?.resource?.title??"Advanced deny editor"} description="Main matrix handles allow flags. Explicit deny stays here as an advanced override for the selected resource.">
            {selectedRow?<div className="space-y-4"><div className="border border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-600"><div>{selectedRow.resource.resource_code}</div><div className="mt-1">{[selectedRow.resource.project_code,selectedRow.resource.module_code,selectedRow.resource.route_path].filter(Boolean).join(" | ")}</div></div><div className="border border-slate-300 bg-white"><div className="grid grid-cols-[minmax(0,1fr)_84px] border-b border-slate-300 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"><span>Advanced Explicit Deny</span><span className="text-center">Deny</span></div>{ACTIONS.map(([actionCode,,label])=><div key={`deny-${actionCode}`} className="grid grid-cols-[minmax(0,1fr)_84px] items-center border-b border-slate-200 px-4 py-3 text-sm text-slate-700 last:border-b-0"><span>{label}</span><label className="flex justify-center"><input type="checkbox" checked={selectedRow.draft.denied_actions.includes(actionCode)} onChange={(e)=>updateDeny(selectedRow.resource.resource_code,actionCode,e.target.checked)} className="h-4 w-4 cursor-pointer border-slate-300 bg-white text-rose-600" /></label></div>)}</div><button type="button" onClick={()=>void clearSelected()} className="border border-rose-300 bg-rose-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-700">Clear Selected Resource Rule</button></div>:<div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">Matrix theke ekta resource row select koro. Tarpor chaile explicit deny advanced override set korte parbe.</div>}
          </ErpSectionCard>
          <ErpSectionCard eyebrow="Capability Coverage" title={capCode||"Selected capability summary"} description="See what the selected capability contains and where it is attached. Work-context creation stays elsewhere; this screen only binds packs to existing contexts.">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="border border-slate-300 bg-slate-50 px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Selected Pack</p><p className="mt-2 text-sm font-semibold text-slate-900">{capCode||"Choose capability"}</p></div>
              <div className="border border-slate-300 bg-slate-50 px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Saved Rows</p><p className="mt-2 text-sm font-semibold text-slate-900">{capRows.length}</p></div>
              <div className="border border-slate-300 bg-slate-50 px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Attached Contexts</p><p className="mt-2 text-sm font-semibold text-slate-900">{bindingLoading?"...":attachedContextCount}</p></div>
            </div>
            <div className="mt-4 border border-slate-300 bg-white">
              {capRows.length===0?<div className="px-4 py-4 text-sm text-slate-500">এই capability pack-এ এখনো কোনো saved page/action row নেই। আগে left side matrix save করো.</div>:capRows.map((row)=><div key={row.resource_code} className="border-b border-slate-200 px-4 py-3 last:border-b-0"><div className="text-sm font-semibold text-slate-900">{row.resource_code}</div><div className="mt-1 text-xs text-slate-500">{ACTIONS.filter(([,key])=>row[key]).map(([, , label])=>label).join(", ")||"No allow flags"}{Array.isArray(row.denied_actions)&&row.denied_actions.length?` | Deny: ${row.denied_actions.join(", ")}`:""}</div></div>)}
            </div>
          </ErpSectionCard>
          <ErpSectionCard eyebrow="Work Contexts" title="Attach selected capability to existing contexts" description="Company-wide GENERAL_OPS and department-derived DEPT_* contexts come from company/department setup. Here SA only decides which capability pack goes where.">
            <label className="block"><span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Company</span><select value={companyId} onChange={(e)=>setCompanyId(e.target.value)} className="mt-2 w-full border border-slate-300 bg-[#fffef7] px-3 py-2 text-sm text-slate-900 outline-none">{companies.map((c)=><option key={c.id} value={c.id}>{c.company_code} | {c.company_name}</option>)}</select></label>
            <QuickFilterInput label="Search Contexts" value={contextSearch} onChange={setContextSearch} placeholder="Search by company, department, or context code" hint="GENERAL_OPS is company-wide. DEPT_* rows come from department setup." />
            <div className="mt-6 border border-slate-300">
              {contexts.length===0?<div className="bg-slate-50 px-4 py-4 text-sm text-slate-500">No work context is currently defined for this company. Company and department setup first complete koro.</div>:filteredContexts.length===0?<div className="bg-slate-50 px-4 py-4 text-sm text-slate-500">Current search-e kono context match koreni.</div>:filteredContexts.map((row)=>{
                const attached=Boolean(contextBindingMap[row.work_context_id]);
                return <div key={row.work_context_id} className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0 ${attached?"border-violet-200 bg-violet-50":"border-slate-300 bg-white"}`}>
                  <button type="button" onClick={()=>setCtxId(row.work_context_id)} className="min-w-0 flex-1 cursor-pointer text-left">
                    <div className="text-sm font-semibold text-slate-900">{row.work_context_code} | {row.work_context_name}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{row.company_code} | {row.company_name}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.department_code?`${row.department_code} | ${row.department_name}`:"Company-wide context (GENERAL_OPS type)"}</div>
                  </button>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${attached?"text-violet-700":"text-slate-500"}`}>{attached?"Attached":"Not attached"}</span>
                    <button type="button" disabled={!capCode||saving||bindingLoading} onClick={()=>void postAndRefresh(attached?"/api/admin/acl/work-context-capabilities/unassign":"/api/admin/acl/work-context-capabilities/assign",{work_context_id:row.work_context_id,capability_code:capCode},async ()=>{await loadCtxCaps(ctxId||row.work_context_id); await loadContextBindingMap(contexts,capCode);},attached?`Capability ${capCode} removed from ${row.work_context_code}.`:`Capability ${capCode} attached to ${row.work_context_code}.`)} className={`border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${attached?"border-rose-300 bg-rose-50 text-rose-700":"border-emerald-300 bg-emerald-50 text-emerald-800"}`}>{attached?"Remove":"Attach"}</button>
                  </div>
                </div>;
              })}
            </div>
            <div className="mt-4 border border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              {ctxId&&ctxCaps.length>0?`Selected context currently carries: ${ctxCaps.map((cap)=>cap.capability_code).join(", ")}`:"Select any context row to inspect what packs are already attached there."}
            </div>
          </ErpSectionCard>
          <ErpSectionCard eyebrow="ACL Versions" title="Immutable company ledger" description="Freeze current governance rows into a new ACL version, then activate only the version runtime should use.">
            <input type="text" value={versionDescription} onChange={(e)=>setVersionDescription(e.target.value)} placeholder="Version description" className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none" />
            <button type="button" disabled={!companyId||saving} onClick={()=>void postAndRefresh("/api/admin/acl/versions",{company_id:companyId,description:versionDescription.trim()},()=>loadCompanyState(companyId),"Immutable ACL version captured successfully.")} className="mt-4 border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">Capture Immutable Version</button>
            <div className="mt-6 border border-slate-300">{versions.length===0?<div className="bg-slate-50 px-4 py-4 text-sm text-slate-500">No ACL version is currently available for this company.</div>:versions.map((v)=><div key={v.acl_version_id} className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-300 bg-white px-4 py-3 last:border-b-0"><div><p className="text-sm font-semibold text-slate-900">V{v.version_number} | {v.description}</p><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{v.is_active?"Active":"Inactive"}{v.source_captured_at?" | Source frozen":""}</p></div><button type="button" disabled={v.is_active||saving} onClick={()=>void postAndRefresh("/api/admin/acl/versions/activate",{company_id:companyId,acl_version_id:v.acl_version_id},()=>loadCompanyState(companyId),"ACL version activated successfully.")} className={`border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${v.is_active?"border-emerald-300 bg-emerald-50 text-emerald-700":"border-slate-300 bg-white text-slate-700"}`}>{v.is_active?"Active":"Activate"}</button></div>)}</div>
          </ErpSectionCard>
        </div>
      </div>
    </ErpScreenScaffold>
  );
}
