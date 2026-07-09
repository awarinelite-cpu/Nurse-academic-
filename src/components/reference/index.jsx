import { useState, Fragment } from "react";
import { DEFAULT_DRUGS, DEFAULT_LABS, DEFAULT_SKILLS } from "../../data/defaults";
import { saveMyData, useSharedData } from "../../services/backend";
import { ls } from "../../utils/storage";
import { Results } from "../../components/student";

export function DrugGuideView() {
  const [drugs] = useSharedData("nv-drugs", DEFAULT_DRUGS);
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState(null);
  const q = search.trim().toLowerCase();

  // Search across name, class, uses, contraindications, side_effects
  const filtered = drugs.filter(d => {
    if (!q) return true;
    return (
      (d.name             || "").toLowerCase().includes(q) ||
      (d.class            || "").toLowerCase().includes(q) ||
      (d.uses             || "").toLowerCase().includes(q) ||
      (d.contraindications|| "").toLowerCase().includes(q) ||
      (d.side_effects     || "").toLowerCase().includes(q)
    );
  });

  // Highlight matching text
  const highlight = (text) => {
    if (!q || !text) return text || "—";
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return text;
    return (
      <span>
        {text.slice(0, idx)}
        <mark style={{background:"rgba(62,142,149,.3)",color:"var(--accent)",borderRadius:3,padding:"0 2px",fontWeight:800}}>{text.slice(idx, idx+q.length)}</mark>
        {text.slice(idx+q.length)}
      </span>
    );
  };

  // Determine which field matched (for showing match context)
  const getMatchReason = (d) => {
    if (!q) return null;
    if ((d.uses||"").toLowerCase().includes(q)) return { label:"Uses", value: d.uses };
    if ((d.contraindications||"").toLowerCase().includes(q)) return { label:"Contraindications", value: d.contraindications };
    if ((d.side_effects||"").toLowerCase().includes(q)) return { label:"Side Effects", value: d.side_effects };
    return null;
  };

  return (
    <div>
      <div className="sec-title">💊 Drug Guide</div>
      <div className="sec-sub">Search by drug name, class, or uses</div>

      {/* Search bar */}
      <div className="search-wrap" style={{marginBottom:10}}>
        <span className="search-ico">🔍</span>
        <input
          placeholder="Search by name, class, uses, side effects..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoComplete="off"
        />
        {search && (
          <button onClick={()=>setSearch("")}
            style={{background:"none",border:"none",cursor:"pointer",fontSize:16,color:"var(--text3)",padding:"0 8px",flexShrink:0}}>✕</button>
        )}
      </div>



      {/* Results count */}
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:10,fontWeight:600}}>
        {q
          ? `${filtered.length} result${filtered.length!==1?"s":""} found for "${search}"`
          : `${drugs.length} drug${drugs.length!==1?"s":""} in database`}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div style={{textAlign:"center",padding:"40px 20px",color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:14}}>
          <div style={{fontSize:40,marginBottom:12}}>💊</div>
          <div style={{fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:6}}>No drugs found</div>
          <div style={{fontSize:13}}>Try searching by a different name, class, or use</div>
          {q&&<button className="btn btn-sm" style={{marginTop:12}} onClick={()=>setSearch("")}>Clear search</button>}
        </div>
      )}

      {/* Drug cards grid */}
      <div className="grid2">
        {filtered.map((d,i)=>{
          const matchReason = getMatchReason(d);
          return (
            <div key={d.id} className="card" style={{cursor:"pointer",animation:`fadeUp .25s ease ${i*.04}s both`,borderLeft:"3px solid var(--accent)"}}
              onClick={()=>setSel(d)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:8}}>
                <div style={{fontWeight:800,fontSize:15,color:"var(--text)",lineHeight:1.3}}>{highlight(d.name)}</div>
                <span style={{flexShrink:0,fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:20,background:"rgba(62,142,149,.12)",color:"var(--accent)",border:"1px solid rgba(62,142,149,.25)",whiteSpace:"nowrap"}}>
                  {highlight(d.class?.split("/")[0]||d.class)}
                </span>
              </div>
              <div style={{fontSize:12,color:"var(--text3)",marginBottom:4}}>
                <span style={{fontWeight:700,color:"var(--text2)"}}>💊 Dose: </span>{d.dose}
              </div>
              <div style={{fontSize:12,color:"var(--text3)",marginBottom: matchReason?6:0}}>
                <span style={{fontWeight:700,color:"var(--text2)"}}>✅ Uses: </span>{highlight(d.uses)}
              </div>
              {/* Show matched field context if match wasn't in name/class/uses */}
              {matchReason && matchReason.label !== "Uses" && (
                <div style={{marginTop:6,padding:"5px 8px",background:"rgba(62,142,149,.07)",borderRadius:7,fontSize:11,color:"var(--text3)",borderLeft:"2px solid var(--accent)"}}>
                  <span style={{fontWeight:700,color:"var(--accent)"}}>{matchReason.label}: </span>
                  {highlight(matchReason.value)}
                </div>
              )}
              <div style={{marginTop:8,fontSize:10,color:"var(--accent)",fontWeight:700,textAlign:"right"}}>Tap for full details →</div>
            </div>
          );
        })}
      </div>

      {/* Full detail modal */}
      {sel && (
        <div className="modal-overlay" onClick={()=>setSel(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:480}}>
            <div className="modal-head">
              <div>
                <div className="modal-title" style={{marginBottom:4}}>💊 {sel.name}</div>
                <span style={{fontSize:11,fontWeight:800,padding:"3px 10px",borderRadius:20,background:"rgba(62,142,149,.15)",color:"var(--accent)",border:"1px solid rgba(62,142,149,.3)"}}>{sel.class}</span>
              </div>
              <button className="modal-close" onClick={()=>setSel(null)}>✕</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:12,marginTop:14}}>
              {[
                ["💊","Dose",          sel.dose,          "rgba(62,142,149,.08)","var(--accent)"],
                ["📊","Max Daily Dose",sel.max,           "rgba(62,142,149,.06)","var(--accent)"],
                ["✅","Uses",          sel.uses,          "rgba(34,197,94,.08)","var(--success)"],
                ["⚠️","Contraindications",sel.contraindications,"rgba(245,158,11,.08)","#f59e0b"],
                ["⚡","Side Effects",  sel.side_effects,  "rgba(239,68,68,.07)","var(--danger)"],
              ].map(([icon,label,value,bg,color])=>(
                <div key={label} style={{background:bg,borderRadius:10,padding:"10px 14px",border:`1px solid ${color}22`}}>
                  <div style={{fontWeight:800,fontSize:10,color:color,marginBottom:5,textTransform:"uppercase",letterSpacing:.8}}>
                    {icon} {label}
                  </div>
                  <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.6}}>{value||"—"}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-sm" style={{marginTop:14,width:"100%"}} onClick={()=>setSel(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function LabReferenceView() {
  const [labs] = useSharedData("nv-labs", DEFAULT_LABS);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all"); // all | low | high | normal
  const filtered = labs.filter(l => {
    const q = search.toLowerCase();
    return !q || l.test.toLowerCase().includes(q) || (l.normal||"").toLowerCase().includes(q)
      || (l.low||"").toLowerCase().includes(q) || (l.high||"").toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="sec-title">🧪 Lab Reference</div>
      <div className="sec-sub">Normal laboratory values with clinical indications</div>

      {/* Search */}
      <div className="search-wrap" style={{marginBottom:16}}>
        <span className="search-ico">🔍</span>
        <input placeholder="Search test name or indication..." value={search} onChange={e=>setSearch(e.target.value)} />
      </div>

      {/* Column legend */}
      <div style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 2fr 2fr",gap:6,padding:"8px 14px",background:"var(--bg4)",borderRadius:10,marginBottom:12,fontSize:11,fontWeight:800}}>
        <div style={{color:"var(--text3)"}}>TEST</div>
        <div style={{color:"var(--success)"}}>NORMAL VALUE</div>
        <div style={{color:"#f59e0b"}}>↓ LOW (INDICATION)</div>
        <div style={{color:"var(--danger)"}}>↑ HIGH (INDICATION)</div>
      </div>

      {filtered.length===0&&(
        <div style={{textAlign:"center",padding:28,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:12}}>
          {search ? "No results for \""+search+"\"" : "No lab tests available yet."}
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.map((l,i)=>(
          <div key={l.id||i} className="card" style={{padding:0,overflow:"hidden",borderLeft:"4px solid var(--accent)"}}>
            {/* Test name header */}
            <div style={{padding:"10px 14px 8px",background:"var(--bg4)",borderBottom:"1px solid var(--border)"}}>
              <div style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>🧪 {l.test}</div>
            </div>
            {/* 3-column data */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr"}}>
              {/* Normal */}
              <div style={{padding:"10px 14px",borderRight:"1px solid var(--border)"}}>
                <div style={{fontWeight:800,fontSize:10,color:"var(--success)",marginBottom:5,textTransform:"uppercase",letterSpacing:.8,display:"flex",alignItems:"center",gap:4}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:"var(--success)",display:"inline-block"}}/>Normal Value
                </div>
                <div style={{fontSize:13,fontFamily:"monospace",color:"var(--text2)",lineHeight:1.6,whiteSpace:"pre-line"}}>
                  {l.normal || l.male || "—"}
                  {l.female && l.female !== l.male && !l.normal ? "\n"+l.female : ""}
                </div>
              </div>
              {/* Low */}
              <div style={{padding:"10px 14px",borderRight:"1px solid var(--border)",background:"rgba(245,158,11,.03)"}}>
                <div style={{fontWeight:800,fontSize:10,color:"#f59e0b",marginBottom:5,textTransform:"uppercase",letterSpacing:.8,display:"flex",alignItems:"center",gap:4}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:"#f59e0b",display:"inline-block"}}/>Low (Indication)
                </div>
                <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.6}}>
                  {l.low || l.notes || "—"}
                </div>
              </div>
              {/* High */}
              <div style={{padding:"10px 14px",background:"rgba(239,68,68,.03)"}}>
                <div style={{fontWeight:800,fontSize:10,color:"var(--danger)",marginBottom:5,textTransform:"uppercase",letterSpacing:.8,display:"flex",alignItems:"center",gap:4}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:"var(--danger)",display:"inline-block"}}/>High (Indication)
                </div>
                <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.6}}>
                  {l.high || "—"}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {labs.length>0&&(
        <div style={{textAlign:"center",marginTop:16,fontSize:11,color:"var(--text3)"}}>
          Showing {filtered.length} of {labs.length} lab test{labs.length!==1?"s":""}
        </div>
      )}
    </div>
  );
}

export function SkillsView() {
  const [skillsDb] = useSharedData("nv-skillsdb", DEFAULT_SKILLS);
  // tick keys: "stationIdx-subTopicIdx-activityIdx"
  const [ticked, setTicked] = useState(()=>ls("nv-skills-done",{}));
  const [expanded, setExpanded] = useState({});
  const [expandAll, setExpandAll] = useState(false);
  const [osceSearch, setOsceSearch] = useState("");
  // Q-station state: { [stationIdx-qIdx]: selectedLetter }
  const [qAnswers, setQAnswers] = useState(()=>ls("nv-skills-qans",{}));
  const [qRevealed, setQRevealed] = useState({});

  // ── mark helpers ───────────────────────────────────────────────────
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
  const fmtMark = (v) => {
    if (!v) return "0";
    if (v===0.5)  return "½";
    if (v===0.25) return "¼";
    if (v===0.75) return "¾";
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/,"");
  };

  // ── per-station stats ──────────────────────────────────────────────
  const stationStats = (s, si) => {
    if (s.isQuestionStation) return { totalActs:0, tickedActs:0, maxMarks:0, earnedMarks:0 };
    const subTopics = s.subTopics&&s.subTopics.length ? s.subTopics : null;
    if (!subTopics) {
      const acts = s.activities||[];
      const tickedActs = acts.filter((_,ai)=>ticked[`${si}-0-${ai}`]||ticked[`${si}-${ai}`]).length;
      const maxMarks = acts.reduce((s,a)=>s+(parseMark(a.mark)||0),0);
      const earnedMarks = acts.reduce((s,a,ai)=>s+(ticked[`${si}-0-${ai}`]||ticked[`${si}-${ai}`]?parseMark(a.mark)||0:0),0);
      return { totalActs:acts.length, tickedActs, maxMarks, earnedMarks };
    }
    let totalActs=0, tickedActs=0, maxMarks=0, earnedMarks=0;
    subTopics.forEach((st,sti)=>{
      (st.activities||[]).forEach((a,ai)=>{
        totalActs++;
        const done=!!ticked[`${si}-${sti}-${ai}`];
        if (done){ tickedActs++; earnedMarks+=parseMark(a.mark)||0; }
        maxMarks+=parseMark(a.mark)||0;
      });
    });
    return { totalActs, tickedActs, maxMarks, earnedMarks };
  };

  const toggle = (si,sti,ai) => {
    const k=`${si}-${sti}-${ai}`;
    const u={...ticked,[k]:!ticked[k]};
    setTicked(u); saveMyData("skills-done","nv-skills-done",u);
  };

  const resetStation = (si,s) => {
    const u={...ticked};
    if (s.subTopics&&s.subTopics.length) {
      s.subTopics.forEach((st,sti)=>{ (st.activities||[]).forEach((_,ai)=>{ delete u[`${si}-${sti}-${ai}`]; }); });
    } else {
      (s.activities||[]).forEach((_,ai)=>{ delete u[`${si}-0-${ai}`]; delete u[`${si}-${ai}`]; });
    }
    setTicked(u); saveMyData("skills-done","nv-skills-done",u);
  };

  const pickAnswer = (si,qi,letter) => {
    const k=`${si}-${qi}`;
    const u={...qAnswers,[k]:letter};
    setQAnswers(u); saveMyData("skills-qans","nv-skills-qans",u);
  };
  const revealQ = (si,qi) => setQRevealed(r=>({...r,[`${si}-${qi}`]:true}));

  const toggleSection = (si) => setExpanded(e => {
    const isCurrentlyOpen = expandAll ? e[si]!==true : e[si]===true;
    if (isCurrentlyOpen) {
      // Close the currently open one
      const next = {...e};
      if (expandAll) { next[si] = true; } else { delete next[si]; }
      return next;
    } else {
      // Open this one, close all others
      if (expandAll) {
        // expandAll: open = NOT true, closed = true. Close all by setting true, then un-set si
        const next = {...e};
        Object.keys(next).forEach(k => { next[k] = true; });
        delete next[si]; // si now follows expandAll default = open
        return next;
      } else {
        return {[si]: true}; // only si is open
      }
    }
  });

  const filteredSkills = osceSearch.trim()
    ? skillsDb.filter(s=>{
        const q=osceSearch.trim().toLowerCase();
        if ((s.heading||s.name||"").toLowerCase().includes(q)) return true;
        if (s.isQuestionStation) return (s.questionStation||[]).some(qs=>(qs.q||"").toLowerCase().includes(q));
        return (s.subTopics||[]).some(st=>(st.title||"").toLowerCase().includes(q)||(st.activities||[]).some(a=>(a.text||"").toLowerCase().includes(q)));
      })
    : skillsDb;

  const globalStats = skillsDb.filter(s=>!s.isQuestionStation).reduce((acc,s,i)=>{
    const si=skillsDb.indexOf(s);
    const st=stationStats(s,si);
    acc.totalActs+=st.totalActs; acc.tickedActs+=st.tickedActs;
    acc.maxMarks+=st.maxMarks;   acc.earnedMarks+=st.earnedMarks;
    return acc;
  },{totalActs:0,tickedActs:0,maxMarks:0,earnedMarks:0});

  // ── Question station renderer (shared by standalone & embedded) ────
  const renderQuestionStation = (qs, si, label) => {
    if (!qs||!qs.length) return null;
    return (
      <div style={{marginTop:6}}>
        {label&&<div style={{fontWeight:800,fontSize:11,color:"var(--text3)",marginBottom:10,
          textTransform:"uppercase",letterSpacing:.8,paddingTop:10,borderTop:"1px dashed var(--border)"}}>
          ❓ {label}
        </div>}
        {qs.map((q,qi)=>{
          const k=`${si}-${qi}`;
          const picked = qAnswers[k];
          const revealed = !!qRevealed[k];
          const hasMcq = q.options&&q.options.length>0;
          const isFill = q.type==="fill"||q.isFill;

          return (
            <div key={qi} style={{marginBottom:12,background:"var(--bg4)",borderRadius:10,
              padding:"12px 14px",border:"1px solid var(--border)"}}>
              {/* Question number + text */}
              <div style={{fontWeight:700,fontSize:13,marginBottom:hasMcq?10:0,lineHeight:1.6}}>
                <span style={{color:"var(--accent)",fontWeight:800,marginRight:5}}>{q.qNum||qi+1}.</span>
                {isFill
                  ? <span>{q.q.replace(/\.{4,}/,"").trim()}
                      <span style={{display:"inline-block",minWidth:120,borderBottom:"2px solid var(--accent)",
                        margin:"0 6px",verticalAlign:"bottom",height:18,background:"transparent"}} />
                    </span>
                  : <span>{q.q}</span>
                }
              </div>

              {/* MCQ options */}
              {hasMcq&&(
                <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
                  {q.options.map((opt,oi)=>{
                    const isSel = picked===opt.letter;
                    const isRight = revealed && q.ans===opt.letter;
                    const isWrong = revealed && isSel && q.ans!==opt.letter;
                    const noAns = !q.ans; // answer key not provided
                    return (
                      <div key={oi}
                        onClick={()=>!revealed&&pickAnswer(si,qi,opt.letter)}
                        style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",
                          borderRadius:7,cursor:revealed?"default":"pointer",transition:"all .15s",
                          background:isRight?"rgba(34,197,94,.12)":isWrong?"rgba(239,68,68,.08)":isSel?"rgba(62,142,149,.1)":"transparent",
                          border:`1px solid ${isRight?"var(--success)":isWrong?"var(--danger)":isSel?"var(--accent)":"var(--border)"}`}}>
                        <div style={{width:22,height:22,borderRadius:"50%",flexShrink:0,
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:11,fontWeight:800,
                          background:isRight?"var(--success)":isWrong?"var(--danger)":isSel?"var(--accent)":"transparent",
                          color:isRight||isWrong||isSel?"#fff":"var(--text3)",
                          border:`2px solid ${isRight?"var(--success)":isWrong?"var(--danger)":isSel?"var(--accent)":"var(--border2)"}`}}>
                          {opt.letter}
                        </div>
                        <span style={{fontSize:13,flex:1,
                          color:isRight?"var(--success)":isWrong?"var(--danger)":"var(--text2)",
                          fontWeight:isRight?700:400}}>{opt.text}</span>
                        {isRight&&<span style={{fontSize:11,color:"var(--success)",fontWeight:800,flexShrink:0}}>✓</span>}
                        {isWrong&&<span style={{fontSize:11,color:"var(--danger)",fontWeight:800,flexShrink:0}}>✗</span>}
                        {revealed&&noAns&&isSel&&<span style={{fontSize:11,color:"var(--accent)",fontWeight:800,flexShrink:0}}>←</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Fill-in answer box (no options) */}
              {isFill&&!hasMcq&&(
                <div style={{marginTop:8,padding:"6px 10px",background:"rgba(62,142,149,.06)",
                  borderRadius:7,border:"1px dashed rgba(62,142,149,.3)",fontSize:12,
                  color:"var(--text3)",fontStyle:"italic"}}>
                  Fill-in-the-blank — write your answer
                </div>
              )}

              {/* Reveal / check button */}
              {hasMcq&&!revealed&&picked&&(
                <button className="btn btn-sm btn-accent" style={{marginTop:8,fontSize:11,padding:"4px 12px"}}
                  onClick={()=>q.ans&&revealQ(si,qi)}>
                  {q.ans?"Check Answer":"Select above"}
                </button>
              )}
              {revealed&&<div style={{marginTop:6,fontSize:11,color:"var(--success)",fontWeight:700}}>
                ✅ {q.ans?"Answer: "+q.ans:"Your choice recorded"}
              </div>}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,flexWrap:"wrap",gap:8}}>
        <div className="sec-title" style={{marginBottom:0}}>✅ OSCE Clinical Checklist for RN</div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn btn-sm" onClick={()=>{setExpandAll(true);setExpanded({});}}>Expand All</button>
          <button className="btn btn-sm" onClick={()=>{setExpandAll(false);setExpanded(skillsDb.reduce((o,_,i)=>({...o,[i]:true}),{}));}}>Collapse All</button>
        </div>
      </div>
      <div className="sec-sub">Tap a station to open its checklist • tick each numbered procedure step to record your score</div>

      {/* Search */}
      <div style={{display:"flex",gap:8,marginBottom:14,marginTop:8}}>
        <div style={{position:"relative",flex:1}}>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:15,color:"var(--text3)",pointerEvents:"none"}}>🔍</span>
          <input className="inp" style={{marginBottom:0,paddingLeft:34}} placeholder="Search station, procedure or question…" value={osceSearch} onChange={e=>setOsceSearch(e.target.value)} />
        </div>
        {osceSearch&&<button className="btn btn-sm" onClick={()=>setOsceSearch("")}>✕ Clear</button>}
      </div>
      {osceSearch&&<div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>{filteredSkills.length} result{filteredSkills.length!==1?"s":""} for "{osceSearch}"</div>}

      {/* Overall progress (procedures only) */}
      <div className="card" style={{marginBottom:16,padding:"12px 16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <span style={{fontSize:12,color:"var(--text3)",fontWeight:700}}>Procedure Progress</span>
          <div style={{display:"flex",gap:14}}>
            <span style={{fontSize:12,fontWeight:800,color:"var(--accent)"}}>{globalStats.tickedActs}/{globalStats.totalActs} steps</span>
            {globalStats.maxMarks>0&&<span style={{fontSize:12,fontWeight:800,color:"var(--success)"}}>{fmtMark(globalStats.earnedMarks)}/{fmtMark(globalStats.maxMarks)} marks</span>}
          </div>
        </div>
        <div className="progress-wrap">
          <div className="progress-fill" style={{width:`${globalStats.totalActs>0?(globalStats.tickedActs/globalStats.totalActs)*100:0}%`,background:"linear-gradient(90deg,var(--accent),var(--accent2))"}} />
        </div>
        <div style={{fontSize:10,color:"var(--text3)",marginTop:4}}>
          Only numbered procedure steps have tick boxes • instructions and group labels are for reference only
        </div>
      </div>

      {skillsDb.length===0&&(
        <div style={{textAlign:"center",padding:28,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:12}}>
          No OSCE stations yet — ask your admin to add them.
        </div>
      )}
      {filteredSkills.length===0&&osceSearch&&skillsDb.length>0&&(
        <div style={{textAlign:"center",padding:28,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:12}}>
          No stations match "<b>{osceSearch}</b>" — try a different keyword.
        </div>
      )}

      {filteredSkills.map((s)=>{
        const si = skillsDb.indexOf(s);
        const isOpen = expandAll ? expanded[si]!==true : expanded[si]===true;

        // ════════════════════════════════════════════════════════════
        // STANDALONE QUESTION STATION
        // ════════════════════════════════════════════════════════════
        if (s.isQuestionStation) {
          const qs = s.questionStation||[];
          return (
            <div key={s.id||si} className="card" style={{marginBottom:14,borderLeft:"4px solid var(--purple,#8b5cf6)"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"2px 0"}}
                onClick={()=>toggleSection(si)}>
                <div style={{width:38,height:38,borderRadius:9,background:"rgba(139,92,246,.12)",display:"flex",
                  alignItems:"center",justifyContent:"center",fontSize:19,flexShrink:0}}>❓</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:800,fontSize:14,color:"var(--purple,#8b5cf6)",lineHeight:1.3}}>
                    QUESTION STATION: {s.heading}
                  </div>
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
                    {qs.length} question{qs.length!==1?"s":""} •{" "}
                    {qs.filter(q=>q.options&&q.options.length).length} MCQ •{" "}
                    {qs.filter(q=>q.isFill).length} fill-in-blank
                  </div>
                </div>
                <span style={{fontSize:14,color:"var(--text3)",transition:"transform .2s",display:"inline-block",
                  transform:isOpen?"rotate(0deg)":"rotate(-90deg)"}}>▾</span>
              </div>

              {isOpen&&(
                <div style={{marginTop:14,borderTop:"1px solid var(--border)",paddingTop:14}}>
                  {renderQuestionStation(qs, si, null)}
                  <div style={{marginTop:10,display:"flex",justifyContent:"flex-end"}}>
                    <button className="btn btn-sm" style={{fontSize:11,color:"var(--text3)"}}
                      onClick={e=>{e.stopPropagation();setQAnswers(qa=>{const u={...qa};qs.forEach((_,qi)=>{delete u[`${si}-${qi}`];});return u;});setQRevealed(r=>{const u={...r};qs.forEach((_,qi)=>{delete u[`${si}-${qi}`];});return u;});}}>
                      🔄 Reset answers
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }

        // ════════════════════════════════════════════════════════════
        // PROCEDURE STATION
        // ════════════════════════════════════════════════════════════
        const stats = stationStats(s, si);
        const subTopics = s.subTopics&&s.subTopics.length ? s.subTopics : null;
        const pct = stats.maxMarks>0 ? Math.round((stats.earnedMarks/stats.maxMarks)*100) : (stats.totalActs>0?Math.round((stats.tickedActs/stats.totalActs)*100):0);
        const allDone = stats.totalActs>0 && stats.tickedActs===stats.totalActs;

        return (
          <div key={s.id||si} className="card" style={{marginBottom:14,borderLeft:"4px solid var(--accent)"}}>
            {/* Station heading */}
            <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"2px 0"}}
              onClick={()=>toggleSection(si)}>
              <div style={{width:38,height:38,borderRadius:9,background:"rgba(62,142,149,.12)",display:"flex",
                alignItems:"center",justifyContent:"center",fontSize:19,flexShrink:0}}>🩺</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:800,fontSize:14,color:"var(--accent)",lineHeight:1.3}}>
                  PROCEDURE STATION: {s.heading||s.name}
                </div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
                  {stats.tickedActs}/{stats.totalActs} steps ticked
                  {stats.maxMarks>0&&<span style={{marginLeft:8,fontWeight:700,
                    color:pct>=70?"var(--success)":pct>=50?"var(--warn)":"var(--text3)"}}>
                    • {fmtMark(stats.earnedMarks)}/{fmtMark(stats.maxMarks)} marks ({pct}%)
                  </span>}
                  {subTopics&&<span style={{marginLeft:8}}>• {subTopics.length} topic{subTopics.length!==1?"s":""}</span>}
                  {(s.questionStation||[]).length>0&&<span style={{marginLeft:8}}>• {s.questionStation.length} Q</span>}
                </div>
                {stats.totalActs>0&&(
                  <div style={{marginTop:5,height:4,background:"var(--bg4)",borderRadius:4,overflow:"hidden"}}>
                    <div style={{height:"100%",borderRadius:4,transition:"width .3s",
                      width:`${(stats.tickedActs/stats.totalActs)*100}%`,
                      background:allDone?"var(--success)":pct>=50?"var(--warn)":"var(--accent)"}} />
                  </div>
                )}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                {allDone&&<span style={{fontSize:11,fontWeight:700,color:"var(--success)"}}>✅</span>}
                <span style={{fontSize:14,color:"var(--text3)",transition:"transform .2s",display:"inline-block",
                  transform:isOpen?"rotate(0deg)":"rotate(-90deg)"}}>▾</span>
              </div>
            </div>

            {isOpen&&(
              <div style={{marginTop:14,borderTop:"1px solid var(--border)",paddingTop:14}}>

                {/* Instructions — read only, no tick */}
                {(s.instructions||[]).length>0&&(
                  <div style={{marginBottom:16,background:"rgba(62,142,149,.06)",borderRadius:10,
                    padding:"10px 14px",border:"1px solid rgba(62,142,149,.2)"}}>
                    <div style={{fontWeight:800,fontSize:11,color:"var(--accent)",marginBottom:8,
                      textTransform:"uppercase",letterSpacing:.8}}>📋 Instruction to Candidate</div>
                    {(s.instructions||[]).map((ins,ii)=>(
                      <div key={ii} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:13,marginBottom:5,lineHeight:1.55}}>
                        <span style={{color:"var(--accent)",flexShrink:0,marginTop:1}}>➤</span>
                        <span style={{color:"var(--text2)"}}>{ins}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sub-topics */}
                {subTopics ? subTopics.map((st,sti)=>{
                  const stActs = st.activities||[];
                  const stMax = st.totalMarksNum || stActs.reduce((s,a)=>s+(parseMark(a.mark)||0),0);
                  const stEarned = stActs.reduce((s,a,ai)=>s+(ticked[`${si}-${sti}-${ai}`]?parseMark(a.mark)||0:0),0);
                  const stTicked = stActs.filter((_,ai)=>ticked[`${si}-${sti}-${ai}`]).length;
                  let lastGroup = null;
                  return (
                    <div key={sti} style={{marginBottom:18}}>
                      {/* Sub-topic title — no tick */}
                      {st.title&&(
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                          background:"var(--accent)",borderRadius:8,padding:"8px 14px",marginBottom:10}}>
                          <div style={{fontWeight:800,fontSize:13,color:"#fff"}}>{st.title}</div>
                          <div style={{fontSize:11,color:"rgba(255,255,255,.85)",fontWeight:700,
                            whiteSpace:"nowrap",marginLeft:8}}>
                            {fmtMark(stEarned)}/{fmtMark(stMax)} marks • {stTicked}/{stActs.length} steps
                          </div>
                        </div>
                      )}
                      {/* Activities */}
                      {stActs.map((act,ai)=>{
                        const k=`${si}-${sti}-${ai}`;
                        const done=!!ticked[k];
                        const showGroup = act.group && act.group!==lastGroup;
                        if (showGroup) lastGroup=act.group;
                        return (
                          <React.Fragment key={ai}>
                            {/* Group label — no tick box */}
                            {showGroup&&(
                              <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",
                                textTransform:"uppercase",letterSpacing:.8,
                                padding:"6px 4px 4px",marginTop:ai>0?8:0,
                                borderBottom:"1px solid var(--border)",marginBottom:4}}>
                                {act.group}
                              </div>
                            )}
                            {/* Numbered step — HAS tick box */}
                            <div onClick={()=>toggle(si,sti,ai)}
                              style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 10px",
                                borderRadius:8,cursor:"pointer",marginBottom:3,transition:"all .15s",
                                background:done?"rgba(62,142,149,.08)":"transparent",
                                border:`1px solid ${done?"rgba(62,142,149,.3)":"transparent"}`}}>
                              <div style={{width:22,height:22,borderRadius:6,flexShrink:0,marginTop:1,
                                border:`2px solid ${done?"var(--accent)":"var(--border2)"}`,
                                background:done?"var(--accent)":"transparent",
                                display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
                                {done&&<span style={{color:"#fff",fontSize:11,fontWeight:900}}>✓</span>}
                              </div>
                              <div style={{flex:1,lineHeight:1.5}}>
                                <span style={{fontSize:13,fontWeight:done?700:400,
                                  color:done?"var(--text)":"var(--text2)"}}>
                                  <span style={{color:"var(--accent)",fontWeight:800}}>{act.num}.</span> {act.text}
                                </span>
                              </div>
                              {act.mark&&(
                                <div style={{flexShrink:0,fontSize:11,fontWeight:800,whiteSpace:"nowrap",
                                  color:done?"var(--accent)":"var(--text3)",
                                  background:done?"rgba(62,142,149,.15)":"var(--bg4)",
                                  border:`1px solid ${done?"rgba(62,142,149,.4)":"var(--border)"}`,
                                  borderRadius:5,padding:"2px 7px",transition:"all .2s"}}>
                                  {act.mark}
                                </div>
                              )}
                            </div>
                          </React.Fragment>
                        );
                      })}
                      {/* Sub-topic total */}
                      {st.totalMarks&&(
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                          marginTop:8,padding:"6px 10px",background:"var(--bg4)",borderRadius:7,
                          fontSize:12,fontWeight:700,color:"var(--text3)",borderLeft:"3px solid var(--accent)"}}>
                          <span>📊 {st.totalMarks}</span>
                          <span style={{color:stEarned>=stMax&&stMax>0?"var(--success)":"var(--accent)"}}>
                            {fmtMark(stEarned)}/{fmtMark(stMax)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }) : (
                  /* Legacy flat activities */
                  <div>
                    {(s.activities||[]).map((act,ai)=>{
                      const k=`${si}-0-${ai}`; const kL=`${si}-${ai}`;
                      const done=!!(ticked[k]||ticked[kL]);
                      return (
                        <div key={ai} onClick={()=>toggle(si,0,ai)}
                          style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 10px",
                            borderRadius:8,cursor:"pointer",marginBottom:3,transition:"all .15s",
                            background:done?"rgba(62,142,149,.08)":"transparent",
                            border:`1px solid ${done?"rgba(62,142,149,.3)":"transparent"}`}}>
                          <div style={{width:22,height:22,borderRadius:6,flexShrink:0,marginTop:1,
                            border:`2px solid ${done?"var(--accent)":"var(--border2)"}`,
                            background:done?"var(--accent)":"transparent",
                            display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
                            {done&&<span style={{color:"#fff",fontSize:11,fontWeight:900}}>✓</span>}
                          </div>
                          <div style={{flex:1,lineHeight:1.5}}>
                            <span style={{fontSize:13,fontWeight:done?700:400,color:done?"var(--text)":"var(--text2)"}}>
                              <span style={{color:"var(--accent)",fontWeight:800}}>{act.num}.</span> {act.text}
                            </span>
                          </div>
                          {act.mark&&(
                            <div style={{flexShrink:0,fontSize:11,fontWeight:800,whiteSpace:"nowrap",
                              color:done?"var(--accent)":"var(--text3)",
                              background:done?"rgba(62,142,149,.15)":"var(--bg4)",
                              border:`1px solid ${done?"rgba(62,142,149,.4)":"var(--border)"}`,
                              borderRadius:5,padding:"2px 7px",transition:"all .2s"}}>
                              {act.mark}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {s.totalMarks&&(
                      <div style={{marginTop:8,padding:"6px 10px",background:"var(--bg4)",borderRadius:7,
                        fontSize:12,fontWeight:700,color:"var(--text3)",borderLeft:"3px solid var(--accent)"}}>
                        📊 {s.totalMarks}
                      </div>
                    )}
                  </div>
                )}

                {/* Embedded question station */}
                {(s.questionStation||[]).length>0&&
                  renderQuestionStation(s.questionStation, si, "Question Station")}

                {/* Reset */}
                <div style={{marginTop:10,display:"flex",justifyContent:"flex-end"}}>
                  <button className="btn btn-sm" style={{fontSize:11,color:"var(--text3)"}}
                    onClick={e=>{e.stopPropagation();resetStation(si,s);}}>
                    🔄 Reset ticks
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function GPACalc({ toast }) {
  const [gpaTab, setGpaTab] = useState("course");
  const [courses, setCourses] = useState(()=>ls("nv-gpa-courses",[]));
  const [form, setForm] = useState({name:"",units:"",grade:""});
  const GRADES=[{l:"A",p:"5.0"},{l:"B",p:"4.0"},{l:"C",p:"3.0"},{l:"D",p:"2.0"},{l:"E",p:"1.0"},{l:"F",p:"0.0"}];
  const [gpaSel, setGpaSel] = useState(new Set());
  const add=()=>{if(!form.name||!form.units||!form.grade)return toast("Fill all fields","error");const u=[...courses,{...form,id:Date.now(),units:+form.units,grade:+form.grade}];setCourses(u);saveMyData("gpa-courses","nv-gpa-courses",u);setForm({name:"",units:"",grade:""});};
  const gpaDelOne=(id)=>{const u=courses.filter(x=>x.id!==id);setCourses(u);saveMyData("gpa-courses","nv-gpa-courses",u);setGpaSel(s=>{const n=new Set(s);n.delete(id);return n;});};
  const gpaDelSel=()=>{if(!gpaSel.size)return;const u=courses.filter(c=>!gpaSel.has(c.id));setCourses(u);saveMyData("gpa-courses","nv-gpa-courses",u);setGpaSel(new Set());};

  // Semester CGPA state
  const [semesters, setSemesters] = useState(()=>ls("nv-gpa-semesters",[]));
  const [semForm, setSemForm] = useState({label:"",gpa:"",units:""});
  const addSem = () => {
    if (!semForm.label||!semForm.gpa||!semForm.units) return toast("Fill all semester fields","error");
    if (+semForm.gpa<0||+semForm.gpa>5) return toast("GPA must be 0–5","error");
    const u = [...semesters, {...semForm, id:Date.now(), gpa:+semForm.gpa, units:+semForm.units}];
    setSemesters(u); saveMyData("gpa-semesters","nv-gpa-semesters",u); setSemForm({label:"",gpa:"",units:""});
  };
  const delSem = (id) => { const u=semesters.filter(s=>s.id!==id); setSemesters(u); saveMyData("gpa-semesters","nv-gpa-semesters",u); };
  const totalSemUnits = semesters.reduce((s,x)=>s+x.units,0);
  const cgpa = totalSemUnits>0 ? (semesters.reduce((s,x)=>s+(x.gpa*x.units),0)/totalSemUnits) : 0;
  const cgpaCls = cgpa>=4.5?"First Class":cgpa>=3.5?"Second Class Upper":cgpa>=2.5?"Second Class Lower":cgpa>=1.5?"Third Class":"Fail";
  const cgpaColor = cgpa>=4.5?"var(--accent)":cgpa>=3.5?"var(--accent2)":cgpa>=2.5?"var(--warn)":"var(--danger)";
  const gpaAll=courses.length>0&&courses.every(c=>gpaSel.has(c.id));
  const tp=courses.reduce((s,c)=>s+c.units*c.grade,0),tu=courses.reduce((s,c)=>s+c.units,0),gpa=tu>0?tp/tu:0;
  const cls=gpa>=4.5?"First Class":gpa>=3.5?"Second Class Upper":gpa>=2.5?"Second Class Lower":gpa>=1.5?"Third Class":"Fail";
  const clsColor=gpa>=4.5?"var(--accent)":gpa>=3.5?"var(--accent2)":gpa>=2.5?"var(--warn)":"var(--danger)";
  return (
  <div>
    <div className="sec-title">🎓 GPA Calculator</div>
    <div className="sec-sub">5.0 scale</div>
    {/* Tab toggle */}
    <div style={{display:"flex",gap:8,marginBottom:18}}>
      {[{key:"course",label:"📚 Course GPA"},{key:"semester",label:"📅 Semester CGPA"}].map(t=>(
        <button key={t.key} onClick={()=>setGpaTab(t.key)}
          style={{padding:"8px 18px",borderRadius:20,border:"1.5px solid",fontSize:13,fontWeight:700,cursor:"pointer",transition:"all .2s",
            borderColor:gpaTab===t.key?"var(--accent)":"var(--border2)",
            background:gpaTab===t.key?"var(--accent)":"var(--bg4)",
            color:gpaTab===t.key?"white":"var(--text2)"}}>
          {t.label}
        </button>
      ))}
    </div>

    {gpaTab==="course"&&<>
      {courses.length>0&&<div className="card" style={{marginBottom:18,textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)",marginBottom:6,textTransform:"uppercase",letterSpacing:"1px"}}>Your GPA</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:56,fontWeight:800,color:"var(--accent)"}}>{gpa.toFixed(2)}</div><div style={{fontSize:16,color:clsColor,fontWeight:600,marginBottom:8}}>{cls}</div><div className="gpa-bar-wrap"><div className="gpa-bar" style={{width:`${(gpa/5)*100}%`}} /></div></div>}
      <div className="card" style={{marginBottom:14}}><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>Add Course</div><div className="grid3" style={{gap:10,alignItems:"end"}}><div><label className="lbl">Course</label><input className="inp" style={{marginBottom:0}} placeholder="Pharmacology" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div><div><label className="lbl">Units</label><input className="inp" style={{marginBottom:0}} type="number" min="1" max="6" value={form.units} onChange={e=>setForm({...form,units:e.target.value})} /></div><div><label className="lbl">Grade</label><select className="inp" style={{marginBottom:0}} value={form.grade} onChange={e=>setForm({...form,grade:e.target.value})}><option value="">Select...</option>{GRADES.map(g=><option key={g.l} value={g.p}>{g.l} ({g.p})</option>)}</select></div></div><button className="btn btn-accent" style={{marginTop:10}} onClick={add}>Add</button></div>
      {courses.length>0&&(
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"10px 0 6px"}}>
          <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"var(--text3)",cursor:"pointer"}}><input type="checkbox" className="cb-all" checked={gpaAll} onChange={()=>{if(gpaAll){setGpaSel(new Set());}else{setGpaSel(new Set(courses.map(c=>c.id)));}}} />Select All</label>
          <button className="btn btn-sm btn-danger" onClick={()=>{setCourses([]);saveMyData("gpa-courses","nv-gpa-courses",[]);setGpaSel(new Set());}}>🗑️ Clear All</button>
        </div>
      )}
      {gpaSel.size>0&&(
        <div className="bulk-bar">
          <span className="bulk-bar-count">☑ {gpaSel.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={gpaDelSel}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={()=>setGpaSel(new Set())}>✕ Clear</button>
        </div>
      )}
      {courses.map((c,i)=>(
        <div key={c.id} className="course-row" style={{outline:gpaSel.has(c.id)?"2px solid var(--danger)":"none"}}>
          <input type="checkbox" className="cb-row" checked={gpaSel.has(c.id)} onChange={()=>setGpaSel(s=>{const n=new Set(s);n.has(c.id)?n.delete(c.id):n.add(c.id);return n;})} />
          <div style={{flex:1}}>
            <div style={{fontWeight:600,fontSize:13}}>{c.name}</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>{c.units} unit{c.units>1?"s":""}</div>
          </div>
          <div style={{width:36,height:36,borderRadius:9,background:"rgba(62,142,149,.1)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"var(--accent)"}}>{GRADES.find(g=>+g.p===c.grade)?.l}</div>
          <button className="btn btn-sm btn-danger" onClick={()=>gpaDelOne(c.id)}>✕</button>
        </div>
      ))}
    </>}
    {gpaTab==="semester"&&<>
      {semesters.length>0&&(
        <div className="card" style={{marginBottom:18,textAlign:"center"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)",marginBottom:6,textTransform:"uppercase",letterSpacing:"1px"}}>Cumulative GPA (CGPA)</div>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:56,fontWeight:800,color:cgpaColor}}>{cgpa.toFixed(2)}</div>
          <div style={{fontSize:16,color:cgpaColor,fontWeight:600,marginBottom:8}}>{cgpaCls}</div>
          <div className="gpa-bar-wrap"><div className="gpa-bar" style={{width:`${(cgpa/5)*100}%`,background:cgpaColor}} /></div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:6}}>{semesters.length} semester{semesters.length!==1?"s":""} • {totalSemUnits} total units</div>
        </div>
      )}
      <div className="card" style={{marginBottom:14}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>Add Semester</div>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,alignItems:"end"}}>
          <div><label className="lbl">Semester Label</label><input className="inp" style={{marginBottom:0}} placeholder="100L First Sem" value={semForm.label} onChange={e=>setSemForm({...semForm,label:e.target.value})} /></div>
          <div><label className="lbl">Semester GPA</label><input className="inp" style={{marginBottom:0}} type="number" min="0" max="5" step="0.01" placeholder="4.20" value={semForm.gpa} onChange={e=>setSemForm({...semForm,gpa:e.target.value})} /></div>
          <div><label className="lbl">Total Units</label><input className="inp" style={{marginBottom:0}} type="number" min="1" placeholder="18" value={semForm.units} onChange={e=>setSemForm({...semForm,units:e.target.value})} /></div>
        </div>
        <button className="btn btn-accent" style={{marginTop:10}} onClick={addSem}>Add Semester</button>
        <div style={{fontSize:11,color:"var(--text3)",marginTop:8}}>Enter each semester's GPA and credit units. CGPA is weighted across all semesters.</div>
      </div>
      {semesters.length===0&&(
        <div style={{textAlign:"center",padding:24,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:12}}>No semesters added yet.</div>
      )}
      {semesters.map((s,i)=>(
        <div key={s.id} className="course-row">
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:13}}>{s.label}</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>{s.units} units • GPA: <b style={{color:"var(--accent)"}}>{s.gpa.toFixed(2)}</b></div>
          </div>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20,color:"var(--accent)",minWidth:50,textAlign:"center"}}>{s.gpa.toFixed(2)}</div>
          <button className="btn btn-sm btn-danger" onClick={()=>delSem(s.id)}>✕</button>
        </div>
      ))}
      {semesters.length>0&&(
        <button className="btn btn-sm btn-danger" style={{marginTop:10}} onClick={()=>{setSemesters([]);saveMyData("gpa-semesters","nv-gpa-semesters",[]);}}>🗑️ Clear All</button>
      )}
    </>}
  </div>
  );
}

export function MedCalc() {
  const [calcTab, setCalcTab] = useState("dose");
  // Dose calculator
  const [dose,setDose]=useState("");const [weight,setWeight]=useState("");const [avail,setAvail]=useState("");const [vol,setVol]=useState("");
  const result=dose&&weight?(+dose*+weight).toFixed(2):null;
  const volume=result&&avail&&vol?((+result/+avail)*+vol).toFixed(2):null;
  // BMI
  const [bmi,setBmi]=useState({h:"",w:""});
  const bmiVal=bmi.h&&bmi.w?(+bmi.w/(+bmi.h/100)**2).toFixed(1):null;
  const bmiCls=bmiVal?+bmiVal<18.5?"Underweight":+bmiVal<25?"Normal":+bmiVal<30?"Overweight":"Obese":null;
  // IV Infusion
  const [iv,setIv]=useState({vol:"",time:"",drop:""});
  const ivDPM = iv.vol&&iv.time&&iv.drop ? ((+iv.vol * +iv.drop) / (+iv.time * 60)).toFixed(1) : null;
  const ivMLHR = iv.vol&&iv.time ? (+iv.vol / +iv.time).toFixed(1) : null;
  // Fluid intake/output balance
  const [fluid,setFluid]=useState({intake:"",urine:"",other:""});
  const fluidBal = fluid.intake ? (+fluid.intake - (+fluid.urine||0) - (+fluid.other||0)).toFixed(0) : null;
  // Creatinine Clearance (Cockcroft-Gault)
  const [cr,setCr]=useState({age:"",wt:"",scr:"",sex:"M"});
  const crCl = cr.age&&cr.wt&&cr.scr ? ((((140 - +cr.age) * +cr.wt) / (72 * +cr.scr)) * (cr.sex==="F"?0.85:1)).toFixed(1) : null;
  // Ideal Body Weight
  const [ibw,setIbw]=useState({ht:"",sex:"M"});
  const ibwVal = ibw.ht ? (ibw.sex==="M" ? 50 + 2.3*((+ibw.ht/2.54)-60) : 45.5 + 2.3*((+ibw.ht/2.54)-60)).toFixed(1) : null;
  // MAP
  const [bp,setBp]=useState({sys:"",dia:""});
  const mapVal = bp.sys&&bp.dia ? ((+bp.dia + (1/3)*(+bp.sys - +bp.dia))).toFixed(0) : null;
  // Paediatric dose (Young's rule / weight-based)
  const [ped,setPed]=useState({adultDose:"",wt:""});
  const pedDose = ped.adultDose&&ped.wt ? (+ped.adultDose * (+ped.wt/(+ped.wt+12))).toFixed(2) : null;

  const TABS = [
    {key:"dose",  icon:"💊", label:"Dose Calc"},
    {key:"iv",    icon:"💉", label:"IV Infusion"},
    {key:"bmi",   icon:"⚖️", label:"BMI"},
    {key:"fluid", icon:"🧴", label:"Fluid Balance"},
    {key:"cr",    icon:"🫘", label:"CrCl"},
    {key:"ibw",   icon:"🧍", label:"Ideal Body Wt"},
    {key:"map",   icon:"❤️", label:"MAP"},
    {key:"ped",   icon:"🧒", label:"Paed Dose"},
  ];

  return (
    <div>
      <div className="sec-title">🧮 Med Calculator</div>
      <div className="sec-sub">Clinical drug & patient calculators</div>
      {/* Toggle tabs */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:18}}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setCalcTab(t.key)}
            style={{padding:"7px 13px",borderRadius:20,border:"1.5px solid",fontSize:12,fontWeight:700,cursor:"pointer",transition:"all .2s",
              borderColor:calcTab===t.key?"var(--accent)":"var(--border2)",
              background:calcTab===t.key?"var(--accent)":"var(--bg4)",
              color:calcTab===t.key?"white":"var(--text2)"}}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {calcTab==="dose"&&(
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>💊 Drug Dose Calculator</div>
          <label className="lbl">Dose (mg/kg)</label><input className="inp" type="number" placeholder="10" value={dose} onChange={e=>setDose(e.target.value)} />
          <label className="lbl">Patient Weight (kg)</label><input className="inp" type="number" placeholder="70" value={weight} onChange={e=>setWeight(e.target.value)} />
          {result&&<div className="card2" style={{textAlign:"center",marginBottom:12}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>REQUIRED DOSE</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:32,fontWeight:800,color:"var(--accent)"}}>{result} mg</div></div>}
          <div style={{borderTop:"1px solid var(--border)",paddingTop:12,marginTop:4}}>
            <div style={{fontWeight:700,fontSize:12,marginBottom:8,color:"var(--text3)"}}>Volume to administer</div>
            <label className="lbl">Drug on Hand (mg)</label><input className="inp" type="number" value={avail} onChange={e=>setAvail(e.target.value)} />
            <label className="lbl">Volume on Hand (mL)</label><input className="inp" type="number" value={vol} onChange={e=>setVol(e.target.value)} />
            {volume&&<div className="card2" style={{textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>GIVE</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:32,fontWeight:800,color:"var(--accent2)"}}>{volume} mL</div></div>}
          </div>
        </div>
      )}

      {calcTab==="iv"&&(
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>💉 IV Infusion Rate Calculator</div>
          <label className="lbl">Total Volume to Infuse (mL)</label><input className="inp" type="number" placeholder="500" value={iv.vol} onChange={e=>setIv({...iv,vol:e.target.value})} />
          <label className="lbl">Time to Infuse (hours)</label><input className="inp" type="number" placeholder="8" value={iv.time} onChange={e=>setIv({...iv,time:e.target.value})} />
          <label className="lbl">Drop Factor (drops/mL)</label>
          <select className="inp" value={iv.drop} onChange={e=>setIv({...iv,drop:e.target.value})}>
            <option value="">Select drop factor…</option>
            <option value="10">Macro-drip 10 gtt/mL</option>
            <option value="15">Macro-drip 15 gtt/mL</option>
            <option value="20">Macro-drip 20 gtt/mL</option>
            <option value="60">Micro-drip 60 gtt/mL</option>
          </select>
          {(ivDPM||ivMLHR)&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:4}}>
              {ivDPM&&<div className="card2" style={{textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>DRIP RATE</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:28,fontWeight:800,color:"var(--accent)"}}>{ivDPM} <span style={{fontSize:14}}>gtt/min</span></div></div>}
              {ivMLHR&&<div className="card2" style={{textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>FLOW RATE</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:28,fontWeight:800,color:"var(--accent2)"}}>{ivMLHR} <span style={{fontSize:14}}>mL/hr</span></div></div>}
            </div>
          )}
          <div style={{marginTop:14,padding:"10px 14px",background:"var(--bg4)",borderRadius:10,fontSize:12,color:"var(--text3)"}}>
            <b>Formula:</b> Drip rate = (Volume × Drop factor) ÷ (Time in hours × 60)
          </div>
        </div>
      )}

      {calcTab==="bmi"&&(
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>⚖️ BMI Calculator</div>
          <label className="lbl">Height (cm)</label><input className="inp" type="number" value={bmi.h} onChange={e=>setBmi({...bmi,h:e.target.value})} />
          <label className="lbl">Weight (kg)</label><input className="inp" type="number" value={bmi.w} onChange={e=>setBmi({...bmi,w:e.target.value})} />
          {bmiVal&&<div className="card2" style={{textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>BMI</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:48,fontWeight:800,color:"var(--accent)"}}>{bmiVal}</div><div style={{color:+bmiVal<18.5?"var(--warn)":+bmiVal<25?"var(--success)":+bmiVal<30?"var(--warn)":"var(--danger)",fontWeight:600,fontSize:16}}>{bmiCls}</div></div>}
          <div style={{marginTop:12,padding:"10px 14px",background:"var(--bg4)",borderRadius:10,fontSize:12,color:"var(--text3)"}}>
            &lt;18.5 Underweight • 18.5–24.9 Normal • 25–29.9 Overweight • ≥30 Obese
          </div>
        </div>
      )}

      {calcTab==="fluid"&&(
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>🧴 Fluid Balance Calculator</div>
          <label className="lbl">Total Intake (mL)</label><input className="inp" type="number" placeholder="2000" value={fluid.intake} onChange={e=>setFluid({...fluid,intake:e.target.value})} />
          <label className="lbl">Urine Output (mL)</label><input className="inp" type="number" placeholder="800" value={fluid.urine} onChange={e=>setFluid({...fluid,urine:e.target.value})} />
          <label className="lbl">Other Losses — sweat, wound, vomit (mL)</label><input className="inp" type="number" placeholder="200" value={fluid.other} onChange={e=>setFluid({...fluid,other:e.target.value})} />
          {fluidBal!==null&&fluid.intake&&(
            <div className="card2" style={{textAlign:"center"}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>FLUID BALANCE</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:36,fontWeight:800,color:+fluidBal>=0?"var(--success)":"var(--danger)"}}>{+fluidBal>=0?"+":""}{fluidBal} mL</div>
              <div style={{fontSize:13,fontWeight:600,color:+fluidBal>=0?"var(--success)":"var(--danger)"}}>{+fluidBal>=0?"Positive balance (fluid retained)":"Negative balance (net fluid loss)"}</div>
            </div>
          )}
        </div>
      )}

      {calcTab==="cr"&&(
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>🫘 Creatinine Clearance (Cockcroft-Gault)</div>
          <label className="lbl">Age (years)</label><input className="inp" type="number" placeholder="40" value={cr.age} onChange={e=>setCr({...cr,age:e.target.value})} />
          <label className="lbl">Weight (kg)</label><input className="inp" type="number" placeholder="70" value={cr.wt} onChange={e=>setCr({...cr,wt:e.target.value})} />
          <label className="lbl">Serum Creatinine (mg/dL)</label><input className="inp" type="number" placeholder="1.0" value={cr.scr} onChange={e=>setCr({...cr,scr:e.target.value})} />
          <label className="lbl">Sex</label>
          <select className="inp" value={cr.sex} onChange={e=>setCr({...cr,sex:e.target.value})}>
            <option value="M">Male</option><option value="F">Female</option>
          </select>
          {crCl&&<div className="card2" style={{textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>CrCl</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:36,fontWeight:800,color:"var(--accent)"}}>{crCl} <span style={{fontSize:14}}>mL/min</span></div><div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>{+crCl>=90?"Normal":+crCl>=60?"Mild CKD (G2)":+crCl>=30?"Moderate CKD (G3)":+crCl>=15?"Severe CKD (G4)":"Kidney Failure (G5)"}</div></div>}
          <div style={{marginTop:12,padding:"10px 14px",background:"var(--bg4)",borderRadius:10,fontSize:12,color:"var(--text3)"}}>
            <b>Formula:</b> CrCl = ((140 − age) × weight) ÷ (72 × SCr) × 0.85 (if female)
          </div>
        </div>
      )}

      {calcTab==="ibw"&&(
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>🧍 Ideal Body Weight (Devine Formula)</div>
          <label className="lbl">Height (cm)</label><input className="inp" type="number" placeholder="170" value={ibw.ht} onChange={e=>setIbw({...ibw,ht:e.target.value})} />
          <label className="lbl">Sex</label>
          <select className="inp" value={ibw.sex} onChange={e=>setIbw({...ibw,sex:e.target.value})}>
            <option value="M">Male</option><option value="F">Female</option>
          </select>
          {ibwVal&&<div className="card2" style={{textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>IDEAL BODY WEIGHT</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:40,fontWeight:800,color:"var(--accent)"}}>{ibwVal} <span style={{fontSize:16}}>kg</span></div></div>}
          <div style={{marginTop:12,padding:"10px 14px",background:"var(--bg4)",borderRadius:10,fontSize:12,color:"var(--text3)"}}>
            <b>Male:</b> 50 + 2.3 × (height in inches − 60) • <b>Female:</b> 45.5 + 2.3 × (height in inches − 60)
          </div>
        </div>
      )}

      {calcTab==="map"&&(
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>❤️ Mean Arterial Pressure (MAP)</div>
          <label className="lbl">Systolic BP (mmHg)</label><input className="inp" type="number" placeholder="120" value={bp.sys} onChange={e=>setBp({...bp,sys:e.target.value})} />
          <label className="lbl">Diastolic BP (mmHg)</label><input className="inp" type="number" placeholder="80" value={bp.dia} onChange={e=>setBp({...bp,dia:e.target.value})} />
          {mapVal&&<div className="card2" style={{textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>MAP</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:40,fontWeight:800,color:+mapVal<60?"var(--danger)":+mapVal<70?"var(--warn)":"var(--success)"}}>{mapVal} <span style={{fontSize:16}}>mmHg</span></div><div style={{fontSize:12,fontWeight:700,color:+mapVal<60?"var(--danger)":+mapVal<70?"var(--warn)":"var(--success)",marginTop:4}}>{+mapVal<60?"⚠️ Inadequate organ perfusion":+mapVal<70?"Borderline":"✅ Adequate perfusion"}</div></div>}
          <div style={{marginTop:12,padding:"10px 14px",background:"var(--bg4)",borderRadius:10,fontSize:12,color:"var(--text3)"}}>
            <b>Formula:</b> MAP = DBP + ⅓(SBP − DBP) • Normal range: 70–100 mmHg
          </div>
        </div>
      )}

      {calcTab==="ped"&&(
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>🧒 Paediatric Dose (Young's Rule)</div>
          <label className="lbl">Adult Dose (mg)</label><input className="inp" type="number" placeholder="500" value={ped.adultDose} onChange={e=>setPed({...ped,adultDose:e.target.value})} />
          <label className="lbl">Child's Age (years)</label><input className="inp" type="number" placeholder="5" value={ped.wt} onChange={e=>setPed({...ped,wt:e.target.value})} />
          {pedDose&&<div className="card2" style={{textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>CHILD DOSE</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:36,fontWeight:800,color:"var(--accent)"}}>{pedDose} <span style={{fontSize:16}}>mg</span></div></div>}
          <div style={{marginTop:12,padding:"10px 14px",background:"var(--bg4)",borderRadius:10,fontSize:12,color:"var(--text3)"}}>
            <b>Young's Rule:</b> Child dose = Adult dose × age ÷ (age + 12)
          </div>
        </div>
      )}
    </div>
  );
}
