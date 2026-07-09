import { useState, useEffect } from "react";
import { PAYSTACK_AMOUNT, PAYSTACK_PUBLIC_KEY } from "../../config/keys";
import { DEFAULT_CLASSES } from "../../data/defaults";
import { _DOC_SHARED, _getDoc, _setDocField, gcSubscribe, saveShared, useSharedData } from "../../services/backend";
import { sendAccessCodeEmail } from "../../services/emailService";
import { generateAccessCode, loadPaystack } from "../../services/paystackService";
import { showNotif } from "../../utils/notifications";
import { ls, lsSet } from "../../utils/storage";
import { AdminDailyMockManager, AdminNcArchiveManager, AdminNursingExams } from "../../components/admin";
import { Toasts } from "../../components/common";
import { NcDailyMockExam, NursingMCQExam, NursingOsceView, NursingReviewMode, SchoolMCQExam, SchoolMCQReview } from "../../components/exams";
import { PHNClassForum, PHNFolderModal } from "../../components/forum";
import { Dashboard, Results } from "../../components/student";
import { useNcAccess } from "../../hooks/useNcAccess";
import { useNcArchive } from "../../hooks/useNcArchive";
import { buildDeviceIdentity, compareDeviceIdentity, loadDeviceRegistration, registerDeviceInFirebase } from "../../shared/deviceFingerprint";
import { NC_FREE_LIMIT, NC_MOCK_FREE_LIMIT, NC_PAPER_TYPES, NC_YEARS, NURSING_EXAM_META, getYearData, isPaperArchived } from "../../shared/ncExamData";
import { PHN_FORUM_ID, phnGetLecturers } from "../../shared/phnForum";

export function NcPaywall({ currentUser, onUnlocked, toast, preview, isMock }) {
  const [users, setUsers] = useSharedData("nv-users", []);
  const [codes, setCodes] = useSharedData("nv-nc-codes", []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [currentIdentity, setCurrentIdentity] = useState(null);
  const [fbReg, setFbReg] = useState(undefined);
  useEffect(() => { buildDeviceIdentity().then(setCurrentIdentity); }, []);
  useEffect(() => { if (currentUser) loadDeviceRegistration(currentUser).then(setFbReg); }, [currentUser]);

  const me = users.find(u => u.username === currentUser);
  const storedReg = fbReg || (() => { try { return me?.ncDeviceId ? JSON.parse(me.ncDeviceId) : null; } catch { return me?.ncDeviceId||null; } })();
  const isWrongDevice = !!(me?.ncUnlocked && storedReg && currentIdentity && (() => {
    if (typeof storedReg === "string") return storedReg !== currentIdentity.fingerprint;
    const { match } = compareDeviceIdentity(storedReg, currentIdentity);
    return !match;
  })());

  const redeem = async () => {
    const entered = input.trim().toUpperCase();
    if (!entered) return toast("Enter your production code", "error");
    setLoading(true);
    const identity = currentIdentity || await buildDeviceIdentity();
    const match = codes.find(c => c.code === entered && !c.used);
    if (!match) {
      setLoading(false); setShake(true); setTimeout(()=>setShake(false),600);
      toast("❌ Invalid or already-used code","error"); return;
    }
    await registerDeviceInFirebase(currentUser, identity);
    const identityStore = JSON.stringify({
      fingerprint:identity.fingerprint, uuid:identity.uuid,
      canvasH:identity.canvasH, webglH:identity.webglH, audioH:identity.audioH, fontH:identity.fontH,
      screen:identity.screen, hardware:identity.hardware, locale:identity.locale, platform:identity.platform,
      publicIP:identity.publicIP, gpuRaw:identity.gpuRaw, userAgent:identity.userAgent,
      screenRaw:identity.screenRaw, hwRaw:identity.hwRaw,
      realSignalCount:identity.realSignalCount, registeredAt:identity.registeredAt,
    });
    const newCodes = codes.map(c => c.code===entered
      ? {...c,used:true,usedBy:currentUser,usedAt:Date.now(),deviceFingerprint:identity.fingerprint,deviceIP:identity.publicIP,deviceGPU:identity.gpuRaw}:c);
    setCodes(newCodes); await saveShared("ncCodes",newCodes);
    const newUsers = users.map(u => u.username===currentUser
      ? {...u,ncUnlocked:true,ncCode:entered,ncDeviceId:identityStore}:u);
    setUsers(newUsers); await saveShared("users",newUsers);
    setFbReg(identity); setLoading(false);
    toast("🎉 Full access unlocked — permanently locked to this device!","success");
    onUnlocked();
  };

  if (isWrongDevice) return (
    <div style={{maxWidth:480,margin:"0 auto"}}>
      <div style={{borderRadius:20,overflow:"hidden",border:"2px solid #dc2626",boxShadow:"0 8px 32px rgba(220,38,38,.2)"}}>
        <div style={{background:"linear-gradient(135deg,#dc2626,#7f1d1d)",padding:"30px 24px",textAlign:"center"}}>
          <div style={{fontSize:60,marginBottom:8}}>🔒</div>
          <div style={{color:"white",fontWeight:800,fontSize:20,marginBottom:6}}>Device Not Recognised</div>
          <div style={{color:"rgba(255,255,255,.85)",fontSize:13,lineHeight:1.7}}>
            Your production code is permanently bound to the device it was first activated on. Access from this device is blocked.
          </div>
        </div>
        <div style={{padding:"22px 24px",background:"var(--card)"}}>
          {[
            {icon:"📱",text:"Each code locks permanently to ONE device — identified by its GPU chip, audio processor, screen hardware, CPU, installed fonts, and a unique browser database ID"},
            {icon:"🚫",text:"Sharing your login or opening on a different phone, tablet or laptop is automatically blocked"},
            {icon:"🔍",text:"10 hardware-level signals were captured from your original device — they must all match to allow access"},
            {icon:"✉️",text:"Only contact admin if you genuinely changed your device (phone broken or stolen)"},
          ].map((item,i)=>(
            <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"10px 12px",borderRadius:10,
              background:"rgba(220,38,38,.04)",border:"1px solid rgba(220,38,38,.12)",marginBottom:8}}>
              <span style={{fontSize:20,flexShrink:0}}>{item.icon}</span>
              <span style={{fontSize:12,color:"var(--text2)",lineHeight:1.6}}>{item.text}</span>
            </div>
          ))}
          <div style={{textAlign:"center",padding:"13px 16px",borderRadius:10,background:"var(--bg4)",border:"1px solid var(--border)",fontSize:12,color:"var(--text3)",lineHeight:2,marginTop:4}}>
            Genuine device change? Contact admin:<br/>
            <a href={`https://mail.google.com/mail/?view=cm&to=mynote0416@gmail.com&su=NC%20Exam%20Device%20Reset%20Request&body=Hello%2C%20I%20need%20my%20device%20reset.%0A%0AUsername%3A%20${encodeURIComponent(currentUser)}%0AReason%3A%20`}
              target="_blank" rel="noopener noreferrer"
              style={{color:"var(--accent)",fontWeight:800,textDecoration:"none",fontSize:13}}>
              mynote0416@gmail.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{maxWidth:500,margin:"0 auto"}}>
      {/* Preview section */}
      {preview && (
        <div style={{marginBottom:20}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--text3)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
            <span>👁️ FREE PREVIEW</span>
            <span style={{fontSize:11,fontWeight:500}}>— First {NC_FREE_LIMIT} questions only</span>
          </div>
          {preview}
          <div style={{height:40,background:"linear-gradient(to bottom, transparent, var(--bg))",marginTop:-40,position:"relative",zIndex:1,pointerEvents:"none"}} />
        </div>
      )}

      {/* Paywall card */}
      <div style={{
        borderRadius:20,overflow:"hidden",
        border:"2px solid var(--accent)",
        boxShadow:"0 8px 32px rgba(0,119,182,.15)",
      }}>
        {/* Top banner */}
        <div style={{
          background:"linear-gradient(135deg,var(--accent) 0%,var(--accent2) 100%)",
          padding:"28px 24px",textAlign:"center",position:"relative",overflow:"hidden"
        }}>
          <div style={{position:"absolute",top:-20,right:-20,fontSize:100,opacity:.08}}>🔐</div>
          <div style={{fontSize:52,marginBottom:8}}>🔐</div>
          <div style={{color:"white",fontWeight:800,fontSize:20,marginBottom:4}}>Full Access Required</div>
          <div style={{color:"rgba(255,255,255,.8)",fontSize:13,lineHeight:1.5}}>
            {isMock
              ? <>You've used your {NC_MOCK_FREE_LIMIT} free mock questions.<br/>Enter your production code to unlock all questions.</>
              : <>You've used your {NC_FREE_LIMIT} free questions.<br/>Enter your production code to unlock everything.</>
            }
          </div>
        </div>

        {/* Features */}
        <div style={{padding:"20px 24px",background:"var(--card)"}}>
          <div style={{fontWeight:800,fontSize:12,color:"var(--text3)",marginBottom:12,textTransform:"uppercase",letterSpacing:.5}}>What you unlock</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
            {[
              {icon:"📄",text:"All Paper 1 & Paper 2 questions — unlimited"},
              {icon:"🩺",text:"Full OSCE clinical checklists"},
              {icon:"📅",text:"Daily Mock Exam (admin-curated questions)"},
              {icon:"🗄️",text:"Complete exam archive — retake anytime"},
              {icon:"📖",text:"Review mode — all answers visible"},
              {icon:"♾️",text:"Lifetime access — one code, forever"},
            ].map((f,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:9,background:"rgba(var(--accent-rgb,0,119,182),.1)",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{f.icon}</div>
                <div style={{fontSize:13,color:"var(--text)",fontWeight:600}}>{f.text}</div>
              </div>
            ))}
          </div>

          {/* Code input */}
          <div style={{
            animation: shake ? "shake .4s ease" : "none",
          }}>
            <label className="lbl">🔑 Production Code</label>
            <input className="inp" style={{
              textAlign:"center",letterSpacing:2,fontWeight:800,fontSize:16,
              borderColor:"var(--accent)",marginBottom:10,
            }}
              placeholder="NC-XXXX-XXXX-XXXX"
              value={input}
              onChange={e=>setInput(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==="Enter"&&redeem()}
            />
            <button
              className="btn btn-accent"
              style={{width:"100%",padding:"14px",fontSize:16,fontWeight:800,
                background:"linear-gradient(135deg,var(--accent),var(--accent2))",border:"none",
                opacity:loading?0.7:1}}
              onClick={redeem}
              disabled={loading}
            >
              {loading?"⏳ Verifying...":"🔓 Unlock Full Access"}
            </button>
          </div>

          {/* Payment options */}
          <div style={{marginTop:20,borderTop:"1px solid var(--border)",paddingTop:16}}>
            <div style={{fontWeight:800,fontSize:12,color:"var(--text3)",marginBottom:12,textTransform:"uppercase",letterSpacing:.5,textAlign:"center"}}>💳 Purchase a Code — Pay Via</div>
            <div style={{marginBottom:14}}>
              {/* Paystack — full width */}
              <div
                onClick={async ()=>{
                  try {
                    await loadPaystack();
                    const _me = ls("nv-users",[]).find(u=>u.username===currentUser);
                    const _email = currentUser;
                    const _name  = _me?.displayName || currentUser.split("@")[0];
                    const handler = window.PaystackPop.setup({
                      key:       PAYSTACK_PUBLIC_KEY,
                      email:     _email,
                      amount:    PAYSTACK_AMOUNT,
                      currency:  "NGN",
                      ref:       `NC-${Date.now()}`,
                      metadata:  { name: _name, custom_fields:[{display_name:"Student Name",variable_name:"name",value:_name}] },
                      onClose:   ()=>{},
                      callback:  (response)=>{
                        // Payment successful — generate & save code
                        const newCode = generateAccessCode();
                        // Save locally immediately
                        const localCodes = ls("nv-access-codes", {});
                        localCodes[newCode] = { createdAt: Date.now(), usedBy: null, paidBy: _email };
                        lsSet("nv-access-codes", localCodes);
                        // Save payment history locally
                        const payHistory = ls("nv-payment-history", []);
                        payHistory.unshift({ code: newCode, email: _email, name: _name, ref: response.reference, amount: PAYSTACK_AMOUNT/100, date: Date.now() });
                        lsSet("nv-payment-history", payHistory);
                        // Save to Firebase in background
                        _getDoc(_DOC_SHARED).then(existing => {
                          const codes = existing?.accessCodes || {};
                          codes[newCode] = { createdAt: Date.now(), usedBy: null, paidBy: _email, ref: response.reference };
                          _setDocField(_DOC_SHARED, "accessCodes", codes);
                          const fbHistory = existing?.paymentHistory || [];
                          fbHistory.unshift({ code: newCode, email: _email, name: _name, ref: response.reference, amount: PAYSTACK_AMOUNT/100, date: Date.now() });
                          _setDocField(_DOC_SHARED, "paymentHistory", fbHistory);
                        }).catch(()=>{});
                        // Auto-email the code to student
                        sendAccessCodeEmail(_email, newCode, _name);
                        // Show code in a prominent alert
                        alert(`✅ Payment Successful!\n\n🎟️ Your Access Code:\n\n${newCode}\n\nThis code has also been sent to: ${_email}\n\nPaste it in the box above to unlock full access.\n\n⚠️ Save this code!`);
                      },
                    });
                    handler.openIframe();
                  } catch(e) {
                    alert("❌ Error: " + (e?.message || e?.toString() || "Unknown error"));
                  }
                }}
                style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,padding:"14px 20px",borderRadius:12,
                  background:"linear-gradient(135deg,#0ba4db,#0077a8)",cursor:"pointer",
                  boxShadow:"0 2px 8px rgba(11,164,219,.2)",transition:"transform .15s,box-shadow .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 4px 16px rgba(11,164,219,.35)";}}
                onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 2px 8px rgba(11,164,219,.2)";}}>
                <div style={{width:40,height:40,borderRadius:"50%",background:"white",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:11,color:"#0ba4db",letterSpacing:-1,flexShrink:0}}>PSK</div>
                <div><div style={{color:"white",fontWeight:800,fontSize:14}}>Pay with Paystack</div><div style={{color:"rgba(255,255,255,.8)",fontSize:11}}>Secure card payment • Code delivered instantly</div></div>
              </div>
            </div>
            <div style={{textAlign:"center",fontSize:12,color:"var(--text3)",lineHeight:1.9,padding:"10px 14px",background:"var(--bg4)",borderRadius:10,border:"1px solid var(--border)"}}>
              After payment, your code is delivered automatically.<br/>
              Need help? Contact admin at:{" "}
              <a href={`https://mail.google.com/mail/?view=cm&to=mynote0416@gmail.com&su=NC%20Exam%20Access%20Code%20Help&body=Hello%2C%20I%20need%20help%20with%20my%20NC%20Exam%20access.%0AUsername%3A%20${encodeURIComponent(currentUser)}`}
                target="_blank" rel="noopener noreferrer"
                style={{color:"var(--accent)",fontWeight:700,textDecoration:"none"}}>
                mynote0416@gmail.com
              </a>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-8px)}
          40%{transform:translateX(8px)}
          60%{transform:translateX(-6px)}
          80%{transform:translateX(6px)}
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN: Nursing Council Exams Manager (Year → Paper1/Paper2/OSCE)
// ═══════════════════════════════════════════════════════════════════════

export function NursingExamsView({ toast, currentUser, initialExam, isAdmin, onPHNForumUnread }) {
  const isUnlocked = isAdmin || useNcAccess(currentUser);
  const [archive, setArchive] = useSharedData("nv-nc-archive", []);

  const saveToArchive = async (spec, year, paperKey, pd) => {
    const meta2 = NURSING_EXAM_META[spec];
    const isOsce = paperKey==="osce";
    const pt = NC_PAPER_TYPES.find(p=>p.key===paperKey);
    const entry = {
      id: `arc_${spec}_${year}_${paperKey}_${Date.now()}`,
      type: isOsce?"osce":"paper",
      spec, year, paperKey,
      title: `${meta2?.short||spec} ${year} ${pt?.label||paperKey}`,
      savedAt: Date.now(),
      ...(isOsce?{checklists:pd.checklists}:{questions:pd.questions}),
    };
    const filtered = archive.filter(e=>!(e.spec===spec&&e.year===year&&e.paperKey===paperKey));
    const newArc = [...filtered, entry];
    setArchive(newArc);
    const ok = await saveShared("ncArchive", newArc);
    toast(ok?"✅ Saved to archive! Students can retake anytime.":"✅ Saved locally — sync failed", ok?"success":"warn");
  };
  const [data] = useSharedData("nv-nursing-exams", {});
  const [activeSpec, setActiveSpec] = useState(initialExam||"general");
  const [selYear, setSelYear] = useState("2025");
  const [selPaper, setSelPaper] = useState(null); // null | "paper1"|"paper2"|"osce"
  const [mode, setMode] = useState(null); // null|"exam"|"review"|"osce"
  const [activePaper, setActivePaper] = useState(null);
  const [showPHNForum, setShowPHNForum] = useState(false);
  const [phnForumUnread, setPhnForumUnread] = useState(0);
  const [showPHNFolder, setShowPHNFolder] = useState(false);

  // Background PHN forum listener — tracks unread even when forum modal is closed
  useEffect(() => {
    if (activeSpec !== "publichealth") return;
    const allUsers = ls("nv-users", []);
    const me = allUsers.find(u => u.username === currentUser) || {};
    const myRole = me.role || "student";
    // All users accessing PHN section can subscribe (button only shown on publichealth tab)
    let initialized = false;
    let prevCount = 0;
    const unsub = gcSubscribe(PHN_FORUM_ID, incoming => {
      if (!initialized) { prevCount = incoming.length; initialized = true; return; }
      if (incoming.length > prevCount) {
        const newOthers = incoming.slice(prevCount).filter(m => m.from !== currentUser);
        if (newOthers.length > 0 && !showPHNForum) {
          setPhnForumUnread(n => n + newOthers.length);
          if (onPHNForumUnread) onPHNForumUnread(newOthers.length);
          // Browser notification
          newOthers.forEach(msg => {
            const allU = ls("nv-users", []);
            const su = allU.find(u => u.username === msg.from);
            const sname = su?.displayName || (msg.from || "").split("@")[0];
            const body = msg.type === "voice" ? "🎤 Voice note"
                       : msg.type === "file"  ? `📎 ${msg.fileName || "File"}`
                       : (msg.text || "").slice(0, 80);
            showNotif(`🌍 PHN Forum — ${sname}`, { body, tag: "phn_bg_" + msg.id });
          });
        }
      }
      prevCount = incoming.length;
    });
    return () => unsub();
  }, [activeSpec, currentUser, showPHNForum]);

  const meta = NURSING_EXAM_META[activeSpec];
  const yearData = getYearData(data, activeSpec, selYear);

  // Count papers with content per year per spec
  const getYearSummary = (spec, year) => {
    const yd = getYearData(data, spec, year);
    const p1 = (yd.paper1.questions?.length||0) > 0 && (yd.paper1.published||isPaperArchived(yd.paper1));
    const p2 = (yd.paper2.questions?.length||0) > 0 && (yd.paper2.published||isPaperArchived(yd.paper2));
    const os = (yd.osce.checklists?.length||0) > 0 && (yd.osce.published||isPaperArchived(yd.osce));
    return [p1?1:0, p2?1:0, os?1:0].reduce((a,b)=>a+b,0);
  };

  if (mode==="exam" && activePaper) {
    return <NursingMCQExam toast={toast} currentUser={currentUser} paper={activePaper} meta={meta}
      isUnlocked={isUnlocked} onBack={()=>{setMode(null);setActivePaper(null);}} />;
  }
  if (mode==="review" && activePaper) {
    return <NursingReviewMode paper={activePaper} meta={meta} currentUser={currentUser}
      isUnlocked={isUnlocked} onBack={()=>{setMode(null);setActivePaper(null);}} />;
  }
  if (mode==="osce" && activePaper) {
    return <NursingOsceView osce={activePaper} meta={meta} year={selYear} currentUser={currentUser}
      isUnlocked={isUnlocked} onBack={()=>{setMode(null);setActivePaper(null);setSelPaper(null);}} />;
  }

  const specKeys = Object.keys(NURSING_EXAM_META);

  return (
    <div>
      {/* Specialty tabs */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {specKeys.map(key=>{
          const m=NURSING_EXAM_META[key];
          return (
            <div key={key} onClick={()=>{setActiveSpec(key);setSelPaper(null);setMode(null);}}
              style={{flex:"1 1 150px",padding:"13px 14px",borderRadius:12,cursor:"pointer",transition:"all .2s",textAlign:"center",
                border:`2px solid ${activeSpec===key?m.color:"var(--border)"}`,
                background:activeSpec===key?`${m.color}15`:"var(--card)"}}>
              <div style={{fontSize:28,marginBottom:3}}>{m.icon}</div>
              <div style={{fontWeight:800,fontSize:13,color:activeSpec===key?m.color:"var(--text)"}}>{m.short}</div>
            </div>
          );
        })}
      </div>

      {/* Exam info bar */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,padding:"12px 16px",
        background:`${meta.color}0d`,borderRadius:12,border:`1.5px solid ${meta.color}30`}}>
        <div style={{width:38,height:38,borderRadius:10,background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{meta.icon}</div>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:meta.color}}>{meta.label}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>{meta.desc}</div>
        </div>
      </div>

      {/* Year dropdown + PHN Forum + Folder buttons */}
      <div style={{marginBottom:18}}>
        <label className="lbl">📅 Select Year</label>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <select className="inp" style={{maxWidth:280,marginBottom:0}} value={selYear} onChange={e=>{setSelYear(e.target.value);setSelPaper(null);}}>
            {NC_YEARS.slice().reverse().map(y=>{
              const cnt = getYearSummary(activeSpec, y);
              return <option key={y} value={y}>{y} Past Questions{cnt>0?` (${cnt} available)`:""}</option>;
            })}
          </select>
          {activeSpec === "publichealth" && (
            <>
              <button
                onClick={() => { setShowPHNForum(true); setPhnForumUnread(0); }}
                style={{
                  display:"flex", alignItems:"center", gap:7,
                  padding:"9px 16px", borderRadius:12, border:"2px solid #2e7d32",
                  background:"linear-gradient(135deg,#2e7d32,#4caf50)",
                  color:"white", fontWeight:800, fontSize:13, cursor:"pointer",
                  boxShadow:"0 3px 10px rgba(46,125,50,.35)", flexShrink:0,
                  transition:"all .2s", position:"relative",
                }}
                onMouseEnter={e => e.currentTarget.style.transform="translateY(-1px)"}
                onMouseLeave={e => e.currentTarget.style.transform="none"}
              >
                💬 Class Forum
                {phnForumUnread > 0 && (
                  <span style={{
                    position:"absolute", top:-7, right:-7,
                    background:"#ef4444", color:"white", borderRadius:"50%",
                    width:20, height:20, fontSize:10, fontWeight:900,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    border:"2px solid white", boxShadow:"0 2px 6px rgba(0,0,0,.35)",
                    animation:"pulse 1.2s infinite",
                  }}>{phnForumUnread > 9 ? "9+" : phnForumUnread}</span>
                )}
              </button>
              <button
                onClick={() => setShowPHNFolder(true)}
                style={{
                  display:"flex", alignItems:"center", gap:7,
                  padding:"9px 16px", borderRadius:12, border:"2px solid #1b5e20",
                  background:"linear-gradient(135deg,#1b5e20,#2e7d32)",
                  color:"white", fontWeight:800, fontSize:13, cursor:"pointer",
                  boxShadow:"0 3px 10px rgba(27,94,32,.35)", flexShrink:0,
                  transition:"all .2s",
                }}
                onMouseEnter={e => e.currentTarget.style.transform="translateY(-1px)"}
                onMouseLeave={e => e.currentTarget.style.transform="none"}
              >
                📁 Study Folder
              </button>
            </>
          )}
        </div>
      </div>
      {showPHNForum && <PHNClassForum currentUser={currentUser} onClose={() => { setShowPHNForum(false); setPhnForumUnread(0); }} onUnreadChange={delta => { if (delta === -999) setPhnForumUnread(0); }} />}
      {showPHNFolder && !showPHNForum && (
        <PHNFolderModal
          currentUser={currentUser}
          isAdmin={(() => { const me = ls("nv-users",[]).find(u => u.username === currentUser); return me?.role === "admin"; })()}
          onClose={() => setShowPHNFolder(false)}
        />
      )}

      {/* Paper type cards */}
      <div style={{fontWeight:800,fontSize:14,color:"var(--text)",marginBottom:12}}>{selYear} Papers</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:24}}>
        {NC_PAPER_TYPES.map(pt=>{
          const pd = pt.key==="osce" ? yearData.osce : yearData[pt.key];
          const hasContent = pt.key==="osce" ? (pd.checklists?.length||0)>0 : (pd.questions?.length||0)>0;
          const visible = hasContent && (pd.published || isPaperArchived(pd));
          const archived = isPaperArchived(pd);
          const attKey = `nv-ne-att-${currentUser}`;
          const att = ls(attKey,{})[`${activeSpec}_${selYear}_${pt.key}`];
          return (
            <div key={pt.key}
              onClick={()=>{if(!visible)return; setSelPaper(pt.key);}}
              style={{
                padding:"18px 14px",borderRadius:14,textAlign:"center",
                border:`2px solid ${selPaper===pt.key?meta.color:visible?"var(--border2)":"var(--border)"}`,
                background:selPaper===pt.key?`${meta.color}12`:visible?"var(--card)":"var(--bg4)",
                cursor:visible?"pointer":"default",opacity:visible?1:.55,transition:"all .2s",
                boxShadow:selPaper===pt.key?`0 4px 16px ${meta.color}25`:"none",
              }}>
              <div style={{fontSize:28,marginBottom:6}}>{pt.icon}</div>
              <div style={{fontWeight:800,fontSize:13,color:selPaper===pt.key?meta.color:"var(--text)",marginBottom:4}}>{pt.label}</div>
              <div style={{fontSize:10,color:"var(--text3)"}}>
                {!visible&&"No content yet"}
                {visible&&pt.key!=="osce"&&`${pd.questions.length}Q`}
                {visible&&pt.key==="osce"&&`${pd.checklists.length} skills`}
                {visible&&archived&&" • 🗃️"}
              </div>
              {att&&pt.key!=="osce"&&<div style={{marginTop:4,fontSize:10,fontWeight:700,color:"var(--success)"}}>✅ {att.pct}%</div>}
            </div>
          );
        })}
      </div>

      {/* Selected paper detail */}
      {selPaper&&(()=>{
        const pt = NC_PAPER_TYPES.find(p=>p.key===selPaper);
        const pd = selPaper==="osce" ? yearData.osce : yearData[selPaper];
        const hasContent = selPaper==="osce" ? (pd.checklists?.length||0)>0 : (pd.questions?.length||0)>0;
        const visible = hasContent && (pd.published||isPaperArchived(pd));
        const archived = isPaperArchived(pd);
        const attKey = `nv-ne-att-${currentUser}`;
        const att = ls(attKey,{})[`${activeSpec}_${selYear}_${selPaper}`];
        if(!visible) return null;
        return (
          <div className="card" style={{borderTop:`4px solid ${meta.color}`,animation:"fadeUp .3s ease"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
              <div style={{width:40,height:40,borderRadius:10,background:`${meta.color}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{pt.icon}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:16,color:meta.color}}>{meta.short} — {selYear} {pt.label}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>
                  {selPaper!=="osce"?`${pd.questions.length} questions`:`${pd.checklists.length} clinical skills`}
                  {archived&&" • 🗃️ Archived"}
                </div>
              </div>
              {archived&&<span className="tag" style={{borderColor:"var(--text3)",color:"var(--text3)"}}>🗃️ Archive</span>}
            </div>

            {selPaper!=="osce"&&(
              <>
                {att&&(
                  <div style={{marginBottom:14,padding:"10px 14px",background:`${att.pct>=70?"rgba(34,197,94,.07)":att.pct>=50?"rgba(251,146,60,.07)":"rgba(239,68,68,.07)"}`,borderRadius:10,border:`1px solid ${att.pct>=70?"var(--success)":att.pct>=50?"var(--warn)":"var(--danger)"}`}}>
                    <div style={{fontWeight:800,fontSize:13}}>Your Score: <span style={{color:att.pct>=70?"var(--success)":att.pct>=50?"var(--warn)":"var(--danger)"}}>{att.score}/{att.total} — {att.pct}%</span></div>
                    <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>Taken {att.date} • 🔒 1 attempt used</div>
                    <div className="progress-wrap" style={{marginTop:6}}>
                      <div className="progress-fill" style={{width:`${att.pct}%`,background:att.pct>=70?"var(--success)":att.pct>=50?"var(--warn)":"var(--danger)"}} />
                    </div>
                  </div>
                )}
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {!att&&<button className="btn btn-accent" style={{flex:1,background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none",fontWeight:800,fontSize:14,padding:"13px"}}
                    onClick={()=>{setActivePaper({...pd,title:`${meta.short} ${selYear} ${pt.label}`,id:`${activeSpec}_${selYear}_${selPaper}`});setMode("exam");}}>
                    📝 Take Exam
                  </button>}
                  <button className="btn" style={{flex:att?1:0,borderColor:meta.color,color:meta.color,fontWeight:700}}
                    onClick={()=>{setActivePaper({...pd,title:`${meta.short} ${selYear} ${pt.label}`,id:`${activeSpec}_${selYear}_${selPaper}`});setMode("review");}}>
                    📖 Review Mode
                  </button>
                  {isAdmin&&<button className="btn btn-sm" style={{borderColor:"var(--accent)",color:"var(--accent)"}}
                    onClick={()=>saveToArchive(activeSpec,selYear,selPaper,pd)}>🗄️ Archive</button>}
                </div>
              </>
            )}

            {selPaper==="osce"&&(
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <button className="btn btn-accent" style={{flex:1,background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none",fontWeight:800,fontSize:14,padding:"13px"}}
                  onClick={()=>{setActivePaper(pd);setMode("osce");}}>
                  🩺 View OSCE Checklists
                </button>
                {isAdmin&&<button className="btn btn-sm" style={{borderColor:"var(--accent)",color:"var(--accent)"}}
                  onClick={()=>saveToArchive(activeSpec,selYear,selPaper,pd)}>🗄️ Archive</button>}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── STUDENT: OSCE Checklist View ─────────────────────────────────────

export function SchoolPastQuestionsView({ toast, currentUser }) {
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [data, setData] = useSharedData("nv-school-pq", {});
  const [selClass, setSelClass] = useState(null);
  const [selCourse, setSelCourse] = useState(null);
  const [qTab, setQTab] = useState("mcq"); // "mcq" | "essay"
  // MCQ exam state
  const [examPaper, setExamPaper] = useState(null); // {questions, courseKey}
  const [examMode, setExamMode] = useState(null); // "exam" | "review"

  const ck = (cid,course)=>`${cid}__${course}`;
  const getCourse = (cid,course)=>data[ck(cid,course)]||{mcq:[],essay:[]};
  const currentClass = classes.find(c=>c.id===selClass);
  const cd = selClass&&selCourse ? getCourse(selClass,selCourse) : null;

  // If in exam/review mode, render the exam
  if (examMode==="exam" && examPaper) {
    return <SchoolMCQExam toast={toast} currentUser={currentUser} paper={examPaper}
      onBack={()=>{setExamPaper(null);setExamMode(null);}} />;
  }
  if (examMode==="review" && examPaper) {
    return <SchoolMCQReview paper={examPaper} onBack={()=>{setExamPaper(null);setExamMode(null);}} />;
  }

  return (
    <div>
      <div className="sec-title" style={{marginBottom:4}}>🏫 School Past Questions</div>
      <div style={{fontSize:12,color:"var(--text3)",marginBottom:20}}>Browse past questions by class and course. Practice MCQs or read essay questions for exam prep.</div>

      {/* Step 1: Class dropdown */}
      <div className="card" style={{marginBottom:16}}>
        <div style={{fontWeight:800,fontSize:13,marginBottom:10,color:"var(--accent)"}}>📚 Select Your Class</div>
        <select className="inp" style={{marginBottom:0}} value={selClass||""} onChange={e=>{setSelClass(e.target.value||null);setSelCourse(null);}}>
          <option value="">— Choose a class to begin —</option>
          {classes.map(c=>{
            const totalMCQ=(c.courses||[]).reduce((s,co)=>s+(getCourse(c.id,co).mcq.length),0);
            const totalEssay=(c.courses||[]).reduce((s,co)=>s+(getCourse(c.id,co).essay.length),0);
            return <option key={c.id} value={c.id}>{c.label} — {c.desc} ({totalMCQ} MCQ, {totalEssay} Essay)</option>;
          })}
        </select>
      </div>

      {/* Class overview cards */}
      {!selClass && (
        <div className="grid2" style={{gap:12}}>
          {classes.map((c,i)=>{
            const totalMCQ=(c.courses||[]).reduce((s,co)=>s+(getCourse(c.id,co).mcq.length),0);
            const totalEssay=(c.courses||[]).reduce((s,co)=>s+(getCourse(c.id,co).essay.length),0);
            const hasCont = totalMCQ+totalEssay>0;
            return (
              <div key={c.id} className="card" onClick={()=>{setSelClass(c.id);setSelCourse(null);}}
                style={{cursor:"pointer",borderLeft:`4px solid ${c.color||"var(--accent)"}`,opacity:hasCont?1:.65,animation:`fadeUp .3s ease ${i*.04}s both`,transition:"transform .15s"}}
                onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
                <div style={{fontWeight:800,fontSize:14,marginBottom:2}}>{c.label}</div>
                <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>{c.desc}</div>
                <div style={{display:"flex",gap:10,fontSize:11}}>
                  <span style={{color:"var(--accent)",fontWeight:700}}>📝 {totalMCQ} MCQ</span>
                  <span style={{color:"var(--purple)",fontWeight:700}}>✍️ {totalEssay} Essay</span>
                  <span style={{color:"var(--text3)"}}>{(c.courses||[]).length} courses</span>
                </div>
                {!hasCont&&<div style={{fontSize:10,color:"var(--text3)",marginTop:4,fontStyle:"italic"}}>No questions uploaded yet</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Step 2: Course dropdown */}
      {selClass && currentClass && (
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <button className="btn btn-sm" onClick={()=>{setSelClass(null);setSelCourse(null);}}>← All Classes</button>
            <div style={{fontWeight:800,fontSize:15,color:"var(--accent)"}}>{currentClass.label}</div>
            <div style={{fontSize:12,color:"var(--text3)"}}>{currentClass.desc}</div>
          </div>

          <div className="card" style={{marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:10,color:"var(--accent)"}}>📖 Select a Course</div>
            <select className="inp" style={{marginBottom:0}} value={selCourse||""} onChange={e=>setSelCourse(e.target.value||null)}>
              <option value="">— Choose a course —</option>
              {(currentClass.courses||[]).map(course=>{
                const cData=getCourse(selClass,course);
                return <option key={course} value={course}>{course} ({cData.mcq.length} MCQ, {cData.essay.length} Essay)</option>;
              })}
            </select>
          </div>

          {/* Course grid overview */}
          {!selCourse && (
            <div className="grid2" style={{gap:12}}>
              {(currentClass.courses||[]).map((course,i)=>{
                const cData=getCourse(selClass,course);
                const hasCont=cData.mcq.length+cData.essay.length>0;
                return (
                  <div key={course} className="card" onClick={()=>setSelCourse(course)}
                    style={{cursor:"pointer",animation:`fadeUp .3s ease ${i*.05}s both`,opacity:hasCont?1:.65,transition:"transform .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                    onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
                    <div style={{fontWeight:800,fontSize:14,marginBottom:6}}>{course}</div>
                    <div style={{display:"flex",gap:10,fontSize:12}}>
                      <span style={{color:"var(--accent)",fontWeight:700}}>📝 {cData.mcq.length} MCQ</span>
                      <span style={{color:"var(--purple)",fontWeight:700}}>✍️ {cData.essay.length} Essay</span>
                    </div>
                    {!hasCont&&<div style={{fontSize:10,color:"var(--text3)",marginTop:4,fontStyle:"italic"}}>No questions yet</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Course questions panel */}
          {selCourse && cd && (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                <button className="btn btn-sm" onClick={()=>setSelCourse(null)}>← {currentClass.label} Courses</button>
                <div style={{fontWeight:800,fontSize:15,color:"var(--text)"}}>{selCourse}</div>
                <span className="tag" style={{marginLeft:"auto"}}>{cd.mcq.length} MCQ • {cd.essay.length} Essay</span>
              </div>

              {/* MCQ / Essay tabs */}
              <div style={{display:"flex",gap:8,marginBottom:18}}>
                {[{key:"mcq",icon:"📝",label:"MCQ Questions",count:cd.mcq.length},{key:"essay",icon:"✍️",label:"Essay Questions",count:cd.essay.length}].map(t=>(
                  <div key={t.key} onClick={()=>setQTab(t.key)} style={{
                    flex:1,padding:"12px 14px",borderRadius:10,cursor:"pointer",transition:"all .2s",textAlign:"center",
                    border:`2px solid ${qTab===t.key?"var(--accent)":"var(--border)"}`,
                    background:qTab===t.key?"rgba(0,119,182,.1)":"var(--card)"}}>
                    <div style={{fontSize:22,marginBottom:3}}>{t.icon}</div>
                    <div style={{fontWeight:800,fontSize:13,color:qTab===t.key?"var(--accent)":"var(--text)"}}>{t.label}</div>
                    <div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>{t.count} question{t.count!==1?"s":""}</div>
                  </div>
                ))}
              </div>

              {/* ── MCQ TAB ── */}
              {qTab==="mcq"&&(
                cd.mcq.length===0
                ? <div style={{textAlign:"center",padding:"48px 20px",color:"var(--text3)"}}>
                    <div style={{fontSize:44,marginBottom:10}}>📝</div>
                    <div style={{fontWeight:700,marginBottom:4}}>No MCQ questions yet</div>
                    <div style={{fontSize:12}}>Your lecturer hasn't uploaded MCQs for this course yet.</div>
                  </div>
                : <div>
                    {/* Practice actions */}
                    <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap"}}>
                      <div className="card" style={{flex:1,minWidth:160,textAlign:"center",padding:"16px 12px",cursor:"pointer",borderTop:"3px solid var(--accent)"}}
                        onClick={()=>{setExamPaper({questions:cd.mcq,title:`${selCourse} — Practice Exam`,courseKey:ck(selClass,selCourse),classLabel:currentClass.label,course:selCourse});setExamMode("exam");}}>
                        <div style={{fontSize:28,marginBottom:6}}>📝</div>
                        <div style={{fontWeight:800,fontSize:13,color:"var(--accent)"}}>Take Practice Exam</div>
                        <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>Timed • score tracked • 1 attempt</div>
                      </div>
                      <div className="card" style={{flex:1,minWidth:160,textAlign:"center",padding:"16px 12px",cursor:"pointer",borderTop:"3px solid var(--purple)"}}
                        onClick={()=>{setExamPaper({questions:cd.mcq,title:`${selCourse} — Review Mode`,courseKey:ck(selClass,selCourse),classLabel:currentClass.label,course:selCourse});setExamMode("review");}}>
                        <div style={{fontSize:28,marginBottom:6}}>📖</div>
                        <div style={{fontWeight:800,fontSize:13,color:"var(--purple)"}}>Review Mode</div>
                        <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>See answers • no attempt limit</div>
                      </div>
                    </div>

                    {/* MCQ list preview */}
                    <div style={{fontWeight:800,fontSize:13,marginBottom:12,color:"var(--text)"}}>All {cd.mcq.length} Questions</div>
                    {cd.mcq.map((q,qi)=>(
                      <div key={qi} className="card" style={{marginBottom:10,borderLeft:"3px solid var(--border)"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
                          <div style={{fontWeight:700,fontSize:13,flex:1}}>Q{qi+1}. {q.q}</div>
                          {q.year&&<span className="tag" style={{flexShrink:0,fontSize:10}}>📅 {q.year}</span>}
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                          {q.options.filter(o=>o).map((opt,oi)=>(
                            <span key={oi} style={{fontSize:11,padding:"3px 9px",borderRadius:6,background:"var(--bg4)",border:"1px solid var(--border)",color:"var(--text3)"}}>
                              {"ABCD"[oi]}. {opt}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
              )}

              {/* ── ESSAY TAB ── */}
              {qTab==="essay"&&(
                cd.essay.length===0
                ? <div style={{textAlign:"center",padding:"48px 20px",color:"var(--text3)"}}>
                    <div style={{fontSize:44,marginBottom:10}}>✍️</div>
                    <div style={{fontWeight:700,marginBottom:4}}>No essay questions yet</div>
                    <div style={{fontSize:12}}>Your lecturer hasn't uploaded essay questions for this course yet.</div>
                  </div>
                : <div>
                    <div style={{fontWeight:800,fontSize:13,marginBottom:12,color:"var(--text)"}}>✍️ {cd.essay.length} Essay Question{cd.essay.length!==1?"s":""}</div>
                    {cd.essay.map((q,qi)=>(
                      <div key={qi} className="card" style={{marginBottom:12,borderLeft:"3px solid var(--purple)"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
                          <div style={{fontWeight:800,fontSize:14,flex:1,lineHeight:1.5}}>Q{qi+1}. {q.q}</div>
                          <div style={{display:"flex",gap:6,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                            {q.marks&&<span className="tag tag-purple" style={{fontSize:10}}>📊 {q.marks} marks</span>}
                            {q.year&&<span className="tag" style={{fontSize:10}}>📅 {q.year}</span>}
                          </div>
                        </div>
                        {q.modelAnswer&&(
                          <details style={{marginTop:8}}>
                            <summary style={{cursor:"pointer",fontSize:12,color:"var(--success)",fontWeight:700,userSelect:"none"}}>💡 Show Model Answer / Key Points</summary>
                            <div style={{marginTop:8,padding:"10px 12px",background:"rgba(34,197,94,.06)",borderRadius:8,border:"1px solid rgba(34,197,94,.2)",fontSize:13,color:"var(--text2)",lineHeight:1.6}}>{q.modelAnswer}</div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── STUDENT: School MCQ Practice Exam ────────────────────────────────

export function SchoolOnlyPastQuestionsView({ toast, currentUser }) {
  return (
    <div>
      <div style={{marginBottom:20}}>
        <div className="sec-title">🏫 School Past Questions</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>School past questions organised by class &amp; course.</div>
      </div>
      <SchoolPastQuestionsView toast={toast} currentUser={currentUser} />
    </div>
  );
}

// ─── STUDENT: Nursing Council Exams Only (sidebar nav) ───────────────────

export function NursingExamsStandaloneView({ toast, currentUser, initialExam }) {
  return (
    <div>
      <div style={{marginBottom:20}}>
        <div className="sec-title">🎓 Nursing Council Exams</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>GNC • Midwifery • Public Health Nursing past papers and live exam sessions.</div>
      </div>
      <NursingExamsView toast={toast} currentUser={currentUser} initialExam={initialExam} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ─── MAIN: Past Questions Page (tabs: School PQ + Nursing Exams) ──────

export function PastQuestionsView({ toast, currentUser }) {
  const [tab, setTab] = useState("school");
  const TABS = [
    {key:"school", icon:"🏫", label:"School Past Questions", sub:"Browse by class & course"},
    {key:"nursing", icon:"🎓", label:"Nursing Council Exams", sub:"GNC • Midwifery • Public Health"},
  ];
  return (
    <div>
      <div style={{marginBottom:20}}>
        <div className="sec-title">📚 Past Questions & Exams</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>School past questions organised by class & course. Nursing council exams also available.</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {TABS.map(t=>(
            <div key={t.key} onClick={()=>setTab(t.key)} style={{
              flex:"1 1 140px",padding:"12px 14px",borderRadius:11,cursor:"pointer",transition:"all .2s",
              border:`2px solid ${tab===t.key?"var(--accent)":"var(--border)"}`,
              background:tab===t.key?"rgba(0,119,182,.10)":"var(--card)",textAlign:"center"
            }}>
              <div style={{fontSize:22,marginBottom:4}}>{t.icon}</div>
              <div style={{fontWeight:800,fontSize:13,color:tab===t.key?"var(--accent)":"var(--text2)"}}>{t.label}</div>
              <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>{t.sub}</div>
            </div>
          ))}
        </div>
      </div>
      {tab==="school" && <SchoolPastQuestionsView toast={toast} currentUser={currentUser} />}
      {tab==="nursing" && <NursingExamsView toast={toast} currentUser={currentUser} />}
    </div>
  );
}

export function NcArchiveView({ toast, currentUser }) {
  const isUnlockedFull = useNcAccess(currentUser);
  const [unlocked, setUnlocked] = useState(isUnlockedFull);
  const [archive] = useNcArchive();
  const [sel, setSel] = useState(null);
  const [mode, setMode] = useState(null); // "exam"|"review"|"osce"

  if (!unlocked) {
    return (
      <div style={{maxWidth:500,margin:"0 auto"}}>
        <div style={{fontWeight:800,fontSize:15,marginBottom:4,color:"var(--accent)"}}>🗄️ Exam Archive</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>Past papers saved for unlimited retake — premium feature.</div>
        <NcPaywall currentUser={currentUser} onUnlocked={()=>setUnlocked(true)} toast={toast} />
      </div>
    );
  }

  if (mode==="exam"&&sel) {
    const meta = NURSING_EXAM_META[sel.spec]||{color:"#4a7a2e",icon:"📋",short:sel.spec||"Archive"};
    return <NursingMCQExam toast={toast} currentUser={currentUser}
      paper={{...sel, id:`arc_${sel.id}`, title:sel.title}}
      meta={meta} isUnlocked={true} onBack={()=>{setMode(null);setSel(null);}} />;
  }
  if (mode==="review"&&sel) {
    const meta = NURSING_EXAM_META[sel.spec]||{color:"#4a7a2e",icon:"📋",short:sel.spec||"Archive"};
    return <NursingReviewMode paper={{...sel,title:sel.title}} meta={meta}
      currentUser={currentUser} isUnlocked={true} onBack={()=>{setMode(null);setSel(null);}} />;
  }
  if (mode==="osce"&&sel) {
    const meta = NURSING_EXAM_META[sel.spec]||{color:"#4a7a2e",icon:"🩺",short:sel.spec||"Archive"};
    return <NursingOsceView osce={sel} meta={meta} year={sel.year||""}
      currentUser={currentUser} isUnlocked={true} onBack={()=>{setMode(null);setSel(null);}} />;
  }

  const mcqEntries    = archive.filter(e=>e.type!=="osce");
  const osceEntries   = archive.filter(e=>e.type==="osce");

  if (archive.length===0) return (
    <div style={{textAlign:"center",padding:"56px 20px",color:"var(--text3)"}}>
      <div style={{fontSize:52,marginBottom:12}}>🗄️</div>
      <div style={{fontWeight:700,fontSize:15,marginBottom:6}}>No archived exams yet</div>
      <div style={{fontSize:12}}>Admin will archive exams here for unlimited retake.</div>
    </div>
  );

  return (
    <div>
      <div style={{fontWeight:800,fontSize:15,marginBottom:4,color:"var(--accent)"}}>🗄️ Exam Archive</div>
      <div style={{fontSize:12,color:"var(--text3)",marginBottom:20}}>
        {archive.length} item{archive.length!==1?"s":" "} • Retake anytime • No attempt limit
      </div>

      {mcqEntries.length>0&&(
        <div style={{marginBottom:24}}>
          <div style={{fontWeight:800,fontSize:13,marginBottom:10,color:"var(--text)"}}>📄 MCQ Papers</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {mcqEntries.map(e=>{
              const meta = NURSING_EXAM_META[e.spec]||{color:"#4a7a2e"};
              return (
                <div key={e.id} className="card" style={{borderLeft:`4px solid ${meta.color}`}}>
                  <div style={{display:"flex",gap:10,alignItems:"flex-start",flexWrap:"wrap"}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:800,fontSize:14,marginBottom:3}}>{e.title}</div>
                      <div style={{fontSize:11,color:"var(--text3)"}}>
                        {e.type==="dailymock"?"📅 Daily Mock":"📄 Past Paper"} • {e.questions?.length||0} questions
                        {" • "}🗄️ {new Date(e.savedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button className="btn btn-sm btn-accent"
                        style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}}
                        onClick={()=>{setSel(e);setMode("exam");}}>📝 Take Exam</button>
                      <button className="btn btn-sm" style={{borderColor:meta.color,color:meta.color}}
                        onClick={()=>{setSel(e);setMode("review");}}>📖 Review</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {osceEntries.length>0&&(
        <div>
          <div style={{fontWeight:800,fontSize:13,marginBottom:10,color:"var(--text)"}}>🩺 OSCE Checklists</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {osceEntries.map(e=>{
              const meta = NURSING_EXAM_META[e.spec]||{color:"#0077b6"};
              return (
                <div key={e.id} className="card" style={{borderLeft:`4px solid ${meta.color}`}}>
                  <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:800,fontSize:14,marginBottom:3}}>{e.title}</div>
                      <div style={{fontSize:11,color:"var(--text3)"}}>🩺 {e.checklists?.length||0} clinical skills • 🗄️ {new Date(e.savedAt).toLocaleDateString()}</div>
                    </div>
                    <button className="btn btn-sm btn-accent"
                      style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}}
                      onClick={()=>{setSel(e);setMode("osce");}}>🩺 View Checklists</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Daily Mock Exam (questions from admin-managed synced pool) ─────────────

export function NcSpecialtyExams({ toast, currentUser, isAdmin, onPHNForumUnread }) {
  // Delegates entirely to NursingExamsView which now has Year → Paper1/Paper2/OSCE
  return (
    <div>
      <div className="nc-sec-title">🎓 Specialty Exam Papers</div>
      <div className="nc-sec-sub">Select specialty • choose year • pick Paper 1, Paper 2 or OSCE</div>
      <NursingExamsView toast={toast} currentUser={currentUser} isAdmin={isAdmin} onPHNForumUnread={onPHNForumUnread} />
    </div>
  );
}


// ── NC Dashboard ────────────────────────────────────────────────────────────

export function NcDashboard({ currentUser, onNavigate }) {
  const today = new Date().toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
  const results = ls("nv-results",[]).filter(r=>r.type&&r.type.includes("NC"));
  const mockDone = results.some(r=>r.subject?.includes(new Date().toLocaleDateString()));
  const isUnlocked = useNcAccess(currentUser);
  const mockTitle = ls("nv-daily-mock-title","");
  const mockPool  = ls("nv-daily-mock",[]);
  const mockQCount = Math.min(250, mockPool.length);
  return (
    <div>
      <div style={{marginBottom:16}}>
        <div className="nc-sec-title">🏛️ Nursing Council Exam Centre</div>
        <div className="nc-sec-sub">{today}</div>
      </div>

      {/* Access status banner */}
      {isUnlocked ? (
        <div style={{padding:"10px 16px",borderRadius:12,marginBottom:16,background:"rgba(74,122,46,.12)",
          border:"1.5px solid #4a7a2e",display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>🔓</span>
          <div style={{flex:1,fontSize:13,fontWeight:700,color:"#2d4a1e"}}>Full Access Unlocked — enjoy all questions, OSCE & archive!</div>
        </div>
      ) : (
        <div style={{padding:"12px 16px",borderRadius:12,marginBottom:16,
          background:"linear-gradient(135deg,rgba(0,119,182,.08),rgba(0,119,182,.04))",
          border:"1.5px solid rgba(0,119,182,.25)",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:20}}>🔑</span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:800,color:"var(--accent)"}}>Free Access — {NC_FREE_LIMIT} questions per paper</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>Enter a production code to unlock everything</div>
          </div>
          <button className="nc-btn nc-btn-primary" style={{fontSize:12,padding:"8px 14px"}}
            onClick={()=>onNavigate("unlock")}>🔓 Unlock Now</button>
        </div>
      )}
      {/* Daily mock card */}
      <div className="nc-card" style={{marginBottom:20,borderTop:"4px solid #4a7a2e",background:mockDone?"#f5f0e8":"#fff"}}>
        <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
          <div style={{width:52,height:52,borderRadius:12,background:"linear-gradient(135deg,#4a7a2e,#7bc950)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26}}>📅</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:16,color:"#2d4a1e",marginBottom:2}}>{mockTitle || "Daily Mock Exam"}</div>
            <div style={{fontSize:12,color:"#6b8a52"}}>{mockQCount>0?`${mockQCount} questions`:"No questions yet"} • Updates daily • {mockDone?"Completed ✅":"Not taken yet"}</div>
          </div>
          {!mockDone&&mockQCount>0&&<button className="nc-btn nc-btn-primary" style={{fontSize:13}} onClick={()=>onNavigate("daily")}>Start Now →</button>}
          {mockDone&&<span style={{fontSize:12,fontWeight:700,color:"#4a7a2e"}}>✅ Done for today!</span>}
        </div>
      </div>
      {/* Specialty cards */}
      <div style={{fontWeight:800,fontSize:15,color:"#2d4a1e",marginBottom:14}}>📚 Specialty Exams</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:12,marginBottom:20}}>
        {Object.values(NURSING_EXAM_META).map(m=>(
          <div key={m.key} className="nc-specialty-card" onClick={()=>onNavigate("specialty")}
            style={{textAlign:"center"}}>
            <div style={{fontSize:30,marginBottom:6}}>{m.icon}</div>
            <div style={{fontWeight:800,fontSize:12,color:"#2d4a1e"}}>{m.short}</div>
          </div>
        ))}
      </div>
      {/* Recent results */}
      {results.length>0&&(
        <div className="nc-card">
          <div style={{fontWeight:800,fontSize:13,color:"#2d4a1e",marginBottom:12}}>📊 Recent NC Results</div>
          {results.slice(-4).reverse().map((r,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #e8e0d0"}}>
              <span style={{fontSize:18}}>{r.pct>=70?"🎉":r.pct>=50?"👍":"📚"}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13,color:"#1a2e0a"}}>{r.subject}</div>
                <div style={{fontSize:11,color:"#6b8a52"}}>{r.date}</div>
              </div>
              <span style={{fontWeight:800,fontSize:14,color:r.pct>=70?"#4a7a2e":r.pct>=50?"#c05621":"#991b1b"}}>{r.pct}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Nursing Council Site ──────────────────────────────────────────────

export function NursingCouncilSite({ currentUser, isAdmin, onSwitchToSchool, toast, themeMode, setThemeMode }) {
  const [activeNav, setActiveNav] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadPHNForum, setUnreadPHNForum] = useState(0);

  // Global background listener for PHN forum — fires notifications even when not on Specialty page
  useEffect(() => {
    if (!currentUser) return;
    const allUsers = ls("nv-users", []);
    const me = allUsers.find(u => u.username === currentUser) || {};
    const myRole = me.role || "student";
    const isPHN = me.class && (me.class.toLowerCase().includes("phn") || me.class.toLowerCase().includes("public"));
    if (!isPHN && myRole !== "admin") return;
    // Also check approved lecturers
    let active = true;
    phnGetLecturers().then(lecturers => {
      if (!active) return;
      const allowed = isPHN || myRole === "admin" || (lecturers || []).includes(currentUser);
      if (!allowed) return;
      let initialized = false;
      let prevCount = 0;
      const unsub = gcSubscribe(PHN_FORUM_ID, incoming => {
        if (!initialized) { prevCount = incoming.length; initialized = true; return; }
        if (incoming.length > prevCount && activeNav !== "specialty") {
          const newOthers = incoming.slice(prevCount).filter(m => m.from !== currentUser);
          if (newOthers.length > 0) {
            setUnreadPHNForum(n => n + newOthers.length);
            newOthers.forEach(msg => {
              const allU = ls("nv-users", []);
              const su = allU.find(u => u.username === msg.from);
              const sname = su?.displayName || (msg.from || "").split("@")[0];
              const body = msg.type === "voice" ? "🎤 Sent a voice note"
                         : msg.type === "file"  ? `📎 ${msg.fileName || "File"}`
                         : (msg.text || "").slice(0, 80);
              if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                showNotif(`🌍 PHN Forum — ${sname}`, { body, tag: "phn_nc_" + msg.id });
              }
              // In-app toast
              toast(`🌍 PHN Forum — ${sname}: ${body}`, "info");
            });
          }
        }
        prevCount = incoming.length;
      });
      return () => { active = false; unsub(); };
    });
  }, [currentUser]);

  const NC_NAV = [
    { icon:"⊞", label:"Dashboard", key:"dashboard" },
    { icon:"📅", label:"Daily Mock Exam", key:"daily" },
    { icon:"🎓", label:"Specialty Exams", key:"specialty" },
    { icon:"🗄️", label:"Exam Archive", key:"archive" },
    { icon:"📊", label:"My Results", key:"results" },
  ];

  const renderContent = () => {
    switch(activeNav) {
      case "dashboard": return <NcDashboard currentUser={currentUser} onNavigate={setActiveNav} />;
      case "daily": return <NcDailyMockExam toast={toast} currentUser={currentUser} isAdmin={isAdmin} onBack={()=>setActiveNav("dashboard")} />;
      case "specialty": return <NcSpecialtyExams toast={toast} currentUser={currentUser} isAdmin={isAdmin} onPHNForumUnread={delta => setUnreadPHNForum(n => Math.max(0, n + delta))} />;
      case "archive": return <NcArchiveView toast={toast} currentUser={currentUser} />;
      case "unlock": return (
        <div style={{maxWidth:500,margin:"0 auto"}}>
          <button className="nc-btn" style={{marginBottom:16}} onClick={()=>setActiveNav("dashboard")}>← Back</button>
          <NcPaywall currentUser={currentUser} toast={toast} onUnlocked={()=>setActiveNav("dashboard")} />
        </div>
      );
      case "results": return <Results toast={toast} />;
      default: return <NcDashboard currentUser={currentUser} onNavigate={setActiveNav} />;
    }
  };

  return (
    <>
      <div className="nc-shell">
        {/* Overlay */}
        <div className={`sidebar-overlay${sidebarOpen?" open":""}`} onClick={()=>setSidebarOpen(false)} />
        {/* Army green sidebar */}
        <div className={`nc-sidebar${sidebarOpen?" open":""}`}>
          <div className="nc-sidebar-head">
            <div className="nc-sidebar-logo-icon">🏛️</div>
            <div className="nc-sidebar-logo-name">NC Exam Centre</div>
          </div>
          <div className="nc-nav-sec" style={{marginTop:8}}>Navigation</div>
          {NC_NAV.map(item=>(
            <div key={item.key} className={`nc-nav-item${activeNav===item.key?" active":""}`}
              style={{justifyContent:"space-between"}}
              onClick={()=>{setActiveNav(item.key);setSidebarOpen(false);if(item.key==="specialty")setUnreadPHNForum(0);}}>
              <span><span style={{marginRight:4}}>{item.icon}</span>{item.label}</span>
              {item.key==="specialty" && unreadPHNForum > 0 && (
                <span style={{background:"#ef4444",color:"white",borderRadius:"50%",width:18,height:18,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,flexShrink:0}}>{unreadPHNForum>9?"9+":unreadPHNForum}</span>
              )}
            </div>
          ))}
          {isAdmin&&(
            <>
              <div className="nc-nav-sec" style={{marginTop:8}}>Admin</div>
              <div className={`nc-nav-item${activeNav==="admin"?" active":""}`} onClick={()=>{setActiveNav("admin");setSidebarOpen(false);}}>
                <span style={{marginRight:4}}>🛡️</span>Exam Manager
              </div>
              <div className={`nc-nav-item${activeNav==="admin-mock"?" active":""}`} onClick={()=>{setActiveNav("admin-mock");setSidebarOpen(false);}}>
                <span style={{marginRight:4}}>📅</span>Daily Mock Manager
              </div>
              <div className={`nc-nav-item${activeNav==="admin-archive"?" active":""}`} onClick={()=>{setActiveNav("admin-archive");setSidebarOpen(false);}}>
                <span style={{marginRight:4}}>🗄️</span>Archive Manager
              </div>
            </>
          )}
          <div style={{padding:"16px 8px 0",marginTop:"auto"}}>
            <div className="nc-nav-item" style={{color:"rgba(255,180,120,0.85)"}} onClick={onSwitchToSchool}>
              <span style={{marginRight:4}}>🏥</span>Switch to School Site
            </div>
          </div>
        </div>
        {/* Main content */}
        <div className="nc-main-area">
          <div className="nc-topbar">
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <button className="hamburger" onClick={()=>setSidebarOpen(o=>!o)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#2d4a1e"}}>☰</button>
              <div style={{fontWeight:800,fontSize:16,color:"#2d4a1e",fontFamily:"'Times New Roman',serif"}}>
                🏛️ Nursing Council Exam Centre
              </div>
              <span className="nc-badge">🎓 NC Site</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {/* PHN Forum notification icon in NC topbar */}
              <div title="PHN Class Forum" onClick={()=>{setActiveNav("specialty");setUnreadPHNForum(0);setSidebarOpen(false);}}
                style={{position:"relative",cursor:"pointer",width:36,height:36,borderRadius:"50%",background:"rgba(46,125,50,.12)",border:"1.5px solid rgba(46,125,50,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,transition:"all .2s"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(46,125,50,.22)"}
                onMouseLeave={e=>e.currentTarget.style.background="rgba(46,125,50,.12)"}
              >
                🌍
                {unreadPHNForum > 0 && (
                  <span style={{position:"absolute",top:-4,right:-4,background:"#ef4444",color:"white",borderRadius:"50%",width:17,height:17,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,border:"2px solid white",animation:"pulse 1.2s infinite"}}>{unreadPHNForum>9?"9+":unreadPHNForum}</span>
                )}
              </div>
              <button className="school-toggle-btn" onClick={onSwitchToSchool}>
                🏥 Switch to School Site
              </button>
              <div className="theme-btn" onClick={()=>setThemeMode(m=>m==="light"?"dark":m==="dark"?"dim":"light")}>{themeMode==="light"?"🌙":themeMode==="dark"?"💙":"☀️"}</div>
            </div>
          </div>
          <div className="nc-page-content">
            {activeNav==="admin" ? <AdminNursingExams toast={toast} /> :
             activeNav==="admin-mock" ? <AdminDailyMockManager toast={toast} /> :
             activeNav==="admin-archive" ? <AdminNcArchiveManager toast={toast} /> :
             renderContent()}
          </div>
        </div>
      </div>
      <Toasts list={[]} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════════════
// ─── PAYMENT HISTORY COMPONENT ───────────────────────────────────────
