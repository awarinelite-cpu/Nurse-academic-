import { useState, useEffect, useCallback, useRef } from "react";
import { _loadFirebase, clearCallSignal, pushUserNotif, writeCallSignal } from "../../services/backend";
import { ls } from "../../utils/storage";
import { GVC_ICE, _gvcPairId, _gvcPeersCol, _gvcSigDoc, _gvcSigsCol, gvcAddIce, gvcJoin, gvcLeave, gvcWriteAnswer, gvcWriteOffer } from "../../shared/groupVideoCall";

export function GroupVideoCallModal({ roomId, label, currentUser, onClose }) {
  const allUsers = ls("nv-users", []);

  const [peers,    setPeers]    = useState({});
  const [muted,    setMuted]    = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [status,   setStatus]   = useState("joining"); // joining | active | error
  const [errMsg,   setErrMsg]   = useState("");

  const localStreamRef = useRef(null);
  const localVideoRef  = useRef(null);
  const pcsRef         = useRef({});   // uid → RTCPeerConnection
  const unsubsRef      = useRef([]);
  const hbRef          = useRef(null);
  const timerRef       = useRef(null);
  const appliedIce     = useRef({});   // pairKey_role → count of applied candidates
  const pendingIce     = useRef({});   // uid → queued candidates before remoteDesc

  const dname  = (uid) => { const u = allUsers.find(x => x.username === uid); return u?.displayName || uid.split("@")[0]; };
  const avChar = (uid) => (dname(uid)[0] || "?").toUpperCase();

  // Apply incoming ICE, queue if remoteDescription not yet set
  const applyIce = useCallback(async (remoteUid, candidates, role) => {
    const pc = pcsRef.current[remoteUid];
    if (!pc || pc.signalingState === "closed") return;
    const key  = remoteUid + "_" + role;
    const from = appliedIce.current[key] || 0;
    const fresh = (candidates || []).slice(from);
    if (!fresh.length) return;
    appliedIce.current[key] = from + fresh.length;
    if (!pc.remoteDescription) {
      pendingIce.current[remoteUid] = [...(pendingIce.current[remoteUid] || []), ...fresh];
      return;
    }
    for (const c of fresh) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(_) {} }
  }, []);

  const flushIce = useCallback(async (remoteUid) => {
    const pc = pcsRef.current[remoteUid];
    if (!pc || !pc.remoteDescription) return;
    const queued = pendingIce.current[remoteUid] || [];
    if (!queued.length) return;
    pendingIce.current[remoteUid] = [];
    for (const c of queued) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(_) {} }
  }, []);

  // Build a new RTCPeerConnection for a remote peer
  const makePc = useCallback((remoteUid) => {
    if (pcsRef.current[remoteUid]) return pcsRef.current[remoteUid];
    const pc = new RTCPeerConnection(GVC_ICE);
    pcsRef.current[remoteUid] = pc;
    appliedIce.current[remoteUid + "_caller"] = 0;
    appliedIce.current[remoteUid + "_callee"] = 0;
    pendingIce.current[remoteUid] = [];

    // Add local tracks
    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));

    // Stable per-peer remote stream — audio + video arrive as separate tracks
    const remoteStream = new MediaStream();
    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0] || remoteStream;
      if (!ev.streams?.[0]) {
        ev.track.onunmute = () => { remoteStream.addTrack(ev.track); setPeers(p => ({ ...p, [remoteUid]: { name: dname(remoteUid), stream: remoteStream } })); };
        if (ev.track.readyState === "live") remoteStream.addTrack(ev.track);
      }
      setPeers(p => ({ ...p, [remoteUid]: { name: dname(remoteUid), stream } }));
    };

    pc.onconnectionstatechange = () => {
      if (["disconnected","failed","closed"].includes(pc.connectionState)) {
        try { pc.close(); } catch(_) {}
        delete pcsRef.current[remoteUid];
        setPeers(p => { const n = { ...p }; delete n[remoteUid]; return n; });
      }
    };
    return pc;
  }, []); // eslint-disable-line

  // Caller initiates offer
  const connectAsCaller = useCallback(async (remoteUid) => {
    if (pcsRef.current[remoteUid]) return; // already connected
    const pc = makePc(remoteUid);
    pc.onicecandidate = (ev) => { if (ev.candidate) gvcAddIce(roomId, currentUser, remoteUid, ev.candidate.toJSON(), "caller"); };

    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    await gvcWriteOffer(roomId, currentUser, remoteUid, { type: offer.type, sdp: offer.sdp });

    // Watch for answer + callee ICE
    const unsub = _gvcSigDoc(roomId, currentUser, remoteUid).onSnapshot(async snap => {
      if (!snap.exists) return;
      const d = snap.data();
      if (d.answer && !pc.remoteDescription && pc.signalingState === "have-local-offer") {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
          await flushIce(remoteUid);
          await applyIce(remoteUid, d.calleeIce, "callee");
        } catch(e) { console.warn("[GVC caller SRD]", e.message); }
      } else if (pc.remoteDescription) {
        await applyIce(remoteUid, d.calleeIce, "callee");
      }
    }, () => {});
    unsubsRef.current.push(unsub);
  }, [roomId, currentUser, makePc, applyIce, flushIce]);

  // Callee responds with answer
  const connectAsCallee = useCallback(async (remoteUid, offerData) => {
    if (pcsRef.current[remoteUid]) return;
    const pc = makePc(remoteUid);
    pc.onicecandidate = (ev) => { if (ev.candidate) gvcAddIce(roomId, currentUser, remoteUid, ev.candidate.toJSON(), "callee"); };

    await pc.setRemoteDescription(new RTCSessionDescription(offerData));
    await flushIce(remoteUid);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await gvcWriteAnswer(roomId, remoteUid, currentUser, { type: answer.type, sdp: answer.sdp });

    // Apply any caller ICE already in Firestore + watch for more
    const snap = await _gvcSigDoc(roomId, remoteUid, currentUser).get().catch(() => null);
    if (snap?.exists) await applyIce(remoteUid, snap.data().callerIce, "caller");

    const unsub = _gvcSigDoc(roomId, remoteUid, currentUser).onSnapshot(async snap2 => {
      if (!snap2.exists) return;
      await applyIce(remoteUid, snap2.data().callerIce, "caller");
    }, () => {});
    unsubsRef.current.push(unsub);
  }, [roomId, currentUser, makePc, applyIce, flushIce]);

  useEffect(() => {
    let active = true;
    (async () => {
      // Get camera + mic
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        });
      } catch(e) {
        if (active) { setErrMsg("Camera/mic access denied. Please allow permissions."); setStatus("error"); }
        return;
      }
      if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
      localStreamRef.current = stream;
      if (localVideoRef.current) { localVideoRef.current.srcObject = stream; }

      // Announce presence + heartbeat
      await gvcJoin(roomId, currentUser);
      hbRef.current   = setInterval(() => gvcJoin(roomId, currentUser), 8000);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      if (active) setStatus("active");

      // Watch peers — initiate call to each peer where we are the caller (smaller uid)
      const unsub1 = _gvcPeersCol(roomId).onSnapshot(snap => {
        if (!active) return;
        snap.docs.forEach(d => {
          const uid = d.data().uid;
          if (!uid || uid === currentUser || pcsRef.current[uid]) return;
          if (currentUser < uid) connectAsCaller(uid).catch(e => console.warn("[GVC] caller err:", e.message));
          // Callee path is driven by the signals watcher below
        });
        // Remove peers who left
        const present = new Set(snap.docs.map(d => d.data().uid));
        Object.keys(pcsRef.current).forEach(uid => {
          if (!present.has(uid)) {
            try { pcsRef.current[uid].close(); } catch(_) {}
            delete pcsRef.current[uid];
            setPeers(p => { const n = { ...p }; delete n[uid]; return n; });
          }
        });
      }, () => {});
      unsubsRef.current.push(unsub1);

      // Watch signals for offers addressed to us (callee path)
      const unsub2 = _gvcSigsCol(roomId).onSnapshot(snap => {
        if (!active) return;
        snap.docChanges().forEach(async change => {
          const d = change.doc.data();
          if (!d.offer || d.to !== currentUser) return;
          const remoteUid = d.from;
          if (!remoteUid || remoteUid === currentUser || pcsRef.current[remoteUid]) return;
          try { await connectAsCallee(remoteUid, d.offer); }
          catch(e) { console.warn("[GVC callee err]", e.message); }
        });
      }, () => {});
      unsubsRef.current.push(unsub2);
    })();

    return () => {
      active = false;
      clearInterval(hbRef.current);
      clearInterval(timerRef.current);
      unsubsRef.current.forEach(u => { try { u(); } catch(_) {} });
      Object.values(pcsRef.current).forEach(pc => { try { pc.close(); } catch(_) {} });
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      gvcLeave(roomId, currentUser);
    };
  }, []); // eslint-disable-line

  const toggleMute  = () => { const m = !muted;  localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !m; }); setMuted(m); };
  const toggleVideo = () => { const v = !videoOff; localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !v; }); setVideoOff(v); };
  const fmtDur = s => String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
  const peerList = Object.entries(peers);
  const total    = peerList.length + 1;
  const gridCols = total <= 1 ? 1 : total <= 2 ? 2 : total <= 4 ? 2 : 3;

  if (status === "error") return (
    <div style={{ position:"fixed",inset:0,zIndex:9999,background:"#0d0d0d",display:"flex",alignItems:"center",justifyContent:"center" }}>
      <div style={{ textAlign:"center",color:"white",padding:32 }}>
        <div style={{ fontSize:48,marginBottom:16 }}>📵</div>
        <div style={{ fontWeight:800,fontSize:18,marginBottom:8 }}>Could not start video call</div>
        <div style={{ fontSize:13,color:"rgba(255,255,255,.55)",marginBottom:24 }}>{errMsg}</div>
        <button onClick={onClose} style={{ padding:"10px 24px",borderRadius:12,background:"#ef4444",border:"none",color:"white",fontWeight:700,cursor:"pointer",fontSize:14 }}>Close</button>
      </div>
    </div>
  );

  return (
    <div style={{ position:"fixed",inset:0,zIndex:9999,background:"#0d0d0d",display:"flex",flexDirection:"column" }}>
      <div style={{ padding:"12px 20px",background:"rgba(0,0,0,.65)",display:"flex",alignItems:"center",gap:12,flexShrink:0,backdropFilter:"blur(8px)",borderBottom:"1px solid rgba(255,255,255,.08)" }}>
        <div style={{ fontSize:20 }}>📹</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:900,fontSize:15,color:"white" }}>{label}</div>
          <div style={{ fontSize:11,color:"rgba(255,255,255,.5)",fontFamily:"'DM Mono',monospace" }}>
            {status==="joining"?"Joining…":`${total} participant${total!==1?"s":""} • ${fmtDur(duration)}`}
          </div>
        </div>
        <button onClick={onClose} style={{ background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,padding:"7px 16px",color:"white",fontWeight:700,fontSize:13,cursor:"pointer" }}>Leave</button>
      </div>
      <div style={{ flex:1,display:"grid",gridTemplateColumns:`repeat(${gridCols},1fr)`,gap:4,padding:4,alignContent:"center",overflow:"hidden" }}>
        <div style={{ position:"relative",background:"#1a1a1a",borderRadius:12,overflow:"hidden",aspectRatio:"16/9",display:"flex",alignItems:"center",justifyContent:"center" }}>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width:"100%",height:"100%",objectFit:"cover",display:videoOff?"none":"block" }} />
          {videoOff && <div style={{ fontSize:40,color:"rgba(255,255,255,.25)" }}>📷</div>}
          <div style={{ position:"absolute",bottom:8,left:10,background:"rgba(0,0,0,.65)",borderRadius:8,padding:"3px 9px",fontSize:11,color:"white",fontWeight:700 }}>You{muted?" 🔇":""}</div>
        </div>
        {peerList.map(([uid,{name,stream}]) => <RemoteVideoTile key={uid} name={name} stream={stream} avatarChar={avChar(uid)} />)}
        {total===1 && (
          <div style={{ background:"#111",borderRadius:12,aspectRatio:"16/9",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10 }}>
            <div style={{ fontSize:36,color:"rgba(255,255,255,.12)" }}>👥</div>
            <div style={{ fontSize:12,color:"rgba(255,255,255,.22)",fontWeight:700 }}>Waiting for others to join…</div>
          </div>
        )}
      </div>
      <div style={{ padding:"16px 24px",background:"rgba(0,0,0,.65)",display:"flex",alignItems:"center",justifyContent:"center",gap:24,flexShrink:0,backdropFilter:"blur(8px)" }}>
        <div style={{ textAlign:"center" }}>
          <button onClick={toggleMute} style={{ width:52,height:52,borderRadius:"50%",background:muted?"#ef4444":"rgba(255,255,255,.12)",border:"1.5px solid rgba(255,255,255,.15)",cursor:"pointer",fontSize:22,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 5px" }}>{muted?"🔇":"🎙️"}</button>
          <div style={{ fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:700 }}>{muted?"Unmute":"Mute"}</div>
        </div>
        <div style={{ textAlign:"center" }}>
          <button onClick={toggleVideo} style={{ width:52,height:52,borderRadius:"50%",background:videoOff?"#ef4444":"rgba(255,255,255,.12)",border:"1.5px solid rgba(255,255,255,.15)",cursor:"pointer",fontSize:22,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 5px" }}>{videoOff?"📷":"📹"}</button>
          <div style={{ fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:700 }}>{videoOff?"Start Video":"Stop Video"}</div>
        </div>
        <div style={{ textAlign:"center" }}>
          <button onClick={onClose} style={{ width:62,height:62,borderRadius:"50%",background:"#ef4444",border:"none",cursor:"pointer",fontSize:24,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 5px",boxShadow:"0 4px 16px rgba(239,68,68,.5)" }}>📵</button>
          <div style={{ fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:700 }}>End Call</div>
        </div>
      </div>
    </div>
  );
}

// Stable remote video tile — direct srcObject assignment avoids video freeze

export function RemoteVideoTile({ name, stream, avatarChar }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !stream) return;
    if (vid.srcObject !== stream) { vid.srcObject = stream; vid.play().catch(() => {}); }
  }, [stream]);
  return (
    <div style={{ position:"relative",background:"#1a1a1a",borderRadius:12,overflow:"hidden",aspectRatio:"16/9",display:"flex",alignItems:"center",justifyContent:"center" }}>
      {stream
        ? <video ref={videoRef} autoPlay playsInline style={{ width:"100%",height:"100%",objectFit:"cover" }} />
        : <div style={{ width:60,height:60,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,color:"white",fontWeight:800 }}>{avatarChar}</div>
      }
      <div style={{ position:"absolute",bottom:8,left:10,background:"rgba(0,0,0,.6)",borderRadius:8,padding:"3px 9px",fontSize:11,color:"white",fontWeight:700 }}>{name}</div>
    </div>
  );
}

// ── GroupVideoCallBtn ──────────────────────────────────────────────────────

export function GroupVideoCallBtn({ roomId, label="Video Call", currentUser, style={} }) {
  const [inCall, setInCall] = useState(false);
  return (
    <>
      <button onClick={() => setInCall(true)} title={`Start group video call — ${label}`}
        style={{ background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",border:"none",borderRadius:10,padding:"6px 13px",color:"white",fontSize:12,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",gap:5,boxShadow:"0 2px 8px rgba(59,130,246,.35)",flexShrink:0,...style }}>
        📹 Video Call
      </button>
      {inCall && <GroupVideoCallModal roomId={roomId} label={label} currentUser={currentUser} onClose={() => setInCall(false)} />}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// DmCallModal — 1-on-1 voice/video call via WebRTC + Firestore signalling
//
// Signalling room: group_calls/dm__{safeA}__{safeB}  (reuses gvc infra)
//
// Props:
//   callType    — "voice" | "video"
//   fromUser    — ALWAYS the local/current user's username
//   toUser      — ALWAYS the remote user's username
//   toName      — remote user's display name (shown in UI)
//   toAvatar    — remote user's avatar char
//   isInitiator — TRUE on the side that clicked "Call"; FALSE on callee side
//   onClose
//
// Role logic (stable, explicit — NOT derived from alphabetical order):
//   isInitiator=true  → CALLER:  creates offer, writes call signal to notify callee
//   isInitiator=false → CALLEE:  reads offer, creates answer
//
// Firestore ICE field naming: "callerIce" belongs to whoever is alphabetically
// smaller (gvcWriteOffer decides this). We must map our role to that correctly.
// ════════════════════════════════════════════════════════════════════════

export function DmCallModal({ callType, fromUser, toUser, toName, toAvatar, isInitiator, onClose }) {
  const videoOnly = callType === "video";
  const myUid     = fromUser;    // local user
  const remoteUid = toUser;      // remote user

  // Caller's OWN display name + avatar for the call signal notification
  const _myInfo = (() => {
    try {
      const users = JSON.parse(localStorage.getItem("nv-users") || "[]");
      const me = users.find(u => u.username === fromUser);
      return {
        name:   me?.displayName || fromUser.split("@")[0],
        avatar: me?.avatar      || (fromUser[0] || "?").toUpperCase(),
      };
    } catch(_) {
      return { name: fromUser.split("@")[0], avatar: (fromUser[0]||"?").toUpperCase() };
    }
  })();
  const myName   = _myInfo.name;
  const myAvatar = _myInfo.avatar;

  // Stable room id — same on both sides
  const roomId = "dm__" + _gvcPairId(myUid, remoteUid);

  // Map our explicit role to the Firestore ICE field names.
  // gvcWriteOffer always stores callerIce for the alpha-smaller uid.
  // If I'm the initiator but alpha-larger, my ICE still goes to "calleeIce"
  // from Firestore's perspective — so we just always use alpha order for fields.
  const iAmAlphaSmaller = myUid < remoteUid;
  const myIceRole      = iAmAlphaSmaller ? "caller" : "callee";   // ICE role I write as
  const remoteIceRole  = iAmAlphaSmaller ? "callee" : "caller";   // ICE role remote writes as
  const remoteIceField = iAmAlphaSmaller ? "calleeIce" : "callerIce"; // Firestore field to READ

  const [muted,        setMuted]        = useState(false);
  const [videoOff,     setVideoOff]     = useState(!videoOnly);
  const [status,       setStatus]       = useState("connecting");
  const [duration,     setDuration]     = useState(0);
  const [errMsg,       setErrMsg]       = useState("");
  const [remoteStream, setRemoteStream] = useState(null);

  const localStreamRef = useRef(null);
  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef          = useRef(null);
  const unsubsRef      = useRef([]);
  const timerRef       = useRef(null);
  const appliedRef     = useRef({ caller: 0, callee: 0 });
  const pendingRef     = useRef([]);
  const answeredRef    = useRef(false); // callee: prevent double-answer

  // Attach remote stream to video element
  useEffect(() => {
    const vid = remoteVideoRef.current;
    if (!vid || !remoteStream) return;
    if (vid.srcObject !== remoteStream) { vid.srcObject = remoteStream; vid.play().catch(() => {}); }
  }, [remoteStream]);

  // Attach local stream to self-preview
  useEffect(() => {
    const vid = localVideoRef.current;
    if (!vid || !localStreamRef.current) return;
    if (vid.srcObject !== localStreamRef.current) { vid.srcObject = localStreamRef.current; vid.play().catch(() => {}); }
  });

  // Queue-aware ICE application
  const applyIce = async (candidates, role) => {
    const pc = pcRef.current;
    if (!pc || pc.signalingState === "closed") return;
    const key   = role; // "caller" | "callee"
    const start = appliedRef.current[key] || 0;
    const fresh = (candidates || []).slice(start);
    if (!fresh.length) return;
    appliedRef.current[key] = start + fresh.length;
    if (!pc.remoteDescription) { pendingRef.current.push(...fresh); return; }
    for (const c of fresh) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(_) {} }
  };

  const flushIce = async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    const all = [...pendingRef.current];
    pendingRef.current = [];
    for (const c of all) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(_) {} }
  };

  const startTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      // 1. Acquire media
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: videoOnly ? {   width:     { ideal: 1280, max: 1280 },   height:    { ideal: 720,  max: 720  },   frameRate: { ideal: 30,   max: 30   },   facingMode: "user", } : false,
        });
      } catch(e) {
        if (active) { setErrMsg(e.message || "Camera/mic denied"); setStatus("error"); }
        return;
      }
      if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
      localStreamRef.current = stream;
      stream.getVideoTracks().forEach(t => { t.enabled = videoOnly; });

      // 2. Build RTCPeerConnection
      const pc = new RTCPeerConnection(GVC_ICE);
      pcRef.current = pc;
      // Apply low-latency encoding: low start bitrate ramps up fast,       // prioritise latency over throughput       pc.getSenders().forEach(sender => {         if (sender.track?.kind === "video") {           const params = sender.getParameters();           if (!params.encodings || params.encodings.length === 0) {             params.encodings = [{}];           }           params.encodings[0] = {             ...params.encodings[0],             maxBitrate:         2_000_000,   // 2 Mbps ceiling             maxFramerate:       30,             networkPriority:    "high",             priority:           "high",             scaleResolutionDownBy: 1.0,           };           sender.setParameters(params).catch(() => {});         }         if (sender.track?.kind === "audio") {           const params = sender.getParameters();           if (!params.encodings || params.encodings.length === 0) {             params.encodings = [{}];           }           params.encodings[0] = {             ...params.encodings[0],             maxBitrate:      128_000,   // 128 kbps for crisp audio             networkPriority: "very-high",             priority:        "very-high",           };           sender.setParameters(params).catch(() => {});         }       });

      // Use a ref to track live status — avoids stale closure in callbacks
      const liveRef = { current: false };

      // Remote track handler — accumulate tracks into one stable MediaStream
      const rs = new MediaStream();
      pc.ontrack = (ev) => {
        if (!active) return;
        if (ev.streams?.[0]) {
          setRemoteStream(ev.streams[0]);
        } else {
          rs.addTrack(ev.track);
          ev.track.onunmute = () => setRemoteStream(new MediaStream(rs.getTracks()));
          if (ev.track.readyState === "live") setRemoteStream(new MediaStream(rs.getTracks()));
        }
        if (!liveRef.current) {
          liveRef.current = true;
          setStatus("live");
          startTimer();
        }
      };

      pc.onconnectionstatechange = () => {
        if (!active) return;
        if (pc.connectionState === "connected" && !liveRef.current) {
          liveRef.current = true;
          setStatus("live");
          startTimer();
          // Re-apply encoding params now that ICE is done — this is when they actually take effect
          pc.getSenders().forEach(sender => {
            const params = sender.getParameters();
            if (!params.encodings?.length) return;
            if (sender.track?.kind === "video") {
              params.encodings[0].maxBitrate      = 2_000_000;
              params.encodings[0].maxFramerate     = 30;
              params.encodings[0].networkPriority  = "high";
              params.encodings[0].priority         = "high";
            }
            if (sender.track?.kind === "audio") {
              params.encodings[0].maxBitrate       = 128_000;
              params.encodings[0].networkPriority  = "very-high";
              params.encodings[0].priority         = "very-high";
            }
            sender.setParameters(params).catch(() => {});
          });
        }
        if (["disconnected","failed","closed"].includes(pc.connectionState)) setStatus("ended");
      };

      // 3. Signalling — role is EXPLICIT via isInitiator prop (not alphabetical)
      if (isInitiator) {
        // ── CALLER PATH ──────────────────────────────────────────────
        pc.onicecandidate = (ev) => {
          if (ev.candidate) gvcAddIce(roomId, myUid, remoteUid, ev.candidate.toJSON(), myIceRole);
        };

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: videoOnly,
        });
        await pc.setLocalDescription(offer);
        await gvcWriteOffer(roomId, myUid, remoteUid, { type: offer.type, sdp: offer.sdp });
        if (active) setStatus("ringing");

        // Notify the callee — pass CALLER's own name/avatar so banner shows correctly
        writeCallSignal(myUid, remoteUid, callType, myName, myAvatar, roomId);
        pushUserNotif(remoteUid, {
          id: "call_" + Date.now(), type: "call",
          title: (callType==="video"?"📹":"📞") + " Incoming " + (callType==="video"?"video":"voice") + " call",
          body: "from " + myName, from: myUid, callType, ts: Date.now(), read: false,
        });

        const unsub = _gvcSigDoc(roomId, myUid, remoteUid).onSnapshot(async snap => {
          if (!snap.exists || !active) return;
          const d = snap.data();
          // Callee declined — stop ringing
          // Callee declined — stop ringing
          if (d.declined && !liveRef.current && status === "ringing") {
            setStatus("ended");
            setTimeout(() => { if (active) onClose(); }, 1500);
            return;
          }
          if (d.answer && !pc.remoteDescription && pc.signalingState === "have-local-offer") {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
              await flushIce();
              await applyIce(d[remoteIceField], remoteIceRole);
            } catch(e) { console.warn("[DmCall caller SRD]", e.message); }
          } else if (pc.remoteDescription) {
            await applyIce(d[remoteIceField], remoteIceRole);
          }
        }, () => {});
        unsubsRef.current.push(unsub);
      } else {
        // ── CALLEE PATH ───────────────────────────────────────────────
        pc.onicecandidate = (ev) => {
          if (ev.candidate) gvcAddIce(roomId, myUid, remoteUid, ev.candidate.toJSON(), myIceRole);
        };

        if (active) setStatus("connecting");

        const doAnswer = async () => {
          if (!active || answeredRef.current) return;
          // Doc id is always alpha-sorted — same as roomId lookup
          const snap = await _gvcSigDoc(roomId, myUid, remoteUid).get().catch(() => null);
          if (!snap?.exists) return;
          const d = snap.data();
          if (!d.offer || answeredRef.current) return;
          answeredRef.current = true;

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
            await flushIce();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await gvcWriteAnswer(roomId, myUid, remoteUid, { type: answer.type, sdp: answer.sdp });
            await applyIce(d[remoteIceField], remoteIceRole);

            // Watch for further caller ICE updates
            const unsub = _gvcSigDoc(roomId, myUid, remoteUid).onSnapshot(async snap2 => {
              if (!snap2.exists || !active) return;
              await applyIce(snap2.data()[remoteIceField], remoteIceRole);
            }, () => {});
            unsubsRef.current.push(unsub);
          } catch(e) { console.warn("[DmCall callee SRD]", e.message); }
        };

        // Try immediately, then watch for the offer to arrive
        await doAnswer();
        const unsub = _gvcSigDoc(roomId, myUid, remoteUid).onSnapshot(async snap => {
          if (!snap.exists || !active || answeredRef.current) return;
          if (snap.data().offer) await doAnswer();
        }, () => {});
        unsubsRef.current.push(unsub);
      }
    })();

    return () => {
      active = false;
      clearInterval(timerRef.current);
      unsubsRef.current.forEach(u => { try { u(); } catch(_) {} });
      try { pcRef.current?.close(); } catch(_) {}
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      // Clean up: clear call signals on both sides and delete signalling doc
      clearCallSignal(myUid, roomId);
      clearCallSignal(remoteUid, roomId);
      _loadFirebase().then(ok => {
        if (!ok) return;
        try { _gvcSigDoc(roomId, myUid, remoteUid).set({ ended: true }, { merge: true }).catch(() => {}); } catch(_) {}
      });
    };
  }, []); // eslint-disable-line

  const toggleMute  = () => { const m = !muted;  localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !m;  }); setMuted(m);  };
  const toggleVideo = () => { const v = !videoOff; localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !v; }); setVideoOff(v); };
  const fmtDur = s => String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
  const isVoiceOnly = !videoOnly || videoOff;

  if (status === "error") return (
    <div style={{ position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.93)",display:"flex",alignItems:"center",justifyContent:"center" }}>
      <div style={{ textAlign:"center",color:"white",padding:32,maxWidth:320 }}>
        <div style={{ fontSize:52,marginBottom:16 }}>📵</div>
        <div style={{ fontWeight:800,fontSize:18,marginBottom:8 }}>Call failed</div>
        <div style={{ fontSize:13,color:"rgba(255,255,255,.55)",marginBottom:24 }}>{errMsg}</div>
        <button onClick={onClose} style={{ padding:"10px 24px",borderRadius:12,background:"#ef4444",border:"none",color:"white",fontWeight:700,cursor:"pointer",fontSize:14 }}>Close</button>
      </div>
    </div>
  );

  return (
    <div style={{ position:"fixed",inset:0,zIndex:9999,background:"#0d0d0d",display:"flex",flexDirection:"column" }}>
      {/* Top bar */}
      <div style={{ padding:"14px 20px",background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",gap:14,flexShrink:0,backdropFilter:"blur(10px)",borderBottom:"1px solid rgba(255,255,255,.08)" }}>
        <div style={{ fontSize:22 }}>{videoOnly?"📹":"📞"}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:900,fontSize:15,color:"white" }}>{toName}</div>
          <div style={{ fontSize:11,color:"rgba(255,255,255,.5)",fontFamily:"'DM Mono',monospace" }}>
            {status==="connecting"?"Connecting…":status==="ringing"?"Ringing…":status==="live"?fmtDur(duration):status==="ended"?"Call ended":""}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex:1,position:"relative",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden" }}>
        {remoteStream && !isVoiceOnly
          ? <video ref={remoteVideoRef} autoPlay playsInline style={{ width:"100%",height:"100%",objectFit:"cover" }} />
          : (
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:20 }}>
              <div style={{ width:100,height:100,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent,#0077b6),var(--accent2,#6366f1))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:44,fontWeight:900,color:"white",boxShadow:"0 0 0 6px rgba(255,255,255,.08),0 0 40px rgba(14,165,233,.25)" }}>
                {toAvatar}
              </div>
              <div style={{ fontWeight:800,fontSize:20,color:"white" }}>{toName}</div>
              {(status==="ringing"||status==="connecting") && (
                <div style={{ display:"flex",gap:8 }}>
                  {[0,1,2].map(i=><div key={i} style={{ width:10,height:10,borderRadius:"50%",background:"rgba(255,255,255,.5)",animation:`dmCallPulse 1.2s ${i*0.2}s ease-in-out infinite` }} />)}
                </div>
              )}
              {status==="live"     && <div style={{ fontSize:13,color:"rgba(255,255,255,.55)",fontFamily:"'DM Mono',monospace" }}>{fmtDur(duration)}</div>}
              {status==="ended"    && <div style={{ fontSize:14,color:"rgba(255,255,255,.45)" }}>Call ended</div>}
            </div>
          )
        }
        {/* Self-preview PiP for video calls */}
        {videoOnly && !videoOff && (
          <div style={{ position:"absolute",bottom:90,right:16,width:110,height:78,borderRadius:12,overflow:"hidden",border:"2px solid rgba(255,255,255,.2)",background:"#111",boxShadow:"0 4px 20px rgba(0,0,0,.5)" }}>
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width:"100%",height:"100%",objectFit:"cover" }} />
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ padding:"20px 24px 28px",background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",gap:28,flexShrink:0,backdropFilter:"blur(10px)" }}>
        <div style={{ textAlign:"center" }}>
          <button onClick={toggleMute} style={{ width:56,height:56,borderRadius:"50%",background:muted?"#ef4444":"rgba(255,255,255,.14)",border:"1.5px solid rgba(255,255,255,.18)",cursor:"pointer",fontSize:24,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 6px" }}>{muted?"🔇":"🎙️"}</button>
          <div style={{ fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:700 }}>{muted?"Unmute":"Mute"}</div>
        </div>
        {videoOnly && (
          <div style={{ textAlign:"center" }}>
            <button onClick={toggleVideo} style={{ width:56,height:56,borderRadius:"50%",background:videoOff?"#ef4444":"rgba(255,255,255,.14)",border:"1.5px solid rgba(255,255,255,.18)",cursor:"pointer",fontSize:24,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 6px" }}>{videoOff?"📷":"📹"}</button>
            <div style={{ fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:700 }}>{videoOff?"Camera On":"Camera Off"}</div>
          </div>
        )}
        <div style={{ textAlign:"center" }}>
          <button onClick={onClose} style={{ width:66,height:66,borderRadius:"50%",background:"#ef4444",border:"none",cursor:"pointer",fontSize:26,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 6px",boxShadow:"0 4px 18px rgba(239,68,68,.55)" }}>📵</button>
          <div style={{ fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:700 }}>End Call</div>
        </div>
      </div>

      <style>{`@keyframes dmCallPulse{0%,100%{opacity:.25;transform:scale(.85);}50%{opacity:1;transform:scale(1.2);}}`}</style>
    </div>
  );
}

export function IncomingCallBanner({ call, onAnswer, onDecline }) {
  const { callType, callerName, callerAvatar } = call;
  const isVideo = callType === "video";
  return (
    <div style={{
      position:"fixed", inset:0, zIndex:10000,
      background:"rgba(0,0,0,.82)", backdropFilter:"blur(12px)",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      animation:"fadeInCall .3s ease",
    }}>
      <style>{`
        @keyframes fadeInCall { from { opacity:0; transform:scale(.94); } to { opacity:1; transform:scale(1); } }
        @keyframes ringPulse { 0%,100% { box-shadow:0 0 0 0 rgba(34,197,94,.5); } 60% { box-shadow:0 0 0 24px rgba(34,197,94,0); } }
      `}</style>
      {/* Avatar */}
      <div style={{
        width:96, height:96, borderRadius:"50%",
        background:"linear-gradient(135deg,var(--accent,#0077b6),var(--accent2,#6366f1))",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:42, fontWeight:900, color:"white",
        animation:"ringPulse 1.4s ease-in-out infinite",
        marginBottom:20,
      }}>{callerAvatar}</div>

      <div style={{ fontSize:13, color:"rgba(255,255,255,.55)", marginBottom:4, letterSpacing:1, textTransform:"uppercase", fontWeight:700 }}>
        Incoming {isVideo ? "Video" : "Voice"} Call
      </div>
      <div style={{ fontSize:24, fontWeight:900, color:"white", marginBottom:32 }}>{callerName}</div>

      {/* Animated dots */}
      <div style={{ display:"flex", gap:8, marginBottom:40 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width:9,height:9,borderRadius:"50%",background:"rgba(255,255,255,.4)",
            animation:`dmCallPulse 1.2s ${i*0.18}s ease-in-out infinite` }} />
        ))}
      </div>

      {/* Buttons */}
      <div style={{ display:"flex", gap:48, alignItems:"center" }}>
        {/* Decline */}
        <div style={{ textAlign:"center" }}>
          <button onClick={onDecline} style={{
            width:68, height:68, borderRadius:"50%", background:"#ef4444", border:"none",
            cursor:"pointer", fontSize:28, display:"flex", alignItems:"center", justifyContent:"center",
            margin:"0 auto 8px", boxShadow:"0 4px 20px rgba(239,68,68,.55)",
            transition:"transform .15s",
          }}
          onMouseEnter={e=>e.currentTarget.style.transform="scale(1.1)"}
          onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}
          >📵</button>
          <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", fontWeight:700 }}>Decline</div>
        </div>
        {/* Answer */}
        <div style={{ textAlign:"center" }}>
          <button onClick={onAnswer} style={{
            width:68, height:68, borderRadius:"50%", background:"#22c55e", border:"none",
            cursor:"pointer", fontSize:28, display:"flex", alignItems:"center", justifyContent:"center",
            margin:"0 auto 8px", boxShadow:"0 4px 20px rgba(34,197,94,.55)",
            transition:"transform .15s",
          }}
          onMouseEnter={e=>e.currentTarget.style.transform="scale(1.1)"}
          onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}
          >{isVideo ? "📹" : "📞"}</button>
          <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", fontWeight:700 }}>Answer</div>
        </div>
      </div>
    </div>
  );
}
