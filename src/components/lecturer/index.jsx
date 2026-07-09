import { useState, useEffect, useRef } from "react";
import { DEFAULT_CLASSES } from "../../data/defaults";
import { _db, _mkSub, _safeKey, asgGrade, asgLoadSubmissions, cbtViolationsGet, cbtViolationsSave, dmSubscribeInbox, saveShared, subscribeUserNotifications, useSharedData } from "../../services/backend";
import { ls } from "../../utils/storage";
import { Assignments, AttendanceView, Handouts, StudyGroups, Timetable } from "../../components/academics";
import { AdminEssayExams } from "../../components/admin";
import { Toasts } from "../../components/common";
import { CbtExamManager } from "../../components/exams";
import { Messages, Notifications } from "../../components/messaging";
import { ResearchClub } from "../../components/research";
import { Dashboard, StudentProfile } from "../../components/student";
import { IncomingCallBanner } from "../../components/video-call";

export function LecturerPanel({ currentUser, toast, onSignOut, themeMode, setThemeMode, runSync, syncing, syncError }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const allUsers  = ls("nv-users", []);
  const me        = allUsers.find(u => u.username === currentUser) || {};
  const [classes] = useSharedData("nv-classes", DEFAULT_CLASSES);
  const [handouts]= useSharedData("nv-handouts", []);
  const [assignments, setAssignments] = useState([]);
  const [unreadNotifs, setUnreadNotifs] = useState(() => ls("nv-notifications",[]).filter(n=>!n.read).length);
  const [unreadDM, setUnreadDM] = useState(0);
  const [navHistory, setNavHistory] = useState([]);

  // Real-time notification badge for lecturer panel
  useEffect(() => {
    if (!currentUser) return;
    const unsub = subscribeUserNotifications(currentUser, (notifs) => {
      setUnreadNotifs(notifs.filter(n => !n.read).length);
    });
    return () => unsub();
  }, [currentUser]);

  // Load assignments for classes taught
  useEffect(() => {
    const unsub = _mkSub(db => db.collection("assignments").orderBy("dueAt","asc").onSnapshot(snap => setAssignments(snap.docs.map(d=>({id:d.id,...d.data()}))), () => {}));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const unsub = dmSubscribeInbox(currentUser, convs => {
      setUnreadDM(convs.filter(c=>c["unread_"+_safeKey(currentUser)]).length);
    });
    return () => unsub();
  }, [currentUser]);

  const navigate = (tab) => {
    setNavHistory(h => [...h, activeTab]);
    setActiveTab(tab);
    setSidebarOpen(false);
    window.history.pushState({ nvApp: true }, "");
  };
  const _exitRef = React.useRef(false);
  const goBack = () => {
    if (navHistory.length > 0) {
      setActiveTab(navHistory[navHistory.length-1]);
      setNavHistory(h => h.slice(0,-1));
      return;
    }
    // Already on home — double-press to exit
    if (_exitRef.current) { window.history.go(-999); return; }
    _exitRef.current = true;
    toast("Press back again to exit", "info");
    setTimeout(() => { _exitRef.current = false; }, 2000);
  };
  // Phone/browser back button — intercept popstate and mirror goBack
  useEffect(() => {
    window.history.replaceState({ nvApp: true }, "");
    const onPopState = () => {
      window.history.pushState({ nvApp: true }, "");
      goBack();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navHistory]);

  // My handouts (uploaded under my name)
  const myHandouts = handouts.filter(h =>
    h.lecturerName === (me.displayName || currentUser.split("@")[0]) ||
    h.uploadedBy === currentUser
  );

  // My assignments
  const myAssignments = assignments.filter(a => a.createdBy === currentUser);

  // Classes I can teach (all classes for now — admin assigns)
  const myClasses = classes;

  const name = me.displayName || currentUser.split("@")[0];
  const avatarChar = (me.avatar || name[0] || "?").toUpperCase();

  // Local state for PIN/offline (mirrored inside this panel)
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [pinLocked, setPinLocked] = useState(false);
  const [bypassPin, setBypassPin] = useState(false);
  useEffect(() => {
    const go  = () => setIsOffline(false);
    const off = () => setIsOffline(true);
    window.addEventListener("online",  go);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", go); window.removeEventListener("offline", off); };
  }, []);

  const NAV_SECTIONS = [
    {
      label: "Main",
      items: [
        { key:"dashboard",   icon:"⊞",  label:"Dashboard" },
        { key:"handouts",    icon:"📄",  label:"Upload Handouts" },
        { key:"assignments", icon:"📝",  label:"Assignments",  badge: myAssignments.filter(a=>Date.now()<a.dueAt).length || null },
        { key:"attendance",  icon:"📋",  label:"Attendance" },
        { key:"timetable",   icon:"📅",  label:"Timetable" },
        { key:"cbt",         icon:"🧪",  label:"CBT Exams" },
        { key:"essay",       icon:"✍️",  label:"Essay Exams" },
      ]
    },
    {
      label: "Communication",
      items: [
        { key:"messages",       icon:"💬", label:"Messages",      badge: unreadDM||null },
        { key:"research-club",  icon:"🔬", label:"Research Club" },
        { key:"study-groups",   icon:"👥", label:"Study Groups" },
        { key:"notifications",  icon:"🔔", label:"Notifications", badge: unreadNotifs||null },
        { key:"announcements",  icon:"📢", label:"Announcements" },
      ]
    },
    {
      label: "Students",
      items: [
        { key:"students",    icon:"🎓", label:"My Students" },
        { key:"grades",      icon:"📊", label:"Gradebook" },
        { key:"violations",  icon:"🚨", label:"Exam Violations" },
      ]
    },
    {
      label: "Account",
      items: [
        { key:"profile",     icon:"👤", label:"My Profile" },
      ]
    }
  ];

  const renderTab = () => {
    switch(activeTab) {
      case "dashboard":    return <LecturerDashboard currentUser={currentUser} toast={toast} me={me} myHandouts={myHandouts} myAssignments={myAssignments} myClasses={myClasses} onNavigate={navigate} />;
      case "handouts":     return <Handouts selectedClass={null} toast={toast} currentUser={currentUser} isLecturer={true} />;
      case "assignments":  return <Assignments currentUser={currentUser} toast={toast} isLecturer={true} />;
      case "attendance":   return <AttendanceView currentUser={currentUser} toast={toast} isLecturer={true} />;
      case "timetable":    return <Timetable currentUser={currentUser} toast={toast} isLecturer={true} />;
      case "cbt":          return <CbtExamManager toast={toast} currentUser={currentUser} />;
      case "essay":        return <AdminEssayExams toast={toast} />;
      case "messages":     return <Messages user={currentUser} toast={toast} onUnreadChange={setUnreadDM} />;
      case "research-club": return <ResearchClub currentUser={currentUser} toast={toast} isLecturer={true} isAdmin={false} />;
      case "study-groups": return <StudyGroups currentUser={currentUser} toast={toast} />;
      case "notifications":return <Notifications currentUser={currentUser} onRead={()=>setUnreadNotifs(0)} onNavigate={navigate} />;
      case "announcements":return <LecturerAnnouncements toast={toast} currentUser={currentUser} />;
      case "students":     return <LecturerStudents currentUser={currentUser} toast={toast} classes={myClasses} />;
      case "grades":       return <LecturerGradebook currentUser={currentUser} toast={toast} />;
      case "violations":   return <LecturerViolations currentUser={currentUser} toast={toast} />;
      case "profile":      return <StudentProfile currentUser={currentUser} toast={toast} />;
      default:             return <LecturerDashboard currentUser={currentUser} toast={toast} me={me} myHandouts={myHandouts} myAssignments={myAssignments} myClasses={myClasses} onNavigate={navigate} />;
    }
  };

  const tabLabel = NAV_SECTIONS.flatMap(s=>s.items).find(i=>i.key===activeTab)?.label || "Dashboard";

  return (
    <>

      {/* ── Offline Banner ── */}
      {isOffline && (
        <div style={{
          position:"fixed", top:0, left:0, right:0, zIndex:99999,
          background:"linear-gradient(90deg,#f59e0b,#ef4444)",
          color:"white", padding:"8px 16px", textAlign:"center",
          fontSize:13, fontWeight:700, letterSpacing:.3,
          boxShadow:"0 2px 12px rgba(0,0,0,.3)",
        }}>
          📡 You're offline — showing cached content. Some features may be unavailable.
        </div>
      )}

      <div className="app-shell" style={isOffline ? {marginTop:36} : {}}>
        {/* Overlay for mobile */}
        <div className={`sidebar-overlay${sidebarOpen?" open":""}`} onClick={()=>setSidebarOpen(false)} />

        {/* ── LECTURER SIDEBAR ── */}
        <div className={`lp-sidebar${sidebarOpen?" open":""}`}>
          <div className="lp-head">
            <div className="lp-logo">
              <div className="lp-logo-icon">👨🏫</div>
              <div>
                <div className="lp-logo-name">Lecturer Panel</div>
                <div className="lp-logo-name" style={{fontSize:11,opacity:.6}}>Nursing Academic Hub</div>
              </div>
            </div>
            <div className="lp-badge">👨🏫 Lecturer</div>
          </div>

          <div style={{flex:1,overflowY:"auto",paddingBottom:8}}>
            {NAV_SECTIONS.map(section => (
              <div key={section.label}>
                <div className="lp-nav-sec">{section.label}</div>
                {section.items.map(item => (
                  <div key={item.key} className={`lp-nav-item${activeTab===item.key?" active":""}`} onClick={()=>navigate(item.key)}>
                    <span className="lp-nav-icon">{item.icon}</span>
                    <span style={{flex:1}}>{item.label}</span>
                    {item.badge > 0 && (
                      <span style={{background:"var(--danger)",color:"white",borderRadius:"50%",width:18,height:18,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>{item.badge>9?"9+":item.badge}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {/* Sign out */}
            <div className="lp-nav-sec">Session</div>
            <div className="lp-nav-item" style={{color:"#f87171"}} onClick={onSignOut}>
              <span className="lp-nav-icon">🚪</span>Sign Out
            </div>
          </div>

          {/* Profile card */}
          <div className="lp-profile-card" onClick={()=>navigate("profile")}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#d97706,#f59e0b)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16,color:"#fff",flexShrink:0}}>{avatarChar}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:12,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,.5)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentUser}</div>
              </div>
              <span style={{fontSize:12,color:"rgba(255,255,255,.4)"}}>›</span>
            </div>
          </div>
        </div>

        {/* ── MAIN AREA ── */}
        <div className="lp-main">
          <div className="lp-topbar">
            <button className="hamburger" onClick={()=>setSidebarOpen(o=>!o)} style={{marginRight:4}}>☰</button>
            {navHistory.length > 0 && (
              <button className="btn btn-sm" style={{padding:"5px 10px",fontSize:13}} onClick={goBack}>← Back</button>
            )}
            <div className="lp-topbar-title">{tabLabel}</div>
            {/* ── Control icons moved here ── */}
            <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
              <div className="theme-btn" onClick={()=>setThemeMode(m=>m==="light"?"dark":m==="dark"?"dim":"light")} title="Toggle theme">
                {themeMode==="light"?"🌙":themeMode==="dark"?"💙":"☀️"}
              </div>
              <div className="icon-btn" title={syncError?"Sync error — tap to retry":"Sync"}
                onClick={()=>runSync().then(ok=>ok?toast("✅ Synced!","success"):toast("❌ Sync failed","error"))}
                style={{opacity:syncing?.5:1,cursor:syncing?"wait":"pointer",position:"relative"}}>
                <span style={{display:"inline-block",animation:syncing?"spin 1s linear infinite":"none"}}>{syncError?"⚠️":"🔄"}</span>
                {syncError&&<span style={{position:"absolute",top:-3,right:-3,width:8,height:8,borderRadius:"50%",background:"var(--danger)"}}/>}
              </div>
              <div className="icon-btn" style={{position:"relative"}} onClick={()=>navigate("notifications")}>
                🔔
                {unreadNotifs>0&&<span style={{position:"absolute",top:-4,right:-4,background:"var(--danger)",color:"white",borderRadius:"50%",width:16,height:16,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{unreadNotifs>9?"9+":unreadNotifs}</span>}
              </div>
              <div className="icon-btn" style={{position:"relative"}} onClick={()=>navigate("messages")}>
                💬
                {unreadDM>0&&<span style={{position:"absolute",top:-4,right:-4,background:"var(--accent)",color:"white",borderRadius:"50%",width:16,height:16,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{unreadDM>9?"9+":unreadDM}</span>}
              </div>
              <div onClick={()=>navigate("profile")} title="My Profile"
                style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,#d97706,#f59e0b)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,cursor:"pointer",border:`2px solid ${activeTab==="profile"?"white":"transparent"}`,flexShrink:0,fontWeight:800,color:"#fff"}}>
                {avatarChar}
              </div>
            </div>
          </div>
          <div className="lp-content">{renderTab()}</div>
        </div>
      </div>
      <Toasts list={[]} />
    </>
  );
}

// ── Lecturer Dashboard ─────────────────────────────────────────────

export function LecturerDashboard({ currentUser, toast, me, myHandouts, myAssignments, myClasses, onNavigate }) {
  const allUsers = ls("nv-users", []);
  const [handouts] = useSharedData("nv-handouts", []);

  const totalStudents = allUsers.filter(u => u.role !== "admin" && u.role !== "lecturer").length;
  const pendingGrades = (() => {
    // Count submissions without grades across all my assignments
    return 0; // placeholder — real count would need async load
  })();

  const recentHandouts = myHandouts.slice(-5).reverse();
  const activeAssignments = myAssignments.filter(a => Date.now() < a.dueAt);
  const overdueAssignments = myAssignments.filter(a => Date.now() > a.dueAt);

  const greeting = () => { const h=new Date().getHours(); return h<12?"Good morning":h<17?"Good afternoon":"Good evening"; };

  return (
    <div style={{maxWidth:900,margin:"0 auto"}}>
      {/* Welcome */}
      <div style={{background:"linear-gradient(135deg,#d97706,#b45309)",borderRadius:18,padding:"24px 28px",marginBottom:24,color:"#fff",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,fontSize:100,opacity:.08}}>👨🏫</div>
        <div style={{fontSize:13,opacity:.8,marginBottom:4}}>{greeting()}</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:24,marginBottom:6}}>{me.displayName||currentUser.split("@")[0]}</div>
        <div style={{fontSize:13,opacity:.8}}>You have {activeAssignments.length} active assignment{activeAssignments.length!==1?"s":""} • {myHandouts.length} handouts uploaded</div>
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:24}}>
        {[
          {icon:"📄",label:"My Handouts",val:myHandouts.length,color:"var(--accent)",key:"handouts"},
          {icon:"📝",label:"Assignments",val:myAssignments.length,color:"#d97706",key:"assignments"},
          {icon:"🎓",label:"Students",val:totalStudents,color:"var(--success)",key:"students"},
          {icon:"🏫",label:"Classes",val:myClasses.length,color:"var(--purple)",key:null},
          {icon:"✅",label:"Active Tasks",val:activeAssignments.length,color:"var(--accent2)",key:"assignments"},
        ].map(s=>(
          <div key={s.label} className="lp-stat" onClick={s.key?()=>onNavigate(s.key):null} style={{cursor:s.key?"pointer":"default"}}>
            <div style={{fontSize:26,marginBottom:6}}>{s.icon}</div>
            <div style={{fontWeight:800,fontSize:24,color:s.color}}>{s.val}</div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{marginBottom:24}}>
        <div style={{fontWeight:800,fontSize:15,marginBottom:12}}>⚡ Quick Actions</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}>
          {[
            {icon:"📄",label:"Upload Handout",sub:"Add notes for your class",key:"handouts",color:"var(--accent)"},
            {icon:"📝",label:"Post Assignment",sub:"Set work for students",key:"assignments",color:"#d97706"},
            {icon:"📋",label:"Mark Attendance",sub:"Record today's attendance",key:"attendance",color:"var(--success)"},
            {icon:"🧪",label:"Create CBT Exam",sub:"Build a new exam",key:"cbt",color:"var(--purple)"},
            {icon:"💬",label:"Send Message",sub:"Chat with a student",key:"messages",color:"var(--accent2)"},
            {icon:"📢",label:"Post Announcement",sub:"Notify your class",key:"announcements",color:"#f59e0b"},
          ].map(a=>(
            <button key={a.key+a.label} className="lp-quick-btn" onClick={()=>onNavigate(a.key)}>
              <div style={{width:38,height:38,borderRadius:10,background:`${a.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{a.icon}</div>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>{a.label}</div>
                <div style={{fontSize:11,color:"var(--text3)",fontWeight:400}}>{a.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,flexWrap:"wrap"}}>
        {/* Recent handouts */}
        <div className="lp-card">
          <div style={{fontWeight:800,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>📄 Recent Handouts</span>
            <span onClick={()=>onNavigate("handouts")} style={{fontSize:11,color:"var(--accent)",cursor:"pointer",fontWeight:700}}>View all →</span>
          </div>
          {recentHandouts.length===0
            ? <div style={{textAlign:"center",padding:"20px 0",color:"var(--text3)",fontSize:13}}>No handouts yet</div>
            : recentHandouts.map(h=>(
              <div key={h.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                <span style={{fontSize:20}}>📄</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.title}</div>
                  <div style={{fontSize:11,color:"var(--text3)"}}>{h.course} • {h.classId}</div>
                </div>
              </div>
            ))
          }
        </div>

        {/* Active assignments */}
        <div className="lp-card">
          <div style={{fontWeight:800,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>📝 Active Assignments</span>
            <span onClick={()=>onNavigate("assignments")} style={{fontSize:11,color:"var(--accent)",cursor:"pointer",fontWeight:700}}>View all →</span>
          </div>
          {activeAssignments.length===0
            ? <div style={{textAlign:"center",padding:"20px 0",color:"var(--text3)",fontSize:13}}>No active assignments</div>
            : activeAssignments.slice(0,4).map(a=>(
              <div key={a.id} style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                <div style={{fontWeight:700,fontSize:13}}>{a.title}</div>
                <div style={{fontSize:11,color:"var(--warn)"}}>Due: {new Date(a.dueAt).toLocaleDateString()}</div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

// ── Lecturer Announcements ─────────────────────────────────────────

export function LecturerAnnouncements({ toast, currentUser }) {
  const [items, setItems] = useSharedData("nv-announcements", []);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({title:"",body:"",pinned:false});

  const save = () => {
    if (!form.title.trim()||!form.body.trim()) return toast("Fill in title and message","error");
    const item = {...form, id:Date.now(), date:new Date().toLocaleDateString(), from:currentUser};
    const u = [...items, item]; setItems(u); saveShared("announcements",u);
    toast("Announcement posted ✅","success");
    setShowModal(false); setForm({title:"",body:"",pinned:false});
  };
  const del = (id) => { if(!confirm("Delete this announcement?"))return; const u=items.filter(a=>a.id!==id); setItems(u); saveShared("announcements",u); toast("Deleted","success"); };

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div><div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20}}>📢 Announcements</div>
          <div style={{color:"var(--text3)",fontSize:13}}>Post notices visible to all students</div></div>
        <button onClick={()=>setShowModal(true)} style={{padding:"9px 18px",borderRadius:10,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>+ Post</button>
      </div>
      {showModal&&(
        <div style={{background:"var(--card)",border:"1.5px solid var(--accent)",borderRadius:14,padding:20,marginBottom:20}}>
          <div style={{fontWeight:800,marginBottom:12}}>New Announcement</div>
          <label className="lbl">Title</label>
          <input className="inp" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Class postponed" />
          <label className="lbl">Message</label>
          <textarea className="inp" rows={3} value={form.body} onChange={e=>setForm({...form,body:e.target.value})} placeholder="Full announcement…" style={{resize:"vertical"}} />
          <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,cursor:"pointer",fontSize:13,fontWeight:700}}>
            <input type="checkbox" checked={form.pinned} onChange={e=>setForm({...form,pinned:e.target.checked})} />
            📌 Pin to dashboard
          </label>
          <div style={{display:"flex",gap:8}}>
            <button onClick={save} style={{flex:1,padding:10,borderRadius:10,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>Post</button>
            <button onClick={()=>setShowModal(false)} style={{padding:"10px 18px",borderRadius:10,background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border)",cursor:"pointer",fontWeight:700}}>Cancel</button>
          </div>
        </div>
      )}
      {items.length===0&&<div style={{textAlign:"center",padding:60,color:"var(--text3)"}}><div style={{fontSize:48,marginBottom:12}}>📢</div><div style={{fontWeight:700}}>No announcements yet</div></div>}
      {[...items].reverse().map(a=>(
        <div key={a.id} className="lp-card">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>{a.pinned?"📌 ":""}{a.title}</div>
              <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.6,marginBottom:8}}>{a.body}</div>
              <div style={{fontSize:11,color:"var(--text3)"}}>{a.date}{a.from&&` • by ${a.from.split("@")[0]}`}</div>
            </div>
            {a.from===currentUser&&<button onClick={()=>del(a.id)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--danger)",marginLeft:12,fontSize:16,flexShrink:0}}>🗑️</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Lecturer Students View ─────────────────────────────────────────

export function LecturerStudents({ currentUser, toast, classes }) {
  const allUsers = ls("nv-users", []);
  const students = allUsers.filter(u => u.role !== "admin" && u.role !== "lecturer");
  const [selClass, setSelClass] = useState("");
  const [search, setSearch] = useState("");

  const filtered = students.filter(u => {
    if (selClass && u.class !== selClass) return false;
    if (search && !u.username.toLowerCase().includes(search.toLowerCase()) && !(u.displayName||"").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{maxWidth:800,margin:"0 auto"}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20,marginBottom:4}}>🎓 Students</div>
      <div style={{color:"var(--text3)",fontSize:13,marginBottom:20}}>{students.length} registered students</div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <input className="inp" style={{flex:1,minWidth:180,marginBottom:0}} placeholder="Search name or email…" value={search} onChange={e=>setSearch(e.target.value)} />
        <select className="inp" style={{width:"auto",minWidth:160,marginBottom:0}} value={selClass} onChange={e=>setSelClass(e.target.value)}>
          <option value="">All classes</option>
          {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      {filtered.length===0&&<div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>No students found</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
        {filtered.map(u=>{
          const cls = classes.find(c=>c.id===u.class);
          return (
            <div key={u.username} className="lp-card" style={{padding:16}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,color:"#fff",fontSize:16,flexShrink:0}}>
                  {(u.avatar||(u.displayName||u.username)[0]||"?").toUpperCase()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.displayName||u.username.split("@")[0]}</div>
                  <div style={{fontSize:10,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.username}</div>
                </div>
              </div>
              <div style={{fontSize:11,color:"var(--accent)",fontWeight:700}}>🏫 {cls?.label||"No class"}</div>
              <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>Joined: {u.joined||"—"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Lecturer Gradebook ─────────────────────────────────────────────

export function LecturerGradebook({ currentUser, toast }) {
  const [assignments, setAssignments] = useState([]);
  const [selAsgn, setSelAsgn] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(null);
  const [gradeForm, setGradeForm] = useState({grade:"",feedback:""});
  const allUsers = ls("nv-users",[]);

  useEffect(()=>{
    if(!_db){setLoading(false);return;}
    const unsub = _db.collection("assignments")
      .where("createdBy","==",currentUser)
      .orderBy("dueAt","desc")
      .onSnapshot(snap=>{setAssignments(snap.docs.map(d=>({id:d.id,...d.data()})));setLoading(false);}
      ,()=>setLoading(false));
    return ()=>unsub();
  },[currentUser]);

  useEffect(()=>{
    if(!selAsgn)return;
    asgLoadSubmissions(selAsgn.id).then(setSubmissions);
  },[selAsgn?.id]);

  const saveGrade = async () => {
    if(!gradeForm.grade) return toast("Enter a grade","error");
    const ok = await asgGrade(selAsgn.id, grading, +gradeForm.grade, gradeForm.feedback);
    if(ok){toast("Graded ✅","success");asgLoadSubmissions(selAsgn.id).then(setSubmissions);setGrading(null);}
    else toast("Failed","error");
  };

  if(loading) return <div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>Loading…</div>;

  if(selAsgn) return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <button onClick={()=>{setSelAsgn(null);setSubmissions([]);}} style={{background:"none",border:"none",cursor:"pointer",color:"var(--text3)",marginBottom:16,fontSize:13}}>← Back</button>
      <div className="lp-card">
        <div style={{fontWeight:800,fontSize:16,marginBottom:4}}>{selAsgn.title}</div>
        <div style={{fontSize:12,color:"var(--text3)"}}>Due: {new Date(selAsgn.dueAt).toLocaleString()} • Max: {selAsgn.maxScore} pts • {submissions.length} submission{submissions.length!==1?"s":""}</div>
      </div>
      {submissions.length===0&&<div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>No submissions yet</div>}
      {submissions.map(sub=>{
        const u = allUsers.find(x=>x.username===sub.student);
        return (
          <div key={sub.student} className="lp-card">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontWeight:700}}>{u?.displayName||sub.student.split("@")[0]}</div>
              <div style={{fontSize:11,color:"var(--text3)"}}>{new Date(sub.submittedAt).toLocaleString()}</div>
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>📎 {sub.fileName}</div>
            {sub.fileData&&<a href={sub.fileData} download={sub.fileName} style={{fontSize:12,color:"var(--accent)",textDecoration:"none",marginBottom:8,display:"inline-block"}}>⬇ Download</a>}
            {sub.grade!=null
              ? <div style={{background:"rgba(34,197,94,.1)",borderRadius:8,padding:"8px 12px",fontSize:13,fontWeight:700}}>✅ Graded: {sub.grade}/{selAsgn.maxScore}{sub.feedback&&` • ${sub.feedback}`}</div>
              : grading===sub.student
                ? <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                    <input type="number" className="inp" style={{width:80,marginBottom:0}} placeholder="Score" value={gradeForm.grade} onChange={e=>setGradeForm({...gradeForm,grade:e.target.value})} />
                    <input className="inp" style={{flex:1,marginBottom:0,minWidth:120}} placeholder="Feedback" value={gradeForm.feedback} onChange={e=>setGradeForm({...gradeForm,feedback:e.target.value})} />
                    <button onClick={saveGrade} style={{padding:"9px 16px",borderRadius:9,background:"var(--success)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700}}>Save</button>
                    <button onClick={()=>setGrading(null)} style={{padding:"9px 14px",borderRadius:9,background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border)",cursor:"pointer"}}>✕</button>
                  </div>
                : <button onClick={()=>{setGrading(sub.student);setGradeForm({grade:"",feedback:""}); }} style={{padding:"7px 14px",borderRadius:9,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700,fontSize:12}}>Grade</button>
            }
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20,marginBottom:4}}>📊 Gradebook</div>
      <div style={{color:"var(--text3)",fontSize:13,marginBottom:20}}>Click an assignment to grade submissions</div>
      {assignments.length===0&&<div style={{textAlign:"center",padding:60,color:"var(--text3)"}}><div style={{fontSize:48,marginBottom:12}}>📊</div><div style={{fontWeight:700}}>No assignments posted yet</div></div>}
      {assignments.map(a=>{
        const overdue = Date.now()>a.dueAt;
        return (
          <div key={a.id} className="lp-card" style={{cursor:"pointer"}} onClick={()=>setSelAsgn(a)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{fontWeight:800,fontSize:14,flex:1}}>{a.title}</div>
              <span style={{fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:12,background:overdue?"rgba(239,68,68,.1)":"rgba(34,197,94,.1)",color:overdue?"var(--danger)":"var(--success)",flexShrink:0,marginLeft:10}}>{overdue?"Closed":"Open"}</span>
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>Due: {new Date(a.dueAt).toLocaleString()} • Max: {a.maxScore} pts</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Lecturer Violations View ───────────────────────────────────────

export function LecturerViolations({ currentUser, toast }) {
  const [violations, setViolations] = useState([]);
  const [loading, setLoading] = useState(true);
  const allUsers = ls("nv-users",[]);

  useEffect(()=>{ cbtViolationsGet().then(v=>{ setViolations(v||[]); setLoading(false); }).catch(()=>setLoading(false)); },[]);

  const clearOne = async (examId,student) => {
    if(!confirm("Clear this violation record?"))return;
    const updated = violations.filter(v=>!(v.examId===examId&&v.student===student));
    await cbtViolationsSave(updated);
    setViolations(updated);
    toast("Cleared","success");
  };

  if(loading) return <div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>Loading…</div>;

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20,marginBottom:4}}>🚨 Exam Violations</div>
      <div style={{color:"var(--text3)",fontSize:13,marginBottom:20}}>Students flagged during CBT exams</div>
      {violations.length===0&&<div style={{textAlign:"center",padding:60,color:"var(--text3)"}}><div style={{fontSize:48,marginBottom:12}}>✅</div><div style={{fontWeight:700}}>No violations recorded</div></div>}
      {violations.map((v,i)=>{
        const u = allUsers.find(x=>x.username===v.student);
        return (
          <div key={i} className="lp-card" style={{borderColor:"rgba(239,68,68,.3)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontWeight:800,fontSize:14,marginBottom:4,color:"var(--danger)"}}>🚨 {u?.displayName||v.student?.split("@")[0]||v.student}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:4}}>Exam: {v.examTitle||v.examId}</div>
                {v.tabSwitches>0&&<div style={{fontSize:12,color:"var(--warn)"}}>⚠️ Tab switches: {v.tabSwitches}</div>}
                {v.fullscreenExits>0&&<div style={{fontSize:12,color:"var(--warn)"}}>⚠️ Fullscreen exits: {v.fullscreenExits}</div>}
                <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>{v.flaggedAt?new Date(v.flaggedAt).toLocaleString():""}</div>
              </div>
              <button onClick={()=>clearOne(v.examId,v.student)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--danger)",fontSize:16,flexShrink:0}}>🗑️</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ── IncomingCallBanner — full-screen overlay for incoming calls ──────────
