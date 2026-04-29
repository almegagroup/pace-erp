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

const PRESET_CAPS = [
  {capability_code:"CAP_HR_SELF_SERVICE",capability_name:"HR Self Service",description:"Self-service access for leave and out work apply / my-request pages."},
  {capability_code:"CAP_HR_APPROVER",capability_name:"HR Approver",description:"Approver inbox and approval-history access for HR workflows."},
  {capability_code:"CAP_HR_AUDIT_VIEW",capability_name:"HR Audit",description:"Register and reporting visibility without approval authority."},
  {capability_code:"CAP_HR_ACCESS",capability_name:"HR Admin Access",description:"Full HR management: leave types, calendar, attendance correction."},
  {capability_code:"CAP_HR_DIRECTOR",capability_name:"HR Director",description:"Director-level access including export permissions across all HR reports."},
];

const TAB_LABELS = {matrix:"Capability Matrix", bindings:"Work Area Bindings", packs:"Pack Definitions"};

export default function SACapabilityGovernance(){
  const navigate=useNavigate();
  const topRefs=useRef([]), searchRef=useRef(null), bindingSearchRef=useRef(null);
  const [companies,setCompanies]=useState([]),[caps,setCaps]=useState([]),[catalog,setCatalog]=useState([]),[contexts,setContexts]=useState([]),[capRows,setCapRows]=useState([]),[ctxCaps,setCtxCaps]=useState([]),[contextCapabilityMap,setContextCapabilityMap]=useState({});
  const [companyId,setCompanyId]=useState(""),[capCode,setCapCode]=useState(""),[ctxId,setCtxId]=useState(""),[projectCode,setProjectCode]=useState(""),[moduleCode,setModuleCode]=useState(""),[selectedResourceCode,setSelectedResourceCode]=useState("");
  const [search,setSearch]=useState(""),[drafts,setDrafts]=useState({}),[capDraft,setCapDraft]=useState(newCap()),[contextSearch,setContextSearch]=useState(""),[bindingSearch,setBindingSearch]=useState(""),[bindingDrawerOpen,setBindingDrawerOpen]=useState(false);
  const [loading,setLoading]=useState(true),[catalogLoading,setCatalogLoading]=useState(true),[saving,setSaving]=useState(false),[bindingLoading,setBindingLoading]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [activeTab,setActiveTab]=useState("matrix"),[editDrawerOpen,setEditDrawerOpen]=useState(false);
  const [packContentsOpen,setPackContentsOpen]=useState(false),[packContentsCode,setPackContentsCode]=useState(""),[packContentsRows,setPackContentsRows]=useState([]),[packContentsLoading,setPackContentsLoading]=useState(false);

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
    onActivate: (row) => { setSelectedResourceCode(row?.resource?.resource_code ?? ""); setEditDrawerOpen(true); },
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
  function openEditDrawer(resourceCode){
    setSelectedResourceCode(resourceCode);
    setEditDrawerOpen(true);
  }
  async function openPackContents(code){
    setPackContentsCode(code);
    setPackContentsRows([]);
    setPackContentsOpen(true);
    setPackContentsLoading(true);
    try{const data=await fetchApi(`/api/admin/acl/capability-actions?capability_code=${encodeURIComponent(code)}`); setPackContentsRows(data.permissions??[]);}
    catch(err){console.error("PACK_CONTENTS_LOAD_FAILED",{capability_code:code,message:err?.message??"REQUEST_FAILED"});setError(`Pack contents could not be loaded. ${err.message??"REQUEST_FAILED"}`);}
    finally{setPackContentsLoading(false);}
  }
  async function removePackRule(capabilityCode,resourceCode){
    const ok=await openActionConfirm({eyebrow:"Pack Contents",title:"Remove Resource Rule",message:`${resourceCode} er rule ta ${capabilityCode} pack theke remove korte chao?`,confirmLabel:"Remove",cancelLabel:"Cancel"});
    if(!ok) return;
    setSaving(true); setError(""); setNotice("");
    try{
      await fetchApi("/api/admin/acl/capability-actions/disable",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({capability_code:capabilityCode,resource_code:resourceCode})});
      const data=await fetchApi(`/api/admin/acl/capability-actions?capability_code=${encodeURIComponent(capabilityCode)}`);
      setPackContentsRows(data.permissions??[]);
      if(capabilityCode===capCode) await loadCapRows(capabilityCode);
      setNotice(`${resourceCode} rule removed from ${capabilityCode}.`);
    }catch(err){console.error("PACK_RULE_REMOVE_FAILED",{capability_code:capabilityCode,resource_code:resourceCode,message:err?.message??"REQUEST_FAILED"});setError(`Rule could not be removed. ${err.message??"REQUEST_FAILED"}`);}
    finally{setSaving(false);}
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
        {key:"work-context-master",label:"Work Contexts",tone:"neutral",buttonRef:(el)=>{topRefs.current[1]=el;},onClick:()=>{openScreen("SA_WORK_CONTEXT_MASTER",{mode:"replace"});navigate("/sa/work-contexts");},onKeyDown:(e)=>handleLinearNavigation(e,{index:1,refs:topRefs.current,orientation:"horizontal"})},
        {key:"acl-version-center",label:"ACL Version Center",tone:"neutral",buttonRef:(el)=>{topRefs.current[2]=el;},onClick:()=>{openScreen("SA_ACL_VERSION_CENTER",{mode:"replace"});navigate("/sa/acl/version-center");},onKeyDown:(e)=>handleLinearNavigation(e,{index:2,refs:topRefs.current,orientation:"horizontal"})},
      ]}
      notices={[...(error?[{key:"error",tone:"error",message:error}]:[]),...(notice?[{key:"notice",tone:"success",message:notice}]:[])]}
      footerHints={["↑↓ Navigate", "Enter Edit", "F8 Refresh", "Ctrl+S Save Matrix", "Alt+Shift+F Search", "Esc Back"]}
    >
      {/* ── Tab Bar ─────────────────────────────────────────────── */}
      <div className="mb-[var(--erp-section-gap)] flex border-b border-slate-300">
        {Object.entries(TAB_LABELS).map(([key,label])=>(
          <button
            key={key}
            type="button"
            onClick={()=>setActiveTab(key)}
            className={`-mb-px border-b-2 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${activeTab===key?"border-sky-600 text-sky-700":"border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TAB 1 — CAPABILITY MATRIX
      ═══════════════════════════════════════════════════════════ */}
      {activeTab==="matrix"&&(
        <div className="grid gap-[var(--erp-section-gap)]">

          {/* Compact filter bar */}
          <div className="grid grid-cols-[1fr_140px_160px_1fr_auto_auto] items-end gap-2 border border-slate-300 bg-white p-3">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Pack</div>
              <ErpComboboxField
                value={capCode}
                onChange={(val)=>setCapCode(val)}
                options={caps.map((cap)=>({value:cap.capability_code,label:`${cap.capability_code} | ${cap.capability_name}`}))}
                blankLabel={caps.length===0?"No packs yet":"Choose pack"}
                inputClassName="px-2 py-[7px] text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Project</div>
              <ErpComboboxField
                value={projectCode}
                onChange={(val)=>setProjectCode(val)}
                options={projectOptions.map((code)=>({value:code,label:code}))}
                blankLabel="All"
                inputClassName="px-2 py-[7px] text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Module</div>
              <ErpComboboxField
                value={moduleCode}
                onChange={(val)=>setModuleCode(val)}
                options={moduleOptions.map((code)=>({value:code,label:code}))}
                blankLabel="Choose module"
                inputClassName="px-2 py-[7px] text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Search</div>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e)=>setSearch(e.target.value)}
                placeholder="Filter resources..."
                className="w-full border border-slate-300 bg-white px-2 py-[7px] text-sm text-slate-900 outline-none"
              />
            </div>
            <button
              type="button"
              disabled={saving||!moduleCode||!capCode}
              onClick={()=>void saveMatrix()}
              className="self-end border border-sky-300 bg-sky-50 px-4 py-[7px] text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-900 disabled:opacity-40"
            >
              Save Matrix
            </button>
            <button
              type="button"
              disabled={loading||catalogLoading}
              onClick={()=>{void loadBootstrap(); void loadCatalog();}}
              className="self-end border border-slate-300 bg-white px-3 py-[7px] text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600 disabled:opacity-40"
            >
              Refresh
            </button>
          </div>

          {/* Pack summary strip */}
          {capCode&&(
            <div className="flex flex-wrap items-center gap-4 border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-[11px] font-semibold text-slate-700">{capCode}</span>
              <span className="text-[11px] text-slate-500">{caps.find(c=>c.capability_code===capCode)?.capability_name??""}</span>
              <span className="ml-auto flex gap-4 text-[11px] text-slate-500">
                <span><span className="font-semibold text-slate-800">{capRows.length}</span> saved rows</span>
                <span><span className="font-semibold text-slate-800">{bindingLoading?"…":attachedContextCount}</span> attached contexts</span>
              </span>
            </div>
          )}

          {/* Resource grid */}
          <div className="border border-slate-300 bg-white">
            {!moduleCode?(
              <div className="px-4 py-6 text-center text-sm text-slate-400">
                Project select korar por exact module choose koro — tarpor oi module-er sob resources dekhabe.
              </div>
            ):catalogLoading?(
              <div className="px-4 py-6 text-center text-sm text-slate-400">Loading resources…</div>
            ):rows.length===0?(
              <div className="px-4 py-6 text-center text-sm text-slate-400">Selected project / module-er niche kono mapped resource paoa jayni.</div>
            ):(
              <ErpDenseGrid
                columns={[
                  {
                    key:"resource",
                    label:"Resource",
                    render:({resource})=>(
                      <div>
                        <div className="font-semibold text-slate-900">{resource.title}</div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-400">{resource.resource_code}</div>
                      </div>
                    ),
                  },
                  {
                    key:"allow",
                    label:"Allow",
                    render:({resource,draft})=>{
                      const available=new Set(resource.available_actions??[]);
                      const enabled=ACTIONS.filter(([ac,key])=>available.has(ac)&&Boolean(draft[key])).map(([,,label])=>label);
                      return enabled.length?(
                        <div className="flex flex-wrap gap-1">
                          {enabled.map((l)=>(
                            <span key={l} className="border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">{l}</span>
                          ))}
                        </div>
                      ):<span className="text-xs text-slate-300">—</span>;
                    },
                  },
                  {
                    key:"deny",
                    label:"Deny",
                    render:({draft})=>draft.denied_actions.length>0?(
                      <div className="flex flex-wrap gap-1">
                        {draft.denied_actions.map((a)=>(
                          <span key={a} className="border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800">{a}</span>
                        ))}
                      </div>
                    ):null,
                  },
                  {
                    key:"edit",
                    label:"",
                    render:({resource})=>(
                      <button
                        type="button"
                        onClick={(e)=>{e.stopPropagation(); openEditDrawer(resource.resource_code);}}
                        className="border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500 hover:bg-slate-50"
                      >
                        Edit →
                      </button>
                    ),
                  },
                ]}
                rows={rows}
                rowKey={(row)=>row.resource.resource_code}
                getRowProps={(row,index)=>({
                  ...getRowProps(index),
                  onClick:()=>openEditDrawer(row.resource.resource_code),
                  className:row.resource.resource_code===selectedResourceCode?"bg-sky-50":"",
                })}
                onRowActivate={(row)=>openEditDrawer(row.resource.resource_code)}
                maxHeight="none"
              />
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB 2 — WORK AREA BINDINGS
      ═══════════════════════════════════════════════════════════ */}
      {activeTab==="bindings"&&(
        <div className="grid gap-[var(--erp-section-gap)]">

          {/* Compact header */}
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 border border-slate-300 bg-white p-3">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Company</div>
              <ErpComboboxField
                value={companyId}
                onChange={(val)=>setCompanyId(val)}
                options={companies.map((c)=>({value:c.id,label:formatCompanyLabel(c)}))}
                blankLabel="Choose company"
                inputClassName="px-2 py-[7px] text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Search Contexts</div>
              <input
                type="text"
                value={contextSearch}
                onChange={(e)=>setContextSearch(e.target.value)}
                placeholder="Search by code, department, company…"
                className="w-full border border-slate-300 bg-white px-2 py-[7px] text-sm text-slate-900 outline-none"
              />
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={()=>void loadBootstrap()}
              className="self-end border border-slate-300 bg-white px-3 py-[7px] text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600 disabled:opacity-40"
            >
              Refresh
            </button>
          </div>

          {/* Hint */}
          <div className="border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            Click any row to open its pack binding drawer. Attach or remove capability packs for that work context.
          </div>

          {/* Context list */}
          <div className="border border-slate-300 bg-white">
            {loading?(
              <div className="px-4 py-6 text-center text-sm text-slate-400">Loading…</div>
            ):contexts.length===0?(
              <div className="px-4 py-6 text-center text-sm text-slate-400">No work contexts found for this company. Company and department setup first complete koro.</div>
            ):filteredContexts.length===0?(
              <div className="px-4 py-6 text-center text-sm text-slate-400">Current search-e kono context match koreni.</div>
            ):filteredContexts.map((row,i)=>{
              const attachedCodes=contextCapabilityMap[row.work_context_id]??[];
              const contextType=classifyContext(row);
              const recommendedCodes=recommendedCapabilityCodes(row);
              return (
                <button
                  key={row.work_context_id}
                  type="button"
                  onClick={()=>openBindingDrawer(row)}
                  {...getContextRowProps(i)}
                  className={`grid w-full grid-cols-[minmax(0,1.8fr)_100px_minmax(0,1fr)_60px] items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 ${ctxId===row.work_context_id?"border-sky-200 bg-sky-50":"border-slate-200 bg-white hover:bg-slate-50"}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{row.work_context_code}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{row.work_context_name}</div>
                    {row.department_code&&<div className="mt-0.5 text-[10px] text-slate-400">{row.department_code} | {row.department_name}</div>}
                  </div>
                  <div className="text-[11px]">
                    <span className={`border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${contextType==="GENERAL"?"border-violet-200 bg-violet-50 text-violet-800":contextType==="DEPARTMENT"?"border-sky-200 bg-sky-50 text-sky-800":"border-slate-200 bg-slate-50 text-slate-600"}`}>
                      {contextType==="GENERAL"?"General":contextType==="DEPARTMENT"?"Dept":"Manual"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    {attachedCodes.length===0?(
                      <span className="text-[11px] text-slate-400">No packs attached</span>
                    ):(
                      <div className="flex flex-wrap gap-1">
                        {attachedCodes.map((code)=>(
                          <span key={code} className="border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">{code}</span>
                        ))}
                      </div>
                    )}
                    {recommendedCodes.length>0&&!recommendedCodes.every(c=>attachedCodes.includes(c))&&(
                      <div className="mt-1 text-[10px] text-amber-600">Suggested: {recommendedCodes.filter(c=>!attachedCodes.includes(c)).join(", ")}</div>
                    )}
                  </div>
                  <div className="text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-sky-600">Manage →</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB 3 — PACK DEFINITIONS
      ═══════════════════════════════════════════════════════════ */}
      {activeTab==="packs"&&(
        <div className="grid gap-[var(--erp-section-gap)]">

          {/* Create form — single compact row */}
          <div className="border border-slate-300 bg-white p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Create New Pack</div>
            <div className="grid grid-cols-[180px_1fr_2fr_auto] items-end gap-2">
              <div>
                <div className="mb-1 text-[10px] text-slate-400">Code <span className="text-rose-500">*</span></div>
                <input
                  type="text"
                  value={capDraft.capability_code}
                  onChange={(e)=>setCapDraft((c)=>({...c,capability_code:e.target.value.toUpperCase()}))}
                  placeholder="CAP_HR_..."
                  className="w-full border border-slate-300 bg-white px-2 py-[7px] text-sm text-slate-900 outline-none"
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] text-slate-400">Name <span className="text-rose-500">*</span></div>
                <input
                  type="text"
                  value={capDraft.capability_name}
                  onChange={(e)=>setCapDraft((c)=>({...c,capability_name:e.target.value}))}
                  placeholder="Pack display name"
                  className="w-full border border-slate-300 bg-white px-2 py-[7px] text-sm text-slate-900 outline-none"
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] text-slate-400">Description</div>
                <input
                  type="text"
                  value={capDraft.description}
                  onChange={(e)=>setCapDraft((c)=>({...c,description:e.target.value}))}
                  placeholder="Optional description"
                  className="w-full border border-slate-300 bg-white px-2 py-[7px] text-sm text-slate-900 outline-none"
                />
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={()=>void saveCap()}
                className="border border-sky-300 bg-sky-50 px-4 py-[7px] text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-900 disabled:opacity-40"
              >
                Save Pack
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Presets:</span>
              {PRESET_CAPS.map((p)=>(
                <button
                  key={p.capability_code}
                  type="button"
                  disabled={saving}
                  onClick={()=>setCapDraft(p)}
                  className="border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600 hover:bg-white"
                >
                  {p.capability_code.replace("CAP_HR_","")}
                </button>
              ))}
            </div>
          </div>

          {/* Pack list */}
          <div className="border border-slate-300 bg-white">
            {caps.length===0?(
              <div className="px-4 py-6 text-center text-sm text-slate-400">No capability packs created yet. Use the form above to create the first one.</div>
            ):caps.map((cap)=>{
              const ctxCount=Object.values(contextCapabilityMap).filter((codes)=>Array.isArray(codes)&&codes.includes(cap.capability_code)).length;
              const isCurrent=capCode===cap.capability_code;
              return (
                <div key={cap.capability_code} className={`grid grid-cols-[minmax(0,1fr)_80px_80px_120px] items-center gap-3 border-b px-3 py-2.5 last:border-b-0 ${isCurrent?"bg-sky-50":"bg-white"}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{cap.capability_code}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{cap.capability_name}</div>
                    {cap.description&&<div className="mt-0.5 text-[11px] text-slate-400">{cap.description}</div>}
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Contexts</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-700">{bindingLoading?"…":ctxCount}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Resources</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-700">{isCurrent?capRows.length:"—"}</div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={()=>void openPackContents(cap.capability_code)}
                      className="border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600 hover:bg-slate-50"
                    >
                      View Contents
                    </button>
                    <button
                      type="button"
                      onClick={()=>{setCapCode(cap.capability_code); setActiveTab("matrix");}}
                      className="border border-sky-200 bg-sky-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-sky-700 hover:bg-sky-100"
                    >
                      Edit Matrix →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ACL Publish shortcut */}
          <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-slate-50 px-3 py-2.5">
            <span className="text-[11px] text-slate-500">Packs configure kora hole ACL Version Center theke publish koro — sob companies-er jonno fresh snapshot lagbe.</span>
            <div className="flex gap-2">
              <button type="button" onClick={()=>{openScreen("SA_ACL_VERSION_CENTER",{mode:"replace"});navigate("/sa/acl/version-center");}} className="border border-sky-300 bg-sky-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-900">ACL Version Center</button>
              <button type="button" onClick={()=>{openScreen("SA_WORK_CONTEXT_MASTER",{mode:"replace"});navigate("/sa/work-contexts");}} className="border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600">Work Context Master</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          DRAWER — Resource Allow / Deny Editor
      ═══════════════════════════════════════════════════════════ */}
      <DrawerBase
        visible={editDrawerOpen}
        title={selectedRow?.resource?.title??"Edit Resource Rule"}
        onEscape={()=>setEditDrawerOpen(false)}
        width="min(400px, calc(100vw - 24px))"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={()=>void clearSelected()}
              className="border border-rose-300 bg-rose-50 px-2 py-[3px] text-[11px] font-semibold uppercase tracking-[0.06em] text-rose-700"
            >
              Clear Rule
            </button>
            <button
              type="button"
              onClick={()=>setEditDrawerOpen(false)}
              className="border border-sky-700 bg-sky-100 px-2 py-[3px] text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-950"
            >
              Done
            </button>
          </div>
        }
      >
        {selectedRow?(
          <div className="grid gap-[var(--erp-section-gap)]">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{selectedRow.resource.resource_code}</div>
              <div className="mt-1 text-xs text-slate-500">{[selectedRow.resource.project_code,selectedRow.resource.module_code,selectedRow.resource.route_path].filter(Boolean).join(" | ")}</div>
            </div>
            <div className="border border-slate-300">
              <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] border-b border-slate-300 bg-slate-50 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <span>Action</span>
                <span className="text-center">Allow</span>
                <span className="text-center">Deny</span>
              </div>
              {ACTIONS.map(([actionCode,key,label])=>{
                const available=new Set(selectedRow.resource.available_actions??[]);
                const isAvailable=available.has(actionCode);
                return (
                  <div key={`policy-${actionCode}`} className={`grid grid-cols-[minmax(0,1fr)_72px_72px] items-center border-b border-slate-200 px-2 py-[5px] text-[12px] last:border-b-0 ${isAvailable?"text-slate-700":"text-slate-300"}`}>
                    <span>{label}</span>
                    <label className="flex justify-center">
                      <input
                        type="checkbox"
                        disabled={!isAvailable}
                        checked={Boolean(selectedRow.draft[key])}
                        onChange={(e)=>updateAllow(selectedRow.resource.resource_code,key,e.target.checked,actionCode)}
                        className="h-4 w-4 cursor-pointer border-slate-300 bg-white text-emerald-600 disabled:cursor-not-allowed"
                      />
                    </label>
                    <label className="flex justify-center">
                      <input
                        type="checkbox"
                        disabled={!isAvailable}
                        checked={selectedRow.draft.denied_actions.includes(actionCode)}
                        onChange={(e)=>updateDeny(selectedRow.resource.resource_code,actionCode,e.target.checked)}
                        className="h-4 w-4 cursor-pointer border-slate-300 bg-white text-rose-600 disabled:cursor-not-allowed"
                      />
                    </label>
                  </div>
                );
              })}
            </div>
            <div className="text-[11px] text-slate-400">
              Greyed-out actions are not available for this resource. Deny overrides allow for the same action.
            </div>
            <div className="border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Pack: {capCode||"—"}</div>
              <div className="text-[11px] text-slate-600">
                Changes are staged locally. Click <strong>Save Matrix</strong> in the Matrix tab to persist all changes for the selected module at once.
              </div>
            </div>
          </div>
        ):(
          <div className="text-sm text-slate-400">Select a resource row to edit its allow / deny rules.</div>
        )}
      </DrawerBase>

      {/* ═══════════════════════════════════════════════════════════
          DRAWER — Work Context Pack Binding
      ═══════════════════════════════════════════════════════════ */}
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

            {/* Context metadata */}
            <div className="grid grid-cols-2 gap-3 border border-slate-200 bg-slate-50 px-3 py-2 text-[12px]">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Type</div>
                <div className="mt-0.5 font-semibold text-slate-800">
                  {classifyContext(selectedContext)==="GENERAL"?"General scope":classifyContext(selectedContext)==="DEPARTMENT"?"Department scope":"Manual scope"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Company</div>
                <div className="mt-0.5 text-slate-700">{formatCompanyLabel(selectedContext)}</div>
              </div>
              {selectedContext.department_code&&(
                <div className="col-span-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Department</div>
                  <div className="mt-0.5 text-slate-700">{selectedContext.department_code} | {selectedContext.department_name}</div>
                </div>
              )}
              {recommendedCapabilityCodes(selectedContext).length>0&&(
                <div className="col-span-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Suggested Pack</div>
                  <div className="mt-0.5 font-semibold text-emerald-800">{recommendedCapabilityCodes(selectedContext).join(", ")}</div>
                </div>
              )}
            </div>

            {/* Search */}
            <input
              ref={bindingSearchRef}
              type="text"
              value={bindingSearch}
              onChange={(e)=>setBindingSearch(e.target.value)}
              placeholder="Search capability packs…"
              className="w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
            />

            {/* Pack list */}
            <div className="border border-slate-300 bg-white">
              {filteredBindingCaps.length===0?(
                <div className="px-4 py-3 text-sm text-slate-400">No capability packs match the current search.</div>
              ):filteredBindingCaps.map((cap)=>{
                const attached=ctxCaps.some((item)=>item.capability_code===cap.capability_code);
                const recommended=recommendedCapabilityCodes(selectedContext).includes(cap.capability_code);
                return (
                  <div key={`${selectedContext.work_context_id}-${cap.capability_code}`} className={`flex items-start justify-between gap-3 border-b px-3 py-2.5 last:border-b-0 ${recommended?"bg-emerald-50":"bg-white"}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-900">{cap.capability_code}</span>
                        {recommended&&<span className="border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-900">Suggested</span>}
                        {attached&&<span className="border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-violet-800">Attached</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">{cap.capability_name}</div>
                      {cap.description&&<div className="mt-0.5 text-[11px] text-slate-400">{cap.description}</div>}
                    </div>
                    <button
                      type="button"
                      disabled={saving||bindingLoading}
                      onClick={()=>void toggleCapabilityForContext(selectedContext.work_context_id,cap.capability_code,attached,selectedContext.work_context_code)}
                      className={`shrink-0 border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] disabled:opacity-40 ${attached?"border-rose-300 bg-rose-50 text-rose-700":"border-emerald-300 bg-emerald-50 text-emerald-800"}`}
                    >
                      {attached?"Remove":"Attach"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ):(
          <div className="text-sm text-slate-400">Choose a work context row from the list first.</div>
        )}
      </DrawerBase>

      {/* ═══════════════════════════════════════════════════════════
          DRAWER — Pack Contents (View + Remove rules)
      ═══════════════════════════════════════════════════════════ */}
      <DrawerBase
        visible={packContentsOpen}
        title={packContentsCode?`${packContentsCode} — Contents`:"Pack Contents"}
        onEscape={()=>setPackContentsOpen(false)}
        width="min(560px, calc(100vw - 24px))"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={()=>{setCapCode(packContentsCode); setActiveTab("matrix"); setPackContentsOpen(false);}}
              className="border border-sky-300 bg-sky-50 px-2 py-[3px] text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-900"
            >
              Edit Matrix →
            </button>
            <button
              type="button"
              onClick={()=>setPackContentsOpen(false)}
              className="border border-sky-700 bg-sky-100 px-2 py-[3px] text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-950"
            >
              Done
            </button>
          </div>
        }
      >
        <div className="grid gap-[var(--erp-section-gap)]">
          <div className="flex items-center justify-between gap-3 border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            <span>এই pack এ currently যা যা resource rule save আছে। Remove করলে সাথে সাথে delete হবে।</span>
            <span className="font-semibold text-slate-700">{packContentsLoading?"…":`${packContentsRows.length} rules`}</span>
          </div>

          {packContentsLoading?(
            <div className="px-4 py-6 text-center text-sm text-slate-400">Loading pack contents…</div>
          ):packContentsRows.length===0?(
            <div className="border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
              এই pack এ এখনো কোনো resource rule নেই।
            </div>
          ):(
            <div className="border border-slate-300 bg-white">
              {/* Header */}
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px] border-b border-slate-200 bg-slate-50 px-3 py-[5px] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <span>Resource</span>
                <span>Allow / Deny</span>
                <span></span>
              </div>
              {packContentsRows.map((row)=>{
                const allowLabels=ACTIONS.filter(([,key])=>Boolean(row[key])).map(([,,label])=>label);
                const denyLabels=Array.isArray(row.denied_actions)?row.denied_actions:[];
                return (
                  <div key={row.resource_code} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px] items-center gap-2 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-slate-800 truncate">{row.resource_code}</div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {allowLabels.map((l)=>(
                        <span key={`allow-${l}`} className="border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">{l}</span>
                      ))}
                      {denyLabels.map((a)=>(
                        <span key={`deny-${a}`} className="border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">✕ {a}</span>
                      ))}
                      {allowLabels.length===0&&denyLabels.length===0&&(
                        <span className="text-[11px] text-slate-400">No flags</span>
                      )}
                    </div>
                    <div className="text-right">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={()=>void removePackRule(packContentsCode,row.resource_code)}
                        className="border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-rose-700 hover:bg-rose-100 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
