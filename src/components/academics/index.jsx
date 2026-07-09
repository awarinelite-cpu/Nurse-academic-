import { useState, useEffect, useRef } from "react";
import { DEFAULT_CLASSES } from "../../data/defaults";
import { _safeKey, asgGrade, asgLoadMySubmission, asgLoadSubmissions, asgSave, asgSubmit, asgSubscribe, attLoad, attLoadRange, attMark, dispatchSync, examBsGet, examBsSet, saveFoldersToBackend, saveMyData, saveShared, sgCreateGroup, sgSend, sgSubscribe, sgSubscribeGroups, ttLoad, ttSave, useSharedData } from "../../services/backend";
import { ls, lsSet } from "../../utils/storage";
import { GroupVideoCallBtn } from "../../components/video-call";
import { DAYS, HOURS } from "../../shared/timetableConstants";

export function HandoutViewModal({ item, onClose }) {
  const [pdfSrc, setPdfSrc] = useState(item.pdfData || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pdfSrc && item.hasPdf && item.pdfKey) {
      setLoading(true);
      examBsGet(item.pdfKey || "").then(data => {
        if (data) setPdfSrc(data);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [item]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:800,width:"95vw"}} onClick={e=>e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{item.title}</div>
          <button className="modal-close" onClick={onClose}>X</button>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
          {item.course&&<span className="tag tag-accent">{item.course}</span>}
          {item.lecturerName&&<span className="tag" style={{borderColor:"var(--purple)",color:"var(--purple)"}}>{item.lecturerName}</span>}
          {(item.pdfName||item.hasPdf)&&<span className="tag" style={{borderColor:"var(--danger)",color:"var(--danger)"}}>PDF</span>}
          {item.hasDriveLink&&<span className="tag" style={{borderColor:"#1a73e8",color:"#1a73e8"}}>📂 Google Drive</span>}
          <div style={{fontSize:10,color:"var(--text3)",fontFamily:"monospace",marginLeft:"auto"}}>
            Added {item.date}{item.uploadedBy&&` by ${item.uploadedBy.split("@")[0]}`}
          </div>
        </div>
        {(item.hasPdf || item.pdfData) ? (
          loading ? (
            <div style={{textAlign:"center",padding:"60px 0",color:"var(--text3)"}}>
              <div>Loading PDF...</div>
            </div>
          ) : pdfSrc ? (
            <div>
              <div style={{background:"var(--bg4)",borderRadius:10,padding:"8px 12px",marginBottom:10,display:"flex",alignItems:"center",gap:10,fontSize:12}}>
                <span>PDF: {item.pdfName||"Document"}</span>
                <a href={pdfSrc} download={item.pdfName||"handout.pdf"}
                  style={{background:"var(--accent)",color:"white",padding:"5px 14px",borderRadius:8,textDecoration:"none",fontSize:12,fontWeight:700,marginLeft:"auto"}}
                  onClick={e=>e.stopPropagation()}>Download</a>
              </div>
              <iframe src={pdfSrc} style={{width:"100%",height:"65vh",border:"1px solid var(--border)",borderRadius:10,display:"block"}} title={item.title} />
            </div>
          ) : (
            <div style={{textAlign:"center",padding:"40px",color:"var(--text3)"}}>
              Could not load PDF. It may not have synced yet — try refreshing.
            </div>
          )
        ) : item.hasDriveLink ? (
          <div style={{textAlign:"center",padding:"30px 20px"}}>
            <div style={{fontSize:40,marginBottom:12}}>📂</div>
            <div style={{fontWeight:800,fontSize:16,marginBottom:6,color:"var(--text)"}}>Files on Google Drive</div>
            <div style={{color:"var(--text3)",fontSize:13,marginBottom:20}}>Click the button below to open and view all handout files.</div>
            <a href={item.driveLink} target="_blank" rel="noopener noreferrer"
              style={{display:"inline-flex",alignItems:"center",gap:10,padding:"12px 24px",background:"#1a73e8",color:"#fff",borderRadius:10,fontWeight:800,fontSize:14,textDecoration:"none",boxShadow:"0 3px 12px rgba(26,115,232,.4)",transition:"opacity .2s"}}
              onMouseEnter={e=>e.currentTarget.style.opacity=".85"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}
              onClick={e=>e.stopPropagation()}>
              <svg width="20" height="20" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>
              Open in Google Drive
            </a>
          </div>
        ) : (
          <div style={{maxHeight:"65vh",overflowY:"auto",padding:"4px 0"}}>
            <div style={{fontSize:14,lineHeight:1.9,color:"var(--text2)",whiteSpace:"pre-wrap"}}>{item.note||"No content."}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Handouts({ selectedClass, toast, currentUser, isLecturer }) {
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [handouts, setHandouts] = useSharedData("nv-handouts", []);
  // folders: { classId: { course: [lecturerName,...] } }
  const [folders, setFolders] = useSharedData("nv-folders", {});
  const allUsers = ls("nv-users",[]);
  const lecturers = allUsers.filter(u=>u.role==="lecturer"||u.role==="admin");

  // Upload form
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({title:"", note:"", classId: selectedClass?.id||"", course:"", lecturerName:"", uploadType:"text"});
  const [pdfFile, setPdfFile] = useState(null); const [pdfName, setPdfName] = useState("");

  // Folder creation modals
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [showLecturerModal, setShowLecturerModal] = useState(false);
  const [newLecturerName, setNewLecturerName] = useState("");
  // Rename course folder
  const [renameCourseTarget, setRenameCourseTarget] = useState(null); // old course name
  const [renameCourseVal, setRenameCourseVal] = useState("");

  // Drill-down navigation: null = top level
  const [drillClass, setDrillClass] = useState(selectedClass?.id||null);
  const [drillCourse, setDrillCourse] = useState(null);
  const [drillLecturer, setDrillLecturer] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const [filter, setFilter] = useState("");

  // Save folders helper
  const saveFolders = (f) => {
    lsSet("nv-folders", f);    // update localStorage immediately
    setFolders(f);              // update React state immediately
    dispatchSync();             // notify all useSharedData hooks
    saveFoldersToBackend(f);    // write to Firestore, bypassing merge
  };

  // Ensure course folders include both handout-derived courses AND manually created ones
  const getCoursesForClass = (classId) => {
    const cls = classes.find(c=>c.id===classId);
    const fromHandouts = handouts.filter(h=>h.classId===classId).map(h=>h.course).filter(Boolean);
    const fromFolders = Object.keys(folders[classId]||{});
    const defaultCourses = cls?.courses||[];
    return [...new Set([...defaultCourses,...fromFolders,...fromHandouts])];
  };

  // Get lecturers for a course (folders + handout-derived)
  const getLecturersForCourse = (classId, course) => {
    const fromFolders = (folders[classId]?.[course])||[];
    const fromHandouts = handouts.filter(h=>h.classId===classId&&h.course===course).map(h=>h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown").filter(Boolean);
    return [...new Set([...fromFolders,...fromHandouts])];
  };

  // Create a course folder
  const createCourseFolder = () => {
    if (!newCourseName.trim()) return toast("Enter course name","error");
    if (!drillClass) return;
    const f = {...folders, [drillClass]:{...(folders[drillClass]||{}), [newCourseName.trim()]:folders[drillClass]?.[newCourseName.trim()]||[]}};
    saveFolders(f);
    toast(`📂 Course folder "${newCourseName.trim()}" created!`,"success");
    setShowCourseModal(false); setNewCourseName("");
  };

  // Create a lecturer folder inside a course
  const createLecturerFolder = () => {
    if (!newLecturerName.trim()) return toast("Enter lecturer name","error");
    if (!drillClass||!drillCourse) return;
    const existing = (folders[drillClass]?.[drillCourse])||[];
    if (existing.includes(newLecturerName.trim())) return toast("Lecturer folder already exists","warn");
    const f = {...folders,[drillClass]:{...(folders[drillClass]||{}),[drillCourse]:[...existing,newLecturerName.trim()]}};
    saveFolders(f);
    toast(`👨🏫 Lecturer folder "${newLecturerName.trim()}" created!`,"success");
    setShowLecturerModal(false); setNewLecturerName("");
  };

  // Rename a course folder — updates folders map + all handouts that reference the old name
  const renameCourseFolder = () => {
    const oldName = renameCourseTarget;
    const newName = renameCourseVal.trim();
    if (!newName) return toast("Enter a new name","error");
    if (newName === oldName) { setRenameCourseTarget(null); return; }
    if (!drillClass) return;
    // Rename in folders map
    const classF = {...(folders[drillClass]||{})};
    classF[newName] = classF[oldName] || [];
    delete classF[oldName];
    const f = {...folders, [drillClass]: classF};
    saveFolders(f);
    // Rename in all handouts
    const updatedHandouts = handouts.map(h =>
      h.classId===drillClass && h.course===oldName ? {...h, course:newName} : h
    );
    setHandouts(updatedHandouts); saveShared("handouts", updatedHandouts);
    // Also rename in class default courses list if it exists there
    const updatedClasses = classes.map(c => {
      if (c.id !== drillClass) return c;
      return {...c, courses: c.courses.map(co => co===oldName ? newName : co)};
    });
    // Save classes update
    const { saveShared: _s, ..._ } = {}; // dummy
    saveShared("classes", updatedClasses);
    toast(`✏️ Course renamed to "${newName}"`, "success");
    setRenameCourseTarget(null); setRenameCourseVal("");
    if (drillCourse === oldName) setDrillCourse(newName);
  };

  const selCls = classes.find(c=>c.id===drillClass);

  const pushNotification = (item) => {
    const notifs = ls("nv-notifications", []);
    const notif = {
      id: Date.now(), ts: Date.now(), type:"handout",
      title:`New handout: ${item.title}`,
      body:`${item.lecturerName||currentUser.split("@")[0]} uploaded ${item.hasDriveLink?"Google Drive files ":item.pdfName?"a PDF ":"notes "}for ${item.course||"your class"}`,
      from: currentUser, date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
      read: false, handoutId: item.id,
    };
    saveMyData("notifications","nv-notifications",[notif,...notifs]);
  };

  const handlePdfChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.type !== "application/pdf") return toast("Please select a PDF file","error");
    // Keep under 3.5MB so base64 fits in 5MB backend storage limit
    if (file.size > 3.5*1024*1024) return toast("PDF must be under 3.5MB for cross-device sync","error");
    const reader = new FileReader();
    reader.onload = (ev) => { setPdfFile(ev.target.result); setPdfName(file.name); };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!form.title.trim()) return toast("Enter a title","error");
    if (!form.classId) return toast("Select a class","error");
    if (!form.course) return toast("Select a course","error");
    if (!form.lecturerName.trim()) return toast("Enter lecturer name","error");
    if (form.uploadType==="pdf" && !pdfFile) return toast("Select a PDF file","error");
    if (form.uploadType==="drive" && !form.driveLink?.trim()) return toast("Paste a Google Drive link","error");
    if (form.uploadType==="drive" && !form.driveLink.includes("drive.google.com")) return toast("That doesn't look like a Google Drive link","error");

    const itemId = Date.now();
    // Store PDF data SEPARATELY under its own key (not in the handouts array)
    // This prevents the handouts metadata array from exceeding the 5MB backend limit
    if (form.uploadType==="pdf" && pdfFile) {
      const pdfOk = await examBsSet(`handout-pdf:${itemId}`, pdfFile);
      if (!pdfOk) {
        toast("❌ PDF too large to sync — try a smaller file (under 3.5MB)","error");
        return;
      }
    }
    const item = {
      id: itemId, title: form.title, note: form.note,
      classId: form.classId, course: form.course, lecturerName: form.lecturerName,
      date: new Date().toLocaleDateString(), uploadedBy: currentUser,
      // Only store filename in the array, not the full base64 data
      ...(form.uploadType==="pdf" ? {hasPdf:true, pdfName, pdfKey:`handout-pdf:${itemId}`} : {}),
      ...(form.uploadType==="drive" ? {hasDriveLink:true, driveLink:form.driveLink.trim()} : {})
    };
    const u=[...handouts,item]; setHandouts(u);
    const ok = await saveShared("handouts", u);
    if (!ok) {
      toast("⚠️ Saved locally but failed to sync to server — check connection","warn");
    } else {
      toast("Handout published! Students notified. ✅","success");
    }
    pushNotification(item);
    setForm({title:"",note:"",classId:drillClass||"",course:drillCourse||"",lecturerName:"",uploadType:"text",driveLink:""});
    setPdfFile(null); setPdfName(""); setShowAdd(false);
    if (!drillClass) setDrillClass(item.classId);
  };

  const del=(id)=>{const u=handouts.filter(h=>h.id!==id);setHandouts(u);saveShared("handouts",u);toast("Deleted","info");};

  // Computed collections for drill-down
  const classHandouts = handouts.filter(h=>h.classId===drillClass);
  const coursesInClass = drillClass ? getCoursesForClass(drillClass) : [];
  const courseHandouts = classHandouts.filter(h=>h.course===drillCourse);
  const lecturersInCourse = drillClass&&drillCourse ? getLecturersForCourse(drillClass, drillCourse) : [];
  const lecturerHandouts = courseHandouts.filter(h=>(h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown")===drillLecturer);

  // Search filtering (only at leaf level)
  const searchFiltered = filter
    ? handouts.filter(h=>h.title.toLowerCase().includes(filter.toLowerCase())||h.course?.toLowerCase().includes(filter.toLowerCase())||h.lecturerName?.toLowerCase().includes(filter.toLowerCase()))
    : null;

  // Breadcrumb
  const Breadcrumb = () => (
    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,marginBottom:12,flexWrap:"wrap"}}>
      <span style={{color:"var(--accent)",cursor:"pointer",fontWeight:800}} onClick={()=>{setDrillClass(null);setDrillCourse(null);setDrillLecturer(null);setFilter("");}}>🏠 All Classes</span>
      {drillClass&&<><span style={{color:"var(--text3)"}}>›</span>
        <span style={{color:drillCourse?"var(--accent)":"var(--text)",cursor:drillCourse?"pointer":"default",fontWeight:800}}
          onClick={()=>{if(drillCourse){setDrillCourse(null);setDrillLecturer(null);}}}>{selCls?.label||drillClass}</span></>}
      {drillCourse&&<><span style={{color:"var(--text3)"}}>›</span>
        <span style={{color:drillLecturer?"var(--accent)":"var(--text)",cursor:drillLecturer?"pointer":"default",fontWeight:800}}
          onClick={()=>{if(drillLecturer)setDrillLecturer(null);}}>{drillCourse}</span></>}
      {drillLecturer&&<><span style={{color:"var(--text3)"}}>›</span>
        <span style={{fontWeight:800,color:"var(--text)"}}>👨🏫 {drillLecturer}</span></>}
    </div>
  );

  // Folder card component
  const FolderCard = ({icon, label, sublabel, count, countLabel, color, onClick}) => (
    <div className="card" style={{cursor:"pointer",borderLeft:`4px solid ${color}`,transition:"all .2s",userSelect:"none"}} onClick={onClick}
      onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
      onMouseLeave={e=>e.currentTarget.style.transform=""}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:44,height:44,borderRadius:12,background:`${color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{icon}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>{sublabel}</div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:18,color}}>{count}</div>
          <div style={{fontSize:10,color:"var(--text3)"}}>{countLabel}</div>
        </div>
        <div style={{color:"var(--text3)",fontSize:16,marginLeft:4}}>›</div>
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div className="sec-title">📄 Handouts</div>
          <div className="sec-sub">{handouts.length} total • organised by class › course › lecturer</div>
        </div>
        {isLecturer && !drillLecturer && <button className="btn btn-accent" onClick={()=>setShowAdd(p=>!p)}>+ Upload Handout</button>}
      </div>

      {/* Search bar */}
      <div className="search-wrap" style={{marginBottom:16}}>
        <span className="search-ico">🔍</span>
        <input placeholder="Search handouts by title, course, lecturer..." value={filter} onChange={e=>setFilter(e.target.value)} />
        {filter&&<span style={{cursor:"pointer",color:"var(--text3)",fontSize:16,marginRight:4}} onClick={()=>setFilter("")}>✕</span>}
      </div>

      {/* ── Upload form (inline, not modal) ── */}
      {showAdd&&isLecturer&&(
        <div className="card" style={{marginBottom:20,border:"1px solid var(--border2)",animation:"fadeUp .25s ease"}}>
          <div style={{fontWeight:800,fontSize:14,color:"var(--accent)",marginBottom:16}}>📤 Upload New Handout</div>
          {/* 4-column upload row */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginBottom:12}}>
            {/* Class */}
            <div>
              <label className="lbl">Class *</label>
              <select className="inp" style={{marginBottom:0}} value={form.classId} onChange={e=>setForm({...form,classId:e.target.value,course:""})}>
                <option value="">— Select class —</option>
                {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            {/* Course */}
            <div>
              <label className="lbl">Course *</label>
              <select className="inp" style={{marginBottom:0}} value={form.course} onChange={e=>setForm({...form,course:e.target.value})} disabled={!form.classId}>
                <option value="">— Select course —</option>
                {(form.classId ? getCoursesForClass(form.classId) : []).map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {/* Lecturer */}
            <div>
              <label className="lbl">Lecturer Name *</label>
              <input className="inp" style={{marginBottom:0}} placeholder="Your name or title" value={form.lecturerName}
                onChange={e=>setForm({...form,lecturerName:e.target.value})}
                list="lecturer-name-suggestions" />
              <datalist id="lecturer-name-suggestions">
                {lecturers.map(l=><option key={l.username} value={l.username.split("@")[0]} />)}
              </datalist>
            </div>
            {/* Title */}
            <div>
              <label className="lbl">Handout Title *</label>
              <input className="inp" style={{marginBottom:0}} placeholder="e.g. Week 3 Notes" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} />
            </div>
          </div>
          {/* Content type */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
            {["text","pdf","drive"].map(t=>(
              <div key={t} onClick={()=>setForm({...form,uploadType:t})} style={{padding:"10px",border:`1px solid ${form.uploadType===t?(t==="drive"?"#1a73e8":"var(--accent)"):"var(--border)"}`,borderRadius:9,cursor:"pointer",textAlign:"center",background:form.uploadType===t?(t==="drive"?"rgba(26,115,232,.10)":"rgba(0,119,182,.10)"):"transparent",fontSize:13,color:form.uploadType===t?(t==="drive"?"#1a73e8":"var(--accent)"):"var(--text3)",transition:"all .2s"}}>
                {t==="text"?"📝 Text Notes":t==="pdf"?"📄 PDF File":"🔗 Google Drive"}
              </div>
            ))}
          </div>
          {form.uploadType==="text" ? (
            <div style={{marginBottom:12}}>
              <label className="lbl">Content</label>
              <textarea className="inp" rows={4} style={{resize:"vertical",marginBottom:0}} placeholder="Paste or type notes..." value={form.note} onChange={e=>setForm({...form,note:e.target.value})} />
            </div>
          ) : form.uploadType==="pdf" ? (
            <div style={{marginBottom:12}}>
              <label className="lbl">PDF File (max 10MB)</label>
              <label style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",border:"2px dashed var(--border2)",borderRadius:10,cursor:"pointer",background:"var(--bg4)"}}>
                <span style={{fontSize:24}}>📄</span>
                <div style={{flex:1}}>{pdfName?<span style={{color:"var(--accent)",fontSize:13}}>{pdfName}</span>:<span style={{color:"var(--text3)",fontSize:13}}>Click to select PDF...</span>}</div>
                <input type="file" accept=".pdf" style={{display:"none"}} onChange={handlePdfChange} />
              </label>
            </div>
          ) : (
            /* ── Google Drive Panel ── */
            <div style={{marginBottom:12}}>
              <label className="lbl">Google Drive Link</label>
              <input className="inp" style={{marginBottom:8}} placeholder="Paste Google Drive folder or file link here..."
                value={form.driveLink||""} onChange={e=>setForm({...form,driveLink:e.target.value})} />
              <a href="https://drive.google.com" target="_blank" rel="noopener noreferrer"
                style={{display:"inline-flex",alignItems:"center",gap:8,padding:"9px 16px",background:"#1a73e8",color:"#fff",borderRadius:9,fontWeight:700,fontSize:13,textDecoration:"none",marginBottom:12,boxShadow:"0 2px 8px rgba(26,115,232,.35)",transition:"opacity .2s"}}
                onMouseEnter={e=>e.currentTarget.style.opacity=".85"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                <svg width="18" height="18" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>
                Open Google Drive
              </a>
              <div style={{background:"rgba(26,115,232,.07)",border:"1px solid rgba(26,115,232,.2)",borderRadius:10,padding:"12px 14px",fontSize:12,color:"var(--text2)",lineHeight:1.7}}>
                <div style={{fontWeight:800,fontSize:13,color:"#1a73e8",marginBottom:6}}>📋 How to add handouts from Google Drive</div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <div><b>📁 Add a whole folder:</b> Open the folder in Drive → right-click → <i>Share</i> → set to <i>"Anyone with the link"</i> → copy &amp; paste the link above.</div>
                  <div><b>📄 Add a single file:</b> Right-click the file in Drive → <i>Share</i> → <i>"Anyone with the link"</i> → copy &amp; paste the link above.</div>
                  <div><b>🗂️ Add multiple files:</b> Select files in Drive holding <b>Ctrl/⌘</b> → right-click → <i>Share</i> → or move them into one folder first and share that folder.</div>
                  <div style={{marginTop:4,color:"var(--text3)"}}>💡 <i>Tip: Create one Drive folder per course — paste that folder link so students always see your latest files automatically.</i></div>
                </div>
              </div>
            </div>
          )}
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-accent" onClick={save}>📤 Publish & Notify Students</button>
            <button className="btn" onClick={()=>{setShowAdd(false);setForm({title:"",note:"",classId:drillClass||"",course:drillCourse||"",lecturerName:"",uploadType:"text",driveLink:""});setPdfFile(null);setPdfName("");}}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Search results override ── */}
      {filter&&searchFiltered!==null&&(
        <div>
          <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>🔍 {searchFiltered.length} result{searchFiltered.length!==1?"s":""} for "{filter}"</div>
          {searchFiltered.length===0 ? (
            <div style={{textAlign:"center",padding:32,color:"var(--text3)"}}>No handouts match your search.</div>
          ) : (
            <div className="grid2">
              {searchFiltered.map(h=>{
                const c=classes.find(x=>x.id===h.classId);
                return (
                  <div key={h.id} className="card" style={{cursor:"pointer"}} onClick={()=>setViewItem(h)}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        <span className="tag tag-accent">{c?.label||"?"}</span>
                        {h.course&&<span className="tag" style={{borderColor:"var(--accent2)",color:"var(--accent2)"}}>{h.course}</span>}
                        {h.pdfName&&<span className="tag" style={{borderColor:"var(--danger)",color:"var(--danger)"}}>📄 PDF</span>}
                      </div>
                      {isLecturer&&<button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();del(h.id);}}>✕</button>}
                    </div>
                    <div style={{fontWeight:800,fontSize:14,marginBottom:3}}>{h.title}</div>
                    <div style={{fontSize:11,color:"var(--purple)",marginBottom:4}}>👨🏫 {h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown"}</div>
                    <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{h.date}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Folder drill-down (only shown when not searching) ── */}
      {!filter&&(
        <>
          <Breadcrumb />

          {/* Level 0: All classes */}
          {!drillClass&&(
            <>
            {isLecturer&&(
              <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
                <span style={{fontSize:12,color:"var(--text3)"}}>Click a class folder to browse courses</span>
              </div>
            )}
            {classes.length===0 ? (
              <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:14}}>
                <div style={{fontSize:52,marginBottom:12}}>📁</div>
                <div style={{fontWeight:700}}>No classes available</div>
              </div>
            ) : (
              <div className="grid2">
                {classes.map(c=>{
                  const cnt = handouts.filter(h=>h.classId===c.id).length;
                  const allCourses = getCoursesForClass(c.id);
                  return (
                    <FolderCard key={c.id} icon="📁" label={c.label} sublabel={`${c.desc} • ${allCourses.length} course${allCourses.length!==1?"s":""}`}
                      count={cnt} countLabel={`handout${cnt!==1?"s":""}`} color={c.color||"var(--accent)"}
                      onClick={()=>{setDrillClass(c.id);setDrillCourse(null);setDrillLecturer(null);}} />
                  );
                })}
              </div>
            )}
            </>
          )}

          {/* Level 1: Courses inside a class */}
          {drillClass&&!drillCourse&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{fontWeight:800,fontSize:15,color:"var(--accent)"}}>
                  📁 {selCls?.label} — Courses
                </div>
                {isLecturer&&(
                  <button className="btn btn-sm btn-accent" onClick={()=>{setNewCourseName("");setShowCourseModal(true);}}>
                    + New Course Folder
                  </button>
                )}
              </div>
              {coursesInClass.length===0 ? (
                <div style={{textAlign:"center",padding:40,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:12}}>
                  <div style={{fontSize:40,marginBottom:8}}>📂</div>
                  <div>No course folders yet for this class</div>
                  {isLecturer&&<div style={{fontSize:12,marginTop:6}}>Click "+ New Course Folder" to create one</div>}
                </div>
              ) : (
                <div className="grid2">
                  {coursesInClass.map(course=>{
                    const cnt = classHandouts.filter(h=>h.course===course).length;
                    const lecCount = getLecturersForCourse(drillClass, course).length;
                    return (
                      <div key={course} style={{position:"relative"}}>
                        <FolderCard icon="📂" label={course}
                          sublabel={`${lecCount} lecturer${lecCount!==1?"s":""}`}
                          count={cnt} countLabel={`file${cnt!==1?"s":""}`} color="var(--accent2)"
                          onClick={()=>{setDrillCourse(course);setDrillLecturer(null);}} />
                        {isLecturer&&(
                          <button
                            onClick={e=>{e.stopPropagation();setRenameCourseTarget(course);setRenameCourseVal(course);}}
                            title="Rename course folder"
                            style={{position:"absolute",top:10,right:10,background:"rgba(0,119,182,.12)",border:"1px solid rgba(0,119,182,.25)",
                              borderRadius:7,padding:"3px 8px",fontSize:11,cursor:"pointer",color:"var(--accent)",fontWeight:700,zIndex:2}}>
                            ✏️ Rename
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Level 2: Lecturers inside a course */}
          {drillClass&&drillCourse&&!drillLecturer&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{fontWeight:800,fontSize:15,color:"var(--accent2)"}}>
                  📂 {drillCourse} — Lecturers
                </div>
                {isLecturer&&(
                  <button className="btn btn-sm btn-accent" onClick={()=>{setNewLecturerName("");setShowLecturerModal(true);}}>
                    + New Lecturer Folder
                  </button>
                )}
              </div>
              {lecturersInCourse.length===0 ? (
                <div style={{textAlign:"center",padding:40,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:12}}>
                  <div style={{fontSize:40,marginBottom:8}}>👨🏫</div>
                  <div>No lecturer folders yet</div>
                  {isLecturer&&<div style={{fontSize:12,marginTop:6}}>Click "+ New Lecturer Folder" to create one</div>}
                </div>
              ) : (
                <div className="grid2">
                  {lecturersInCourse.map(lec=>{
                    const cnt = courseHandouts.filter(h=>(h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown")===lec).length;
                    return (
                      <FolderCard key={lec} icon="👨🏫" label={lec}
                        sublabel="Lecturer"
                        count={cnt} countLabel={`file${cnt!==1?"s":""}`} color="var(--purple)"
                        onClick={()=>setDrillLecturer(lec)} />
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Level 3: Handouts inside a lecturer folder */}
          {drillClass&&drillCourse&&drillLecturer&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{fontWeight:800,fontSize:15,color:"var(--purple)"}}>
                  👨🏫 {drillLecturer} — {drillCourse}
                </div>
                {isLecturer&&(
                  <button className="btn btn-sm btn-accent" onClick={()=>{
                    setForm({title:"",note:"",classId:drillClass,course:drillCourse,lecturerName:drillLecturer,uploadType:"text"});
                    setShowAdd(p=>!p);
                  }}>
                    {showAdd?"✕ Cancel":"+ Upload Handout"}
                  </button>
                )}
              </div>
              {lecturerHandouts.length===0 ? (
                <div style={{textAlign:"center",padding:40,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:12}}>
                  <div style={{fontSize:40,marginBottom:8}}>📄</div>
                  <div>No handouts in this folder yet</div>
                </div>
              ) : (
                <div className="grid2">
                  {lecturerHandouts.map(h=>(
                    <div key={h.id} className="card" style={{cursor:"pointer"}} onClick={()=>setViewItem(h)}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                          {h.pdfName&&<span className="tag" style={{borderColor:"var(--danger)",color:"var(--danger)",background:"rgba(248,113,113,.08)"}}>📄 PDF</span>}
                          <span className="tag" style={{borderColor:"var(--accent2)",color:"var(--accent2)"}}>📂 {h.course}</span>
                        </div>
                        {isLecturer&&<button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();del(h.id);}}>✕</button>}
                      </div>
                      <div style={{fontWeight:800,fontSize:14,marginBottom:6}}>{h.title}</div>
                      {h.pdfName ? (
                        <div style={{fontSize:12,color:"var(--text3)",display:"flex",alignItems:"center",gap:6}}>📎 {h.pdfName}</div>
                      ) : (
                        <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{h.note||"No content"}</div>
                      )}
                      <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginTop:8,display:"flex",justifyContent:"space-between"}}>
                        <span>{h.date}</span>
                        <span>by {h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── View handout modal ── */}
      {viewItem&&(
        <HandoutViewModal item={viewItem} onClose={()=>setViewItem(null)} />
      )}
      {/* ── Create Course Folder Modal ── */}
      {showCourseModal&&(
        <div className="modal-overlay" onClick={()=>setShowCourseModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">📂 Create Course Folder</div>
              <button className="modal-close" onClick={()=>setShowCourseModal(false)}>✕</button>
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>
              Creating a course folder inside <b>{selCls?.label}</b>
            </div>
            <label className="lbl">Course Name *</label>
            <input className="inp" placeholder="e.g. Anatomy & Physiology" value={newCourseName}
              onChange={e=>setNewCourseName(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&createCourseFolder()}
              list="existing-courses-list" />
            <datalist id="existing-courses-list">
              {(selCls?.courses||[]).map(c=><option key={c} value={c}/>)}
            </datalist>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Or pick a course from this class:</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {(selCls?.courses||[]).map(c=>(
                  <span key={c} onClick={()=>setNewCourseName(c)}
                    style={{fontSize:11,padding:"3px 10px",borderRadius:7,border:"1px solid var(--border2)",cursor:"pointer",
                      background:newCourseName===c?"rgba(0,119,182,.15)":"transparent",
                      color:newCourseName===c?"var(--accent)":"var(--text3)"}}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={createCourseFolder}>📂 Create Folder</button>
              <button className="btn" onClick={()=>setShowCourseModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Lecturer Folder Modal ── */}
      {showLecturerModal&&(
        <div className="modal-overlay" onClick={()=>setShowLecturerModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">👨🏫 Create Lecturer Folder</div>
              <button className="modal-close" onClick={()=>setShowLecturerModal(false)}>✕</button>
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>
              Creating a lecturer folder inside <b>{drillCourse}</b> ({selCls?.label})
            </div>
            <label className="lbl">Lecturer Name *</label>
            <input className="inp" placeholder="e.g. Dr. Adeyemi" value={newLecturerName}
              onChange={e=>setNewLecturerName(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&createLecturerFolder()}
              list="existing-lecturers-list" />
            <datalist id="existing-lecturers-list">
              {lecturers.map(l=><option key={l.username} value={l.username.split("@")[0]}/>)}
            </datalist>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Or pick a registered lecturer:</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {lecturers.map(l=>{
                  const name=l.username.split("@")[0];
                  return (
                    <span key={l.username} onClick={()=>setNewLecturerName(name)}
                      style={{fontSize:11,padding:"3px 10px",borderRadius:7,border:"1px solid var(--border2)",cursor:"pointer",
                        background:newLecturerName===name?"rgba(124,58,237,.15)":"transparent",
                        color:newLecturerName===name?"var(--purple)":"var(--text3)"}}>
                      👨🏫 {name}
                    </span>
                  );
                })}
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-purple" style={{flex:1}} onClick={createLecturerFolder}>👨🏫 Create Folder</button>
              <button className="btn" onClick={()=>setShowLecturerModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* ── Rename Course Folder Modal ── */}
      {renameCourseTarget&&(
        <div className="modal-overlay" onClick={()=>setRenameCourseTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">✏️ Rename Course Folder</div>
              <button className="modal-close" onClick={()=>setRenameCourseTarget(null)}>✕</button>
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:14}}>
              Renaming <b style={{color:"var(--accent2)"}}>📂 {renameCourseTarget}</b> inside <b>{selCls?.label}</b>.
              All handouts in this folder will be updated automatically.
            </div>
            <label className="lbl">New Course Name *</label>
            <input className="inp" placeholder="e.g. Advanced Pharmacology"
              value={renameCourseVal}
              onChange={e=>setRenameCourseVal(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&renameCourseFolder()}
              autoFocus />
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={renameCourseFolder}>✏️ Rename</button>
              <button className="btn" onClick={()=>setRenameCourseTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// STUDENT PROFILE
// ═══════════════════════════════════════════════════════════════════════

export function StudyGroups({ currentUser, toast }) {
  const [classes]   = useSharedData("nv-classes", DEFAULT_CLASSES);
  const allUsers    = ls("nv-users", []);
  const me          = allUsers.find(u => u.username === currentUser);
  const myClassId   = me?.class || "";
  const myClass     = classes.find(c => c.id === myClassId);

  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!myClassId) return;
    const unsub = sgSubscribeGroups(myClassId, setGroups);
    return () => unsub();
  }, [myClassId]);

  useEffect(() => {
    if (!activeGroup) return;
    const unsub = sgSubscribe(activeGroup.id, setMsgs);
    return () => unsub();
  }, [activeGroup?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [msgs]);

  const createGroup = async () => {
    if (!newName.trim()) return toast("Group name required","error");
    const id = "sg_" + Date.now();
    const group = { id, name:newName.trim(), desc:newDesc.trim(), classId:myClassId, createdBy:currentUser, createdAt:Date.now(), members:[currentUser], lastAt:Date.now(), lastMsg:"Group created" };
    const ok = await sgCreateGroup(group);
    if (ok) { toast("Group created ✅","success"); setNewName(""); setNewDesc(""); setShowCreate(false); }
    else toast("Failed to create group","error");
  };

  const send = async () => {
    if (!text.trim() || !activeGroup || sending) return;
    setSending(true);
    await sgSend(activeGroup.id, currentUser, text.trim());
    setText(""); setSending(false);
  };

  const displayName = (email) => { const u = allUsers.find(x=>x.username===email); return u?.displayName||email.split("@")[0]; };
  const avatarChar  = (email) => (displayName(email)[0]||"?").toUpperCase();

  if (activeGroup) return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100dvh - 120px)",maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:"1px solid var(--border)",marginBottom:12}}>
        <button onClick={()=>setActiveGroup(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"var(--text3)"}}>←</button>
        <div style={{width:40,height:40,borderRadius:50,background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>👥</div>
        <div style={{flex:1}}><div style={{fontWeight:800,fontSize:16}}>{activeGroup.name}</div><div style={{fontSize:11,color:"var(--text3)"}}>{activeGroup.desc||myClass?.label||"Study group"}</div></div>
        <GroupVideoCallBtn roomId={activeGroup.id} label={activeGroup.name} currentUser={currentUser} />
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 4px",display:"flex",flexDirection:"column",gap:8}}>
        {msgs.map(m => {
          const mine = m.from === currentUser;
          return (
            <div key={m.id} style={{display:"flex",alignItems:"flex-end",gap:8,flexDirection:mine?"row-reverse":"row"}}>
              {!mine && <div style={{width:28,height:28,borderRadius:"50%",background:"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#fff",flexShrink:0}}>{avatarChar(m.from)}</div>}
              <div>
                {!mine && <div style={{fontSize:10,color:"var(--text3)",marginBottom:3,marginLeft:2}}>{displayName(m.from)}</div>}
                <div className={`sg-bubble ${mine?"mine":"theirs"}`}>{m.text}</div>
                <div style={{fontSize:10,color:"var(--text3)",marginTop:3,textAlign:mine?"right":"left"}}>{new Date(m.sentAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
              </div>
            </div>
          );
        })}
        {msgs.length === 0 && <div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>No messages yet. Say hello! 👋</div>}
        <div ref={bottomRef} />
      </div>
      <div style={{display:"flex",gap:8,paddingTop:12,borderTop:"1px solid var(--border)"}}>
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
          placeholder="Type a message…" style={{flex:1,padding:"10px 14px",borderRadius:22,border:"1.5px solid var(--border)",background:"var(--bg4)",color:"var(--text)",fontSize:14,outline:"none"}} />
        <button onClick={send} disabled={sending||!text.trim()} style={{padding:"10px 20px",borderRadius:22,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700,opacity:sending?0.6:1}}>Send</button>
      </div>
    </div>
  );

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div><div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22}}>👥 Study Groups</div>
          <div style={{color:"var(--text3)",fontSize:13}}>{myClass?.label||"Your class"} • Group chats</div></div>
        <button onClick={()=>setShowCreate(true)} style={{padding:"9px 18px",borderRadius:10,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700,fontSize:13}}>+ New Group</button>
      </div>
      {showCreate && (
        <div style={{background:"var(--card)",border:"1.5px solid var(--accent)",borderRadius:14,padding:20,marginBottom:20}}>
          <div style={{fontWeight:800,marginBottom:12}}>Create Study Group</div>
          <label className="lbl">Group Name</label>
          <input className="inp" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Pharmacology Study Crew" />
          <label className="lbl">Description (optional)</label>
          <input className="inp" value={newDesc} onChange={e=>setNewDesc(e.target.value)} placeholder="What will you study?" />
          <div style={{display:"flex",gap:8}}>
            <button onClick={createGroup} style={{flex:1,padding:"10px",borderRadius:10,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>Create</button>
            <button onClick={()=>setShowCreate(false)} style={{padding:"10px 18px",borderRadius:10,background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border)",cursor:"pointer",fontWeight:700}}>Cancel</button>
          </div>
        </div>
      )}
      {!myClassId && <div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>You need to be assigned to a class to join study groups. Contact your admin.</div>}
      {groups.length === 0 && myClassId && <div style={{textAlign:"center",padding:60,color:"var(--text3)"}}><div style={{fontSize:48,marginBottom:12}}>👥</div><div style={{fontWeight:700,fontSize:16}}>No study groups yet</div><div style={{fontSize:13,marginTop:4}}>Create the first group for your class!</div></div>}
      {groups.map(g => (
        <div key={g.id} className="sg-room" onClick={()=>setActiveGroup(g)}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:44,height:44,borderRadius:12,background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>👥</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:800,fontSize:15}}>{g.name}</div>
              <div style={{fontSize:12,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.lastMsg||g.desc||"No messages yet"}</div>
            </div>
            <div style={{fontSize:11,color:"var(--text3)",flexShrink:0,textAlign:"right"}}>
              {g.lastAt ? new Date(g.lastAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// TIMETABLE
// ════════════════════════════════════════════════════════════════════

export function Timetable({ currentUser, toast, isLecturer }) {
  const [classes]  = useSharedData("nv-classes", DEFAULT_CLASSES);
  const allUsers   = ls("nv-users", []);
  const me         = allUsers.find(u => u.username === currentUser);
  const myClassId  = me?.class || (isLecturer ? (classes[0]?.id||"") : "");
  const [selClass, setSelClass] = useState(myClassId || (classes[0]?.id||""));
  const [slots, setSlots]   = useState([]);
  const [editing, setEditing] = useState(null); // {day, hour}
  const [form, setForm]     = useState({subject:"",lecturer:"",room:""});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selClass) return;
    setLoading(true);
    ttLoad(selClass).then(s => { setSlots(s||[]); setLoading(false); });
  }, [selClass]);

  const slotAt = (day, hour) => slots.find(s => s.day===day && s.hour===hour);

  const saveSlot = async () => {
    if (!form.subject.trim()) return toast("Subject required","error");
    setSaving(true);
    const updated = slots.filter(s=>!(s.day===editing.day&&s.hour===editing.hour));
    if (form.subject.trim()) updated.push({day:editing.day,hour:editing.hour,...form});
    const ok = await ttSave(selClass, updated);
    if (ok) { setSlots(updated); toast("Timetable saved ✅","success"); }
    else toast("Save failed","error");
    setEditing(null); setForm({subject:"",lecturer:"",room:""}); setSaving(false);
  };

  const deleteSlot = async (day, hour) => {
    const updated = slots.filter(s=>!(s.day===day&&s.hour===hour));
    await ttSave(selClass, updated);
    setSlots(updated);
  };

  const today = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date().getDay()];

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div><div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22}}>📅 Timetable</div>
          <div style={{color:"var(--text3)",fontSize:13}}>Class schedule at a glance</div></div>
        {isLecturer && <select className="inp" style={{marginBottom:0,width:"auto",minWidth:180}} value={selClass} onChange={e=>setSelClass(e.target.value)}>
          {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
        </select>}
      </div>

      {editing && (
        <div style={{position:"fixed",inset:0,zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)",backdropFilter:"blur(4px)"}}>
          <div style={{background:"var(--card)",borderRadius:18,padding:28,width:"90vw",maxWidth:400,border:"1.5px solid var(--border)"}}>
            <div style={{fontWeight:800,fontSize:16,marginBottom:16}}>📅 {editing.day} • {editing.hour}</div>
            <label className="lbl">Subject</label>
            <input className="inp" value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})} placeholder="e.g. Pharmacology" />
            <label className="lbl">Lecturer</label>
            <input className="inp" value={form.lecturer} onChange={e=>setForm({...form,lecturer:e.target.value})} placeholder="e.g. Dr. Adeleke" />
            <label className="lbl">Room / Venue</label>
            <input className="inp" value={form.room} onChange={e=>setForm({...form,room:e.target.value})} placeholder="e.g. Hall A" />
            <div style={{display:"flex",gap:8,marginTop:4}}>
              <button onClick={saveSlot} disabled={saving} style={{flex:1,padding:10,borderRadius:10,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>{saving?"Saving…":"Save"}</button>
              <button onClick={()=>setEditing(null)} style={{padding:"10px 16px",borderRadius:10,background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border)",cursor:"pointer",fontWeight:700}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading ? <div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>Loading timetable…</div> : (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:4}}>
            <thead>
              <tr>
                <th style={{width:56,padding:6,fontSize:11,color:"var(--text3)"}}>Time</th>
                {DAYS.map(d=><th key={d} className="tt-day-hdr" style={{color:d===today?"var(--accent)":"var(--text3)",background:d===today?"rgba(0,119,182,.07)":"transparent",borderRadius:8}}>{d}{d===today?" 📌":""}</th>)}
              </tr>
            </thead>
            <tbody>
              {HOURS.map(hour=>(
                <tr key={hour}>
                  <td style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",padding:"4px 4px",textAlign:"right",whiteSpace:"nowrap"}}>{hour}</td>
                  {DAYS.map(day=>{
                    const slot = slotAt(day,hour);
                    return (
                      <td key={day} style={{padding:3}}>
                        {slot ? (
                          <div className="tt-cell has-class" onClick={()=>{if(isLecturer){setEditing({day,hour});setForm({subject:slot.subject,lecturer:slot.lecturer||"",room:slot.room||""});}}}>
                            <div style={{fontWeight:700,fontSize:11,color:"var(--accent)",marginBottom:2}}>{slot.subject}</div>
                            {slot.lecturer&&<div style={{fontSize:10,color:"var(--text3)"}}>{slot.lecturer}</div>}
                            {slot.room&&<div style={{fontSize:10,color:"var(--text3)"}}>{slot.room}</div>}
                            {isLecturer&&<div onClick={e=>{e.stopPropagation();deleteSlot(day,hour);}} style={{fontSize:10,color:"var(--danger)",cursor:"pointer",marginTop:3}}>✕ remove</div>}
                          </div>
                        ) : (
                          <div className="tt-cell" onClick={()=>{if(isLecturer){setEditing({day,hour});setForm({subject:"",lecturer:"",room:""});}}} style={{opacity:isLecturer?.5:0.2,cursor:isLecturer?"pointer":"default"}}>
                            {isLecturer && <div style={{fontSize:16,textAlign:"center",color:"var(--text3)"}}>+</div>}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{marginTop:16,fontSize:12,color:"var(--text3)",textAlign:"center"}}>{isLecturer?"Click any cell to add or edit a class":"Read-only view — lecturers manage the schedule"}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ASSIGNMENTS
// ════════════════════════════════════════════════════════════════════

export function Assignments({ currentUser, toast, isLecturer }) {
  const [classes]  = useSharedData("nv-classes", DEFAULT_CLASSES);
  const allUsers   = ls("nv-users", []);
  const me         = allUsers.find(u => u.username === currentUser);
  const myClassId  = me?.class || "";
  const [selClass, setSelClass] = useState(myClassId || classes[0]?.id || "");
  const [assignments, setAssignments] = useState([]);
  const [selAsgn, setSelAsgn] = useState(null); // for lecturer grading view
  const [submissions, setSubmissions] = useState([]);
  const [mySubmission, setMySubmission] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({title:"",desc:"",dueAt:"",maxScore:100});
  const [uploading, setUploading] = useState(false);
  const [gradingId, setGradingId] = useState(null);
  const [gradeForm, setGradeForm] = useState({grade:"",feedback:""});

  useEffect(() => {
    if (!selClass) return;
    const unsub = asgSubscribe(selClass, setAssignments);
    return () => unsub();
  }, [selClass]);

  useEffect(() => {
    if (!selAsgn) return;
    if (isLecturer) asgLoadSubmissions(selAsgn.id).then(setSubmissions);
    else asgLoadMySubmission(selAsgn.id, currentUser).then(setMySubmission);
  }, [selAsgn?.id, isLecturer]);

  const createAsgn = async () => {
    if (!form.title.trim()) return toast("Title required","error");
    if (!form.dueAt) return toast("Due date required","error");
    const id = "asgn_" + Date.now();
    const asgn = { id, classId:selClass, title:form.title.trim(), desc:form.desc.trim(), dueAt:new Date(form.dueAt).getTime(), maxScore:+form.maxScore||100, createdBy:currentUser, createdAt:Date.now() };
    const ok = await asgSave(asgn);
    if (ok) { toast("Assignment posted ✅","success"); setShowForm(false); setForm({title:"",desc:"",dueAt:"",maxScore:100}); }
    else toast("Failed to post","error");
  };

  const submitWork = async (asgn) => {
    const input = document.createElement("input"); input.type="file"; input.accept=".pdf,.doc,.docx,.png,.jpg,.txt";
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 2*1024*1024) return toast("File too large — max 2MB","error");
      setUploading(true);
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const ok = await asgSubmit(asgn.id, currentUser, ev.target.result, file.name);
        if (ok) { toast("Submitted ✅","success"); asgLoadMySubmission(asgn.id, currentUser).then(setMySubmission); }
        else toast("Submit failed","error");
        setUploading(false);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const saveGrade = async () => {
    if (!gradeForm.grade) return toast("Enter a grade","error");
    const ok = await asgGrade(selAsgn.id, gradingId, +gradeForm.grade, gradeForm.feedback);
    if (ok) { toast("Graded ✅","success"); asgLoadSubmissions(selAsgn.id).then(setSubmissions); setGradingId(null); }
  };

  const statusColor = (asgn) => {
    const now = Date.now();
    if (now > asgn.dueAt) return { bg:"rgba(239,68,68,.1)", color:"var(--danger)", label:"Overdue" };
    if (asgn.dueAt - now < 86400000) return { bg:"rgba(251,146,60,.1)", color:"var(--warn)", label:"Due soon" };
    return { bg:"rgba(34,197,94,.1)", color:"var(--success)", label:"Open" };
  };

  if (selAsgn) {
    const st = statusColor(selAsgn);
    return (
      <div style={{maxWidth:700,margin:"0 auto"}}>
        <button onClick={()=>{setSelAsgn(null);setSubmissions([]);setMySubmission(null);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"var(--text3)",marginBottom:16,display:"flex",alignItems:"center",gap:4}}>← Back</button>
        <div className="asgn-card">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div style={{fontWeight:800,fontSize:18}}>{selAsgn.title}</div>
            <span className="asgn-status" style={{background:st.bg,color:st.color}}>{st.label}</span>
          </div>
          <div style={{color:"var(--text2)",fontSize:13,marginBottom:12,lineHeight:1.6}}>{selAsgn.desc}</div>
          <div style={{fontSize:12,color:"var(--text3)"}}>📅 Due: <b>{new Date(selAsgn.dueAt).toLocaleString()}</b> • Max score: <b>{selAsgn.maxScore}</b></div>
        </div>

        {isLecturer ? (
          <div>
            <div style={{fontWeight:800,marginBottom:12}}>Submissions ({submissions.length})</div>
            {submissions.length===0 && <div style={{textAlign:"center",padding:30,color:"var(--text3)"}}>No submissions yet</div>}
            {submissions.map(sub => (
              <div key={sub.student} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontWeight:700}}>{allUsers.find(u=>u.username===sub.student)?.displayName||sub.student.split("@")[0]}</div>
                  <div style={{fontSize:11,color:"var(--text3)"}}>{new Date(sub.submittedAt).toLocaleString()}</div>
                </div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>📎 {sub.fileName}</div>
                {sub.fileData && <a href={sub.fileData} download={sub.fileName} style={{fontSize:12,color:"var(--accent)",textDecoration:"none",display:"inline-block",marginBottom:8}}>⬇ Download</a>}
                {sub.grade!=null ? (
                  <div style={{background:"rgba(34,197,94,.1)",borderRadius:8,padding:"8px 12px",fontSize:13}}>
                    ✅ Graded: <b>{sub.grade}/{selAsgn.maxScore}</b>{sub.feedback&&<span> • {sub.feedback}</span>}
                  </div>
                ) : gradingId===sub.student ? (
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                    <input type="number" className="inp" style={{width:80,marginBottom:0}} placeholder="Score" value={gradeForm.grade} onChange={e=>setGradeForm({...gradeForm,grade:e.target.value})} />
                    <input className="inp" style={{flex:1,marginBottom:0,minWidth:120}} placeholder="Feedback (optional)" value={gradeForm.feedback} onChange={e=>setGradeForm({...gradeForm,feedback:e.target.value})} />
                    <button onClick={saveGrade} style={{padding:"9px 16px",borderRadius:9,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>Save</button>
                    <button onClick={()=>setGradingId(null)} style={{padding:"9px 14px",borderRadius:9,background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border)",cursor:"pointer"}}>✕</button>
                  </div>
                ) : (
                  <button onClick={()=>{setGradingId(sub.student);setGradeForm({grade:"",feedback:""});}} style={{padding:"7px 14px",borderRadius:9,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700,fontSize:12}}>Grade</button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div>
            {mySubmission ? (
              <div style={{background:"rgba(34,197,94,.08)",border:"1.5px solid var(--success)",borderRadius:14,padding:20,textAlign:"center"}}>
                <div style={{fontSize:32,marginBottom:8}}>✅</div>
                <div style={{fontWeight:800,fontSize:16,marginBottom:4}}>Submitted!</div>
                <div style={{fontSize:13,color:"var(--text3)",marginBottom:8}}>📎 {mySubmission.fileName}</div>
                {mySubmission.grade!=null && <div style={{background:"rgba(0,119,182,.1)",borderRadius:10,padding:"10px 16px",fontSize:14,fontWeight:700}}>
                  Score: {mySubmission.grade}/{selAsgn.maxScore} {mySubmission.feedback&&`• ${mySubmission.feedback}`}
                </div>}
                {mySubmission.grade==null && <div style={{fontSize:12,color:"var(--text3)"}}>Waiting for lecturer to grade…</div>}
              </div>
            ) : (
              <div style={{textAlign:"center",padding:30}}>
                <div style={{fontSize:40,marginBottom:12}}>📤</div>
                <div style={{fontWeight:700,marginBottom:8}}>Upload your work</div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>PDF, Word, image or text file • Max 2MB</div>
                <button onClick={()=>submitWork(selAsgn)} disabled={uploading} style={{padding:"12px 28px",borderRadius:12,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>{uploading?"Uploading…":"Choose File & Submit"}</button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div><div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22}}>📝 Assignments</div>
          <div style={{color:"var(--text3)",fontSize:13}}>Submit work and get grades</div></div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {isLecturer && <select className="inp" style={{marginBottom:0,width:"auto",minWidth:160}} value={selClass} onChange={e=>setSelClass(e.target.value)}>
            {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select>}
          {isLecturer && <button onClick={()=>setShowForm(true)} style={{padding:"9px 18px",borderRadius:10,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700,fontSize:13,whiteSpace:"nowrap"}}>+ Post Assignment</button>}
        </div>
      </div>

      {showForm && (
        <div style={{background:"var(--card)",border:"1.5px solid var(--accent)",borderRadius:14,padding:20,marginBottom:20}}>
          <div style={{fontWeight:800,marginBottom:12}}>New Assignment</div>
          <label className="lbl">Title</label>
          <input className="inp" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Pharmacology Case Study" />
          <label className="lbl">Description / Instructions</label>
          <textarea className="inp" rows={3} value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})} placeholder="Describe what students need to do…" style={{resize:"vertical"}} />
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><label className="lbl">Due Date & Time</label><input className="inp" type="datetime-local" value={form.dueAt} onChange={e=>setForm({...form,dueAt:e.target.value})} /></div>
            <div><label className="lbl">Max Score</label><input className="inp" type="number" value={form.maxScore} onChange={e=>setForm({...form,maxScore:e.target.value})} /></div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={createAsgn} style={{flex:1,padding:10,borderRadius:10,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>Post</button>
            <button onClick={()=>setShowForm(false)} style={{padding:"10px 18px",borderRadius:10,background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border)",cursor:"pointer",fontWeight:700}}>Cancel</button>
          </div>
        </div>
      )}

      {assignments.length===0 && <div style={{textAlign:"center",padding:60,color:"var(--text3)"}}><div style={{fontSize:48,marginBottom:12}}>📝</div><div style={{fontWeight:700}}>No assignments yet</div><div style={{fontSize:13,marginTop:4}}>{isLecturer?"Post the first assignment above":"Check back later"}</div></div>}
      {assignments.map(a => {
        const st = statusColor(a);
        return (
          <div key={a.id} className="asgn-card" onClick={()=>setSelAsgn(a)} style={{cursor:"pointer"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{fontWeight:800,fontSize:15,flex:1,paddingRight:10}}>{a.title}</div>
              <span className="asgn-status" style={{background:st.bg,color:st.color,flexShrink:0}}>{st.label}</span>
            </div>
            {a.desc && <div style={{fontSize:12,color:"var(--text3)",marginTop:6,lineHeight:1.5}}>{a.desc.slice(0,120)}{a.desc.length>120?"…":""}</div>}
            <div style={{fontSize:11,color:"var(--text3)",marginTop:8}}>📅 Due: {new Date(a.dueAt).toLocaleString()} • Max: {a.maxScore} pts</div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ATTENDANCE
// ════════════════════════════════════════════════════════════════════

export function AttendanceView({ currentUser, toast, isLecturer }) {
  const [classes]  = useSharedData("nv-classes", DEFAULT_CLASSES);
  const allUsers   = ls("nv-users", []);
  const me         = allUsers.find(u => u.username === currentUser);
  const myClassId  = me?.class || "";
  const [selClass, setSelClass] = useState(myClassId || classes[0]?.id || "");
  const [selDate,  setSelDate]  = useState(new Date().toISOString().slice(0,10));
  const [records,  setRecords]  = useState({});
  const [saving, setSaving]     = useState(false);
  const [myHistory, setMyHistory] = useState({});

  const classStudents = allUsers.filter(u => u.class === selClass && u.role !== "admin" && u.role !== "lecturer");

  useEffect(() => {
    if (!selClass || !selDate) return;
    attLoad(selClass, selDate).then(setRecords);
  }, [selClass, selDate]);

  useEffect(() => {
    if (!myClassId || isLecturer) return;
    // Load last 30 days for student
    const dates = Array.from({length:30},(_,i) => {
      const d = new Date(); d.setDate(d.getDate()-i);
      return d.toISOString().slice(0,10);
    });
    attLoadRange(myClassId, dates).then(setMyHistory);
  }, [myClassId, isLecturer]);

  const mark = (student, status) => setRecords(r => ({...r, [_safeKey(student)]: status}));

  const saveAll = async () => {
    setSaving(true);
    const all = Object.entries(records);
    for (const [sk, status] of all) {
      const student = classStudents.find(u => _safeKey(u.username)===sk)?.username || sk;
      await attMark(selClass, selDate, student, status);
    }
    toast("Attendance saved ✅","success");
    setSaving(false);
  };

  const quickMarkAll = (status) => {
    const upd = {};
    classStudents.forEach(u => { upd[_safeKey(u.username)] = status; });
    setRecords(upd);
  };

  const pct = (days) => {
    let present=0,total=0;
    Object.values(days).forEach(d => {
      Object.values(d).forEach(s => { total++; if(s==="present") present++; });
    });
    return total===0 ? null : Math.round((present/total)*100);
  };

  if (!isLecturer) {
    const myDates = Object.keys(myHistory).sort().reverse().slice(0,30);
    const attended = myDates.filter(d => myHistory[d][_safeKey(currentUser)]==="present").length;
    const totalMarked = myDates.filter(d => myHistory[d][_safeKey(currentUser)]).length;
    const attPct = totalMarked ? Math.round((attended/totalMarked)*100) : null;
    return (
      <div style={{maxWidth:600,margin:"0 auto"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22,marginBottom:4}}>📋 My Attendance</div>
        <div style={{color:"var(--text3)",fontSize:13,marginBottom:20}}>Your attendance record for the last 30 days</div>
        {attPct!==null && (
          <div style={{background:"var(--card)",border:"1.5px solid var(--border)",borderRadius:16,padding:24,textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:52,fontWeight:800,color:attPct>=75?"var(--success)":attPct>=50?"var(--warn)":"var(--danger)"}}>{attPct}%</div>
            <div style={{fontSize:14,color:"var(--text2)",marginTop:4}}>Attendance Rate • {attended}/{totalMarked} classes</div>
            <div style={{marginTop:12,background:"var(--bg3)",borderRadius:10,height:8,overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:10,background:attPct>=75?"var(--success)":attPct>=50?"var(--warn)":"var(--danger)",width:`${attPct}%`,transition:"width .5s"}} />
            </div>
            {attPct<75&&<div style={{fontSize:12,color:"var(--warn)",marginTop:8}}>⚠️ Attendance below 75% — you may be at risk</div>}
          </div>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {myDates.map(date => {
            const status = myHistory[date][_safeKey(currentUser)];
            if (!status) return null;
            const color = status==="present"?"var(--success)":status==="absent"?"var(--danger)":"var(--warn)";
            const icon  = status==="present"?"✅":status==="absent"?"❌":"⚠️";
            return (
              <div key={date} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:13}}>{new Date(date+"T00:00:00").toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"})}</span>
                <span style={{fontSize:13,fontWeight:700,color}}>{icon} {status.charAt(0).toUpperCase()+status.slice(1)}</span>
              </div>
            );
          })}
          {myDates.length===0&&<div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>No attendance records yet</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div><div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22}}>📋 Attendance</div>
          <div style={{color:"var(--text3)",fontSize:13}}>Mark and track class attendance</div></div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <select className="inp" style={{marginBottom:0,width:"auto",minWidth:150}} value={selClass} onChange={e=>setSelClass(e.target.value)}>
            {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input type="date" className="inp" style={{marginBottom:0,width:"auto"}} value={selDate} onChange={e=>setSelDate(e.target.value)} />
        </div>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <button onClick={()=>quickMarkAll("present")} style={{padding:"7px 14px",borderRadius:8,background:"rgba(34,197,94,.15)",color:"var(--success)",border:"1px solid var(--success)",cursor:"pointer",fontWeight:700,fontSize:12}}>✅ All Present</button>
        <button onClick={()=>quickMarkAll("absent")} style={{padding:"7px 14px",borderRadius:8,background:"rgba(239,68,68,.1)",color:"var(--danger)",border:"1px solid var(--danger)",cursor:"pointer",fontWeight:700,fontSize:12}}>❌ All Absent</button>
        <button onClick={saveAll} disabled={saving} style={{padding:"7px 18px",borderRadius:8,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700,fontSize:12,marginLeft:"auto"}}>{saving?"Saving…":"💾 Save"}</button>
      </div>

      {classStudents.length===0 && <div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>No students in this class yet</div>}
      {classStudents.map(student => {
        const sk = _safeKey(student.username);
        const status = records[sk] || "";
        return (
          <div key={student.username} className="att-row">
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:"#fff",flexShrink:0}}>
                {(student.avatar||(student.displayName||student.username)[0]||"?").toUpperCase()}
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:14}}>{student.displayName||student.username.split("@")[0]}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>{student.username}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:6}}>
              {["present","absent","late"].map(s => (
                <button key={s} onClick={()=>mark(student.username,s)} style={{padding:"6px 12px",borderRadius:8,border:`1.5px solid ${status===s?(s==="present"?"var(--success)":s==="absent"?"var(--danger)":"var(--warn)"):"var(--border)"}`,background:status===s?(s==="present"?"rgba(34,197,94,.15)":s==="absent"?"rgba(239,68,68,.1)":"rgba(251,146,60,.1)"):"transparent",color:status===s?(s==="present"?"var(--success)":s==="absent"?"var(--danger)":"var(--warn)"):"var(--text3)",cursor:"pointer",fontWeight:700,fontSize:11,textTransform:"capitalize"}}>
                  {s==="present"?"✅":s==="absent"?"❌":"⚠️"} {s}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// LEADERBOARD + STREAKS
// ════════════════════════════════════════════════════════════════════
