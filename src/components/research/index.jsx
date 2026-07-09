import { useState, useEffect, useRef } from "react";
import { PAYSTACK_PUBLIC_KEY } from "../../config/keys";
import { DEFAULT_CLASSES } from "../../data/defaults";
import { _loadFirebase, rcGetMembers, rcSaveMembers, rcSend, rcSubscribe, rrSave, rrSubscribeMine } from "../../services/backend";
import { loadPaystack } from "../../services/paystackService";
import { ls } from "../../utils/storage";
import { Messages } from "../../components/messaging";
import { GroupVideoCallBtn } from "../../components/video-call";
import { RR_STATUSES } from "../../shared/researchStatuses";

export function RRPayButton({ price, reqId, topic, projectFile, currentUser, studentName, onSuccess, toast }) {
  const [paying, setPaying] = React.useState(false);

  const handlePay = () => {
    if (paying) return;
    setPaying(true);

    loadPaystack().then(() => {
      const amountKobo = Math.round(Number(price) * 100);
      const ref = "RR" + Date.now();

      const handler = window.PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: currentUser,
        amount: amountKobo,
        currency: "NGN",
        ref: ref,
        onClose: function() {
          setPaying(false);
        },
        callback: function(response) {
          setPaying(false);
          onSuccess(response.reference);
          // Trigger download after short delay
          setTimeout(function() {
            const a = document.createElement("a");
            a.href = projectFile;
            a.download = topic.slice(0, 40) + ".pdf";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }, 800);
        }
      });

      handler.openIframe();
    }).catch(function(e) {
      setPaying(false);
      toast("Could not load payment. Check your connection and try again.", "error");
    });
  };

  return (
    <div
      onClick={handlePay}
      style={{
        display:"inline-flex",alignItems:"center",justifyContent:"center",gap:12,
        padding:"15px 28px",borderRadius:12,cursor:paying?"wait":"pointer",
        background: paying ? "rgba(11,164,219,.5)" : "linear-gradient(135deg,#0ba4db,#0077a8)",
        boxShadow:"0 4px 16px rgba(11,164,219,.3)",
        transition:"transform .15s,box-shadow .15s",
        opacity: paying ? 0.8 : 1,
      }}
      onMouseEnter={e=>{ if(!paying){ e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow="0 8px 24px rgba(11,164,219,.4)"; }}}
      onMouseLeave={e=>{ e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="0 4px 16px rgba(11,164,219,.3)"; }}
    >
      <div style={{width:38,height:38,borderRadius:"50%",background:"white",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:10,color:"#0ba4db",flexShrink:0}}>
        {paying ? "⏳" : "PSK"}
      </div>
      <div style={{textAlign:"left"}}>
        <div style={{color:"white",fontWeight:900,fontSize:15}}>
          {paying ? "Opening payment…" : "Pay ₦" + Number(price).toLocaleString() + " & Download"}
        </div>
        <div style={{color:"rgba(255,255,255,.8)",fontSize:11}}>
          Secure Paystack • Instant download after payment
        </div>
      </div>
    </div>
  );
}

export function ResearchRequestPage({ currentUser, toast }) {
  const allUsers = ls("nv-users", []);
  const me = allUsers.find(u => u.username === currentUser) || {};
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const myClass = classes.find(c => c.id === me.class);

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState(null); // view detail
  const [accepting, setAccepting] = useState(false);

  const blank = { topic:"", level:"", deadline:"", phone:"", notes:"" };
  const [form, setForm] = useState(blank);

  useEffect(() => {
    let unsub = () => {};
    // Wait for Firebase to be ready before subscribing
    _loadFirebase().then(() => {
      unsub = rrSubscribeMine(currentUser, data => {
        setRequests(data);
        setLoading(false);
      });
    }).catch(() => setLoading(false));
    return () => unsub();
  }, [currentUser]);

  const submit = async () => {
    if (!form.topic.trim()) return toast("Enter your research topic","error");
    if (!form.phone.trim()) return toast("Enter your contact phone number","error");
    setSubmitting(true);
    const req = {
      id: "rr_" + Date.now() + "_" + Math.random().toString(36).slice(2,6),
      student: currentUser,
      studentName: me.displayName || currentUser.split("@")[0],
      studentClass: myClass?.label || me.class || "—",
      matricNumber: me.matricNumber || me.matric || "—",
      topic: form.topic.trim(),
      level: form.level.trim() || myClass?.label || "—",
      deadline: form.deadline,
      phone: form.phone.trim(),
      notes: form.notes.trim(),
      status: "pending",
      createdAt: Date.now(),
      price: null,
      adminNote: "",
      projectFile: null,
    };
    const ok = await rrSave(req);
    setSubmitting(false);
    if (ok) {
      toast("✅ Request submitted! Admin will review and send you a quote.","success");
      setForm(blank);
      setShowForm(false);
    } else {
      toast("Failed to submit — check your connection","error");
    }
  };

  const acceptQuote = async (req) => {
    setAccepting(true);
    const updated = { ...req, status:"accepted", acceptedAt: Date.now() };
    const ok = await rrSave(updated);
    setAccepting(false);
    if (ok) { toast("✅ Quote accepted! Admin will begin your project.","success"); setSelected(updated); }
    else toast("Failed — try again","error");
  };

  const declineQuote = async (req) => {
    if (!window.confirm("Decline this quote? The request will be closed.")) return;
    const updated = { ...req, status:"declined", declinedAt: Date.now() };
    await rrSave(updated);
    toast("Request declined","success");
    setSelected(null);
  };

  const StatusBadge = ({ status }) => {
    const s = RR_STATUSES[status] || RR_STATUSES.pending;
    return (
      <span style={{
        background:s.bg, color:s.color, border:`1px solid ${s.color}44`,
        borderRadius:20, padding:"3px 10px", fontSize:11, fontWeight:800
      }}>{s.icon} {s.label}</span>
    );
  };

  // ── Detail modal ──
  if (selected) {
    const live = requests.find(r => r.id === selected.id) || selected;
    const s = RR_STATUSES[live.status] || RR_STATUSES.pending;
    return (
      <div style={{maxWidth:600,margin:"0 auto",paddingBottom:40}}>
        <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--accent)",fontWeight:700,fontSize:13,marginBottom:16,padding:0}}>← Back to My Requests</button>
        <div style={{background:"var(--card)",border:`2px solid ${s.color}44`,borderRadius:18,padding:24}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontWeight:900,fontSize:17,color:"var(--text)",marginBottom:6}}>{live.topic}</div>
              <StatusBadge status={live.status} />
            </div>
            <div style={{fontSize:11,color:"var(--text3)"}}>Submitted {new Date(live.createdAt).toLocaleDateString()}</div>
          </div>

          {/* Details grid */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            {[
              ["Programme/Level", live.level],
              ["Deadline", live.deadline ? new Date(live.deadline).toLocaleDateString() : "—"],
              ["Phone", live.phone],
              ["Matric No.", live.matricNumber],
            ].map(([k,v])=>(
              <div key={k} style={{background:"var(--bg4)",borderRadius:10,padding:"10px 14px"}}>
                <div style={{fontSize:10,color:"var(--text3)",fontWeight:700,textTransform:"uppercase",marginBottom:3}}>{k}</div>
                <div style={{fontWeight:700,fontSize:13}}>{v}</div>
              </div>
            ))}
          </div>

          {live.notes && (
            <div style={{background:"var(--bg4)",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
              <div style={{fontSize:10,color:"var(--text3)",fontWeight:700,textTransform:"uppercase",marginBottom:3}}>Additional Notes</div>
              <div style={{fontSize:13,fontWeight:700}}>{live.notes}</div>
            </div>
          )}

          {/* Quote section */}
          {(() => {
            // Always pull live data so admin quote shows up immediately
            const live = requests.find(r => r.id === selected.id) || selected;

            return (<>
              {/* Quote section — shown as soon as admin sets a price */}
              {live.price ? (
                <div style={{
                  background:"linear-gradient(135deg,rgba(59,130,246,.12),rgba(139,92,246,.08))",
                  border:"1.5px solid rgba(59,130,246,.3)",
                  borderRadius:14, padding:"16px 18px", marginBottom:16
                }}>
                  <div style={{fontWeight:900,fontSize:15,color:"#3b82f6",marginBottom:6}}>💰 Admin Quote</div>
                  <div style={{fontWeight:900,fontSize:28,color:"var(--text)",marginBottom:6}}>₦{Number(live.price).toLocaleString()}</div>
                  {live.adminNote && (
                    <div style={{
                      background:"rgba(59,130,246,.08)",borderRadius:10,
                      padding:"10px 14px",marginBottom:10,
                      fontSize:13,color:"var(--text)",fontWeight:600,
                      borderLeft:"3px solid #3b82f6"
                    }}>
                      💬 <b>Message from Admin:</b> {live.adminNote}
                    </div>
                  )}
                  {/* Info: payment happens at download stage */}
                  <div style={{
                    background:"rgba(245,158,11,.08)",borderRadius:10,
                    padding:"9px 14px",marginBottom:10,marginTop:6,
                    fontSize:12,color:"#b45309",fontWeight:600,
                    borderLeft:"3px solid #f59e0b"
                  }}>
                    💡 Payment will be required when you download the completed project.
                  </div>
                  {live.status === "quoted" && (
                    <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:14}}>
                      {/* Accept quote */}
                      <button
                        onClick={()=>acceptQuote(live)}
                        disabled={accepting}
                        style={{width:"100%",padding:"13px",borderRadius:10,background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",border:"none",cursor:"pointer",fontWeight:800,fontSize:14,opacity:accepting?0.7:1}}
                      >{accepting?"⏳ Accepting…":"✅ Accept Quote"}</button>
                      {/* Decline */}
                      <button
                        onClick={()=>declineQuote(live)}
                        style={{width:"100%",padding:"11px",borderRadius:10,background:"rgba(239,68,68,.07)",color:"var(--danger)",border:"1px solid rgba(239,68,68,.25)",cursor:"pointer",fontWeight:700,fontSize:13}}
                      >❌ Decline Request</button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  background:"rgba(245,158,11,.06)",border:"1.5px dashed rgba(245,158,11,.3)",
                  borderRadius:14,padding:"16px 18px",marginBottom:16,textAlign:"center"
                }}>
                  <div style={{fontSize:24,marginBottom:6}}>⏳</div>
                  <div style={{fontWeight:700,color:"var(--text3)",fontSize:13}}>Waiting for admin to send a quote…</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>You'll see the price and message here once admin reviews your topic.</div>
                </div>
              )}

              {/* Completed — payment-gated download */}
              {live.status === "completed" && live.projectFile && (
                <div style={{
                  background:"rgba(34,197,94,.08)",border:"1.5px solid rgba(34,197,94,.3)",
                  borderRadius:14,padding:"20px 18px",marginBottom:16,textAlign:"center"
                }}>
                  <div style={{fontSize:36,marginBottom:8}}>🎉</div>
                  <div style={{fontWeight:900,fontSize:16,color:"var(--success)",marginBottom:4}}>Your project is ready!</div>

                  {live.paid ? (
                    <>
                      <div style={{
                        background:"rgba(34,197,94,.12)",border:"1px solid rgba(34,197,94,.3)",
                        borderRadius:10,padding:"8px 14px",marginBottom:14,
                        fontSize:12,color:"var(--success)",fontWeight:700,
                        display:"inline-flex",alignItems:"center",gap:6
                      }}>
                        ✅ Payment confirmed • Ref: {live.paymentRef}
                      </div>
                      <br/>
                      <a
                        href={live.projectFile}
                        download={live.topic.slice(0,40) + ".pdf"}
                        style={{
                          display:"inline-flex",alignItems:"center",gap:10,
                          padding:"14px 32px",borderRadius:12,marginTop:4,
                          background:"linear-gradient(135deg,#22c55e,#16a34a)",
                          color:"#fff",fontWeight:800,fontSize:15,textDecoration:"none",
                          boxShadow:"0 4px 16px rgba(34,197,94,.35)"
                        }}
                      >📥 Download Project</a>
                    </>
                  ) : (
                    <>
                      <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>
                        Pay ₦{Number(live.price).toLocaleString()} to unlock your download
                      </div>
                      <div style={{
                        display:"inline-flex",alignItems:"center",gap:10,
                        padding:"12px 28px",borderRadius:12,marginBottom:14,
                        background:"rgba(0,0,0,.06)",border:"2px dashed rgba(0,0,0,.12)",
                        color:"var(--text3)",fontWeight:800,fontSize:14,cursor:"not-allowed"
                      }}>🔒 Download Locked</div>
                      <br/>
                      <RRPayButton
                        price={live.price}
                        reqId={live.id}
                        topic={live.topic}
                        projectFile={live.projectFile}
                        currentUser={currentUser}
                        studentName={me.displayName || currentUser.split("@")[0]}
                        onSuccess={(ref) => {
                          const updated = {
                            ...live,
                            paid: true,
                            paymentRef: ref,
                            paymentAmount: Number(live.price),
                            paidAt: Date.now(),
                          };
                          rrSave(updated);
                          toast("✅ Payment confirmed! Downloading your project…", "success");
                        }}
                        toast={toast}
                      />
                    </>
                  )}
                </div>
              )}

              {/* Status timeline */}
              <div style={{marginTop:16}}>
                <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,textTransform:"uppercase",marginBottom:10}}>Request Timeline</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {[
                    ["pending","⏳","Request submitted",live.createdAt],
                    live.price ? ["quoted","💰","Quote sent by admin",live.quotedAt] : null,
                    live.acceptedAt ? ["accepted","✅","Quote accepted",live.acceptedAt] : null,
                    live.startedAt ? ["inprogress","🔄","Work started",live.startedAt] : null,
                    live.completedAt ? ["completed","🎉","Project completed",live.completedAt] : null,
                    live.declinedAt ? ["declined","❌","Declined",live.declinedAt] : null,
                  ].filter(Boolean).map(([st,ic,lbl,ts])=>(
                    <div key={st} style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:28,height:28,borderRadius:"50%",background:(RR_STATUSES[st]||RR_STATUSES.pending).bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{ic}</div>
                      <div style={{flex:1,fontSize:12,fontWeight:700}}>{lbl}</div>
                      <div style={{fontSize:11,color:"var(--text3)"}}>{ts?new Date(ts).toLocaleDateString():""}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>);
          })()}
        </div>
      </div>
    );
  }

  return (
    <div style={{maxWidth:680,margin:"0 auto",paddingBottom:40}}>
      {/* Header */}
      <div style={{
        background:"linear-gradient(135deg,#1e3a5f,#0f2847)",
        borderRadius:18, padding:"24px 28px", marginBottom:24, color:"#fff",
        position:"relative", overflow:"hidden"
      }}>
        <div style={{position:"absolute",right:-20,top:-20,fontSize:120,opacity:.06}}>📜</div>
        <div style={{fontSize:13,opacity:.7,marginBottom:4}}>Academic Services</div>
        <div style={{fontWeight:900,fontSize:22,marginBottom:6}}>📜 Research Project Request</div>
        <div style={{fontSize:13,opacity:.8}}>Submit your research topic and get a professional project written by our academic team.</div>
        <button
          onClick={()=>setShowForm(true)}
          style={{
            marginTop:16,padding:"11px 24px",borderRadius:10,
            background:"linear-gradient(135deg,#f59e0b,#d97706)",
            color:"#fff",border:"none",cursor:"pointer",fontWeight:800,fontSize:14,
            boxShadow:"0 4px 14px rgba(245,158,11,.4)"
          }}
        >+ New Request</button>
      </div>

      {/* New Request Form */}
      {showForm && (
        <div style={{background:"var(--card)",border:"2px solid rgba(245,158,11,.3)",borderRadius:16,padding:24,marginBottom:24}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontWeight:900,fontSize:16}}>📋 New Research Request</div>
            <button onClick={()=>{setShowForm(false);setForm(blank);}} style={{background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:20}}>✕</button>
          </div>

          <label className="lbl">Research Topic *</label>
          <input className="inp" value={form.topic} onChange={e=>setForm({...form,topic:e.target.value})}
            placeholder="e.g. The Effect of Malaria on Pregnant Women in Rural Areas" />

          <label className="lbl">Programme / Level</label>
          <input className="inp" value={form.level} onChange={e=>setForm({...form,level:e.target.value})}
            placeholder={myClass?.label || "e.g. BNSc Year 3"} />

          <label className="lbl">Deadline</label>
          <input className="inp" type="date" value={form.deadline} onChange={e=>setForm({...form,deadline:e.target.value})}
            min={new Date().toISOString().split("T")[0]} />

          <label className="lbl">Contact Phone Number *</label>
          <input className="inp" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}
            placeholder="e.g. 08012345678" type="tel" />

          <label className="lbl">Additional Instructions (optional)</label>
          <textarea className="inp" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}
            placeholder="Any specific requirements, chapters needed, referencing style, etc."
            style={{minHeight:80,resize:"vertical"}} />

          {/* Auto-filled info */}
          <div style={{background:"rgba(34,197,94,.06)",border:"1px solid rgba(34,197,94,.2)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12,color:"var(--text3)"}}>
            ℹ️ Your name (<b style={{color:"var(--text)"}}>{me.displayName||currentUser.split("@")[0]}</b>), matric number, and class will be attached automatically.
          </div>

          <button
            onClick={submit}
            disabled={submitting}
            style={{width:"100%",padding:"14px",borderRadius:10,background:"linear-gradient(135deg,#1e3a5f,#0f2847)",color:"#fff",border:"none",cursor:"pointer",fontWeight:800,fontSize:15,opacity:submitting?0.7:1}}
          >{submitting?"⏳ Submitting…":"📤 Submit Request"}</button>
        </div>
      )}

      {/* My Requests List */}
      <div style={{fontWeight:800,fontSize:16,marginBottom:14}}>My Requests ({requests.length})</div>
      {loading && <div style={{textAlign:"center",padding:40,color:"var(--text3)"}}>Loading…</div>}
      {!loading && requests.length===0 && (
        <div style={{textAlign:"center",padding:"50px 20px",color:"var(--text3)",background:"var(--card)",border:"1px dashed var(--border)",borderRadius:14}}>
          <div style={{fontSize:48,marginBottom:10}}>📜</div>
          <div style={{fontWeight:700}}>No requests yet</div>
          <div style={{fontSize:13,marginTop:4}}>Click "New Request" to get started</div>
        </div>
      )}
      {requests.map(req=>{
        const s = RR_STATUSES[req.status] || RR_STATUSES.pending;
        return (
          <div
            key={req.id}
            onClick={()=>setSelected(req)}
            style={{
              background:"var(--card)",border:`1px solid ${s.color}33`,
              borderRadius:14,padding:"16px 18px",marginBottom:12,
              cursor:"pointer",transition:"all .2s",
              borderLeft:`4px solid ${s.color}`
            }}
            onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
            onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}
          >
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:14,marginBottom:5,color:"var(--text)"}}>{req.topic}</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{fontSize:11,color:"var(--text3)"}}>{new Date(req.createdAt).toLocaleDateString()}</span>
                  {req.deadline&&<span style={{fontSize:11,color:"var(--text3)"}}>• Due {new Date(req.deadline).toLocaleDateString()}</span>}
                  {req.price&&<span style={{fontSize:12,fontWeight:800,color:"#f59e0b"}}>₦{Number(req.price).toLocaleString()}</span>}
                  {req.paid&&<span style={{fontSize:11,fontWeight:800,color:"var(--success)"}}>💳 Paid</span>}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                <span style={{background:s.bg,color:s.color,border:`1px solid ${s.color}44`,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:800}}>{s.icon} {s.label}</span>
                {req.status==="quoted"&&<span style={{fontSize:11,color:"#3b82f6",fontWeight:700}}>Tap to review →</span>}
                {req.status==="completed"&&req.projectFile&&!req.paid&&<span style={{fontSize:11,color:"#0ba4db",fontWeight:700}}>💳 Pay to download</span>}
                {req.status==="completed"&&req.paid&&<span style={{fontSize:11,color:"var(--success)",fontWeight:700}}>📥 Ready to download</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Admin: Research Requests Manager ─────────────────────────────────

export function ResearchClub({ currentUser, toast, isLecturer, isAdmin }) {
  const allUsers = ls("nv-users", []);
  const me = allUsers.find(u => u.username === currentUser) || {};
  const [members, setMembers] = useState([]);
  const [isMember, setIsMember] = useState(false);
  const [registering, setRegistering] = useState(false);
  // Check localStorage immediately so a registered member never sees the register form
  const _lsKey = "rc-member-" + currentUser.replace(/[^a-z0-9]/gi,"_");
  const _alreadyMember = (() => { try { return localStorage.getItem(_lsKey) === "1"; } catch { return false; } })();
  const [view, setView] = useState(_alreadyMember || isAdmin || isLecturer ? "loading" : "loading");
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [dmTarget, setDmTarget] = useState("");
  const [recording, setRecording] = useState(false);
  const [mediaRec, setMediaRec] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [attachFile, setAttachFile] = useState(null);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);

  // Load members — if localStorage says already a member, go straight to chat
  useEffect(() => {
    const alreadyLocal = (() => { try { return localStorage.getItem(_lsKey) === "1"; } catch { return false; } })();
    if (alreadyLocal || isAdmin || isLecturer) {
      // Go straight to chat; still load members list in background
      setIsMember(true);
      setView("chat");
      rcGetMembers().then(list => {
        const isAdminOrLecturer = isAdmin || isLecturer;
        let finalList = list;
        if (isAdminOrLecturer && !list.includes(currentUser)) {
          finalList = [...list, currentUser];
          rcSaveMembers(finalList);
        }
        setMembers(finalList);
      });
      return;
    }
    // Not locally confirmed — check Firestore
    rcGetMembers().then(list => {
      let finalList = list;
      setMembers(finalList);
      const member = finalList.includes(currentUser);
      setIsMember(member);
      if (member) {
        // Persist locally so next visit skips this check
        try { localStorage.setItem(_lsKey, "1"); } catch {}
        setView("chat");
      } else {
        setView("register");
      }
    });
  }, [currentUser, isAdmin, isLecturer]);

  // Subscribe to chat
  useEffect(() => {
    if (view !== "chat") return;
    const unsub = rcSubscribe(setMsgs);
    return () => unsub();
  }, [view]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const register = async () => {
    setRegistering(true);
    const updated = [...members, currentUser];
    await rcSaveMembers(updated);
    setMembers(updated);
    setIsMember(true);
    setRegistering(false);
    setView("chat");
    toast("🎉 Welcome to the Research Club! You've earned the RESEARCHER badge!", "success");
    // Store membership locally for fast badge display
    try { localStorage.setItem("rc-member-" + currentUser.replace(/[^a-z0-9]/gi,"_"), "1"); } catch{}
  };

  const displayName = (email) => {
    const u = allUsers.find(x=>x.username===email);
    return u?.displayName || email.split("@")[0];
  };
  const avatarChar = (email) => (displayName(email)[0]||"?").toUpperCase();
  const roleTag = (email) => {
    const u = allUsers.find(x=>x.username===email);
    if (!u) return "👤";
    if (u.role==="admin") return "🛡️";
    if (u.role==="lecturer") return "👨🏫";
    return "🎓";
  };

  const send = async () => {
    if (!text.trim() && !attachFile) return;
    if (sending) return;
    setSending(true);
    if (attachFile) {
      await rcSend(currentUser, { type:"file", text: attachFile.name, fileData: attachFile.data, fileName: attachFile.name, fileType: attachFile.type });
      setAttachFile(null);
    } else {
      await rcSend(currentUser, { type:"text", text: text.trim() });
    }
    setText(""); setSending(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = e => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(t=>t.stop());
        const blob = new Blob(chunks, { type:"audio/webm" });
        const reader = new FileReader();
        reader.onload = async (ev) => {
          await rcSend(currentUser, { type:"voice", text:"🎤 Voice note", fileData:ev.target.result, fileName:"voice.webm", fileType:"audio/webm" });
          toast("Voice note sent","success");
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      setMediaRec(mr);
      setRecording(true);
    } catch(e) { toast("Microphone not available","error"); }
  };
  const stopRecording = () => { if(mediaRec){ mediaRec.stop(); setMediaRec(null); setRecording(false); } };

  const handleFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 3*1024*1024) return toast("File must be under 3MB","error");
    const reader = new FileReader();
    reader.onload = ev => setAttachFile({ name:file.name, data:ev.target.result, type:file.type });
    reader.readAsDataURL(file);
  };

  // DM: navigate to Messages with pre-selected user
  const openDM = () => {
    if (!dmTarget || dmTarget===currentUser) return toast("Select a member","warn");
    // Store pending DM in localStorage so Messages component picks it up
    try { localStorage.setItem("nv-pending-dm", dmTarget); } catch{}
    window.dispatchEvent(new CustomEvent("rc-open-dm", { detail: dmTarget }));
    toast(`Opening chat with ${displayName(dmTarget)}…`, "success");
  };

  // ── REGISTER PAGE ──
  if (view === "register") {
    const name = me.displayName || currentUser.split("@")[0];
    const matric = me.matric || "—";
    const cls = ls("nv-classes", DEFAULT_CLASSES).find(c=>c.id===me.class);
    return (
      <div style={{maxWidth:560,margin:"0 auto",paddingBottom:40}}>
        {/* Hero */}
        <div style={{
          background:"linear-gradient(135deg,#7c3aed,#b45309,#d97706)",
          borderRadius:20, padding:"36px 32px", marginBottom:28, color:"#fff",
          textAlign:"center", position:"relative", overflow:"hidden",
          boxShadow:"0 20px 60px rgba(124,58,237,.35)"
        }}>
          <div style={{position:"absolute",top:-30,right:-30,fontSize:120,opacity:.07}}>🔬</div>
          <div style={{position:"absolute",bottom:-20,left:-20,fontSize:80,opacity:.07}}>⚗️</div>
          <div style={{fontSize:60,marginBottom:12,filter:"drop-shadow(0 4px 12px rgba(0,0,0,.4))"}}>🔬</div>
          <div style={{fontWeight:900,fontSize:26,letterSpacing:.5,marginBottom:8,textShadow:"0 2px 12px rgba(0,0,0,.3)"}}>Research Club</div>
          <div style={{fontSize:14,opacity:.9,lineHeight:1.6}}>Join an elite community of scholars, researchers, and academic trailblazers.</div>
          <div style={{marginTop:16,display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap"}}>
            {["🏆 Prestigious Achievement","🧬 Research Sessions","👨🔬 Expert Mentors","🌐 Collaborative Network"].map(b=>(
              <span key={b} style={{background:"rgba(255,255,255,.18)",borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700,backdropFilter:"blur(8px)"}}>{b}</span>
            ))}
          </div>
        </div>

        {/* Golden badge preview */}
        <div style={{
          background:"linear-gradient(135deg,#78350f,#b45309,#f59e0b)",
          borderRadius:16, padding:"20px 24px", marginBottom:24,
          display:"flex",alignItems:"center",gap:16,
          boxShadow:"0 8px 32px rgba(245,158,11,.4)", border:"2px solid #fbbf24"
        }}>
          <div style={{
            background:"linear-gradient(135deg,#fbbf24,#f59e0b,#d97706)",
            borderRadius:"50%", width:60, height:60,
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:28, boxShadow:"0 0 24px rgba(251,191,36,.8), inset 0 1px 2px rgba(255,255,255,.4)",
            flexShrink:0, border:"3px solid #fde68a"
          }}>🔬</div>
          <div>
            <div style={{fontWeight:900,fontSize:18,color:"#fde68a",textShadow:"0 1px 6px rgba(0,0,0,.3)"}}>RESEARCHER</div>
          </div>
        </div>

        {/* Auto-filled form */}
        <div style={{background:"var(--card)",border:"2px solid rgba(124,58,237,.3)",borderRadius:16,padding:24,marginBottom:20}}>
          <div style={{fontWeight:800,fontSize:16,marginBottom:4,color:"var(--text)"}}>📋 Registration Form</div>
          <div style={{fontSize:12,color:"var(--text3)",marginBottom:20}}>Your information has been auto-filled from your profile.</div>
          {[
            ["Full Name", name],
            ["Email Address", currentUser],
            ["Matric Number", matric],
            ["Class / Programme", cls?.label || me.class || "—"],
          ].map(([label, val]) => (
            <div key={label} style={{marginBottom:14}}>
              <label className="lbl">{label}</label>
              <div style={{background:"var(--bg4)",border:"2px solid var(--border)",borderRadius:9,padding:"11px 14px",color:"var(--text)",fontSize:14,fontWeight:700,opacity:.8}}>{val}</div>
            </div>
          ))}
        </div>

        <button
          onClick={register}
          disabled={registering}
          style={{
            width:"100%", padding:"16px", borderRadius:12,
            background:"linear-gradient(135deg,#7c3aed,#b45309)",
            color:"white", border:"none", cursor:"pointer",
            fontWeight:900, fontSize:16, letterSpacing:.5,
            boxShadow:"0 8px 24px rgba(124,58,237,.4)",
            opacity:registering?0.7:1, transition:"all .2s"
          }}
        >
          {registering ? "⏳ Registering..." : "🔬 Register as Research Club Member"}
        </button>
        <div style={{textAlign:"center",fontSize:11,color:"var(--text3)",marginTop:10}}>
          {members.length} member{members.length!==1?"s":""} in the club • Free to join
        </div>
      </div>
    );
  }

  if (view === "loading") return (
    <div style={{textAlign:"center",padding:60,color:"var(--text3)"}}>Loading Research Club…</div>
  );

  // ── CHAT PAGE ──
  const otherMembers = members.filter(m => m !== currentUser);
  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100dvh - 120px)",maxWidth:760,margin:"0 auto"}}>
      {/* Header */}
      <div style={{
        background:"linear-gradient(135deg,rgba(124,58,237,.15),rgba(180,83,9,.15))",
        border:"1px solid rgba(124,58,237,.25)",
        borderRadius:14, padding:"14px 18px", marginBottom:12,
        display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10
      }}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{
            background:"linear-gradient(135deg,#7c3aed,#b45309)",
            borderRadius:10, width:40, height:40,
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,
            boxShadow:"0 4px 12px rgba(124,58,237,.3)"
          }}>🔬</div>
          <div>
            <div style={{fontWeight:900,fontSize:16,color:"var(--text)"}}>Research Club</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>{members.length} member{members.length!==1?"s":""} • Group Chat</div>
          </div>
          <div style={{
            background:"linear-gradient(135deg,#fbbf24,#f59e0b)",
            borderRadius:20, padding:"3px 10px",
            fontSize:10, fontWeight:900, color:"#78350f",
            boxShadow:"0 2px 8px rgba(245,158,11,.4)"
          }}>✦ RESEARCHER</div>
        </div>

        {/* Private DM dropdown */}
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <GroupVideoCallBtn roomId="research-club-main" label="Research Club" currentUser={currentUser} />
          <select
            value={dmTarget}
            onChange={e=>setDmTarget(e.target.value)}
            style={{padding:"7px 10px",borderRadius:9,border:"1px solid var(--border)",background:"var(--bg4)",color:"var(--text)",fontSize:12,fontWeight:700,minWidth:150}}
          >
            <option value="">💬 Private Chat With…</option>
            {otherMembers.map(m=>(
              <option key={m} value={m}>{roleTag(m)} {displayName(m)}</option>
            ))}
          </select>
          <button
            onClick={openDM}
            disabled={!dmTarget}
            style={{padding:"7px 14px",borderRadius:9,background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer",fontWeight:700,fontSize:12,opacity:!dmTarget?.5:1}}
          >Open DM</button>
        </div>
      </div>
      {/* Messages */}
      <div style={{flex:1,overflowY:"auto",padding:"0 4px",display:"flex",flexDirection:"column",gap:10}}>
        {msgs.length===0&&(
          <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}>
            <div style={{fontSize:48,marginBottom:10}}>🔬</div>
            <div style={{fontWeight:700}}>Welcome to the Research Club!</div>
            <div style={{fontSize:12,marginTop:4}}>Start the conversation — share research ideas, resources, and insights.</div>
          </div>
        )}
        {msgs.map(m=>{
          const mine = m.from===currentUser;
          return (
            <div key={m.id} style={{display:"flex",alignItems:"flex-end",gap:8,flexDirection:mine?"row-reverse":"row"}}>
              {!mine&&<div style={{width:30,height:30,borderRadius:"50%",background:"linear-gradient(135deg,#7c3aed,#b45309)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:900,color:"#fff",flexShrink:0}}>{avatarChar(m.from)}</div>}
              <div style={{maxWidth:"72%"}}>
                {!mine&&<div style={{fontSize:10,color:"var(--text3)",marginBottom:3,marginLeft:2}}>{roleTag(m.from)} {displayName(m.from)}</div>}
                <div style={{
                  background: mine ? "linear-gradient(135deg,#7c3aed,#6d28d9)" : "var(--card2)",
                  color: mine ? "#fff" : "var(--text)",
                  borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  padding:"10px 14px", fontSize:13, fontWeight:700,
                  border: mine ? "none" : "1px solid var(--border)",
                  boxShadow: mine ? "0 4px 14px rgba(124,58,237,.3)" : "none"
                }}>
                  {m.type==="voice" ? (
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span>🎤</span>
                      {m.fileData && <audio controls src={m.fileData} style={{height:28,maxWidth:200}} />}
                      <span style={{fontSize:11,opacity:.7}}>Voice note</span>
                    </div>
                  ) : m.type==="file" ? (
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span>📎</span>
                      {m.fileData
                        ? <a href={m.fileData} download={m.fileName||"file"} style={{color:mine?"#fde68a":"var(--accent)",fontWeight:700,fontSize:12}}>{m.fileName||"Download"}</a>
                        : <span style={{fontSize:12}}>{m.fileName||"File"}</span>
                      }
                    </div>
                  ) : m.text}
                </div>
                <div style={{fontSize:10,color:"var(--text3)",marginTop:3,textAlign:mine?"right":"left"}}>{new Date(m.sentAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Attach preview */}
      {attachFile&&(
        <div style={{padding:"6px 12px",background:"rgba(124,58,237,.1)",border:"1px solid rgba(124,58,237,.25)",borderRadius:9,marginBottom:6,fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:8}}>
          <span>📎 {attachFile.name}</span>
          <button onClick={()=>setAttachFile(null)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--danger)",fontSize:14}}>✕</button>
        </div>
      )}

      {/* Input bar */}
      <div style={{display:"flex",gap:8,paddingTop:10,borderTop:"1px solid var(--border)",alignItems:"flex-end"}}>
        {/* File attach */}
        <button
          onClick={()=>fileRef.current?.click()}
          title="Attach file"
          style={{width:36,height:36,borderRadius:"50%",background:"var(--bg4)",border:"1px solid var(--border)",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}
        >📎</button>
        <input ref={fileRef} type="file" style={{display:"none"}} onChange={handleFile} />

        {/* Audio record */}
        <button
          onClick={recording ? stopRecording : startRecording}
          title={recording?"Stop recording":"Record voice"}
          style={{width:36,height:36,borderRadius:"50%",background:recording?"rgba(239,68,68,.15)":"var(--bg4)",border:`1px solid ${recording?"var(--danger)":"var(--border)"}`,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,animation:recording?"pulse 1.2s infinite":""}}
        >{recording?"⏹":"🎤"}</button>

        <textarea
          value={text}
          onChange={e=>setText(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();} }}
          placeholder="Type a message to the Research Club… (Enter to send)"
          rows={1}
          style={{flex:1,padding:"10px 14px",borderRadius:14,border:"1.5px solid var(--border)",background:"var(--bg4)",color:"var(--text)",fontSize:13,fontFamily:"inherit",fontWeight:700,outline:"none",resize:"none",lineHeight:1.5}}
        />
        <button
          onClick={send}
          disabled={sending||(!text.trim()&&!attachFile)}
          style={{padding:"10px 18px",borderRadius:14,background:"linear-gradient(135deg,#7c3aed,#6d28d9)",color:"#fff",border:"none",cursor:"pointer",fontWeight:800,fontSize:14,opacity:(sending||(!text.trim()&&!attachFile))?.5:1,flexShrink:0}}
        >{sending?"…":"Send"}</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// STUDY GROUPS
// ════════════════════════════════════════════════════════════════════
