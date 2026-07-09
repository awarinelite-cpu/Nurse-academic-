import { useState, useEffect, useRef } from "react";
import { DEFAULT_CLASSES } from "../../data/defaults";
import { _db, _loadFirebase, _userPrivateKey, rcGetMembers, saveMyData, saveShared, useSharedData } from "../../services/backend";
import { ls } from "../../utils/storage";
import { HandoutViewModal } from "../../components/academics";
import { AVATAR_EMOJIS, YEAR_OPTIONS } from "../../shared/profileConstants";

export function Dashboard({ user, onNavigate }) {
  const [handouts] = useSharedData("nv-handouts", []);
  const [classes] = useSharedData("nv-classes", DEFAULT_CLASSES);
  const [_announcements] = useSharedData("nv-announcements", []);
  const announcements = _announcements.filter(a=>a.pinned);
  const [openGroup, setOpenGroup] = useState(null);
  const [rcMemberCount, setRcMemberCount] = useState(null);
  const isResearcher = (() => { try{ return localStorage.getItem("rc-member-"+user.replace(/[^a-z0-9]/gi,"_"))==="1"; }catch{return false;} })();

  useEffect(() => { rcGetMembers().then(list => setRcMemberCount(list.length)); }, []);

  const groups = [
    { key:"bnsc", label:"BNSc", icon:"🎓", color:"#a78bfa", match: c => c.id?.startsWith("bnsc") || c.label?.toLowerCase().includes("bnsc") },
    { key:"ndhnd", label:"ND / HND", icon:"📚", color:"#3E8E95", match: c => ["nd","hnd"].some(p => c.id?.startsWith(p) || c.label?.toLowerCase().startsWith(p)) },
    { key:"cn", label:"Community Nursing", icon:"🏥", color:"#facc15", match: c => c.id?.startsWith("cn") || c.label?.toLowerCase().includes("community") || c.label?.toLowerCase().includes("cn ") },
  ];
  const assigned = new Set();
  const grouped = groups.map(g => {
    const members = classes.filter(c => { if(assigned.has(c.id)) return false; if(g.match(c)){assigned.add(c.id);return true;} return false; });
    return {...g, members};
  });
  const others = classes.filter(c => !assigned.has(c.id));

  return (
    <div>
      {announcements.length>0&&announcements.map(a=>(
        <div key={a.id} style={{background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.25)",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",gap:10}}>
          <span>📌</span>
          <div><div style={{fontWeight:700,marginBottom:2}}>{a.title}</div><div style={{fontSize:13,color:"var(--text2)"}}>{a.body}</div></div>
        </div>
      ))}
      <div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search handouts, courses, tools..." /></div>

      {/* ── Research Club Banner ── */}
      <div
        onClick={()=>onNavigate("research-club")}
        style={{
          background: isResearcher
            ? "linear-gradient(135deg,rgba(124,58,237,.18),rgba(180,83,9,.18))"
            : "linear-gradient(135deg,rgba(124,58,237,.12),rgba(180,83,9,.12))",
          border: isResearcher ? "2px solid rgba(251,191,36,.5)" : "1.5px solid rgba(124,58,237,.25)",
          borderRadius:14, padding:"14px 18px", marginBottom:20,
          display:"flex", alignItems:"center", gap:14, cursor:"pointer",
          transition:"all .2s", position:"relative", overflow:"hidden"
        }}
        onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(124,58,237,.2)";}}
        onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}
      >
        <div style={{position:"absolute",right:-10,top:-10,fontSize:80,opacity:.06}}>🔬</div>
        <div style={{
          width:48,height:48,borderRadius:12,
          background:"linear-gradient(135deg,#7c3aed,#b45309)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,
          boxShadow:"0 4px 14px rgba(124,58,237,.35)",flexShrink:0
        }}>🔬</div>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
            <div style={{fontWeight:900,fontSize:15,color:"var(--text)"}}>Research Club</div>
            {isResearcher
              ? <div style={{background:"linear-gradient(135deg,#b45309,#f59e0b)",borderRadius:20,padding:"2px 9px",fontSize:9,fontWeight:900,color:"#fde68a",boxShadow:"0 1px 6px rgba(245,158,11,.4)"}}>🔬 RESEARCHER</div>
              : <div style={{background:"rgba(124,58,237,.15)",borderRadius:20,padding:"2px 9px",fontSize:10,fontWeight:700,color:"#a78bfa",border:"1px solid rgba(124,58,237,.3)"}}>✦ Elite</div>
            }
          </div>
          <div style={{fontSize:12,color:"var(--text3)",fontWeight:700}}>
            {isResearcher
              ? `You're a member • ${rcMemberCount||"..."} researchers • Click to open`
              : `Join the elite research community • ${rcMemberCount||"..."} member${rcMemberCount!==1?"s":""} • Earn the golden RESEARCHER badge`
            }
          </div>
        </div>
        <div style={{fontSize:18,color:"var(--text3)",flexShrink:0}}>›</div>
      </div>

      <div className="grid5" style={{marginBottom:24}}>
        {[
          {lbl:"CLASSES",val:classes.length,sub:"Active programs"},
          {lbl:"COURSES",val:classes.reduce((s,c)=>s+c.courses.length,0),sub:"Across all classes"},
          {lbl:"HANDOUTS",val:handouts.length,sub:"Total uploaded"},
          {lbl:"RESULTS",val:ls("nv-results",[]).length,sub:"Test & exam scores"},
          {lbl:"USERS",val:ls("nv-users",[]).length,sub:"Registered accounts"},
        ].map((s,i)=>(
          <div key={s.lbl} className="stat-card" style={{animationDelay:`${i*.06}s`}}>
            <div className="stat-lbl">{s.lbl}</div>
            <div className="stat-val">{s.val}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="sec-title">Classes</div>
      <div className="sec-sub">Select a group to browse classes and handouts</div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {grouped.map(group=>(
          <div key={group.key} className="card" style={{padding:0,overflow:"hidden",border:`1px solid var(--border)`}}>
            <div
              onClick={()=>setOpenGroup(openGroup===group.key ? null : group.key)}
              style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",cursor:"pointer",background:openGroup===group.key?"rgba(62,142,149,.07)":"transparent",transition:"background .2s"}}
            >
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:36,height:36,borderRadius:9,background:`${group.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{group.icon}</div>
                <div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{group.label}</div>
                  <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{group.members.length} class{group.members.length!==1?"es":""}</div>
                </div>
              </div>
              <span style={{fontSize:13,color:"var(--text3)",display:"inline-block",transition:"transform .25s",transform:openGroup===group.key?"rotate(180deg)":"rotate(0deg)"}}>▾</span>
            </div>
            {openGroup===group.key&&(
              <div style={{borderTop:"1px solid var(--border)",padding:"12px 14px"}}>
                <div className="grid2">
                  {group.members.map((c,i)=>(
                    <div className="class-card" key={c.id} style={{"--cc":c.color,animationDelay:`${i*.04}s`}} onClick={()=>onNavigate("handouts",c)}>
                      <span style={{float:"right",fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{c.courses.length} courses</span>
                      <div className="class-tag">{c.label}</div>
                      <div className="class-name">{c.label}</div>
                      <div className="class-desc">{c.desc}</div>
                      <div className="class-meta">
                        <span>📚 {c.courses.length} Courses</span>
                        <span>📝 {handouts.filter(h=>h.classId===c.id).length} Notes</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {others.map((c,i)=>(
          <div className="class-card" key={c.id} style={{"--cc":c.color,animationDelay:`${i*.03}s`}} onClick={()=>onNavigate("handouts",c)}>
            <div className="class-tag">{c.label}</div>
            <div className="class-name">{c.label}</div>
            <div className="class-desc">{c.desc}</div>
            <div className="class-meta">
              <span>📚 {c.courses.length} Courses</span>
              <span>📝 {handouts.filter(h=>h.classId===c.id).length} Notes</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// HandoutViewModal: loads PDF from separate backend key if needed

export function StudentProfile({ currentUser, toast }) {
  const [users, setUsers] = useSharedData("nv-users", []);
  const [classes] = useSharedData("nv-classes", DEFAULT_CLASSES);
  const results = ls("nv-results", []);

  const me = users.find(u => u.username === currentUser) || {};

  const [editMode, setEditMode] = useState(false);
  const [showPwSection, setShowPwSection] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const isLecturerRole = me.role === "lecturer";
  const [form, setForm] = useState({
    displayName: me.displayName || currentUser.split("@")[0],
    phone: me.phone || "",
    bio: me.bio || "",
    class: me.class || "",
    yearOfStudy: me.yearOfStudy || "",
    avatar: me.avatar || (me.role === "lecturer" ? "👨🏫" : "👩⚕️"),
    matricNumber: me.matricNumber || "",
    specialty: me.specialty || "",
  });
  const [pwForm, setPwForm] = useState({ current: "", newPw: "", confirm: "" });
  const [showPw, setShowPw] = useState({ current: false, newPw: false, confirm: false });

  // Refresh form when user data changes
  useEffect(() => {
    const u = users.find(u => u.username === currentUser) || {};
    setForm(f => ({
      displayName: u.displayName || currentUser.split("@")[0],
      phone: u.phone || "",
      bio: u.bio || "",
      class: u.class || "",
      yearOfStudy: u.yearOfStudy || "",
      avatar: u.avatar || (u.role === "lecturer" ? "👨🏫" : "👩⚕️"),
      matricNumber: u.matricNumber || "",
      specialty: u.specialty || "",
    }));
  }, [users, currentUser]);

  const myClass = classes.find(c => c.id === (me.class || form.class));

  const saveProfile = async () => {
    if (!form.displayName.trim()) return toast("Display name required", "error");
    const updated = users.map(u =>
      u.username === currentUser ? { ...u, ...form, displayName: form.displayName.trim() } : u
    );
    setUsers(updated);
    const ok = await saveShared("users", updated);
    toast(ok ? "✅ Profile updated!" : "✅ Saved locally — sync failed", ok ? "success" : "warn");
    setEditMode(false);
    setShowAvatarPicker(false);
  };

  const changePassword = async () => {
    if (!pwForm.current) return toast("Enter your current password", "error");
    if (pwForm.current !== me.password) return toast("Current password is incorrect", "error");
    if (pwForm.newPw.length < 6) return toast("New password must be at least 6 characters", "error");
    if (pwForm.newPw !== pwForm.confirm) return toast("Passwords do not match", "error");
    const updated = users.map(u =>
      u.username === currentUser ? { ...u, password: pwForm.newPw } : u
    );
    setUsers(updated);
    const ok = await saveShared("users", updated);
    toast(ok ? "🔐 Password changed!" : "✅ Saved locally", ok ? "success" : "warn");
    setPwForm({ current: "", newPw: "", confirm: "" });
    setShowPwSection(false);
  };

  const totalExams = results.length;
  const avgPct = totalExams > 0 ? Math.round(results.reduce((s, r) => s + (r.pct || 0), 0) / totalExams) : 0;
  const passed = results.filter(r => (r.pct || 0) >= 50).length;

  const initials = (form.displayName || currentUser)[0]?.toUpperCase() || "?";
  const roleLabel = me.role === "admin" ? "🛡️ Admin" : me.role === "lecturer" ? "👨🏫 Lecturer" : "🎓 Student";
  const roleColor = me.role === "admin" ? "#7c3aed" : me.role === "lecturer" ? "#d97706" : "var(--accent)";

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", paddingBottom: 40 }}>
      {/* ── Header Banner ── */}
      <div style={{
        background: "linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%)",
        borderRadius: 20, padding: "28px 28px 0", marginBottom: 0,
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -30, right: -30, fontSize: 120, opacity: .08, userSelect: "none" }}>🏥</div>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
          {/* Avatar */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <div
              onClick={() => editMode && setShowAvatarPicker(p => !p)}
              style={{
                width: 84, height: 84, borderRadius: "50%",
                background: "rgba(255,255,255,.18)",
                border: "3px solid rgba(255,255,255,.5)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 44, cursor: editMode ? "pointer" : "default",
                transition: "transform .2s", transform: editMode ? "scale(1.05)" : "scale(1)",
              }}>
              {form.avatar || initials}
            </div>
            {editMode && (
              <div style={{
                position: "absolute", bottom: 0, right: 0, width: 24, height: 24,
                borderRadius: "50%", background: "white", display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 13,
                boxShadow: "0 2px 8px rgba(0,0,0,.2)", cursor: "pointer",
              }} onClick={() => setShowAvatarPicker(p => !p)}>✏️</div>
            )}
          </div>

          <div style={{ flex: 1, paddingBottom: 20 }}>
            <div style={{ color: "white", fontWeight: 800, fontSize: 22, marginBottom: 2 }}>
              {form.displayName || currentUser.split("@")[0]}
            </div>
            <div style={{ color: "rgba(255,255,255,.8)", fontSize: 13, marginBottom: 6 }}>{currentUser}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ background: "rgba(255,255,255,.18)", color: "white", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                {roleLabel}
              </span>
              {myClass && (
                <span style={{ background: "rgba(255,255,255,.18)", color: "white", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                  🏫 {myClass.label}
                </span>
              )}
              {form.yearOfStudy && (
                <span style={{ background: "rgba(255,255,255,.18)", color: "white", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                  📅 {form.yearOfStudy}
                </span>
              )}
            </div>
          </div>

          {/* Edit toggle */}
          <div style={{ paddingBottom: 20 }}>
            {!editMode
              ? <button className="btn" style={{ background: "rgba(255,255,255,.18)", color: "white", border: "1.5px solid rgba(255,255,255,.4)", fontWeight: 700 }}
                  onClick={() => setEditMode(true)}>✏️ Edit Profile</button>
              : <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-success" style={{ fontWeight: 700 }} onClick={saveProfile}>💾 Save</button>
                  <button className="btn" style={{ background: "rgba(255,255,255,.12)", color: "white", border: "1.5px solid rgba(255,255,255,.3)" }}
                    onClick={() => { setEditMode(false); setShowAvatarPicker(false); }}>✕ Cancel</button>
                </div>
            }
          </div>
        </div>
      </div>

      {/* Avatar picker */}
      {showAvatarPicker && (
        <div className="card" style={{ borderRadius: "0 0 16px 16px", padding: "14px 18px", borderTop: "none", background: "var(--card)", marginTop: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>CHOOSE AVATAR</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {AVATAR_EMOJIS.map(em => (
              <div key={em} onClick={() => { setForm(f => ({ ...f, avatar: em })); setShowAvatarPicker(false); }}
                style={{
                  width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 26, cursor: "pointer", transition: "all .15s",
                  background: form.avatar === em ? "var(--accent)" + "22" : "var(--bg4)",
                  border: `2px solid ${form.avatar === em ? "var(--accent)" : "var(--border)"}`,
                  transform: form.avatar === em ? "scale(1.15)" : "scale(1)",
                }}>
                {em}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Stats Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, margin: "18px 0" }}>
        {[
          { icon: "📝", label: "Exams Taken", val: totalExams },
          { icon: "📊", label: "Average Score", val: totalExams > 0 ? `${avgPct}%` : "—" },
          { icon: "✅", label: "Passed (≥50%)", val: passed },
        ].map((s, i) => (
          <div key={i} className="card" style={{ textAlign: "center", padding: "16px 10px" }}>
            <div style={{ fontSize: 26, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontWeight: 800, fontSize: 20, color: "var(--accent)", lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Profile Details Card ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 16, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent)" + "20", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>👤</span>
          Personal Information
        </div>

        {!editMode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { icon: "✏️", label: "Display Name", val: form.displayName || "—" },
              { icon: "🎓", label: "Matric Number", val: form.matricNumber || "Not set" },
              { icon: "📧", label: "Email", val: currentUser },
              { icon: "📱", label: "Phone", val: form.phone || "Not set" },
              { icon: "📝", label: "Bio", val: form.bio || "No bio yet" },
              { icon: "📅", label: "Joined", val: me.joined || "—" },
            ].map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, background: "var(--bg4)" }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{row.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", marginBottom: 2, textTransform: "uppercase", letterSpacing: ".5px" }}>{row.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>{row.val}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label className="lbl">Display Name *</label>
                <input className="inp" style={{ marginBottom: 0 }} value={form.displayName}
                  onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                  placeholder="Your name..." />
              </div>
              <div>
                <label className="lbl">Phone Number</label>
                <input className="inp" style={{ marginBottom: 0 }} type="tel" value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+233 xxx xxx xxxx" />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="lbl">🎓 Matric Number</label>
              <input className="inp" style={{ marginBottom: 0 }} value={form.matricNumber}
                onChange={e => setForm(f => ({ ...f, matricNumber: e.target.value.toUpperCase() }))}
                placeholder="e.g. NRS/2021/001" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="lbl">Bio / About Me</label>
              <textarea className="inp" rows={3} style={{ resize: "vertical" }} value={form.bio}
                onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                placeholder="Tell your classmates a little about yourself..." />
            </div>
            <div style={{ background: "var(--bg4)", borderRadius: 10, padding: 12, marginBottom: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "var(--text3)", marginBottom: 2 }}>📧 Email</div>
              <div style={{ fontSize: 14, color: "var(--text)", opacity: .7 }}>{currentUser} <span style={{ fontSize: 11, color: "var(--text3)" }}>(cannot be changed)</span></div>
            </div>
          </div>
        )}
      </div>

      {/* ── Academic Info Card ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 16, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent)" + "20", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🏫</span>
          {isLecturerRole ? "Lecturer Information" : "Academic Information"}
        </div>

        {!editMode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(isLecturerRole ? [
              { icon: "👨🏫", label: "Role", val: "👨🏫 Lecturer" },
              { icon: "🏫", label: "Classes", val: "All classes (lecturers teach across all classes)" },
              { icon: "🩺", label: "Specialty / Department", val: form.specialty || "Not set" },
            ] : [
              { icon: "🏫", label: "Class", val: myClass ? `${myClass.label} — ${myClass.desc}` : "No class assigned" },
              { icon: "📅", label: "Year of Study", val: form.yearOfStudy || "Not set" },
              { icon: "🎓", label: "Role", val: roleLabel },
            ]).map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, background: "var(--bg4)" }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{row.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", marginBottom: 2, textTransform: "uppercase", letterSpacing: ".5px" }}>{row.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{row.val}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            {isLecturerRole ? (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <label className="lbl">🩺 Specialty / Department</label>
                  <input className="inp" style={{ marginBottom: 0 }} value={form.specialty}
                    onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))}
                    placeholder="e.g. Maternal Health, Pharmacology..." />
                </div>
                <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(217,119,6,.08)", border: "1px solid rgba(217,119,6,.2)" }}>
                  <div style={{ fontSize: 12, color: "#d97706", fontWeight: 700 }}>
                    👨🏫 Lecturers are not assigned to a specific class — you can teach and interact with all classes.
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label className="lbl">🏫 Class</label>
                    <select className="inp" style={{ marginBottom: 0 }} value={form.class}
                      onChange={e => setForm(f => ({ ...f, class: e.target.value }))}>
                      <option value="">— Select your class —</option>
                      {classes.map(c => (
                        <option key={c.id} value={c.id}>{c.label} — {c.desc}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="lbl">📅 Year of Study</label>
                    <select className="inp" style={{ marginBottom: 0 }} value={form.yearOfStudy}
                      onChange={e => setForm(f => ({ ...f, yearOfStudy: e.target.value }))}>
                      <option value="">— Select year —</option>
                      {YEAR_OPTIONS.map(y => <option key={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "var(--bg4)" }}>
                  <div style={{ fontSize: 12, color: "var(--text3)" }}>
                    ℹ️ Contact your admin if your class assignment appears incorrect after saving.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Change Password Card ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showPwSection ? 16 : 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(239,68,68,.12)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🔐</span>
            Change Password
          </div>
          <button className="btn btn-sm" style={{ borderColor: showPwSection ? "var(--danger)" : "var(--border)", color: showPwSection ? "var(--danger)" : "var(--text3)" }}
            onClick={() => { setShowPwSection(p => !p); setPwForm({ current: "", newPw: "", confirm: "" }); }}>
            {showPwSection ? "✕ Cancel" : "Change →"}
          </button>
        </div>

        {showPwSection && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label className="lbl">Current Password</label>
              <div style={{ position: "relative" }}>
                <input className="inp" style={{ marginBottom: 0, paddingRight: 44 }}
                  type={showPw.current ? "text" : "password"}
                  value={pwForm.current} placeholder="Enter current password"
                  onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} />
                <span onClick={() => setShowPw(p => ({ ...p, current: !p.current }))}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", cursor: "pointer", fontSize: 16 }}>
                  {showPw.current ? "🙈" : "👁️"}
                </span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label className="lbl">New Password</label>
                <div style={{ position: "relative" }}>
                  <input className="inp" style={{ marginBottom: 0, paddingRight: 44 }}
                    type={showPw.newPw ? "text" : "password"}
                    value={pwForm.newPw} placeholder="Min 6 characters"
                    onChange={e => setPwForm(f => ({ ...f, newPw: e.target.value }))} />
                  <span onClick={() => setShowPw(p => ({ ...p, newPw: !p.newPw }))}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", cursor: "pointer", fontSize: 16 }}>
                    {showPw.newPw ? "🙈" : "👁️"}
                  </span>
                </div>
              </div>
              <div>
                <label className="lbl">Confirm New Password</label>
                <div style={{ position: "relative" }}>
                  <input className="inp" style={{ marginBottom: 0, paddingRight: 44 }}
                    type={showPw.confirm ? "text" : "password"}
                    value={pwForm.confirm} placeholder="Repeat new password"
                    onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} />
                  <span onClick={() => setShowPw(p => ({ ...p, confirm: !p.confirm }))}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", cursor: "pointer", fontSize: 16 }}>
                    {showPw.confirm ? "🙈" : "👁️"}
                  </span>
                </div>
              </div>
            </div>
            {pwForm.newPw && pwForm.confirm && pwForm.newPw !== pwForm.confirm && (
              <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 10, padding: "8px 12px", background: "rgba(239,68,68,.08)", borderRadius: 8 }}>
                ⚠️ Passwords do not match
              </div>
            )}
            {pwForm.newPw && pwForm.newPw.length < 6 && (
              <div style={{ fontSize: 12, color: "var(--warn)", marginBottom: 10, padding: "8px 12px", background: "rgba(251,146,60,.08)", borderRadius: 8 }}>
                ⚠️ Password must be at least 6 characters
              </div>
            )}
            <button className="btn btn-accent" style={{ width: "100%", fontWeight: 800 }} onClick={changePassword}>
              🔐 Update Password
            </button>
          </div>
        )}
      </div>

      {/* ── Recent Activity ── */}
      {results.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent)" + "20", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📊</span>
            Recent Exam Activity
          </div>
          {results.slice(-5).reverse().map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < Math.min(4, results.length - 1) ? "1px solid var(--border)" : "none" }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: (r.pct || 0) >= 70 ? "rgba(34,197,94,.12)" : (r.pct || 0) >= 50 ? "rgba(251,146,60,.12)" : "rgba(239,68,68,.1)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
              }}>
                {(r.pct || 0) >= 70 ? "🎉" : (r.pct || 0) >= 50 ? "👍" : "📚"}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{r.subject}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>{r.type || "Exam"} • {r.date}</div>
              </div>
              <div style={{
                fontWeight: 800, fontSize: 15,
                color: (r.pct || 0) >= 70 ? "var(--success)" : (r.pct || 0) >= 50 ? "var(--warn)" : "var(--danger)"
              }}>
                {r.score}/{r.total || "?"} <span style={{ fontSize: 12 }}>({r.pct || 0}%)</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Results({ toast }) {
  const [results, setResults] = useState(()=>ls("nv-results",[]));
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({subject:"",score:"",total:"",type:"",date:""});
  const save=()=>{if(!form.subject||!form.score)return toast("Fill required fields","error");const item={...form,id:Date.now(),pct:Math.round((+form.score/+(form.total||100))*100)};const u=[...results,item];setResults(u);saveMyData("results","nv-results",u);setForm({subject:"",score:"",total:"",type:"",date:""});setShowAdd(false);toast("Result saved!","success");};
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div><div className="sec-title">📊 Results</div><div className="sec-sub">Track your scores</div></div>
        <button className="btn btn-accent" onClick={()=>setShowAdd(true)}>+ Add Result</button>
      </div>
      {results.length===0?<div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}><div style={{fontSize:48}}>📊</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:13,marginTop:12}}>No results yet!</div></div>:(
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="tbl"><thead><tr><th>Subject</th><th>Type</th><th>Score</th><th>%</th><th>Date</th><th></th></tr></thead>
          <tbody>{results.map(r=><tr key={r.id}><td style={{fontWeight:600}}>{r.subject}</td><td><span className="tag">{r.type||"Test"}</span></td><td>{r.score}/{r.total||100}</td><td><span className={`tag ${r.pct>=70?"tag-success":r.pct>=50?"tag-warn":"tag-danger"}`}>{r.pct}%</span></td><td style={{fontSize:12,color:"var(--text3)"}}>{r.date}</td><td><button className="btn btn-sm btn-danger" onClick={()=>{const u=results.filter(x=>x.id!==r.id);setResults(u);saveMyData("results","nv-results",u);}}>✕</button></td></tr>)}</tbody>
          </table>
        </div>
      )}
      {showAdd&&<div className="modal-overlay" onClick={()=>setShowAdd(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div className="modal-title">Add Result</div><button className="modal-close" onClick={()=>setShowAdd(false)}>✕</button></div>{["subject","score","total","type","date"].map(f=><div key={f}><label className="lbl">{f==="total"?"Total Marks":f}</label><input className="inp" type={f==="score"||f==="total"?"number":"text"} value={form[f]} onChange={e=>setForm({...form,[f]:e.target.value})} /></div>)}<div style={{display:"flex",gap:8}}><button className="btn btn-accent" style={{flex:1}} onClick={save}>Save</button><button className="btn" onClick={()=>setShowAdd(false)}>Cancel</button></div></div></div>}
    </div>
  );
}

// ─── MCQ Exam View ────────────────────────────────────────────────────

export function StudentIDCard({ currentUser, toast }) {
  const allUsers  = ls("nv-users", []);
  const allClasses = ls("nv-classes", DEFAULT_CLASSES);
  const me = allUsers.find(u => u.username === currentUser);
  const myClass = allClasses.find(c => c.id === me?.class);
  const cardRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [photoData, setPhotoData] = useState(() => ls("nv-id-photo-" + currentUser, null));
  const fileRef = useRef(null);

  const accentColor = myClass?.color || "#0077b6";
  const displayName = me?.displayName || currentUser.split("@")[0];
  const matric = me?.matricNumber || "—";
  const role = me?.role === "lecturer" ? "Lecturer" : "Student";
  const joined = me?.joined || new Date().getFullYear();

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast("Photo too large — max 2MB", "error"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target.result;
      setPhotoData(data);
      try { localStorage.setItem("nv-id-photo-" + currentUser, data); } catch(e) {}
      // Sync profile photo to Firestore so it appears on all devices
      const _photoKey = _userPrivateKey(currentUser);
      _loadFirebase().then(ready => {
        if (!ready) return;
        _db.collection("nv").doc("user_private")
          .set({ [`${_photoKey}_id-photo`]: data }, { merge: true })
          .catch(e => console.warn("[photo sync] failed:", e.message));
      });
    };
    reader.readAsDataURL(file);
  };

  const downloadCard = async () => {
    setDownloading(true);
    try {
      // Use html2canvas-like approach via canvas
      const card = cardRef.current;
      const w = 420, h = 260;
      const canvas = document.createElement("canvas");
      canvas.width = w * 2; canvas.height = h * 2;
      const ctx = canvas.getContext("2d");
      ctx.scale(2, 2);

      // Background
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, accentColor);
      bg.addColorStop(1, "#0a2540");
      ctx.fillStyle = bg;
      ctx.roundRect(0, 0, w, h, 16);
      ctx.fill();

      // Header strip
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(0, 0, w, 52);

      // School name
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "bold 13px Arial";
      ctx.fillText("🏥 NURSING ACADEMIC HUB", 20, 22);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "10px Arial";
      ctx.fillText("STUDENT IDENTIFICATION CARD", 20, 38);

      // Photo circle
      const photoX = 30, photoY = 70, photoR = 44;
      ctx.save();
      ctx.beginPath();
      ctx.arc(photoX + photoR, photoY + photoR, photoR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fill();
      ctx.clip();
      if (photoData) {
        const img = new Image();
        await new Promise((res) => {
          img.onload = res; img.onerror = res;
          img.src = photoData;
        });
        ctx.drawImage(img, photoX, photoY, photoR * 2, photoR * 2);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = "bold 32px Arial";
        ctx.textAlign = "center";
        ctx.fillText(displayName[0]?.toUpperCase() || "?", photoX + photoR, photoY + photoR + 11);
        ctx.textAlign = "left";
      }
      ctx.restore();

      // Name & details
      ctx.fillStyle = "white";
      ctx.font = "bold 18px Arial";
      ctx.fillText(displayName, 96, 92);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "11px Arial";
      ctx.fillText(role.toUpperCase(), 97, 108);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "12px Arial";
      ctx.fillText("📚 " + (myClass?.label || "No Class"), 97, 128);
      ctx.fillText("🎓 " + matric, 97, 146);
      ctx.fillText("📧 " + currentUser, 97, 164);

      // Bottom bar
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(0, h - 44, w, 44);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "9px Arial";
      ctx.fillText("Enrolled: " + joined + "  |  Valid for current academic session", 20, h - 26);
      ctx.fillText("This card is property of Nursing Academic Hub. If found, please return.", 20, h - 12);

      // Watermark diagonal
      ctx.save();
      ctx.translate(w/2, h/2);
      ctx.rotate(-Math.PI / 6);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.font = "bold 48px Arial";
      ctx.textAlign = "center";
      ctx.fillText("NURSING HUB", 0, 0);
      ctx.restore();

      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `ID_${displayName.replace(/\s+/g, "_")}.png`;
      a.click();
      toast("✅ ID card downloaded!", "success");
    } catch(e) {
      toast("Download failed: " + e.message, "error");
    }
    setDownloading(false);
  };

  return (
    <div>
      <div className="sec-title">🪪 Student ID Card</div>
      <div className="sec-sub" style={{marginBottom:20}}>Your digital nursing student identification card</div>

      {/* The visual card */}
      <div ref={cardRef} style={{
        width:"100%", maxWidth:420, borderRadius:16, overflow:"hidden",
        background:`linear-gradient(135deg, ${accentColor}, #0a2540)`,
        boxShadow:"0 20px 60px rgba(0,0,0,0.35)", margin:"0 auto 20px", position:"relative",
        fontFamily:"'DM Sans',Arial,sans-serif", userSelect:"none",
      }}>
        {/* Top strip */}
        <div style={{background:"rgba(255,255,255,0.08)", padding:"12px 20px", display:"flex", alignItems:"center", gap:10}}>
          <span style={{fontSize:22}}>🏥</span>
          <div>
            <div style={{color:"rgba(255,255,255,.9)", fontWeight:800, fontSize:13, letterSpacing:.5}}>NURSING ACADEMIC HUB</div>
            <div style={{color:"rgba(255,255,255,.5)", fontSize:9, letterSpacing:2}}>STUDENT IDENTIFICATION CARD</div>
          </div>
          <div style={{marginLeft:"auto", textAlign:"right"}}>
            <div style={{background:"rgba(255,255,255,.15)", borderRadius:6, padding:"2px 8px", fontSize:9, color:"rgba(255,255,255,.7)", letterSpacing:1}}>
              {new Date().getFullYear()}/{new Date().getFullYear()+1}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{padding:"18px 20px 14px", display:"flex", gap:16, alignItems:"flex-start"}}>
          {/* Photo */}
          <div
            onClick={()=>fileRef.current?.click()}
            title="Click to change photo"
            style={{
              width:88, height:88, borderRadius:"50%", flexShrink:0, cursor:"pointer",
              background:"rgba(255,255,255,0.15)", border:"3px solid rgba(255,255,255,0.3)",
              display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden",
              position:"relative",
            }}
          >
            {photoData
              ? <img src={photoData} alt="photo" style={{width:"100%",height:"100%",objectFit:"cover"}} />
              : <span style={{fontSize:36, color:"white", fontWeight:700}}>{displayName[0]?.toUpperCase() || "?"}</span>
            }
            <div style={{
              position:"absolute", bottom:0, left:0, right:0, background:"rgba(0,0,0,0.5)",
              color:"white", fontSize:8, textAlign:"center", padding:"3px 0", letterSpacing:.5,
            }}>📷 PHOTO</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto} />

          {/* Info */}
          <div style={{flex:1, color:"white"}}>
            <div style={{fontWeight:800, fontSize:18, lineHeight:1.2, marginBottom:2}}>{displayName}</div>
            <div style={{fontSize:10, color:"rgba(255,255,255,.6)", fontWeight:700, letterSpacing:1, marginBottom:10}}>{role.toUpperCase()}</div>
            {[
              ["📚", myClass?.label || "No Class Assigned"],
              ["🎓", matric],
              ["📧", currentUser],
            ].map(([icon, val]) => (
              <div key={icon} style={{display:"flex", alignItems:"center", gap:6, marginBottom:4}}>
                <span style={{fontSize:12}}>{icon}</span>
                <span style={{fontSize:11, color:"rgba(255,255,255,.85)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{val}</span>
              </div>
            ))}
          </div>

          {/* QR placeholder */}
          <div style={{flexShrink:0, width:60, height:60, background:"white", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", padding:4}}>
            <svg width="52" height="52" viewBox="0 0 52 52">
              {/* Simple QR-like pattern */}
              {[0,1,2,3,4,5,6].map(r=>[0,1,2,3,4,5,6].map(c=>{
                const isCorner = (r<3&&c<3)||(r<3&&c>3)||(r>3&&c<3);
                const val = ((r*7+c)*13+17)%3===0 || isCorner;
                return val ? <rect key={`${r}-${c}`} x={c*7+1} y={r*7+1} width={6} height={6} fill="#0a2540" rx={1}/> : null;
              }))}
              <rect x={1} y={1} width={20} height={20} fill="none" stroke="#0a2540" strokeWidth={2}/>
              <rect x={5} y={5} width={12} height={12} fill="#0a2540"/>
              <rect x={31} y={1} width={20} height={20} fill="none" stroke="#0a2540" strokeWidth={2}/>
              <rect x={35} y={5} width={12} height={12} fill="#0a2540"/>
              <rect x={1} y={31} width={20} height={20} fill="none" stroke="#0a2540" strokeWidth={2}/>
              <rect x={5} y={35} width={12} height={12} fill="#0a2540"/>
            </svg>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{background:"rgba(0,0,0,.25)", padding:"8px 20px"}}>
          <div style={{fontSize:8.5, color:"rgba(255,255,255,.45)", lineHeight:1.7}}>
            Enrolled: {joined} &nbsp;|&nbsp; Valid for current academic session<br/>
            This card is property of Nursing Academic Hub. If found, please return.
          </div>
        </div>

        {/* Watermark */}
        <div style={{
          position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%) rotate(-20deg)",
          fontSize:40, fontWeight:900, color:"rgba(255,255,255,.04)", whiteSpace:"nowrap", pointerEvents:"none",
          userSelect:"none", letterSpacing:4,
        }}>NURSING HUB</div>
      </div>

      {/* Actions */}
      <div style={{display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap"}}>
        <button className="btn btn-accent" onClick={downloadCard} disabled={downloading} style={{minWidth:160}}>
          {downloading ? "⏳ Generating..." : "⬇️ Download ID Card"}
        </button>
        <button className="btn" onClick={()=>fileRef.current?.click()} style={{minWidth:140}}>
          📷 Upload Photo
        </button>
      </div>

      {!me?.matricNumber && (
        <div style={{marginTop:16, padding:"10px 14px", background:"rgba(251,146,60,.08)", border:"1px solid rgba(251,146,60,.25)", borderRadius:10, fontSize:12, color:"var(--warn)", textAlign:"center"}}>
          ⚠️ Your matric number is not set. Go to <b>My Profile → Edit</b> to add it.
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ── PIN / BIOMETRIC LOCK ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
// Storage keys:
//   "nv-pin-{email}"         → hashed 4-digit PIN (SHA-256 hex)
//   "nv-biometric-{email}"   → "enabled" | "" (biometric registered)

export function FlashcardSystem({ currentUser }) {
  const [decks, setDecks] = useState(()=>ls("nv-flashcard-decks",[]) );
  const [activeDeck, setActiveDeck] = useState(null);
  const [studyMode, setStudyMode] = useState(false);
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [newQ, setNewQ] = useState(""); const [newA, setNewA] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const save = (d) => { setDecks(d); saveMyData("flashcards","nv-flashcard-decks", d); };

  const addDeck = () => {
    if (!newDeckName.trim()) return;
    const d = [...decks, {id:Date.now(),name:newDeckName.trim(),cards:[],createdAt:Date.now()}];
    save(d); setNewDeckName("");
  };

  const addCard = () => {
    if (!newQ.trim()||!newA.trim()) return;
    const d = decks.map(dk=>dk.id===activeDeck.id?{...dk,cards:[...dk.cards,{q:newQ.trim(),a:newA.trim(),id:Date.now()}]}:dk);
    save(d); setActiveDeck(d.find(dk=>dk.id===activeDeck.id)); setNewQ(""); setNewA(""); setShowAdd(false);
  };

  const deleteDeck = (id) => { if(!confirm("Delete this deck?"))return; save(decks.filter(d=>d.id!==id)); if(activeDeck?.id===id) setActiveDeck(null); };
  const deleteCard = (cardId) => { const d=decks.map(dk=>dk.id===activeDeck.id?{...dk,cards:dk.cards.filter(c=>c.id!==cardId)}:dk); save(d); setActiveDeck(d.find(dk=>dk.id===activeDeck.id)); };

  if (studyMode && activeDeck) {
    const cards = activeDeck.cards;
    if (cards.length === 0) return <div style={{textAlign:"center",padding:40}}><div style={{fontSize:48}}>📭</div><div style={{marginTop:12,fontWeight:700}}>No cards in this deck</div><button onClick={()=>setStudyMode(false)} style={{marginTop:16,padding:"10px 24px",borderRadius:10,background:"var(--accent)",color:"white",border:"none",cursor:"pointer",fontWeight:700}}>← Back</button></div>;
    const card = cards[cardIdx % cards.length];
    return (
      <div style={{maxWidth:500,margin:"0 auto",paddingBottom:40,textAlign:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
          <button onClick={()=>{setStudyMode(false);setFlipped(false);setCardIdx(0);}} style={{padding:"8px 16px",borderRadius:10,border:"1px solid var(--border)",background:"transparent",cursor:"pointer",fontWeight:700}}>← Back</button>
          <div style={{flex:1,fontWeight:800,fontSize:16}}>{activeDeck.name}</div>
          <div style={{fontSize:13,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{(cardIdx%cards.length)+1}/{cards.length}</div>
        </div>
        <div onClick={()=>setFlipped(f=>!f)} style={{background:"var(--card)",border:`2px solid ${flipped?"var(--accent)":"var(--border)"}`,borderRadius:20,padding:"40px 28px",minHeight:180,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,transition:"border-color .2s",marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--text3)",letterSpacing:2,textTransform:"uppercase"}}>{flipped?"ANSWER":"QUESTION"} — tap to flip</div>
          <div style={{fontSize:18,fontWeight:700,lineHeight:1.5}}>{flipped?card.a:card.q}</div>
        </div>
        <div style={{display:"flex",gap:12,justifyContent:"center"}}>
          <button onClick={()=>{setCardIdx(i=>(i-1+cards.length)%cards.length);setFlipped(false);}} style={{padding:"10px 24px",borderRadius:10,border:"1px solid var(--border)",background:"transparent",cursor:"pointer",fontWeight:700}}>← Prev</button>
          <button onClick={()=>{setCardIdx(i=>Math.floor(Math.random()*cards.length));setFlipped(false);}} style={{padding:"10px 20px",borderRadius:10,border:"1px solid var(--border)",background:"transparent",cursor:"pointer"}}>🔀</button>
          <button onClick={()=>{setCardIdx(i=>(i+1)%cards.length);setFlipped(false);}} style={{padding:"10px 24px",borderRadius:10,background:"var(--accent)",color:"white",border:"none",cursor:"pointer",fontWeight:700}}>Next →</button>
        </div>
      </div>
    );
  }

  if (activeDeck) {
    return (
      <div style={{maxWidth:600,margin:"0 auto",paddingBottom:40}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
          <button onClick={()=>setActiveDeck(null)} style={{padding:"8px 16px",borderRadius:10,border:"1px solid var(--border)",background:"transparent",cursor:"pointer",fontWeight:700}}>← Decks</button>
          <div style={{flex:1,fontWeight:800,fontSize:18}}>{activeDeck.name}</div>
          {activeDeck.cards.length>0&&<button onClick={()=>{setStudyMode(true);setCardIdx(0);setFlipped(false);}} style={{padding:"8px 20px",borderRadius:10,background:"var(--accent)",color:"white",border:"none",cursor:"pointer",fontWeight:700}}>▶️ Study</button>}
        </div>
        <button onClick={()=>setShowAdd(p=>!p)} style={{width:"100%",padding:"12px",borderRadius:12,border:"2px dashed var(--accent)",background:"transparent",color:"var(--accent)",fontWeight:700,cursor:"pointer",marginBottom:16,fontSize:14}}>+ Add Card</button>
        {showAdd&&(
          <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:20,marginBottom:16}}>
            <textarea value={newQ} onChange={e=>setNewQ(e.target.value)} placeholder="Question..." style={{width:"100%",padding:10,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg4)",color:"var(--text)",marginBottom:10,minHeight:70,resize:"vertical",fontFamily:"inherit",fontSize:13,boxSizing:"border-box"}}/>
            <textarea value={newA} onChange={e=>setNewA(e.target.value)} placeholder="Answer..." style={{width:"100%",padding:10,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg4)",color:"var(--text)",marginBottom:10,minHeight:70,resize:"vertical",fontFamily:"inherit",fontSize:13,boxSizing:"border-box"}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={addCard} style={{flex:1,padding:"10px",borderRadius:10,background:"var(--accent)",color:"white",border:"none",cursor:"pointer",fontWeight:700}}>Save Card</button>
              <button onClick={()=>setShowAdd(false)} style={{padding:"10px 16px",borderRadius:10,border:"1px solid var(--border)",background:"transparent",cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        )}
        {activeDeck.cards.length === 0 ? <div style={{textAlign:"center",padding:"40px 20px",color:"var(--text3)"}}><div style={{fontSize:40}}>🃏</div><div style={{marginTop:8,fontWeight:700}}>No cards yet</div><div style={{fontSize:13}}>Add your first card above</div></div>
        : activeDeck.cards.map((c,i)=>(
          <div key={c.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>Q: {c.q}</div>
                <div style={{fontSize:12,color:"var(--text3)"}}>A: {c.a}</div>
              </div>
              <button onClick={()=>deleteCard(c.id)} style={{marginLeft:10,background:"none",border:"none",cursor:"pointer",color:"var(--danger)",fontSize:16,flexShrink:0}}>🗑️</button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{maxWidth:600,margin:"0 auto",paddingBottom:40}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22,marginBottom:4}}>🃏 Flashcards</div>
      <div style={{color:"var(--text3)",fontSize:13,marginBottom:20}}>Create decks and study smarter</div>
      <div style={{display:"flex",gap:10,marginBottom:20}}>
        <input value={newDeckName} onChange={e=>setNewDeckName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addDeck()} placeholder="New deck name e.g. Pharmacology..." style={{flex:1,padding:"10px 14px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg4)",color:"var(--text)",fontSize:13}}/>
        <button onClick={addDeck} style={{padding:"10px 20px",borderRadius:10,background:"var(--accent)",color:"white",border:"none",cursor:"pointer",fontWeight:700}}>+ Create</button>
      </div>
      {decks.length === 0 ? <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}><div style={{fontSize:48,marginBottom:12}}>🃏</div><div style={{fontWeight:700}}>No decks yet</div><div style={{fontSize:13,marginTop:4}}>Create your first flashcard deck above</div></div>
      : <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
          {decks.map(d=>(
            <div key={d.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"18px 16px",cursor:"pointer",transition:"border-color .2s"}} onClick={()=>setActiveDeck(d)} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--accent)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
              <div style={{fontSize:28,marginBottom:8}}>🃏</div>
              <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{d.name}</div>
              <div style={{fontSize:12,color:"var(--text3)"}}>{d.cards.length} card{d.cards.length!==1?"s":""}</div>
              <button onClick={e=>{e.stopPropagation();deleteDeck(d.id);}} style={{marginTop:10,background:"none",border:"none",cursor:"pointer",color:"var(--danger)",fontSize:12}}>🗑️ Delete</button>
            </div>
          ))}
        </div>}
    </div>
  );
}

// ─── ADMIN PAYMENT DASHBOARD ──────────────────────────────────────────

export function LeaderboardStreaks({ currentUser }) {
  const allUsers = ls("nv-users", []);
  const [classes] = useSharedData("nv-classes", DEFAULT_CLASSES);
  const me = allUsers.find(u => u.username === currentUser);
  const myClassId = me?.class || "";
  const [tab, setTab] = useState("leaderboard");

  // Build leaderboard from CBT results stored in localStorage
  const buildLeaderboard = () => {
    const scores = [];
    allUsers.forEach(u => {
      const results = ls("nv-cbt-results-" + u.username, null) || ls("nv-cbt-results", []);
      // Try per-user results first
      try {
        const perUser = localStorage.getItem("nv-cbt-results-" + u.username);
        const parsed = perUser ? JSON.parse(perUser) : null;
        const userResults = parsed || results.filter(r => r.student === u.username);
        if (userResults.length === 0) return;
        const avg = Math.round(userResults.reduce((s,r) => s + (r.pct||r.score||0), 0) / userResults.length);
        scores.push({ user: u.username, name: u.displayName||u.username.split("@")[0], avatar: u.avatar||(u.displayName||u.username)[0]?.toUpperCase()||"?", avg, count: userResults.length, classId: u.class });
      } catch(e) {}
    });
    return scores.sort((a,b) => b.avg - a.avg);
  };

  // Streak: consecutive days with study timer activity
  const getStreak = () => {
    try {
      const logs = ls("nv-study-logs-" + currentUser, []);
      if (!logs.length) return 0;
      const days = [...new Set(logs.map(l => new Date(l.ts).toISOString().slice(0,10)))].sort().reverse();
      let streak = 0;
      const today = new Date().toISOString().slice(0,10);
      let check = today;
      for (const day of days) {
        if (day === check) { streak++; const d=new Date(check); d.setDate(d.getDate()-1); check=d.toISOString().slice(0,10); }
        else break;
      }
      return streak;
    } catch(e) { return 0; }
  };

  const leaderboard = buildLeaderboard();
  const myRank = leaderboard.findIndex(x=>x.user===currentUser) + 1;
  const streak = getStreak();
  const myEntry = leaderboard.find(x=>x.user===currentUser);
  const studyLogs = ls("nv-study-logs-" + currentUser, []);
  const totalStudyMins = Math.round(studyLogs.reduce((s,l)=>s+(l.mins||0),0));
  const totalExams = ls("nv-cbt-results", []).filter(r=>r.student===currentUser).length;

  const medals = ["🥇","🥈","🥉"];

  return (
    <div style={{maxWidth:600,margin:"0 auto"}}>
      <div style={{display:"flex",gap:6,marginBottom:20,background:"var(--bg4)",borderRadius:12,padding:4}}>
        {["leaderboard","streaks"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"9px",borderRadius:9,border:"none",cursor:"pointer",fontWeight:700,fontSize:13,background:tab===t?"var(--card)":"transparent",color:tab===t?"var(--accent)":"var(--text3)",boxShadow:tab===t?"0 2px 8px rgba(0,0,0,.1)":"none",transition:"all .2s",textTransform:"capitalize"}}>
            {t==="leaderboard"?"🏆 Leaderboard":"🔥 Streaks & Stats"}
          </button>
        ))}
      </div>

      {tab==="leaderboard" && (
        <div>
          {myRank > 0 && (
            <div style={{background:"linear-gradient(135deg,var(--accent),var(--accent2))",borderRadius:16,padding:"18px 20px",marginBottom:20,color:"#fff",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:13,opacity:.8}}>Your Ranking</div><div style={{fontSize:32,fontWeight:800}}>#{myRank}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:13,opacity:.8}}>Avg Score</div><div style={{fontSize:32,fontWeight:800}}>{myEntry?.avg||0}%</div></div>
            </div>
          )}
          {leaderboard.length===0 && <div style={{textAlign:"center",padding:60,color:"var(--text3)"}}><div style={{fontSize:48,marginBottom:12}}>🏆</div><div style={{fontWeight:700}}>No scores yet</div><div style={{fontSize:13,marginTop:4}}>Take CBT exams to appear on the leaderboard</div></div>}
          {leaderboard.slice(0,20).map((entry,i) => {
            const isMe = entry.user === currentUser;
            return (
              <div key={entry.user} className="lb-row" style={{border:isMe?"1.5px solid var(--accent)":"1px solid var(--border)",background:isMe?"rgba(0,119,182,.05)":"var(--card)"}}>
                <div className="lb-rank" style={{background:i<3?"linear-gradient(135deg,#f59e0b,#d97706)":"var(--bg3)",color:i<3?"#fff":"var(--text3)",fontSize:i<3?20:14}}>
                  {i<3?medals[i]:i+1}
                </div>
                <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,color:"#fff",fontSize:15,flexShrink:0}}>
                  {entry.avatar}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:14}}>{entry.name}{isMe&&<span style={{fontSize:10,color:"var(--accent)",marginLeft:6}}>• You</span>}</div>
                  <div style={{fontSize:11,color:"var(--text3)"}}>{entry.count} exam{entry.count!==1?"s":""} taken</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontWeight:800,fontSize:18,color:entry.avg>=70?"var(--success)":entry.avg>=50?"var(--warn)":"var(--danger)"}}>{entry.avg}%</div>
                  <div style={{fontSize:10,color:"var(--text3)"}}>avg score</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab==="streaks" && (
        <div>
          <div style={{background:"var(--card)",border:"1.5px solid var(--border)",borderRadius:18,padding:28,textAlign:"center",marginBottom:16}}>
            <div className="streak-flame">{streak>0?"🔥":"💤"}</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:52,marginTop:4,color:streak>=7?"var(--warn)":"var(--text)"}}>{streak}</div>
            <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>Day Streak</div>
            <div style={{fontSize:13,color:"var(--text3)"}}>{streak===0?"Start studying today to begin your streak!":streak<3?"Keep going — you're building momentum!":streak<7?"Great consistency! Keep it up!":"🌟 You're on fire! Amazing dedication!"}</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
            {[
              {icon:"⏱️",label:"Total Study Time",val:`${totalStudyMins} min`},
              {icon:"📝",label:"Exams Taken",val:totalExams},
              {icon:"📅",label:"Days Active",val:new Set(studyLogs.map(l=>new Date(l.ts).toISOString().slice(0,10))).size},
              {icon:"🎯",label:"Best Score",val:(()=>{const r=ls("nv-cbt-results",[]).filter(x=>x.student===currentUser);return r.length?Math.max(...r.map(x=>x.pct||x.score||0))+"%":"—"})()},
            ].map(s=>(
              <div key={s.label} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px",textAlign:"center"}}>
                <div style={{fontSize:24,marginBottom:4}}>{s.icon}</div>
                <div style={{fontWeight:800,fontSize:20}}>{s.val}</div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:16}}>
            <div style={{fontWeight:700,marginBottom:10,fontSize:13}}>📅 Last 14 Days</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
              {Array.from({length:14},(_,i)=>{
                const d=new Date(); d.setDate(d.getDate()-(13-i));
                const dateStr=d.toISOString().slice(0,10);
                const active=studyLogs.some(l=>new Date(l.ts).toISOString().slice(0,10)===dateStr);
                return (
                  <div key={dateStr} title={dateStr} style={{aspectRatio:"1",borderRadius:6,background:active?"var(--accent)":"var(--bg3)",opacity:active?1:0.3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:active?"#fff":"var(--text3)"}} >
                    {d.getDate()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// STUDENT PROGRESS DASHBOARD
// ════════════════════════════════════════════════════════════════════

export function ProgressDashboard({ currentUser }) {
  const allUsers = ls("nv-users", []);
  const me = allUsers.find(u => u.username === currentUser);
  const [classes] = useSharedData("nv-classes", DEFAULT_CLASSES);
  const myClass = classes.find(c => c.id === me?.class);

  const cbtResults = ls("nv-cbt-results", []).filter(r => r.student === currentUser);
  const gpaResults = ls("nv-results", []);
  const studyLogs  = ls("nv-study-logs-" + currentUser, []);
  const flashDecks = ls("nv-flashcard-decks", []);

  const avgScore = cbtResults.length ? Math.round(cbtResults.reduce((s,r)=>s+(r.pct||r.score||0),0)/cbtResults.length) : 0;
  const totalStudyMins = Math.round(studyLogs.reduce((s,l)=>s+(l.mins||0),0));
  const totalCards = flashDecks.reduce((s,d)=>s+d.cards.length,0);

  // GPA trend
  const gpa = (() => {
    const courses = ls("nv-gpa-courses", []);
    if (!courses.length) return null;
    const total = courses.reduce((s,c)=>s+(c.grade*c.units),0);
    const units = courses.reduce((s,c)=>s+c.units,0);
    return units ? (total/units).toFixed(2) : null;
  })();

  // Score trend (last 10 exams)
  const scoreTrend = cbtResults.slice(-10).map((r,i) => ({ n:i+1, score: r.pct||r.score||0 }));

  // Ring component
  const Ring = ({pct,color,size=80,label}) => {
    const r = (size/2)-8; const circ = 2*Math.PI*r;
    const fill = (pct/100)*circ;
    return (
      <div className="prog-ring-wrap" style={{width:size,height:size}}>
        <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg3)" strokeWidth={7} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={7} strokeDasharray={circ} strokeDashoffset={circ-fill} strokeLinecap="round" style={{transition:"stroke-dashoffset .8s"}} />
        </svg>
        <div style={{position:"absolute",textAlign:"center"}}>
          <div style={{fontWeight:800,fontSize:size>70?16:13,color}}>{pct}%</div>
          {label&&<div style={{fontSize:9,color:"var(--text3)",marginTop:1}}>{label}</div>}
        </div>
      </div>
    );
  };

  const MiniBar = ({score}) => (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <div style={{flex:1,background:"var(--bg3)",borderRadius:4,height:6,overflow:"hidden"}}>
        <div style={{width:`${score}%`,height:"100%",borderRadius:4,background:score>=70?"var(--success)":score>=50?"var(--warn)":"var(--danger)",transition:"width .5s"}} />
      </div>
      <span style={{fontSize:11,fontWeight:700,color:"var(--text3)",minWidth:28}}>{score}%</span>
    </div>
  );

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22,marginBottom:4}}>📈 My Progress</div>
      <div style={{color:"var(--text3)",fontSize:13,marginBottom:20}}>A complete view of your academic journey</div>

      {/* Top KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,marginBottom:20}}>
        {[
          {icon:"📝",label:"Exams Taken",val:cbtResults.length,color:"var(--accent)"},
          {icon:"🎯",label:"Avg Score",val:avgScore+"%",color:avgScore>=70?"var(--success)":avgScore>=50?"var(--warn)":"var(--danger)"},
          {icon:"⏱️",label:"Study Time",val:totalStudyMins+"m",color:"var(--accent2)"},
          {icon:"🃏",label:"Flashcards",val:totalCards,color:"var(--purple)"},
          ...(gpa?[{icon:"🎓",label:"GPA",val:gpa,color:"#f59e0b"}]:[]),
        ].map(s=>(
          <div key={s.label} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px 14px",textAlign:"center"}}>
            <div style={{fontSize:24,marginBottom:6}}>{s.icon}</div>
            <div style={{fontWeight:800,fontSize:22,color:s.color}}>{s.val}</div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Score gauge */}
      {cbtResults.length > 0 && (
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:16,padding:20,marginBottom:16,display:"flex",alignItems:"center",gap:24,flexWrap:"wrap"}}>
          <Ring pct={avgScore} color={avgScore>=70?"var(--success)":avgScore>=50?"var(--warn)":"var(--danger)"} size={96} label="Avg" />
          <div style={{flex:1,minWidth:180}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:4}}>Exam Performance</div>
            <div style={{fontSize:13,color:"var(--text3)",marginBottom:10}}>{cbtResults.length} exam{cbtResults.length!==1?"s":""} completed</div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              {[["Best",Math.max(...cbtResults.map(r=>r.pct||0))+"%" ],["Worst",Math.min(...cbtResults.map(r=>r.pct||0))+"%"],["Latest",(cbtResults[cbtResults.length-1]?.pct||0)+"%"]].map(([l,v])=>(
                <div key={l}><div style={{fontSize:10,color:"var(--text3)"}}>{l}</div><div style={{fontWeight:800,fontSize:16}}>{v}</div></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Score trend */}
      {scoreTrend.length > 1 && (
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:16,padding:20,marginBottom:16}}>
          <div style={{fontWeight:800,marginBottom:12}}>📊 Score Trend (last {scoreTrend.length} exams)</div>
          {scoreTrend.map((r,i)=>(
            <div key={i} style={{marginBottom:6}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:11,color:"var(--text3)"}}>Exam #{r.n}</span>
              </div>
              <MiniBar score={r.score} />
            </div>
          ))}
        </div>
      )}

      {/* Recent results */}
      {gpaResults.length > 0 && (
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:16,padding:20,marginBottom:16}}>
          <div style={{fontWeight:800,marginBottom:12}}>📋 Test Results</div>
          {gpaResults.slice(-5).reverse().map((r,i)=>(
            <div key={r.id||i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
              <div>
                <div style={{fontWeight:700,fontSize:13}}>{r.subject}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>{r.type||"Test"} {r.date?`• ${r.date}`:""}</div>
              </div>
              <div style={{fontWeight:800,fontSize:16,color:r.pct>=70?"var(--success)":r.pct>=50?"var(--warn)":"var(--danger)"}}>{r.score}/{r.total||100}</div>
            </div>
          ))}
        </div>
      )}

      {cbtResults.length===0&&gpaResults.length===0&&<div style={{textAlign:"center",padding:60,color:"var(--text3)"}}><div style={{fontSize:48,marginBottom:12}}>📈</div><div style={{fontWeight:700}}>No data yet</div><div style={{fontSize:13,marginTop:4}}>Take CBT exams and log results to see your progress here</div></div>}
    </div>
  );
}



// ════════════════════════════════════════════════════════════════════
// LECTURER CONTROL PANEL
// ════════════════════════════════════════════════════════════════════
