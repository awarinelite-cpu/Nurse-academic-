import { useState, useEffect, useRef } from "react";
import { gcSend, gcSubscribe } from "../../services/backend";
import { showNotif } from "../../utils/notifications";
import { ls } from "../../utils/storage";
import { Messages } from "../../components/messaging";
import { GroupVideoCallBtn } from "../../components/video-call";
import { _gvcPairId } from "../../shared/groupVideoCall";
import { PHN_FORUM_ID, phnFolderAdd, phnFolderDelete, phnFolderSubscribe, phnGetLecturers, phnSaveLecturers } from "../../shared/phnForum";

export function PHNFolderModal({ currentUser, isAdmin, onClose }) {
  const allUsers   = ls("nv-users", []);
  const me         = allUsers.find(u => u.username === currentUser) || {};
  const myRole     = me.role || "student";
  const canDelete  = myRole === "admin";

  const [files,       setFiles]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [deleting,    setDeleting]    = useState(null);   // id being deleted
  const [viewFile,    setViewFile]    = useState(null);   // file being previewed
  const [search,      setSearch]      = useState("");
  const [filterType,  setFilterType]  = useState("all"); // all|pdf|image|doc|other
  const fileInputRef  = useRef(null);
  const [uploading,   setUploading]   = useState(false);

  // Subscribe to folder
  useEffect(() => {
    setLoading(true);
    const unsub = phnFolderSubscribe(incoming => { setFiles(incoming); setLoading(false); });
    return () => unsub();
  }, []);

  // File type helper
  const getFileIcon = (fileType = "") => {
    if (fileType.includes("image"))                              return { icon: "🖼️", label: "Image",       color: "#7c3aed" };
    if (fileType.includes("pdf"))                               return { icon: "📄", label: "PDF",         color: "#dc2626" };
    if (fileType.includes("word") || fileType.includes("document")) return { icon: "📝", label: "Document",   color: "#2563eb" };
    if (fileType.includes("sheet") || fileType.includes("excel"))   return { icon: "📊", label: "Spreadsheet", color: "#16a34a" };
    if (fileType.includes("presentation") || fileType.includes("powerpoint")) return { icon: "📊", label: "Slides", color: "#d97706" };
    if (fileType.includes("text"))                              return { icon: "📃", label: "Text",        color: "#6b7280" };
    if (fileType.includes("zip") || fileType.includes("rar"))   return { icon: "🗜️", label: "Archive",     color: "#92400e" };
    return { icon: "📎", label: "File", color: "#6b7280" };
  };

  const canPreview = (fileType = "") =>
    fileType.includes("image") || fileType.includes("pdf") || fileType.includes("text");

  // Filter logic
  const filtered = files.filter(f => {
    const matchSearch = !search || f.fileName?.toLowerCase().includes(search.toLowerCase()) ||
      f.uploadedBy?.toLowerCase().includes(search.toLowerCase());
    const ft = f.fileType || "";
    const matchType =
      filterType === "all"   ? true :
      filterType === "pdf"   ? ft.includes("pdf") :
      filterType === "image" ? ft.includes("image") :
      filterType === "doc"   ? (ft.includes("word") || ft.includes("document") || ft.includes("text") || ft.includes("presentation")) :
      /* other */               (!ft.includes("pdf") && !ft.includes("image") && !ft.includes("word") && !ft.includes("document") && !ft.includes("text") && !ft.includes("presentation"));
    return matchSearch && matchType;
  });

  // Direct upload to folder
  const handleDirectUpload = (file) => {
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const entry = {
        id: "phnf_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        fileName: file.name, fileType: file.type, fileSize: file.size,
        fileData: ev.target.result,
        uploadedBy: currentUser, uploadedAt: Date.now(), source: "direct",
      };
      await phnFolderAdd(entry);
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async (f) => {
    if (!canDelete) return;
    if (!window.confirm(`Delete "${f.fileName}"? This cannot be undone.`)) return;
    setDeleting(f.id);
    await phnFolderDelete(f.id);
    setDeleting(null);
  };

  // ── Inline file viewer modal ──
  if (viewFile) {
    const { icon, color } = getFileIcon(viewFile.fileType);
    const isImage = (viewFile.fileType || "").includes("image");
    const isPDF   = (viewFile.fileType || "").includes("pdf");
    const isText  = (viewFile.fileType || "").includes("text");
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.82)", zIndex: 10999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 12 }}>
        {/* Viewer header */}
        <div style={{ width: "100%", maxWidth: 860, display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: "0 4px" }}>
          <span style={{ fontSize: 22 }}>{icon}</span>
          <div style={{ flex: 1, fontWeight: 800, fontSize: 15, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{viewFile.fileName}</div>
          <a href={viewFile.fileData} download={viewFile.fileName}
            style={{ background: "#22c55e", color: "white", borderRadius: 10, padding: "7px 14px", fontSize: 12, fontWeight: 800, textDecoration: "none", flexShrink: 0 }}>
            ⬇ Download
          </a>
          <button onClick={() => setViewFile(null)} style={{ background: "rgba(255,255,255,.15)", border: "1.5px solid rgba(255,255,255,.3)", borderRadius: 10, padding: "7px 14px", color: "white", fontSize: 14, fontWeight: 800, cursor: "pointer", flexShrink: 0 }}>✕ Close</button>
        </div>
        {/* Viewer body */}
        <div style={{ width: "100%", maxWidth: 860, flex: 1, minHeight: 0, background: "white", borderRadius: 16, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", maxHeight: "80vh" }}>
          {isImage && <img src={viewFile.fileData} alt={viewFile.fileName} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
          {isPDF   && <iframe src={viewFile.fileData} title={viewFile.fileName} style={{ width: "100%", height: "80vh", border: "none" }} />}
          {isText  && (
            <pre style={{ padding: 24, fontSize: 13, overflowY: "auto", maxHeight: "80vh", width: "100%", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#1a1a1a" }}>
              {atob((viewFile.fileData || "").split(",")[1] || "")}
            </pre>
          )}
          {!isImage && !isPDF && !isText && (
            <div style={{ textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>{icon}</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#1a1a1a", marginBottom: 8 }}>{viewFile.fileName}</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>Preview not available for this file type.</div>
              <a href={viewFile.fileData} download={viewFile.fileName}
                style={{ background: "#2e7d32", color: "white", borderRadius: 12, padding: "12px 24px", fontSize: 14, fontWeight: 800, textDecoration: "none", display: "inline-block" }}>
                ⬇ Download to View
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.58)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: "var(--bg)", borderRadius: 20, width: "100%", maxWidth: 720, height: "min(92vh,740px)", display: "flex", flexDirection: "column", border: "2px solid #2e7d32", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>

        {/* Header */}
        <div style={{ padding: "14px 18px", background: "linear-gradient(135deg,#1b5e20,#2e7d32)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>📁</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 900, fontSize: 16, color: "white", fontFamily: "'Syne',sans-serif" }}>PHN Study Folder</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.8)" }}>Public Health Nursing • {files.length} file{files.length !== 1 ? "s" : ""}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* Direct upload button */}
            <input ref={fileInputRef} type="file" style={{ display: "none" }} accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip" onChange={e => { if (e.target.files[0]) { handleDirectUpload(e.target.files[0]); e.target.value = ""; } }} />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              style={{ background: uploading ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.2)", border: "1.5px solid rgba(255,255,255,.4)", borderRadius: 10, padding: "6px 13px", color: "white", fontSize: 12, fontWeight: 700, cursor: uploading ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              {uploading ? "⏳ Uploading…" : "📤 Upload"}
            </button>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.35)", borderRadius: 10, padding: "6px 12px", color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✕</button>
          </div>
        </div>

        {/* Search + filter bar */}
        <div style={{ padding: "10px 16px", borderBottom: "1.5px solid var(--border)", background: "var(--bg4)", flexShrink: 0, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="inp" style={{ flex: 1, minWidth: 160, marginBottom: 0, borderRadius: 20, padding: "8px 14px", fontSize: 12 }}
            placeholder="🔍 Search files or uploader…"
            value={search} onChange={e => setSearch(e.target.value)}
          />
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[["all","All"],["pdf","📄 PDF"],["image","🖼️ Images"],["doc","📝 Docs"],["other","📎 Other"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setFilterType(k)} style={{ padding: "5px 11px", borderRadius: 20, border: `1.5px solid ${filterType === k ? "#2e7d32" : "var(--border)"}`, background: filterType === k ? "rgba(46,125,50,.15)" : "transparent", color: filterType === k ? "#2e7d32" : "var(--text3)", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>{lbl}</button>
            ))}
          </div>
        </div>

        {/* Admin notice */}
        {canDelete && (
          <div style={{ padding: "7px 16px", background: "rgba(239,68,68,.07)", borderBottom: "1px solid rgba(239,68,68,.15)", fontSize: 11, color: "#dc2626", fontWeight: 700, flexShrink: 0 }}>
            🛡️ Admin Mode — you can delete any file from this folder
          </div>
        )}

        {/* File list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          {loading && (
            <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text3)" }}>
              <div style={{ fontSize: 36, marginBottom: 10, animation: "spin 1.2s linear infinite", display: "inline-block" }}>🔄</div>
              <div style={{ fontSize: 13 }}>Loading files…</div>
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "52px 20px", color: "var(--text3)" }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>📂</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{search || filterType !== "all" ? "No files match your filter" : "Folder is empty"}</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>{search || filterType !== "all" ? "Try a different search or filter" : "Files shared in the PHN Forum or uploaded directly will appear here."}</div>
            </div>
          )}
          {!loading && filtered.map(f => {
            const { icon, color } = getFileIcon(f.fileType);
            const uploader = allUsers.find(u => u.username === f.uploadedBy);
            const uploaderName = uploader?.displayName || (f.uploadedBy || "").split("@")[0];
            const uploaderRole = uploader?.role || "student";
            const dateStr = f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
            const sizeStr = f.fileSize ? (f.fileSize >= 1024 * 1024 ? (f.fileSize / (1024 * 1024)).toFixed(1) + " MB" : (f.fileSize / 1024).toFixed(1) + " KB") : "";
            const isPreviewable = canPreview(f.fileType);

            return (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 14, border: "1.5px solid var(--border)", background: "var(--card)", marginBottom: 8, transition: "box-shadow .15s" }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "0 3px 14px rgba(46,125,50,.13)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>

                {/* File icon */}
                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}18`, border: `1.5px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
                  {icon}
                </div>

                {/* File info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.fileName || "Unnamed file"}</div>
                  <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {sizeStr && <span>{sizeStr}</span>}
                    <span>by <strong style={{ color: uploaderRole === "lecturer" || uploaderRole === "admin" ? "#c2185b" : "var(--text2)" }}>{uploaderName}</strong>{(uploaderRole === "lecturer" || uploaderRole === "admin") ? " 👨🏫" : ""}</span>
                    {f.source === "forum" && <span style={{ background: "rgba(46,125,50,.12)", color: "#2e7d32", borderRadius: 8, padding: "0 5px", fontWeight: 700 }}>💬 From Forum</span>}
                    {dateStr && <span>{dateStr}</span>}
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                  {isPreviewable && (
                    <button onClick={() => setViewFile(f)}
                      style={{ padding: "6px 11px", borderRadius: 9, border: `1.5px solid ${color}`, background: `${color}12`, color, fontWeight: 800, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
                      👁 View
                    </button>
                  )}
                  <a href={f.fileData} download={f.fileName}
                    style={{ padding: "6px 11px", borderRadius: 9, border: "1.5px solid #22c55e", background: "rgba(34,197,94,.10)", color: "#16a34a", fontWeight: 800, fontSize: 11, textDecoration: "none", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 3 }}>
                    ⬇ Download
                  </a>
                  {canDelete && (
                    <button onClick={() => handleDelete(f)} disabled={deleting === f.id}
                      style={{ padding: "6px 11px", borderRadius: 9, border: "1.5px solid #ef4444", background: "rgba(239,68,68,.08)", color: "#ef4444", fontWeight: 800, fontSize: 11, cursor: deleting === f.id ? "wait" : "pointer", whiteSpace: "nowrap", opacity: deleting === f.id ? .5 : 1 }}>
                      {deleting === f.id ? "⏳" : "🗑 Delete"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer stats */}
        <div style={{ padding: "9px 18px", borderTop: "1.5px solid var(--border)", background: "var(--bg4)", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--text3)" }}>
          <span>{filtered.length} of {files.length} file{files.length !== 1 ? "s" : ""} shown</span>
          <span style={{ color: "#2e7d32", fontWeight: 700 }}>📁 PHN Study Folder • Auto-saves forum files</span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// GROUP VIDEO CALL — fully embedded on-site WebRTC mesh
// Firestore signalling layout:
//   group_calls/{roomId}/peers/{safeUid}          ← presence heartbeat
//   group_calls/{roomId}/signals/{pairId}         ← one doc per pair
//     fields: from, to, offer?, answer?, callerIce[], calleeIce[]
//
// Pair doc id = _gvcPairId(a,b) — alphabetically smaller uid first.
// Caller = alphabetically-smaller uid (creates offer)
// Callee = alphabetically-larger  uid (creates answer)
// ════════════════════════════════════════════════════════════════════════

export function PHNClassForum({ currentUser, onClose, onUnreadChange }) {
  const allUsers  = ls("nv-users", []);
  const me        = allUsers.find(u => u.username === currentUser) || {};
  const myRole    = me.role || "student";
  const isLecturerUser = myRole === "lecturer" || myRole === "admin";

  // Only Public Health Nursing students (class id contains "phn" or "public") + approved lecturers
  const [approvedLecturers, setApprovedLecturers] = useState([]);
  const [msgs,    setMsgs]    = useState([]);
  const [input,   setInput]   = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs,   setRecSecs]   = useState(0);
  // Notification permission
  const [notifPerm, setNotifPerm] = useState(() =>
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const mediaRecRef  = useRef(null);
  const recTimerRef  = useRef(null);
  const recChunksRef = useRef([]);
  const fileInputRef = useRef(null);
  const bottomRef    = useRef(null);
  const inputRef     = useRef(null);
  const prevMsgCountRef = useRef(0);

  // Request notification permission on mount
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().then(p => setNotifPerm(p));
    }
  }, []);

  // Load approved lecturers from Firestore
  useEffect(() => {
    phnGetLecturers().then(list => setApprovedLecturers(list || []));
  }, []);

  // Subscribe to messages — unconditional, no canAccess gate needed.
  // The forum button is only shown to students on the publichealth tab.
  useEffect(() => {
    let initialized = false;
    const unsub = gcSubscribe(PHN_FORUM_ID, incoming => {
      setMsgs(incoming);
      if (!initialized) {
        prevMsgCountRef.current = incoming.length;
        initialized = true;
        return;
      }
      if (incoming.length > prevMsgCountRef.current) {
        const newMsgs = incoming.slice(prevMsgCountRef.current);
        newMsgs.forEach(msg => {
          if (msg.from === currentUser) return;
          const senderUser = ls("nv-users", []).find(u => u.username === msg.from);
          const senderName = senderUser?.displayName || (msg.from || "Someone").split("@")[0];
          const bodyText = msg.type === "voice" ? "🎤 Sent a voice note"
                         : msg.type === "file"  ? `📎 Shared: ${msg.fileName || "a file"}`
                         : (msg.text || "").slice(0, 80);
          showNotif(`🌍 PHN Forum — ${senderName}`, { body: bodyText, tag: "phn_forum_" + msg.id });
        });
        if (onUnreadChange) onUnreadChange(newMsgs.filter(m => m.from !== currentUser).length);
      }
      prevMsgCountRef.current = incoming.length;
    });
    return () => unsub();
  }, [currentUser]);

  // Reset unread count when forum is opened
  useEffect(() => {
    if (onUnreadChange) onUnreadChange(-999);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  // Add/remove lecturer
  const addLecturer = async (email) => {
    if (!email || approvedLecturers.includes(email)) return;
    const updated = [...approvedLecturers, email];
    setApprovedLecturers(updated);
    await phnSaveLecturers(updated);
  };
  const removeLecturer = async (email) => {
    const updated = approvedLecturers.filter(e => e !== email);
    setApprovedLecturers(updated);
    await phnSaveLecturers(updated);
  };

  // Send text
  const sendText = async () => {
    const txt = input.trim();
    if (!txt || sending) return;
    setSending(true);
    setInput("");
    try { await gcSend(PHN_FORUM_ID, currentUser, { type: "text", text: txt }); }
    catch(e) {}
    setSending(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Send file — also auto-saves to PHN Study Folder
  const sendFile = async (file) => {
    if (!file || sending) return;
    setSending(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const fileData = ev.target.result;
        // Send to forum chat
        await gcSend(PHN_FORUM_ID, currentUser, { type: "file", text: "", fileName: file.name, fileType: file.type, fileSize: file.size, fileData });
        // Auto-save to PHN folder
        const entry = {
          id: "phnf_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          fileName: file.name, fileType: file.type, fileSize: file.size, fileData,
          uploadedBy: currentUser, uploadedAt: Date.now(), source: "forum",
        };
        phnFolderAdd(entry); // fire-and-forget
        setSending(false);
      };
      reader.readAsDataURL(file);
    } catch(e) { setSending(false); }
  };

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg" });
      recChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recChunksRef.current, { type: mr.mimeType });
        const dur  = recSecs;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          setSending(true);
          await gcSend(PHN_FORUM_ID, currentUser, { type: "voice", text: "", fileData: ev.target.result, fileType: mr.mimeType, duration: dur });
          setSending(false);
        };
        reader.readAsDataURL(blob);
        clearInterval(recTimerRef.current);
        setRecSecs(0);
        setRecording(false);
      };
      mediaRecRef.current = mr;
      mr.start();
      setRecording(true);
      recTimerRef.current = setInterval(() => setRecSecs(s => s + 1), 1000);
    } catch(e) { alert("Microphone access denied. Please allow microphone permission."); }
  };
  const stopRecording = () => { mediaRecRef.current?.stop(); };

  // Message renderer
  const renderMsg = (msg, idx) => {
    const isMine = msg.from === currentUser;
    const senderUser = allUsers.find(u => u.username === msg.from);
    const senderName = senderUser?.displayName || msg.from?.split("@")[0] || "?";
    const senderRole = senderUser?.role || "student";
    const avatar = senderUser?.avatar || (senderName[0] || "?").toUpperCase();
    const time = msg.sentAt ? new Date(msg.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const isLec = senderRole === "lecturer" || senderRole === "admin";

    return (
      <div key={msg.id || idx} style={{ display: "flex", gap: 8, marginBottom: 10, flexDirection: isMine ? "row-reverse" : "row", alignItems: "flex-end" }}>
        {/* Avatar */}
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: isLec ? "linear-gradient(135deg,#c2185b,#e91e63)" : "linear-gradient(135deg,#2e7d32,#4caf50)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, border: isLec ? "2px solid #e91e63" : "2px solid #4caf50", color: "white", fontWeight: 800 }}>
          {avatar}
        </div>
        <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", alignItems: isMine ? "flex-end" : "flex-start", gap: 2 }}>
          {/* Sender name + role badge */}
          {!isMine && (
            <div style={{ fontSize: 10, color: "var(--text3)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontWeight: 700, color: isLec ? "#c2185b" : "var(--text2)" }}>{senderName}</span>
              {isLec && <span style={{ background: "rgba(194,24,91,.12)", color: "#c2185b", borderRadius: 8, padding: "0 5px", fontSize: 9, fontWeight: 800 }}>👨🏫 Lecturer</span>}
            </div>
          )}
          {/* Bubble */}
          <div style={{
            padding: msg.type === "voice" ? "8px 12px" : "10px 14px",
            borderRadius: isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
            background: isMine ? "linear-gradient(135deg,#2e7d32,#4caf50)" : "var(--card)",
            border: isMine ? "none" : "1px solid var(--border2)",
            color: isMine ? "white" : "var(--text)",
            fontSize: 13, lineHeight: 1.45, wordBreak: "break-word",
            boxShadow: "0 1px 3px rgba(0,0,0,.1)",
          }}>
            {msg.type === "text" && msg.text}
            {msg.type === "file" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>
                  {msg.fileType?.includes("image") ? "🖼️" : msg.fileType?.includes("pdf") ? "📄" : msg.fileType?.includes("word") || msg.fileType?.includes("document") ? "📝" : msg.fileType?.includes("sheet") || msg.fileType?.includes("excel") ? "📊" : "📎"}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{msg.fileName || "File"}</div>
                  {msg.fileSize && <div style={{ fontSize: 10, opacity: .7 }}>{(msg.fileSize / 1024).toFixed(1)} KB</div>}
                  {msg.fileData && (
                    <a href={msg.fileData} download={msg.fileName} style={{ fontSize: 10, color: isMine ? "rgba(255,255,255,.85)" : "var(--accent)", fontWeight: 700 }}>⬇ Download</a>
                  )}
                </div>
              </div>
            )}
            {msg.type === "voice" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 160 }}>
                <span style={{ fontSize: 20 }}>🎤</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>Voice Note {msg.duration ? `• ${msg.duration}s` : ""}</div>
                  {msg.fileData && (
                    <audio controls src={msg.fileData} style={{ marginTop: 4, width: "100%", maxWidth: 220, height: 32 }} />
                  )}
                </div>
              </div>
            )}
          </div>
          <div style={{ fontSize: 9, color: "var(--text3)", paddingLeft: 4, paddingRight: 4 }}>{time}</div>
        </div>
      </div>
    );
  };

  // Lecturer management panel (only PHN students can manage)
  const [showLecPanel, setShowLecPanel] = useState(false);
  const [lecEmailInput, setLecEmailInput] = useState("");
  const [showFolder, setShowFolder] = useState(false);
  const allLecturers = allUsers.filter(u => u.role === "lecturer" || u.role === "admin");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: "var(--bg)", borderRadius: 20, width: "100%", maxWidth: 680, height: "min(90vh, 700px)", display: "flex", flexDirection: "column", border: "2px solid #2e7d32", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>

        {/* Header */}
        <div style={{ padding: "14px 18px", background: "linear-gradient(135deg,#2e7d32,#4caf50)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🌍</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 900, fontSize: 16, color: "white", fontFamily: "'Syne',sans-serif" }}>PHN Class Forum</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.8)" }}>Public Health Nursing • {msgs.length} messages</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {(
              <button onClick={() => setShowLecPanel(p => !p)} title="Manage Lecturers" style={{ background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.35)", borderRadius: 10, padding: "6px 12px", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                👨🏫 Lecturers
              </button>
            )}
            <GroupVideoCallBtn roomId={PHN_FORUM_ID} label="PHN Class Forum" currentUser={currentUser} style={{ background:"rgba(59,130,246,.35)", border:"1.5px solid rgba(59,130,246,.6)" }} />
            <button onClick={() => setShowFolder(true)} title="PHN Study Folder"
              style={{ background: "rgba(255,255,255,.22)", border: "1.5px solid rgba(255,255,255,.45)", borderRadius: 10, padding: "6px 13px", color: "white", fontSize: 12, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              📁 Folder
            </button>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.35)", borderRadius: 10, padding: "6px 12px", color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✕</button>
          </div>
        </div>

        {/* Lecturer management panel */}
        {showLecPanel && (
          <div style={{ padding: "14px 18px", background: "var(--bg4)", borderBottom: "1.5px solid var(--border)", flexShrink: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#2e7d32", marginBottom: 10 }}>👨🏫 Manage Lecturers in this Forum</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>Add or remove lecturers who can join the PHN class forum.</div>

            {/* Add lecturer */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <select className="inp" style={{ flex: 1, marginBottom: 0, fontSize: 12 }} value={lecEmailInput} onChange={e => setLecEmailInput(e.target.value)}>
                <option value="">— Select a lecturer —</option>
                {allLecturers.map(l => (
                  <option key={l.username} value={l.username}>{l.displayName || l.username.split("@")[0]} ({l.username})</option>
                ))}
              </select>
              <button className="btn btn-accent" style={{ padding: "8px 14px", fontSize: 12, flexShrink: 0 }} onClick={async () => { if (lecEmailInput) { await addLecturer(lecEmailInput); setLecEmailInput(""); } }}>
                + Add
              </button>
            </div>

            {/* Current approved lecturers */}
            {approvedLecturers.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text3)", fontStyle: "italic" }}>No lecturers added yet.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {approvedLecturers.map(email => {
                  const lu = allUsers.find(u => u.username === email);
                  const lname = lu?.displayName || email.split("@")[0];
                  return (
                    <div key={email} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(194,24,91,.10)", border: "1px solid rgba(194,24,91,.25)", borderRadius: 20, padding: "4px 10px", fontSize: 11 }}>
                      <span style={{ color: "#c2185b", fontWeight: 700 }}>👨🏫 {lname}</span>
                      <button onClick={() => removeLecturer(email)} style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontWeight: 800, fontSize: 13, padding: 0, lineHeight: 1 }} title={`Remove ${lname}`}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {msgs.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text3)" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Welcome to PHN Class Forum!</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>Start the conversation — share notes, ask questions, and collaborate.</div>
            </div>
          )}
          {msgs.map((m, i) => renderMsg(m, i))}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div style={{ padding: "12px 14px", borderTop: "1.5px solid var(--border)", background: "var(--bg4)", flexShrink: 0 }}>
          {recording ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "rgba(239,68,68,.07)", border: "1.5px solid var(--danger)", borderRadius: 14 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--danger)", animation: "pulse 1s infinite" }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>Recording… {recSecs}s</span>
              <button onClick={stopRecording} style={{ background: "var(--danger)", border: "none", borderRadius: 10, color: "white", padding: "8px 16px", fontWeight: 800, cursor: "pointer", fontSize: 12 }}>⏹ Stop & Send</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input ref={fileInputRef} type="file" style={{ display: "none" }} accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip" onChange={e => { if (e.target.files[0]) { sendFile(e.target.files[0]); e.target.value = ""; } }} />
              <button title="Attach file" disabled={sending} onClick={() => fileInputRef.current?.click()} style={{ width: 38, height: 38, borderRadius: "50%", border: "1.5px solid var(--border2)", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, cursor: "pointer", flexShrink: 0 }}>📎</button>
              <button title="Record voice note" disabled={sending} onClick={startRecording} style={{ width: 38, height: 38, borderRadius: "50%", border: "1.5px solid var(--border2)", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, cursor: "pointer", flexShrink: 0 }}>🎤</button>
              <input ref={inputRef} className="inp" style={{ flex: 1, marginBottom: 0, borderRadius: 20, padding: "10px 16px", fontSize: 13 }} placeholder="Message PHN Class Forum…" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendText()} disabled={sending} />
              <button onClick={sendText} disabled={!input.trim() || sending} title="Send" style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(135deg,#2e7d32,#4caf50)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, cursor: "pointer", flexShrink: 0, opacity: (!input.trim() || sending) ? 0.45 : 1, transition: "opacity .15s", color: "white" }}>➤</button>
            </div>
          )}
        </div>
      </div>
      {/* PHN Study Folder modal — rendered outside the chat card so it overlays at full-screen */}
      {showFolder && (
        <PHNFolderModal
          currentUser={currentUser}
          isAdmin={myRole === "admin"}
          onClose={() => setShowFolder(false)}
        />
      )}
      {/* Group Video Call via Jitsi */}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STUDENT: Nursing Exams View (Year dropdown → Paper1/Paper2/OSCE)
// ═══════════════════════════════════════════════════════════════════════
