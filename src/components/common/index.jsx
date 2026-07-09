import { useState, useEffect, useRef } from "react";
import { ls } from "../../utils/storage";

export function Toasts({ list }) {
  return <div className="toast-wrap">{list.map(t=><div key={t.id} className={`toast ${t.type}`}><span>{t.type==="success"?"✅":t.type==="error"?"❌":t.type==="warn"?"⚠️":"ℹ️"}</span>{t.msg}</div>)}</div>;
}

// ════════════════════════════════════════════════════════════════════
// ADMIN PANEL
// ════════════════════════════════════════════════════════════════════

export function PaymentHistory({ currentUser }) {
  const history = ls("nv-payment-history", []).filter(p => p.email === currentUser);
  return (
    <div style={{maxWidth:700,margin:"0 auto",paddingBottom:40}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22,marginBottom:4}}>💳 Payment History</div>
      <div style={{color:"var(--text3)",fontSize:13,marginBottom:20}}>Your NC Exam access code purchases</div>
      {history.length === 0 ? (
        <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}>📭</div>
          <div style={{fontWeight:700}}>No payments yet</div>
          <div style={{fontSize:13,marginTop:4}}>Your payment history will appear here after purchase</div>
        </div>
      ) : history.map((p,i) => (
        <div key={i} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px 20px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:15,color:"var(--accent)",letterSpacing:1}}>{p.code}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>Ref: {p.ref}</div>
            <div style={{fontSize:12,color:"var(--text3)"}}>{new Date(p.date).toLocaleString()}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontWeight:800,fontSize:18,color:"#22c55e"}}>₦{(p.amount||0).toLocaleString()}</div>
            <div style={{fontSize:11,marginTop:4,background:"rgba(34,197,94,.12)",color:"#22c55e",borderRadius:20,padding:"2px 10px",fontWeight:700}}>✅ Paid</div>
            <div style={{fontSize:11,marginTop:4,color:"var(--text3)",cursor:"pointer"}} onClick={()=>navigator.clipboard?.writeText(p.code).then(()=>alert("Code copied!"))}>📋 Copy Code</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── STUDY TIMER / POMODORO COMPONENT ────────────────────────────────

export function StudyTimer() {
  const [mode, setMode] = useState("focus"); // focus | short | long
  const MODES = { focus:{label:"🎯 Focus",mins:25,color:"#ef4444"}, short:{label:"☕ Short Break",mins:5,color:"#22c55e"}, long:{label:"🌴 Long Break",mins:15,color:"#3b82f6"} };
  const [secs, setSecs] = useState(MODES.focus.mins * 60);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    setSecs(MODES[mode].mins * 60);
    setRunning(false);
    clearInterval(intervalRef.current);
  }, [mode]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSecs(s => {
          if (s <= 1) {
            clearInterval(intervalRef.current);
            setRunning(false);
            if (mode === "focus") setSessions(n => n + 1);
            try { new Audio("https://www.soundjay.com/buttons/sounds/button-09.mp3").play(); } catch(e){}
            alert(mode === "focus" ? "🎉 Focus session complete! Take a break." : "⏰ Break over! Time to focus.");
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else clearInterval(intervalRef.current);
    return () => clearInterval(intervalRef.current);
  }, [running]);

  const mm = String(Math.floor(secs/60)).padStart(2,"0");
  const ss = String(secs%60).padStart(2,"0");
  const pct = 1 - secs / (MODES[mode].mins * 60);
  const r = 80, circ = 2 * Math.PI * r;

  return (
    <div style={{maxWidth:480,margin:"0 auto",paddingBottom:40,textAlign:"center"}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22,marginBottom:4}}>⏱️ Study Timer</div>
      <div style={{color:"var(--text3)",fontSize:13,marginBottom:24}}>Stay focused with Pomodoro technique</div>
      <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:32}}>
        {Object.entries(MODES).map(([k,v])=>(
          <button key={k} onClick={()=>setMode(k)} style={{padding:"8px 16px",borderRadius:20,border:`2px solid ${mode===k?v.color:"var(--border)"}`,background:mode===k?`${v.color}22`:"transparent",color:mode===k?v.color:"var(--text3)",fontWeight:700,fontSize:12,cursor:"pointer"}}>{v.label}</button>
        ))}
      </div>
      <div style={{position:"relative",display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:32}}>
        <svg width={200} height={200} style={{transform:"rotate(-90deg)"}}>
          <circle cx={100} cy={100} r={r} fill="none" stroke="var(--border)" strokeWidth={10}/>
          <circle cx={100} cy={100} r={r} fill="none" stroke={MODES[mode].color} strokeWidth={10} strokeDasharray={circ} strokeDashoffset={circ*(1-pct)} strokeLinecap="round" style={{transition:"stroke-dashoffset 1s linear"}}/>
        </svg>
        <div style={{position:"absolute",textAlign:"center"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:42,fontWeight:700,color:MODES[mode].color}}>{mm}:{ss}</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{MODES[mode].label}</div>
        </div>
      </div>
      <div style={{display:"flex",gap:12,justifyContent:"center",marginBottom:24}}>
        <button onClick={()=>setRunning(r=>!r)} style={{padding:"12px 32px",borderRadius:12,background:MODES[mode].color,color:"white",fontWeight:800,fontSize:16,border:"none",cursor:"pointer"}}>{running?"⏸ Pause":"▶️ Start"}</button>
        <button onClick={()=>{setSecs(MODES[mode].mins*60);setRunning(false);}} style={{padding:"12px 20px",borderRadius:12,background:"var(--bg4)",border:"1px solid var(--border)",fontWeight:700,cursor:"pointer"}}>↺ Reset</button>
      </div>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px",display:"inline-block",minWidth:200}}>
        <div style={{fontSize:28,fontWeight:800,color:"var(--accent)"}}>{sessions}</div>
        <div style={{fontSize:12,color:"var(--text3)"}}>Focus sessions today</div>
        <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>🍅 {sessions} Pomodoros = ~{sessions*25} min focused</div>
      </div>
    </div>
  );
}

// ─── PERFORMANCE ANALYTICS COMPONENT ─────────────────────────────────

export function PerformanceAnalytics({ currentUser }) {
  const results = ls("nv-results", []).filter(r => r.user === currentUser || !r.user);
  const last10 = results.slice(-10);
  const avgScore = results.length ? Math.round(results.reduce((s,r)=>s+(r.pct||0),0)/results.length) : 0;
  const passed = results.filter(r=>(r.pct||0)>=50).length;
  const best = results.reduce((b,r)=>(r.pct||0)>(b.pct||0)?r:b, {pct:0});
  const subjectMap = {};
  results.forEach(r=>{ if(r.subject){ if(!subjectMap[r.subject]) subjectMap[r.subject]={total:0,count:0}; subjectMap[r.subject].total+=(r.pct||0); subjectMap[r.subject].count++; } });
  const subjects = Object.entries(subjectMap).map(([k,v])=>({name:k,avg:Math.round(v.total/v.count)})).sort((a,b)=>b.avg-a.avg);

  return (
    <div style={{maxWidth:700,margin:"0 auto",paddingBottom:40}}>
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22,marginBottom:4}}>📊 Performance Analytics</div>
      <div style={{color:"var(--text3)",fontSize:13,marginBottom:20}}>Track your exam progress over time</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:24}}>
        {[{lbl:"Total Exams",val:results.length,icon:"📝"},{lbl:"Avg Score",val:`${avgScore}%`,icon:"🎯"},{lbl:"Passed",val:passed,icon:"✅"},{lbl:"Best Score",val:`${best.pct||0}%`,icon:"🏆"}].map(s=>(
          <div key={s.lbl} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px",textAlign:"center"}}>
            <div style={{fontSize:24}}>{s.icon}</div>
            <div style={{fontWeight:800,fontSize:22,marginTop:4}}>{s.val}</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>{s.lbl}</div>
          </div>
        ))}
      </div>
      {last10.length > 0 && (
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"20px",marginBottom:20}}>
          <div style={{fontWeight:700,marginBottom:16}}>📈 Last {last10.length} Exam Scores</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:6,height:120}}>
            {last10.map((r,i)=>{
              const h = Math.max(8, (r.pct||0) * 1.1);
              const clr = (r.pct||0)>=70?"#22c55e":(r.pct||0)>=50?"#f59e0b":"#ef4444";
              return (
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                  <div style={{fontSize:10,color:clr,fontWeight:700}}>{r.pct||0}%</div>
                  <div style={{width:"100%",height:`${h}px`,background:clr,borderRadius:"4px 4px 0 0",transition:"height .3s"}}/>
                  <div style={{fontSize:9,color:"var(--text3)",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",width:"100%"}}>{i+1}</div>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:16,marginTop:12,fontSize:11}}>
            {[["#22c55e","≥70% Pass"],["#f59e0b","50-69% Fair"],["#ef4444","<50% Fail"]].map(([c,l])=>(
              <span key={l} style={{display:"flex",alignItems:"center",gap:4,color:"var(--text3)"}}><span style={{width:10,height:10,borderRadius:2,background:c,display:"inline-block"}}/>{l}</span>
            ))}
          </div>
        </div>
      )}
      {subjects.length > 0 && (
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"20px"}}>
          <div style={{fontWeight:700,marginBottom:16}}>📚 Performance by Subject</div>
          {subjects.slice(0,8).map(s=>(
            <div key={s.name} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
                <span style={{fontWeight:600}}>{s.name}</span>
                <span style={{fontWeight:700,color:s.avg>=70?"#22c55e":s.avg>=50?"#f59e0b":"#ef4444"}}>{s.avg}%</span>
              </div>
              <div style={{height:8,background:"var(--bg4)",borderRadius:4,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${s.avg}%`,background:s.avg>=70?"#22c55e":s.avg>=50?"#f59e0b":"#ef4444",borderRadius:4,transition:"width .5s"}}/>
              </div>
            </div>
          ))}
        </div>
      )}
      {results.length === 0 && (
        <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}>📊</div>
          <div style={{fontWeight:700}}>No exam data yet</div>
          <div style={{fontSize:13,marginTop:4}}>Take some exams to see your analytics here</div>
        </div>
      )}
    </div>
  );
}

// ─── FLASHCARD SYSTEM ─────────────────────────────────────────────────
