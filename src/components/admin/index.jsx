import { useState, useEffect, useRef } from "react";
import { DEFAULT_ANNOUNCEMENTS, DEFAULT_CLASSES, DEFAULT_DRUGS, DEFAULT_LABS, DEFAULT_PQ, DEFAULT_SKILLS, initData } from "../../data/defaults";
import { _DOC_ESSAYS, _DOC_SHARED, _db, _getDoc, _loadFirebase, _setDocField, _userPrivateKey, dispatchSync, mockChunkSave, rrSave, rrSubscribeAll, saveFoldersToBackend, saveManualGradeToBackend, saveMyData, saveShared, useSharedData } from "../../services/backend";
import { ls, lsSet } from "../../utils/storage";
import { Handouts } from "../../components/academics";
import { Notifications } from "../../components/messaging";
import { Dashboard } from "../../components/student";
import { _h } from "../../shared/deviceFingerprint";
import { NC_PAPER_TYPES, NC_YEARS, NURSING_EXAM_META, emptyOsce, getYearData, isPaperArchived, setYearPaperData } from "../../shared/ncExamData";
import { RR_STATUSES } from "../../shared/researchStatuses";
import { robustParseQuestions } from "../../utils/examParsing";

export function AdminPanel({ toast, currentUser }) {
  const [tab, setTab] = useState("overview");

  const TABS = [
    { key:"overview", label:"📊 Overview" },
    { key:"users", label:"👥 Users" },
    { key:"classes", label:"🏫 Classes" },
    { key:"drugs", label:"💊 Drugs" },
    { key:"labs", label:"🧪 Labs" },
    { key:"schoolpq", label:"🏫 School Past Questions" },
    { key:"nursingexams", label:"🎓 Nursing Exams" },
    { key:"skills", label:"✅ Skills" },
    { key:"announcements", label:"📢 Announcements" },
    { key:"handouts", label:"📄 Handouts" },
    { key:"retakes", label:"🔄 Exam Retakes" },
    { key:"nccodes", label:"🔑 NC Access Codes" },
    { key:"payments", label:"💰 Payment Dashboard" },
    { key:"pushnotifs", label:"📢 Push Notifications" },
    { key:"researchreqs", label:"📜 Research Requests" },
  ];

  return (
    <div>
      <div className="admin-header">
        <div className="admin-header-icon">🛡️</div>
        <div>
          <div className="admin-header-title">Admin Control Panel</div>
          <div className="admin-header-sub">Logged in as <b style={{color:"var(--purple)"}}>{currentUser}</b> • Full system access</div>
        </div>
      </div>
      <div className="admin-tabs">
        {TABS.map(t=><div key={t.key} className={`admin-tab${tab===t.key?" active":""}`} onClick={()=>setTab(t.key)}>{t.label}</div>)}
      </div>
      {tab==="overview" && <AdminOverview toast={toast} />}
      {tab==="users" && <AdminUsers toast={toast} currentUser={currentUser} />}
      {tab==="classes" && <AdminClasses toast={toast} />}
      {tab==="drugs" && <AdminDrugs toast={toast} />}
      {tab==="labs" && <AdminLabs toast={toast} />}
      {tab==="schoolpq" && <AdminSchoolPQ toast={toast} />}
      {tab==="nursingexams" && <AdminNursingExams toast={toast} />}
      {tab==="skills" && <AdminSkills toast={toast} />}
      {tab==="announcements" && <AdminAnnouncements toast={toast} />}
      {tab==="handouts" && <AdminHandouts toast={toast} />}
      {tab==="retakes" && <AdminExamRetakes toast={toast} />}
      {tab==="nccodes" && <AdminNcCodes toast={toast} />}
      {tab==="payments" && <AdminPaymentDashboard toast={toast} />}
      {tab==="pushnotifs" && <AdminPushNotifications toast={toast} />}
      {tab==="researchreqs" && <AdminResearchRequests toast={toast} />}
    </div>
  );
}

// ── Admin Overview ───────────────────────────────────────────────────

export function AdminOverview({ toast }) {
  const [users] = useSharedData("nv-users", []);
  const [drugs] = useSharedData("nv-drugs", []);
  const [labs] = useSharedData("nv-labs", []);
  const [pq] = useSharedData("nv-pq", []);
  const [skills] = useSharedData("nv-skillsdb", []);
  const [classes] = useSharedData("nv-classes", []);
  const [handouts] = useSharedData("nv-handouts", []);
  const [announcements] = useSharedData("nv-announcements", []);

  const stats = [
    {lbl:"Users",val:users.length,icon:"👥",color:"var(--accent)"},
    {lbl:"Classes",val:classes.length,icon:"🏫",color:"var(--accent2)"},
    {lbl:"Drugs",val:drugs.length,icon:"💊",color:"var(--warn)"},
    {lbl:"Lab Tests",val:labs.length,icon:"🧪",color:"var(--success)"},
    {lbl:"Question Banks",val:pq.length,icon:"❓",color:"var(--purple)"},
    {lbl:"Skills",val:skills.length,icon:"✅",color:"var(--success)"},
    {lbl:"Handouts",val:handouts.length,icon:"📄",color:"var(--warn)"},
    {lbl:"Announcements",val:announcements.length,icon:"📢",color:"var(--purple)"},
  ];

  const exportAll = () => {
    const data = { users, classes, drugs, labs, pq, skills, handouts, announcements, exported: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "nursing-academic-hub-backup.json"; a.click();
    toast("Backup exported!", "success");
  };

  const importAll = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.classes) saveShared("classes", data.classes);
        if (data.drugs) saveShared("drugs", data.drugs);
        if (data.labs) saveShared("labs", data.labs);
        if (data.pq) saveShared("pq", data.pq);
        if (data.skills) saveShared("skills", data.skills);
        if (data.announcements) saveShared("announcements", data.announcements);
        toast("Backup restored! Refresh to see changes.", "success");
      } catch { toast("Invalid backup file", "error"); }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="grid5" style={{marginBottom:20}}>
        {stats.map((s,i)=>(
          <div key={s.lbl} className="stat-card" style={{animationDelay:`${i*.04}s`}}>
            <div style={{fontSize:22,marginBottom:6}}>{s.icon}</div>
            <div className="stat-val" style={{color:s.color,fontSize:24}}>{s.val}</div>
            <div className="stat-lbl" style={{marginTop:4}}>{s.lbl}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{marginBottom:16}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:14}}>💾 Backup & Restore</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button className="btn btn-accent" onClick={exportAll}>⬇️ Export Backup (JSON)</button>
          <label className="btn btn-warn" style={{cursor:"pointer"}}>
            ⬆️ Import Backup
            <input type="file" accept=".json" style={{display:"none"}} onChange={importAll} />
          </label>
          <button className="btn btn-danger" onClick={()=>{if(confirm("Reset ALL data to defaults? This cannot be undone!")){["nv-classes","nv-drugs","nv-labs","nv-pq","nv-skillsdb","nv-announcements","nv-handouts"].forEach(k=>{try{localStorage.removeItem(k);}catch{}});initData();toast("Data reset to defaults","warn");}}}>🔄 Reset to Defaults</button>
        </div>
      </div>
      <div className="card">
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:14}}>👥 Recent Users</div>
        {users.slice(-5).reverse().map(u=>(
          <div key={u.username} className="user-row">
            <div className="user-av">{u.username[0].toUpperCase()}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:14}}>{u.username}</div>
              <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{u.class||"No class"} • Joined {u.joined}</div>
            </div>
            <span className={`tag ${u.role==="admin"?"tag-purple":u.role==="lecturer"?"tag-warn":"tag-accent"}`}>{u.role||"student"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Admin Users ──────────────────────────────────────────────────────

export function AdminUsers({ toast, currentUser }) {
  const [users, setUsers] = useSharedData("nv-users", []);
  const [edit, setEdit] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({username:"",password:"",role:"student",class:"",displayName:"",matricNumber:"",isPublicHealth:false});
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [search, setSearch] = useState("");
  const [showPw, setShowPw] = useState({});
  const [viewUser, setViewUser] = useState(null);

  // Determine if logged-in admin is super-admin or sub-admin
  const me = users.find(u => u.username === currentUser);
  const isSuperAdmin = me?.role === "admin";
  const isSubAdmin   = me?.role === "sub-admin";
  // A "protected" account is any super-admin — sub-admin cannot touch these
  const isProtected = (u) => u?.role === "admin";

  const save = () => {
    if (!form.username||!form.password) return toast("Email & password required","error");
    if (!edit && users.find(u=>u.username===form.username)) return toast("Email already registered","error");
    if (isSubAdmin && form.role === "admin") return toast("You cannot assign the Admin role","error");
    if (isSubAdmin && edit && isProtected(users.find(u=>u.username===edit))) return toast("You cannot edit a Super Admin account","error");
    let u;
    const entry = {...form, displayName: form.displayName||form.username.split("@")[0]};
    if (edit) { u = users.map(x=>x.username===edit?{...x,...entry}:x); toast("User profile updated ✅","success"); }
    else { u = [...users,{...entry,joined:new Date().toLocaleDateString()}]; toast("User added ✅","success"); }
    setUsers(u); saveShared("users",u); setEdit(null); setShowAdd(false);
    setForm({username:"",password:"",role:"student",class:"",displayName:"",matricNumber:"",isPublicHealth:false});
  };

  const del = (username) => {
    if (username==="admin@gmail.com") return toast("Cannot delete the main admin account","error");
    const target = users.find(u=>u.username===username);
    if (isSubAdmin && isProtected(target)) return toast("You cannot delete a Super Admin account","error");
    if (!confirm(`Permanently delete "${username}"? This cannot be undone.`)) return;
    const u = users.filter(x=>x.username!==username);
    setUsers(u); saveShared("users",u); toast("User deleted","success");
    if (viewUser?.username===username) setViewUser(null);
  };

  const roleColor = (r) => r==="admin"||r==="sub-admin"?"tag-purple":r==="lecturer"?"tag-warn":"tag-accent";
  const filtered = users.filter(u=>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.displayName||"").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div className="sec-title">👥 Users ({users.length})</div>
          <div style={{fontSize:12,color:"var(--text3)"}}>Manage all registered accounts</div>
        </div>
        <button className="btn btn-purple" onClick={()=>{setShowAdd(true);setEdit(null);setForm({username:"",password:"",role:"student",class:"",displayName:"",matricNumber:"",isPublicHealth:false});}}>+ Add User</button>
      </div>

      <div className="search-wrap" style={{marginBottom:14}}>
        <span className="search-ico">🔍</span>
        <input placeholder="Search by email or display name..." value={search} onChange={e=>setSearch(e.target.value)} />
        {search&&<span style={{cursor:"pointer",color:"var(--text3)",fontSize:16,marginRight:4}} onClick={()=>setSearch("")}>✕</span>}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.map(u=>{
          const protected_ = isProtected(u);
          const canAct = isSuperAdmin || !protected_;
          return (
            <div key={u.username} className="card" style={{padding:"12px 16px",borderLeft:`3px solid ${u.role==="admin"||u.role==="sub-admin"?"var(--purple)":u.role==="lecturer"?"var(--warn)":"var(--accent)"}`}}>
              <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <div className="user-av" style={{flexShrink:0}}>{(u.displayName||u.username)[0].toUpperCase()}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:2}}>{u.displayName||u.username.split("@")[0]}</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginBottom:3}}>
                    📧 {isSubAdmin && protected_ ? "🔒 Hidden" : u.username}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span className={`tag ${roleColor(u.role||"student")}`}>{u.role||"student"}</span>
                    {u.class&&<span style={{fontSize:11,color:"var(--accent2)"}}>🏫 {classes.find(c=>c.id===u.class)?.label||u.class}</span>}
                    {u.isPublicHealth&&<span style={{fontSize:11,background:"rgba(46,125,50,.15)",color:"#2e7d32",borderRadius:8,padding:"1px 7px",fontWeight:700}}>🌍 PHN</span>}
                    <span style={{fontSize:11,color:"var(--text3)"}}>📅 {u.joined||"—"}</span>
                  </div>
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  {canAct && <button className="btn btn-sm btn-accent" onClick={()=>setViewUser(u)}>👁 View</button>}
                  {canAct && <button className="btn btn-sm" onClick={()=>{
                    setEdit(u.username);
                    setForm({username:u.username,password:u.password,role:u.role||"student",class:u.class||"",displayName:u.displayName||"",matricNumber:u.matricNumber||"",isPublicHealth:!!u.isPublicHealth});
                    setShowAdd(true);
                  }}>✏️ Edit</button>}
                  {canAct && <button
                    className="btn btn-sm"
                    title={u.isPublicHealth ? "Remove PHN status" : "Mark as Public Health Nursing student"}
                    style={{background:u.isPublicHealth?"rgba(46,125,50,.15)":"transparent",color:"#2e7d32",border:"1px solid #2e7d32",fontWeight:700}}
                    onClick={()=>{
                      const updated = users.map(x=>x.username===u.username?{...x,isPublicHealth:!x.isPublicHealth,class:!x.isPublicHealth?"publichealth":(x.class==="publichealth"?"":x.class)}:x);
                      setUsers(updated); saveShared("users",updated);
                      toast(u.isPublicHealth?"PHN status removed":"✅ Marked as PHN student","success");
                    }}>
                    {u.isPublicHealth?"🌍 Un-PHN":"🌍 PHN"}
                  </button>}
                  {canAct && <button className="btn btn-sm btn-danger" onClick={()=>del(u.username)}>🗑️</button>}
                  {!canAct && <span style={{fontSize:11,color:"var(--text3)",fontStyle:"italic",padding:"4px 8px"}}>🔒 Protected</span>}
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length===0&&<div style={{textAlign:"center",padding:"40px",color:"var(--text3)",fontSize:13}}>No users found.</div>}
      </div>

      {/* View User Profile Modal */}
      {viewUser&&(
        <div className="modal-overlay" onClick={()=>setViewUser(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">👁 User Profile</div>
              <button className="modal-close" onClick={()=>setViewUser(null)}>✕</button>
            </div>
            <div style={{textAlign:"center",marginBottom:16}}>
              <div className="user-av" style={{width:56,height:56,fontSize:26,margin:"0 auto 8px"}}>{(viewUser.displayName||viewUser.username)[0].toUpperCase()}</div>
              <div style={{fontWeight:800,fontSize:18}}>{viewUser.displayName||viewUser.username.split("@")[0]}</div>
              <span className={`tag ${roleColor(viewUser.role||"student")}`} style={{marginTop:4,display:"inline-block"}}>{viewUser.role||"student"}</span>
            </div>
            <div style={{background:"var(--bg4)",borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
              {[
                {lbl:"📧 Email / Username", val: isSubAdmin && isProtected(viewUser) ? "🔒 Hidden" : viewUser.username},
                {lbl:"🔑 Password", val: (isSuperAdmin && showPw[viewUser.username]) ? viewUser.password : "🔒 Hidden",
                  ...(isSuperAdmin ? {action:()=>setShowPw(p=>({...p,[viewUser.username]:!p[viewUser.username]})), actionLabel:showPw[viewUser.username]?"🙈 Hide":"👁 Show"} : {})},
                {lbl:"👤 Display Name", val: viewUser.displayName||viewUser.username.split("@")[0]},
                {lbl:"🎓 Matric No.", val: viewUser.matricNumber||"—"},
                {lbl:"🏫 Class", val: classes.find(c=>c.id===viewUser.class)?.label||"No class assigned"},
                {lbl:"🌍 PHN Status", val: viewUser.isPublicHealth ? "✅ Public Health Nursing Student" : "Not a PHN student"},
                {lbl:"📅 Joined", val: viewUser.joined||"Unknown"},
              ].map(row=>(
                <div key={row.lbl} style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid var(--border)",paddingBottom:8}}>
                  <div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>{row.lbl}</div>
                    <div style={{fontWeight:600,fontSize:13,fontFamily:row.lbl.includes("Password")?"'DM Mono',monospace":"inherit"}}>{row.val}</div>
                  </div>
                  {row.action&&<button className="btn btn-sm" onClick={row.action}>{row.actionLabel}</button>}
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,marginTop:14}}>
              {(isSuperAdmin || !isProtected(viewUser)) && <>
                <button className="btn btn-accent" style={{flex:1}} onClick={()=>{
                  setEdit(viewUser.username);
                  setForm({username:viewUser.username,password:viewUser.password,role:viewUser.role||"student",class:viewUser.class||"",displayName:viewUser.displayName||"",matricNumber:viewUser.matricNumber||"",isPublicHealth:!!viewUser.isPublicHealth});
                  setShowAdd(true); setViewUser(null);
                }}>✏️ Edit Profile</button>
                <button className="btn btn-danger" onClick={()=>del(viewUser.username)}>🗑️ Delete</button>
              </>}
              <button className="btn" onClick={()=>setViewUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {showAdd&&(
        <div className="modal-overlay" onClick={()=>setShowAdd(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">{edit?"✏️ Edit User":"➕ Add User"}</div>
              <button className="modal-close" onClick={()=>setShowAdd(false)}>✕</button>
            </div>
            <label className="lbl">📧 Email (Username)</label>
            <input className="inp" type="email" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} disabled={!!edit} placeholder="user@email.com" />
            <label className="lbl">🔑 Password</label>
            <div className="inp-wrap">
              <input className="inp" type={showPw["modal"]?"text":"password"} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Enter password" />
              <button className="inp-eye" onClick={()=>setShowPw(p=>({...p,modal:!p.modal}))}>{showPw["modal"]?"🙈":"👁"}</button>
            </div>
            <label className="lbl">👤 Display Name</label>
            <input className="inp" value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})} placeholder="e.g. Dr. Adeyemi or John Doe" />
            <label className="lbl">🎓 Matric Number</label>
            <input className="inp" value={form.matricNumber||""} onChange={e=>setForm({...form,matricNumber:e.target.value.toUpperCase()})} placeholder="e.g. NRS/2021/001 (students only)" />
            <label className="lbl">🎭 Role</label>
            <select className="inp" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
              <option value="student">Student</option>
              <option value="lecturer">Lecturer</option>
              <option value="sub-admin">Sub Admin</option>
              {isSuperAdmin && <option value="admin">Admin</option>}
            </select>
            <label className="lbl">🏫 Class</label>
            <select className="inp" value={form.class} onChange={e=>setForm({...form,class:e.target.value})}>
              <option value="">— No class —</option>
              {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {/* ── PHN toggle for admin ── */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(46,125,50,.07)",border:"1.5px solid #2e7d32",borderRadius:10,padding:"10px 14px",marginBottom:4}}>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:"#2e7d32"}}>🌍 Public Health Nursing Student</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>Auto-assigns to PHN Forum & sets class to Public Health</div>
              </div>
              <button
                type="button"
                onClick={()=>setForm(f=>({...f,isPublicHealth:!f.isPublicHealth,class:!f.isPublicHealth?"publichealth":(f.class==="publichealth"?"":f.class)}))}
                style={{
                  width:44,height:24,borderRadius:12,border:"none",cursor:"pointer",transition:"all .25s",flexShrink:0,
                  background:form.isPublicHealth?"#2e7d32":"var(--border2)",position:"relative",
                }}>
                <span style={{
                  position:"absolute",top:2,left:form.isPublicHealth?22:2,width:20,height:20,
                  borderRadius:"50%",background:"white",transition:"left .25s",boxShadow:"0 1px 4px rgba(0,0,0,.25)"
                }}/>
              </button>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-purple" style={{flex:1}} onClick={save}>💾 Save</button>
              <button className="btn" onClick={()=>setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Classes ────────────────────────────────────────────────────

export function AdminClasses({ toast }) {
  const [classes, setClasses] = useSharedData("nv-classes", DEFAULT_CLASSES);
  const [edit, setEdit] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState([]);
  const COLORS = ["#3E8E95","#5aada0","#facc15","#a78bfa","#f472b6","#fb923c","#4ade80","#f87171","#60a5fa"];
  const [form, setForm] = useState({id:"",label:"",desc:"",courses:"",color:"#3E8E95"});

  const parsePaste = () => {
    // Supports formats:
    // Line per class: "LABEL | Description | Course1, Course2"
    // Or just names, one per line
    const lines = pasteText.trim().split("\n").filter(l=>l.trim());
    const items = lines.map(line => {
      const parts = line.split("|").map(p=>p.trim());
      if (parts.length>=3) return { label:parts[0], desc:parts[1], courses:parts[2].split(",").map(c=>c.trim()).filter(Boolean) };
      if (parts.length===2) return { label:parts[0], desc:parts[1], courses:[] };
      return { label:parts[0], desc:`${parts[0]} Class`, courses:[] };
    });
    setParsed(items);
  };

  const importParsed = () => {
    const newItems = parsed.map((p,i)=>({
      id:`cls_${Date.now()}_${i}`, label:p.label, desc:p.desc,
      courses:p.courses, color:COLORS[i%COLORS.length]
    }));
    const u = [...classes, ...newItems]; setClasses(u); saveShared("classes",u);
    toast(`${newItems.length} classes imported!`,"success"); setPasteText(""); setParsed([]); setPasteMode(false);
  };

  const save = () => {
    if (!form.label) return toast("Label required","error");
    const courses = form.courses.split(",").map(c=>c.trim()).filter(Boolean);
    if (edit) {
      const u = classes.map(c=>c.id===edit?{...c,...form,courses}:c); setClasses(u); saveShared("classes",u); toast("Updated","success");
    } else {
      const item = {...form, id:`cls_${Date.now()}`, courses}; const u=[...classes,item]; setClasses(u); saveShared("classes",u); toast("Class added","success");
    }
    setShowModal(false); setEdit(null); setForm({id:"",label:"",desc:"",courses:"",color:"#3E8E95"});
  };

  const del = (id) => { if(!confirm("Delete this class?")) return; const u=classes.filter(c=>c.id!==id); setClasses(u); saveShared("classes",u); toast("Deleted","success"); };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">🏫 Classes & Courses ({classes.length})</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste & Import</button>
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm({id:"",label:"",desc:"",courses:"",color:"#3E8E95"});}}>+ Add Class</button>
        </div>
      </div>

      {pasteMode&&(
        <div className="card" style={{marginBottom:18}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:8}}>📋 Paste & Auto-Import Classes</div>
          <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:8}}>Format: <b style={{color:"var(--accent)"}}>LABEL | Description | Course1, Course2, Course3</b><br/>Or just paste class names, one per line.</div>
          <textarea className="paste-box" placeholder={"BNSc 5 | Bachelor of Nursing Science Year Five | Advanced Research, Clinical Leadership, Thesis\nND THREE | National Diploma Year Three | Paediatrics, Community Health\nHND THREE | Higher National Diploma Year Three | Health Policy, Nursing Management"} value={pasteText} onChange={e=>setPasteText(e.target.value)} />
          <div style={{display:"flex",gap:8,marginBottom:parsed.length?10:0}}>
            <button className="btn btn-accent" onClick={parsePaste}>🔍 Parse</button>
            {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length} Classes</button>}
            <button className="btn" onClick={()=>{setPasteMode(false);setParsed([]);setPasteText("");}}>Cancel</button>
          </div>
          {parsed.length>0&&(
            <div className="parse-preview">
              {parsed.map((p,i)=>(
                <div key={i} className="parse-item">
                  <span className="parse-check">✓</span>
                  <b>{p.label}</b> — {p.desc} — <span style={{color:"var(--text3)"}}>{p.courses.length} courses</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid2">
        {classes.map((c,i)=>(
          <div key={c.id} className="card" style={{borderLeft:`3px solid ${c.color}`,animation:`fadeUp .3s ease ${i*.04}s both`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <span style={{display:"inline-block",background:`${c.color}20`,color:c.color,borderRadius:5,padding:"2px 8px",fontSize:10,fontFamily:"'DM Mono',monospace",marginBottom:6}}>{c.label}</span>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{c.label}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{c.desc}</div>
              </div>
              <div style={{display:"flex",gap:5,flexShrink:0}}>
                <button className="btn btn-sm" onClick={()=>{setEdit(c.id);setForm({...c,courses:c.courses.join(", ")});setShowModal(true);}}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={()=>del(c.id)}>🗑️</button>
              </div>
            </div>
            <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{c.courses.length} courses: {c.courses.slice(0,3).join(", ")}{c.courses.length>3?` +${c.courses.length-3} more`:""}</div>
          </div>
        ))}
      </div>

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit?"Edit Class":"Add Class"}</div><button className="modal-close" onClick={()=>setShowModal(false)}>✕</button></div>
            <label className="lbl">Label (e.g. BNSc 5)</label><input className="inp" value={form.label} onChange={e=>setForm({...form,label:e.target.value})} />
            <label className="lbl">Description</label><input className="inp" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})} />
            <label className="lbl">Courses (comma-separated)</label>
            <textarea className="inp" rows={3} style={{resize:"vertical"}} placeholder="Anatomy, Pharmacology, Nursing Theory..." value={form.courses} onChange={e=>setForm({...form,courses:e.target.value})} />
            <label className="lbl">Color</label>
            <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
              {COLORS.map(c=><div key={c} onClick={()=>setForm({...form,color:c})} style={{width:28,height:28,borderRadius:50,background:c,cursor:"pointer",border:form.color===c?"3px solid white":"3px solid transparent",transition:"all .2s"}} />)}
              <input type="color" value={form.color} onChange={e=>setForm({...form,color:e.target.value})} style={{width:28,height:28,border:"none",background:"none",cursor:"pointer",borderRadius:50}} />
            </div>
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={save}>Save</button><button className="btn" onClick={()=>setShowModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Drugs ──────────────────────────────────────────────────────

export function AdminDrugs({ toast }) {
  const [drugs, setDrugs] = useSharedData("nv-drugs", DEFAULT_DRUGS);
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState([]);
  const [search, setSearch] = useState("");
  const blank = {name:"",class:"",dose:"",max:"",uses:"",contraindications:"",side_effects:""};
  const [form, setForm] = useState(blank);

  const parsePaste = () => {
    // Format: DrugName | Class | Dose | MaxDose | Uses | Contraindications | SideEffects
    // Or just names
    const lines = pasteText.trim().split("\n").filter(l=>l.trim());
    const items = lines.map(line=>{
      const p = line.split("|").map(x=>x.trim());
      return { name:p[0]||"", class:p[1]||"", dose:p[2]||"", max:p[3]||"", uses:p[4]||"", contraindications:p[5]||"", side_effects:p[6]||"" };
    });
    setParsed(items);
  };

  const importParsed = () => {
    const items = parsed.map(p=>({...p,id:Date.now()+Math.random()}));
    const u=[...drugs,...items]; setDrugs(u); saveShared("drugs",u);
    toast(`${items.length} drugs imported!`,"success"); setPasteText(""); setParsed([]); setPasteMode(false);
  };

  const save = () => {
    if (!form.name) return toast("Drug name required","error");
    let u;
    if (edit!==null) { u = drugs.map((d,i)=>i===edit?{...form,id:d.id}:d); toast("Updated","success"); }
    else { u = [...drugs,{...form,id:Date.now()}]; toast("Drug added","success"); }
    setDrugs(u); saveShared("drugs",u); setShowModal(false); setEdit(null); setForm(blank);
  };

  const [selDrugs, setSelDrugs] = useState(new Set());
  const del = (id) => { const u=drugs.filter(d=>d.id!==id); setDrugs(u); saveShared("drugs",u); setSelDrugs(s=>{const n=new Set(s);n.delete(id);return n;}); toast("Deleted","success"); };
  const delSel = () => { if(!selDrugs.size)return; const u=drugs.filter(d=>!selDrugs.has(d.id)); setDrugs(u); saveShared("drugs",u); toast(`${selDrugs.size} drug(s) deleted`,"success"); setSelDrugs(new Set()); };
  const filtered = drugs.filter(d=>{ const q=search.toLowerCase(); return !q||(d.name||"").toLowerCase().includes(q)||(d.class||"").toLowerCase().includes(q)||(d.uses||"").toLowerCase().includes(q)||(d.contraindications||"").toLowerCase().includes(q)||(d.side_effects||"").toLowerCase().includes(q); });
  const allFilt = filtered.length>0 && filtered.every(d=>selDrugs.has(d.id));
  const togAll = () => { if(allFilt){setSelDrugs(s=>{const n=new Set(s);filtered.forEach(d=>n.delete(d.id));return n;});}else{setSelDrugs(s=>{const n=new Set(s);filtered.forEach(d=>n.add(d.id));return n;});}; };
  const togOne = (id) => setSelDrugs(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">💊 Drug Guide ({drugs.length} drugs)</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
          {drugs.length>0&&<button className="btn btn-sm btn-danger" onClick={()=>{if(window.confirm(`Delete all ${drugs.length} drugs? This cannot be undone.`)){setDrugs([]);saveShared("drugs",[]);setSelDrugs(new Set());toast("All drugs deleted","success");}}}>🗑️ Delete All</button>}
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm(blank);}}>+ Add Drug</button>
        </div>
      </div>

      {selDrugs.size>0&&(
        <div className="bulk-bar">
          <span className="bulk-bar-count">☑ {selDrugs.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={delSel}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={()=>setSelDrugs(new Set())}>✕ Clear</button>
        </div>
      )}

      {pasteMode&&(
        <div className="card" style={{marginBottom:18}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:6}}>📋 Paste Drugs</div>
          <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:8}}>Format: <b style={{color:"var(--accent)"}}>Name | Class | Dose | MaxDose | Uses | Contraindications | SideEffects</b></div>
          <textarea className="paste-box" placeholder={"Aspirin | NSAID/Antiplatelet | 75-325mg daily | 4g/day | Pain, antiplatelet | Peptic ulcer, asthma | GI bleeding, Reye's syndrome\nFurosemide | Loop Diuretic | 20-80mg daily | 600mg/day | Oedema, heart failure | Allergy, anuria | Hypokalaemia, ototoxicity"} value={pasteText} onChange={e=>setPasteText(e.target.value)} />
          <div style={{display:"flex",gap:8,marginBottom:parsed.length?10:0}}>
            <button className="btn btn-accent" onClick={parsePaste}>🔍 Parse</button>
            {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length}</button>}
            <button className="btn" onClick={()=>{setPasteMode(false);setParsed([]);setPasteText("");}}>Cancel</button>
          </div>
          {parsed.length>0&&<div className="parse-preview">{parsed.map((p,i)=><div key={i} className="parse-item"><span className="parse-check">✓</span><b>{p.name}</b> — {p.class||"No class"} — {p.dose||"No dose"}</div>)}</div>}
        </div>
      )}

      <div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search by name, class, uses..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <table className="tbl">
          <thead><tr>
            <th style={{width:36,padding:'10px 8px'}}><input type="checkbox" className="cb-all" checked={allFilt} onChange={togAll} title="Select all" /></th>
            <th>Drug Name</th><th>Class</th><th>Dose</th><th>Uses</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map((d,i)=>(
              <tr key={d.id} style={{background:selDrugs.has(d.id)?"rgba(239,68,68,.04)":""}}>
                <td style={{padding:'8px'}}><input type="checkbox" className="cb-row" checked={selDrugs.has(d.id)} onChange={()=>togOne(d.id)} /></td>
                <td style={{fontWeight:700}}>{d.name}</td>
                <td><span className="tag">{d.class}</span></td>
                <td style={{fontSize:12,color:"var(--text3)"}}>{d.dose}</td>
                <td style={{fontSize:12,color:"var(--text2)",maxWidth:150}}>{d.uses}</td>
                <td><div className="tbl-actions">
                  <button className="btn btn-sm" onClick={()=>{setEdit(drugs.indexOf(d));setForm({...d});setShowModal(true);}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>del(d.id)}>🗑️</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit!==null?"Edit Drug":"Add Drug"}</div><button className="modal-close" onClick={()=>setShowModal(false)}>✕</button></div>
            {Object.keys(blank).map(k=>(
              <div key={k}><label className="lbl">{k.replace(/_/g," ")}</label><input className="inp" value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} placeholder={k==="name"?"e.g. Aspirin":k==="class"?"e.g. NSAID":""} /></div>
            ))}
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={save}>Save</button><button className="btn" onClick={()=>setShowModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Labs ───────────────────────────────────────────────────────

export function AdminLabs({ toast }) {
  const [labs, setLabs] = useSharedData("nv-labs", DEFAULT_LABS);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState([]);
  const [editIdx, setEditIdx] = useState(null);
  const [editForm, setEditForm] = useState({test:"", normal:"", low:"", high:""});
  const [selLabs, setSelLabs] = useState(new Set());
  const allLabs = labs.length>0 && labs.every(l=>selLabs.has(l.id));
  const togAllLabs = () => { if(allLabs){setSelLabs(new Set());}else{setSelLabs(new Set(labs.map(l=>l.id)));} };

  // ── Smart parser: handles both pipe-delimited and plain table-style text ──
  // Accepted formats:
  //   Test Name | Normal Value | Low Value (Indication) | High Value (Indication)
  //   Test Name   Normal Value   Low Indication   High Indication   (tab-separated)
  //   or multi-line blocks separated by blank lines where:
  //     Line 1 = Test name
  //     Line 2 = Normal value
  //     Line 3 = Low indication
  //     Line 4 = High indication
  const parseLabs = () => {
    const text = pasteText.trim();
    if (!text) { toast("Paste lab data first","error"); return; }

    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const items = [];

    // Try pipe or tab-delimited first (most common paste from tables)
    const delimited = lines.filter(l => l.includes("|") || l.split("\t").length >= 3);
    if (delimited.length > 0) {
      delimited.forEach(line => {
        // Skip header rows
        if (line.match(/^Test\s*[|	]/i)) return;
        const sep = line.includes("|") ? "|" : "\t";
        const parts = line.split(sep).map(p => p.trim()).filter((_,i) => i < 4);
        if (parts.length >= 2 && parts[0]) {
          items.push({
            test:   parts[0],
            normal: parts[1] || "",
            low:    parts[2] || "",
            high:   parts[3] || "",
          });
        }
      });
    } else {
      // Block format: each block = one lab test (separated by blank lines)
      const blocks = text.split(/\n\s*\n/).filter(b => b.trim());
      if (blocks.length > 1) {
        blocks.forEach(block => {
          const blines = block.split("\n").map(l=>l.trim()).filter(Boolean);
          if (blines.length >= 1) {
            items.push({
              test:   blines[0] || "",
              normal: blines[1] || "",
              low:    blines[2] || "",
              high:   blines[3] || "",
            });
          }
        });
      } else {
        // Single-column lines: group every 4 lines as one test
        for (let i = 0; i < lines.length; i += 4) {
          if (lines[i]) {
            items.push({
              test:   lines[i]   || "",
              normal: lines[i+1] || "",
              low:    lines[i+2] || "",
              high:   lines[i+3] || "",
            });
          }
        }
      }
    }

    const valid = items.filter(i => i.test);
    setParsed(valid);
    if (!valid.length) toast("No lab tests parsed — try: Test | Normal | Low | High","error");
    else toast("✅ " + valid.length + " lab test(s) parsed!","success");
  };

  const importParsed = () => {
    if (!parsed.length) return;
    const newItems = parsed.map(p => ({...p, id: Date.now()+Math.random()}));
    const u = [...labs, ...newItems];
    setLabs(u); saveShared("labs", u);
    setParsed([]); setPasteText("");
    toast("✅ " + newItems.length + " lab test(s) imported!","success");
  };

  const del = (id) => { const u=labs.filter(l=>l.id!==id); setLabs(u); saveShared("labs",u); setSelLabs(s=>{const n=new Set(s);n.delete(id);return n;}); toast("Deleted","success"); };
  const delSelLabs = () => { if(!selLabs.size)return; const u=labs.filter(l=>!selLabs.has(l.id)); setLabs(u); saveShared("labs",u); toast(selLabs.size+" test(s) deleted","success"); setSelLabs(new Set()); };

  const saveEdit = () => {
    if (!editForm.test.trim()) return toast("Test name required","error");
    const u = labs.map((l,i) => i===editIdx ? {...l, ...editForm} : l);
    setLabs(u); saveShared("labs",u);
    setEditIdx(null); setEditForm({test:"",normal:"",low:"",high:""});
    toast("✏️ Updated","success");
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">🧪 Lab Reference ({labs.length} tests)</div>
        <div style={{display:"flex",gap:8}}>
          {selLabs.size>0&&<button className="btn btn-sm btn-danger" onClick={delSelLabs}>🗑️ Delete ({selLabs.size})</button>}
          {labs.length>0&&<button className="btn btn-sm btn-danger" onClick={()=>{if(window.confirm("Delete all "+labs.length+" tests?")){setLabs([]);saveShared("labs",[]);setSelLabs(new Set());toast("All deleted","success");}}}>🗑️ All</button>}
        </div>
      </div>

      {/* ── Paste UI ── */}
      <div className="card2" style={{marginBottom:16,border:"1px solid var(--accent)30"}}>
        <div style={{fontWeight:800,fontSize:13,color:"var(--accent)",marginBottom:6}}>📋 Paste Lab Reference Data</div>
        <div style={{fontSize:11,color:"var(--text3)",marginBottom:8,lineHeight:1.7}}>
          Paste lab values in any of these formats — the system auto-detects:<br/>
          <span style={{fontFamily:"monospace",background:"var(--bg4)",padding:"2px 6px",borderRadius:4}}>Test | Normal Value | Low Indication | High Indication</span>
          &nbsp;(pipe or tab-separated)<br/>
          Or plain multi-line blocks (test name, normal, low, high — one per line, blank line between tests).
        </div>
        <textarea className="paste-box" rows={10} style={{fontFamily:"monospace",fontSize:12,resize:"vertical"}}
          value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsed([]);}}
          placeholder={"Hemoglobin (Hb) | Male: 13–18 g/dL, Female: 12–16 g/dL | Anemia, blood loss, malnutrition | Dehydration, polycythemia\nWBC | 4,000–11,000 /μL | Bone marrow failure, viral infection | Infection, inflammation, leukemia\nPlatelets | 150,000–400,000 /μL | Bleeding disorders, bone marrow disease | Infection, clotting disorders"} />
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
          <button className="btn btn-accent" onClick={parseLabs}>🔍 Auto-Parse</button>
          {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length} Test{parsed.length!==1?"s":""}</button>}
          <button className="btn" onClick={()=>{setParsed([]);setPasteText("");}}>🗑️ Clear</button>
        </div>
        {parsed.length>0&&(
          <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
            <div style={{padding:"8px 14px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>
              ✓ {parsed.length} test{parsed.length!==1?"s":""} parsed — review then import
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:"var(--bg4)"}}>
                    <th style={{padding:"6px 10px",textAlign:"left",fontWeight:800,color:"var(--text3)",borderBottom:"1px solid var(--border)"}}>Test</th>
                    <th style={{padding:"6px 10px",textAlign:"left",fontWeight:800,color:"var(--text3)",borderBottom:"1px solid var(--border)"}}>Normal Value</th>
                    <th style={{padding:"6px 10px",textAlign:"left",fontWeight:800,color:"#f59e0b",borderBottom:"1px solid var(--border)"}}>Low (Indication)</th>
                    <th style={{padding:"6px 10px",textAlign:"left",fontWeight:800,color:"var(--danger)",borderBottom:"1px solid var(--border)"}}>High (Indication)</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((p,i)=>(
                    <tr key={i} style={{borderBottom:"1px solid var(--border)"}}>
                      <td style={{padding:"6px 10px",fontWeight:700}}>{p.test}</td>
                      <td style={{padding:"6px 10px",fontFamily:"monospace",fontSize:11,color:"var(--success)"}}>{p.normal}</td>
                      <td style={{padding:"6px 10px",fontSize:11,color:"#f59e0b"}}>{p.low}</td>
                      <td style={{padding:"6px 10px",fontSize:11,color:"var(--danger)"}}>{p.high}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Edit inline ── */}
      {editIdx!==null&&(
        <div className="card2" style={{marginBottom:14,border:"2px solid var(--accent)",background:"rgba(62,142,149,.05)"}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--accent)",marginBottom:10}}>✏️ Edit Lab Test</div>
          <label className="lbl">Test Name *</label>
          <input className="inp" value={editForm.test} onChange={e=>setEditForm({...editForm,test:e.target.value})} placeholder="e.g. Hemoglobin (Hb)" />
          <label className="lbl">Normal Value</label>
          <textarea className="inp" rows={2} style={{resize:"vertical"}} value={editForm.normal} onChange={e=>setEditForm({...editForm,normal:e.target.value})} placeholder={"Male: 13–18 g/dL\nFemale: 12–16 g/dL"} />
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <label className="lbl">Low Value (Indication)</label>
              <textarea className="inp" rows={2} style={{resize:"vertical"}} value={editForm.low} onChange={e=>setEditForm({...editForm,low:e.target.value})} placeholder="Anemia, blood loss, malnutrition" />
            </div>
            <div>
              <label className="lbl">High Value (Indication)</label>
              <textarea className="inp" rows={2} style={{resize:"vertical"}} value={editForm.high} onChange={e=>setEditForm({...editForm,high:e.target.value})} placeholder="Dehydration, polycythemia" />
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-accent" onClick={saveEdit}>💾 Save Changes</button>
            <button className="btn" onClick={()=>{setEditIdx(null);setEditForm({test:"",normal:"",low:"",high:""});}}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Lab tests table ── */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"6px 12px",background:"var(--bg4)",borderRadius:8,marginBottom:10}}>
        <input type="checkbox" className="cb-all" checked={allLabs} onChange={togAllLabs} />
        <span style={{fontSize:12,color:"var(--text3)",fontWeight:700}}>Select All ({labs.length})</span>
      </div>
      {labs.length===0&&(
        <div style={{textAlign:"center",padding:24,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:10}}>
          No lab tests yet — paste and import above.
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {labs.map((l,i)=>(
          <div key={l.id} className="card2" style={{borderLeft:`3px solid ${i===editIdx?"var(--accent)":"var(--border)"}`,background:selLabs.has(l.id)?"rgba(239,68,68,.04)":""}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <input type="checkbox" className="cb-row" checked={selLabs.has(l.id)} onChange={()=>setSelLabs(ss=>{const n=new Set(ss);n.has(l.id)?n.delete(l.id):n.add(l.id);return n;})} style={{marginTop:3}} />
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:800,fontSize:14,color:"var(--text)",marginBottom:6}}>🧪 {l.test}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:12}}>
                  <div style={{background:"rgba(34,197,94,.08)",borderRadius:7,padding:"6px 10px",border:"1px solid rgba(34,197,94,.2)"}}>
                    <div style={{fontWeight:800,fontSize:10,color:"var(--success)",marginBottom:3,textTransform:"uppercase",letterSpacing:.5}}>Normal Value</div>
                    <div style={{fontFamily:"monospace",color:"var(--text2)",whiteSpace:"pre-line"}}>{l.normal||l.male||"—"}</div>
                  </div>
                  <div style={{background:"rgba(245,158,11,.08)",borderRadius:7,padding:"6px 10px",border:"1px solid rgba(245,158,11,.25)"}}>
                    <div style={{fontWeight:800,fontSize:10,color:"#f59e0b",marginBottom:3,textTransform:"uppercase",letterSpacing:.5}}>↓ Low (Indication)</div>
                    <div style={{color:"var(--text2)"}}>{l.low||l.notes||"—"}</div>
                  </div>
                  <div style={{background:"rgba(239,68,68,.07)",borderRadius:7,padding:"6px 10px",border:"1px solid rgba(239,68,68,.2)"}}>
                    <div style={{fontWeight:800,fontSize:10,color:"var(--danger)",marginBottom:3,textTransform:"uppercase",letterSpacing:.5}}>↑ High (Indication)</div>
                    <div style={{color:"var(--text2)"}}>{l.high||"—"}</div>
                  </div>
                </div>
              </div>
              <div style={{display:"flex",gap:4,flexShrink:0}}>
                <button className="btn btn-sm" onClick={()=>{setEditIdx(i);setEditForm({test:l.test,normal:l.normal||l.male||"",low:l.low||l.notes||"",high:l.high||""});}}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={()=>del(l.id)}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
// ── Admin Past Questions ─────────────────────────────────────────────

export function AdminPQ({ toast }) {
  const [banks, setBanks] = useSharedData("nv-pq", DEFAULT_PQ);
  const [selBank, setSelBank] = useState(null);
  const [showBankModal, setShowBankModal] = useState(false);
  const [showQModal, setShowQModal] = useState(false);
  const [editBank, setEditBank] = useState(null);
  const [editQ, setEditQ] = useState(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteAnswers, setPasteAnswers] = useState("");
  const [parsed, setParsed] = useState([]);
  const [bankForm, setBankForm] = useState({subject:"",year:""});
  const [qForm, setQForm] = useState({q:"",options:["","","",""],ans:0});

  const parsePaste = () => {
    // Format:
    // Q: Question text
    // A: Option A
    // B: Option B
    // C: Option C
    // D: Option D
    // ANS: B (optional, can be overridden by answers column)
    const blocks = pasteText.trim().split(/\n\s*\n/).filter(b=>b.trim());
    const ansLines = pasteAnswers.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const items = blocks.map((block,idx)=>{
      const lines = block.split("\n").map(l=>l.trim()).filter(Boolean);
      let q="",options=["","","",""],ans=0;
      lines.forEach(line=>{
        const lower=line.toLowerCase();
        if (lower.startsWith("q:")) q=line.slice(2).trim();
        else if (lower.startsWith("a:")) options[0]=line.slice(2).trim();
        else if (lower.startsWith("b:")) options[1]=line.slice(2).trim();
        else if (lower.startsWith("c:")) options[2]=line.slice(2).trim();
        else if (lower.startsWith("d:")) options[3]=line.slice(2).trim();
        else if (lower.startsWith("ans:")) { const a=line.slice(4).trim().toUpperCase(); ans=["A","B","C","D"].indexOf(a); if(ans<0)ans=0; }
      });
      if (!q && lines[0]) q=lines[0];
      // Override with answers column if provided
      if (ansLines[idx]) { const a=["A","B","C","D"].indexOf(ansLines[idx][0]?.toUpperCase()); if(a>=0)ans=a; }
      return {q,options,ans};
    }).filter(item=>item.q);
    setParsed(items);
  };

  const importParsed = async () => {
    if (!selBank) return toast("Select a bank first","error");
    const updated = banks.map(b=>b.id===selBank?{...b,questions:[...b.questions,...parsed.map(p=>({...p}))]}:b);
    setBanks(updated);
    const ok = await saveShared("pq", updated);
    if (ok) {
      toast(`${parsed.length} questions imported & synced! ✅`,"success");
    } else {
      toast(`${parsed.length} questions saved locally — ⚠️ sync failed, check connection`,"warn");
    }
    setPasteText(""); setPasteAnswers(""); setParsed([]); setPasteMode(false);
  };

  const saveBank = () => {
    if (!bankForm.subject) return toast("Subject required","error");
    let u;
    if (editBank!==null) { u=banks.map((b,i)=>i===editBank?{...b,...bankForm}:b); toast("Updated","success"); }
    else { u=[...banks,{...bankForm,id:Date.now(),questions:[]}]; toast("Bank created","success"); }
    setBanks(u); saveShared("pq",u); setShowBankModal(false); setEditBank(null); setBankForm({subject:"",year:""});
  };

  const delBank = (id) => { if(!confirm("Delete this question bank?"))return; const u=banks.filter(b=>b.id!==id); setBanks(u); saveShared("pq",u); if(selBank===id)setSelBank(null); toast("Deleted","success"); };

  const saveQ = () => {
    if (!qForm.q) return toast("Question required","error");
    const updated = banks.map(b=>{
      if (b.id!==selBank) return b;
      let qs;
      if (editQ!==null) { qs=b.questions.map((q,i)=>i===editQ?{...qForm}:q); toast("Updated","success"); }
      else { qs=[...b.questions,{...qForm}]; toast("Question added","success"); }
      return {...b,questions:qs};
    });
    setBanks(updated); saveShared("pq",updated); setShowQModal(false); setEditQ(null); setQForm({q:"",options:["","","",""],ans:0});
  };

  const delQ = (bankId, qIdx) => { const u=banks.map(b=>b.id===bankId?{...b,questions:b.questions.filter((_,i)=>i!==qIdx)}:b); setBanks(u); saveShared("pq",u); toast("Deleted","success"); };

  const currentBank = banks.find(b=>b.id===selBank);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">❓ Past Questions ({banks.length} banks)</div>
        <button className="btn btn-purple" onClick={()=>{setShowBankModal(true);setEditBank(null);setBankForm({subject:"",year:""});}}>+ New Bank</button>
      </div>

      <div className="grid2" style={{marginBottom:20}}>
        {banks.map((b,i)=>(
          <div key={b.id} className={`card${selBank===b.id?" ":" "}`} style={{cursor:"pointer",border:selBank===b.id?"1px solid var(--purple)":"1px solid var(--border)",transition:"border .2s"}} onClick={()=>setSelBank(b.id)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{b.subject}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{b.year} • {b.questions.length} questions</div>
              </div>
              <div style={{display:"flex",gap:5}}>
                <button className="btn btn-sm" onClick={e=>{e.stopPropagation();setEditBank(i);setBankForm({subject:b.subject,year:b.year});setShowBankModal(true);}}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();delBank(b.id);}}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {currentBank&&(
        <div className="card">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700}}>{currentBank.subject} — Questions ({currentBank.questions.length})</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
              <button className="btn btn-purple btn-sm" onClick={()=>{setShowQModal(true);setEditQ(null);setQForm({q:"",options:["","","",""],ans:0});}}>+ Add Q</button>
            </div>
          </div>

          {pasteMode&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:8}}>Paste questions in the left column and answers (one letter per line: A/B/C/D) in the right column. Answers column overrides any ANS: in the question text.</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--accent)",marginBottom:4}}>📝 Questions (with A/B/C/D options)</div>
                  <textarea className="paste-box" placeholder={"Q: What is the normal adult temperature?\nA: 35.0°C\nB: 36.1–37.2°C\nC: 38.5°C\nD: 40.0°C\n\nQ: Which organ produces insulin?\nA: Liver\nB: Kidney\nC: Pancreas\nD: Spleen"} value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsed([]);}} rows={10} />
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ Answers (one per line: A / B / C / D)</div>
                  <textarea className="paste-box" placeholder={"B\nC"} value={pasteAnswers} onChange={e=>{setPasteAnswers(e.target.value);setParsed([]);}} rows={10} style={{borderColor:"rgba(34,197,94,.35)"}} />
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:parsed.length?10:0}}>
                <button className="btn btn-accent" onClick={parsePaste}>🔍 Parse</button>
                {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length} Questions</button>}
                <button className="btn" onClick={()=>{setPasteMode(false);setParsed([]);setPasteText("");setPasteAnswers("");}}>Cancel</button>
              </div>
              {parsed.length>0&&<div className="parse-preview">{parsed.map((p,i)=><div key={i} className="parse-item"><span className="parse-check">✓</span><span style={{flex:1}}>{p.q}</span><span style={{color:"var(--accent)"}}>ANS: {"ABCD"[p.ans]}</span></div>)}</div>}
            </div>
          )}

          {currentBank.questions.map((q,qi)=>(
            <div key={qi} className="card2" style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:6}}>{qi+1}. {q.q}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {q.options.map((opt,oi)=>(
                      <span key={oi} style={{fontSize:11,padding:"2px 8px",borderRadius:5,background:oi===q.ans?"rgba(74,222,128,.15)":"rgba(255,255,255,.05)",border:`1px solid ${oi===q.ans?"var(--success)":"var(--border)"}`,color:oi===q.ans?"var(--success)":"var(--text3)"}}>{"ABCD"[oi]}. {opt}</span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0}}>
                  <button className="btn btn-sm" onClick={()=>{setEditQ(qi);setQForm({...q,options:[...q.options]});setShowQModal(true);}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>delQ(currentBank.id,qi)}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showBankModal&&(
        <div className="modal-overlay" onClick={()=>setShowBankModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editBank!==null?"Edit":"New"} Question Bank</div><button className="modal-close" onClick={()=>setShowBankModal(false)}>✕</button></div>
            <label className="lbl">Subject</label><input className="inp" value={bankForm.subject} onChange={e=>setBankForm({...bankForm,subject:e.target.value})} placeholder="e.g. Medical-Surgical Nursing" />
            <label className="lbl">Year</label><input className="inp" value={bankForm.year} onChange={e=>setBankForm({...bankForm,year:e.target.value})} placeholder="e.g. 2024" />
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={saveBank}>Save</button><button className="btn" onClick={()=>setShowBankModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {showQModal&&(
        <div className="modal-overlay" onClick={()=>setShowQModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editQ!==null?"Edit":"Add"} Question</div><button className="modal-close" onClick={()=>setShowQModal(false)}>✕</button></div>
            <label className="lbl">Question</label><textarea className="inp" rows={3} style={{resize:"vertical"}} value={qForm.q} onChange={e=>setQForm({...qForm,q:e.target.value})} />
            {["A","B","C","D"].map((l,i)=>(
              <div key={l}><label className="lbl">Option {l}</label><input className="inp" value={qForm.options[i]} onChange={e=>{const o=[...qForm.options];o[i]=e.target.value;setQForm({...qForm,options:o});}} /></div>
            ))}
            <label className="lbl">Correct Answer</label>
            <select className="inp" value={qForm.ans} onChange={e=>setQForm({...qForm,ans:+e.target.value})}>
              {["A","B","C","D"].map((l,i)=><option key={l} value={i}>Option {l}: {qForm.options[i]}</option>)}
            </select>
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={saveQ}>Save</button><button className="btn" onClick={()=>setShowQModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Skills ─────────────────────────────────────────────────────

export function AdminSkills({ toast }) {
  const [skills, setSkills] = useSharedData("nv-skillsdb", DEFAULT_SKILLS);
  const [osceText, setOsceText] = useState("");
  const [osceAnswersText, setOsceAnswersText] = useState("");
  const [parsedOsce, setParsedOsce] = useState([]);
  const [editIdx, setEditIdx] = useState(null);
  const [editForm, setEditForm] = useState({heading:"", instructions:"", activities:"", totalMarks:""});
  const [selSkills, setSelSkills] = useState(new Set());
  const allSkills = skills.length>0 && skills.every(s=>selSkills.has(s.id));
  const togAllSkills = () => { if(allSkills){setSelSkills(new Set());}else{setSelSkills(new Set(skills.map(s=>s.id)));} };

  // ── Parser: same rich format as NC OSCE ──
  const parseSchoolOsce = () => {
    const rawText = osceText.trim();
    if (!rawText) { toast("Paste OSCE content first","error"); return; }

    // ── helpers ──────────────────────────────────────────────────────
    const parseMark = (s) => {
      if (!s) return 0;
      const t = (s+"").replace(/mark[s]?/gi,"").trim();
      if (t==="½"||t==="1/2") return 0.5;
      if (t==="¼"||t==="1/4") return 0.25;
      if (t==="¾"||t==="3/4") return 0.75;
      const fr = t.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (fr) return parseInt(fr[1])/parseInt(fr[2]);
      const n = parseFloat(t); return isNaN(n)?0:n;
    };

    // Split a line of inline MCQ options: "a. Text     b. Text     c. Text     d. Text"
    const parseInlineOptions = (line) => {
      const opts = [];
      const re = /([a-d])\.\s+(.+?)(?=\s{2,}[a-d]\.\s|\s*$)/gi;
      let m;
      while ((m = re.exec(line)) !== null) {
        opts.push({ letter: m[1].toUpperCase(), text: m[2].trim() });
      }
      return opts;
    };

    const isSubTopicHeading = (line) => {
      if (!line.trim()) return false;
      if (/^(?:PROCEDURE\s+STATION|INSTRUCTION|ACTIVITIES|QUESTION\s+STATION|Total\s+Marks)/i.test(line)) return false;
      if (/^\d+[.)]\s/.test(line)) return false;
      if (/\(\d.*mark/i.test(line)) return false;
      const upper = line.replace(/[^A-Za-z]/g,"");
      if (upper.length < 3) return false;
      const upperRatio = (upper.match(/[A-Z]/g)||[]).length / upper.length;
      return upperRatio >= 0.85 && line.length < 90;
    };

    const isGroupLabel = (line) => {
      if (!line.trim()) return false;
      if (/^\d+[.)]\s/.test(line)) return false;
      if (/\(\d.*mark/i.test(line)) return false;
      if (/^[a-d]\.\s/.test(line)) return false;
      return true;
    };

    // ── Split text into top-level blocks on PROCEDURE STATION: or QUESTION STATION: ──
    const blocks = rawText
      .split(/(?=^(?:PROCEDURE|QUESTION)\s+STATION[\s:]+)/mi)
      .map(b=>b.trim()).filter(Boolean);

    const items = blocks.map(block => {
      const lines = block.split("\n").map(l => l.trimEnd());
      const firstLine = lines[0].trim();

      // ── Standalone QUESTION STATION block ──────────────────────────
      const isQBlock = /^QUESTION\s+STATION/i.test(firstLine);
      if (isQBlock) {
        const heading = firstLine.replace(/^QUESTION\s+STATION[\s:]*/i,"").trim() || "Question Station";
        const questionStation = [];
        let i = 1;
        while (i < lines.length) {
          const line = lines[i].trim();
          i++;
          if (!line) continue;
          if (/^Total\s+Marks/i.test(line)) continue;

          // Inline options line (starts with "a.")
          const inlineOpts = /^[a-d]\.\s+/i.test(line) ? parseInlineOptions(line) : null;
          if (inlineOpts && inlineOpts.length && questionStation.length) {
            const lastQ = questionStation[questionStation.length-1];
            if (lastQ.type==="fill" || lastQ.type==="text") {
              // Promote to fill+mcq or mcq
              lastQ.type = lastQ.isFill ? "fill" : "mcq";
              lastQ.options = inlineOpts;
            } else if (lastQ.type==="mcq") {
              lastQ.options = inlineOpts;
            }
            continue;
          }

          // Numbered question line
          const qm = line.match(/^(\d+)[.)]\s+(.+)$/);
          if (qm) {
            const qText = qm[2].trim();
            const isFill = /\.{4,}/.test(qText);
            // Check if next line has inline options
            const nextLine = (lines[i]||"").trim();
            const hasNextOpts = /^[a-d]\.\s+/i.test(nextLine);
            const type = hasNextOpts ? (isFill?"fill":"mcq") : (isFill?"fill":"text");
            questionStation.push({ type, isFill, q:qText, options:[], ans:null, qNum: parseInt(qm[1]) });
            continue;
          }

          // Old-style one-per-line option (fallback)
          const oldOpt = line.match(/^([a-d])[.)]\s+(.+)$/i);
          if (oldOpt && questionStation.length) {
            const lastQ = questionStation[questionStation.length-1];
            if (lastQ.type==="mcq"||lastQ.type==="fill") {
              lastQ.options.push({ letter: oldOpt[1].toUpperCase(), text: oldOpt[2].trim() });
            }
          }
        }
        return {
          isQuestionStation: true,
          heading, instructions:[], subTopics:[], activities:[], questionStation,
          totalMarks:""
        };
      }

      // ── PROCEDURE STATION block ─────────────────────────────────────
      let heading = "";
      let instructions = [];
      let subTopics = [];
      let questionStation = [];
      let mode = "heading";
      let currentGroup = "";
      let currentSubTopic = null;
      let globalQIdx = 0;

      const pushSubTopic = (title) => {
        currentSubTopic = { title, activities: [], totalMarks: "", totalMarksNum: 0 };
        subTopics.push(currentSubTopic);
        currentGroup = "";
        mode = "subtopic_wait";
      };

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();
        if (!line) continue;

        if (/^PROCEDURE\s+STATION[\s:]*/i.test(line)) {
          heading = line.replace(/^PROCEDURE\s+STATION[\s:]*/i,"").trim();
          mode = "heading"; continue;
        }
        if (/^INSTRUCTION(S)?\s+TO\s+CANDIDATE/i.test(line)) { mode = "instructions"; continue; }
        if (/^ACTIVITIES\s*$/i.test(line)) {
          mode = "subtopic_activities";
          if (!currentSubTopic) {
            currentSubTopic = { title:"", activities:[], totalMarks:"", totalMarksNum:0 };
            subTopics.push(currentSubTopic);
          }
          continue;
        }
        if (/^QUESTION\s+STATION/i.test(line)) { mode = "questions"; continue; }
        if (/^Total\s+Marks/i.test(line)) {
          const tm = line.match(/([\d.½¼¾\/]+)\s*Marks?/i);
          const val = parseMark(tm?tm[1]:"");
          if (currentSubTopic) {
            currentSubTopic.totalMarks = line;
            currentSubTopic.totalMarksNum = val || currentSubTopic.activities.reduce((s,a)=>s+(a.markVal||0),0);
          }
          mode = "subtopic_wait"; continue;
        }

        if (mode === "heading" && heading && !/^(?:INSTRUCTION|ACTIVIT|QUESTION)/i.test(line)) {
          heading += " " + line; continue;
        }
        if (mode === "instructions") {
          if (isSubTopicHeading(line)) { pushSubTopic(line); continue; }
          const clean = line.replace(/^[➤►>•\-*]\s*/,"").trim();
          if (clean) instructions.push(clean);
          continue;
        }
        if (mode === "subtopic_wait" || mode === "heading") {
          if (isSubTopicHeading(line)) { pushSubTopic(line); continue; }
          if (/^INSTRUCTION/i.test(line)) { mode = "instructions"; continue; }
          continue;
        }
        if (mode === "subtopic_activities") {
          if (isSubTopicHeading(line) && !(/^\d+[.)]/.test(line))) { pushSubTopic(line); continue; }
          const actM = line.match(/^(\d+[a-z]?)[.)]\s+(.+)$/i);
          const subM = line.match(/^([a-z])[.)]\s+(.+)$/i);
          if (actM) {
            const raw2 = actM[2].trim();
            const mm = raw2.match(/\(([½¼¾\d.\/\s]+\s*mark[s]?)\)\s*$/i);
            const text = mm ? raw2.replace(mm[0],"").trim() : raw2;
            const markStr = mm ? mm[1].trim() : "";
            currentSubTopic.activities.push({
              num:actM[1], group:currentGroup, text, mark:markStr,
              markVal:parseMark(markStr), subItems:[]
            });
          } else if (subM && currentSubTopic && currentSubTopic.activities.length>0) {
            const raw2 = subM[2].trim();
            const mm = raw2.match(/\(([½¼¾\d.\/\s]+\s*mark[s]?)\)\s*$/i);
            const text = mm ? raw2.replace(mm[0],"").trim() : raw2;
            const markStr = mm ? mm[1].trim() : "";
            const parent = currentSubTopic.activities[currentSubTopic.activities.length-1];
            if (!parent.subItems) parent.subItems=[];
            parent.subItems.push({ letter:subM[1], text, mark:markStr, markVal:parseMark(markStr) });
          } else if (isGroupLabel(line)) {
            currentGroup = line;
          }
          continue;
        }
        if (mode === "questions") {
          // Inline options: "a. Text     b. Text     c. Text"
          if (/^[a-d]\.\s+/i.test(line)) {
            const opts = parseInlineOptions(line);
            if (opts.length && questionStation.length) {
              const lastQ = questionStation[questionStation.length-1];
              lastQ.options = opts;
              if (lastQ.type==="text"||lastQ.type==="fill") lastQ.type = lastQ.isFill?"fill":"mcq";
            } else {
              // Old-style single option per line fallback
              const oldOpt = line.match(/^([a-d])[.)]\s+(.+)$/i);
              if (oldOpt && questionStation.length) {
                questionStation[questionStation.length-1].options.push({ letter:oldOpt[1].toUpperCase(), text:oldOpt[2].trim() });
              }
            }
            continue;
          }
          const qm = line.match(/^(\d+)[.)]\s+(.+)$/);
          if (qm) {
            const qText = qm[2].trim();
            const isFill = /\.{4,}/.test(qText);
            const nextLine = (lines[i+1]||"").trim();
            const hasNextOpts = /^[a-d]\.\s+/i.test(nextLine);
            const type = hasNextOpts ? (isFill?"fill":"mcq") : (isFill?"fill":"text");
            questionStation.push({ type, isFill, q:qText, options:[], ans:null, qNum:parseInt(qm[1]) });
            continue;
          }
          // Plain text question (no number)
          if (line && !/^Total\s+Marks/i.test(line)) {
            const isFill = /\.{4,}/.test(line);
            questionStation.push({ type:isFill?"fill":"text", isFill, q:line, options:[], ans:null, qNum:globalQIdx+1 });
            globalQIdx++;
          }
          continue;
        }
      }

      if (!subTopics.length) subTopics = [{ title:"", activities:[], totalMarks:"", totalMarksNum:0 }];
      subTopics.forEach(st => {
        if (!st.totalMarksNum)
          st.totalMarksNum = st.activities.reduce((s,a)=>s+(a.markVal||0)+(a.subItems||[]).reduce((ss,si)=>ss+(si.markVal||0),0),0);
      });
      if (!heading) heading = lines.find(l=>l.trim()) || "OSCE Station";

      // ── EXPAND: each subTopic becomes its own top-level procedure station ──
      // If there are multiple named subTopics, promote each to its own station.
      // The parent heading/instructions are shared; questionStation goes to the last.
      const namedSubTopics = subTopics.filter(st => st.title && st.title.trim());
      if (namedSubTopics.length > 1) {
        // Multiple named sub-topics → each becomes its own station
        return namedSubTopics.map((st, idx) => {
          const stHeading = st.title.trim();
          const stActivities = st.activities || [];
          // Attach question station only to the last sub-topic
          const stQS = idx === namedSubTopics.length - 1 ? questionStation : [];
          return {
            heading: stHeading,
            instructions: instructions, // share parent instructions
            subTopics: [{ ...st, title: "" }], // single subTopic with no title (flatten)
            activities: stActivities,
            questionStation: stQS,
            totalMarks: st.totalMarks || "",
            _parentHeading: heading.trim()
          };
        });
      }

      // Single subTopic or no named subTopics → keep as-is (original behaviour)
      const allActivities = subTopics.flatMap(st=>st.activities);
      return {
        heading:heading.trim(), instructions, subTopics, activities:allActivities,
        questionStation, totalMarks:subTopics.map(s=>s.totalMarks).filter(Boolean).join(" | ")
      };
    }).flat().filter(i => i && i.heading);

    setParsedOsce(items);
    const qsCount  = items.filter(i=>i.isQuestionStation).length;
    const procCount = items.filter(i=>!i.isQuestionStation).length;
    if (!items.length) toast("No stations parsed — check format","error");
    else toast(`✅ ${procCount} procedure station${procCount!==1?"s":""}, ${qsCount} question station${qsCount!==1?"s":""} parsed!`,"success");
  };

  const importOsce = () => {
    if (!parsedOsce.length) return;
    const newItems = parsedOsce.map(p=>({ id: Date.now()+Math.random(), name: p.heading,
      heading: p.heading, instructions: p.instructions||[], activities: p.activities||[],
      subTopics: p.subTopics||[], questionStation: p.questionStation||[], totalMarks: p.totalMarks||"",
      isQuestionStation: p.isQuestionStation||false }));
    const u = [...skills, ...newItems];
    setSkills(u); saveShared("skills", u);
    setParsedOsce([]); setOsceText(""); setOsceAnswersText("");
    toast("✅ " + newItems.length + " station(s) added!","success");
  };

  const del = (id) => { const u=skills.filter(s=>s.id!==id); setSkills(u); saveShared("skills",u); setSelSkills(s=>{const n=new Set(s);n.delete(id);return n;}); toast("Deleted","success"); };
  const delSelSkills = () => { if(!selSkills.size)return; const u=skills.filter(s=>!selSkills.has(s.id)); setSkills(u); saveShared("skills",u); toast(selSkills.size+" station(s) deleted","success"); setSelSkills(new Set()); };

  const saveEdit = () => {
    if (!editForm.heading.trim()) return toast("Title required","error");
    const activitiesLines = editForm.activities.split("\n").map(s=>s.trim()).filter(Boolean);
    const activities = [];
    activitiesLines.forEach(line => {
      const actM = line.match(/^(\d+[a-z]?)[.)]\s+(.+)$/i);
      const subM = line.match(/^([a-z])[.)]\s+(.+)$/i);
      if (actM) {
        const text = actM[2].trim();
        const markM = text.match(/\(([^)]+marks?)\)\s*$/i);
        activities.push({ num: actM[1], text: markM ? text.replace(markM[0],"").trim() : text, mark: markM ? markM[1] : "", subItems: [] });
      } else if (subM && activities.length > 0) {
        const text = subM[2].trim();
        const markM = text.match(/\(([^)]+marks?)\)\s*$/i);
        const parent = activities[activities.length-1];
        if (!parent.subItems) parent.subItems = [];
        parent.subItems.push({ letter: subM[1], text: markM ? text.replace(markM[0],"").trim() : text, mark: markM ? markM[1] : "" });
      }
    });
    const instructions = editForm.instructions.split("\n").map(s=>s.replace(/^[➤►>•\-]\s*/,"").trim()).filter(Boolean);
    const u = skills.map((s,i) => i===editIdx ? {...s, name: editForm.heading.trim(), heading: editForm.heading.trim(),
      instructions, activities, totalMarks: editForm.totalMarks||s.totalMarks||"" } : s);
    setSkills(u); saveShared("skills",u);
    setEditIdx(null); setEditForm({heading:"",instructions:"",activities:"",totalMarks:""});
    toast("✏️ Station updated","success");
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">✅ OSCE Clinical Checklist for RN ({skills.length})</div>
        <div style={{display:"flex",gap:8}}>
          {selSkills.size>0&&<button className="btn btn-sm btn-danger" onClick={delSelSkills}>🗑️ Delete ({selSkills.size})</button>}
          {skills.length>0&&<button className="btn btn-sm btn-danger" onClick={()=>{if(window.confirm("Delete all "+skills.length+" stations?")){setSkills([]);saveShared("skills",[]);setSelSkills(new Set());toast("All deleted","success");}}}>🗑️ All</button>}
        </div>
      </div>

      {/* ── Paste & Parse UI ── */}
      <div className="card2" style={{marginBottom:16,border:"1px solid var(--accent)30"}}>
        <div style={{fontWeight:800,fontSize:13,color:"var(--accent)",marginBottom:6}}>🩺 Add OSCE Stations (Paste & Auto-Parse)</div>
        <div style={{fontSize:11,color:"var(--text3)",marginBottom:10,lineHeight:1.6}}>
          Paste the full OSCE station text. The system will auto-detect the title, instructions, activities with marks, and question station.
          Separate multiple stations with "PROCEDURE STATION:" headers.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:10}}>
          <div>
            <div style={{fontSize:11,fontWeight:800,color:"var(--accent)",marginBottom:4}}>📋 Full OSCE Station Text</div>
            <textarea className="paste-box" rows={16} style={{fontFamily:"monospace",fontSize:11,resize:"vertical"}}
              value={osceText} onChange={e=>{setOsceText(e.target.value);setParsedOsce([]);}}
              placeholder={"PROCEDURE STATION: TAKING GENERAL, PERSONAL, FAMILY AND SOCIAL HEALTH HISTORY\n\nINSTRUCTION TO CANDIDATE\n➤ Take the history of Hajiya Fatima...\n➤ Report as you carry out the procedure.\n\nACTIVITIES\n1. Greets client and introduces self (½ mark)\n2. Explains procedure and obtains consent (½ mark)\n...\n\nQUESTION STATION: HISTORY TAKING\nWhich are keys to history taking?\na. Trust\nb. Right Questions\nc. Interpreting the responses\nd. All the above\n\nTotal Marks Obtainable: 12 Marks"} />
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ MCQ Answers (one per line: A/B/C/D)</div>
            <textarea className="paste-box" rows={16} style={{resize:"vertical",borderColor:"rgba(34,197,94,.35)"}}
              value={osceAnswersText} onChange={e=>{setOsceAnswersText(e.target.value);setParsedOsce([]);}}
              placeholder={"D\nA\nC\nD\nD\nC\nA"} />
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="btn btn-accent" onClick={parseSchoolOsce}>🔍 Auto-Parse Station</button>
          {parsedOsce.length>0&&<button className="btn btn-success" onClick={importOsce}>✅ Import {parsedOsce.length} Station{parsedOsce.length!==1?"s":""}</button>}
          <button className="btn" onClick={()=>{setParsedOsce([]);setOsceText("");setOsceAnswersText("");}}>🗑️ Clear</button>
        </div>
        {parsedOsce.length>0&&(
          <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
            <div style={{padding:"8px 14px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>
              ✓ {parsedOsce.length} station{parsedOsce.length!==1?"s":""} parsed — review then import
            </div>
            {parsedOsce.map((c,i)=>(
              <div key={i} style={{padding:"10px 14px",borderTop:"1px solid var(--border)"}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--accent)",marginBottom:3}}>
                  {c.isQuestionStation?"❓":"🩺"} {c.heading}
                </div>
                {c._parentHeading&&<div style={{fontSize:10,color:"var(--text3)",marginBottom:2}}>Under: {c._parentHeading}</div>}
                <div style={{fontSize:11,color:"var(--text3)"}}>
                  {c.isQuestionStation
                    ? <span style={{color:"var(--accent)",fontWeight:700}}>Question Station • {c.questionStation.length} question{c.questionStation.length!==1?"s":""}</span>
                    : <>{c.instructions.length} instruction{c.instructions.length!==1?"s":""} • {c.activities.length} activit{c.activities.length!==1?"ies":"y"}{c.questionStation.length>0?` • ${c.questionStation.length} Q`:""}{c.totalMarks?` • ${c.totalMarks}`:""}</>
                  }
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Edit inline ── */}
      {editIdx!==null&&(
        <div className="card2" style={{marginBottom:14,border:"2px solid var(--accent)",background:"rgba(62,142,149,.05)"}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--accent)",marginBottom:10}}>✏️ Edit OSCE Station</div>
          <label className="lbl">Station Title *</label>
          <input className="inp" value={editForm.heading} onChange={e=>setEditForm({...editForm,heading:e.target.value})} placeholder="e.g. TAKING GENERAL, PERSONAL, FAMILY AND SOCIAL HEALTH HISTORY" />
          <label className="lbl">Instructions to Candidate (one per line)</label>
          <textarea className="inp" rows={3} style={{fontFamily:"monospace",fontSize:12,resize:"vertical"}}
            value={editForm.instructions} onChange={e=>setEditForm({...editForm,instructions:e.target.value})}
            placeholder={"➤ Take the history of Hajiya Fatima...\n➤ Report as you carry out the procedure."} />
          <label className="lbl">Activities (one per line with marks)</label>
          <textarea className="inp" rows={10} style={{fontFamily:"monospace",fontSize:12,resize:"vertical"}}
            value={editForm.activities} onChange={e=>setEditForm({...editForm,activities:e.target.value})}
            placeholder={"1. Greets client and introduces self (½ mark)\na. Sub-item (¼ mark)"} />
          <label className="lbl">Total Marks Line</label>
          <input className="inp" value={editForm.totalMarks} onChange={e=>setEditForm({...editForm,totalMarks:e.target.value})} placeholder="Total Marks Obtainable: 12 Marks" />
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-accent" onClick={saveEdit}>💾 Save Changes</button>
            <button className="btn" onClick={()=>{setEditIdx(null);setEditForm({heading:"",instructions:"",activities:"",totalMarks:""});}}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Station list ── */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"6px 12px",background:"var(--bg4)",borderRadius:8,marginBottom:10}}>
        <input type="checkbox" className="cb-all" checked={allSkills} onChange={togAllSkills} title="Select all" />
        <span style={{fontSize:12,color:"var(--text3)",fontWeight:700}}>Select All ({skills.length})</span>
      </div>
      {skills.length===0&&(
        <div style={{textAlign:"center",padding:24,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:10}}>
          No OSCE stations yet — paste and import above.
        </div>
      )}
      {skills.map((s,i)=>(
        <div key={s.id} className="card2" style={{marginBottom:8,borderLeft:`3px solid ${i===editIdx?"var(--accent)":"var(--border)"}`,background:selSkills.has(s.id)?"rgba(239,68,68,.04)":""}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <input type="checkbox" className="cb-row" checked={selSkills.has(s.id)} onChange={()=>setSelSkills(ss=>{const n=new Set(ss);n.has(s.id)?n.delete(s.id):n.add(s.id);return n;})} />
            <div style={{width:26,height:26,borderRadius:6,background:"rgba(62,142,149,.15)",border:"1px solid var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"var(--accent)",flexShrink:0,marginTop:2}}>{i+1}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:14,color:"var(--text)",lineHeight:1.3}}>🩺 {s.heading||s.name}</div>
              {(s.activities||[]).length>0&&(
                <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
                  {(s.activities||[]).length} activities • {(s.questionStation||[]).length} Q-station items{s.totalMarks?` • ${s.totalMarks}`:""}
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:4,flexShrink:0}}>
              <button className="btn btn-sm" onClick={()=>{
                setEditIdx(i);
                const actText = (s.activities||[]).map(a=>{
                  const lines = [`${a.num}. ${a.text}${a.mark?" ("+a.mark+")":""}`];
                  if (a.subItems) a.subItems.forEach(sub=>lines.push(`${sub.letter}. ${sub.text}${sub.mark?" ("+sub.mark+")":""}`));
                  return lines.join("\n");
                }).join("\n");
                setEditForm({
                  heading: s.heading||s.name,
                  instructions: (s.instructions||[]).map(ins=>"➤ "+ins).join("\n"),
                  activities: actText,
                  totalMarks: s.totalMarks||"",
                });
              }}>✏️</button>
              <button className="btn btn-sm btn-danger" onClick={()=>del(s.id)}>🗑️</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
// ── Admin Announcements ──────────────────────────────────────────────

export function AdminAnnouncements({ toast }) {
  const [items, setItems] = useSharedData("nv-announcements", DEFAULT_ANNOUNCEMENTS);
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({title:"",body:"",pinned:false});

  const save = () => {
    if (!form.title) return toast("Title required","error");
    let u;
    const item = {...form,date:new Date().toLocaleDateString(),id:edit||Date.now()};
    if (edit) { u=items.map(a=>a.id===edit?item:a); toast("Updated","success"); }
    else { u=[item,...items]; toast("Announcement posted!","success"); }
    setItems(u); saveShared("announcements",u); setShowModal(false); setEdit(null); setForm({title:"",body:"",pinned:false});
  };

  const [selAnnos, setSelAnnos] = useState(new Set());
  const del = (id) => { const u=items.filter(a=>a.id!==id); setItems(u); saveShared("announcements",u); setSelAnnos(s=>{const n=new Set(s);n.delete(id);return n;}); toast("Deleted","success"); };
  const delSelAnnos = () => { if(!selAnnos.size)return; const u=items.filter(a=>!selAnnos.has(a.id)); setItems(u); saveShared("announcements",u); toast(`${selAnnos.size} announcement(s) deleted`,"success"); setSelAnnos(new Set()); };
  const allAnnos = items.length>0 && items.every(a=>selAnnos.has(a.id));
  const togglePin = (id) => { const u=items.map(a=>a.id===id?{...a,pinned:!a.pinned}:a); setItems(u); saveShared("announcements",u); };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">📢 Announcements ({items.length})</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {items.length>0&&<label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"var(--text3)",cursor:"pointer"}}><input type="checkbox" className="cb-all" checked={allAnnos} onChange={()=>{if(allAnnos){setSelAnnos(new Set());}else{setSelAnnos(new Set(items.map(a=>a.id)));} }} />All</label>}
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm({title:"",body:"",pinned:false});}}>+ Post Announcement</button>
        </div>
      </div>
      {selAnnos.size>0&&(
        <div className="bulk-bar">
          <span className="bulk-bar-count">☑ {selAnnos.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={delSelAnnos}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={()=>setSelAnnos(new Set())}>✕ Clear</button>
        </div>
      )}
      {items.map(a=>(
        <div key={a.id} className="card" style={{marginBottom:12,borderLeft:a.pinned?"3px solid var(--warn)":"3px solid var(--border)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                {a.pinned&&<span className="tag tag-warn">📌 Pinned</span>}
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{a.title}</div>
              </div>
              <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.6,marginBottom:8}}>{a.body}</div>
              <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{a.date}</div>
            </div>
            <div style={{display:"flex",gap:5,flexShrink:0,alignItems:"center"}}>
              <input type="checkbox" className="cb-row" checked={selAnnos.has(a.id)} onChange={()=>setSelAnnos(s=>{const n=new Set(s);n.has(a.id)?n.delete(a.id):n.add(a.id);return n;})} />
              <button className="btn btn-sm" title="Toggle pin" onClick={()=>togglePin(a.id)}>{a.pinned?"📌":"📍"}</button>
              <button className="btn btn-sm" onClick={()=>{setEdit(a.id);setForm({title:a.title,body:a.body,pinned:a.pinned});setShowModal(true);}}>✏️</button>
              <button className="btn btn-sm btn-danger" onClick={()=>del(a.id)}>🗑️</button>
            </div>
          </div>
        </div>
      ))}

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit?"Edit":"Post"} Announcement</div><button className="modal-close" onClick={()=>setShowModal(false)}>✕</button></div>
            <label className="lbl">Title</label><input className="inp" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Exam timetable released" />
            <label className="lbl">Body</label><textarea className="inp" rows={4} style={{resize:"vertical"}} value={form.body} onChange={e=>setForm({...form,body:e.target.value})} placeholder="Announcement details..." />
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <input type="checkbox" id="pin" checked={form.pinned} onChange={e=>setForm({...form,pinned:e.target.checked})} />
              <label htmlFor="pin" style={{fontSize:13,cursor:"pointer"}}>📌 Pin this announcement</label>
            </div>
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={save}>Post</button><button className="btn" onClick={()=>setShowModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Exam Retakes ───────────────────────────────────────────────

export function AdminExamRetakes({ toast }) {
  const [banks] = useState(()=>ls("nv-pq",DEFAULT_PQ));
  const [users, setUsers] = useState(()=>ls("nv-users",[]));
  const [attempts, setAttempts] = useState({});
  const [search, setSearch] = useState("");

  const resetUserExam = (username, bankId) => {
    // Reset is stored per-user per-bank in nv-exam-attempts-<username>
    const key = `nv-exam-attempts-${username}`;
    const userAttempts = ls(key, {});
    const updated = { ...userAttempts };
    delete updated[bankId];
    saveMyData("mcq-att",key,updated);
    toast(`Retake reset for ${username} on "${banks.find(b=>b.id===bankId)?.subject||bankId}"`, "success");
    // force re-render
    setAttempts(prev=>({...prev}));
  };

  const resetAllExams = (username) => {
    if (!confirm(`Reset ALL exam attempts for ${username}?`)) return;
    saveMyData("mcq-att",`nv-exam-attempts-${username}`,{});
    toast(`All exam attempts reset for ${username}`, "success");
    setAttempts(prev=>({...prev}));
  };

  const students = users.filter(u=>u.role!=="admin");
  const filtered = students.filter(u=>u.username.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div className="sec-title">🔄 Exam Retake Management</div>
      <div className="sec-sub">View and reset student MCQ &amp; essay exam attempts (1 attempt per exam)</div>
      <div style={{background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.2)",borderRadius:10,padding:"10px 16px",fontSize:13,color:"var(--warn)",marginBottom:16}}>
        ℹ️ Students are allowed 1 attempt per exam. Use this panel to reset MCQ attempts where necessary. Essay attempts are managed in the Essay Exams tab.
      </div>
      <div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search students..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
      {filtered.map(u=>{
        const userAttempts = ls(`nv-exam-attempts-${u.username}`, {});
        const hasAttempts = Object.keys(userAttempts).length > 0;
        return (
          <div key={u.username} className="card" style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:hasAttempts?12:0}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div className="user-av">{u.username[0].toUpperCase()}</div>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>{u.username}</div>
                  <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{u.class||"No class"}</div>
                </div>
              </div>
              {hasAttempts&&<button className="btn btn-sm btn-warn" onClick={()=>resetAllExams(u.username)}>Reset All</button>}
            </div>
            {hasAttempts ? (
              <div>
                {Object.entries(userAttempts).map(([bankId, data])=>{
                  const bank = banks.find(b=>b.id===bankId||String(b.id)===String(bankId));
                  const locked = data.attempts >= 2;
                  return (
                    <div key={bankId} className="card2" style={{marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600,fontSize:13}}>{bank?.subject||`Exam #${bankId}`}</div>
                        <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>
                          {data.attempts}/2 attempts • Best: {data.results.length>0?Math.max(...data.results.map(r=>r.pct)):0}%
                          {data.results.some(r=>r.auto)&&<span style={{color:"var(--danger)",marginLeft:6}}>⚠️ Auto-submitted</span>}
                        </div>
                      </div>
                      {locked&&<span className="tag tag-danger">🔒 Locked</span>}
                      <button className="btn btn-sm btn-accent" onClick={()=>resetUserExam(u.username, bankId)}>
                        🔄 Grant Retake
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>No exam attempts recorded.</div>
            )}
          </div>
        );
      })}
      {filtered.length===0&&<div style={{textAlign:"center",padding:"40px",color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:13}}>No students found.</div>}
    </div>
  );
}


// ── Admin Essay Exams ────────────────────────────────────────────────

export function AdminEssayExams({ toast }) {
  const [banks, setBanks] = useSharedData("nv-essay-banks", []);
  const [selBank, setSelBank] = useState(null);
  const [showBankModal, setShowBankModal] = useState(false);
  const [showQModal, setShowQModal] = useState(false);
  const [editBank, setEditBank] = useState(null);
  const [editQ, setEditQ] = useState(null);
  const [bankForm, setBankForm] = useState({subject:"",description:""});
  const [qForm, setQForm] = useState({q:"",marks:10,wordGuide:"100-200",modelAnswer:""});
  const [adminTab, setAdminTab] = useState("banks"); // "banks" | "grade"
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [gradingStudent, setGradingStudent] = useState(null); // {submission, bankId}
  const [gradeForm, setGradeForm] = useState({}); // {qIdx: {marksAwarded, feedback}}
  const [overallComment, setOverallComment] = useState("");
  const [savingGrade, setSavingGrade] = useState(false);

  const saveBank = () => {
    if (!bankForm.subject.trim()) return toast("Subject required","error");
    let u;
    if (editBank!==null) { u=banks.map((b,i)=>i===editBank?{...b,...bankForm}:b); toast("Updated","success"); }
    else { u=[...banks,{...bankForm,id:Date.now(),questions:[]}]; toast("Essay bank created","success"); }
    setBanks(u); saveShared("essayBanks",u); setShowBankModal(false); setEditBank(null); setBankForm({subject:"",description:""});
  };

  const delBank = (id) => {
    if(!window.confirm("Delete this essay bank?")) return;
    const u=banks.filter(b=>b.id!==id); setBanks(u); saveShared("essayBanks",u);
    if(selBank===id) setSelBank(null); toast("Deleted","success");
  };

  const saveQ = () => {
    if (!qForm.q.trim()) return toast("Question required","error");
    const updated = banks.map(b=>{
      if (b.id!==selBank) return b;
      let qs;
      if (editQ!==null) { qs=b.questions.map((q,i)=>i===editQ?{...qForm,marks:+qForm.marks}:q); toast("Updated","success"); }
      else { qs=[...b.questions,{...qForm,marks:+qForm.marks}]; toast("Question added","success"); }
      return {...b,questions:qs};
    });
    setBanks(updated); saveShared("essayBanks",updated);
    setShowQModal(false); setEditQ(null); setQForm({q:"",marks:10,wordGuide:"100-200",modelAnswer:""});
  };

  const delQ = (bankId, qIdx) => {
    const u=banks.map(b=>b.id===bankId?{...b,questions:b.questions.filter((_,i)=>i!==qIdx)}:b);
    setBanks(u); saveShared("essayBanks",u); toast("Deleted","success");
  };

  const resetStudentEssay = (username, bankId) => {
    const key = `nv-essay-att-${username}`;
    const att = ls(key, {});
    delete att[bankId];
    lsSet(key, att);
    // Sync the reset to the student's Firestore private doc
    const _docKey = _userPrivateKey(username);
    _loadFirebase().then(ready => {
      if (!ready) return;
      _db.collection("nv").doc("user_private")
        .set({ [`${_docKey}_essay-att`]: att }, { merge: true })
        .catch(e => console.warn("[essay reset sync] failed:", e.message));
    });
    toast(`Essay attempt reset for ${username}`, "success");
  };

  const loadSubmissions = async () => {
    setLoadingSubs(true);
    try {
      const ready = await _loadFirebase();
      if (!ready) { toast("Firebase not connected","error"); setLoadingSubs(false); return; }
      const snap = await _db.collection("nv").doc(_DOC_ESSAYS).get();
      if (!snap.exists) { setSubmissions([]); setLoadingSubs(false); return; }
      const data = snap.data();
      const idx  = data.index || [];
      const allSubs = idx.map(e => {
        const d = data[e.key];
        return d ? { ...d, student: e.student, bankId: e.bankId, graded: e.graded } : null;
      }).filter(Boolean);
      setSubmissions(allSubs);
    } catch (e) { console.error(e); toast("Could not load submissions", "error"); }
    setLoadingSubs(false);
  };

  useEffect(() => {
    if (adminTab === "grade") loadSubmissions();
  }, [adminTab]);

  const startManualGrade = (sub) => {
    const initForm = {};
    (sub.questions || []).forEach((_, i) => { initForm[i] = { marksAwarded: 0, feedback: "" }; });
    setGradeForm(initForm);
    setOverallComment("");
    setGradingStudent(sub);
  };

  const submitManualGrade = async () => {
    if (!gradingStudent) return;
    setSavingGrade(true);
    const questions = (gradingStudent.questions || []);
    const totalScore = Object.values(gradeForm).reduce((s, v) => s + (+v.marksAwarded || 0), 0);
    const totalMarks = questions.reduce((s, q) => s + (+q.marks || 10), 0);
    const pct = totalMarks > 0 ? Math.round((totalScore / totalMarks) * 100) : 0;
    const grade = pct >= 70 ? "A" : pct >= 60 ? "B" : pct >= 50 ? "C" : pct >= 40 ? "D" : "F";
    const gradeData = {
      score: totalScore, total: totalMarks, pct, grade,
      overallComment, gradedBy: "Lecturer",
      questions: questions.map((q, i) => ({
        q: q.q, maxMarks: q.marks || 10,
        marksAwarded: +gradeForm[i]?.marksAwarded || 0,
        feedback: gradeForm[i]?.feedback || ""
      }))
    };
    try {
      await saveManualGradeToBackend(gradingStudent.student, gradingStudent.bankId, gradeData);
      toast(`Grade saved for ${gradingStudent.student}`, "success");
      setGradingStudent(null);
      loadSubmissions();
    } catch { toast("Failed to save grade", "error"); }
    setSavingGrade(false);
  };

  const currentBank = banks.find(b=>b.id===selBank);
  const users = ls("nv-users",[]).filter(u=>u.role==="student");

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div className="sec-title">✍️ Essay Exams</div>
          <div className="sec-sub">Create essay exams • AI or manual grading • 1 attempt per student</div>
        </div>
        {adminTab === "banks" && <button className="btn btn-purple" onClick={()=>{setShowBankModal(true);setEditBank(null);setBankForm({subject:"",description:""});}}>+ New Essay Exam</button>}
        {adminTab === "grade" && <button className="btn btn-accent btn-sm" onClick={loadSubmissions}>🔄 Refresh</button>}
      </div>

      {/* Admin tabs */}
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {[
          {key:"banks",label:"📋 Exam Banks"},
          {key:"grade",label:"📝 Manual Grading"},
        ].map(t=>(
          <div key={t.key} onClick={()=>setAdminTab(t.key)} style={{
            padding:"8px 18px",borderRadius:9,cursor:"pointer",fontSize:13,fontFamily:"'DM Mono',monospace",transition:"all .2s",
            border:`1px solid ${adminTab===t.key?"var(--purple)":"var(--border)"}`,
            background:adminTab===t.key?"rgba(124,58,237,.15)":"transparent",
            color:adminTab===t.key?"var(--purple)":"var(--text3)"
          }}>{t.label}</div>
        ))}
      </div>

      {adminTab === "grade" && (
        <div>
          {/* Manual grading modal */}
          {gradingStudent && (
            <div className="modal-overlay" onClick={()=>setGradingStudent(null)}>
              <div className="modal xl" onClick={e=>e.stopPropagation()} style={{maxHeight:"90vh"}}>
                <div className="modal-head">
                  <div className="modal-title">✏️ Grade Essay — {gradingStudent.student?.split("@")[0]}</div>
                  <button className="modal-close" onClick={()=>setGradingStudent(null)}>✕</button>
                </div>
                <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:16}}>
                  Subject: <b style={{color:"var(--accent)"}}>{gradingStudent.subject}</b> • Submitted {gradingStudent.date}
                </div>
                {(gradingStudent.questions || []).map((q, i) => (
                  <div key={i} className="card" style={{marginBottom:14}}>
                    <div style={{fontWeight:700,fontSize:14,marginBottom:6}}>Q{i+1}. {q.q} <span style={{color:"var(--accent)",fontFamily:"'DM Mono',monospace",fontSize:11}}>[{q.marks||10} marks]</span></div>
                    <div style={{background:"var(--bg4)",borderRadius:9,padding:"10px 14px",fontSize:13,color:"var(--text2)",lineHeight:1.6,marginBottom:10,fontStyle:"italic",borderLeft:"2px solid var(--border2)"}}>
                      {(gradingStudent.answers || {})[i] || "(no answer)"}
                    </div>
                    <div className="form-row">
                      <div>
                        <label className="lbl">Marks Awarded (max {q.marks||10})</label>
                        <input className="inp" type="number" min="0" max={q.marks||10}
                          value={gradeForm[i]?.marksAwarded||0}
                          onChange={e=>setGradeForm(f=>({...f,[i]:{...f[i],marksAwarded:Math.min(+e.target.value,q.marks||10)}}))}
                        />
                      </div>
                      <div>
                        <label className="lbl">Feedback</label>
                        <input className="inp" placeholder="Brief feedback for this answer..."
                          value={gradeForm[i]?.feedback||""}
                          onChange={e=>setGradeForm(f=>({...f,[i]:{...f[i],feedback:e.target.value}}))}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <label className="lbl">Overall Comment</label>
                <textarea className="inp" rows={3} style={{resize:"vertical"}} placeholder="Overall performance summary..."
                  value={overallComment} onChange={e=>setOverallComment(e.target.value)} />
                <div style={{background:"rgba(62,142,149,.08)",border:"1px solid rgba(62,142,149,.2)",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13}}>
                  📊 Total: <b style={{color:"var(--accent)"}}>{Object.values(gradeForm).reduce((s,v)=>s+(+v.marksAwarded||0),0)}</b> / {(gradingStudent.questions||[]).reduce((s,q)=>s+(+q.marks||10),0)} marks
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn btn-purple" style={{flex:1}} onClick={submitManualGrade} disabled={savingGrade}>
                    {savingGrade?"Saving...":"💾 Save Grade & Notify Student"}
                  </button>
                  <button className="btn" onClick={()=>setGradingStudent(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {loadingSubs ? (
            <div style={{textAlign:"center",padding:"40px",color:"var(--text3)"}}>
              <div style={{fontSize:32,animation:"spin 1.5s linear infinite",display:"inline-block",marginBottom:12}}>⏳</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>Loading submissions from backend...</div>
            </div>
          ) : submissions.length === 0 ? (
            <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}>
              <div style={{fontSize:48,marginBottom:12}}>📭</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>No essay submissions in backend yet.</div>
              <div style={{fontSize:12,marginTop:6}}>Submissions appear here when students submit their essays.</div>
            </div>
          ) : (
            <div>
              <div style={{background:"rgba(251,146,60,.07)",border:"1px solid rgba(251,146,60,.2)",borderRadius:10,padding:"10px 16px",fontSize:13,color:"var(--warn)",marginBottom:16}}>
                ℹ️ All essay submissions are stored in the backend. You can manually grade submissions here when AI is unavailable.
              </div>
              <div className="card" style={{padding:0,overflow:"hidden"}}>
                <table className="tbl">
                  <thead><tr><th>Student</th><th>Exam</th><th>Submitted</th><th>Status</th><th>Score</th><th>Action</th></tr></thead>
                  <tbody>
                    {submissions.map((sub, i) => {
                      const bank = banks.find(b=>String(b.id)===String(sub.bankId));
                      const isPending = sub.pendingManualGrade && !sub.manualGrade;
                      const isAIGraded = sub.gradedByAI && sub.feedback;
                      const isManualGraded = !!sub.manualGrade;
                      return (
                        <tr key={i}>
                          <td style={{fontWeight:600}}>{sub.student?.split("@")[0]}<br/><span style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{sub.student}</span></td>
                          <td style={{fontSize:12,color:"var(--text2)"}}>{bank?.subject || sub.subject || `Exam #${sub.bankId}`}</td>
                          <td style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{sub.date}</td>
                          <td>
                            {isPending && <span className="tag tag-warn">⏳ Needs Grading</span>}
                            {isAIGraded && <span className="tag tag-success">🤖 AI Graded</span>}
                            {isManualGraded && <span className="tag tag-accent">✏️ Manually Graded</span>}
                          </td>
                          <td style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700}}>
                            {isAIGraded && `${sub.feedback?.overallPct}% (${sub.feedback?.grade})`}
                            {isManualGraded && `${sub.manualGrade?.pct}% (${sub.manualGrade?.grade})`}
                            {isPending && "—"}
                          </td>
                          <td>
                            <button className="btn btn-sm btn-purple" onClick={()=>startManualGrade(sub)}>
                              {isManualGraded ? "✏️ Re-grade" : isPending ? "📝 Grade Now" : "👁 View"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {adminTab === "banks" && (
      <div>
        <div className="grid2" style={{marginBottom:16}}>
        {banks.map((b,i)=>(
          <div key={b.id} className="card" style={{cursor:"pointer",border:selBank===b.id?"1px solid var(--purple)":"1px solid var(--border)",transition:"border .2s"}} onClick={()=>setSelBank(b.id)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{b.subject}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{b.questions.length} questions • {b.questions.reduce((s,q)=>s+(q.marks||10),0)} total marks</div>
                {b.description&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{b.description}</div>}
              </div>
              <div style={{display:"flex",gap:5,flexShrink:0}}>
                <button className="btn btn-sm" onClick={e=>{e.stopPropagation();setEditBank(i);setBankForm({subject:b.subject,description:b.description||""});setShowBankModal(true);}}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();delBank(b.id);}}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
        {banks.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:"40px",color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:13}}>No essay exams yet. Create one above.</div>}
        </div>

      {currentBank&&(
        <div className="card" style={{marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700}}>{currentBank.subject} — Questions ({currentBank.questions.length})</div>
            <button className="btn btn-purple btn-sm" onClick={()=>{setShowQModal(true);setEditQ(null);setQForm({q:"",marks:10,wordGuide:"100-200",modelAnswer:""});}}>+ Add Question</button>
          </div>
          {currentBank.questions.length===0&&<div style={{textAlign:"center",padding:"20px",color:"var(--text3)",fontSize:13}}>No questions yet.</div>}
          {currentBank.questions.map((q,qi)=>(
            <div key={qi} className="card2" style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:4}}>{qi+1}. {q.q}</div>
                  <div style={{display:"flex",gap:8,fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",flexWrap:"wrap"}}>
                    <span style={{color:"var(--accent)"}}>{q.marks||10} marks</span>
                    <span>• {q.wordGuide||"100-200"} words</span>
                    {q.modelAnswer&&<span style={{color:"var(--success)"}}>• Model answer set ✓</span>}
                  </div>
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0}}>
                  <button className="btn btn-sm" onClick={()=>{setEditQ(qi);setQForm({q:q.q,marks:q.marks||10,wordGuide:q.wordGuide||"100-200",modelAnswer:q.modelAnswer||""});setShowQModal(true);}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>delQ(currentBank.id,qi)}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Student attempt tracker */}
      {selBank&&users.length>0&&(
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>Student Attempts</div>
          {users.map(u=>{
            const att = ls(`nv-essay-att-${u.username}`,{})[selBank];
            return (
              <div key={u.username} className="card2" style={{marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
                <div className="user-av" style={{width:30,height:30,fontSize:12}}>{u.username[0].toUpperCase()}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:13}}>{u.username}</div>
                  <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>
                    {att ? `Submitted ${att.date} • Score: ${att.score!==null?`${att.score}/${att.total||100} (${att.pct}%)`:"Pending manual grade"}` : "Not attempted"}
                  </div>
                </div>
                {att&&<button className="btn btn-sm btn-accent" onClick={()=>resetStudentEssay(u.username,selBank)}>🔄 Reset</button>}
                {!att&&<span style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>—</span>}
              </div>
            );
          })}
        </div>
      )}

      {showBankModal&&(
        <div className="modal-overlay" onClick={()=>setShowBankModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editBank!==null?"Edit":"New"} Essay Exam</div><button className="modal-close" onClick={()=>setShowBankModal(false)}>✕</button></div>
            <label className="lbl">Subject / Title</label><input className="inp" value={bankForm.subject} onChange={e=>setBankForm({...bankForm,subject:e.target.value})} placeholder="e.g. Medical-Surgical Nursing Essay" />
            <label className="lbl">Description (optional)</label><input className="inp" value={bankForm.description} onChange={e=>setBankForm({...bankForm,description:e.target.value})} placeholder="Brief description of this essay exam" />
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={saveBank}>Save</button><button className="btn" onClick={()=>setShowBankModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {showQModal&&(
        <div className="modal-overlay" onClick={()=>setShowQModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editQ!==null?"Edit":"Add"} Essay Question</div><button className="modal-close" onClick={()=>setShowQModal(false)}>✕</button></div>
            <label className="lbl">Question</label><textarea className="inp" rows={3} style={{resize:"vertical"}} value={qForm.q} onChange={e=>setQForm({...qForm,q:e.target.value})} placeholder="e.g. Describe the nursing management of a patient with acute myocardial infarction." />
            <div className="form-row">
              <div><label className="lbl">Marks</label><input className="inp" type="number" min="1" max="100" value={qForm.marks} onChange={e=>setQForm({...qForm,marks:e.target.value})} /></div>
              <div><label className="lbl">Word Guide</label><input className="inp" value={qForm.wordGuide} onChange={e=>setQForm({...qForm,wordGuide:e.target.value})} placeholder="e.g. 150-250" /></div>
            </div>
            <label className="lbl">Model Answer (guides AI grading)</label><textarea className="inp" rows={4} style={{resize:"vertical"}} value={qForm.modelAnswer} onChange={e=>setQForm({...qForm,modelAnswer:e.target.value})} placeholder="Key points the AI should look for when grading this question..." />
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={saveQ}>Save</button><button className="btn" onClick={()=>setShowQModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  );
}

// ── Admin Handouts ───────────────────────────────────────────────────

export function AdminHandouts({ toast }) {
  const [handouts, setHandouts] = useSharedData("nv-handouts", []);
  const [folders, setFolders] = useSharedData("nv-folders", {});
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [viewTab, setViewTab] = useState("list");
  const [showInitModal, setShowInitModal] = useState(false);
  const [initClass, setInitClass] = useState("");
  const [renameLec, setRenameLec] = useState(null);
  const [renameLecVal, setRenameLecVal] = useState("");

  // ── Multi-select state ──────────────────────────────────────────
  const [selMode, setSelMode]       = useState(false);
  const [selClasses, setSelClasses] = useState(new Set());   // class IDs
  const [selCourses, setSelCourses] = useState(new Set());   // "classId::course"
  const [selHandouts, setSelHandouts] = useState(new Set()); // handout IDs

  const clearSel = () => { setSelClasses(new Set()); setSelCourses(new Set()); setSelHandouts(new Set()); };
  const exitSel  = () => { setSelMode(false); clearSel(); };

  const togClass   = (id)  => setSelClasses(s  => { const n=new Set(s); n.has(id)  ? n.delete(id)  : n.add(id);  return n; });
  const togCourse  = (key) => setSelCourses(s  => { const n=new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const togHandout = (id)  => setSelHandouts(s => { const n=new Set(s); n.has(id)  ? n.delete(id)  : n.add(id);  return n; });

  const totalSel = selClasses.size + selCourses.size + selHandouts.size;

  // Toggle all handouts in list view
  const allHandoutsSelected = handouts.length > 0 && handouts.every(h => selHandouts.has(h.id));
  const togAllHandouts = () => {
    if (allHandoutsSelected) setSelHandouts(s => { const n=new Set(s); handouts.forEach(h=>n.delete(h.id)); return n; });
    else setSelHandouts(s => { const n=new Set(s); handouts.forEach(h=>n.add(h.id)); return n; });
  };

  // ── Bulk delete selected items ──────────────────────────────────
  const deleteSelected = () => {
    if (!totalSel) return toast("Nothing selected","error");
    const parts = [];
    if (selClasses.size)  parts.push(`${selClasses.size} class folder${selClasses.size>1?"s":""}`);
    if (selCourses.size)  parts.push(`${selCourses.size} course folder${selCourses.size>1?"s":""}`);
    if (selHandouts.size) parts.push(`${selHandouts.size} handout${selHandouts.size>1?"s":""}`);
    if (!confirm(`Permanently delete ${parts.join(", ")} and all their contents?`)) return;

    let f = {...folders};
    let h = [...handouts];

    // Remove entire class folders + all their handouts
    selClasses.forEach(classId => {
      delete f[classId];
      h = h.filter(x => x.classId !== classId);
    });

    // Remove selected course folders (skip if parent class already deleted)
    selCourses.forEach(key => {
      const sep = key.indexOf("::");
      const classId = key.slice(0, sep);
      const course  = key.slice(sep + 2);
      if (selClasses.has(classId)) return;
      if (f[classId]) delete f[classId][course];
      h = h.filter(x => !(x.classId===classId && x.course===course));
    });

    // Remove individually selected handouts
    h = h.filter(x => !selHandouts.has(x.id));

    saveFolders(f);
    setHandouts(h); saveShared("handouts", h);
    toast(`🗑️ Deleted: ${parts.join(", ")}`, "success");
    exitSel();
  };

  // ── Standard single-item helpers ────────────────────────────────
  const del = (id) => { const u=handouts.filter(h=>h.id!==id); setHandouts(u); saveShared("handouts",u); toast("Deleted","success"); };
  const clearAll = () => { if(!confirm("Delete ALL handouts?"))return; setHandouts([]); saveShared("handouts",[]); toast("All handouts cleared","warn"); };
  const saveFolders = (f) => {
    lsSet("nv-folders", f);    // update localStorage immediately
    setFolders(f);              // update React state immediately
    dispatchSync();             // notify all useSharedData hooks
    saveFoldersToBackend(f);    // write to Firestore, bypassing merge
  };

  const deleteCourseFolder = (classId, course) => {
    if(!confirm(`Delete course folder "${course}" and all handouts inside it?`)) return;
    const f = {...folders};
    if(f[classId]) { delete f[classId][course]; }
    saveFolders(f);
    const u = handouts.filter(h=>!(h.classId===classId&&h.course===course));
    setHandouts(u); saveShared("handouts",u);
    toast(`📂 Course folder "${course}" deleted`,"success");
  };

  const deleteLecturerFolder = (classId, course, lecName) => {
    if(!confirm(`Delete lecturer folder "${lecName}" from ${course}? Their handouts will also be removed.`)) return;
    const f = {...folders};
    if(f[classId]?.[course]) { f[classId][course] = f[classId][course].filter(l=>l!==lecName); }
    saveFolders(f);
    const u = handouts.filter(h=>!(h.classId===classId&&h.course===course&&(h.lecturerName===lecName||h.uploadedBy?.split("@")[0]===lecName)));
    setHandouts(u); saveShared("handouts",u);
    toast(`👨🏫 Lecturer folder "${lecName}" deleted`,"success");
  };

  const doRenameLecturer = () => {
    if(!renameLecVal.trim()) return toast("Enter a name","error");
    const {classId, course, oldName} = renameLec;
    const f = {...folders};
    if(f[classId]?.[course]) { f[classId][course] = f[classId][course].map(l=>l===oldName?renameLecVal.trim():l); }
    saveFolders(f);
    const u = handouts.map(h=>{
      if(h.classId===classId&&h.course===course&&(h.lecturerName===oldName||h.uploadedBy?.split("@")[0]===oldName))
        return {...h,lecturerName:renameLecVal.trim()};
      return h;
    });
    setHandouts(u); saveShared("handouts",u);
    toast(`✅ Renamed "${oldName}" → "${renameLecVal.trim()}"`,"success");
    setRenameLec(null); setRenameLecVal("");
  };

  const initFoldersForClass = () => {
    if (!initClass) return toast("Select a class","error");
    const cls = classes.find(c=>c.id===initClass); if (!cls) return;
    const existing = folders[initClass]||{};
    const newFolders = {...existing};
    (cls.courses||[]).forEach(course=>{ if(!newFolders[course]) newFolders[course]=[]; });
    saveFolders({...folders,[initClass]:newFolders});
    toast(`✅ All ${(cls.courses||[]).length} course folders created for ${cls.label}!`,"success");
    setShowInitModal(false); setInitClass("");
  };

  const initAllFolders = () => {
    if(!confirm("Create course folders for ALL classes? This sets up the default course structure.")) return;
    const f = {...folders};
    classes.forEach(cls=>{ if(!f[cls.id]) f[cls.id]={}; (cls.courses||[]).forEach(course=>{ if(!f[cls.id][course]) f[cls.id][course]=[]; }); });
    saveFolders(f);
    toast("✅ Course folders initialized for all classes!","success");
  };

  // Checkbox style helper
  const cbStyle = { width:17, height:17, cursor:"pointer", accentColor:"var(--danger)", flexShrink:0 };

  return (
    <div>
      {/* ── Header bar ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">📄 Handouts Management ({handouts.length})</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className={`btn btn-sm${viewTab==="list"?" btn-accent":""}`}
            onClick={()=>{ setViewTab("list"); exitSel(); }}>📋 Handouts List</button>
          <button className={`btn btn-sm${viewTab==="folders"?" btn-accent":""}`}
            onClick={()=>{ setViewTab("folders"); exitSel(); }}>📁 Folder Structure</button>
          <button
            className={`btn btn-sm${selMode?" btn-warn":""}`}
            onClick={()=>selMode ? exitSel() : setSelMode(true)}
            title={selMode?"Exit selection mode":"Select items to delete in bulk"}>
            {selMode ? "✕ Cancel Select" : "☑️ Select & Delete"}
          </button>
          {handouts.length>0&&!selMode&&<button className="btn btn-danger btn-sm" onClick={clearAll}>🗑️ Clear All</button>}
        </div>
      </div>

      {/* ── Selection hint / bulk-delete toolbar ── */}
      {selMode && totalSel === 0 && (
        <div style={{marginBottom:14,padding:"10px 14px",background:"rgba(234,179,8,.08)",border:"1px dashed rgba(234,179,8,.4)",borderRadius:9,fontSize:12,color:"var(--warn)",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:18}}>☑️</span>
          <span><b>Select mode active.</b> Tick checkboxes on class folders, course folders, or individual handouts — then hit <b>Delete Selected</b>.</span>
        </div>
      )}
      {selMode && totalSel > 0 && (
        <div className="bulk-bar" style={{marginBottom:14}}>
          <span className="bulk-bar-count">
            ☑ {totalSel} selected
            {selClasses.size>0  && <span style={{marginLeft:8,fontSize:11,opacity:.8}}>({selClasses.size} class{selClasses.size>1?"es":""})</span>}
            {selCourses.size>0  && <span style={{marginLeft:4,fontSize:11,opacity:.8}}>({selCourses.size} course folder{selCourses.size>1?"s":""})</span>}
            {selHandouts.size>0 && <span style={{marginLeft:4,fontSize:11,opacity:.8}}>({selHandouts.size} handout{selHandouts.size>1?"s":""})</span>}
          </span>
          <button className="btn btn-sm btn-danger" onClick={deleteSelected}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={clearSel}>✕ Clear</button>
        </div>
      )}

      {/* ════ FOLDER STRUCTURE VIEW ════ */}
      {viewTab==="folders"&&(
        <div>
          <div style={{background:"rgba(0,119,182,.07)",border:"1px solid rgba(0,119,182,.18)",borderRadius:10,padding:"12px 16px",fontSize:13,color:"var(--accent2)",marginBottom:16,display:"flex",gap:10,alignItems:"flex-start"}}>
            <span>📁</span>
            <div>
              <b>Folder Structure</b><br/>
              <span style={{fontSize:12}}>Manage class → course → lecturer folders.
                {selMode ? " Checkboxes are active — tick to select for deletion." : " Use ☑️ Select & Delete above to bulk-remove."}
              </span>
            </div>
          </div>
          {!selMode&&(
            <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
              <button className="btn btn-accent" onClick={initAllFolders}>⚡ Initialize All Classes</button>
              <button className="btn btn-sm btn-purple" onClick={()=>{setInitClass("");setShowInitModal(true);}}>+ Init One Class</button>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {classes.map(cls=>{
              const classFolders = folders[cls.id]||{};
              const courseList = Object.keys(classFolders);
              const classSelected = selClasses.has(cls.id);
              return (
                <div key={cls.id} className="card" style={{
                  borderLeft:`4px solid ${cls.color||"var(--accent)"}`,
                  outline: classSelected ? "2px solid var(--danger)" : "none",
                  background: classSelected ? "rgba(239,68,68,.04)" : "",
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:courseList.length?12:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      {selMode&&(
                        <input type="checkbox" style={cbStyle}
                          checked={classSelected}
                          onChange={()=>togClass(cls.id)}
                          title="Select entire class folder" />
                      )}
                      <div>
                        <div style={{fontWeight:800,fontSize:14}}>{cls.label}</div>
                        <div style={{fontSize:11,color:"var(--text3)"}}>{cls.desc} • {courseList.length} course folder{courseList.length!==1?"s":""}</div>
                      </div>
                    </div>
                    {!selMode&&(
                      <button className="btn btn-sm" onClick={()=>{
                        const existing=folders[cls.id]||{};
                        const newF={...existing};
                        (cls.courses||[]).forEach(c=>{ if(!newF[c]) newF[c]=[]; });
                        saveFolders({...folders,[cls.id]:newF});
                        toast(`✅ Folders for ${cls.label} synced!`,"success");
                      }}>⚡ Sync</button>
                    )}
                  </div>

                  {courseList.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {courseList.map(course=>{
                        const courseKey = `${cls.id}::${course}`;
                        const courseSelected = selCourses.has(courseKey) || classSelected;
                        const lecturers = classFolders[course]||[];
                        const hCount = handouts.filter(h=>h.classId===cls.id&&h.course===course).length;
                        const fromHandouts = [...new Set(handouts.filter(h=>h.classId===cls.id&&h.course===course).map(h=>h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown"))];
                        const allLecturers = [...new Set([...lecturers,...fromHandouts])];
                        return (
                          <div key={course} style={{
                            background: courseSelected ? "rgba(239,68,68,.06)" : "var(--bg4)",
                            borderRadius:9, padding:"10px 12px",
                            border: courseSelected ? "1px solid rgba(239,68,68,.3)" : "1px solid var(--border)",
                          }}>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:allLecturers.length?8:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                {selMode&&(
                                  <input type="checkbox" style={cbStyle}
                                    checked={courseSelected}
                                    disabled={classSelected}
                                    onChange={()=>togCourse(courseKey)}
                                    title="Select course folder" />
                                )}
                                <span style={{fontSize:16}}>📂</span>
                                <div>
                                  <div style={{fontWeight:700,fontSize:13}}>{course}</div>
                                  <div style={{fontSize:10,color:"var(--text3)"}}>{allLecturers.length} lecturer{allLecturers.length!==1?"s":" "} • {hCount} file{hCount!==1?"s":""}</div>
                                </div>
                              </div>
                              {!selMode&&(
                                <button className="btn btn-sm btn-danger" onClick={()=>deleteCourseFolder(cls.id,course)} title="Delete course folder">🗑️ Delete</button>
                              )}
                            </div>
                            {allLecturers.length>0&&(
                              <div style={{display:"flex",flexWrap:"wrap",gap:6,paddingLeft: selMode ? 26 : 8}}>
                                {allLecturers.map(lec=>{
                                  const lhCount=handouts.filter(h=>h.classId===cls.id&&h.course===course&&(h.lecturerName===lec||h.uploadedBy?.split("@")[0]===lec)).length;
                                  return (
                                    <div key={lec} style={{display:"flex",alignItems:"center",gap:4,fontSize:11,padding:"3px 8px",borderRadius:7,border:"1px solid var(--border2)",background:"rgba(124,58,237,.06)"}}>
                                      <span>👨🏫</span>
                                      <span style={{color:"var(--purple)",fontWeight:600}}>{lec}</span>
                                      <span style={{color:"var(--text3)"}}>({lhCount})</span>
                                      {!selMode&&<>
                                        <button title="Rename" onClick={()=>{setRenameLec({classId:cls.id,course,oldName:lec});setRenameLecVal(lec);}}
                                          style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--accent)",padding:"0 2px"}}>✏️</button>
                                        <button title="Delete" onClick={()=>deleteLecturerFolder(cls.id,course,lec)}
                                          style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--danger)",padding:"0 2px"}}>✕</button>
                                      </>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {courseList.length===0&&(
                    <div style={{fontSize:12,color:"var(--text3)",paddingLeft:selMode?26:0}}>No folders yet — click "Sync" to create from class defaults</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ════ HANDOUTS LIST VIEW ════ */}
      {viewTab==="list"&&(
        handouts.length===0
          ? <div style={{textAlign:"center",padding:"40px",color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:13}}>No handouts uploaded yet.</div>
          : (
          <div className="card" style={{padding:0,overflow:"hidden"}}>
            <table className="tbl">
              <thead>
                <tr>
                  {selMode&&(
                    <th style={{width:38,padding:"10px 8px"}}>
                      <input type="checkbox" style={{...cbStyle,accentColor:"var(--accent)"}}
                        checked={allHandoutsSelected}
                        onChange={togAllHandouts}
                        title="Select / deselect all" />
                    </th>
                  )}
                  <th>Title</th><th>Class</th><th>Course</th><th>Lecturer</th><th>Date</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {handouts.map(h=>{
                  const c = classes.find(x=>x.id===h.classId);
                  const hSel = selHandouts.has(h.id);
                  return (
                    <tr key={h.id} style={{background: hSel ? "rgba(239,68,68,.06)" : ""}}>
                      {selMode&&(
                        <td style={{padding:"8px"}}>
                          <input type="checkbox" style={cbStyle} checked={hSel} onChange={()=>togHandout(h.id)} />
                        </td>
                      )}
                      <td style={{fontWeight:600}}>{h.title}{h.pdfName&&<span style={{marginLeft:5,fontSize:10,color:"var(--danger)"}}>📄</span>}</td>
                      <td><span className="tag tag-accent">{c?.label||"General"}</span></td>
                      <td style={{fontSize:12,color:"var(--text3)"}}>{h.course||"—"}</td>
                      <td style={{fontSize:12,color:"var(--purple)"}}>{h.lecturerName||h.uploadedBy?.split("@")[0]||"—"}</td>
                      <td style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{h.date}</td>
                      <td><button className="btn btn-sm btn-danger" onClick={()=>del(h.id)}>🗑️</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Rename Lecturer Modal ── */}
      {renameLec&&(
        <div className="modal-overlay" onClick={()=>setRenameLec(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">✏️ Rename Lecturer</div><button className="modal-close" onClick={()=>setRenameLec(null)}>✕</button></div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>
              Renaming <b>"{renameLec.oldName}"</b> in course <b>{renameLec.course}</b>. This will also update their name on all uploaded handouts.
            </div>
            <label className="lbl">New Lecturer Name</label>
            <input className="inp" value={renameLecVal} onChange={e=>setRenameLecVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doRenameLecturer()} autoFocus />
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={doRenameLecturer}>✅ Rename</button>
              <button className="btn" onClick={()=>setRenameLec(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Init Folders Modal ── */}
      {showInitModal&&(
        <div className="modal-overlay" onClick={()=>setShowInitModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">⚡ Initialize Course Folders</div><button className="modal-close" onClick={()=>setShowInitModal(false)}>✕</button></div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>Creates empty course folders for all default courses in the selected class.</div>
            <label className="lbl">Select Class</label>
            <select className="inp" value={initClass} onChange={e=>setInitClass(e.target.value)}>
              <option value="">— Choose a class —</option>
              {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {initClass&&(
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Will create folders for:</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {(classes.find(c=>c.id===initClass)?.courses||[]).map(c=><span key={c} style={{fontSize:11,padding:"2px 8px",borderRadius:6,border:"1px solid var(--border2)",color:"var(--accent2)"}}>📂 {c}</span>)}
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={initFoldersForClass}>⚡ Create Folders</button>
              <button className="btn" onClick={()=>setShowInitModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// STUDENT VIEWS
// ════════════════════════════════════════════════════════════════════

export function AdminSchoolPQ({ toast }) {
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [data, setData] = useSharedData("nv-school-pq", {});
  // Navigation state: class → course → question type
  const [selClass, setSelClass] = useState(null);
  const [selCourse, setSelCourse] = useState(null);
  const [qTab, setQTab] = useState("mcq"); // "mcq" | "essay"
  // MCQ state
  const [mcqMode, setMcqMode] = useState("single"); // "single" | "paste"
  const [singleForm, setSingleForm] = useState({q:"",options:["","","",""],ans:0,year:""});
  const [pasteText, setPasteText] = useState("");
  const [pasteAnswers, setPasteAnswers] = useState("");
  const [parsed, setParsed] = useState([]);
  const [editMcqIdx, setEditMcqIdx] = useState(null);
  // Essay state
  const [essayMode, setEssayMode] = useState("single");
  const [essayForm, setEssayForm] = useState({q:"",marks:"10",modelAnswer:"",year:""});
  const [essayPasteText, setEssayPasteText] = useState("");
  const [essayPasteAnswers, setEssayPasteAnswers] = useState("");
  const [essayParsed, setEssayParsed] = useState([]);
  const [editEssayIdx, setEditEssayIdx] = useState(null);

  const saveData = async (nd) => {
    setData(nd);
    const ok = await saveShared("schoolPQ", nd);
    if (!ok) toast("⚠️ Saved locally but failed to sync — check connection","warn");
    return ok;
  };

  // key: classId__courseName
  const courseKey = (cid, course) => `${cid}__${course}`;
  const getCourse = (cid, course) => data[courseKey(cid,course)] || {mcq:[],essay:[]};
  const saveCourse = async (cid, course, courseData) => saveData({...data,[courseKey(cid,course)]:courseData});

  // ── MCQ parse ──
  const parseMCQ = () => {
    const blocks = pasteText.trim().split(/\n\s*\n+/).filter(b=>b.trim());
    const ansLines = pasteAnswers.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const items = blocks.map((block,idx)=>{
      const lines = block.split("\n").map(l=>l.trim()).filter(Boolean);
      let q="",options=["","","",""],ans=0,year="";
      lines.forEach(line=>{
        const ansM = line.match(/^(?:ANS|ANSWER|Ans|Answer)[.:)]\s*([A-Da-d])/i);
        const yearM = line.match(/^(?:YEAR|Year)[.:)]\s*(\d{4})/i);
        if(ansM){ans="ABCD".indexOf(ansM[1].toUpperCase());if(ans<0)ans=0;return;}
        if(yearM){year=yearM[1];return;}
        const m=line.match(/^([QqAaBbCcDd])[.):\s]\s*(.+)$/);
        if(m){
          const l2=m[1].toUpperCase();
          if(l2==="Q")q=m[2];
          else if(l2==="A")options[0]=m[2];
          else if(l2==="B")options[1]=m[2];
          else if(l2==="C")options[2]=m[2];
          else if(l2==="D")options[3]=m[2];
        } else if(!q) q=line.replace(/^\d+[.)]\s*/,"");
      });
      // Override with answers column if provided
      if (ansLines[idx]) { const a="ABCD".indexOf(ansLines[idx][0]?.toUpperCase()); if(a>=0)ans=a; }
      return {q:q.trim(),options,ans,year};
    }).filter(i=>i.q&&i.options.some(o=>o));
    setParsed(items);
    if(!items.length)toast("No questions parsed. Check format.","error");
    else toast(`${items.length} MCQ(s) parsed!`,"success");
  };

  const importMCQ = async () => {
    if(!parsed.length||!selClass||!selCourse)return;
    const cd=getCourse(selClass,selCourse);
    const nd={...data,[courseKey(selClass,selCourse)]:{...cd,mcq:[...cd.mcq,...parsed.map(p=>({...p,id:Date.now()+Math.random()}))]}};
    setData(nd);
    const ok = await saveShared("schoolPQ", nd);
    if (ok) {
      toast(`${parsed.length} MCQ(s) added & synced! ✅`,"success");
    } else {
      toast(`${parsed.length} MCQ(s) saved locally — ⚠️ sync failed`,"warn");
    }
    setParsed([]); setPasteText(""); setPasteAnswers("");
  };

  const saveSingleMCQ = () => {
    if(!singleForm.q.trim())return toast("Question required","error");
    if(!singleForm.options[0]||!singleForm.options[1])return toast("At least options A & B required","error");
    const cd=getCourse(selClass,selCourse);
    const q={q:singleForm.q.trim(),options:singleForm.options.map(o=>o.trim()),ans:singleForm.ans,year:singleForm.year,id:Date.now()};
    const mcq=editMcqIdx!==null?cd.mcq.map((qq,i)=>i===editMcqIdx?q:qq):[...cd.mcq,q];
    saveCourse(selClass,selCourse,{...cd,mcq});
    setSingleForm({q:"",options:["","","",""],ans:0,year:""});setEditMcqIdx(null);
    toast(editMcqIdx!==null?"MCQ updated":"MCQ added","success");
  };

  const delMCQ = (i) => {
    const cd=getCourse(selClass,selCourse);
    saveCourse(selClass,selCourse,{...cd,mcq:cd.mcq.filter((_,idx)=>idx!==i)});
    toast("Deleted","success");
  };

  // ── Essay parse ──
  const parseEssay = () => {
    const blocks = essayPasteText.trim().split(/\n\s*\n+/).filter(b=>b.trim());
    const ansLines = essayPasteAnswers.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const items = blocks.map((block,idx)=>{
      const lines=block.split("\n").map(l=>l.trim()).filter(Boolean);
      let q="",marks="10",modelAnswer="",year="";
      lines.forEach(line=>{
        const marksM=line.match(/^(?:MARKS?|Mark|Points?)[.:)]\s*(\d+)/i);
        const ansM=line.match(/^(?:ANSWER|MODEL\s*ANSWER|Key|Hint)[.:)]\s*(.+)/i);
        const yearM=line.match(/^(?:YEAR|Year)[.:)]\s*(\d{4})/i);
        const qM=line.match(/^(?:Q|QUESTION)[.:)]\s*(.+)/i);
        if(marksM){marks=marksM[1];return;}
        if(ansM){modelAnswer=ansM[1];return;}
        if(yearM){year=yearM[1];return;}
        if(qM){q=qM[1];return;}
        if(!q) q=line.replace(/^\d+[.)]\s*/,"");
      });
      // Override model answer with answers column if provided
      if (ansLines[idx]) modelAnswer = ansLines[idx];
      return {q:q.trim(),marks,modelAnswer,year};
    }).filter(i=>i.q);
    setEssayParsed(items);
    if(!items.length)toast("No essay questions parsed. Check format.","error");
    else toast(`${items.length} essay question(s) parsed!`,"success");
  };

  const importEssay = () => {
    if(!essayParsed.length||!selClass||!selCourse)return;
    const cd=getCourse(selClass,selCourse);
    saveCourse(selClass,selCourse,{...cd,essay:[...cd.essay,...essayParsed.map(p=>({...p,id:Date.now()+Math.random()}))]});
    setEssayParsed([]); setEssayPasteText(""); setEssayPasteAnswers(""); toast(`${essayParsed.length} essay question(s) added!`,"success");
  };

  const saveSingleEssay = () => {
    if(!essayForm.q.trim())return toast("Question required","error");
    const cd=getCourse(selClass,selCourse);
    const q={q:essayForm.q.trim(),marks:essayForm.marks,modelAnswer:essayForm.modelAnswer,year:essayForm.year,id:Date.now()};
    const essay=editEssayIdx!==null?cd.essay.map((qq,i)=>i===editEssayIdx?q:qq):[...cd.essay,q];
    saveCourse(selClass,selCourse,{...cd,essay});
    setEssayForm({q:"",marks:"10",modelAnswer:"",year:""});setEditEssayIdx(null);
    toast(editEssayIdx!==null?"Essay updated":"Essay question added","success");
  };

  const delEssay = (i) => {
    const cd=getCourse(selClass,selCourse);
    saveCourse(selClass,selCourse,{...cd,essay:cd.essay.filter((_,idx)=>idx!==i)});
    toast("Deleted","success");
  };

  const currentClass = classes.find(c=>c.id===selClass);
  const cd = selClass&&selCourse ? getCourse(selClass,selCourse) : null;

  return (
    <div>
      <div className="sec-title" style={{marginBottom:4}}>🏫 School Past Questions</div>
      <div style={{fontSize:12,color:"var(--text3)",marginBottom:18}}>Organised by class → course. Add MCQ and essay past questions. Students can practice by class and course.</div>

      {/* ── STEP 1: Select Class ── */}
      <div style={{marginBottom:16}}>
        <label className="lbl">Step 1: Select Class</label>
        <select className="inp" value={selClass||""} onChange={e=>{setSelClass(e.target.value||null);setSelCourse(null);setParsed([]);setPasteText("");setPasteAnswers("");setEssayParsed([]);setEssayPasteText("");setEssayPasteAnswers("");}}>
          <option value="">— Select a class —</option>
          {classes.map(c=><option key={c.id} value={c.id}>{c.label} — {c.desc}</option>)}
        </select>
      </div>

      {selClass && currentClass && (
        <div style={{marginBottom:16}}>
          <label className="lbl">Step 2: Select Course</label>
          <select className="inp" value={selCourse||""} onChange={e=>{setSelCourse(e.target.value||null);setParsed([]);setPasteText("");setPasteAnswers("");setEssayParsed([]);setEssayPasteText("");setEssayPasteAnswers("");setEditMcqIdx(null);setEditEssayIdx(null);}}>
            <option value="">— Select a course —</option>
            {(currentClass.courses||[]).map(course=>{
              const cData=getCourse(selClass,course);
              return <option key={course} value={course}>{course} ({cData.mcq.length} MCQ, {cData.essay.length} Essay)</option>;
            })}
          </select>
        </div>
      )}

      {selClass && selCourse && cd && (
        <div>
          {/* Class + Course breadcrumb */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,padding:"10px 14px",background:"rgba(0,119,182,.07)",borderRadius:10,border:"1px solid rgba(0,119,182,.18)",flexWrap:"wrap"}}>
            <span style={{fontSize:18}}>{currentClass?.color?<span style={{width:10,height:10,borderRadius:"50%",background:currentClass.color,display:"inline-block",marginRight:4}}/>:""}</span>
            <span style={{fontWeight:800,color:"var(--accent)"}}>{currentClass?.label}</span>
            <span style={{color:"var(--text3)"}}>›</span>
            <span style={{fontWeight:800,color:"var(--text)"}}>{selCourse}</span>
            <span style={{marginLeft:"auto",fontSize:11,color:"var(--text3)"}}>{cd.mcq.length} MCQ • {cd.essay.length} Essay</span>
          </div>

          {/* MCQ / Essay tabs */}
          <div style={{display:"flex",gap:8,marginBottom:18}}>
            {[{key:"mcq",icon:"📝",label:"MCQ Past Questions"},{key:"essay",icon:"✍️",label:"Essay Past Questions"}].map(t=>(
              <div key={t.key} onClick={()=>{setQTab(t.key);setEditMcqIdx(null);setEditEssayIdx(null);}} style={{
                flex:1,padding:"10px 14px",borderRadius:10,cursor:"pointer",transition:"all .2s",textAlign:"center",
                border:`2px solid ${qTab===t.key?"var(--accent)":"var(--border)"}`,
                background:qTab===t.key?"rgba(0,119,182,.1)":"var(--card)"}}>
                <div style={{fontSize:20,marginBottom:3}}>{t.icon}</div>
                <div style={{fontWeight:800,fontSize:13,color:qTab===t.key?"var(--accent)":"var(--text)"}}>{t.label}</div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>{t.key==="mcq"?cd.mcq.length:cd.essay.length} question{(t.key==="mcq"?cd.mcq.length:cd.essay.length)!==1?"s":""}</div>
              </div>
            ))}
          </div>

          {/* ══ MCQ SECTION ══ */}
          {qTab==="mcq"&&(
            <div>
              {/* Mode toggle */}
              <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
                <div style={{fontWeight:800,fontSize:13,flex:1,color:"var(--accent)"}}>Add MCQ Questions</div>
                <button className={`btn btn-sm${mcqMode==="single"?" btn-accent":""}`} onClick={()=>{setMcqMode("single");setEditMcqIdx(null);}}>✏️ Single</button>
                <button className={`btn btn-sm${mcqMode==="paste"?" btn-accent":""}`} onClick={()=>setMcqMode("paste")}>📋 Paste Multiple</button>
              </div>

              {/* Single MCQ form */}
              {mcqMode==="single"&&(
                <div className="card2" style={{marginBottom:14}}>
                  <div style={{fontWeight:800,marginBottom:10,fontSize:13,color:"var(--accent)"}}>{editMcqIdx!==null?`✏️ Edit Question ${editMcqIdx+1}`:"✏️ New MCQ Question"}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginBottom:8}}>
                    <div>
                      <label className="lbl">Question Text *</label>
                      <textarea className="inp" rows={3} style={{resize:"vertical",marginBottom:0}} value={singleForm.q}
                        onChange={e=>setSingleForm({...singleForm,q:e.target.value})} placeholder="Type the question here..." />
                    </div>
                    <div style={{minWidth:90}}>
                      <label className="lbl">Year</label>
                      <input className="inp" style={{marginBottom:0}} placeholder="e.g. 2023" value={singleForm.year}
                        onChange={e=>setSingleForm({...singleForm,year:e.target.value})} />
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    {["A","B","C","D"].map((l,i)=>(
                      <div key={l}>
                        <label className="lbl">Option {l}{i<2?" *":""}</label>
                        <input className="inp" style={{marginBottom:0}} placeholder={`Option ${l}...`} value={singleForm.options[i]}
                          onChange={e=>{const o=[...singleForm.options];o[i]=e.target.value;setSingleForm({...singleForm,options:o});}} />
                      </div>
                    ))}
                  </div>
                  <label className="lbl">Correct Answer *</label>
                  <select className="inp" value={singleForm.ans} onChange={e=>setSingleForm({...singleForm,ans:+e.target.value})}>
                    {["A","B","C","D"].map((l,i)=><option key={l} value={i}>Option {l}{singleForm.options[i]?`: ${singleForm.options[i]}`:""}</option>)}
                  </select>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn btn-accent" onClick={saveSingleMCQ}>{editMcqIdx!==null?"💾 Update":"➕ Add MCQ"}</button>
                    {editMcqIdx!==null&&<button className="btn" onClick={()=>{setEditMcqIdx(null);setSingleForm({q:"",options:["","","",""],ans:0,year:""});}}>Cancel</button>}
                  </div>
                </div>
              )}

              {/* Paste MCQ */}
              {mcqMode==="paste"&&(
                <div className="card2" style={{marginBottom:14}}>
                  <div style={{fontWeight:800,marginBottom:8,fontSize:13,color:"var(--accent)"}}>📋 Paste Multiple MCQ Questions</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--accent)",marginBottom:4}}>📝 Questions (with A/B/C/D options)</div>
                      <textarea className="paste-box" rows={12}
                        placeholder={"Q: Which nerve controls the diaphragm?\nA: Vagus nerve\nB: Phrenic nerve\nC: Intercostal nerve\nD: Brachial nerve\nYEAR: 2023\n\nQ: Normal CVP is:\nA: 0-2 cmH2O\nB: 2-6 cmH2O\nC: 5-10 cmH2O\nD: 10-15 cmH2O"}
                        value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsed([]);}} />
                    </div>
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ Answers (one per line: A / B / C / D)</div>
                      <textarea className="paste-box" rows={12}
                        placeholder={"B\nC"}
                        value={pasteAnswers} onChange={e=>{setPasteAnswers(e.target.value);setParsed([]);}} style={{borderColor:"rgba(34,197,94,.35)"}} />
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button className="btn btn-accent" onClick={parseMCQ}>🔍 Auto-Parse</button>
                    {parsed.length>0&&<button className="btn btn-success" onClick={importMCQ}>✅ Add {parsed.length} MCQ{parsed.length!==1?"s":""}</button>}
                    <button className="btn" onClick={()=>{setParsed([]);setPasteText("");setPasteAnswers("");}}>🗑️ Clear</button>
                  </div>
                  {parsed.length>0&&(
                    <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
                      <div style={{padding:"8px 12px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>✓ {parsed.length} parsed — review then click "Add MCQs"</div>
                      {parsed.map((p,i)=>(
                        <div key={i} style={{padding:"8px 12px",borderTop:"1px solid var(--border)"}}>
                          <div style={{fontWeight:700,fontSize:12,marginBottom:4}}>{i+1}. {p.q}{p.year?<span style={{color:"var(--text3)",fontWeight:400}}> ({p.year})</span>:""}</div>
                          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                            {p.options.filter(o=>o).map((opt,oi)=>(
                              <span key={oi} style={{fontSize:11,padding:"2px 7px",borderRadius:5,
                                background:oi===p.ans?"rgba(34,197,94,.15)":"var(--bg4)",
                                border:`1px solid ${oi===p.ans?"var(--success)":"var(--border)"}`,
                                color:oi===p.ans?"var(--success)":"var(--text3)",fontWeight:oi===p.ans?800:400
                              }}>{"ABCD"[oi]}. {opt}{oi===p.ans?" ✓":""}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* MCQ List */}
              <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>📝 {cd.mcq.length} MCQ Question{cd.mcq.length!==1?"s":""}</div>
              {cd.mcq.length===0&&<div style={{textAlign:"center",padding:20,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:10,fontSize:13}}>No MCQ questions yet. Add above.</div>}
              {cd.mcq.map((q,qi)=>(
                <div key={qi} className="card2" style={{marginBottom:8,borderLeft:`3px solid ${qi===editMcqIdx?"var(--accent)":"var(--border)"}`}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{width:24,height:24,borderRadius:7,background:"rgba(0,119,182,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"var(--accent)",flexShrink:0}}>{qi+1}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13,marginBottom:5}}>{q.q}{q.year?<span style={{fontSize:10,color:"var(--text3)",fontWeight:400,marginLeft:6}}>({q.year})</span>:""}</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {q.options.filter(o=>o).map((opt,oi)=>(
                          <span key={oi} style={{fontSize:11,padding:"2px 8px",borderRadius:5,
                            background:oi===q.ans?"rgba(34,197,94,.12)":"transparent",
                            border:`1px solid ${oi===q.ans?"var(--success)":"var(--border)"}`,
                            color:oi===q.ans?"var(--success)":"var(--text3)",fontWeight:oi===q.ans?800:400
                          }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:4,flexShrink:0}}>
                      <button className="btn btn-sm" onClick={()=>{setSingleForm({q:q.q,options:[...q.options],ans:q.ans,year:q.year||""});setEditMcqIdx(qi);setMcqMode("single");}}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={()=>delMCQ(qi)}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ══ ESSAY SECTION ══ */}
          {qTab==="essay"&&(
            <div>
              <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
                <div style={{fontWeight:800,fontSize:13,flex:1,color:"var(--purple)"}}>Add Essay Questions</div>
                <button className={`btn btn-sm${essayMode==="single"?" btn-purple":""}`} onClick={()=>{setEssayMode("single");setEditEssayIdx(null);}}>✏️ Single</button>
                <button className={`btn btn-sm${essayMode==="paste"?" btn-purple":""}`} onClick={()=>setEssayMode("paste")}>📋 Paste Multiple</button>
              </div>

              {/* Single essay form */}
              {essayMode==="single"&&(
                <div className="card2" style={{marginBottom:14,border:"1px solid rgba(124,58,237,.2)"}}>
                  <div style={{fontWeight:800,marginBottom:10,fontSize:13,color:"var(--purple)"}}>{editEssayIdx!==null?`✏️ Edit Essay Q${editEssayIdx+1}`:"✏️ New Essay Question"}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px",gap:8,marginBottom:8}}>
                    <div>
                      <label className="lbl">Question / Essay Prompt *</label>
                      <textarea className="inp" rows={3} style={{resize:"vertical",marginBottom:0}} value={essayForm.q}
                        onChange={e=>setEssayForm({...essayForm,q:e.target.value})} placeholder="Write the essay question or prompt..." />
                    </div>
                    <div>
                      <label className="lbl">Marks</label>
                      <input className="inp" style={{marginBottom:0}} type="number" min="1" max="100" value={essayForm.marks}
                        onChange={e=>setEssayForm({...essayForm,marks:e.target.value})} />
                    </div>
                    <div>
                      <label className="lbl">Year</label>
                      <input className="inp" style={{marginBottom:0}} placeholder="2023" value={essayForm.year}
                        onChange={e=>setEssayForm({...essayForm,year:e.target.value})} />
                    </div>
                  </div>
                  <label className="lbl">Model Answer / Key Points (optional)</label>
                  <textarea className="inp" rows={3} style={{resize:"vertical"}} value={essayForm.modelAnswer}
                    onChange={e=>setEssayForm({...essayForm,modelAnswer:e.target.value})}
                    placeholder="Key points students should cover in their answer..." />
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn btn-purple" onClick={saveSingleEssay}>{editEssayIdx!==null?"💾 Update":"➕ Add Essay Q"}</button>
                    {editEssayIdx!==null&&<button className="btn" onClick={()=>{setEditEssayIdx(null);setEssayForm({q:"",marks:"10",modelAnswer:"",year:""});}}>Cancel</button>}
                  </div>
                </div>
              )}

              {/* Paste essay questions */}
              {essayMode==="paste"&&(
                <div className="card2" style={{marginBottom:14,border:"1px solid rgba(124,58,237,.2)"}}>
                  <div style={{fontWeight:800,marginBottom:8,fontSize:13,color:"var(--purple)"}}>📋 Paste Multiple Essay Questions</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--purple)",marginBottom:4}}>📝 Essay Questions</div>
                      <textarea className="paste-box" rows={12}
                        placeholder={"Q: Discuss the nursing management of a patient with pulmonary tuberculosis.\nMARKS: 20\nYEAR: 2023\n\nQ: Explain the pathophysiology of heart failure and its nursing implications.\nMARKS: 15\nYEAR: 2022"}
                        value={essayPasteText} onChange={e=>{setEssayPasteText(e.target.value);setEssayParsed([]);}} />
                    </div>
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ Model Answers / Key Points (one per line)</div>
                      <textarea className="paste-box" rows={12}
                        placeholder={"Isolation, DOTS therapy, infection control, health education\nReduced cardiac output, compensatory mechanisms, fluid management"}
                        value={essayPasteAnswers} onChange={e=>{setEssayPasteAnswers(e.target.value);setEssayParsed([]);}} style={{borderColor:"rgba(34,197,94,.35)"}} />
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button className="btn btn-purple" onClick={parseEssay}>🔍 Auto-Parse</button>
                    {essayParsed.length>0&&<button className="btn btn-success" onClick={importEssay}>✅ Add {essayParsed.length} Essay Q{essayParsed.length!==1?"s":""}</button>}
                    <button className="btn" onClick={()=>{setEssayParsed([]);setEssayPasteText("");setEssayPasteAnswers("");}}>🗑️ Clear</button>
                  </div>
                  {essayParsed.length>0&&(
                    <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
                      <div style={{padding:"8px 12px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>✓ {essayParsed.length} parsed — review then add</div>
                      {essayParsed.map((p,i)=>(
                        <div key={i} style={{padding:"8px 12px",borderTop:"1px solid var(--border)"}}>
                          <div style={{fontWeight:700,fontSize:12,marginBottom:3}}>{i+1}. {p.q}</div>
                          <div style={{fontSize:11,color:"var(--text3)"}}>
                            {p.marks&&<span style={{marginRight:10}}>📊 {p.marks} marks</span>}
                            {p.year&&<span>📅 {p.year}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Essay List */}
              <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>✍️ {cd.essay.length} Essay Question{cd.essay.length!==1?"s":""}</div>
              {cd.essay.length===0&&<div style={{textAlign:"center",padding:20,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:10,fontSize:13}}>No essay questions yet. Add above.</div>}
              {cd.essay.map((q,qi)=>(
                <div key={qi} className="card2" style={{marginBottom:8,borderLeft:`3px solid ${qi===editEssayIdx?"var(--purple)":"var(--border)"}`}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{width:24,height:24,borderRadius:7,background:"rgba(124,58,237,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"var(--purple)",flexShrink:0}}>{qi+1}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{q.q}</div>
                      <div style={{display:"flex",gap:10,fontSize:11,color:"var(--text3)",flexWrap:"wrap"}}>
                        {q.marks&&<span>📊 {q.marks} marks</span>}
                        {q.year&&<span>📅 {q.year}</span>}
                        {q.modelAnswer&&<span style={{color:"var(--success)"}}>✓ Model answer provided</span>}
                      </div>
                      {q.modelAnswer&&<div style={{fontSize:11,color:"var(--text3)",marginTop:4,padding:"4px 8px",background:"rgba(34,197,94,.05)",borderRadius:6,border:"1px solid rgba(34,197,94,.15)"}}>💡 {q.modelAnswer}</div>}
                    </div>
                    <div style={{display:"flex",gap:4,flexShrink:0}}>
                      <button className="btn btn-sm" onClick={()=>{setEssayForm({q:q.q,marks:q.marks||"10",modelAnswer:q.modelAnswer||"",year:q.year||""});setEditEssayIdx(qi);setEssayMode("single");}}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={()=>delEssay(qi)}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─── NURSING EXAM META ────────────────────────────────────────────────

export function AdminNcCodes({ toast }) {
  const [codes, setCodes] = useSharedData("nv-nc-codes", []);
  const [users, setUsers] = useSharedData("nv-users", []);
  const [newCode, setNewCode] = useState("");
  const [bulkCount, setBulkCount] = useState(10);
  const [filter, setFilter] = useState("all"); // all | used | unused

  const saveCodes = async (arr) => {
    setCodes(arr);
    const ok = await saveShared("ncCodes", arr);
    if (!ok) toast("⚠️ Saved locally — sync failed", "warn");
  };

  const saveUsers = async (arr) => {
    setUsers(arr);
    const ok = await saveShared("users", arr);
    if (!ok) toast("⚠️ Saved locally — sync failed", "warn");
  };

  const genCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const seg = () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
    return `NC-${seg()}-${seg()}-${seg()}`;
  };

  const addSingle = () => {
    const c = newCode.trim().toUpperCase() || genCode();
    if (codes.find(x => x.code === c)) return toast("Code already exists", "error");
    saveCodes([...codes, { code: c, createdAt: Date.now(), used: false, usedBy: null, usedAt: null }]);
    setNewCode("");
    toast(`✅ Code added: ${c}`, "success");
  };

  const generateBulk = () => {
    const n = Math.min(Math.max(1, bulkCount), 250);
    const existing = new Set(codes.map(c => c.code));
    const batch = [];
    while (batch.length < n) {
      const c = genCode();
      if (!existing.has(c)) { existing.add(c); batch.push({ code: c, createdAt: Date.now(), used: false, usedBy: null, usedAt: null }); }
    }
    saveCodes([...codes, ...batch]);
    toast(`✅ ${n} codes generated`, "success");
  };

  const deleteCode = (code) => {
    if (!confirm(`Delete code ${code}?`)) return;
    saveCodes(codes.filter(c => c.code !== code));
    toast("Deleted", "success");
  };

  const deleteAll = () => {
    if (!confirm(`Delete ALL ${codes.length} codes? Used codes will also be removed.`)) return;
    saveCodes([]);
    toast("🗑️ All codes deleted", "success");
  };

  const revokeUser = async (username) => {
    if (!confirm(`Revoke NC access for ${username}?\nThis also clears their device lock.`)) return;
    const updated = users.map(u => u.username === username ? { ...u, ncUnlocked: false, ncCode: null, ncDeviceId: null } : u);
    await saveUsers(updated);
    try { await _setDocField(_DOC_SHARED, `deviceReg_${_h(username)}`, null); } catch {}
    toast(`Access revoked for ${username}`, "success");
  };

  const resetDevice = async (username) => {
    if (!confirm(`Reset device lock for ${username}?\n\nThey can re-activate on a new device by re-entering their code once.`)) return;
    const updated = users.map(u => u.username === username ? { ...u, ncDeviceId: null } : u);
    await saveUsers(updated);
    try { await _setDocField(_DOC_SHARED, `deviceReg_${_h(username)}`, null); } catch {}
    toast(`📱 Device lock reset for ${username}`, "success");
  };

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code).then(() => toast("📋 Copied!", "success")).catch(() => toast(code, "info"));
  };

  const filtered = codes.filter(c =>
    filter === "used" ? c.used :
    filter === "unused" ? !c.used : true
  );

  const unlocked = users.filter(u => u.ncUnlocked);
  const usedCount = codes.filter(c => c.used).length;
  const unusedCount = codes.length - usedCount;

  return (
    <div>
      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:20}}>
        {[
          {icon:"🔑",label:"Total Codes",val:codes.length,color:"var(--accent)"},
          {icon:"✅",label:"Used",val:usedCount,color:"var(--success)"},
          {icon:"🔓",label:"Unlocked Students",val:unlocked.length,color:"var(--warn)"},
        ].map((s,i)=>(
          <div key={i} className="card" style={{textAlign:"center",padding:"14px 10px",borderTop:`3px solid ${s.color}`}}>
            <div style={{fontSize:22,marginBottom:2}}>{s.icon}</div>
            <div style={{fontWeight:800,fontSize:22,color:s.color}}>{s.val}</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Generate codes */}
      <div className="card" style={{marginBottom:14}}>
        <div style={{fontWeight:800,fontSize:14,marginBottom:12,color:"var(--accent)"}}>🔑 Generate Codes</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
          <input className="inp" style={{flex:1,minWidth:180,marginBottom:0}} placeholder="Custom code (or leave blank for auto)"
            value={newCode} onChange={e=>setNewCode(e.target.value.toUpperCase())}
            onKeyDown={e=>e.key==="Enter"&&addSingle()} />
          <button className="btn btn-accent" onClick={addSingle}>➕ Add Code</button>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <label className="lbl" style={{marginBottom:0,whiteSpace:"nowrap"}}>Bulk generate:</label>
          <input className="inp" type="number" min={1} max={250} style={{width:80,marginBottom:0}}
            value={bulkCount} onChange={e=>setBulkCount(+e.target.value)} />
          <button className="btn btn-success" onClick={generateBulk}>⚡ Generate {bulkCount} Codes</button>
          {codes.length>0&&<button className="btn btn-danger btn-sm" onClick={deleteAll}>🗑️ Delete All</button>}
        </div>
        <div style={{fontSize:11,color:"var(--text3)",marginTop:8}}>
          Format: <code style={{background:"var(--bg4)",padding:"1px 6px",borderRadius:4}}>NC-XXXX-XXXX-XXXX</code> • Share codes with students who have paid.
        </div>
      </div>

      {/* Code list */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{fontWeight:800,fontSize:14,flex:1}}>📋 Code List ({filtered.length})</div>
        {["all","unused","used"].map(f=>(
          <button key={f} className={`btn btn-sm${filter===f?" btn-accent":""}`}
            style={filter===f?{background:"var(--accent)",border:"none"}:{}}
            onClick={()=>setFilter(f)}>{f==="all"?"All":f==="used"?"Used ✅":"Unused 🔑"}</button>
        ))}
      </div>

      {filtered.length===0&&(
        <div style={{textAlign:"center",padding:28,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:10}}>
          {codes.length===0?"No codes yet — generate some above.":"No codes matching this filter."}
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {filtered.map(c=>(
          <div key={c.code} className="card" style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:12,
            borderLeft:`4px solid ${c.used?"var(--success)":"var(--accent)"}`}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <code style={{fontWeight:800,fontSize:13,letterSpacing:1,color:c.used?"var(--text3)":"var(--text)",
                  textDecoration:c.used?"line-through":"none"}}>{c.code}</code>
                <span style={{fontSize:10,padding:"2px 7px",borderRadius:10,fontWeight:700,
                  background:c.used?"rgba(34,197,94,.12)":"rgba(var(--accent-rgb,0,119,182),.1)",
                  color:c.used?"var(--success)":"var(--accent)"}}>
                  {c.used?"✅ Used":"🔑 Unused"}
                </span>
              </div>
              {c.used&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
                Used by {c.usedBy} • {c.usedAt?new Date(c.usedAt).toLocaleDateString():""}
              </div>}
            </div>
            <div style={{display:"flex",gap:6}}>
              {!c.used&&<button className="btn btn-sm" onClick={()=>copyCode(c.code)}>📋</button>}
              <button className="btn btn-sm btn-danger" onClick={()=>deleteCode(c.code)}>🗑️</button>
            </div>
          </div>
        ))}
      </div>

      {/* Unlocked students */}
      {unlocked.length>0&&(
        <div style={{marginTop:20}}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:10,color:"var(--success)"}}>🔓 Unlocked Students ({unlocked.length})</div>
          {unlocked.map(u=>{
            let dev=null; try{dev=u.ncDeviceId?JSON.parse(u.ncDeviceId):null;}catch{dev=null;}
            return (
              <div key={u.username} className="card" style={{padding:"12px 14px",marginBottom:8,borderLeft:"4px solid var(--success)"}}>
                <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:"rgba(34,197,94,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{u.avatar||"👤"}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:13}}>{u.displayName||u.username.split("@")[0]}</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>{u.username} • Code: <b>{u.ncCode||"Manual"}</b></div>
                    {dev ? (
                      <div style={{marginTop:6,padding:"6px 10px",borderRadius:8,background:"var(--bg4)",border:"1px solid var(--border)",fontSize:11}}>
                        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                          <span>🖥️ <b>GPU:</b> {dev.gpuRaw||dev.webglH||"?"}</span>
                          <span>📱 <b>Screen:</b> {dev.screenRaw||"?"}</span>
                          <span>🌐 <b>IP:</b> <span style={{color:"var(--success)",fontWeight:700}}>{dev.publicIP||"?"}</span></span>
                        </div>
                        <div style={{marginTop:3,display:"flex",gap:16,flexWrap:"wrap"}}>
                          <span>💻 <b>CPU/RAM:</b> {dev.hwRaw||"?"}</span>
                          <span>🔑 <b>Signals:</b> <span style={{color:dev.realSignalCount>=7?"var(--success)":"var(--warn)",fontWeight:700}}>{dev.realSignalCount||"?"}/10 captured</span></span>
                        </div>
                      </div>
                    ):(
                      <div style={{fontSize:11,color:"var(--warn)",marginTop:4}}>⚠️ No device bound yet</div>
                    )}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5,flexShrink:0}}>
                    <button className="btn btn-sm btn-danger" onClick={()=>revokeUser(u.username)}>🚫 Revoke</button>
                    {u.ncDeviceId&&<button className="btn btn-sm" style={{fontSize:11,borderColor:"var(--warn)",color:"var(--warn)",whiteSpace:"nowrap"}} onClick={()=>resetDevice(u.username)}>📱 Reset Device</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── NC Paywall / Access Gate ──────────────────────────────────────────

export function AdminNursingExams({ toast }) {
  const [data, setData] = useSharedData("nv-nursing-exams", {});
  const [archive, setArchive] = useSharedData("nv-nc-archive", []);
  const [activeSpec, setActiveSpec] = useState("general");
  const [selYear, setSelYear] = useState("2025");
  const [selPaper, setSelPaper] = useState("paper1"); // paper1|paper2|osce

  // MCQ states
  const [mcqMode, setMcqMode] = useState("single"); // single|paste
  const [singleForm, setSingleForm] = useState({q:"",options:["","","",""],ans:0});
  const [editQIdx, setEditQIdx] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteAnswers, setPasteAnswers] = useState("");
  const [parsedMcq, setParsedMcq] = useState([]);

  // OSCE states
  const [osceText, setOsceText] = useState("");
  const [osceAnswersText, setOsceAnswersText] = useState("");
  const [parsedOsce, setParsedOsce] = useState([]);
  const [editCheckIdx, setEditCheckIdx] = useState(null);
  const [editCheckForm, setEditCheckForm] = useState({heading:"", instructions:"", activities:"", questionStation:"", answers:""});

  const meta = NURSING_EXAM_META[activeSpec];
  const yearData = getYearData(data, activeSpec, selYear);
  const paperData = yearData[selPaper];

  const saveData = async (newData) => {
    setData(newData);
    const ok = await saveShared("nursingExams", newData);
    if (!ok) toast("⚠️ Saved locally but sync failed","warn");
    return ok;
  };

  const updatePaper = async (patch) => {
    const nd = setYearPaperData(data, activeSpec, selYear, selPaper, { ...paperData, ...patch });
    return saveData(nd);
  };

  // ── Archive helpers ──
  const saveArchive = async (newArr) => {
    setArchive(newArr);
    const ok = await saveShared("ncArchive", newArr);
    if (!ok) toast("⚠️ Archive saved locally — sync failed","warn");
    return ok;
  };

  const saveCurrentToArchive = async () => {
    const isOsce = selPaper === "osce";
    const pd = isOsce ? (yearData.osce||emptyOsce()) : paperData;
    const hasContent = isOsce ? (pd.checklists?.length||0)>0 : (pd.questions?.length||0)>0;
    if (!hasContent) return toast("Nothing to archive — add content first","error");
    const pt = NC_PAPER_TYPES.find(p=>p.key===selPaper);
    const entry = {
      id: `arc_${activeSpec}_${selYear}_${selPaper}_${Date.now()}`,
      type: isOsce ? "osce" : "paper",
      spec: activeSpec,
      year: selYear,
      paperKey: selPaper,
      title: `${meta.short} ${selYear} ${pt.label}`,
      savedAt: Date.now(),
      ...(isOsce ? {checklists: pd.checklists} : {questions: pd.questions}),
    };
    // Replace any existing entry for same spec/year/paper
    const filtered = archive.filter(e=>!(e.spec===activeSpec&&e.year===selYear&&e.paperKey===selPaper));
    const ok = await saveArchive([...filtered, entry]);
    toast(ok?"✅ Saved to archive! Students can retake anytime.":"✅ Saved locally","success");
  };

  // ── Delete all helpers ──
  const deleteAllQuestions = () => {
    if (!(paperData.questions?.length>0)) return toast("No questions to delete","error");
    if (!confirm(`Delete ALL ${paperData.questions.length} questions from this paper?`)) return;
    updatePaper({questions:[]});
    setEditQIdx(null); setSingleForm({q:"",options:["","","",""],ans:0});
    toast("🗑️ All questions deleted","success");
  };

  const deleteAllChecklists = () => {
    const osce = yearData.osce||emptyOsce();
    if (!(osce.checklists?.length>0)) return toast("No checklists to delete","error");
    if (!confirm(`Delete ALL ${osce.checklists.length} OSCE checklists?`)) return;
    const nd = setYearPaperData(data, activeSpec, selYear, "osce", {...osce, checklists:[]});
    saveData(nd); setEditCheckIdx(null);
    toast("🗑️ All checklists deleted","success");
  };

  // ── MCQ helpers ──
  const parseMcq = () => {
    const blocks = pasteText.trim().split(/\n\s*\n+/).filter(b=>b.trim());
    const ansLines = pasteAnswers.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const items = blocks.map((block,idx)=>{
      const lines = block.split("\n").map(l=>l.trim()).filter(Boolean);
      let q="", options=["","","",""], ans=0;
      lines.forEach(line=>{
        const ansM = line.match(/^(?:ANS|ANSWER|Ans|Answer)[.:)]\s*([A-Da-d])/i);
        if (ansM) { ans="ABCD".indexOf(ansM[1].toUpperCase()); if(ans<0)ans=0; return; }
        const m = line.match(/^([QqAaBbCcDd])[.):\s]\s*(.+)$/);
        if (m) {
          const L=m[1].toUpperCase();
          if(L==="Q")q=m[2]; else if(L==="A")options[0]=m[2]; else if(L==="B")options[1]=m[2]; else if(L==="C")options[2]=m[2]; else if(L==="D")options[3]=m[2];
        } else if(!q) q=line.replace(/^\d+[.)]\s*/,"");
      });
      if(ansLines[idx]){const a="ABCD".indexOf(ansLines[idx][0]?.toUpperCase());if(a>=0)ans=a;}
      return {q:q.trim(),options,ans};
    }).filter(i=>i.q&&i.options.some(o=>o));
    setParsedMcq(items);
    if(!items.length) toast("No questions parsed — check format","error");
    else toast(`✅ ${items.length} question(s) parsed!`,"success");
  };

  const addSingleMcq = () => {
    if(!singleForm.q.trim()) return toast("Question text required","error");
    if(!singleForm.options[0]||!singleForm.options[1]) return toast("At least options A and B required","error");
    const q={q:singleForm.q.trim(),options:singleForm.options.map(o=>o.trim()),ans:singleForm.ans};
    let qs;
    if(editQIdx!==null){ qs=paperData.questions.map((qq,i)=>i===editQIdx?q:qq); setEditQIdx(null); toast("✏️ Question updated","success"); }
    else { qs=[...paperData.questions,q]; toast("➕ Question added","success"); }
    updatePaper({questions:qs});
    setSingleForm({q:"",options:["","","",""],ans:0});
  };

  const importParsedMcq = () => {
    if(!parsedMcq.length) return;
    updatePaper({questions:[...paperData.questions,...parsedMcq]});
    setParsedMcq([]); setPasteText(""); setPasteAnswers("");
    toast(`✅ ${parsedMcq.length} questions imported!`,"success");
  };

  const deleteQ = (qi) => {
    updatePaper({questions:paperData.questions.filter((_,i)=>i!==qi)});
    toast("Deleted","success");
  };

  const publishPaper = () => {
    updatePaper({published:true,publishedAt:Date.now()});
    toast("🚀 Published! Students can see this now.","success");
  };
  const unpublishPaper = () => {
    updatePaper({published:false,publishedAt:null});
    toast("Paper unpublished","warn");
  };

  // ── OSCE helpers ──
  // Rich OSCE parser — handles PROCEDURE STATION format with instructions, activities (marks), question station, and answers
  const parseOsce = () => {
    const rawText = osceText.trim();
    const answersRaw = osceAnswersText.trim();
    if (!rawText) { toast("Paste OSCE content first","error"); return; }

    // Split into individual station blocks
    const stationBlocks = rawText.split(/(?=^PROCEDURE STATION[\s:])/mi).filter(b=>b.trim());
    const blocks = stationBlocks.length > 1 ? stationBlocks : [rawText];

    // Parse answers text — one per line, letter or "A. text" format
    const parseAnswers = (raw) => {
      if (!raw) return [];
      return raw.split("\n").map(l=>l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^(?:\d+[.)\s]+)?([A-Da-d])[.)\s]*/);
        if (m) return m[1].toUpperCase();
        return l.replace(/^\d+[.)\s]*/,"").trim();
      });
    };
    const answerKey = parseAnswers(answersRaw);
    let globalQIdx = 0; // tracks MCQ index across stations for answer key

    const items = blocks.map((block) => {
      const lines = block.split("\n").map(l => l.trim());
      let heading = "", instructions = [], activities = [], questionStation = [], totalMarks = "";
      let mode = "heading";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        // Section headers
        if (line.match(/^INSTRUCTION(S)? TO CANDIDATE/i)) { mode = "instructions"; continue; }
        if (line.match(/^ACTIVITIES$/i)) { mode = "activities"; continue; }
        if (line.match(/^QUESTION STATION[\s:]*/i)) { mode = "questions"; continue; }
        if (line.match(/^Total Marks/i)) { totalMarks = line; mode = "done"; continue; }

        // Title line
        if (line.match(/^PROCEDURE STATION[\s:]*/i)) {
          heading = line.replace(/^PROCEDURE STATION[\s:]*/i,"").trim();
          mode = "heading_seen"; continue;
        }
        if ((mode === "heading" || mode === "heading_seen") && !heading) {
          heading = line.replace(/^Title[\s:]*/i,"").trim(); continue;
        }
        if (mode === "heading_seen" && heading && !line.match(/^(?:INSTRUCTION|ACTIVIT|QUESTION)/i)) {
          // multi-line title
          heading += " " + line; continue;
        }

        if (mode === "instructions") {
          const clean = line.replace(/^[➤►>•\-]\s*/,"").trim();
          if (clean) instructions.push(clean);
          continue;
        }

        if (mode === "activities") {
          // Main numbered item: "1. Text (½ mark)" or "17." sub items
          const actM = line.match(/^(\d+[a-z]?)[.)]\s+(.+)$/i);
          const subM = line.match(/^([a-z])[.)]\s+(.+)$/i);
          if (actM) {
            const text = actM[2].trim();
            const markM = text.match(/\(([^)]+marks?)\)\s*$/i);
            activities.push({ num: actM[1], text: markM ? text.replace(markM[0],"").trim() : text, mark: markM ? markM[1] : "", subItems: [] });
          } else if (subM && activities.length > 0) {
            const text = subM[2].trim();
            const markM = text.match(/\(([^)]+marks?)\)\s*$/i);
            const parent = activities[activities.length-1];
            if (!parent.subItems) parent.subItems = [];
            parent.subItems.push({ letter: subM[1], text: markM ? text.replace(markM[0],"").trim() : text, mark: markM ? markM[1] : "" });
          }
          continue;
        }

        if (mode === "questions") {
          const optM = line.match(/^([a-d])[.)]\s+(.+)$/i);
          const lastQ = questionStation.length > 0 ? questionStation[questionStation.length-1] : null;

          if (optM && lastQ && lastQ.type === "mcq") {
            lastQ.options.push({ letter: optM[1].toUpperCase(), text: optM[2].trim() });
          } else if (!optM && line.trim()) {
            const lookahead = lines.slice(i+1, i+6).join("\n");
            const hasMcqOptions = lookahead.match(/^[a-d][.)]\s/im);
            const cleanQ = line.replace(/^\d+[.)\s]*/,"").trim();
            if (hasMcqOptions) {
              const ans = answerKey[globalQIdx] || null;
              questionStation.push({ type:"mcq", q: cleanQ, options:[], ans, qNum: globalQIdx+1 });
              globalQIdx++;
            } else if (cleanQ) {
              // Fill-in-blank or free response (has blanks like ……… or ___)
              const isFill = cleanQ.match(/[…_]{3,}/) || cleanQ.match(/Mention \d+/i);
              questionStation.push({ type: isFill ? "fill" : "text", q: cleanQ, ans: answerKey[globalQIdx] || "" });
              if (isFill) globalQIdx++;
            }
          }
          continue;
        }
      }

      if (!heading) heading = lines.find(l=>l.trim()) || "OSCE Station";
      // Legacy steps for backward compat
      const steps = activities.map(a => {
        const parts = [`${a.num}. ${a.text}${a.mark ? " ("+a.mark+")" : ""}`];
        if (a.subItems && a.subItems.length) a.subItems.forEach(s => parts.push(`   ${s.letter}. ${s.text}${s.mark?" ("+s.mark+")":""}`));
        return parts;
      }).flat();

      return { heading: heading.trim(), instructions, activities, questionStation, totalMarks, steps };
    }).filter(i => i.heading);

    setParsedOsce(items);
    if (!items.length) toast("No stations parsed — check format","error");
    else toast("✅ " + items.length + " OSCE station(s) parsed!","success");
  };

  const importOsce = () => {
    if(!parsedOsce.length) return;
    const newChecks = parsedOsce.map(p=>({
      id: Date.now()+Math.random(),
      heading: p.heading,
      instructions: p.instructions || [],
      activities: p.activities || [],
      questionStation: p.questionStation || [],
      totalMarks: p.totalMarks || "",
      steps: p.steps || [],
    }));
    const osce = yearData.osce || emptyOsce();
    const nd = setYearPaperData(data,activeSpec,selYear,"osce",{...osce,checklists:[...(osce.checklists||[]),...newChecks]});
    saveData(nd);
    setParsedOsce([]); setOsceText(""); setOsceAnswersText("");
    toast("✅ " + newChecks.length + " OSCE station(s) added!","success");
  };

  const saveEditChecklist = () => {
    if(!editCheckForm.heading.trim()) return toast("Heading required","error");
    // Re-parse activities and question station from text areas
    const activitiesLines = editCheckForm.activities.split("\n").map(s=>s.trim()).filter(Boolean);
    const activities = [];
    activitiesLines.forEach(line => {
      const actM = line.match(/^(\d+[a-z]?)[.)]\s+(.+)$/i);
      const subM = line.match(/^([a-z])[.)]\s+(.+)$/i);
      if (actM) {
        const text = actM[2].trim();
        const markM = text.match(/\(([^)]+marks?)\)\s*$/i);
        activities.push({ num: actM[1], text: markM ? text.replace(markM[0],"").trim() : text, mark: markM ? markM[1] : "", subItems: [] });
      } else if (subM && activities.length > 0) {
        const text = subM[2].trim();
        const markM = text.match(/\(([^)]+marks?)\)\s*$/i);
        const parent = activities[activities.length-1];
        if (!parent.subItems) parent.subItems = [];
        parent.subItems.push({ letter: subM[1], text: markM ? text.replace(markM[0],"").trim() : text, mark: markM ? markM[1] : "" });
      }
    });
    const steps = activities.map(a => `${a.num}. ${a.text}${a.mark?" ("+a.mark+")":""}`);
    const instructions = editCheckForm.instructions.split("\n").map(s=>s.replace(/^[➤►>•\-]\s*/,"").trim()).filter(Boolean);
    const osce = yearData.osce || emptyOsce();
    const checklists = (osce.checklists||[]).map((c,i)=>
      i===editCheckIdx ? {...c, heading:editCheckForm.heading.trim(), instructions, activities, steps,
        questionStation: c.questionStation||[], totalMarks: editCheckForm.totalMarks||c.totalMarks||""} : c
    );
    const nd = setYearPaperData(data,activeSpec,selYear,"osce",{...osce,checklists});
    saveData(nd);
    setEditCheckIdx(null); setEditCheckForm({heading:"",instructions:"",activities:"",questionStation:"",answers:""});
    toast("✏️ Checklist updated","success");
  };

  const deleteChecklist = (ci) => {
    if(!confirm("Delete this OSCE checklist?")) return;
    const osce = yearData.osce || emptyOsce();
    const nd = setYearPaperData(data,activeSpec,selYear,"osce",{...osce,checklists:(osce.checklists||[]).filter((_,i)=>i!==ci)});
    saveData(nd);
    toast("Checklist deleted","success");
  };

  const publishOsce = () => {
    const osce = yearData.osce || emptyOsce();
    const nd = setYearPaperData(data,activeSpec,selYear,"osce",{...osce,published:true,publishedAt:Date.now()});
    saveData(nd); toast("🚀 OSCE Published!","success");
  };
  const unpublishOsce = () => {
    const osce = yearData.osce || emptyOsce();
    const nd = setYearPaperData(data,activeSpec,selYear,"osce",{...osce,published:false,publishedAt:null});
    saveData(nd); toast("OSCE Unpublished","warn");
  };

  const specKeys = Object.keys(NURSING_EXAM_META);
  const isOsce = selPaper==="osce";
  const osceData = yearData.osce || emptyOsce();
  const archived = isPaperArchived(isOsce ? osceData : paperData);

  return (
    <div>
      <div className="sec-title" style={{marginBottom:4}}>🎓 Nursing Council Exams Manager</div>
      <div style={{fontSize:12,color:"var(--text3)",marginBottom:18}}>
        Select specialty → year → paper type to add, edit or delete questions and OSCE checklists.
      </div>

      {/* ── Specialty tabs ── */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {specKeys.map(key=>{
          const m=NURSING_EXAM_META[key];
          return (
            <div key={key} onClick={()=>{setActiveSpec(key);setEditQIdx(null);setParsedMcq([]);setParsedOsce([]);setEditCheckIdx(null);}}
              style={{flex:"1 1 160px",padding:"13px 14px",borderRadius:12,cursor:"pointer",transition:"all .2s",textAlign:"center",
                border:`2px solid ${activeSpec===key?m.color:"var(--border)"}`,
                background:activeSpec===key?`${m.color}18`:"var(--card)"}}>
              <div style={{fontSize:26,marginBottom:3}}>{m.icon}</div>
              <div style={{fontWeight:800,fontSize:13,color:activeSpec===key?m.color:"var(--text)"}}>{m.short}</div>
            </div>
          );
        })}
      </div>

      {/* ── Year + Paper selectors ── */}
      <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:"1 1 160px"}}>
          <label className="lbl">📅 Year</label>
          <select className="inp" style={{marginBottom:0}} value={selYear} onChange={e=>{setSelYear(e.target.value);setEditQIdx(null);setParsedMcq([]);setEditCheckIdx(null);}}>
            {NC_YEARS.slice().reverse().map(y=>(
              <option key={y} value={y}>{y} Past Questions</option>
            ))}
          </select>
        </div>
        <div style={{flex:"1 1 220px"}}>
          <label className="lbl">📑 Paper Type</label>
          <div style={{display:"flex",gap:6}}>
            {NC_PAPER_TYPES.map(pt=>(
              <div key={pt.key} onClick={()=>{setSelPaper(pt.key);setEditQIdx(null);setParsedMcq([]);setEditCheckIdx(null);}}
                style={{flex:1,padding:"9px 10px",borderRadius:9,cursor:"pointer",textAlign:"center",transition:"all .2s",
                  border:`2px solid ${selPaper===pt.key?meta.color:"var(--border)"}`,
                  background:selPaper===pt.key?`${meta.color}15`:"var(--card)"}}>
                <div style={{fontSize:16,marginBottom:2}}>{pt.icon}</div>
                <div style={{fontWeight:800,fontSize:11,color:selPaper===pt.key?meta.color:"var(--text)"}}>{pt.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section header ── */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,padding:"12px 16px",
        background:`${meta.color}10`,borderRadius:12,border:`1.5px solid ${meta.color}30`,flexWrap:"wrap"}}>
        <div style={{width:40,height:40,borderRadius:10,background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{meta.icon}</div>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:15,color:meta.color}}>{meta.short} — {selYear} {NC_PAPER_TYPES.find(p=>p.key===selPaper)?.label}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>
            {isOsce ? `${osceData.checklists?.length||0} checklist(s)` : `${paperData.questions?.length||0} question(s)`}
            {" • "}
            {(isOsce?osceData:paperData).published ? "🟢 Published" : "📋 Draft"}
          </div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {(isOsce?osceData:paperData).published
            ? <button className="btn btn-sm btn-warn" onClick={isOsce?unpublishOsce:unpublishPaper}>⏸ Unpublish</button>
            : <button className="btn btn-sm btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}}
                onClick={isOsce?publishOsce:publishPaper}>🚀 Publish</button>
          }
          <button className="btn btn-sm" style={{borderColor:"var(--accent)",color:"var(--accent)"}}
            onClick={saveCurrentToArchive}>🗄️ Archive</button>
          {!isOsce&&(paperData.questions?.length||0)>0&&(
            <button className="btn btn-sm btn-danger" onClick={deleteAllQuestions} title="Delete all questions">🗑️ All Q</button>
          )}
          {isOsce&&(osceData.checklists?.length||0)>0&&(
            <button className="btn btn-sm btn-danger" onClick={deleteAllChecklists} title="Delete all checklists">🗑️ All</button>
          )}
        </div>
      </div>

      {/* ════ MCQ EDITOR (paper1 / paper2) ════ */}
      {!isOsce && (
        <div>
          {/* Mode tabs */}
          <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{fontWeight:800,fontSize:13,flex:1,color:meta.color}}>Add MCQ Questions</div>
            <button className={`btn btn-sm${mcqMode==="single"?" btn-accent":""}`}
              style={mcqMode==="single"?{background:meta.color,border:"none"}:{}}
              onClick={()=>{setMcqMode("single");setEditQIdx(null);}}>✏️ Single</button>
            <button className={`btn btn-sm${mcqMode==="paste"?" btn-accent":""}`}
              style={mcqMode==="paste"?{background:meta.color,border:"none"}:{}}
              onClick={()=>setMcqMode("paste")}>📋 Paste Multiple</button>
          </div>

          {/* Single form */}
          {mcqMode==="single"&&(
            <div className="card2" style={{marginBottom:14,border:`1px solid ${meta.color}30`}}>
              <div style={{fontWeight:800,marginBottom:10,fontSize:13,color:meta.color}}>
                {editQIdx!==null?`✏️ Editing Q${editQIdx+1}`:"✏️ New Question"}
              </div>
              <label className="lbl">Question Text *</label>
              <textarea className="inp" rows={3} style={{resize:"vertical"}} value={singleForm.q}
                onChange={e=>setSingleForm({...singleForm,q:e.target.value})} placeholder="Type the question here..." />
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                {["A","B","C","D"].map((L,i)=>(
                  <div key={L}>
                    <label className="lbl">Option {L}{i<2?" *":""}</label>
                    <input className="inp" style={{marginBottom:0}} placeholder={`Option ${L}...`} value={singleForm.options[i]}
                      onChange={e=>{const o=[...singleForm.options];o[i]=e.target.value;setSingleForm({...singleForm,options:o});}} />
                  </div>
                ))}
              </div>
              <label className="lbl">Correct Answer *</label>
              <select className="inp" value={singleForm.ans} onChange={e=>setSingleForm({...singleForm,ans:+e.target.value})}>
                {["A","B","C","D"].map((L,i)=><option key={L} value={i}>Option {L}{singleForm.options[i]?`: ${singleForm.options[i]}`:""}</option>)}
              </select>
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}}
                  onClick={addSingleMcq}>{editQIdx!==null?"💾 Update":"➕ Add Question"}</button>
                {editQIdx!==null&&<button className="btn" onClick={()=>{setEditQIdx(null);setSingleForm({q:"",options:["","","",""],ans:0});}}>Cancel</button>}
              </div>
            </div>
          )}

          {/* Paste form */}
          {mcqMode==="paste"&&(
            <div className="card2" style={{marginBottom:14,border:`1px solid ${meta.color}30`}}>
              <div style={{fontWeight:800,marginBottom:8,fontSize:13,color:meta.color}}>📋 Paste Multiple Questions</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:meta.color,marginBottom:4}}>📝 Questions (Q: / A: / B: / C: / D:)</div>
                  <textarea className="paste-box" rows={14}
                    placeholder={"Q: Normal adult temperature is:\nA: 35.0°C\nB: 36.1–37.2°C\nC: 38.5°C\nD: 40.0°C\n\nQ: Which organ produces insulin?\nA: Liver\nB: Kidney\nC: Pancreas\nD: Spleen"}
                    value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsedMcq([]);}} />
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ Answers (one per line: A / B / C / D)</div>
                  <textarea className="paste-box" rows={14} placeholder={"B\nC"} style={{borderColor:"rgba(34,197,94,.35)"}}
                    value={pasteAnswers} onChange={e=>{setPasteAnswers(e.target.value);setParsedMcq([]);}} />
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button className="btn btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}}
                  onClick={parseMcq}>🔍 Auto-Parse</button>
                {parsedMcq.length>0&&<button className="btn btn-success" onClick={importParsedMcq}>✅ Add {parsedMcq.length} Question{parsedMcq.length!==1?"s":""}</button>}
                <button className="btn" onClick={()=>{setParsedMcq([]);setPasteText("");setPasteAnswers("");}}>🗑️ Clear</button>
              </div>
              {parsedMcq.length>0&&(
                <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
                  <div style={{padding:"8px 14px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>
                    ✓ {parsedMcq.length} parsed — review then import
                  </div>
                  {parsedMcq.map((p,i)=>(
                    <div key={i} style={{padding:"8px 14px",borderTop:"1px solid var(--border)"}}>
                      <div style={{fontWeight:700,fontSize:12,marginBottom:5}}>{i+1}. {p.q}</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {p.options.filter(o=>o).map((opt,oi)=>(
                          <span key={oi} style={{fontSize:11,padding:"2px 8px",borderRadius:5,
                            background:oi===p.ans?"rgba(34,197,94,.15)":"var(--bg4)",
                            border:`1px solid ${oi===p.ans?"var(--success)":"var(--border)"}`,
                            color:oi===p.ans?"var(--success)":"var(--text3)",fontWeight:oi===p.ans?800:400
                          }}>{"ABCD"[oi]}. {opt}{oi===p.ans?" ✓":""}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Questions list */}
          <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>
            📋 {paperData.questions?.length||0} Question{(paperData.questions?.length||0)!==1?"s":""} in this Paper
          </div>
          {(paperData.questions?.length||0)===0&&(
            <div style={{textAlign:"center",padding:20,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:10}}>
              No questions yet — add above.
            </div>
          )}
          {(paperData.questions||[]).map((q,qi)=>(
            <div key={qi} className="card2" style={{marginBottom:8,borderLeft:`3px solid ${qi===editQIdx?meta.color:"var(--border)"}`}}>
              <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{width:26,height:26,borderRadius:7,background:`${meta.color}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:meta.color,flexShrink:0}}>{qi+1}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>{q.q}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {q.options.filter(o=>o).map((opt,oi)=>(
                      <span key={oi} style={{fontSize:11,padding:"2px 9px",borderRadius:5,
                        background:oi===q.ans?"rgba(34,197,94,.12)":"transparent",
                        border:`1px solid ${oi===q.ans?"var(--success)":"var(--border)"}`,
                        color:oi===q.ans?"var(--success)":"var(--text3)",fontWeight:oi===q.ans?800:400
                      }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}</span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <button className="btn btn-sm" onClick={()=>{setSingleForm({q:q.q,options:[...q.options],ans:q.ans});setEditQIdx(qi);setMcqMode("single");}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>deleteQ(qi)}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════ OSCE EDITOR ════ */}
      {isOsce && (
        <div>
          {/* Two-pane paste area */}
          <div className="card2" style={{marginBottom:16,border:`1px solid ${meta.color}30`}}>
            <div style={{fontWeight:800,fontSize:13,color:meta.color,marginBottom:6}}>🩺 Paste OSCE Station Content</div>
            <div style={{fontSize:11,color:"var(--text3)",marginBottom:10,lineHeight:1.6}}>
              Paste the full OSCE station text (title, instructions, activities, question station). The system will auto-parse it.<br/>
              For multiple stations, separate with a blank line or start each with "PROCEDURE STATION:".
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:10}}>
              <div>
                <div style={{fontSize:11,fontWeight:800,color:meta.color,marginBottom:4}}>📋 Full OSCE Station Text</div>
                <textarea className="paste-box" rows={18} style={{fontFamily:"monospace",fontSize:11,resize:"vertical"}}
                  value={osceText} onChange={e=>{setOsceText(e.target.value);setParsedOsce([]);}}
                  placeholder={"PROCEDURE STATION: TAKING GENERAL, PERSONAL, FAMILY AND SOCIAL HEALTH HISTORY\n\nINSTRUCTION TO CANDIDATE\n➤ Take the history of Hajiya Fatima...\n\nACTIVITIES\n1. Greets client and introduces self (½ mark)\n2. Explains procedure and obtains consent (½ mark)\n...\n\nQUESTION STATION: HISTORY TAKING\nWhich are keys to history taking?\na. Trust\nb. Right Questions\nc. Interpreting the responses\nd. All the above\n\nTotal Marks Obtainable: 12 Marks"} />
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ MCQ Answers (one per line: A / B / C / D)</div>
                <textarea className="paste-box" rows={18} style={{resize:"vertical",borderColor:"rgba(34,197,94,.35)"}}
                  value={osceAnswersText} onChange={e=>{setOsceAnswersText(e.target.value);setParsedOsce([]);}}
                  placeholder={"D\nA\nC\nD\nD\nC\nA"} />
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button className="btn btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}}
                onClick={parseOsce}>🔍 Auto-Parse Station</button>
              {parsedOsce.length>0&&<button className="btn btn-success" onClick={importOsce}>✅ Import {parsedOsce.length} Station{parsedOsce.length!==1?"s":""}</button>}
              <button className="btn" onClick={()=>{setParsedOsce([]);setOsceText("");setOsceAnswersText("");}}>🗑️ Clear</button>
            </div>

            {/* Preview parsed stations */}
            {parsedOsce.length>0&&(
              <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
                <div style={{padding:"8px 14px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>
                  ✓ {parsedOsce.length} station{parsedOsce.length!==1?"s":""} parsed — review then import
                </div>
                {parsedOsce.map((c,i)=>(
                  <div key={i} style={{padding:"12px 14px",borderTop:"1px solid var(--border)"}}>
                    <div style={{fontWeight:800,fontSize:13,color:meta.color,marginBottom:4}}>🩺 {c.heading}</div>
                    {c.instructions.length>0&&(
                      <div style={{marginBottom:6}}>
                        <div style={{fontSize:10,fontWeight:800,color:"var(--text3)",marginBottom:3}}>INSTRUCTIONS ({c.instructions.length})</div>
                        {c.instructions.map((ins,ii)=><div key={ii} style={{fontSize:11,color:"var(--text2)",marginBottom:2}}>➤ {ins}</div>)}
                      </div>
                    )}
                    <div style={{fontSize:11,color:"var(--text3)"}}>
                      {c.activities.length} activities • {c.questionStation.length} question station item{c.questionStation.length!==1?"s":""}
                      {c.totalMarks&&` • ${c.totalMarks}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Edit checklist inline */}
          {editCheckIdx!==null&&(
            <div className="card2" style={{marginBottom:14,border:`2px solid ${meta.color}`,background:`${meta.color}07`}}>
              <div style={{fontWeight:800,fontSize:13,color:meta.color,marginBottom:10}}>✏️ Edit OSCE Station</div>
              <label className="lbl">Station Title *</label>
              <input className="inp" value={editCheckForm.heading} onChange={e=>setEditCheckForm({...editCheckForm,heading:e.target.value})} placeholder="e.g. TAKING GENERAL, PERSONAL, FAMILY AND SOCIAL HEALTH HISTORY" />
              <label className="lbl">Instructions to Candidate (one per line)</label>
              <textarea className="inp" rows={3} style={{fontFamily:"monospace",fontSize:12,resize:"vertical"}}
                value={editCheckForm.instructions} onChange={e=>setEditCheckForm({...editCheckForm,instructions:e.target.value})}
                placeholder={"➤ Take the history of Hajiya Fatima...\n➤ Report as you carry out the procedure."} />
              <label className="lbl">Activities / Procedure Steps (one per line with marks)</label>
              <textarea className="inp" rows={12} style={{fontFamily:"monospace",fontSize:12,resize:"vertical"}}
                value={editCheckForm.activities} onChange={e=>setEditCheckForm({...editCheckForm,activities:e.target.value})}
                placeholder={"1. Greets client and introduces self (½ mark)\n2. Explains procedure and obtains consent (½ mark)"} />
              <label className="lbl">Total Marks Line</label>
              <input className="inp" value={editCheckForm.totalMarks||""} onChange={e=>setEditCheckForm({...editCheckForm,totalMarks:e.target.value})} placeholder="Total Marks Obtainable: 12 Marks" />
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}} onClick={saveEditChecklist}>💾 Save Changes</button>
                <button className="btn" onClick={()=>{setEditCheckIdx(null);setEditCheckForm({heading:"",instructions:"",activities:"",questionStation:"",answers:""});}}>Cancel</button>
              </div>
            </div>
          )}

          {/* Checklists list */}
          <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>
            🩺 {osceData.checklists?.length||0} OSCE Station{(osceData.checklists?.length||0)!==1?"s":""}
          </div>
          {(osceData.checklists?.length||0)===0&&(
            <div style={{textAlign:"center",padding:20,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:10}}>
              No OSCE stations yet — paste and import above.
            </div>
          )}
          {(osceData.checklists||[]).map((c,ci)=>(
            <div key={c.id||ci} className="card2" style={{marginBottom:10,borderLeft:`3px solid ${ci===editCheckIdx?meta.color:"var(--border)"}`}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:800,fontSize:14,color:meta.color,marginBottom:4}}>🩺 {c.heading}</div>
                  <div style={{fontSize:11,color:"var(--text3)"}}>
                    {(c.activities||c.steps||[]).length} activities • {(c.questionStation||[]).length} Q-station items
                    {c.totalMarks&&` • ${c.totalMarks}`}
                  </div>
                </div>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <button className="btn btn-sm" onClick={()=>{
                    setEditCheckIdx(ci);
                    const actText = (c.activities||[]).map(a=>{
                      const lines = [`${a.num}. ${a.text}${a.mark?" ("+a.mark+")":""}`];
                      if (a.subItems) a.subItems.forEach(s=>lines.push(`${s.letter}. ${s.text}${s.mark?" ("+s.mark+")":""}`));
                      return lines.join("\n");
                    }).join("\n");
                    setEditCheckForm({
                      heading:c.heading,
                      instructions:(c.instructions||[]).map(s=>"➤ "+s).join("\n"),
                      activities: actText || (c.steps||[]).join("\n"),
                      questionStation:"",
                      totalMarks: c.totalMarks||"",
                      answers:"",
                    });
                  }}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>deleteChecklist(ci)}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PHN CLASS FORUM — Public Health Nursing students only
// ═══════════════════════════════════════════════════════════════════════

export function AdminDailyMockManager({ toast }) {
  const [pool, setPool] = useSharedData("nv-daily-mock", []);
  const [mockTitle, setMockTitle] = useState(()=>ls("nv-daily-mock-title",""));
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState("single"); // "single"|"paste"
  const [form, setForm] = useState({q:"", options:["","","",""], ans:0, cat:"General"});
  const [editIdx, setEditIdx] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteAnswers, setPasteAnswers] = useState("");
  const [parsedQ, setParsedQ] = useState([]);
  const [previewPage, setPreviewPage] = useState(0);
  const PREVIEW_PER_PAGE = 20;
  const CATS = ["General","Pharmacology","Physiology","Midwifery","Public Health","Paediatrics","Psychiatric","Critical Care","Anatomy","Medical-Surgical","Community Health","Obstetrics","Paediatrics"];

  const save = async (newPool, titleOverride) => {
    const title = titleOverride !== undefined ? titleOverride : mockTitle;
    setPool(newPool);
    lsSet("nv-daily-mock", newPool);
    lsSet("nv-daily-mock-title", title);
    dispatchSync();
    setSaving(true);
    const ok = await mockChunkSave(newPool, { mockTitle: title });
    setSaving(false);
    if (!ok) toast("⚠️ Saved locally — cloud sync failed","warn");
    else toast(`✅ ${newPool.length} questions saved to cloud!`, "success");
  };

  const addSingle = () => {
    if (!form.q.trim()) return toast("Question text required","error");
    if (!form.options[0]||!form.options[1]) return toast("At least options A & B required","error");
    if (pool.length >= 250 && editIdx===null) return toast("Pool is full (250). Delete some first.","error");
    const q = {id:Date.now(), q:form.q.trim(), options:form.options.map(o=>o.trim()), ans:form.ans, cat:form.cat};
    let np;
    if (editIdx!==null) { np=pool.map((p,i)=>i===editIdx?q:p); setEditIdx(null); }
    else { np=[...pool,q]; }
    save(np);
    setForm({q:"",options:["","","",""],ans:0,cat:"General"});
  };

  const doParse = () => {
    const items = robustParseQuestions(pasteText, pasteAnswers);
    const remaining = 250 - pool.length;
    const capped = items.slice(0, remaining);
    setParsedQ(capped);
    setPreviewPage(0);
    if (!capped.length) toast("No questions parsed — check format below","error");
    else toast(
      `✅ ${capped.length} question${capped.length!==1?"s":""} parsed!`
      + (items.length > capped.length ? ` (${items.length-capped.length} skipped — would exceed 250)` : ""),
      "success"
    );
  };

  const importParsed = async () => {
    if (!parsedQ.length) return;
    const newPool = [...pool, ...parsedQ];
    await save(newPool);
    setParsedQ([]); setPasteText(""); setPasteAnswers(""); setPreviewPage(0);
  };

  const deleteOne = (i) => {
    if (!confirm("Delete this question?")) return;
    const np = pool.filter((_,idx)=>idx!==i);
    save(np);
    if(editIdx===i){ setEditIdx(null); setForm({q:"",options:["","","",""],ans:0,cat:"General"}); }
  };

  const deleteAll = () => {
    if (!confirm(`Delete ALL ${pool.length} questions? This cannot be undone.`)) return;
    save([]);
  };

  const pct = Math.min(100, Math.round((pool.length/250)*100));
  const barColor = pool.length>=250 ? "#ef4444" : pool.length>=200 ? "#fb923c" : "#4a7a2e";

  // Paginated preview
  const previewPages = Math.ceil(parsedQ.length / PREVIEW_PER_PAGE);
  const previewSlice = parsedQ.slice(previewPage*PREVIEW_PER_PAGE, (previewPage+1)*PREVIEW_PER_PAGE);

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:"#4a7a2e"}}>📅 Daily Mock Question Pool</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
            {pool.length}/250 questions
            {saving&&<span style={{color:"#4a7a2e",marginLeft:8,fontWeight:700}}>⏳ Saving to cloud…</span>}
          </div>
        </div>
        {pool.length>0&&<button className="btn btn-sm btn-danger" onClick={deleteAll}>🗑️ Delete All</button>}
      </div>

      {/* Capacity bar */}
      <div style={{marginBottom:14}}>
        <div style={{height:8,borderRadius:8,background:"var(--border)",overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:8,background:barColor,width:`${pct}%`,transition:"width .4s"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginTop:3}}>
          <span style={{fontWeight:700,color:barColor}}>{pool.length} loaded</span>
          <span>{250-pool.length} slots remaining</span>
        </div>
      </div>

      {/* Exam title */}
      <div className="card2" style={{marginBottom:14,border:"1px solid #4a7a2e30",padding:"12px 16px"}}>
        <div style={{fontWeight:800,fontSize:13,color:"#4a7a2e",marginBottom:6}}>🏷️ Exam Title (shown to students)</div>
        <div style={{display:"flex",gap:8}}>
          <input className="inp" style={{marginBottom:0,flex:1}} value={mockTitle}
            onChange={e=>setMockTitle(e.target.value)}
            placeholder="e.g. Nursing Council Pre-Exam Mock 2025" />
          <button className="btn btn-accent" style={{background:"linear-gradient(135deg,#4a7a2e,#6aaa40)",border:"none",whiteSpace:"nowrap"}}
            onClick={()=>save(pool,mockTitle)}>💾 Save</button>
        </div>
        {mockTitle&&<div style={{marginTop:5,fontSize:11,color:"#4a7a2e",fontWeight:700}}>✓ "{mockTitle}"</div>}
      </div>

      {/* Mode tabs */}
      <div style={{display:"flex",gap:8,margin:"14px 0 12px",flexWrap:"wrap"}}>
        <button className={`btn btn-sm${mode==="single"?" btn-accent":""}`}
          style={mode==="single"?{background:"#4a7a2e",border:"none"}:{}}
          onClick={()=>{setMode("single");setEditIdx(null);setForm({q:"",options:["","","",""],ans:0,cat:"General"});}}>✏️ Single</button>
        <button className={`btn btn-sm${mode==="paste"?" btn-accent":""}`}
          style={mode==="paste"?{background:"#4a7a2e",border:"none"}:{}}
          onClick={()=>setMode("paste")}>📋 Paste 250 Questions</button>
      </div>

      {/* Single form */}
      {mode==="single"&&(
        <div className="card2" style={{marginBottom:14,border:"1px solid #4a7a2e30"}}>
          <div style={{fontWeight:800,fontSize:13,color:"#4a7a2e",marginBottom:10}}>
            {editIdx!==null?`✏️ Editing Q${editIdx+1}`:"✏️ New Question"}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginBottom:8}}>
            <div>
              <label className="lbl">Question *</label>
              <textarea className="inp" rows={3} style={{resize:"vertical"}} value={form.q}
                onChange={e=>setForm({...form,q:e.target.value})} placeholder="Question text..." />
            </div>
            <div>
              <label className="lbl">Category</label>
              <select className="inp" value={form.cat} onChange={e=>setForm({...form,cat:e.target.value})}>
                {CATS.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            {["A","B","C","D"].map((L,i)=>(
              <div key={L}>
                <label className="lbl">Option {L}{i<2?" *":""}</label>
                <input className="inp" style={{marginBottom:0}} placeholder={`Option ${L}...`} value={form.options[i]}
                  onChange={e=>{const o=[...form.options];o[i]=e.target.value;setForm({...form,options:o});}} />
              </div>
            ))}
          </div>
          <label className="lbl">Correct Answer *</label>
          <select className="inp" value={form.ans} onChange={e=>setForm({...form,ans:+e.target.value})}>
            {["A","B","C","D"].map((L,i)=><option key={L} value={i}>Option {L}{form.options[i]?`: ${form.options[i]}`:""}</option>)}
          </select>
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-accent" style={{background:"linear-gradient(135deg,#4a7a2e,#6aaa40)",border:"none"}}
              onClick={addSingle}>{editIdx!==null?"💾 Update":"➕ Add to Pool"}</button>
            {editIdx!==null&&<button className="btn" onClick={()=>{setEditIdx(null);setForm({q:"",options:["","","",""],ans:0,cat:"General"});}}>Cancel</button>}
          </div>
        </div>
      )}

      {/* Paste form */}
      {mode==="paste"&&(
        <div className="card2" style={{marginBottom:14,border:"1px solid #4a7a2e30"}}>
          <div style={{fontWeight:800,fontSize:13,color:"#4a7a2e",marginBottom:4}}>📋 Paste Up to 250 Questions</div>
          <div style={{fontSize:11,color:"var(--text3)",marginBottom:10,lineHeight:1.7,background:"var(--bg4)",borderRadius:8,padding:"8px 12px"}}>
            <b>Supported formats (can mix):</b><br/>
            <code>1. Question text</code> or <code>Q: Question text</code><br/>
            <code>A. Option &nbsp; B. Option &nbsp; C. Option &nbsp; D. Option</code><br/>
            <code>Answer: B</code> &nbsp;(inline) — OR use the Answers box on the right<br/>
            Blank lines between questions are <b>optional</b> — parser handles both.
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 260px",gap:12,marginBottom:10}}>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"#4a7a2e",marginBottom:4}}>📝 Questions (paste all 250 here)</div>
              <textarea className="paste-box" style={{minHeight:260,resize:"vertical"}}
                placeholder={"1. What is the normal adult temperature?\nA. 35.0°C\nB. 36.1–37.2°C\nC. 38.5°C\nD. 40.0°C\nAnswer: B\n2. Which organ produces insulin?\nA. Liver\nB. Kidney\nC. Pancreas\nD. Spleen\nAnswer: C"}
                value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsedQ([]);setPreviewPage(0);}} />
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ Answer Key (optional)<br/><span style={{fontWeight:500,color:"var(--text3)"}}>One per line: A / B / C / D<br/>Only needed if answers aren't<br/>included in the questions box.</span></div>
              <textarea className="paste-box" style={{minHeight:260,resize:"vertical",borderColor:"rgba(34,197,94,.35)"}}
                placeholder={"B\nC\nA\n..."} style={{borderColor:"rgba(34,197,94,.35)",minHeight:260,resize:"vertical"}}
                value={pasteAnswers} onChange={e=>{setPasteAnswers(e.target.value);setParsedQ([]);setPreviewPage(0);}} />
            </div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <button className="btn btn-accent" style={{background:"linear-gradient(135deg,#4a7a2e,#6aaa40)",border:"none",fontSize:14,padding:"10px 20px"}}
              onClick={doParse}>🔍 Parse Questions</button>
            {parsedQ.length>0&&(
              <button className="btn btn-success" style={{fontSize:14,padding:"10px 20px"}}
                onClick={importParsed} disabled={saving}>
                {saving?"⏳ Saving…":`✅ Add ${parsedQ.length} to Pool`}
              </button>
            )}
            <button className="btn" onClick={()=>{setParsedQ([]);setPasteText("");setPasteAnswers("");setPreviewPage(0);}}>🗑️ Clear</button>
          </div>

          {/* Parsed preview — paginated so DOM doesn't freeze with 250 items */}
          {parsedQ.length>0&&(
            <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
              <div style={{padding:"10px 14px",background:"rgba(34,197,94,.1)",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <span style={{fontSize:13,fontWeight:800,color:"var(--success)"}}>✓ {parsedQ.length} questions parsed — review then click "Add to Pool"</span>
                {previewPages>1&&(
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <button className="btn btn-sm" disabled={previewPage===0} onClick={()=>setPreviewPage(p=>p-1)}>← Prev</button>
                    <span style={{fontSize:11,color:"var(--text3)"}}>Page {previewPage+1}/{previewPages}</span>
                    <button className="btn btn-sm" disabled={previewPage>=previewPages-1} onClick={()=>setPreviewPage(p=>p+1)}>Next →</button>
                  </div>
                )}
              </div>
              {previewSlice.map((p,i)=>{
                const globalI = previewPage*PREVIEW_PER_PAGE + i;
                return (
                  <div key={globalI} style={{padding:"8px 14px",borderTop:"1px solid var(--border)"}}>
                    <div style={{fontWeight:700,fontSize:12,marginBottom:4}}>{globalI+1}. {p.q}</div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      {p.options.map((opt,oi)=> opt ? (
                        <span key={oi} style={{fontSize:11,padding:"2px 8px",borderRadius:5,
                          background:oi===p.ans?"rgba(34,197,94,.15)":"var(--bg4)",
                          border:`1px solid ${oi===p.ans?"var(--success)":"var(--border)"}`,
                          color:oi===p.ans?"var(--success)":"var(--text3)",fontWeight:oi===p.ans?800:400
                        }}>{"ABCD"[oi]}. {opt}{oi===p.ans?" ✓":""}</span>
                      ) : null)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pool list — also paginated */}
      {pool.length>0&&(
        <PoolList pool={pool} editIdx={editIdx} setForm={setForm} setEditIdx={setEditIdx} setMode={setMode} deleteOne={deleteOne} />
      )}
      {pool.length===0&&(
        <div style={{textAlign:"center",padding:24,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:10,fontSize:13}}>
          No questions yet — add above.
        </div>
      )}
    </div>
  );
}

// Paginated pool list (prevents DOM overload with 250 items)

export function PoolList({ pool, editIdx, setForm, setEditIdx, setMode, deleteOne }) {
  const [page, setPage] = useState(0);
  const PER_PAGE = 25;
  const pages = Math.ceil(pool.length / PER_PAGE);
  const slice = pool.slice(page*PER_PAGE, (page+1)*PER_PAGE);
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
        <div style={{fontWeight:800,fontSize:13,color:"var(--text)"}}>📋 Question Pool ({pool.length}/250)</div>
        {pages>1&&(
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button className="btn btn-sm" disabled={page===0} onClick={()=>setPage(p=>p-1)}>← Prev</button>
            <span style={{fontSize:11,color:"var(--text3)"}}>Page {page+1}/{pages} • Q{page*PER_PAGE+1}–{Math.min((page+1)*PER_PAGE,pool.length)}</span>
            <button className="btn btn-sm" disabled={page>=pages-1} onClick={()=>setPage(p=>p+1)}>Next →</button>
          </div>
        )}
      </div>
      {slice.map((q,i)=>{
        const gi = page*PER_PAGE+i;
        return (
          <div key={q.id||gi} className="card2" style={{marginBottom:8,borderLeft:`3px solid ${gi===editIdx?"#4a7a2e":"var(--border)"}`}}>
            <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
              <div style={{width:28,height:28,borderRadius:7,background:"rgba(74,122,46,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#4a7a2e",flexShrink:0}}>{gi+1}</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:5,flexWrap:"wrap"}}>
                  <div style={{fontWeight:700,fontSize:13,flex:1}}>{q.q}</div>
                  <span style={{fontSize:10,padding:"2px 7px",borderRadius:5,background:"rgba(74,122,46,.1)",color:"#2d4a1e",fontWeight:700,flexShrink:0}}>{q.cat}</span>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {q.options.map((opt,oi)=> opt ? (
                    <span key={oi} style={{fontSize:11,padding:"2px 9px",borderRadius:5,
                      background:oi===q.ans?"rgba(34,197,94,.12)":"transparent",
                      border:`1px solid ${oi===q.ans?"var(--success)":"var(--border)"}`,
                      color:oi===q.ans?"var(--success)":"var(--text3)",fontWeight:oi===q.ans?800:400
                    }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}</span>
                  ) : null)}
                </div>
              </div>
              <div style={{display:"flex",gap:4,flexShrink:0}}>
                <button className="btn btn-sm" onClick={()=>{ setForm({q:q.q,options:[...q.options],ans:q.ans,cat:q.cat||"General"}); setEditIdx(gi); setMode("single"); }}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={()=>deleteOne(gi)}>🗑️</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── NC Archive helpers ─────────────────────────────────────────────────────
// Archive entry shape:
// { id, type:"paper"|"osce"|"dailymock", spec, year, paperKey, title, savedAt,
//   questions?:[...], checklists?:[...] }

export function AdminNcArchiveManager({ toast }) {
  const [archive, setArchive] = useSharedData("nv-nc-archive", []);

  const saveArchive = async (newArr) => {
    setArchive(newArr);
    const ok = await saveShared("ncArchive", newArr);
    if (!ok) toast("⚠️ Saved locally — sync failed","warn");
  };

  const deleteEntry = (id) => {
    if (!confirm("Remove this entry from archive?")) return;
    saveArchive(archive.filter(e=>e.id!==id));
    toast("Removed from archive","success");
  };

  const deleteAll = () => {
    if (!confirm(`Delete ALL ${archive.length} archive entries? Students will lose access to these.`)) return;
    saveArchive([]);
    toast("🗑️ Archive cleared","success");
  };

  const grouped = archive.reduce((g,e)=>{
    const key = e.spec||"Other";
    if (!g[key]) g[key]=[];
    g[key].push(e);
    return g;
  },{});

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:"var(--accent)"}}>🗄️ NC Exam Archive</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
            {archive.length} item{archive.length!==1?"s":""} saved • Students can retake or review anytime
          </div>
        </div>
        {archive.length>0&&<button className="btn btn-sm btn-danger" onClick={deleteAll}>🗑️ Delete All</button>}
      </div>

      {archive.length===0&&(
        <div style={{textAlign:"center",padding:28,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:10,marginTop:14}}>
          <div style={{fontSize:36,marginBottom:8}}>🗄️</div>
          <div style={{fontSize:13}}>No archived items yet.<br/>Use the "Save to Archive" button on any paper or OSCE.</div>
        </div>
      )}

      {Object.entries(grouped).map(([spec, entries])=>(
        <div key={spec} style={{marginTop:14}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--accent)",marginBottom:8,padding:"4px 0",borderBottom:"1px solid var(--border)"}}>
            {NURSING_EXAM_META[spec]?.icon||"📋"} {NURSING_EXAM_META[spec]?.short||spec}
          </div>
          {entries.map(e=>(
            <div key={e.id} className="card2" style={{marginBottom:8,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{fontSize:20}}>{e.type==="osce"?"🩺":e.type==="dailymock"?"📅":"📄"}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13}}>{e.title}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>
                  {e.type==="osce"?`${e.checklists?.length||0} skills`:e.type==="dailymock"?`${e.questions?.length||0} questions`:`${e.questions?.length||0} questions`}
                  {" • "}Saved {new Date(e.savedAt).toLocaleDateString()}
                </div>
              </div>
              <button className="btn btn-sm btn-danger" onClick={()=>deleteEntry(e.id)}>🗑️</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Student: NC Archive View ───────────────────────────────────────────────

export function AdminPaymentDashboard({ toast }) {
  const [history, setHistory] = useState([]);
  const [filter, setFilter] = useState("");
  useEffect(()=>{ _getDoc(_DOC_SHARED).then(d=>{ if(d?.paymentHistory) setHistory(d.paymentHistory); else setHistory(ls("nv-payment-history",[])); }).catch(()=>setHistory(ls("nv-payment-history",[])));}, []);
  const total = history.reduce((s,p)=>s+(p.amount||0),0);
  const filtered = history.filter(p=> !filter || p.email?.includes(filter) || p.name?.includes(filter) || p.code?.includes(filter));
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20}}>
        {[{lbl:"Total Revenue",val:`₦${total.toLocaleString()}`,icon:"💰"},{lbl:"Payments",val:history.length,icon:"💳"},{lbl:"This Month",val:history.filter(p=>new Date(p.date).getMonth()===new Date().getMonth()).length,icon:"📅"}].map(s=>(
          <div key={s.lbl} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px",textAlign:"center"}}>
            <div style={{fontSize:24}}>{s.icon}</div>
            <div style={{fontWeight:800,fontSize:20,marginTop:4}}>{s.val}</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>{s.lbl}</div>
          </div>
        ))}
      </div>
      <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="🔍 Search by name, email or code..." style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg4)",color:"var(--text)",fontSize:13,marginBottom:16,boxSizing:"border-box"}}/>
      {filtered.length === 0 ? <div style={{textAlign:"center",padding:"40px",color:"var(--text3)"}}>No payments found</div>
      : filtered.map((p,i)=>(
        <div key={i} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontWeight:700,fontSize:13}}>{p.name||p.email}</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>{p.email}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--accent)",marginTop:2}}>{p.code}</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>{new Date(p.date).toLocaleString()}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontWeight:800,color:"#22c55e",fontSize:16}}>₦{(p.amount||0).toLocaleString()}</div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>Ref: {p.ref?.slice(0,16)}...</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── PUSH NOTIFICATIONS MANAGER ───────────────────────────────────────

export function AdminPushNotifications({ toast }) {
  const [notifs, setNotifs] = useSharedData("nv-push-notifs", []);
  const [form, setForm] = useState({title:"",body:"",type:"info",targetClass:"all"});
  const [classes] = useSharedData("nv-classes", DEFAULT_CLASSES);

  const send = async () => {
    if (!form.title.trim()||!form.body.trim()) return toast("Fill in title and message","error");
    const n = {id:Date.now(),title:form.title.trim(),body:form.body.trim(),type:form.type,targetClass:form.targetClass,sentAt:Date.now(),sentBy:"admin"};
    const updated = [n, ...notifs];
    setNotifs(updated);
    const ok = await saveShared("pushNotifs", updated);
    toast(ok?"✅ Notification sent to all students!":"✅ Saved locally","success");
    setForm({title:"",body:"",type:"info",targetClass:"all"});
  };

  const del = async (id) => {
    const updated = notifs.filter(n=>n.id!==id);
    setNotifs(updated);
    await saveShared("pushNotifs", updated);
    toast("Deleted","success");
  };

  const TYPES = [{v:"info",l:"ℹ️ Info",c:"#3b82f6"},{v:"success",l:"✅ Success",c:"#22c55e"},{v:"warning",l:"⚠️ Warning",c:"#f59e0b"},{v:"urgent",l:"🚨 Urgent",c:"#ef4444"}];

  return (
    <div>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:20,marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:16}}>📢 Send New Notification</div>
        <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Notification title..." style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg4)",color:"var(--text)",fontSize:13,marginBottom:10,boxSizing:"border-box"}}/>
        <textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} placeholder="Message body..." style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg4)",color:"var(--text)",fontSize:13,marginBottom:10,minHeight:80,resize:"vertical",fontFamily:"inherit",boxSizing:"border-box"}}/>
        <div style={{display:"flex",gap:10,marginBottom:10,flexWrap:"wrap"}}>
          {TYPES.map(t=><button key={t.v} onClick={()=>setForm(f=>({...f,type:t.v}))} style={{padding:"6px 14px",borderRadius:20,border:`2px solid ${form.type===t.v?t.c:"var(--border)"}`,background:form.type===t.v?`${t.c}22`:"transparent",color:form.type===t.v?t.c:"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>{t.l}</button>)}
        </div>
        <button onClick={send} style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--accent)",color:"white",border:"none",cursor:"pointer",fontWeight:700,fontSize:14}}>📢 Send to All Students</button>
      </div>
      <div style={{fontWeight:700,marginBottom:12}}>Sent Notifications ({notifs.length})</div>
      {notifs.length===0?<div style={{textAlign:"center",padding:"30px",color:"var(--text3)"}}>No notifications sent yet</div>
      :notifs.slice(0,20).map(n=>{
        const t=TYPES.find(x=>x.v===n.type)||TYPES[0];
        return (
          <div key={n.id} style={{background:"var(--card)",border:`1px solid ${t.c}44`,borderRadius:12,padding:"12px 16px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontWeight:700,fontSize:13}}>{t.l} {n.title}</div>
              <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{n.body}</div>
              <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>{new Date(n.sentAt).toLocaleString()}</div>
            </div>
            <button onClick={()=>del(n.id)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--danger)",marginLeft:10,flexShrink:0}}>🗑️</button>
          </div>
        );
      })}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// RESEARCH REQUEST
// ════════════════════════════════════════════════════════════════════

export function AdminResearchRequests({ toast }) {
  const allUsers = ls("nv-users", []);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [quoteForm, setQuoteForm] = useState({ price:"", adminNote:"" });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let unsub = () => {};
    _loadFirebase().then(() => {
      unsub = rrSubscribeAll(data => { setRequests(data); setLoading(false); });
    }).catch(() => setLoading(false));
    return () => unsub();
  }, []);

  const sendQuote = async () => {
    if (!quoteForm.price || isNaN(quoteForm.price)) return toast("Enter a valid price","error");
    setSaving(true);
    const updated = { ...selected, status:"quoted", price: quoteForm.price, adminNote: quoteForm.adminNote, quotedAt: Date.now() };
    const ok = await rrSave(updated);
    setSaving(false);
    if (ok) {
      toast("✅ Quote sent to student!","success");
      // Firestore subscription will auto-update requests list
      setSelected(updated);
    } else toast("Failed to send quote","error");
  };

  const markInProgress = async () => {
    const updated = { ...selected, status:"inprogress", startedAt: Date.now() };
    await rrSave(updated);
    toast("Marked as In Progress","success");
    setSelected(updated);
  };

  const uploadAndComplete = (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 3.5*1024*1024) return toast("File must be under 3.5MB","error");
    setUploadingFile(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const updated = { ...selected, status:"completed", projectFile: ev.target.result, projectFileName: file.name, completedAt: Date.now() };
      const ok = await rrSave(updated);
      setUploadingFile(false);
      if (ok) { toast("🎉 Project uploaded and marked complete!","success"); setSelected(updated); }
      else toast("Upload failed","error");
    };
    reader.readAsDataURL(file);
  };

  const declineRequest = async () => {
    if (!window.confirm("Decline this request?")) return;
    const updated = { ...selected, status:"declined", declinedAt: Date.now() };
    await rrSave(updated);
    toast("Request declined","success");
    setSelected(updated);
  };

  const filtered = filter==="all" ? requests : requests.filter(r=>r.status===filter);
  const counts = Object.keys(RR_STATUSES).reduce((acc,k)=>({...acc,[k]:requests.filter(r=>r.status===k).length}),{});

  const StatusBadge = ({ status }) => {
    const s = RR_STATUSES[status] || RR_STATUSES.pending;
    return <span style={{background:s.bg,color:s.color,border:`1px solid ${s.color}44`,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:800}}>{s.icon} {s.label}</span>;
  };

  // ── Detail view ──
  if (selected) {
    const s = RR_STATUSES[selected.status] || RR_STATUSES.pending;
    // Refresh selected from live data
    const live = requests.find(r=>r.id===selected.id) || selected;
    return (
      <div style={{maxWidth:640,margin:"0 auto"}}>
        <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--accent)",fontWeight:700,fontSize:13,marginBottom:16,padding:0}}>← Back to All Requests</button>
        <div style={{background:"var(--card)",border:`2px solid ${s.color}44`,borderRadius:18,padding:24}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontWeight:900,fontSize:17,marginBottom:6}}>{live.topic}</div>
              <StatusBadge status={live.status} />
            </div>
            <div style={{fontSize:11,color:"var(--text3)"}}>{new Date(live.createdAt).toLocaleDateString()}</div>
          </div>

          {/* Student info */}
          <div style={{background:"var(--bg4)",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:12,color:"var(--accent)",marginBottom:10,textTransform:"uppercase"}}>Student Information</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[
                ["Name", live.studentName],
                ["Email", live.student],
                ["Matric No.", live.matricNumber],
                ["Class", live.studentClass],
                ["Programme", live.level],
                ["Phone", live.phone],
                ["Deadline", live.deadline ? new Date(live.deadline).toLocaleDateString() : "—"],
              ].map(([k,v])=>(
                <div key={k}>
                  <div style={{fontSize:10,color:"var(--text3)",fontWeight:700}}>{k}</div>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{v}</div>
                </div>
              ))}
            </div>
            {live.notes&&(
              <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--border)"}}>
                <div style={{fontSize:10,color:"var(--text3)",fontWeight:700,marginBottom:3}}>Notes from Student</div>
                <div style={{fontSize:13,fontWeight:700}}>{live.notes}</div>
              </div>
            )}
          </div>

          {/* Payment status — shown to admin */}
          {live.paid && (
            <div style={{
              background:"rgba(34,197,94,.08)",border:"1.5px solid rgba(34,197,94,.3)",
              borderRadius:12,padding:"12px 16px",marginBottom:16,
              display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"
            }}>
              <div style={{fontSize:20}}>💳</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--success)"}}>Payment Confirmed via Paystack</div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
                  ₦{Number(live.paymentAmount||live.price).toLocaleString()} • Ref: <b style={{color:"var(--text)"}}>{live.paymentRef}</b> • {live.paidAt?new Date(live.paidAt).toLocaleString():""}
                </div>
              </div>
              <span style={{background:"rgba(34,197,94,.15)",color:"var(--success)",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:800}}>✅ PAID</span>
            </div>
          )}

          {/* Quote form — show if still pending */}
          {(live.status==="pending"||live.status==="quoted") && (
            <div style={{background:"rgba(245,158,11,.06)",border:"1.5px solid rgba(245,158,11,.3)",borderRadius:14,padding:"16px 18px",marginBottom:16}}>
              <div style={{fontWeight:900,fontSize:14,color:"#f59e0b",marginBottom:12}}>💰 {live.status==="quoted"?"Update Quote":"Send Quote to Student"}</div>
              <label className="lbl">Price (₦)</label>
              <input className="inp" type="number" value={quoteForm.price||live.price||""} onChange={e=>setQuoteForm({...quoteForm,price:e.target.value})}
                placeholder="e.g. 15000" style={{marginBottom:10}} />
              <label className="lbl">Message to Student</label>
              <textarea className="inp" value={quoteForm.adminNote||live.adminNote||""} onChange={e=>setQuoteForm({...quoteForm,adminNote:e.target.value})}
                placeholder="e.g. Your project will cost ₦15,000 and will be ready in 5 working days."
                style={{minHeight:70,resize:"vertical"}} />
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <button onClick={sendQuote} disabled={saving} style={{flex:1,padding:"11px",borderRadius:10,background:"linear-gradient(135deg,#f59e0b,#d97706)",color:"#fff",border:"none",cursor:"pointer",fontWeight:800,fontSize:14,opacity:saving?0.7:1}}>
                  {saving?"⏳ Sending…":"💰 Send Quote"}
                </button>
                {live.status!=="declined"&&<button onClick={declineRequest} style={{padding:"11px 18px",borderRadius:10,background:"rgba(239,68,68,.1)",color:"var(--danger)",border:"1px solid rgba(239,68,68,.3)",cursor:"pointer",fontWeight:700}}>❌ Decline</button>}
              </div>
            </div>
          )}

          {/* Accepted — can mark in progress or upload */}
          {live.status==="accepted" && (
            <div style={{background:"rgba(139,92,246,.06)",border:"1.5px solid rgba(139,92,246,.3)",borderRadius:14,padding:"16px 18px",marginBottom:16}}>
              <div style={{fontWeight:900,fontSize:14,color:"#8b5cf6",marginBottom:12}}>🔄 Project Actions</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <button onClick={markInProgress} style={{flex:1,padding:"11px",borderRadius:10,background:"linear-gradient(135deg,#06b6d4,#0891b2)",color:"#fff",border:"none",cursor:"pointer",fontWeight:800}}>🔄 Mark In Progress</button>
              </div>
            </div>
          )}

          {/* In Progress — upload completed project */}
          {live.status==="inprogress" && (
            <div style={{background:"rgba(6,182,212,.06)",border:"1.5px solid rgba(6,182,212,.3)",borderRadius:14,padding:"16px 18px",marginBottom:16}}>
              <div style={{fontWeight:900,fontSize:14,color:"#06b6d4",marginBottom:12}}>📤 Upload Completed Project</div>
              <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>Upload the finished project (PDF, max 3.5MB). The student will be notified and can download it.</div>
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" style={{display:"none"}} onChange={uploadAndComplete} />
              <button
                onClick={()=>fileRef.current?.click()}
                disabled={uploadingFile}
                style={{width:"100%",padding:"12px",borderRadius:10,background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",border:"none",cursor:"pointer",fontWeight:800,fontSize:14,opacity:uploadingFile?0.7:1}}
              >{uploadingFile?"⏳ Uploading…":"📤 Upload & Mark Complete"}</button>
            </div>
          )}

          {/* Completed */}
          {live.status==="completed" && (
            <div style={{background:"rgba(34,197,94,.08)",border:"1.5px solid rgba(34,197,94,.3)",borderRadius:14,padding:"16px 18px",textAlign:"center"}}>
              <div style={{fontSize:32,marginBottom:6}}>🎉</div>
              <div style={{fontWeight:900,color:"var(--success)"}}>Project Completed!</div>
              <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>Completed on {new Date(live.completedAt).toLocaleDateString()}</div>
              {live.projectFile&&<a href={live.projectFile} download={live.projectFileName||"project.pdf"} style={{display:"inline-block",marginTop:10,padding:"8px 20px",borderRadius:9,background:"var(--success)",color:"#fff",fontWeight:700,fontSize:13,textDecoration:"none"}}>📥 Download</a>}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontWeight:900,fontSize:18}}>📜 Research Requests</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{requests.length} total request{requests.length!==1?"s":""}</div>
        </div>
        {/* Summary badges */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {Object.entries(RR_STATUSES).filter(([k])=>counts[k]>0).map(([k,s])=>(
            <span key={k} style={{background:s.bg,color:s.color,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:800,border:`1px solid ${s.color}33`}}>{s.icon} {counts[k]}</span>
          ))}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {[["all","All",requests.length],...Object.entries(RR_STATUSES).map(([k,s])=>[k,s.label,counts[k]])].map(([k,lbl,cnt])=>(
          <button key={k} onClick={()=>setFilter(k)} style={{
            padding:"5px 12px",borderRadius:20,fontSize:12,fontWeight:700,cursor:"pointer",
            background:filter===k?"var(--accent)":"transparent",
            color:filter===k?"#fff":"var(--text3)",
            border:`1px solid ${filter===k?"var(--accent)":"var(--border)"}`
          }}>{lbl}{cnt>0?` (${cnt})`:""}</button>
        ))}
      </div>

      {loading&&<div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>Loading requests…</div>}
      {!loading&&filtered.length===0&&(
        <div style={{textAlign:"center",padding:"50px 20px",color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:14}}>
          <div style={{fontSize:40,marginBottom:8}}>📜</div>
          <div style={{fontWeight:700}}>{filter==="all"?"No requests yet":"No requests with this status"}</div>
        </div>
      )}

      {filtered.map(req=>{
        const s = RR_STATUSES[req.status]||RR_STATUSES.pending;
        const studentUser = allUsers.find(u=>u.username===req.student);
        return (
          <div
            key={req.id}
            onClick={()=>{ setSelected(req); setQuoteForm({price:req.price||"",adminNote:req.adminNote||""}); }}
            style={{
              background:"var(--card)",border:`1px solid ${s.color}33`,
              borderRadius:14,padding:"16px 18px",marginBottom:12,
              cursor:"pointer",transition:"all .2s",borderLeft:`4px solid ${s.color}`
            }}
            onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
            onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}
          >
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>{req.topic}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:6}}>
                  <b style={{color:"var(--text)"}}>{req.studentName}</b> • {req.studentClass} • {req.matricNumber}
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{fontSize:11,color:"var(--text3)"}}>{new Date(req.createdAt).toLocaleDateString()}</span>
                  {req.deadline&&<span style={{fontSize:11,color:"var(--warn)"}}>⏰ Due {new Date(req.deadline).toLocaleDateString()}</span>}
                  {req.phone&&<span style={{fontSize:11,color:"var(--text3)"}}>📞 {req.phone}</span>}
                  {req.price&&<span style={{fontSize:12,fontWeight:800,color:"#f59e0b"}}>₦{Number(req.price).toLocaleString()}</span>}
                  {req.paid&&<span style={{fontSize:11,fontWeight:800,color:"var(--success)"}}>💳 PAID</span>}
                </div>
              </div>
              <span style={{background:s.bg,color:s.color,border:`1px solid ${s.color}44`,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:800,flexShrink:0}}>{s.icon} {s.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// RESEARCH CLUB
// ════════════════════════════════════════════════════════════════════
