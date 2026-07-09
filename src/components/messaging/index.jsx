import { useState, useEffect, useRef, Fragment } from "react";
import { DEFAULT_CLASSES } from "../../data/defaults";
import { _convId, _safeKey, dmMarkRead, dmSend, dmSubscribeConv, dmSubscribeInbox, gcSend, gcSubscribe, gcSubscribeRooms, gcTestWrite, saveMyData, useSharedData } from "../../services/backend";
import { showNotif } from "../../utils/notifications";
import { ls } from "../../utils/storage";
import { DmCallModal, GroupVideoCallBtn } from "../../components/video-call";

export function Messages({ user, toast, onUnreadChange }) {
  const allUsers  = ls("nv-users", []);
  const allClasses = ls("nv-classes", DEFAULT_CLASSES);
  const me = allUsers.find(u => u.username === user);
  const myClassId = me?.class || "";
  const isLecturerUser = me?.role === "lecturer" || me?.role === "admin";

  // Class-restricted: only show students in the same class (for students)
  // Lecturers: can message any student, filtered by selected class
  const classmates = allUsers.filter(u =>
    u.username !== user &&
    u.role !== "admin" &&
    u.role !== "lecturer" &&
    u.class === myClassId &&
    myClassId !== ""
  );

  // For lecturers: all non-admin, non-lecturer users, grouped by class
  const allStudents = allUsers.filter(u => u.username !== user && u.role !== "admin" && u.role !== "lecturer");

  // State
  const [convs,       setConvs]       = useState([]);
  const [activeUser,  setActiveUser]  = useState(null);
  const [msgs,        setMsgs]        = useState([]);
  const [input,       setInput]       = useState("");
  const [sending,     setSending]     = useState(false);
  const [search,      setSearch]      = useState("");
  const [dropOpen,    setDropOpen]    = useState(false);
  const [notifPerm,   setNotifPerm]   = useState(() =>
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  // Tab + class selection state
  const [broadcastTab,   setBroadcastTab]   = useState("direct"); // "direct" | "group"
  const [broadcastClass, setBroadcastClass] = useState("");
  const [lecturerFilter, setLecturerFilter] = useState(""); // filter students by class for direct msg
  // Group chat state
  const [gcRooms,        setGcRooms]        = useState([]); // room metadata list for sidebar
  const [gcMsgs,         setGcMsgs]         = useState([]);
  const [gcInput,        setGcInput]        = useState("");
  const [gcSending,      setGcSending]      = useState(false);
  const [gcRecording,    setGcRecording]    = useState(false);
  const [gcRecSeconds,   setGcRecSeconds]   = useState(0);
  const gcMediaRecRef    = useRef(null);
  const gcRecTimerRef    = useRef(null);
  const gcRecChunksRef   = useRef([]);
  const gcFileInputRef   = useRef(null);
  const gcBottomRef      = useRef(null);
  const gcInputRef       = useRef(null);
  // Voice call state
  // DM voice/video call state
  const [dmCall, setDmCall] = useState(null); // null | { type:"voice"|"video", toUser, toName, toAvatar }

  // Voice note recording
  const [recording,   setRecording]   = useState(false);
  const [recSeconds,  setRecSeconds]  = useState(0);
  const mediaRecRef  = useRef(null);
  const recTimerRef  = useRef(null);
  const recChunksRef = useRef([]);
  // File input
  const fileInputRef = useRef(null);
  const bottomRef    = useRef(null);
  const inputRef     = useRef(null);
  const dropRef      = useRef(null);

  // ── Notification permission ───────────────────────────────────────
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().then(p => setNotifPerm(p));
    }
  }, []);

  // ── Close dropdown on outside click ──────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Subscribe to inbox ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let unsub = () => {};
    const t = setTimeout(() => {
      unsub = dmSubscribeInbox(user, incoming => {
        setConvs(incoming);
        const unread = incoming.filter(c => c["unread_" + _safeKey(user)]).length;
        if (onUnreadChange) onUnreadChange(unread);
      });
    }, 800);
    return () => { clearTimeout(t); unsub(); };
  }, [user]);

  // ── Subscribe to active conversation ─────────────────────────────
  useEffect(() => {
    if (!activeUser) return;
    let prevCount = 0;
    const unsub = dmSubscribeConv(user, activeUser, incoming => {
      if (incoming.length > prevCount) {
        const newMsgs = incoming.slice(prevCount);
        newMsgs.forEach(m => {
          if (m.from !== user && notifPerm === "granted") {
            const name = allUsers.find(u2 => u2.username === m.from)?.displayName || m.from.split("@")[0];
            const body = m.type === "voice" ? "🎤 Voice note" : m.type === "file" ? "📎 " + m.fileName : m.text;
            showNotif("💬 " + name, { body, tag: m.id });
          }
        });
      }
      prevCount = incoming.length;
      setMsgs(incoming);
      dmMarkRead(user, activeUser);
      setConvs(cs => cs.map(c => c.id === _convId(user, activeUser) ? { ...c, ["unread_" + _safeKey(user)]: false } : c));
    });
    return () => unsub();
  }, [activeUser, user]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  useEffect(() => { if (activeUser) setTimeout(() => inputRef.current?.focus(), 100); }, [activeUser]);

  // ── Subscribe to active group chat ───────────────────────────────
  useEffect(() => {
    const activeClassId = isLecturerUser ? broadcastClass : myClassId;
    if (!activeClassId || broadcastTab !== "group") return;
    const unsub = gcSubscribe(activeClassId, incoming => {
      setGcMsgs(incoming);
    });
    return () => unsub();
  }, [broadcastClass, broadcastTab, myClassId, isLecturerUser]);

  useEffect(() => { gcBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [gcMsgs]);
  useEffect(() => {
    if (!isLecturerUser || !allClasses.length) return;
    const classIds = allClasses.map(c => c.id);
    const unsub = gcSubscribeRooms(classIds, rooms => setGcRooms(rooms));
    return () => unsub();
  }, [isLecturerUser, allClasses.length]);
  useEffect(() => { if (broadcastTab === "group" && broadcastClass) setTimeout(() => gcInputRef.current?.focus(), 100); }, [broadcastTab, broadcastClass]);

  // ── Send text ─────────────────────────────────────────────────────
  const sendText = async () => {
    const text = input.trim();
    if (!text || !activeUser || sending) return;
    setSending(true);
    setInput("");
    const tempId = "tmp_" + Date.now();
    setMsgs(m => [...m, { id: tempId, from: user, to: activeUser, text, type: "text", sentAt: Date.now(), read: false }]);
    const ok = await dmSend(user, activeUser, { type: "text", text });
    if (!ok) { toast("⚠️ Send failed", "error"); setMsgs(m => m.filter(x => x.id !== tempId)); setInput(text); }
    setSending(false);
  };

  // ── Send file ─────────────────────────────────────────────────────
  const sendFile = async (file) => {
    if (!file || !activeUser) return;
    const MAX = 2 * 1024 * 1024; // 2 MB limit (Firestore doc limit)
    if (file.size > MAX) { toast("File too large — max 2 MB", "error"); return; }
    setSending(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const fileData = e.target.result; // base64 data URL
      const tempId = "tmp_" + Date.now();
      setMsgs(m => [...m, { id: tempId, from: user, to: activeUser, type: "file", fileName: file.name, fileType: file.type, fileSize: file.size, fileData, sentAt: Date.now(), read: false }]);
      const ok = await dmSend(user, activeUser, { type: "file", text: "", fileName: file.name, fileType: file.type, fileSize: file.size, fileData });
      if (!ok) { toast("⚠️ File send failed", "error"); setMsgs(m => m.filter(x => x.id !== tempId)); }
      setSending(false);
    };
    reader.readAsDataURL(file);
  };

  // ── Voice recording ───────────────────────────────────────────────
  const startRecording = async () => {
    if (!activeUser) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg" });
      mr.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recChunksRef.current, { type: mr.mimeType });
        if (blob.size > 2 * 1024 * 1024) { toast("Voice note too long — max ~2 minutes", "error"); return; }
        const reader = new FileReader();
        reader.onload = async (e) => {
          const dur = recSeconds;
          const tempId = "tmp_" + Date.now();
          setMsgs(m => [...m, { id: tempId, from: user, to: activeUser, type: "voice", fileData: e.target.result, fileType: mr.mimeType, duration: dur, sentAt: Date.now(), read: false }]);
          const ok = await dmSend(user, activeUser, { type: "voice", text: "", fileData: e.target.result, fileType: mr.mimeType, duration: dur });
          if (!ok) { toast("⚠️ Voice note send failed", "error"); setMsgs(m => m.filter(x => x.id !== tempId)); }
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      mediaRecRef.current = mr;
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch(e) { toast("Microphone access denied", "error"); }
  };

  const stopRecording = () => {
    if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
      mediaRecRef.current.stop();
    }
    clearInterval(recTimerRef.current);
    setRecording(false);
    setRecSeconds(0);
  };

  const cancelRecording = () => {
    if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
      mediaRecRef.current.stream?.getTracks().forEach(t => t.stop());
      mediaRecRef.current.ondataavailable = null;
      mediaRecRef.current.onstop = null;
      mediaRecRef.current.stop();
    }
    clearInterval(recTimerRef.current);
    recChunksRef.current = [];
    setRecording(false);
    setRecSeconds(0);
  };

  const formatDur = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

  // ── Group chat: send text ──────────────────────────────────────────
  const gcSendText = async () => {
    const text = gcInput.trim();
    const activeClassId = isLecturerUser ? broadcastClass : myClassId;
    if (!activeClassId) { toast("Select a class first", "error"); return; }
    if (!text || gcSending) return;
    setGcSending(true);
    setGcInput("");
    const tempId = "tmp_" + Date.now();
    setGcMsgs(m => [...m, { id: tempId, from: user, text, type: "text", sentAt: Date.now() }]);
    try {
      await gcSend(activeClassId, user, { type: "text", text });
    } catch(e) {
      toast("⚠️ " + (e.message || "Message failed to send"), "error");
      setGcMsgs(m => m.filter(x => x.id !== tempId));
      setGcInput(text);
    } finally {
      setGcSending(false);
    }
  };

  // ── Group chat: send file ──────────────────────────────────────────
  const gcSendFile = async (file) => {
    const activeClassId = isLecturerUser ? broadcastClass : myClassId;
    if (!file || !activeClassId) return;
    const MAX = 2 * 1024 * 1024;
    if (file.size > MAX) { toast("File too large — max 2 MB", "error"); return; }
    setGcSending(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const fileData = e.target.result;
      const tempId = "tmp_" + Date.now();
      setGcMsgs(m => [...m, { id: tempId, from: user, type: "file", fileName: file.name, fileType: file.type, fileSize: file.size, fileData, sentAt: Date.now() }]);
      try {
        await gcSend(activeClassId, user, { type: "file", text: "", fileName: file.name, fileType: file.type, fileSize: file.size, fileData });
      } catch(e) {
        toast("⚠️ " + (e.message || "File send failed"), "error");
        setGcMsgs(m => m.filter(x => x.id !== tempId));
      } finally {
        setGcSending(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // ── Group chat: voice recording ───────────────────────────────────
  const gcStartRecording = async () => {
    const activeClassId = isLecturerUser ? broadcastClass : myClassId;
    if (!activeClassId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      gcRecChunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg" });
      mr.ondataavailable = e => { if (e.data.size > 0) gcRecChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(gcRecChunksRef.current, { type: mr.mimeType });
        if (blob.size > 2 * 1024 * 1024) { toast("Voice note too long — max ~2 minutes", "error"); return; }
        const reader = new FileReader();
        reader.onload = async (e) => {
          const dur = gcRecSeconds;
          const tempId = "tmp_" + Date.now();
          const activeClassId = isLecturerUser ? broadcastClass : myClassId;
          setGcMsgs(m => [...m, { id: tempId, from: user, type: "voice", fileData: e.target.result, fileType: mr.mimeType, duration: dur, sentAt: Date.now() }]);
          const ok = await gcSend(activeClassId, user, { type: "voice", text: "", fileData: e.target.result, fileType: mr.mimeType, duration: dur });
          if (!ok) { toast("⚠️ Voice note send failed", "error"); setGcMsgs(m => m.filter(x => x.id !== tempId)); }
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      gcMediaRecRef.current = mr;
      setGcRecording(true);
      setGcRecSeconds(0);
      gcRecTimerRef.current = setInterval(() => setGcRecSeconds(s => s + 1), 1000);
    } catch(e) { toast("Microphone access denied", "error"); }
  };

  const gcStopRecording = () => {
    if (gcMediaRecRef.current && gcMediaRecRef.current.state !== "inactive") gcMediaRecRef.current.stop();
    clearInterval(gcRecTimerRef.current);
    setGcRecording(false);
    setGcRecSeconds(0);
  };

  const gcCancelRecording = () => {
    if (gcMediaRecRef.current && gcMediaRecRef.current.state !== "inactive") {
      gcMediaRecRef.current.stream?.getTracks().forEach(t => t.stop());
      gcMediaRecRef.current.ondataavailable = null;
      gcMediaRecRef.current.onstop = null;
      gcMediaRecRef.current.stop();
    }
    clearInterval(gcRecTimerRef.current);
    gcRecChunksRef.current = [];
    setGcRecording(false);
    setGcRecSeconds(0);
  };
  const formatTime = (ts) => {
    if (!ts) return "";
    const d = new Date(ts), now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })
      : d.toLocaleDateString([], { month:"short", day:"numeric" });
  };
  const displayName = (email) => { const u = allUsers.find(x => x.username === email); return u?.displayName || email.split("@")[0]; };
  const avatarChar  = (email) => { const u = allUsers.find(x => x.username === email); return u?.avatar || displayName(email)[0]?.toUpperCase() || "?"; };
  const hasUnread   = (username) => { const c = convs.find(x => x.id === _convId(user, username)); return c && c["unread_" + _safeKey(user)]; };

  const openConv = (username) => { setActiveUser(username); setMsgs([]); setDropOpen(false); };

  // ── Helpers ────────────────────────────────────────────────────────
  const lecturerPeople = allStudents.filter(u => {
    if (lecturerFilter && u.class !== lecturerFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.username.toLowerCase().includes(q) || (u.displayName||"").toLowerCase().includes(q);
  }).sort((a, b) => {
    const ca = convs.find(c => c.participants?.includes(a.username));
    const cb = convs.find(c => c.participants?.includes(b.username));
    return (cb?.lastAt||0) - (ca?.lastAt||0);
  });

  const filteredPeople = isLecturerUser ? lecturerPeople : classmates.filter(u => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.username.toLowerCase().includes(q) || (u.displayName||"").toLowerCase().includes(q);
  }).sort((a, b) => {
    const ca = convs.find(c => c.participants?.includes(a.username));
    const cb = convs.find(c => c.participants?.includes(b.username));
    return (cb?.lastAt||0) - (ca?.lastAt||0);
  });

  const formatFileSize = (bytes) => {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + " KB";
    return (bytes/(1024*1024)).toFixed(1) + " MB";
  };

  const isImage = (type) => type && type.startsWith("image/");
  const isPdf   = (type) => type === "application/pdf";

  // ── Message bubble renderer ────────────────────────────────────────
  const renderMsgContent = (m) => {
    const mine = m.from === user;
    const bubbleColor = mine ? "linear-gradient(135deg,var(--accent),var(--accent2))" : "var(--card2)";
    const textColor   = mine ? "white" : "var(--text)";

    if (m.type === "voice") {
      return (
        <div style={{ background: bubbleColor, borderRadius: mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding:"10px 14px", minWidth:200, display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:"50%", background: mine ? "rgba(255,255,255,.2)" : "rgba(0,119,182,.12)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <span style={{ fontSize:18 }}>🎤</span>
          </div>
          <div style={{ flex:1 }}>
            <audio controls src={m.fileData} style={{ width:"100%", height:32, minWidth:140 }} />
            <div style={{ fontSize:10, color: mine ? "rgba(255,255,255,.75)" : "var(--text3)", marginTop:3 }}>
              {m.duration ? formatDur(m.duration) : "Voice note"}
            </div>
          </div>
        </div>
      );
    }

    if (m.type === "file") {
      if (isImage(m.fileType)) {
        return (
          <div style={{ borderRadius: mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px", overflow:"hidden", maxWidth:260, background: bubbleColor }}>
            <img src={m.fileData} alt={m.fileName} style={{ width:"100%", display:"block", maxHeight:240, objectFit:"cover" }} />
            <div style={{ padding:"6px 10px 8px", fontSize:11, color: textColor, opacity:.85 }}>{m.fileName}</div>
          </div>
        );
      }
      return (
        <div style={{ background: bubbleColor, borderRadius: mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding:"10px 14px", display:"flex", alignItems:"center", gap:10, minWidth:180 }}>
          <div style={{ width:36, height:36, borderRadius:9, background: mine ? "rgba(255,255,255,.2)" : "rgba(0,119,182,.12)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:20 }}>
            {isPdf(m.fileType) ? "📄" : "📎"}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:13, color: textColor, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.fileName}</div>
            <div style={{ fontSize:11, color: mine ? "rgba(255,255,255,.7)" : "var(--text3)" }}>{formatFileSize(m.fileSize)}</div>
          </div>
          <a href={m.fileData} download={m.fileName} style={{ color: mine ? "white" : "var(--accent)", fontSize:20, textDecoration:"none", flexShrink:0 }} title="Download">⬇</a>
        </div>
      );
    }

    // Text
    return (
      <div style={{ background: bubbleColor, borderRadius: mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding:"9px 14px", fontSize:14, color: textColor, boxShadow:"0 1px 4px rgba(0,0,0,.08)", wordBreak:"break-word", opacity: m.id?.startsWith("tmp_") ? 0.6 : 1 }}>
        {m.text}
      </div>
    );
  };

  // ── No class assigned guard (students only — lecturers bypass) ──────
  if (!myClassId && !isLecturerUser) {
    return (
      <div>
        <div className="sec-title">💬 Messages</div>
        <div style={{ textAlign:"center", padding:"60px 20px", color:"var(--text3)" }}>
          <div style={{ fontSize:52, marginBottom:14 }}>🏫</div>
          <div style={{ fontWeight:800, fontSize:16, color:"var(--text)", marginBottom:8 }}>No Class Assigned</div>
          <div style={{ fontSize:13 }}>You need to be assigned to a class to send messages. Contact your admin.</div>
        </div>
      </div>
    );
  }

  const myClass = allClasses.find(c => c.id === myClassId);

  return (
    <Fragment>
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100dvh - 110px)", minHeight:500 }}>

      {/* ── Header bar ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10, flexWrap:"wrap", gap:8 }}>
        <div>
          <div className="sec-title" style={{ marginBottom:2 }}>💬 Messages</div>
          <div className="sec-sub">
            {isLecturerUser ? "Message students across all classes" : myClass ? `🏫 ${myClass.label}` : "Private class chat"}
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ display:"flex", borderRadius:20, overflow:"hidden", border:"1.5px solid var(--border)", background:"var(--bg4)" }}>
            {[{v:"direct",l:"💬 Direct"},{v:"group",l:"🏫 Group Chat"}].map(t=>(
              <button key={t.v} onClick={()=>setBroadcastTab(t.v)} style={{ padding:"6px 14px", border:"none", background:broadcastTab===t.v?"var(--accent)":"transparent", color:broadcastTab===t.v?"#fff":"var(--text3)", fontWeight:700, fontSize:12, cursor:"pointer", transition:"all .15s" }}>{t.l}</button>
            ))}
          </div>
          {notifPerm === "granted"
            ? <span style={{ fontSize:11, color:"var(--success)", fontWeight:700 }}>🔔 On</span>
            : <button className="btn btn-sm" style={{ fontSize:11, borderColor:"var(--accent)", color:"var(--accent)" }}
                onClick={() => Notification.requestPermission().then(p => setNotifPerm(p))}>
                🔔 Enable notifications
              </button>
          }
        </div>
      </div>

      {/* ── GROUP CHAT PANEL ── */}
      {broadcastTab === "group" && (
        <div style={{ display:"flex", flex:1, borderRadius:14, overflow:"hidden", border:"1.5px solid var(--border)", background:"var(--card)", minHeight:0 }}>

          {/* ── LECTURER: sidebar + chat ── */}
          {isLecturerUser ? (
            <>
              {/* Sidebar: list of class group chats */}
              <div style={{ width:220, flexShrink:0, borderRight:"1.5px solid var(--border)", display:"flex", flexDirection:"column", background:"var(--bg4)" }}>
                <div style={{ padding:"12px 14px 8px", fontWeight:800, fontSize:13, color:"var(--text3)", borderBottom:"1px solid var(--border)", letterSpacing:.4, textTransform:"uppercase" }}>Class Chats</div>
                <div style={{ flex:1, overflowY:"auto" }}>
                  {allClasses.map(c => {
                    const room    = gcRooms.find(r => r.id === c.id);
                    const count   = allStudents.filter(u => u.class === c.id).length;
                    const isAct   = broadcastClass === c.id;
                    return (
                      <div
                        key={c.id}
                        onClick={() => {
  setBroadcastClass(c.id); setGcMsgs([]); setGcSending(false); setGcInput("");
  gcTestWrite(c.id).then(err => {
    if (err) toast("❌ Cannot send to this group: " + err, "error");
  });
}}
                        style={{ padding:"11px 14px", cursor:"pointer", borderLeft:`3px solid ${isAct?"var(--accent)":"transparent"}`, background:isAct?"rgba(0,119,182,.07)":"transparent", transition:"background .12s" }}
                        onMouseEnter={e=>{ if(!isAct) e.currentTarget.style.background="var(--bg3)"; }}
                        onMouseLeave={e=>{ if(!isAct) e.currentTarget.style.background="transparent"; }}
                      >
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,var(--accent),var(--accent2))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}>🏫</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontWeight:700, fontSize:12, color:isAct?"var(--accent)":"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.label}</div>
                            <div style={{ fontSize:10, color:"var(--text3)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {room?.lastMsg ? room.lastMsg : `${count} student${count!==1?"s":""}`}
                            </div>
                          </div>
                          {room?.lastAt ? <div style={{ fontSize:9, color:"var(--text3)", flexShrink:0 }}>{(() => { const d=new Date(room.lastAt),n=new Date(); return d.toDateString()===n.toDateString()?d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):d.toLocaleDateString([],{month:"short",day:"numeric"}); })()}</div> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Chat panel */}
              <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0 }}>
                {!broadcastClass ? (
                  <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"var(--text3)", padding:32, textAlign:"center" }}>
                    <div style={{ fontSize:56, marginBottom:16 }}>🏫</div>
                    <div style={{ fontWeight:800, fontSize:16, color:"var(--text)", marginBottom:8 }}>Select a class chat</div>
                    <div style={{ fontSize:13, maxWidth:280, lineHeight:1.7 }}>Pick a class from the sidebar to open the group chat. All students in that class can see your messages in real time.</div>
                  </div>
                ) : (
                  <>
                    {/* Header */}
                    <div style={{ padding:"10px 16px", borderBottom:"1.5px solid var(--border)", background:"var(--bg4)", display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ width:32, height:32, borderRadius:9, background:"linear-gradient(135deg,var(--accent),var(--accent2))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>🏫</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:800, fontSize:14, color:"var(--text)" }}>{allClasses.find(c=>c.id===broadcastClass)?.label}</div>
                        <div style={{ fontSize:11, color:"var(--text3)" }}>👥 {allStudents.filter(u=>u.class===broadcastClass).length} students • Group chat</div>
                      </div>
                      <GroupVideoCallBtn roomId={"class-" + broadcastClass} label={allClasses.find(c=>c.id===broadcastClass)?.label || "Class"} currentUser={user} />
                    </div>

                    {/* Messages */}
                    <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:10 }}>
                      {gcMsgs.length === 0 && (
                        <div style={{ margin:"auto", textAlign:"center", color:"var(--text3)", fontSize:13 }}>No messages yet — start the conversation! 👋</div>
                      )}
                      {gcMsgs.map((m, i) => {
                        const mine = m.from === user;
                        const showAvatar = !mine && (i === 0 || gcMsgs[i-1]?.from !== m.from);
                        const bubbleColor = mine ? "linear-gradient(135deg,var(--accent),var(--accent2))" : "var(--bg4)";
                        const textColor   = mine ? "#fff" : "var(--text)";
                        const renderGcContent = () => {
                          if (m.type === "voice") return (
                            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:mine?"rgba(255,255,255,.15)":"var(--bg3)", borderRadius:10, minWidth:180 }}>
                              <button onClick={()=>{ const a=new Audio(m.fileData); a.play(); }} style={{ width:32,height:32,borderRadius:"50%",background:mine?"rgba(255,255,255,.25)":"var(--accent)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"white",flexShrink:0 }}>▶</button>
                              <div style={{ flex:1 }}><div style={{ fontSize:11,fontWeight:700,color:mine?"rgba(255,255,255,.8)":"var(--text3)" }}>Voice note</div><div style={{ fontSize:12,color:mine?"rgba(255,255,255,.9)":"var(--text3)" }}>{formatDur(m.duration||0)}</div></div>
                              <span style={{ fontSize:18,flexShrink:0 }}>🎤</span>
                            </div>
                          );
                          if (m.type === "file") {
                            if (m.fileType?.startsWith("image/")) return <img src={m.fileData} alt={m.fileName} style={{ maxWidth:220,maxHeight:200,borderRadius:10,display:"block",cursor:"pointer" }} onClick={()=>window.open(m.fileData,"_blank")} />;
                            return (
                              <div style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:mine?"rgba(255,255,255,.15)":"var(--bg3)",borderRadius:10,minWidth:160 }}>
                                <span style={{ fontSize:22,flexShrink:0 }}>📎</span>
                                <div style={{ flex:1,minWidth:0 }}><div style={{ fontSize:13,fontWeight:700,color:mine?"#fff":"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.fileName}</div><div style={{ fontSize:11,color:mine?"rgba(255,255,255,.7)":"var(--text3)" }}>{formatFileSize(m.fileSize)}</div></div>
                                <a href={m.fileData} download={m.fileName} style={{ color:mine?"white":"var(--accent)",fontSize:20,textDecoration:"none",flexShrink:0 }} title="Download">⬇</a>
                              </div>
                            );
                          }
                          return <div style={{ background:bubbleColor,borderRadius:mine?"18px 18px 4px 18px":"18px 18px 18px 4px",padding:"9px 14px",fontSize:14,color:textColor,boxShadow:"0 1px 4px rgba(0,0,0,.08)",wordBreak:"break-word",opacity:m.id?.startsWith("tmp_")?0.6:1 }}>{m.text}</div>;
                        };
                        return (
                          <div key={m.id} style={{ display:"flex",gap:8,justifyContent:mine?"flex-end":"flex-start",alignItems:"flex-end" }}>
                            {!mine && <div style={{ width:28,height:28,borderRadius:"50%",flexShrink:0,background:showAvatar?"linear-gradient(135deg,var(--accent),var(--accent2))":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"white" }}>{showAvatar?avatarChar(m.from):""}</div>}
                            <div style={{ maxWidth:"72%",display:"flex",flexDirection:"column",alignItems:mine?"flex-end":"flex-start" }}>
                              {showAvatar&&!mine&&<div style={{ fontSize:11,fontWeight:700,color:"var(--text3)",marginBottom:3,paddingLeft:4 }}>{displayName(m.from)}</div>}
                              {renderGcContent()}
                              <div style={{ fontSize:10,color:"var(--text3)",marginTop:3,paddingLeft:4,paddingRight:4 }}>{formatTime(m.sentAt)}{m.id?.startsWith("tmp_")&&<span style={{ marginLeft:4 }}>⏳</span>}</div>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={gcBottomRef} />
                    </div>

                    {/* Input toolbar */}
                    {gcRecording ? (
                      <div style={{ padding:"10px 14px",borderTop:"1.5px solid var(--border)",display:"flex",alignItems:"center",gap:10,background:"var(--bg4)" }}>
                        <div style={{ flex:1,display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderRadius:20,background:"rgba(239,68,68,.08)",border:"1.5px solid rgba(239,68,68,.3)" }}>
                          <span style={{ width:10,height:10,borderRadius:"50%",background:"var(--danger)",animation:"pulse 1s infinite",flexShrink:0 }} />
                          <span style={{ fontWeight:700,fontSize:13,color:"var(--danger)" }}>Recording…</span>
                          <span style={{ fontFamily:"'DM Mono',monospace",fontSize:13,color:"var(--danger)",marginLeft:"auto" }}>{formatDur(gcRecSeconds)}</span>
                        </div>
                        <button className="btn btn-sm" style={{ flexShrink:0 }} onClick={gcCancelRecording} title="Cancel">✕</button>
                        <button onClick={gcStopRecording} style={{ width:42,height:42,borderRadius:"50%",background:"var(--danger)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,boxShadow:"0 2px 8px rgba(239,68,68,.4)" }} title="Stop & Send">⏹</button>
                      </div>
                    ) : (
                      <div style={{ padding:"10px 14px",borderTop:"1.5px solid var(--border)",display:"flex",alignItems:"center",gap:8,background:"var(--card)" }}>
                        <input ref={gcFileInputRef} type="file" style={{ display:"none" }} accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip" onChange={e=>{ if(e.target.files[0]){gcSendFile(e.target.files[0]);e.target.value="";} }} />
                        <button className="btn btn-sm" style={{ width:38,height:38,borderRadius:"50%",padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }} onClick={()=>gcFileInputRef.current?.click()} title="Attach file" disabled={gcSending}>📎</button>
                        <button className="btn btn-sm" style={{ width:38,height:38,borderRadius:"50%",padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }} onClick={gcStartRecording} title="Record voice note" disabled={gcSending}>🎤</button>
                        <input ref={gcInputRef} className="inp" style={{ flex:1,marginBottom:0,borderRadius:20,padding:"10px 16px" }} placeholder={`Message ${allClasses.find(c=>c.id===broadcastClass)?.label||"group"}…`} value={gcInput} onChange={e=>setGcInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&gcSendText()} disabled={gcSending} />
                        <button className="btn btn-accent" style={{ width:42,height:42,borderRadius:"50%",padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,flexShrink:0,opacity:(!gcInput.trim()||gcSending)?0.45:1,transition:"opacity .15s" }} onClick={gcSendText} disabled={!gcInput.trim()||gcSending} title="Send">➤</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            /* ── STUDENT: auto-joined to their own class group chat ── */
            <div style={{ display:"flex", flexDirection:"column", flex:1, minHeight:0 }}>
              {/* Header */}
              {(() => { if (!broadcastClass && myClassId) setTimeout(()=>setBroadcastClass(myClassId),0); return null; })()}
              <div style={{ padding:"10px 16px", borderBottom:"1.5px solid var(--border)", background:"var(--bg4)", display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:32, height:32, borderRadius:9, background:"linear-gradient(135deg,var(--accent),var(--accent2))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>🏫</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:14, color:"var(--text)" }}>{allClasses.find(c=>c.id===myClassId)?.label || "Class Group Chat"}</div>
                  <div style={{ fontSize:11, color:"var(--text3)" }}>👥 {allStudents.filter(u=>u.class===myClassId).length + 1} members • Group chat</div>
                </div>
                <GroupVideoCallBtn roomId={"class-" + myClassId} label={allClasses.find(c=>c.id===myClassId)?.label || "Class"} currentUser={user} />
              </div>
              {/* Messages */}
              <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:10 }}>
                {gcMsgs.length === 0 && <div style={{ margin:"auto", textAlign:"center", color:"var(--text3)", fontSize:13 }}>No messages yet — start the conversation! 👋</div>}
                {gcMsgs.map((m, i) => {
                  const mine = m.from === user;
                  const showAvatar = !mine && (i === 0 || gcMsgs[i-1]?.from !== m.from);
                  const bubbleColor = mine ? "linear-gradient(135deg,var(--accent),var(--accent2))" : "var(--bg4)";
                  const textColor   = mine ? "#fff" : "var(--text)";
                  const renderGcContent = () => {
                    if (m.type === "voice") return (
                      <div style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:mine?"rgba(255,255,255,.15)":"var(--bg3)",borderRadius:10,minWidth:180 }}>
                        <button onClick={()=>{ const a=new Audio(m.fileData); a.play(); }} style={{ width:32,height:32,borderRadius:"50%",background:mine?"rgba(255,255,255,.25)":"var(--accent)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"white",flexShrink:0 }}>▶</button>
                        <div style={{ flex:1 }}><div style={{ fontSize:11,fontWeight:700,color:mine?"rgba(255,255,255,.8)":"var(--text3)" }}>Voice note</div><div style={{ fontSize:12,color:mine?"rgba(255,255,255,.9)":"var(--text3)" }}>{formatDur(m.duration||0)}</div></div>
                        <span style={{ fontSize:18,flexShrink:0 }}>🎤</span>
                      </div>
                    );
                    if (m.type === "file") {
                      if (m.fileType?.startsWith("image/")) return <img src={m.fileData} alt={m.fileName} style={{ maxWidth:220,maxHeight:200,borderRadius:10,display:"block",cursor:"pointer" }} onClick={()=>window.open(m.fileData,"_blank")} />;
                      return (
                        <div style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:mine?"rgba(255,255,255,.15)":"var(--bg3)",borderRadius:10,minWidth:160 }}>
                          <span style={{ fontSize:22,flexShrink:0 }}>📎</span>
                          <div style={{ flex:1,minWidth:0 }}><div style={{ fontSize:13,fontWeight:700,color:mine?"#fff":"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.fileName}</div><div style={{ fontSize:11,color:mine?"rgba(255,255,255,.7)":"var(--text3)" }}>{formatFileSize(m.fileSize)}</div></div>
                          <a href={m.fileData} download={m.fileName} style={{ color:mine?"white":"var(--accent)",fontSize:20,textDecoration:"none",flexShrink:0 }} title="Download">⬇</a>
                        </div>
                      );
                    }
                    return <div style={{ background:bubbleColor,borderRadius:mine?"18px 18px 4px 18px":"18px 18px 18px 4px",padding:"9px 14px",fontSize:14,color:textColor,boxShadow:"0 1px 4px rgba(0,0,0,.08)",wordBreak:"break-word",opacity:m.id?.startsWith("tmp_")?0.6:1 }}>{m.text}</div>;
                  };
                  return (
                    <div key={m.id} style={{ display:"flex",gap:8,justifyContent:mine?"flex-end":"flex-start",alignItems:"flex-end" }}>
                      {!mine && <div style={{ width:28,height:28,borderRadius:"50%",flexShrink:0,background:showAvatar?"linear-gradient(135deg,var(--accent),var(--accent2))":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"white" }}>{showAvatar?avatarChar(m.from):""}</div>}
                      <div style={{ maxWidth:"72%",display:"flex",flexDirection:"column",alignItems:mine?"flex-end":"flex-start" }}>
                        {showAvatar&&!mine&&<div style={{ fontSize:11,fontWeight:700,color:"var(--text3)",marginBottom:3,paddingLeft:4 }}>{displayName(m.from)}</div>}
                        {renderGcContent()}
                        <div style={{ fontSize:10,color:"var(--text3)",marginTop:3,paddingLeft:4,paddingRight:4 }}>{formatTime(m.sentAt)}{m.id?.startsWith("tmp_")&&<span style={{ marginLeft:4 }}>⏳</span>}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={gcBottomRef} />
              </div>
              {/* Input toolbar */}
              {gcRecording ? (
                <div style={{ padding:"10px 14px",borderTop:"1.5px solid var(--border)",display:"flex",alignItems:"center",gap:10,background:"var(--bg4)" }}>
                  <div style={{ flex:1,display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderRadius:20,background:"rgba(239,68,68,.08)",border:"1.5px solid rgba(239,68,68,.3)" }}>
                    <span style={{ width:10,height:10,borderRadius:"50%",background:"var(--danger)",animation:"pulse 1s infinite",flexShrink:0 }} />
                    <span style={{ fontWeight:700,fontSize:13,color:"var(--danger)" }}>Recording…</span>
                    <span style={{ fontFamily:"'DM Mono',monospace",fontSize:13,color:"var(--danger)",marginLeft:"auto" }}>{formatDur(gcRecSeconds)}</span>
                  </div>
                  <button className="btn btn-sm" style={{ flexShrink:0 }} onClick={gcCancelRecording} title="Cancel">✕</button>
                  <button onClick={gcStopRecording} style={{ width:42,height:42,borderRadius:"50%",background:"var(--danger)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,boxShadow:"0 2px 8px rgba(239,68,68,.4)" }} title="Stop & Send">⏹</button>
                </div>
              ) : (
                <div style={{ padding:"10px 14px",borderTop:"1.5px solid var(--border)",display:"flex",alignItems:"center",gap:8,background:"var(--card)" }}>
                  <input ref={gcFileInputRef} type="file" style={{ display:"none" }} accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip" onChange={e=>{ if(e.target.files[0]){gcSendFile(e.target.files[0]);e.target.value="";} }} />
                  <button className="btn btn-sm" style={{ width:38,height:38,borderRadius:"50%",padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }} onClick={()=>gcFileInputRef.current?.click()} title="Attach file" disabled={gcSending}>📎</button>
                  <button className="btn btn-sm" style={{ width:38,height:38,borderRadius:"50%",padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }} onClick={gcStartRecording} title="Record voice note" disabled={gcSending}>🎤</button>
                  <input ref={gcInputRef} className="inp" style={{ flex:1,marginBottom:0,borderRadius:20,padding:"10px 16px" }} placeholder={`Message ${allClasses.find(c=>c.id===myClassId)?.label||"group"}…`} value={gcInput} onChange={e=>setGcInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&gcSendText()} disabled={gcSending} />
                  <button className="btn btn-accent" style={{ width:42,height:42,borderRadius:"50%",padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:19,flexShrink:0,opacity:(!gcInput.trim()||gcSending)?0.45:1,transition:"opacity .15s" }} onClick={gcSendText} disabled={!gcInput.trim()||gcSending} title="Send">➤</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}


      {/* ── DIRECT MESSAGES PANEL ── */}
      {broadcastTab === "direct" && (
      <div style={{ display:"flex", flexDirection:"column", flex:1, borderRadius:14, overflow:"hidden", border:"1.5px solid var(--border)", background:"var(--card)", minHeight:0 }}>

        {/* Recipient selector bar */}
        <div style={{ padding:"10px 14px", borderBottom:"1.5px solid var(--border)", background:"var(--bg4)", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:13, fontWeight:700, color:"var(--text3)", flexShrink:0 }}>To:</span>

          {/* Lecturer class filter */}
          {isLecturerUser && (
            <select
              style={{ padding:"7px 12px", borderRadius:20, border:"1.5px solid var(--border)", background:"var(--card)", color:"var(--text)", fontSize:12, fontWeight:700, cursor:"pointer", outline:"none", maxWidth:160 }}
              value={lecturerFilter} onChange={e=>{ setLecturerFilter(e.target.value); setSearch(""); }}
            >
              <option value="">All classes</option>
              {allClasses.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}

          {/* Dropdown trigger */}
          <div ref={dropRef} style={{ position:"relative", flex:1, minWidth:160, maxWidth:320 }}>
            <div
              onClick={() => setDropOpen(o => !o)}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", borderRadius:20, border:`1.5px solid ${activeUser?"var(--accent)":"var(--border)"}`, background:"var(--card)", cursor:"pointer" }}
            >
              {activeUser ? (
                <>
                  <div style={{ width:24, height:24, borderRadius:"50%", background:"linear-gradient(135deg,var(--accent),var(--accent2))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"white", flexShrink:0 }}>{avatarChar(activeUser)}</div>
                  <span style={{ fontWeight:700, fontSize:13, flex:1 }}>{displayName(activeUser)}</span>
                  {hasUnread(activeUser) && <span style={{ width:8, height:8, borderRadius:"50%", background:"var(--danger)", flexShrink:0 }} />}
                </>
              ) : (
                <span style={{ color:"var(--text3)", fontSize:13, flex:1 }}>{isLecturerUser ? "Select a student…" : "Select a classmate…"}</span>
              )}
              <span style={{ color:"var(--text3)", fontSize:12, flexShrink:0, transition:"transform .2s", transform: dropOpen?"rotate(180deg)":"none" }}>▾</span>
            </div>

            {/* Dropdown panel */}
            {dropOpen && (
              <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, right:0, zIndex:999, background:"var(--card)", border:"1.5px solid var(--border)", borderRadius:14, boxShadow:"0 8px 32px rgba(0,0,0,.18)", overflow:"hidden", minWidth:240 }}>
                {/* Search inside dropdown */}
                <div style={{ padding:"8px 10px", borderBottom:"1px solid var(--border)" }}>
                  <input
                    className="inp"
                    style={{ marginBottom:0, fontSize:12, padding:"7px 12px", borderRadius:20 }}
                    placeholder="🔍 Search by name…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <div style={{ maxHeight:280, overflowY:"auto" }}>
                  {filteredPeople.length === 0 && (
                    <div style={{ padding:"20px 16px", textAlign:"center", color:"var(--text3)", fontSize:13 }}>
                    {search ? "No match found" : !isLecturerUser && classmates.length === 0 ? "No classmates in your class yet" : "No results"}
                    </div>
                  )}
                  {filteredPeople.map(u => {
                    const conv   = convs.find(c => c.id === _convId(user, u.username));
                    const unread = hasUnread(u.username);
                    const isAct  = activeUser === u.username;
                    return (
                      <div
                        key={u.username}
                        onClick={() => openConv(u.username)}
                        style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", cursor:"pointer", background: isAct ? "var(--accent)18" : "transparent", borderLeft: isAct ? "3px solid var(--accent)" : "3px solid transparent", transition:"background .12s" }}
                        onMouseEnter={e=>{ if(!isAct) e.currentTarget.style.background="var(--bg4)"; }}
                        onMouseLeave={e=>{ if(!isAct) e.currentTarget.style.background="transparent"; }}
                      >
                        <div style={{ position:"relative", flexShrink:0 }}>
                          <div style={{ width:36, height:36, borderRadius:"50%", background:"linear-gradient(135deg,var(--accent),var(--accent2))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:700, color:"white" }}>{avatarChar(u.username)}</div>
                          {unread && <span style={{ position:"absolute", top:-2, right:-2, width:10, height:10, background:"var(--danger)", borderRadius:"50%", border:"2px solid var(--card)" }} />}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight: unread ? 800 : 600, fontSize:13, color: isAct ? "var(--accent)" : "var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{displayName(u.username)}</div>
                          <div style={{ fontSize:10, color:"var(--text3)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {conv ? (conv.lastFrom === user ? "You: " : "") + conv.lastMsg : "Start a conversation"}
                          </div>
                        </div>
                        {conv && <div style={{ fontSize:9, color:"var(--text3)", flexShrink:0 }}>{formatTime(conv.lastAt)}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Voice call / Video call / Clear */}
          {activeUser && (<>
            <button
              className="btn btn-sm"
              title="Voice call"
              style={{ flexShrink:0, width:36, height:36, borderRadius:"50%", padding:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, background:"linear-gradient(135deg,#16a34a,#22c55e)", color:"white", border:"none", boxShadow:"0 2px 8px rgba(34,197,94,.35)" }}
              onClick={() => setDmCall({ type:"voice", toUser: activeUser, toName: displayName(activeUser), toAvatar: avatarChar(activeUser) })}
            >📞</button>
            <button
              className="btn btn-sm"
              title="Video call"
              style={{ flexShrink:0, width:36, height:36, borderRadius:"50%", padding:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, background:"linear-gradient(135deg,#1d4ed8,#3b82f6)", color:"white", border:"none", boxShadow:"0 2px 8px rgba(59,130,246,.35)" }}
              onClick={() => setDmCall({ type:"video", toUser: activeUser, toName: displayName(activeUser), toAvatar: avatarChar(activeUser) })}
            >📹</button>
            <button className="btn btn-sm" style={{ flexShrink:0 }} onClick={() => { setActiveUser(null); setMsgs([]); }}>✕</button>
          </>)}
          {/* DmCallModal */}
          {dmCall && (
            <DmCallModal
              callType={dmCall.type}
              fromUser={user}
              toUser={dmCall.toUser}
              toName={dmCall.toName}
              toAvatar={dmCall.toAvatar}
              isInitiator={true}
              onClose={() => setDmCall(null)}
            />
          )}
        </div>

        {/* ── CHAT AREA (full width) ── */}
        {!activeUser ? (
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"var(--text3)", padding:32, textAlign:"center" }}>
            <div style={{ fontSize:60, marginBottom:16 }}>💬</div>
            <div style={{ fontWeight:800, fontSize:17, color:"var(--text)", marginBottom:8 }}>Select a classmate to start chatting</div>
            <div style={{ fontSize:13, maxWidth:320, lineHeight:1.7 }}>
              Click the <b>To:</b> dropdown above to choose someone from <b>{myClass?.label || "your class"}</b>.
              You can send text, files, and voice notes.
            </div>
          </div>
        ) : (
          <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0 }}>

            {/* Messages scroll area */}
            <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:10 }}>
              {msgs.length === 0 && (
                <div style={{ margin:"auto", textAlign:"center", color:"var(--text3)", fontSize:13 }}>
                  No messages yet — say hello! 👋
                </div>
              )}
              {msgs.map((m, i) => {
                const mine       = m.from === user;
                const showAvatar = !mine && (i === 0 || msgs[i-1]?.from !== m.from);
                return (
                  <div key={m.id} style={{ display:"flex", gap:8, justifyContent: mine ? "flex-end" : "flex-start", alignItems:"flex-end" }}>
                    {!mine && (
                      <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, background: showAvatar ? "linear-gradient(135deg,var(--accent),var(--accent2))" : "transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"white" }}>
                        {showAvatar ? avatarChar(m.from) : ""}
                      </div>
                    )}
                    <div style={{ maxWidth:"72%", display:"flex", flexDirection:"column", alignItems: mine ? "flex-end" : "flex-start" }}>
                      {renderMsgContent(m)}
                      <div style={{ fontSize:10, color:"var(--text3)", marginTop:3, paddingLeft:4, paddingRight:4 }}>
                        {formatTime(m.sentAt)}
                        {mine && m.read  && !m.id?.startsWith("tmp_") && <span style={{ marginLeft:4, color:"var(--accent)" }}>✓✓</span>}
                        {mine && m.id?.startsWith("tmp_") && <span style={{ marginLeft:4 }}>⏳</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* ── Input toolbar ── */}
            {recording ? (
              /* Voice recording active */
              <div style={{ padding:"10px 14px", borderTop:"1.5px solid var(--border)", display:"flex", alignItems:"center", gap:10, background:"var(--bg4)" }}>
                <div style={{ flex:1, display:"flex", alignItems:"center", gap:10, padding:"10px 16px", borderRadius:20, background:"rgba(239,68,68,.08)", border:"1.5px solid rgba(239,68,68,.3)" }}>
                  <span style={{ width:10, height:10, borderRadius:"50%", background:"var(--danger)", animation:"pulse 1s infinite", flexShrink:0 }} />
                  <span style={{ fontWeight:700, fontSize:13, color:"var(--danger)" }}>Recording…</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:13, color:"var(--danger)", marginLeft:"auto" }}>{formatDur(recSeconds)}</span>
                </div>
                <button className="btn btn-sm" style={{ flexShrink:0 }} onClick={cancelRecording} title="Cancel">✕</button>
                <button
                  onClick={stopRecording}
                  style={{ width:42, height:42, borderRadius:"50%", background:"var(--danger)", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0, boxShadow:"0 2px 8px rgba(239,68,68,.4)" }}
                  title="Stop & Send"
                >⏹</button>
              </div>
            ) : (
              <div style={{ padding:"10px 14px", borderTop:"1.5px solid var(--border)", display:"flex", alignItems:"center", gap:8, background:"var(--card)" }}>
                {/* File attach */}
                <input ref={fileInputRef} type="file" style={{ display:"none" }} accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip" onChange={e => { if (e.target.files[0]) { sendFile(e.target.files[0]); e.target.value=""; } }} />
                <button
                  className="btn btn-sm"
                  style={{ width:38, height:38, borderRadius:"50%", padding:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file"
                  disabled={sending}
                >📎</button>

                {/* Voice note */}
                <button
                  className="btn btn-sm"
                  style={{ width:38, height:38, borderRadius:"50%", padding:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}
                  onClick={startRecording}
                  title="Record voice note"
                  disabled={sending}
                >🎤</button>

                {/* Text input */}
                <input
                  ref={inputRef}
                  className="inp"
                  style={{ flex:1, marginBottom:0, borderRadius:20, padding:"10px 16px" }}
                  placeholder={"Message " + displayName(activeUser) + "…"}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendText()}
                  disabled={sending}
                />

                {/* Send button */}
                <button
                  className="btn btn-accent"
                  style={{ width:42, height:42, borderRadius:"50%", padding:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:19, flexShrink:0, opacity: (!input.trim() || sending) ? 0.45 : 1, transition:"opacity .15s" }}
                  onClick={sendText}
                  disabled={!input.trim() || sending}
                  title="Send"
                >➤</button>
              </div>
            )}
          </div>
        )}
      </div>
      )} {/* end broadcastTab === "direct" */}
    </div>
    </Fragment>
  );
}

export function Notifications({ currentUser, onRead, onNavigate }) {
  const [notifs, setNotifs] = useState(()=>ls("nv-notifications",[]));
  const [pushNotifs] = useSharedData("nv-push-notifs", []);

  useEffect(() => {
    // Mark all as read
    const updated = notifs.map(n=>({...n,read:true}));
    setNotifs(updated); saveMyData("notifications","nv-notifications",updated);
    if (onRead) onRead();
  }, []);

  const del = (id) => { const u=notifs.filter(n=>n.id!==id); setNotifs(u); saveMyData("notifications","nv-notifications",u); };
  const clearAll = () => { setNotifs([]); saveMyData("notifications","nv-notifications",[]); };

  const handleClick = (n) => {
    if (!onNavigate) return;
    if (n.type === "dm")              onNavigate("messages");
    else if (n.type === "group_chat") onNavigate("messages");
    else if (n.type === "handout")    onNavigate("handouts");
    else if (n.type === "assignment") onNavigate("assignments");
  };

  const typeIcon = (type) => { if(type==="handout")return"📄"; if(type==="announcement")return"📢"; if(type==="urgent")return"🚨"; if(type==="warning")return"⚠️"; if(type==="success")return"✅"; return"🔔"; };
  const typeColor = (type) => { if(type==="handout")return"var(--accent)"; if(type==="announcement"||type==="warning")return"var(--warn)"; if(type==="urgent")return"#ef4444"; if(type==="success")return"#22c55e"; return"var(--text3)"; };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div><div className="sec-title">🔔 Notifications</div><div className="sec-sub">{notifs.length + pushNotifs.length} notification{(notifs.length+pushNotifs.length)!==1?"s":""}</div></div>
        {notifs.length>0&&<button className="btn btn-sm btn-danger" onClick={clearAll}>🗑️ Clear All</button>}
      </div>
      {/* Push notifications from admin */}
      {pushNotifs.length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--text3)",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>📢 Announcements from Admin</div>
          {pushNotifs.slice(0,10).map((n,i)=>(
            <div key={n.id} className="card" style={{marginBottom:10,borderLeft:`3px solid ${typeColor(n.type)}`}}>
              <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{fontSize:22,flexShrink:0,marginTop:2}}>{typeIcon(n.type)}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>{n.title}</div>
                  <div style={{fontSize:13,color:"var(--text2)",marginBottom:6}}>{n.body}</div>
                  <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{new Date(n.sentAt).toLocaleString()}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {notifs.length===0 && pushNotifs.length===0 ? (
        <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}>🔔</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>No notifications yet.</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:6}}>You'll be notified when lecturers upload new handouts.</div>
        </div>
      ) : (
        <div>
          {notifs.map((n,i)=>(
            <div key={n.id} className="card" onClick={()=>handleClick(n)} style={{cursor:"pointer",marginBottom:10,borderLeft:`3px solid ${typeColor(n.type)}`,animation:`fadeUp .3s ease ${i*.04}s both`,opacity:n.read ? 0.85 : 1}}>
              <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{fontSize:22,flexShrink:0,marginTop:2}}>{typeIcon(n.type)}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>{n.title}</div>
                  <div style={{fontSize:13,color:"var(--text2)",marginBottom:6}}>{n.body}</div>
                  <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{n.date} • {n.time}</div>
                </div>
                <button className="btn btn-sm" style={{flexShrink:0}} onClick={(e)=>{e.stopPropagation();del(n.id);}}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ─── CBT EXAM SYSTEM ─────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

// ── Shared parser: handles both single & pasted multi-question blocks ─
// Supports formats:
//   Q: text / 1. text / plain text
//   A:/B:/C:/D: or (A)/(B) or A) or numbered 1) 2) 3) 4)
//   Inline "ANS: B" or separate answers column
