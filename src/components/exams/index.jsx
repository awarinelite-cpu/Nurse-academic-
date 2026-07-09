import { useState, useEffect, useCallback, useRef } from "react";
import { DEFAULT_CLASSES } from "../../data/defaults";
import { cbtDevicesGet, cbtDevicesSave, cbtExamsSave, cbtResultsSave, cbtViolationsGet, cbtViolationsSave, saveEssaySubmissionToBackend, saveMyData, saveShared, subscribeCbtExams, subscribeCbtResults, subscribeCbtViolations, useSharedData } from "../../services/backend";
import { ls } from "../../utils/storage";
import { Notifications } from "../../components/messaging";
import { NcPaywall } from "../../components/nursing-council";
import { Results } from "../../components/student";
import { useNcAccess } from "../../hooks/useNcAccess";
import { parseCbtQuestions } from "../../shared/cbtHelpers";
import { getDeviceFingerprint } from "../../shared/deviceFingerprint";
import { NC_FREE_LIMIT, NC_MOCK_FREE_LIMIT } from "../../shared/ncExamData";
import { getDailyMockQuestions } from "../../utils/examParsing";

export function MCQExamView({ toast, currentUser, banks, onBack, backLabel }) {
  const attKey = `nv-exam-attempts-${currentUser}`;
  const [sel, setSel] = useState(null);
  const [active, setActive] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [qIdx, setQIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [finalAnswers, setFinalAnswers] = useState([]);

  const startExam = (bank) => {
    const att = ls(attKey, {});
    if (att[String(bank.id)]) { toast("You have already used your 1 attempt for this exam.", "error"); return; }
    setSel(bank);
    setAnswers(new Array(bank.questions.length).fill(null));
    setQIdx(0); setActive(true); setDone(false); setFinalAnswers([]);
  };

  const selectOption = (optIdx) => {
    setAnswers(prev => { const n=[...prev]; n[qIdx]=optIdx; return n; });
  };

  const submitExam = () => {
    const unanswered = answers.filter(a=>a===null).length;
    if (unanswered > 0 && !window.confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) return;
    const snap = [...answers];
    const score = sel.questions.reduce((s,q,i) => snap[i]===q.ans ? s+1 : s, 0);
    const pct = Math.round((score / sel.questions.length) * 100);
    const att = ls(attKey, {});
    att[String(sel.id)] = { score, total: sel.questions.length, pct, answers: snap, date: new Date().toLocaleDateString() };
    saveMyData("mcq-att",attKey,att);
    const results = ls("nv-results", []);
    saveMyData("results","nv-results",[...results, { id:Date.now(), subject:sel.subject, type:"MCQ Exam", score, total:sel.questions.length, pct, date:new Date().toLocaleDateString() }]);
    setFinalAnswers(snap);
    setActive(false); setDone(true);
  };

  // Results + answer review
  if (done && sel) {
    const score = sel.questions.reduce((s,q,i)=>finalAnswers[i]===q.ans?s+1:s, 0);
    const pct = Math.round((score / sel.questions.length) * 100);
    return (
      <div style={{maxWidth:600,margin:"0 auto"}}>
        <div style={{textAlign:"center",padding:"28px 0 20px"}}>
          <div style={{fontSize:56,marginBottom:10}}>{pct>=70?"🎉":pct>=50?"👍":"📚"}</div>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22,marginBottom:6}}>Exam Submitted</div>
          <div style={{fontSize:52,fontFamily:"'Syne',sans-serif",fontWeight:800,color:pct>=70?"var(--success)":pct>=50?"var(--warn)":"var(--danger)",lineHeight:1}}>{score}/{sel.questions.length}</div>
          <div style={{fontSize:20,color:"var(--text2)",marginTop:4,marginBottom:4}}>{pct}%</div>
          <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>🔒 1 attempt used — contact lecturer to reset</div>
        </div>
        <div style={{marginTop:12}}>
          {sel.questions.map((q,i)=>{
            const chosen=finalAnswers[i]; const correct=chosen===q.ans;
            return (
              <div key={i} className="card" style={{marginBottom:10,borderLeft:`3px solid ${chosen===null?"var(--border2)":correct?"var(--success)":"var(--danger)"}`}}>
                <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>Q{i+1}. {q.q}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {q.options.map((opt,oi)=>(
                    <span key={oi} style={{fontSize:11,padding:"3px 9px",borderRadius:6,
                      background:oi===q.ans?"rgba(74,222,128,.15)":oi===chosen&&!correct?"rgba(248,113,113,.12)":"transparent",
                      border:`1px solid ${oi===q.ans?"var(--success)":oi===chosen&&!correct?"var(--danger)":"var(--border)"}`,
                      color:oi===q.ans?"var(--success)":oi===chosen&&!correct?"var(--danger)":"var(--text3)"
                    }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}{oi===chosen&&chosen!==q.ans?" ✗":""}</span>
                  ))}
                </div>
                {chosen===null&&<div style={{fontSize:11,color:"var(--text3)",marginTop:5,fontFamily:"'DM Mono',monospace"}}>— Not answered</div>}
              </div>
            );
          })}
        </div>
        <div style={{textAlign:"center",marginTop:16}}>
          <button className="btn" onClick={()=>{setSel(null);setDone(false);if(onBack)onBack();}}>← Back to Exams</button>
        </div>
      </div>
    );
  }

  // Active exam
  if (active && sel) {
    const q = sel.questions[qIdx];
    const answeredCount = answers.filter(a=>a!==null).length;
    return (
      <div style={{maxWidth:580,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:14}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15}}>{sel.subject}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>{answeredCount}/{sel.questions.length} answered • click any number to jump</div>
          </div>
          <button className="btn btn-accent btn-sm" onClick={submitExam}>Submit ✓</button>
        </div>

        {/* Question number grid — click to jump back or forward */}
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
          {sel.questions.map((_,i)=>(
            <div key={i} onClick={()=>setQIdx(i)} style={{
              width:30,height:30,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",
              cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace",fontWeight:700,transition:"all .15s",
              background:i===qIdx?"var(--accent)":answers[i]!==null?"rgba(74,222,128,.12)":"var(--bg4)",
              border:`2px solid ${i===qIdx?"var(--accent)":answers[i]!==null?"var(--success)":"var(--border)"}`,
              color:i===qIdx?"white":answers[i]!==null?"var(--success)":"var(--text3)"
            }}>{i+1}</div>
          ))}
        </div>

        <div className="progress-wrap" style={{marginBottom:16}}>
          <div className="progress-fill" style={{width:`${(answeredCount/sel.questions.length)*100}%`,background:"var(--accent)"}} />
        </div>

        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)",marginBottom:6}}>Question {qIdx+1} of {sel.questions.length}</div>
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:600,lineHeight:1.5}}>{q.q}</div>
        </div>

        {/* Options — freely changeable until submit */}
        {q.options.map((opt,i)=>(
          <div key={i} onClick={()=>selectOption(i)} className="quiz-opt"
            style={{
              borderColor:answers[qIdx]===i?"var(--accent)":"var(--border)",
              background:answers[qIdx]===i?"rgba(62,142,149,.15)":"transparent",
              cursor:"pointer",display:"flex",alignItems:"center",gap:8,marginBottom:7
            }}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,opacity:.6,flexShrink:0}}>{"ABCD"[i]}.</span>
            <span style={{flex:1}}>{opt}</span>
            {answers[qIdx]===i&&<span style={{color:"var(--accent)",fontSize:16,fontWeight:700,flexShrink:0}}>✓</span>}
          </div>
        ))}

        <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"space-between"}}>
          <button className="btn btn-sm" disabled={qIdx===0} onClick={()=>setQIdx(q=>q-1)}>← Prev</button>
          {qIdx < sel.questions.length-1
            ? <button className="btn btn-accent btn-sm" onClick={()=>setQIdx(q=>q+1)}>Next →</button>
            : <button className="btn btn-accent btn-sm" onClick={submitExam}>Submit Exam ✓</button>
          }
        </div>
      </div>
    );
  }

  // Bank list
  return (
    <div>
      {onBack && <button className="btn btn-sm" style={{marginBottom:14}} onClick={onBack}>{backLabel||"← Back"}</button>}
      <div className="grid2">
      {banks.map((b,i)=>{
        const att = ls(attKey,{})[String(b.id)];
        return (
          <div key={b.id} className="card" style={{animation:`fadeUp .4s ease ${i*.08}s both`}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,marginBottom:4}}>{b.subject}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>{b.year} • {b.questions.length} questions</div>
            {att ? (
              <div>
                <div style={{fontSize:13,marginBottom:4}}>Score: <span style={{fontWeight:700,color:att.pct>=70?"var(--success)":att.pct>=50?"var(--warn)":"var(--danger)"}}>{att.score}/{att.total} ({att.pct}%)</span></div>
                <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>🔒 Attempted {att.date}</div>
              </div>
            ) : (
              <button className="btn btn-accent btn-sm" onClick={()=>startExam(b)}>Start Exam ▶</button>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ─── Essay Exam View ───────────────────────────────────────────────────

export function EssayExamView({ toast, currentUser, essayBanks }) {
  const attKey = `nv-essay-att-${currentUser}`;
  const [sel, setSel] = useState(null);
  const [active, setActive] = useState(false);
  const [answers, setAnswers] = useState({});
  const [done, setDone] = useState(false);
  const [grading, setGrading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [savedAnswers, setSavedAnswers] = useState({});

  const startExam = (bank) => {
    const att = ls(attKey, {});
    if (att[String(bank.id)]) { toast("You have already used your 1 attempt for this essay.", "error"); return; }
    setSel(bank); setAnswers({}); setActive(true); setDone(false); setFeedback(null);
  };

  const submitEssay = async () => {
    const missing = sel.questions.filter((_,i) => !(answers[i]||"").trim()).length;
    if (missing > 0 && !window.confirm(`${missing} question(s) have no answer. Submit anyway?`)) return;
    if (!window.confirm("Submit essay? You only have 1 attempt — this cannot be undone.")) return;

    const snap = {...answers};
    setSavedAnswers(snap);
    setActive(false); setDone(true); setGrading(true);

    const totalMarks = sel.questions.reduce((s,q)=>s+(+q.marks||10),0);
    const qaText = sel.questions.map((q,i)=>["Q"+(i+1)+" ["+(q.marks||10)+" marks]: "+q.q, "Key points: "+(q.modelAnswer||"Use professional nursing knowledge"), "Student answer: "+(snap[i]||"(no answer)").trim()].join("\n")).join("\n\n");
    const submissionBase = { date:new Date().toLocaleDateString(), subject:sel.subject, answers:snap, questions:sel.questions, totalMarks };

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:2000,
          messages:[{ role:"user", content:`You are a professional nursing lecturer marking essay exam answers. Be fair, thorough and constructive.

Exam: ${sel.subject}
Total Marks: ${totalMarks}

${qaText}

Return ONLY valid JSON with no markdown or backticks:
{"overallScore":number,"totalMarks":${totalMarks},"overallPct":number,"grade":"A/B/C/D/F","overallComment":"2-3 sentence summary of performance","questions":[{"marksAwarded":number,"maxMarks":number,"strengths":"specific strengths","weaknesses":"specific gaps","feedback":"actionable feedback"}]}`
        }]
        })
      });
      const data = await res.json();
      const raw = (data.content?.[0]?.text||"").replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(raw);

      const attData = { date:new Date().toLocaleDateString(), score:parsed.overallScore, total:totalMarks, pct:parsed.overallPct, grade:parsed.grade, answers:snap, feedback:parsed, gradedByAI:true };
      const att = ls(attKey, {});
      att[String(sel.id)] = attData;
      saveMyData("essay-att",attKey,att);

      // Save to backend for lecturer visibility
      saveEssaySubmissionToBackend(currentUser, sel.id, { ...submissionBase, feedback:parsed, gradedByAI:true, grade:parsed.grade, pct:parsed.overallPct });

      const results = ls("nv-results",[]);
      saveMyData("results","nv-results",[...results,{id:Date.now(),subject:sel.subject,type:"Essay (AI)",score:parsed.overallScore,total:totalMarks,pct:parsed.overallPct,date:new Date().toLocaleDateString()}]);

      setFeedback(parsed);
    } catch(e) {
      // AI unavailable — save submission for MANUAL LECTURER GRADING
      const attData = { date:new Date().toLocaleDateString(), score:null, total:totalMarks, pct:null, grade:null, answers:snap, feedback:null, pendingManualGrade:true };
      const att = ls(attKey, {});
      att[String(sel.id)] = attData;
      saveMyData("essay-att",attKey,att);

      // Save to backend so lecturer can see and grade manually
      saveEssaySubmissionToBackend(currentUser, sel.id, { ...submissionBase, pendingManualGrade:true });

      toast("AI unavailable. Your essay has been saved for manual grading by your lecturer.", "warn");
    }
    setGrading(false);
  };

  // Results screen
  if (done && sel) {
    const gradeColors = {A:"var(--success)",B:"var(--accent2)",C:"var(--warn)",D:"var(--danger)",F:"var(--danger)"};
    const gc = gradeColors[feedback?.grade]||"var(--text3)";
    return (
      <div style={{maxWidth:680,margin:"0 auto"}}>
        <div style={{textAlign:"center",padding:"24px 0 20px"}}>
          {grading ? (
            <>
              <div style={{fontSize:52,marginBottom:12,animation:"spin 2s linear infinite",display:"inline-block"}}>🤖</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20,marginBottom:8}}>Claude AI is grading your essay…</div>
              <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>Analysing your answers — please do not close this page</div>
            </>
          ) : feedback ? (
            <>
              <div style={{fontSize:52,marginBottom:10}}>{feedback.overallPct>=70?"🎉":feedback.overallPct>=50?"👍":"📚"}</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20,marginBottom:8}}>Grading Complete</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16,marginBottom:10}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:48,lineHeight:1,color:feedback.overallPct>=70?"var(--success)":feedback.overallPct>=50?"var(--warn)":"var(--danger)"}}>{feedback.overallPct}%</div>
                <div style={{width:54,height:54,borderRadius:12,background:`${gc}22`,border:`2px solid ${gc}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:28,color:gc}}>{feedback.grade}</div>
              </div>
              <div style={{fontSize:13,color:"var(--text2)",maxWidth:480,margin:"0 auto",lineHeight:1.6}}>{feedback.overallComment}</div>
            </>
          ) : (
            <>
              <div style={{fontSize:52,marginBottom:10}}>📝</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:20}}>Essay Submitted for Manual Grading</div>
              <div style={{fontSize:13,color:"var(--text3)",marginTop:8,maxWidth:440,margin:"8px auto 0",lineHeight:1.6}}>
                AI grading was unavailable. Your answers have been saved to the backend and sent to your lecturer for manual marking. Check back later for your result.
              </div>
              <div style={{marginTop:16,background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.25)",borderRadius:12,padding:"12px 18px",fontSize:12,color:"var(--warn)",display:"inline-block"}}>
                ⏳ Awaiting lecturer feedback
              </div>
            </>
          )}
        </div>

        {!grading && feedback?.questions && (
          <div style={{marginTop:20}}>
            {sel.questions.map((q,i)=>{
              const qf=feedback.questions[i]||{};
              const qpct=qf.maxMarks>0?Math.round((qf.marksAwarded/qf.maxMarks)*100):0;
              return (
                <div key={i} className="card" style={{marginBottom:14,borderLeft:`3px solid ${qpct>=70?"var(--success)":qpct>=50?"var(--warn)":"var(--danger)"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{fontWeight:700,fontSize:14,flex:1,marginRight:12}}>Q{i+1}. {q.q}</div>
                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,color:qpct>=70?"var(--success)":qpct>=50?"var(--warn)":"var(--danger)",flexShrink:0}}>{qf.marksAwarded||0}/{qf.maxMarks||q.marks||10}</span>
                  </div>
                  <div style={{fontSize:13,color:"var(--text3)",fontStyle:"italic",borderLeft:"2px solid var(--border2)",paddingLeft:10,marginBottom:10,lineHeight:1.6}}>{savedAnswers[i]||"(no answer)"}</div>
                  {qf.strengths&&<div style={{fontSize:12,marginBottom:4}}><b style={{color:"var(--success)"}}>✓ Strengths: </b>{qf.strengths}</div>}
                  {qf.weaknesses&&<div style={{fontSize:12,marginBottom:4}}><b style={{color:"var(--warn)"}}>↗ Areas to improve: </b>{qf.weaknesses}</div>}
                  {qf.feedback&&<div style={{fontSize:12,color:"var(--text2)"}}><b>📝 Feedback: </b>{qf.feedback}</div>}
                </div>
              );
            })}
          </div>
        )}

        {!grading && <div style={{textAlign:"center",marginTop:16}}><button className="btn" onClick={()=>{setSel(null);setDone(false);setFeedback(null);}}>← Back</button></div>}
      </div>
    );
  }

  // Active essay screen
  if (active && sel) {
    const totalWords = Object.values(answers).reduce((s,v)=>s+((v||"").trim().split(/\s+/).filter(Boolean).length),0);
    const answeredCount = sel.questions.filter((_,i)=>(answers[i]||"").trim().length>0).length;
    return (
      <div style={{maxWidth:960,margin:"0 auto"}}>
        {/* Header bar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:14,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16}}>{sel.subject}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>
              {sel.questions.length} questions • {answeredCount}/{sel.questions.length} answered • {totalWords} words total
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {/* Progress dots */}
            <div style={{display:"flex",gap:4}}>
              {sel.questions.map((_,i)=>(
                <div key={i} style={{width:10,height:10,borderRadius:"50%",
                  background:(answers[i]||"").trim()?"var(--success)":"var(--border2)",
                  border:"1px solid var(--border)",transition:"background .2s"}}
                  title={`Q${i+1}: ${(answers[i]||"").trim()?"answered":"unanswered"}`} />
              ))}
            </div>
            <button className="btn" onClick={()=>{if(window.confirm("Exit? Your answers will be lost."))setActive(false);}}>Exit</button>
            <button className="btn btn-accent" onClick={submitEssay}>🤖 Submit for AI Grading</button>
          </div>
        </div>

        <div style={{background:"rgba(167,139,250,.07)",border:"1px solid rgba(167,139,250,.2)",borderRadius:10,padding:"10px 14px",marginBottom:18,fontSize:12,color:"var(--purple)"}}>
          🤖 Your answers will be graded by Claude AI. Write clearly and in full sentences. You have <b>1 attempt only</b>.
        </div>

        {/* Two-column layout: question | answer */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 2px 1fr",gap:0,border:"1px solid var(--border)",borderRadius:14,overflow:"hidden",marginBottom:24}}>

          {/* Column headers */}
          <div style={{background:"var(--bg4)",padding:"10px 18px",fontWeight:800,fontSize:13,color:"var(--accent)",borderBottom:"1px solid var(--border)"}}>
            📋 Questions
          </div>
          <div style={{background:"var(--border)",borderBottom:"1px solid var(--border)"}} />
          <div style={{background:"var(--bg4)",padding:"10px 18px",fontWeight:800,fontSize:13,color:"var(--success)",borderBottom:"1px solid var(--border)"}}>
            ✍️ Your Answers
          </div>

          {/* Q&A rows */}
          {sel.questions.map((q,i)=>{
            const wordCount = ((answers[i]||"").trim().split(/\s+/).filter(Boolean)).length;
            const hasAnswer = (answers[i]||"").trim().length > 0;
            const isLast = i === sel.questions.length-1;
            return (
              <>
                {/* Question cell */}
                <div key={`q${i}`} style={{
                  padding:"18px 18px",
                  borderBottom: isLast?"none":"1px solid var(--border)",
                  background: i%2===0?"var(--card)":"var(--bg4)",
                  display:"flex",flexDirection:"column",gap:8
                }}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                    <span style={{
                      minWidth:26,height:26,borderRadius:7,background:"var(--accent)",
                      color:"white",fontWeight:800,fontSize:11,display:"flex",
                      alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1
                    }}>Q{i+1}</span>
                    <div style={{fontWeight:600,fontSize:13,lineHeight:1.6,color:"var(--text)"}}>{q.q}</div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginLeft:34}}>
                    <span style={{fontSize:10,fontWeight:700,color:"var(--accent)",background:"rgba(0,119,182,.1)",
                      padding:"2px 8px",borderRadius:10,border:"1px solid rgba(0,119,182,.2)"}}>
                      {q.marks||10} marks
                    </span>
                    {q.wordGuide&&<span style={{fontSize:10,color:"var(--text3)",background:"var(--bg4)",
                      padding:"2px 8px",borderRadius:10,border:"1px solid var(--border)"}}>
                      ~{q.wordGuide} words
                    </span>}
                  </div>
                </div>

                {/* Divider */}
                <div key={`d${i}`} style={{background:"var(--border)",borderBottom:isLast?"none":"1px solid var(--border)"}} />

                {/* Answer cell */}
                <div key={`a${i}`} style={{
                  padding:"14px 16px",
                  borderBottom: isLast?"none":"1px solid var(--border)",
                  background: i%2===0?"var(--card)":"var(--bg4)",
                  display:"flex",flexDirection:"column",gap:6
                }}>
                  <textarea
                    rows={5}
                    style={{
                      width:"100%",resize:"vertical",padding:"10px 12px",fontSize:13,lineHeight:1.6,
                      borderRadius:9,border:`1.5px solid ${hasAnswer?"var(--success)":"var(--border2)"}`,
                      background:"var(--bg)",color:"var(--text)",outline:"none",
                      fontFamily:"inherit",transition:"border-color .2s",boxSizing:"border-box",
                      marginBottom:0
                    }}
                    placeholder={`Write your answer here (aim for ${q.wordGuide||"100–200"} words)…`}
                    value={answers[i]||""}
                    onChange={e=>setAnswers(a=>({...a,[i]:e.target.value}))}
                    onFocus={e=>e.target.style.borderColor="var(--accent)"}
                    onBlur={e=>e.target.style.borderColor=hasAnswer?"var(--success)":"var(--border2)"}
                  />
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:10,fontFamily:"'DM Mono',monospace",
                      color:hasAnswer?"var(--success)":"var(--text3)"}}>
                      {hasAnswer?"✓ ":""}{wordCount} word{wordCount!==1?"s":""}
                    </span>
                    {hasAnswer&&<span style={{fontSize:10,color:"var(--success)"}}>✅ Answered</span>}
                    {!hasAnswer&&<span style={{fontSize:10,color:"var(--text3)"}}>⬜ Not answered</span>}
                  </div>
                </div>
              </>
            );
          })}
        </div>

        <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingBottom:24}}>
          <button className="btn" onClick={()=>{if(window.confirm("Exit? Your answers will be lost."))setActive(false);}}>Exit</button>
          <button className="btn btn-accent" style={{fontWeight:800}} onClick={submitEssay}>🤖 Submit for AI Grading</button>
        </div>
      </div>
    );
  }

  // Essay bank list
  return (
    <div>
      {essayBanks.length===0 ? (
        <div style={{textAlign:"center",padding:"50px 20px",color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}>✍️</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>No essay exams available yet.</div>
          <div style={{fontSize:12,marginTop:6}}>Lecturers can create essay exams from the Admin Panel.</div>
        </div>
      ) : (
        <div className="grid2">
          {essayBanks.map((b,i)=>{
            const att = ls(attKey,{})[String(b.id)];
            return (
              <div key={b.id} className="card" style={{animation:`fadeUp .4s ease ${i*.08}s both`}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,marginBottom:4}}>{b.subject}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>{b.questions.length} questions • {b.questions.reduce((s,q)=>s+(+q.marks||10),0)} total marks</div>
                {b.description&&<div style={{fontSize:11,color:"var(--text3)",marginBottom:8,fontStyle:"italic"}}>{b.description}</div>}
                {att ? (
                  <div>
                    {att.pendingManualGrade && !att.manualGrade && (
                      <div style={{background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.25)",borderRadius:8,padding:"8px 12px",fontSize:12,color:"var(--warn)",marginBottom:6}}>
                        ⏳ Submitted • Awaiting manual grading from your lecturer
                      </div>
                    )}
                    {att.manualGrade && (
                      <div style={{marginBottom:6}}>
                        <div style={{fontSize:14,fontWeight:700,marginBottom:2}}>Grade: <span style={{color:"var(--accent)"}}>{att.manualGrade.grade}</span> • {att.manualGrade.pct}%</div>
                        {att.manualGrade.overallComment && <div style={{fontSize:12,color:"var(--text2)"}}>{att.manualGrade.overallComment}</div>}
                        <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginTop:4}}>✏️ Manually graded on {att.gradedDate}</div>
                      </div>
                    )}
                    {att.grade && !att.manualGrade && <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>Grade: <span style={{color:"var(--accent)"}}>{att.grade}</span> • {att.pct}%</div>}
                    <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>🔒 Submitted {att.date} — contact lecturer to reset</div>
                  </div>
                ) : (
                  <button className="btn btn-accent btn-sm" onClick={()=>startExam(b)}>Start Essay ▶</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════
// ── STUDENT ID CARD GENERATOR ────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

export function NursingOsceView({ osce, meta, year, onBack, currentUser, isUnlocked }) {
  const isUnlockedFull = isUnlocked || useNcAccess(currentUser||"");
  const [unlocked, setUnlocked] = useState(isUnlockedFull);
  const [ticked, setTicked] = useState({});
  const [expandAll, setExpandAll] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [revealedQS, setRevealedQS] = useState({});
  const [mcqAnswers, setMcqAnswers] = useState({});
  const [osceSearch, setOsceSearch] = useState("");

  const toggle = (ci, si) => {
    const key = `${ci}-${si}`;
    setTicked(t=>({...t,[key]:!t[key]}));
  };
  const toggleSection = (ci) => setExpanded(e=>({...e,[ci]:!e[ci]}));

  const checklists = osce.checklists || [];

  // OSCE is fully premium — require unlock
  if (!unlocked && checklists.length > 0) {
    return (
      <div style={{maxWidth:640,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <button className="btn btn-sm" onClick={onBack}>← Back</button>
          <div style={{fontWeight:800,fontSize:15,color:meta.color}}>{meta.icon} {year} OSCE Checklists</div>
        </div>
        <div style={{marginBottom:16}}>
          {checklists.slice(0,1).map((c,ci)=>(
            <div key={ci} className="card" style={{marginBottom:10,borderLeft:`4px solid ${meta.color}`,opacity:.6}}>
              <div style={{fontWeight:800,fontSize:14,color:meta.color,marginBottom:6}}>🩺 {c.heading}</div>
              <div style={{fontSize:12,color:"var(--text3)"}}>({c.steps.length} steps) — Unlock to access</div>
            </div>
          ))}
          {checklists.length>1&&<div style={{textAlign:"center",fontSize:13,color:"var(--text3)",padding:10}}>+ {checklists.length-1} more checklists locked 🔒</div>}
        </div>
        <NcPaywall currentUser={currentUser||""} onUnlocked={()=>setUnlocked(true)} toast={()=>{}} />
      </div>
    );
  }
  // Rich activity count for progress
  const filteredChecklists = osceSearch.trim()
    ? checklists.filter(c => (c.heading||"").toLowerCase().includes(osceSearch.trim().toLowerCase()) ||
        (c.activities||[]).some(a=>(a.text||"").toLowerCase().includes(osceSearch.trim().toLowerCase())))
    : checklists;
  const totalActivities = checklists.reduce((s,c) => s + ((c.activities&&c.activities.length) ? c.activities.length : (c.steps||[]).length), 0);
  const tickedCount = Object.values(ticked).filter(Boolean).length;

  return (
    <div style={{maxWidth:720,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,flexWrap:"wrap"}}>
        <button className="btn btn-sm" onClick={onBack}>← Back</button>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:16,color:meta.color}}>{meta.icon} {meta.short} — {year} OSCE</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>OSCE Clinical Checklist for RN • {checklists.length} station{checklists.length!==1?"s":""}</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn btn-sm" onClick={()=>{setExpandAll(true);setExpanded({});}}>Expand All</button>
          <button className="btn btn-sm" onClick={()=>{setExpandAll(false);setExpanded(checklists.reduce((o,_,i)=>({...o,[i]:true}),{}));}}>Collapse All</button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <div style={{position:"relative",flex:1}}>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:15,color:"var(--text3)",pointerEvents:"none"}}>🔍</span>
          <input className="inp" style={{marginBottom:0,paddingLeft:34}} placeholder="Search procedure / station…" value={osceSearch} onChange={e=>setOsceSearch(e.target.value)} />
        </div>
        {osceSearch&&<button className="btn btn-sm" onClick={()=>setOsceSearch("")}>✕ Clear</button>}
      </div>
      {osceSearch&&<div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>{filteredChecklists.length} result{filteredChecklists.length!==1?"s":""} for "{osceSearch}"</div>}

      {/* Progress bar */}
      <div className="card" style={{marginBottom:18,padding:"14px 18px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontWeight:800,fontSize:13}}>Practice Progress</div>
          <div style={{fontWeight:800,fontSize:13,color:meta.color}}>{tickedCount}/{totalActivities}</div>
        </div>
        <div className="progress-wrap">
          <div className="progress-fill" style={{width:`${totalActivities>0?(tickedCount/totalActivities)*100:0}%`,background:`linear-gradient(90deg,${meta.color},${meta.color}bb)`}} />
        </div>
        <div style={{fontSize:10,color:"var(--text3)",marginTop:5}}>Tick each activity as you practise</div>
      </div>

      {filteredChecklists.length===0&&osceSearch&&checklists.length>0&&(
        <div style={{textAlign:"center",padding:24,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:12,marginBottom:16}}>
          No stations match "<b>{osceSearch}</b>" — try a different keyword.
        </div>
      )}

      {filteredChecklists.map((c,ci)=>{
        const realCi = checklists.indexOf(c);
        const isCollapsed = expandAll ? (expanded[realCi]===true) : (expanded[realCi]!==true);
        const acts = c.activities && c.activities.length ? c.activities : [];
        const legacySteps = !acts.length ? (c.steps||[]) : [];
        const totalHere = acts.length || legacySteps.length;
        const tickedHere = (acts.length ? acts : legacySteps).filter((_,si)=>ticked[`${realCi}-${si}`]).length;
        const qs = c.questionStation || [];

        return (
          <div key={c.id||ci} className="card" style={{marginBottom:20,borderLeft:`4px solid ${meta.color}`}}>
            {/* Station heading */}
            <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"2px 0"}}
              onClick={()=>toggleSection(realCi)}>
              <div style={{width:38,height:38,borderRadius:9,background:`${meta.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🩺</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:14,color:meta.color,lineHeight:1.3}}>PROCEDURE STATION: {c.heading}</div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{tickedHere}/{totalHere} activities checked{qs.length>0?` • ${qs.length} question station item${qs.length!==1?"s":""}`:""}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {tickedHere===totalHere&&totalHere>0&&<span style={{fontSize:11,fontWeight:700,color:"var(--success)"}}>✅ Done</span>}
                <span style={{fontSize:13,color:"var(--text3)",transition:"transform .2s",display:"inline-block",transform:isCollapsed?"rotate(-90deg)":"rotate(0deg)"}}>▾</span>
              </div>
            </div>

            {!isCollapsed&&(
              <div style={{marginTop:14,borderTop:"1px solid var(--border)",paddingTop:14}}>

                {/* Instructions */}
                {(c.instructions||[]).length>0&&(
                  <div style={{marginBottom:14,background:`${meta.color}08`,borderRadius:10,padding:"10px 14px",border:`1px solid ${meta.color}20`}}>
                    <div style={{fontWeight:800,fontSize:11,color:meta.color,marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>📋 Instruction to Candidate</div>
                    {(c.instructions||[]).map((ins,ii)=>(
                      <div key={ii} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:13,marginBottom:4}}>
                        <span style={{color:meta.color,flexShrink:0,marginTop:1}}>➤</span>
                        <span style={{color:"var(--text2)",lineHeight:1.5}}>{ins}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Activities */}
                {(acts.length>0||legacySteps.length>0)&&(
                  <div style={{marginBottom:14}}>
                    <div style={{fontWeight:800,fontSize:11,color:"var(--text3)",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>📝 Activities</div>
                    {acts.length>0 ? acts.map((act,si)=>{
                      const key=`${realCi}-${si}`;
                      const done=!!ticked[key];
                      return (
                        <div key={si}>
                          <div onClick={()=>toggle(ci,si)}
                            style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 10px",borderRadius:8,cursor:"pointer",
                              background:done?`${meta.color}08`:"transparent",marginBottom:2,transition:"background .15s",
                              border:`1px solid ${done?meta.color+"30":"transparent"}`}}>
                            <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${done?meta.color:"var(--border2)"}`,
                              background:done?meta.color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",
                              flexShrink:0,transition:"all .2s",marginTop:1}}>
                              {done&&<span style={{color:"white",fontSize:11,fontWeight:800}}>✓</span>}
                            </div>
                            <div style={{flex:1}}>
                              <span style={{fontSize:13,fontWeight:done?700:500,color:done?"var(--text)":"var(--text2)",lineHeight:1.5}}>
                                <span style={{color:meta.color,fontWeight:800}}>{act.num}.</span> {act.text}
                              </span>
                              {act.mark&&<span style={{marginLeft:6,fontSize:11,background:`${meta.color}18`,color:meta.color,borderRadius:4,padding:"1px 6px",fontWeight:700}}>({act.mark})</span>}
                            </div>
                          </div>
                          {(act.subItems||[]).map((sub,sbi)=>(
                            <div key={sbi} style={{paddingLeft:32,marginBottom:2}}>
                              <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"5px 8px",borderRadius:6,
                                background:"var(--bg4)",fontSize:12,color:"var(--text2)",lineHeight:1.5}}>
                                <span style={{color:meta.color,fontWeight:700,flexShrink:0}}>{sub.letter}.</span>
                                <span>{sub.text}</span>
                                {sub.mark&&<span style={{marginLeft:4,fontSize:10,color:meta.color,fontWeight:700}}>({sub.mark})</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }) : legacySteps.map((step,si)=>{
                      const key=`${realCi}-${si}`;
                      const done=!!ticked[key];
                      return (
                        <div key={si} onClick={()=>toggle(ci,si)}
                          style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 10px",borderRadius:8,cursor:"pointer",
                            background:done?`${meta.color}08`:"transparent",marginBottom:2,transition:"background .15s",
                            border:`1px solid ${done?meta.color+"30":"transparent"}`}}>
                          <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${done?meta.color:"var(--border2)"}`,
                            background:done?meta.color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",
                            flexShrink:0,transition:"all .2s",marginTop:1}}>
                            {done&&<span style={{color:"white",fontSize:11,fontWeight:800}}>✓</span>}
                          </div>
                          <div style={{fontSize:13,fontWeight:done?700:500,color:done?"var(--text)":"var(--text2)",lineHeight:1.5}}>{step}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Total Marks */}
                {c.totalMarks&&(
                  <div style={{marginBottom:14,padding:"8px 12px",background:"var(--bg4)",borderRadius:8,fontSize:12,fontWeight:700,color:"var(--text2)",borderLeft:`3px solid ${meta.color}`}}>
                    📊 {c.totalMarks}
                  </div>
                )}

                {/* Question Station */}
                {qs.length>0&&(
                  <div style={{marginTop:6}}>
                    <div style={{fontWeight:800,fontSize:11,color:"var(--text3)",marginBottom:10,textTransform:"uppercase",letterSpacing:1,paddingTop:10,borderTop:"1px dashed var(--border)"}}>
                      ❓ Question Station
                    </div>
                    {qs.map((q,qi)=>{
                      const qKey = `${realCi}-q${qi}`;
                      const revealed = !!revealedQS[qKey];
                      const userAns = mcqAnswers[qKey];
                      if (q.type === "mcq") {
                        return (
                          <div key={qi} style={{marginBottom:12,background:"var(--bg4)",borderRadius:10,padding:"12px 14px",border:"1px solid var(--border)"}}>
                            <div style={{fontWeight:700,fontSize:13,marginBottom:8,lineHeight:1.5}}>
                              <span style={{color:meta.color,fontWeight:800,marginRight:4}}>{q.qNum||qi+1}.</span>{q.q}
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:6}}>
                              {(q.options||[]).map((opt,oi)=>{
                                const isSelected = userAns === opt.letter;
                                const isCorrect = revealed && q.ans === opt.letter;
                                const isWrong = revealed && isSelected && q.ans !== opt.letter;
                                return (
                                  <div key={oi} onClick={()=>!revealed&&setMcqAnswers(a=>({...a,[qKey]:opt.letter}))}
                                    style={{display:"flex",gap:8,alignItems:"center",padding:"7px 10px",borderRadius:7,cursor:revealed?"default":"pointer",
                                      transition:"all .15s",
                                      background: isCorrect?"rgba(34,197,94,.12)":isWrong?"rgba(239,68,68,.08)":isSelected?`${meta.color}10`:"transparent",
                                      border:`1px solid ${isCorrect?"var(--success)":isWrong?"var(--danger)":isSelected?meta.color:"var(--border)"}`}}>
                                    <div style={{width:20,height:20,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,
                                      background: isCorrect?"var(--success)":isWrong?"var(--danger)":isSelected?meta.color:"var(--bg4)",
                                      color: isCorrect||isWrong||isSelected?"white":"var(--text3)",border:`1px solid ${isCorrect?"var(--success)":isWrong?"var(--danger)":isSelected?meta.color:"var(--border)"}`}}>
                                      {opt.letter}
                                    </div>
                                    <span style={{fontSize:13,color:isCorrect?"var(--success)":isWrong?"var(--danger)":"var(--text2)",fontWeight:isCorrect?700:400}}>{opt.text}</span>
                                    {isCorrect&&<span style={{marginLeft:"auto",fontSize:11,color:"var(--success)",fontWeight:800}}>✓ Correct</span>}
                                    {isWrong&&<span style={{marginLeft:"auto",fontSize:11,color:"var(--danger)",fontWeight:800}}>✗</span>}
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{marginTop:8,display:"flex",gap:8}}>
                              {!revealed&&userAns&&(
                                <button className="btn btn-sm btn-accent" style={{fontSize:11,padding:"4px 10px",background:meta.color,border:"none",color:"white"}}
                                  onClick={()=>setRevealedQS(r=>({...r,[qKey]:true}))}>Check Answer</button>
                              )}
                              {revealed&&<span style={{fontSize:11,color:"var(--success)",fontWeight:700}}>✅ Answer revealed</span>}
                            </div>
                          </div>
                        );
                      } else {
                        // fill-in-blank or text question
                        return (
                          <div key={qi} style={{marginBottom:10,background:"var(--bg4)",borderRadius:10,padding:"12px 14px",border:"1px solid var(--border)"}}>
                            <div style={{fontWeight:700,fontSize:13,marginBottom:6,lineHeight:1.6,color:"var(--text)"}}>{q.q}</div>
                            {q.ans&&(
                              <div>
                                {!revealed&&(
                                  <button className="btn btn-sm" style={{fontSize:11,padding:"3px 10px"}}
                                    onClick={()=>setRevealedQS(r=>({...r,[qKey]:true}))}>Show Answer</button>
                                )}
                                {revealed&&<div style={{fontSize:12,fontWeight:700,color:"var(--success)",marginTop:4}}>✓ {q.ans}</div>}
                              </div>
                            )}
                          </div>
                        );
                      }
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div style={{textAlign:"center",marginTop:16}}>
        <button className="btn" onClick={onBack}>← Back to Papers</button>
      </div>
    </div>
  );
}
// ─── STUDENT: Nursing MCQ Exam ─────────────────────────────────────────

export function NursingMCQExam({ toast, currentUser, paper, meta, onBack, isUnlocked }) {
  const isUnlockedFull = isUnlocked || useNcAccess(currentUser);
  const visibleQs = isUnlockedFull ? paper.questions : paper.questions.slice(0, NC_FREE_LIMIT);
  const attKey = `nv-ne-att-${currentUser}`;
  const [answers, setAnswers] = useState(new Array(visibleQs.length).fill(null));
  const [qIdx, setQIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [finalAnswers, setFinalAnswers] = useState([]);
  const [unlocked, setUnlocked] = useState(isUnlockedFull);

  // Re-check after code redemption
  const handleUnlocked = () => setUnlocked(true);

  // Show paywall if not unlocked and paper has more than free limit
  if (!unlocked && !isUnlockedFull && paper.questions.length > NC_FREE_LIMIT && done === false) {
    // Check if currently at the paywall point
    if (qIdx >= NC_FREE_LIMIT) {
      const preview = (
        <div>
          {paper.questions.slice(0, NC_FREE_LIMIT).map((q, i) => (
            <div key={i} className="card" style={{marginBottom:8,opacity:.7,borderLeft:`3px solid ${meta.color}`}}>
              <div style={{fontWeight:700,fontSize:12}}>Q{i+1}. {q.q}</div>
            </div>
          ))}
        </div>
      );
      return <NcPaywall currentUser={currentUser} onUnlocked={handleUnlocked} toast={toast} preview={preview} />;
    }
  }

  const submitExam = () => {
    const unanswered = answers.filter(a=>a===null).length;
    if (unanswered>0&&!confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) return;
    const snap=[...answers];
    const score=visibleQs.reduce((s,q,i)=>snap[i]===q.ans?s+1:s,0);
    const pct=Math.round((score/visibleQs.length)*100);
    const att=ls(attKey,{});
    att[String(paper.id)]={score,total:visibleQs.length,pct,answers:snap,date:new Date().toLocaleDateString()};
    saveMyData("mcq-att",attKey,att);
    const results=ls("nv-results",[]);
    saveMyData("results","nv-results",[...results,{id:Date.now(),subject:paper.title,type:`${meta.short} Exam`,score,total:visibleQs.length,pct,date:new Date().toLocaleDateString()}]);
    setFinalAnswers(snap); setDone(true);
    toast("Exam submitted! Your results are saved.","success");
  };

  if (done) {
    const score=visibleQs.reduce((s,q,i)=>finalAnswers[i]===q.ans?s+1:s,0);
    const pct=Math.round((score/visibleQs.length)*100);
    return (
      <div style={{maxWidth:620,margin:"0 auto"}}>
        <div style={{textAlign:"center",padding:"28px 0 20px"}}>
          <div style={{fontSize:52,marginBottom:8}}>{pct>=70?"🎉":pct>=50?"👍":"📚"}</div>
          <div style={{fontWeight:800,fontSize:20,marginBottom:4}}>Exam Complete!</div>
          <div style={{fontWeight:800,fontSize:48,color:pct>=70?"var(--success)":pct>=50?"var(--warn)":"var(--danger)",lineHeight:1}}>{score}/{visibleQs.length}</div>
          <div style={{fontSize:20,marginBottom:4}}>{pct}%</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>🔒 1 attempt used — contact admin to reset</div>
        </div>
        <div style={{marginTop:14}}>
          {visibleQs.map((q,i)=>{
            const chosen=finalAnswers[i]; const correct=chosen===q.ans;
            return (
              <div key={i} className="card" style={{marginBottom:10,borderLeft:`3px solid ${chosen===null?"var(--border)":correct?"var(--success)":"var(--danger)"}`}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Q{i+1}. {q.q}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {q.options.filter(o=>o).map((opt,oi)=>(
                    <span key={oi} style={{fontSize:11,padding:"3px 9px",borderRadius:6,
                      background:oi===q.ans?"rgba(34,197,94,.15)":oi===chosen&&!correct?"rgba(239,68,68,.1)":"transparent",
                      border:`1px solid ${oi===q.ans?"var(--success)":oi===chosen&&!correct?"var(--danger)":"var(--border)"}`,
                      color:oi===q.ans?"var(--success)":oi===chosen&&!correct?"var(--danger)":"var(--text3)",
                      fontWeight:oi===q.ans?800:400
                    }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}{oi===chosen&&chosen!==q.ans?" ✗":""}</span>
                  ))}
                </div>
                {chosen===null&&<div style={{fontSize:11,color:"var(--text3)",marginTop:5,fontStyle:"italic"}}>— Not answered</div>}
              </div>
            );
          })}
        </div>
        <div style={{textAlign:"center",marginTop:16}}>
          <button className="btn" onClick={onBack}>← Back to Papers</button>
        </div>
      </div>
    );
  }

  const q=visibleQs[qIdx];
  const answeredCount=answers.filter(a=>a!==null).length;
  const isLimited = !unlocked && !isUnlockedFull && paper.questions.length > NC_FREE_LIMIT;
  return (
    <div style={{maxWidth:600,margin:"0 auto"}}>
      {isLimited&&(
        <div style={{padding:"8px 14px",borderRadius:10,marginBottom:12,background:"rgba(251,146,60,.1)",border:"1px solid rgba(251,146,60,.3)",display:"flex",alignItems:"center",gap:8}}>
          <span>⚠️</span>
          <div style={{flex:1,fontSize:12,color:"var(--warn)",fontWeight:700}}>Free preview: {NC_FREE_LIMIT} of {paper.questions.length} questions</div>
          <button className="btn btn-sm btn-accent" style={{fontSize:11}} onClick={()=>setQIdx(NC_FREE_LIMIT)}>🔓 Unlock All</button>
        </div>
      )}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:meta.color}}>{meta.icon} {paper.title}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>{answeredCount}/{visibleQs.length} answered • click any number to jump</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-sm" onClick={onBack}>✕ Exit</button>
          <button className="btn btn-sm btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}} onClick={submitExam}>Submit ✓</button>
        </div>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
        {visibleQs.map((_,i)=>(
          <div key={i} onClick={()=>setQIdx(i)} style={{width:30,height:30,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11,fontWeight:700,transition:"all .15s",
            background:i===qIdx?meta.color:answers[i]!==null?"rgba(34,197,94,.12)":"var(--bg4)",
            border:`2px solid ${i===qIdx?meta.color:answers[i]!==null?"var(--success)":"var(--border)"}`,
            color:i===qIdx?"white":answers[i]!==null?"var(--success)":"var(--text3)"
          }}>{i+1}</div>
        ))}
        {isLimited && paper.questions.slice(NC_FREE_LIMIT).map((_,i)=>(
          <div key={`lock-${i}`} onClick={()=>setQIdx(NC_FREE_LIMIT)}
            style={{width:30,height:30,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:12,
              background:"var(--bg4)",border:"2px dashed var(--border)",color:"var(--text3)"}}>🔒</div>
        ))}
      </div>
      <div className="progress-wrap" style={{marginBottom:14}}>
        <div className="progress-fill" style={{width:`${(answeredCount/visibleQs.length)*100}%`,background:meta.color}} />
      </div>
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Question {qIdx+1} of {isLimited?`${NC_FREE_LIMIT} (free)`:visibleQs.length}</div>
      <div className="card" style={{marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:16,lineHeight:1.5}}>{q.q}</div>
      </div>
      {q.options.filter(o=>o).map((opt,i)=>(
        <div key={i} onClick={()=>setAnswers(prev=>{const n=[...prev];n[qIdx]=i;return n;})}
          className="quiz-opt" style={{borderColor:answers[qIdx]===i?meta.color:"var(--border)",background:answers[qIdx]===i?`${meta.color}15`:"transparent",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:11,opacity:.6,flexShrink:0}}>{"ABCD"[i]}.</span>
          <span style={{flex:1}}>{opt}</span>
          {answers[qIdx]===i&&<span style={{color:meta.color,fontWeight:800}}>✓</span>}
        </div>
      ))}
      <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"space-between"}}>
        <button className="btn btn-sm" disabled={qIdx===0} onClick={()=>setQIdx(q=>q-1)}>← Prev</button>
        {qIdx<paper.questions.length-1
          ?<button className="btn btn-sm btn-accent" style={{background:meta.color,border:"none"}} onClick={()=>setQIdx(q=>q+1)}>Next →</button>
          :<button className="btn btn-sm btn-accent" style={{background:meta.color,border:"none"}} onClick={submitExam}>Submit Exam ✓</button>
        }
      </div>
    </div>
  );
}

// ─── STUDENT: Review Mode ─────────────────────────────────────────────

export function NursingReviewMode({ paper, meta, onBack, currentUser, isUnlocked }) {
  const isUnlockedFull = isUnlocked || useNcAccess(currentUser);
  const [unlocked, setUnlocked] = useState(isUnlockedFull);
  const [showAns, setShowAns] = useState({});
  const [search, setSearch] = useState("");
  const allQ = unlocked ? paper.questions : paper.questions.slice(0, NC_FREE_LIMIT);

  if (!unlocked && paper.questions.length > NC_FREE_LIMIT) {
    return (
      <div style={{maxWidth:700,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
          <button className="btn btn-sm" onClick={onBack}>← Back</button>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:15,color:meta.color}}>{meta.icon} {paper.title} — Review Mode</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>Free preview: {NC_FREE_LIMIT} of {paper.questions.length} questions</div>
          </div>
        </div>
        <div style={{marginBottom:12}}>
          {paper.questions.slice(0, NC_FREE_LIMIT).map((q,i)=>(
            <div key={i} className="card" style={{marginBottom:8,borderLeft:`3px solid ${meta.color}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                <div style={{fontWeight:700,fontSize:13,flex:1}}>Q{i+1}. {q.q}</div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {q.options.filter(o=>o).map((opt,oi)=>(
                  <span key={oi} style={{fontSize:11,padding:"3px 9px",borderRadius:6,
                    background:oi===q.ans?"rgba(34,197,94,.15)":"transparent",
                    border:`1px solid ${oi===q.ans?"var(--success)":"var(--border)"}`,
                    color:oi===q.ans?"var(--success)":"var(--text3)",fontWeight:oi===q.ans?800:400
                  }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <NcPaywall currentUser={currentUser} onUnlocked={()=>setUnlocked(true)} toast={()=>{}} />
      </div>
    );
  }

  const filtered = allQ.filter(q=>q.q.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <button className="btn btn-sm" onClick={onBack}>← Back</button>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:15,color:meta.color}}>{meta.icon} {paper.title} — Review Mode</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>All answers visible. Great for revision!</div>
        </div>
        <button className="btn btn-sm" style={{borderColor:meta.color,color:meta.color}}
          onClick={()=>setShowAns(allQ.reduce((o,_,i)=>({...o,[i]:true}),{}))}>Show All ✓</button>
        <button className="btn btn-sm" onClick={()=>setShowAns({})}>Hide All</button>
      </div>
      <div className="search-wrap">
        <span className="search-ico">🔍</span>
        <input placeholder="Search questions..." value={search} onChange={e=>setSearch(e.target.value)} />
      </div>
      {filtered.map((q,fi)=>{
        const qi = allQ.indexOf(q);
        return (
          <div key={qi} className="card" style={{marginBottom:10,borderLeft:`3px solid ${showAns[qi]?meta.color:"var(--border)"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:13,flex:1}}>Q{qi+1}. {q.q}</div>
              <button className="btn btn-sm" style={{flexShrink:0,borderColor:meta.color,color:meta.color,fontSize:11}}
                onClick={()=>setShowAns(s=>({...s,[qi]:!s[qi]}))}>
                {showAns[qi]?"Hide":"Show Answer"}
              </button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {q.options.filter(o=>o).map((opt,oi)=>(
                <span key={oi} style={{fontSize:12,padding:"4px 10px",borderRadius:6,transition:"all .2s",
                  background:showAns[qi]&&oi===q.ans?"rgba(34,197,94,.15)":"var(--bg4)",
                  border:`1px solid ${showAns[qi]&&oi===q.ans?"var(--success)":"var(--border)"}`,
                  color:showAns[qi]&&oi===q.ans?"var(--success)":"var(--text3)",
                  fontWeight:showAns[qi]&&oi===q.ans?800:400
                }}>{"ABCD"[oi]}. {opt}{showAns[qi]&&oi===q.ans?" ✓":""}</span>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{textAlign:"center",marginTop:16}}>
        <button className="btn" onClick={onBack}>← Back to Papers</button>
      </div>
    </div>
  );
}


// ─── STUDENT: School Past Questions View ──────────────────────────────

export function SchoolMCQExam({ toast, currentUser, paper, onBack }) {
  const attKey = `nv-spq-att-${currentUser}`;
  const existingAtt = ls(attKey,{})[paper.courseKey];
  const [answers, setAnswers] = useState(new Array(paper.questions.length).fill(null));
  const [qIdx, setQIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [finalAnswers, setFinalAnswers] = useState([]);

  if (existingAtt && !done) {
    return (
      <div style={{maxWidth:520,margin:"0 auto",textAlign:"center",padding:"40px 20px"}}>
        <div style={{fontSize:48,marginBottom:12}}>🔒</div>
        <div style={{fontWeight:800,fontSize:18,marginBottom:8}}>Attempt Already Used</div>
        <div style={{color:"var(--text3)",marginBottom:8}}>You scored <b style={{color:existingAtt.pct>=70?"var(--success)":existingAtt.pct>=50?"var(--warn)":"var(--danger)"}}>{existingAtt.score}/{existingAtt.total} ({existingAtt.pct}%)</b> on {existingAtt.date}</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:20}}>Contact your lecturer to reset your attempt.</div>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <button className="btn" onClick={onBack}>← Back</button>
        </div>
      </div>
    );
  }

  const submitExam = () => {
    const unanswered = answers.filter(a=>a===null).length;
    if(unanswered>0&&!confirm(`${unanswered} question(s) unanswered. Submit anyway?`))return;
    const snap=[...answers];
    const score=paper.questions.reduce((s,q,i)=>snap[i]===q.ans?s+1:s,0);
    const pct=Math.round((score/paper.questions.length)*100);
    const att=ls(attKey,{});
    att[paper.courseKey]={score,total:paper.questions.length,pct,answers:snap,date:new Date().toLocaleDateString()};
    saveMyData("mcq-att",attKey,att);
    const results=ls("nv-results",[]);
    saveMyData("results","nv-results",[...results,{id:Date.now(),subject:paper.title,type:"School Past Q",score,total:paper.questions.length,pct,date:new Date().toLocaleDateString()}]);
    setFinalAnswers(snap);setDone(true);
    toast("Exam submitted! Results saved.","success");
  };

  if (done) {
    const score=paper.questions.reduce((s,q,i)=>finalAnswers[i]===q.ans?s+1:s,0);
    const pct=Math.round((score/paper.questions.length)*100);
    return (
      <div style={{maxWidth:620,margin:"0 auto"}}>
        <div style={{textAlign:"center",padding:"28px 0 20px"}}>
          <div style={{fontSize:52,marginBottom:8}}>{pct>=70?"🎉":pct>=50?"👍":"📚"}</div>
          <div style={{fontWeight:800,fontSize:20,marginBottom:4}}>Practice Complete!</div>
          <div style={{fontWeight:800,fontSize:48,color:pct>=70?"var(--success)":pct>=50?"var(--warn)":"var(--danger)",lineHeight:1}}>{score}/{paper.questions.length}</div>
          <div style={{fontSize:20,marginBottom:4}}>{pct}%</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>📅 {paper.classLabel} › {paper.course}</div>
        </div>
        <div style={{marginTop:14}}>
          {paper.questions.map((q,i)=>{
            const chosen=finalAnswers[i];const correct=chosen===q.ans;
            return (
              <div key={i} className="card" style={{marginBottom:10,borderLeft:`3px solid ${chosen===null?"var(--border)":correct?"var(--success)":"var(--danger)"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:8}}>
                  <div style={{fontWeight:700,fontSize:13,flex:1}}>Q{i+1}. {q.q}</div>
                  {q.year&&<span style={{fontSize:10,color:"var(--text3)",flexShrink:0}}>{q.year}</span>}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {q.options.filter(o=>o).map((opt,oi)=>(
                    <span key={oi} style={{fontSize:11,padding:"3px 9px",borderRadius:6,
                      background:oi===q.ans?"rgba(34,197,94,.15)":oi===chosen&&!correct?"rgba(239,68,68,.1)":"transparent",
                      border:`1px solid ${oi===q.ans?"var(--success)":oi===chosen&&!correct?"var(--danger)":"var(--border)"}`,
                      color:oi===q.ans?"var(--success)":oi===chosen&&!correct?"var(--danger)":"var(--text3)",fontWeight:oi===q.ans?800:400
                    }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}{oi===chosen&&chosen!==q.ans?" ✗":""}</span>
                  ))}
                </div>
                {chosen===null&&<div style={{fontSize:11,color:"var(--text3)",marginTop:5,fontStyle:"italic"}}>— Not answered</div>}
              </div>
            );
          })}
        </div>
        <div style={{textAlign:"center",marginTop:16}}>
          <button className="btn" onClick={onBack}>← Back to Questions</button>
        </div>
      </div>
    );
  }

  const q=paper.questions[qIdx];
  const answeredCount=answers.filter(a=>a!==null).length;
  return (
    <div style={{maxWidth:600,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:"var(--accent)"}}>📝 {paper.title}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>{answeredCount}/{paper.questions.length} answered</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-sm" onClick={onBack}>✕ Exit</button>
          <button className="btn btn-sm btn-accent" onClick={submitExam}>Submit ✓</button>
        </div>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
        {paper.questions.map((_,i)=>(
          <div key={i} onClick={()=>setQIdx(i)} style={{width:30,height:30,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11,fontWeight:700,transition:"all .15s",
            background:i===qIdx?"var(--accent)":answers[i]!==null?"rgba(34,197,94,.12)":"var(--bg4)",
            border:`2px solid ${i===qIdx?"var(--accent)":answers[i]!==null?"var(--success)":"var(--border)"}`,
            color:i===qIdx?"white":answers[i]!==null?"var(--success)":"var(--text3)"}}>{i+1}</div>
        ))}
      </div>
      <div className="progress-wrap" style={{marginBottom:14}}>
        <div className="progress-fill" style={{width:`${(answeredCount/paper.questions.length)*100}%`,background:"var(--accent)"}} />
      </div>
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Question {qIdx+1} of {paper.questions.length}{q.year?` • ${q.year}`:""}</div>
      <div className="card" style={{marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:16,lineHeight:1.5}}>{q.q}</div>
      </div>
      {q.options.filter(o=>o).map((opt,i)=>(
        <div key={i} onClick={()=>setAnswers(prev=>{const n=[...prev];n[qIdx]=i;return n;})}
          className="quiz-opt" style={{borderColor:answers[qIdx]===i?"var(--accent)":"var(--border)",background:answers[qIdx]===i?"rgba(0,119,182,.12)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:11,opacity:.6,flexShrink:0}}>{"ABCD"[i]}.</span>
          <span style={{flex:1}}>{opt}</span>
          {answers[qIdx]===i&&<span style={{color:"var(--accent)",fontWeight:800}}>✓</span>}
        </div>
      ))}
      <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"space-between"}}>
        <button className="btn btn-sm" disabled={qIdx===0} onClick={()=>setQIdx(q=>q-1)}>← Prev</button>
        {qIdx<paper.questions.length-1
          ?<button className="btn btn-sm btn-accent" onClick={()=>setQIdx(q=>q+1)}>Next →</button>
          :<button className="btn btn-sm btn-accent" onClick={submitExam}>Submit Exam ✓</button>}
      </div>
    </div>
  );
}

// ─── STUDENT: School MCQ Review Mode ──────────────────────────────────

export function SchoolMCQReview({ paper, onBack }) {
  const [showAns, setShowAns] = useState({});
  const [search, setSearch] = useState("");
  const filtered = paper.questions.filter(q=>q.q.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <button className="btn btn-sm" onClick={onBack}>← Back</button>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:15,color:"var(--purple)"}}>📖 {paper.title}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>Review mode — answers visible on demand</div>
        </div>
        <button className="btn btn-sm" style={{borderColor:"var(--accent)",color:"var(--accent)"}}
          onClick={()=>setShowAns(paper.questions.reduce((o,_,i)=>({...o,[i]:true}),{}))}>Show All ✓</button>
        <button className="btn btn-sm" onClick={()=>setShowAns({})}>Hide All</button>
      </div>
      <div className="search-wrap">
        <span className="search-ico">🔍</span>
        <input placeholder="Search questions..." value={search} onChange={e=>setSearch(e.target.value)} />
      </div>
      {filtered.map((q,fi)=>{
        const qi=paper.questions.indexOf(q);
        return (
          <div key={qi} className="card" style={{marginBottom:10,borderLeft:`3px solid ${showAns[qi]?"var(--accent)":"var(--border)"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:13,flex:1}}>Q{qi+1}. {q.q}{q.year?<span style={{fontSize:10,color:"var(--text3)",fontWeight:400,marginLeft:6}}>({q.year})</span>:""}</div>
              <button className="btn btn-sm" style={{flexShrink:0,borderColor:"var(--accent)",color:"var(--accent)",fontSize:11}}
                onClick={()=>setShowAns(s=>({...s,[qi]:!s[qi]}))}>
                {showAns[qi]?"Hide":"Show Answer"}
              </button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {q.options.filter(o=>o).map((opt,oi)=>(
                <span key={oi} style={{fontSize:12,padding:"4px 10px",borderRadius:6,transition:"all .2s",
                  background:showAns[qi]&&oi===q.ans?"rgba(34,197,94,.15)":"var(--bg4)",
                  border:`1px solid ${showAns[qi]&&oi===q.ans?"var(--success)":"var(--border)"}`,
                  color:showAns[qi]&&oi===q.ans?"var(--success)":"var(--text3)",
                  fontWeight:showAns[qi]&&oi===q.ans?800:400
                }}>{"ABCD"[oi]}. {opt}{showAns[qi]&&oi===q.ans?" ✓":""}</span>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{textAlign:"center",marginTop:16}}>
        <button className="btn" onClick={onBack}>← Back to Questions</button>
      </div>
    </div>
  );
}

// ─── STUDENT: School Past Questions Only (sidebar nav) ───────────────────

export function CbtExamManager({ toast, currentUser }) {
  const [exams, setExams]   = useState([]);
  const [results, setResults] = useState([]);
  const [violations, setViolations] = useState([]);
  const [view, setView]     = useState("list"); // list | compose | monitor
  const [selExam, setSelExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const users   = ls("nv-users", []);

  // ── Form state ──
  const blank = { id:null, title:"", subject:"", classId:"", duration:30, questions:[], published:false, publishedAt:null, createdBy:"", createdAt:null,
    shuffleQuestions:true, shuffleOptions:true, fullscreenRequired:true, tabSwitchEnabled:true, tabSwitchLimit:3, webcamSnapshots:true, deviceLock:true, startTime:"", endTime:"", showResultsImmediately:true };
  const [form, setForm]       = useState({...blank});
  const [inputMode, setInputMode] = useState("single"); // single | paste

  // Single-entry state
  const [singleQ, setSingleQ] = useState({ q:"", options:["","","",""], ans:0 });
  const [editQIdx, setEditQIdx] = useState(null);

  // Paste state — live auto-parse
  const [pasteQ, setPasteQ]   = useState("");
  const [pasteA, setPasteA]   = useState("");
  const [parsed, setParsed]   = useState([]);
  const [parseMsg, setParseMsg] = useState("");

  const [saving, setSaving]   = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Load live data — lecturers only see their own exams
  useEffect(() => {
    const u1 = subscribeCbtExams(list => {
      setExams(list.filter(e => e.createdBy === currentUser));
      setLoading(false);
    });
    const u2 = subscribeCbtResults(list => setResults(list));
    const u3 = subscribeCbtViolations(list => setViolations(list));
    return () => { u1(); u2(); u3(); };
  }, [currentUser]);

  // ── Auto-parse on paste text change ──
  useEffect(() => {
    if (!pasteQ.trim()) { setParsed([]); setParseMsg(""); return; }
    const items = parseCbtQuestions(pasteQ, pasteA);
    setParsed(items);
    if (items.length === 0) setParseMsg("⚠️ No questions detected — check your format.");
    else {
      const withAns  = items.filter(i => i._hasAns).length;
      const noAns    = items.length - withAns;
      setParseMsg(`✅ ${items.length} question${items.length>1?"s":""} detected${noAns>0?` • ⚠️ ${noAns} missing answer`:""}. Review below then import.`);
    }
  }, [pasteQ, pasteA]);

  const saveExams = async (list) => {
    setExams(list);
    return await cbtExamsSave(list);
  };

  const saveResults = async (list) => {
    setResults(list);
    return await cbtResultsSave(list);
  };

  // ── Single question handlers ──
  const addSingleQ = () => {
    if (!singleQ.q.trim())          return toast("Question text is required","error");
    if (!singleQ.options[0]||!singleQ.options[1]) return toast("At least options A and B are required","error");
    const q = { q:singleQ.q.trim(), options:singleQ.options.map(o=>o.trim()), ans:singleQ.ans };
    let qs;
    if (editQIdx !== null) {
      qs = form.questions.map((qq,i) => i===editQIdx ? q : qq);
      setEditQIdx(null);
      toast("✏️ Question updated","success");
    } else {
      qs = [...form.questions, q];
      toast("➕ Question added","success");
    }
    setForm(f => ({...f, questions:qs}));
    setSingleQ({ q:"", options:["","","",""], ans:0 });
  };

  const editQ = (i) => {
    const q = form.questions[i];
    setSingleQ({ q:q.q, options:[...q.options], ans:q.ans });
    setEditQIdx(i);
    setInputMode("single");
    document.getElementById("cbt-q-input")?.scrollIntoView({ behavior:"smooth" });
  };

  const deleteQ = (i) => setForm(f => ({...f, questions:f.questions.filter((_,qi) => qi!==i)}));

  // ── Import parsed questions ──
  const importParsed = () => {
    if (!parsed.length) return;
    setForm(f => ({...f, questions:[...f.questions, ...parsed.map(p=>({q:p.q,options:p.options,ans:p.ans}))]}));
    setPasteQ(""); setPasteA(""); setParsed([]); setParseMsg("");
    toast(`✅ ${parsed.length} questions imported!`, "success");
    setInputMode("single");
  };

  // ── Validate form ──
  const validate = () => {
    if (!form.title.trim())       { toast("Exam title is required","error"); return false; }
    if (!form.classId)            { toast("Please select a class","error"); return false; }
    if (form.questions.length<1)  { toast("Add at least 1 question","error"); return false; }
    return true;
  };

  // ── Save as draft ──
  const saveDraft = async () => {
    if (!validate()) return;
    setSaving(true);
    const exam = { ...form, id:form.id||Date.now(), createdBy:currentUser, createdAt:form.createdAt||Date.now(), published:false, publishedAt:null };
    const updated = form.id ? exams.map(e=>e.id===form.id?exam:e) : [...exams, exam];
    const ok = await saveExams(updated);
    setSaving(false);
    if (ok) { toast("💾 Draft saved!","success"); setForm({...exam}); }
    else    toast("⚠️ Saved locally but sync failed","warn");
  };

  // ── Save & Publish ──
  const saveAndPublish = async () => {
    if (!validate()) return;
    setPublishing(true);
    const now = Date.now();
    const exam = { ...form, id:form.id||now, createdBy:currentUser, createdAt:form.createdAt||now, published:true, publishedAt:now };
    const updated = form.id ? exams.map(e=>e.id===form.id?exam:e) : [...exams, exam];
    const ok = await saveExams(updated);
    setPublishing(false);
    if (ok) { toast("🚀 Exam published! Students can now take it.","success"); setForm({...exam}); setView("list"); }
    else    toast("⚠️ Saved locally but sync failed — students may not see it yet","warn");
  };

  // ── Unpublish / Re-publish ──
  const togglePublish = async (id, val) => {
    const updated = exams.map(e=>e.id===id?{...e, published:val, publishedAt:val?Date.now():null}:e);
    await saveExams(updated);
    toast(val?"🚀 Re-published!":"📋 Moved back to Draft","success");
  };

  const deleteExam = async (id) => {
    if (!confirm("Delete this exam and all its results?")) return;
    await saveExams(exams.filter(e=>e.id!==id));
    await saveResults(results.filter(r=>r.examId!==id));
    toast("Exam deleted","success");
  };

  const allowRetake = async (examId, studentEmail) => {
    const updated = results.filter(r=>!(r.examId===examId&&r.student===studentEmail));
    await saveResults(updated);
    toast(`✅ ${studentEmail.split("@")[0]} can retake the exam`,"success");
  };

  // ── Archive check: exam is archived if published > 24h ago ──
  const isArchived = (exam) => {
    if (!exam.published) return false;
    if (exam.endTime) {
      const end = new Date(exam.endTime).getTime();
      if (!isNaN(end) && Date.now() > end) return true;
    }
    return exam.publishedAt && (Date.now()-exam.publishedAt > 24*60*60*1000);
  };
  const isNotStartedYet = (exam) => {
    if (!exam.published || !exam.startTime) return false;
    const start = new Date(exam.startTime).getTime();
    return !isNaN(start) && Date.now() < start;
  };
  const getStatus = (exam) => {
    if (!exam.published) return { label:"📋 Draft", color:"var(--text3)", bg:"rgba(128,128,128,.1)" };
    if (isNotStartedYet(exam)) return { label:"⏳ Scheduled", color:"var(--accent)", bg:"rgba(0,119,182,.1)" };
    if (isArchived(exam)) return { label:"🗄️ Expired", color:"var(--warn)", bg:"rgba(251,146,60,.12)" };
    return { label:"✅ Live", color:"var(--success)", bg:"rgba(34,197,94,.12)" };
  };

  // Print results
  const printResults = (exam) => {
    const cls  = classes.find(c=>c.id===exam.classId);
    const rList = results.filter(r=>r.examId===exam.id).sort((a,b)=>b.score-a.score);
    const notTaken = users.filter(u=>u.class===exam.classId&&u.role==="student"&&!rList.find(r=>r.student===u.username));
    const rows = rList.map((r,i)=>{
      const grade = r.percent>=70?"A":r.percent>=60?"B":r.percent>=50?"C":r.percent>=40?"D":"F";
      const gc    = r.percent>=70?"#16a34a":r.percent>=50?"#b45309":"#dc2626";
      const userRec = users.find(u=>u.username===r.student);
      const matric  = userRec?.matricNumber || "—";
      const displayName = userRec?.displayName || r.student;
      return `<tr style="background:${i%2===0?"#f0f8ff":"white"}">
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;font-weight:bold;">${i+1}</td>
        <td style="padding:8px 12px;border:1px solid #ccc;font-weight:600;">${displayName}<br><span style="font-size:11px;color:#555;font-weight:400;">${r.student}</span></td>
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;font-family:monospace;font-weight:700;color:#0077b6;">${matric}</td>
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;color:#0077b6;font-weight:bold;">${r.score}/${r.total}</td>
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;font-weight:bold;color:${gc}">${r.percent}%</td>
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;font-weight:bold;color:${gc}">${grade}</td>
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;font-size:12px;color:#666">${r.submittedAt?new Date(r.submittedAt).toLocaleString():"-"}</td>
      </tr>`;
    }).join("");
    // "Not yet taken" list with matric numbers
    const notTakenRows = notTaken.map((s,i)=>`<tr style="background:${i%2===0?"#fff8f0":"white"}">
      <td style="padding:6px 12px;border:1px solid #e0c090;text-align:center;color:#b45309;">${i+1}</td>
      <td style="padding:6px 12px;border:1px solid #e0c090;color:#b45309;font-weight:600;">${s.displayName||s.username}<br><span style="font-size:11px;color:#888;font-weight:400;">${s.username}</span></td>
      <td style="padding:6px 12px;border:1px solid #e0c090;text-align:center;font-family:monospace;color:#555;">${s.matricNumber||"—"}</td>
      <td colspan="4" style="padding:6px 12px;border:1px solid #e0c090;color:#b45309;font-size:12px;">⏳ Not submitted</td>
    </tr>`).join("");
    const w = window.open("","_blank","width=980,height=720");
    w.document.write(`<!DOCTYPE html><html><head><title>${exam.title} – Results</title>
    <style>body{font-family:'Times New Roman',serif;padding:32px;color:#000}h1{margin-bottom:4px}p{font-size:13px;color:#555;margin-bottom:20px}
    table{width:100%;border-collapse:collapse}th{background:#0077b6;color:white;padding:10px 12px;border:1px solid #ccc;text-align:left}
    th.center{text-align:center}
    @media print{.no-print{display:none}}</style></head>
    <body>
    <h1>📋 ${exam.title}</h1>
    <p>Class: ${cls?.label||exam.classId} &nbsp;•&nbsp; Subject: ${exam.subject||"—"} &nbsp;•&nbsp; Questions: ${exam.questions.length} &nbsp;•&nbsp; Duration: ${exam.duration} min &nbsp;•&nbsp; Generated: ${new Date().toLocaleString()}</p>
    <button class="no-print" onclick="window.print()" style="margin-bottom:16px;padding:8px 20px;background:#0077b6;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px">🖨️ Print</button>
    <table>
      <thead><tr>
        <th class="center" style="width:40px">#</th>
        <th>Student</th>
        <th class="center" style="width:140px">Matric No.</th>
        <th class="center" style="width:80px">Score</th>
        <th class="center" style="width:60px">%</th>
        <th class="center" style="width:60px">Grade</th>
        <th class="center" style="width:160px">Submitted</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${rList.length===0?"<p style='margin-top:16px;color:#888'>No submissions yet.</p>":""}
    ${notTaken.length>0?`
    <h2 style="margin-top:32px;font-size:15px;color:#b45309;">⏳ Not Yet Taken (${notTaken.length})</h2>
    <table>
      <thead><tr>
        <th class="center" style="width:40px;background:#b45309">#</th>
        <th style="background:#b45309">Student</th>
        <th class="center" style="width:140px;background:#b45309">Matric No.</th>
        <th colspan="4" style="background:#b45309">Status</th>
      </tr></thead>
      <tbody>${notTakenRows}</tbody>
    </table>`:""}
    </body></html>`);
    w.document.close();
  };

  if (loading) return <div style={{textAlign:"center",padding:60,color:"var(--text3)",fontSize:13}}>⏳ Loading CBT exams…</div>;

  // ══════════════════════════════════════════════════════════════════
  // ── COMPOSE VIEW ──────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════
  if (view==="compose") return (
    <div style={{maxWidth:780,margin:"0 auto"}}>
      {/* Top bar */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,flexWrap:"wrap"}}>
        <button className="btn btn-sm" onClick={()=>{setView("list");setForm({...blank});setEditQIdx(null);setSingleQ({q:"",options:["","","",""],ans:0});}}>← Back</button>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:16,color:"var(--accent)"}}>{form.id?"✏️ Edit Exam":"📝 New CBT Exam"}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>Fill in details, add questions, then Save Draft or Publish</div>
        </div>
        {/* Status badge */}
        {form.id&&<span style={{fontSize:11,padding:"3px 10px",borderRadius:20,...(()=>{const s=getStatus(form);return{background:s.bg,color:s.color,fontWeight:700};})()}}>{getStatus(form).label}</span>}
      </div>

      {/* ── Exam meta card ── */}
      <div className="card" style={{marginBottom:14}}>
        <div style={{fontWeight:800,fontSize:13,color:"var(--accent)",marginBottom:12}}>📋 Exam Details</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <div>
            <label className="lbl">Exam Title *</label>
            <input className="inp" style={{marginBottom:0}} value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Mid-Semester Test – Anatomy" />
          </div>
          <div>
            <label className="lbl">Subject / Course</label>
            <input className="inp" style={{marginBottom:0}} value={form.subject} onChange={e=>setForm(f=>({...f,subject:e.target.value}))} placeholder="e.g. Anatomy & Physiology" />
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label className="lbl">Assign to Class *</label>
            <select className="inp" style={{marginBottom:0}} value={form.classId} onChange={e=>setForm(f=>({...f,classId:e.target.value}))}>
              <option value="">— Select class —</option>
              {classes.map(c=><option key={c.id} value={c.id}>{c.label} — {c.desc}</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">Duration (minutes) *</label>
            <input className="inp" style={{marginBottom:0}} type="number" min="5" max="300" value={form.duration} onChange={e=>setForm(f=>({...f,duration:Math.max(1,+e.target.value)}))} />
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}>
          <div>
            <label className="lbl">Start Date & Time</label>
            <input className="inp" style={{marginBottom:0}} type="datetime-local" value={form.startTime||""} onChange={e=>setForm(f=>({...f,startTime:e.target.value}))} />
            <div style={{fontSize:10,color:"var(--text3)",marginTop:3}}>Students cannot open exam before this time</div>
          </div>
          <div>
            <label className="lbl">End Date & Time (Expiry)</label>
            <input className="inp" style={{marginBottom:0}} type="datetime-local" value={form.endTime||""} onChange={e=>setForm(f=>({...f,endTime:e.target.value}))} />
            <div style={{fontSize:10,color:"var(--text3)",marginTop:3}}>Exam becomes inaccessible after this time</div>
          </div>
        </div>
        <div style={{marginTop:10,padding:"10px 12px",borderRadius:9,border:"1px solid var(--border)",background:"var(--bg4)"}}>
          <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
            <div style={{position:"relative",width:40,height:22,flexShrink:0}}>
              <input type="checkbox" style={{opacity:0,position:"absolute",width:"100%",height:"100%",cursor:"pointer"}} checked={!!form.showResultsImmediately} onChange={e=>setForm(f=>({...f,showResultsImmediately:e.target.checked}))} />
              <div style={{position:"absolute",inset:0,borderRadius:11,background:form.showResultsImmediately?"var(--success)":"var(--border)",transition:"background .2s"}} />
              <div style={{position:"absolute",top:3,left:form.showResultsImmediately?20:3,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.25)"}} />
            </div>
            <div>
              <div style={{fontWeight:700,fontSize:13}}>Show Results Immediately After Exam</div>
              <div style={{fontSize:11,color:"var(--text3)"}}>{form.showResultsImmediately?"Students see score & answers right away":"Students only see a submission confirmation — results hidden until lecturer releases"}</div>
            </div>
          </label>
        </div>
      </div>

      {/* ── Anti-Malpractice Settings ── */}
      <div className="card" style={{marginBottom:14,border:"1px solid rgba(239,68,68,.2)"}}>
        <div style={{fontWeight:800,fontSize:13,color:"var(--danger)",marginBottom:12}}>🛡️ Anti-Malpractice Settings</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          {[
            {key:"shuffleQuestions",icon:"🔀",label:"Shuffle Questions",sub:"Different order per student"},
            {key:"shuffleOptions",icon:"🎲",label:"Shuffle Answer Options",sub:"A/B/C/D randomised per student"},
            {key:"fullscreenRequired",icon:"🖥️",label:"Fullscreen Lockdown",sub:"Exit = flagged immediately"},
            {key:"webcamSnapshots",icon:"📸",label:"Webcam Snapshots",sub:"Photo captured on each violation"},
            {key:"deviceLock",icon:"🔒",label:"One Device Per Student",sub:"Block if exam opened elsewhere"},
            {key:"tabSwitchEnabled",icon:"🔄",label:"Tab Switch Detection",sub:"Detect & flag tab/window switching"},
          ].map(({key,icon,label,sub})=>(
            <label key={key} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"10px 12px",borderRadius:9,
              border:`1px solid ${form[key]?"rgba(239,68,68,.3)":"var(--border)"}`,
              background:form[key]?"rgba(239,68,68,.04)":"transparent",transition:"all .2s"}}>
              <div style={{position:"relative",width:40,height:22,flexShrink:0}}>
                <input type="checkbox" style={{opacity:0,position:"absolute",width:"100%",height:"100%",cursor:"pointer"}} checked={!!form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.checked}))} />
                <div style={{position:"absolute",inset:0,borderRadius:11,background:form[key]?"var(--danger)":"var(--border)",transition:"background .2s"}} />
                <div style={{position:"absolute",top:3,left:form[key]?20:3,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.25)"}} />
              </div>
              <div><div style={{fontWeight:700,fontSize:13}}>{icon} {label}</div><div style={{fontSize:11,color:"var(--text3)"}}>{sub}</div></div>
            </label>
          ))}
          <div style={{padding:"10px 12px",borderRadius:9,border:`1px solid ${form.tabSwitchEnabled?"rgba(239,68,68,.3)":"var(--border)"}`,background:form.tabSwitchEnabled?"rgba(239,68,68,.04)":"rgba(128,128,128,.04)",transition:"all .2s"}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:3,color:form.tabSwitchEnabled?"var(--danger)":"var(--text3)"}}>🚨 Tab Switch Limit {!form.tabSwitchEnabled&&<span style={{fontSize:10,fontWeight:600,color:"var(--text3)",marginLeft:6}}>(Tab Detection OFF)</span>}</div>
            {form.tabSwitchEnabled ? (
              <>
                <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>Auto-submit after N switches (0 = warn only)</div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <input type="range" min="0" max="10" value={form.tabSwitchLimit??3}
                    onChange={e=>setForm(f=>({...f,tabSwitchLimit:+e.target.value}))}
                    style={{flex:1,accentColor:"var(--danger)"}} />
                  <span style={{fontWeight:800,fontSize:18,color:"var(--danger)",minWidth:28,textAlign:"center"}}>{form.tabSwitchLimit??3}</span>
                </div>
                <div style={{fontSize:10,color:"var(--text3)",marginTop:4}}>{(form.tabSwitchLimit??3)===0?"Warn only, never auto-submit":`Auto-submit after ${form.tabSwitchLimit} tab switch${form.tabSwitchLimit===1?"":"es"}`}</div>
              </>
            ) : (
              <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>Tab switching is <strong>completely disabled</strong>. Students can freely switch tabs/windows without any flag or penalty.</div>
            )}
          </div>
        </div>
        <div style={{fontSize:11,color:"var(--danger)",background:"rgba(239,68,68,.05)",padding:"7px 10px",borderRadius:7,fontWeight:600}}>
          ⚠️ All violations are logged live and visible to you in the Monitor panel. Flagged students are highlighted in red.
        </div>
      </div>

      {/* ── Questions card ── */}
      <div className="card" style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--accent)"}}>❓ Questions ({form.questions.length})</div>
          <div style={{display:"flex",gap:6}}>
            <button className={`btn btn-sm${inputMode==="single"?" btn-accent":""}`} onClick={()=>{setInputMode("single");setEditQIdx(null);setSingleQ({q:"",options:["","","",""],ans:0});}}>✏️ Single Entry</button>
            <button className={`btn btn-sm${inputMode==="paste"?" btn-purple":""}`} onClick={()=>setInputMode("paste")}>📋 Paste Multiple</button>
          </div>
        </div>

        {/* ── PASTE MODE ── */}
        {inputMode==="paste"&&(
          <div style={{marginBottom:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 220px",gap:10,marginBottom:8}}>
              {/* Questions textarea */}
              <div>
                <div style={{fontSize:11,fontWeight:800,color:"var(--accent)",marginBottom:5}}>
                  📝 Paste Questions
                  <span style={{fontWeight:400,color:"var(--text3)",marginLeft:8}}>Supports: Q:/1./numbered • A:/B: or A)/B) or 1)/2) options • ANS: inline</span>
                </div>
                <textarea
                  className="paste-box"
                  rows={14}
                  style={{width:"100%",fontFamily:"'DM Mono',monospace",fontSize:12}}
                  placeholder={"Q: What is the normal adult temperature?\nA: 35.0°C\nB: 36.1–37.2°C\nC: 38.5°C\nD: 40.0°C\nANS: B\n\n2. Which organ produces insulin?\nA) Liver\nB) Kidney\nC) Pancreas\nD) Spleen\n\n3) Name the largest artery in the body\n1) Femoral artery\n2) Pulmonary artery\n3) Aorta\n4) Carotid artery"}
                  value={pasteQ}
                  onChange={e=>setPasteQ(e.target.value)}
                />
              </div>
              {/* Answers column */}
              <div>
                <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:5}}>
                  ✅ Answers Column
                  <span style={{fontWeight:400,color:"var(--text3)",marginLeft:4}}>(optional if ANS: inline)</span>
                </div>
                <textarea
                  className="paste-box"
                  rows={14}
                  style={{width:"100%",fontFamily:"'DM Mono',monospace",fontSize:13,borderColor:"rgba(34,197,94,.3)"}}
                  placeholder={"B\nC\nA\n...\none letter per question"}
                  value={pasteA}
                  onChange={e=>setPasteA(e.target.value)}
                />
              </div>
            </div>

            {/* Live parse feedback */}
            {pasteQ.trim()&&(
              <div style={{marginBottom:8,padding:"8px 12px",borderRadius:8,fontSize:12,fontWeight:700,
                background:parsed.length?"rgba(34,197,94,.08)":"rgba(251,146,60,.08)",
                border:`1px solid ${parsed.length?"rgba(34,197,94,.25)":"rgba(251,146,60,.3)"}`,
                color:parsed.length?"var(--success)":"var(--warn)"}}>
                {parseMsg}
              </div>
            )}

            {/* Parsed preview */}
            {parsed.length>0&&(
              <div style={{border:"1px solid rgba(34,197,94,.25)",borderRadius:10,overflow:"hidden",marginBottom:10}}>
                <div style={{padding:"8px 14px",background:"rgba(34,197,94,.07)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontWeight:800,fontSize:12,color:"var(--success)"}}>Preview — {parsed.length} question{parsed.length>1?"s":""}</span>
                  <button className="btn btn-success btn-sm" onClick={importParsed}>✅ Import All {parsed.length}</button>
                </div>
                <div style={{maxHeight:260,overflowY:"auto"}}>
                  {parsed.map((p,i)=>(
                    <div key={i} style={{padding:"8px 14px",borderTop:"1px solid var(--border)",display:"flex",gap:10,alignItems:"flex-start"}}>
                      <div style={{width:22,height:22,borderRadius:6,background:"rgba(0,119,182,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"var(--accent)",flexShrink:0}}>{i+1}</div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:700,fontSize:12,marginBottom:4}}>{p.q}</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                          {p.options.filter(o=>o).map((opt,oi)=>(
                            <span key={oi} style={{fontSize:11,padding:"2px 7px",borderRadius:5,
                              background:oi===p.ans?"rgba(34,197,94,.12)":"transparent",
                              border:`1px solid ${oi===p.ans?"var(--success)":"var(--border)"}`,
                              color:oi===p.ans?"var(--success)":"var(--text3)",fontWeight:oi===p.ans?800:400
                            }}>{"ABCD"[oi]}. {opt}{oi===p.ans?" ✓":""}</span>
                          ))}
                        </div>
                        {!p._hasAns&&<div style={{fontSize:10,color:"var(--warn)",marginTop:3}}>⚠️ No answer detected — will default to A</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SINGLE ENTRY MODE ── */}
        {inputMode==="single"&&(
          <div id="cbt-q-input" style={{background:"var(--bg4)",borderRadius:10,padding:14,border:"1px solid var(--border)",marginBottom:12}}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:10,color:"var(--accent)"}}>{editQIdx!==null?`✏️ Editing Question ${editQIdx+1}`:"➕ Add a Question"}</div>
            <label className="lbl">Question Text *</label>
            <textarea className="inp" rows={2} style={{resize:"vertical",marginBottom:10}} value={singleQ.q}
              onChange={e=>setSingleQ(s=>({...s,q:e.target.value}))}
              placeholder="Type the question here…" />
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
              {["A","B","C","D"].map((l,i)=>(
                <div key={i}>
                  <label className="lbl">Option {l}{i<2?" *":""}</label>
                  <input className="inp" style={{marginBottom:0}} value={singleQ.options[i]}
                    onChange={e=>setSingleQ(s=>{const opts=[...s.options];opts[i]=e.target.value;return{...s,options:opts};})}
                    placeholder={`Enter option ${l}`} />
                </div>
              ))}
            </div>
            <label className="lbl">Correct Answer *</label>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              {["A","B","C","D"].map((l,i)=>(
                <button key={i} onClick={()=>setSingleQ(s=>({...s,ans:i}))} className="btn btn-sm"
                  style={{flex:1,borderColor:singleQ.ans===i?"var(--success)":"var(--border)",
                    background:singleQ.ans===i?"rgba(34,197,94,.12)":"transparent",
                    color:singleQ.ans===i?"var(--success)":"var(--text3)",fontWeight:singleQ.ans===i?800:400}}>
                  {l}{singleQ.ans===i?" ✓":""}
                </button>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-accent" onClick={addSingleQ}>{editQIdx!==null?"💾 Update Question":"➕ Add to Exam"}</button>
              {editQIdx!==null&&<button className="btn" onClick={()=>{setEditQIdx(null);setSingleQ({q:"",options:["","","",""],ans:0});}}>✕ Cancel Edit</button>}
            </div>
          </div>
        )}

        {/* ── Question list ── */}
        {form.questions.length===0
          ? <div style={{textAlign:"center",padding:"28px 20px",color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:10}}>
              No questions added yet. Use Single Entry above or Paste Multiple.
            </div>
          : <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--text2)"}}>📋 {form.questions.length} Question{form.questions.length!==1?"s":""} Added</div>
                <button className="btn btn-sm btn-danger" onClick={()=>{if(confirm("Remove ALL questions?"))setForm(f=>({...f,questions:[]}));}}>🗑️ Clear All</button>
              </div>
              {form.questions.map((q,i)=>(
                <div key={i} className="card2" style={{marginBottom:7,borderLeft:`3px solid ${editQIdx===i?"var(--accent)":"var(--border)"}`}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{width:24,height:24,borderRadius:7,background:"rgba(0,119,182,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"var(--accent)",flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13,marginBottom:5,lineHeight:1.4}}>{q.q}</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {q.options.filter(o=>o).map((opt,oi)=>(
                          <span key={oi} style={{fontSize:11,padding:"2px 8px",borderRadius:5,
                            background:oi===q.ans?"rgba(34,197,94,.12)":"transparent",
                            border:`1px solid ${oi===q.ans?"var(--success)":"var(--border)"}`,
                            color:oi===q.ans?"var(--success)":"var(--text3)",fontWeight:oi===q.ans?800:400
                          }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:4,flexShrink:0}}>
                      <button className="btn btn-sm" title="Edit" onClick={()=>editQ(i)}>✏️</button>
                      <button className="btn btn-sm btn-danger" title="Delete" onClick={()=>deleteQ(i)}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </>
        }
      </div>

      {/* ── Save / Publish buttons ── */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",padding:"14px 0"}}>
        <button className="btn" style={{flex:"1 1 160px",borderColor:"var(--accent2)",color:"var(--accent2)"}}
          onClick={saveDraft} disabled={saving||publishing}>
          {saving?"⏳ Saving…":"💾 Save as Draft"}
        </button>
        <button className="btn btn-success" style={{flex:"2 1 220px",fontWeight:800,fontSize:15}}
          onClick={saveAndPublish} disabled={saving||publishing}>
          {publishing?"🚀 Publishing…":"🚀 Save & Publish Exam"}
        </button>
        <button className="btn" onClick={()=>{setView("list");setForm({...blank});setEditQIdx(null);setSingleQ({q:"",options:["","","",""],ans:0});}}>✕ Cancel</button>
      </div>
      <div style={{fontSize:11,color:"var(--text3)",textAlign:"center",paddingBottom:8}}>
        Drafts are saved but invisible to students • Published exams auto-archive after 24 hours
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════
  // ── MONITOR VIEW ──────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════
  if (view==="monitor" && selExam) {
    const examResults    = results.filter(r=>r.examId===selExam.id).sort((a,b)=>b.score-a.score);
    const studentsInClass = users.filter(u=>u.class===selExam.classId&&u.role==="student");
    const notYetTaken    = studentsInClass.filter(s=>!examResults.find(r=>r.student===s.username));
    const avgPct         = examResults.length ? Math.round(examResults.reduce((s,r)=>s+r.percent,0)/examResults.length) : null;
    const archived       = isArchived(selExam);
    const status         = getStatus(selExam);

    return (
      <div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
          <button className="btn btn-sm" onClick={()=>{setView("list");setSelExam(null);}}>← Back</button>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:16}}>{selExam.title}</div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
              {classes.find(c=>c.id===selExam.classId)?.label} • {selExam.questions.length}Q • {selExam.duration}min
              {selExam.publishedAt&&<span style={{marginLeft:8}}>Published: {new Date(selExam.publishedAt).toLocaleString()}</span>}
              {selExam.startTime&&<span style={{marginLeft:8,color:"var(--accent)"}}>Start: {new Date(selExam.startTime).toLocaleString()}</span>}
              {selExam.endTime&&<span style={{marginLeft:8,color:"var(--warn)"}}>Expires: {new Date(selExam.endTime).toLocaleString()}</span>}
            </div>
          </div>
          <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:status.bg,color:status.color,fontWeight:700}}>{status.label}</span>
          <button className="btn btn-sm" style={{borderColor:"var(--accent)",color:"var(--accent)"}} onClick={()=>printResults(selExam)}>🖨️ Print Results</button>
          <button className="btn btn-sm" onClick={()=>{setForm({...selExam});setView("compose");}}>✏️ Edit</button>
        </div>

        {/* Summary stats */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:16}}>
          {[
            {icon:"👨🎓",label:"Enrolled",    val:studentsInClass.length,    color:"var(--accent)"},
            {icon:"✅",label:"Submitted",    val:examResults.length,         color:"var(--success)"},
            {icon:"⏳",label:"Pending",      val:notYetTaken.length,         color:"var(--warn)"},
            {icon:"📊",label:"Avg Score",    val:avgPct!==null?avgPct+"%":"—", color:"var(--purple)"},
            {icon:"🏆",label:"Highest",      val:examResults[0]?.percent!==undefined?examResults[0].percent+"%":"—", color:"gold"},
          ].map((s,i)=>(
            <div key={i} className="card" style={{textAlign:"center",padding:"12px 8px",borderTop:`3px solid ${s.color}`}}>
              <div style={{fontSize:22,marginBottom:3}}>{s.icon}</div>
              <div style={{fontWeight:800,fontSize:18,color:s.color}}>{s.val}</div>
              <div style={{fontSize:10,color:"var(--text3)"}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Live sync badge */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,padding:"7px 14px",background:"rgba(34,197,94,.06)",border:"1px solid rgba(34,197,94,.2)",borderRadius:10}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:"var(--success)",boxShadow:"0 0 6px var(--success)"}} />
          <span style={{fontSize:12,fontWeight:700,color:"var(--success)"}}>Live — syncs every 6 seconds across all devices</span>
          {archived&&<span style={{marginLeft:"auto",fontSize:11,color:"var(--warn)",fontWeight:700}}>🗄️ Archived — students in Read-Only Review Mode</span>}
        </div>

        {/* Results table */}
        {examResults.length===0
          ? <div className="card" style={{textAlign:"center",padding:"48px 20px",color:"var(--text3)"}}>
              <div style={{fontSize:44,marginBottom:10}}>📋</div>
              <div style={{fontWeight:700}}>No submissions yet</div>
              <div style={{fontSize:12,marginTop:4}}>Results appear here as students complete the exam.</div>
            </div>
          : <div className="card" style={{padding:0,overflow:"hidden",marginBottom:14}}>
              <div style={{padding:"10px 16px",background:"var(--bg4)",fontWeight:800,fontSize:13,borderBottom:"1px solid var(--border)"}}>
                🏆 Results Ranked by Score
              </div>
              <div style={{overflowX:"auto"}}>
                <table className="tbl">
                  <thead><tr>
                    <th style={{width:44}}>#</th>
                    <th>Student</th>
                    <th>Score</th>
                    <th style={{minWidth:160}}>Progress</th>
                    <th>Grade</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr></thead>
                  <tbody>
                    {examResults.map((r,i)=>{
                      const grade  = r.percent>=70?"A":r.percent>=60?"B":r.percent>=50?"C":r.percent>=40?"D":"F";
                      const gColor = r.percent>=70?"var(--success)":r.percent>=50?"var(--warn)":"var(--danger)";
                      return (
                        <tr key={r.student} style={{background:i===0?"rgba(34,197,94,.03)":""}}>
                          <td style={{textAlign:"center",fontWeight:800,fontSize:15,color:i===0?"#f59e0b":i===1?"#94a3b8":i===2?"#b45309":"var(--text3)"}}>
                            {i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
                          </td>
                          <td style={{fontWeight:600,fontSize:13}}>
                            {r.student}
                            {violations.filter(v=>v.examId===selExam.id&&v.student===r.student).length>0&&(
                              <span title="Violations recorded" style={{marginLeft:6,fontSize:10,padding:"1px 6px",borderRadius:10,background:"rgba(239,68,68,.12)",color:"var(--danger)",fontWeight:700}}>
                                🚨 {violations.filter(v=>v.examId===selExam.id&&v.student===r.student).length} flag{violations.filter(v=>v.examId===selExam.id&&v.student===r.student).length>1?"s":""}
                              </span>
                            )}
                          </td>
                          <td style={{fontWeight:700,color:"var(--accent)",fontSize:14}}>{r.score}/{r.total}</td>
                          <td>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <div style={{flex:1,height:7,borderRadius:4,background:"var(--bg3)",overflow:"hidden",minWidth:70}}>
                                <div style={{height:"100%",width:`${r.percent}%`,background:gColor,borderRadius:4,transition:"width .6s"}} />
                              </div>
                              <span style={{fontWeight:800,color:gColor,fontSize:12,minWidth:38}}>{r.percent}%</span>
                            </div>
                          </td>
                          <td><span style={{fontWeight:800,fontSize:14,color:gColor}}>{grade}</span></td>
                          <td style={{fontSize:11,color:"var(--text3)"}}>{r.submittedAt?new Date(r.submittedAt).toLocaleString():"-"}</td>
                          <td><button className="btn btn-sm" title="Allow this student to retake" onClick={()=>allowRetake(selExam.id,r.student)}>🔄 Retake</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
        }

        {/* Not-yet-taken */}
        {notYetTaken.length>0&&(
          <div className="card" style={{borderLeft:"3px solid var(--warn)"}}>
            <div style={{fontWeight:800,fontSize:13,color:"var(--warn)",marginBottom:8}}>⏳ Haven't Taken Exam ({notYetTaken.length})</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
              {notYetTaken.map(s=>(
                <span key={s.username} style={{fontSize:12,padding:"3px 10px",borderRadius:20,
                  background:"rgba(251,146,60,.1)",border:"1px solid rgba(251,146,60,.25)",color:"var(--warn)"}}>
                  {s.username}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Violations log ── */}
        {(()=>{
          const examViolations = violations.filter(v=>v.examId===selExam.id).sort((a,b)=>b.ts-a.ts);
          if (examViolations.length===0) return (
            <div className="card" style={{borderLeft:"3px solid var(--success)",marginTop:14}}>
              <div style={{fontWeight:700,fontSize:13,color:"var(--success)"}}>✅ No violations recorded</div>
              <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>All students have been well-behaved so far.</div>
            </div>
          );
          const byStudent = {};
          examViolations.forEach(v=>{
            if(!byStudent[v.student])byStudent[v.student]=[];
            byStudent[v.student].push(v);
          });
          return (
            <div style={{marginTop:14}}>
              <div style={{fontWeight:800,fontSize:13,color:"var(--danger)",marginBottom:8}}>🚨 Violation Log ({examViolations.length} events)</div>
              {Object.entries(byStudent).map(([student,vList])=>{
                const tabCount  = vList.filter(v=>v.type==="tab_switch").length;
                const fsCount   = vList.filter(v=>v.type==="fullscreen_exit").length;
                const autoSub   = vList.some(v=>v.type==="auto_submitted");
                const dupDevice = vList.some(v=>v.type==="duplicate_device");
                const snapshots = vList.filter(v=>v.snapshot&&v.snapshot.length>200);
                const devInfo   = vList.find(v=>v.deviceInfo)?.deviceInfo;
                return (
                  <div key={student} className="card" style={{marginBottom:10,borderLeft:`3px solid ${autoSub||dupDevice?"var(--danger)":"var(--warn)"}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:8}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13,marginBottom:3}}>{student}</div>
                        {devInfo&&<div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>
                          🌐 {devInfo.ip||"unknown IP"} • {devInfo.ua?.slice(0,60)||"unknown UA"}
                        </div>}
                      </div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {tabCount>0&&<span style={{fontSize:11,padding:"2px 8px",borderRadius:12,background:"rgba(239,68,68,.1)",color:"var(--danger)",fontWeight:700}}>🔄 {tabCount} tab switch{tabCount>1?"es":""}</span>}
                        {fsCount>0&&<span style={{fontSize:11,padding:"2px 8px",borderRadius:12,background:"rgba(251,146,60,.1)",color:"var(--warn)",fontWeight:700}}>🖥️ {fsCount} fullscreen exit{fsCount>1?"s":""}</span>}
                        {dupDevice&&<span style={{fontSize:11,padding:"2px 8px",borderRadius:12,background:"rgba(239,68,68,.15)",color:"var(--danger)",fontWeight:800}}>🔒 MULTI-DEVICE</span>}
                        {autoSub&&<span style={{fontSize:11,padding:"2px 8px",borderRadius:12,background:"rgba(239,68,68,.15)",color:"var(--danger)",fontWeight:800}}>⚡ AUTO-SUBMITTED</span>}
                        {snapshots.length>0&&<span style={{fontSize:11,padding:"2px 8px",borderRadius:12,background:"rgba(168,85,247,.1)",color:"var(--purple)",fontWeight:700}}>📸 {snapshots.length} photo{snapshots.length>1?"s":""}</span>}
                      </div>
                    </div>

                    {/* Webcam snapshots strip */}
                    {snapshots.length>0&&(
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10,padding:"8px",background:"rgba(168,85,247,.05)",borderRadius:8,border:"1px solid rgba(168,85,247,.15)"}}>
                        <div style={{width:"100%",fontSize:11,fontWeight:700,color:"var(--purple)",marginBottom:4}}>📸 Webcam Snapshots — Captured on violations</div>
                        {snapshots.map((v,si)=>(
                          <div key={si} style={{position:"relative"}}>
                            <img src={v.snapshot} alt="snapshot"
                              style={{width:90,height:68,objectFit:"cover",borderRadius:6,border:"2px solid rgba(168,85,247,.3)",cursor:"pointer"}}
                              onClick={()=>window.open(v.snapshot,"_blank")}
                              title={`${v.type} • ${new Date(v.ts).toLocaleTimeString()}`}
                            />
                            <div style={{position:"absolute",bottom:2,left:2,right:2,fontSize:9,
                              background:"rgba(0,0,0,.65)",color:"white",borderRadius:3,padding:"1px 3px",textAlign:"center"}}>
                              {v.type==="tab_switch"?"Tab":v.type==="page_leave"?"Left":v.type==="fullscreen_exit"?"FS exit":"Flag"} {new Date(v.ts).toLocaleTimeString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Event timeline */}
                    <div style={{maxHeight:110,overflowY:"auto"}}>
                      {vList.map((v,i)=>(
                        <div key={i} style={{fontSize:11,color:"var(--text3)",padding:"2px 0",display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{color:v.type==="auto_submitted"||v.type==="duplicate_device"?"var(--danger)":v.type==="tab_switch"||v.type==="page_leave"?"var(--warn)":v.type==="screenshot_attempt"?"var(--purple)":"var(--accent)",fontWeight:700}}>
                            {v.type==="tab_switch"?"🔄 Tab switch":v.type==="page_leave"?"🚪 Page left (auto-submitted)":v.type==="fullscreen_exit"?"🖥️ Fullscreen exit":v.type==="auto_submitted"?`⚡ Auto-submitted${v.reason?" ("+v.reason+")":""}`:v.type==="duplicate_device"?"🔒 Duplicate device":v.type==="screenshot_attempt"?"📷 Screenshot attempt":"⚠️ "+v.type}
                            {v.penaltyApplied&&<span style={{color:"var(--warn)",marginLeft:4}}>−{v.penaltyApplied}pt</span>}
                          </span>
                          {v.hasSnapshot&&<span style={{fontSize:9,color:"var(--purple)"}}>📸</span>}
                          <span style={{marginLeft:"auto",fontFamily:"'DM Mono',monospace"}}>{new Date(v.ts).toLocaleTimeString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // ── LIST VIEW (default) ───────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════
  const liveExams     = exams.filter(e=>e.published&&!isArchived(e));
  const archivedExams = exams.filter(e=>isArchived(e));
  const draftExams    = exams.filter(e=>!e.published);

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div className="sec-title" style={{marginBottom:0}}>📝 CBT Exam Manager</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>Create, publish and monitor Computer-Based Tests.</div>
        </div>
        <button className="btn btn-accent" onClick={()=>{setForm({...blank});setEditQIdx(null);setSingleQ({q:"",options:["","","",""],ans:0});setView("compose");}}>+ New Exam</button>
      </div>

      {exams.length===0&&(
        <div style={{textAlign:"center",padding:"70px 20px",color:"var(--text3)"}}>
          <div style={{fontSize:52,marginBottom:12}}>📝</div>
          <div style={{fontWeight:700,marginBottom:6}}>No exams yet</div>
          <div style={{fontSize:12}}>Click "New Exam" to create your first CBT.</div>
        </div>
      )}

      {/* Live exams */}
      {liveExams.length>0&&(
        <div style={{marginBottom:20}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--success)",marginBottom:8}}>✅ Live Exams ({liveExams.length})</div>
          {liveExams.map(e=>_examCard(e))}
        </div>
      )}

      {/* Draft exams */}
      {draftExams.length>0&&(
        <div style={{marginBottom:20}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--text3)",marginBottom:8}}>📋 Drafts ({draftExams.length})</div>
          {draftExams.map(e=>_examCard(e))}
        </div>
      )}

      {/* Archived exams */}
      {archivedExams.length>0&&(
        <div>
          <div style={{fontWeight:800,fontSize:13,color:"var(--warn)",marginBottom:8}}>🗄️ Archived ({archivedExams.length}) — Read-Only for students</div>
          {archivedExams.map(e=>_examCard(e))}
        </div>
      )}
    </div>
  );

  // ── Exam card renderer (DRY helper) ──
  function _examCard(e) {
    const status    = getStatus(e);
    const submitted = results.filter(r=>r.examId===e.id).length;
    const cls       = classes.find(c=>c.id===e.classId);
    return (
      <div key={e.id} className="card" style={{marginBottom:10,borderLeft:`4px solid ${status.color}`}}>
        <div style={{display:"flex",gap:10,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:180}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
              <div style={{fontWeight:800,fontSize:15}}>{e.title}</div>
              <span style={{fontSize:10,padding:"2px 8px",borderRadius:12,background:status.bg,color:status.color,fontWeight:700}}>{status.label}</span>
            </div>
            {e.subject&&<div style={{fontSize:12,color:"var(--text3)",marginBottom:3}}>📚 {e.subject}</div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:10,fontSize:11,color:"var(--text3)"}}>
              <span>🏫 {cls?.label||e.classId||"—"}</span>
              <span>❓ {e.questions.length}Q</span>
              <span>⏱ {e.duration}min</span>
              <span>✅ {submitted} submitted</span>
              {e.publishedAt&&<span>📅 {new Date(e.publishedAt).toLocaleDateString()}</span>}
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end",alignItems:"center"}}>
            <button className="btn btn-sm" onClick={()=>{setSelExam(e);setView("monitor");}}>👁 Monitor</button>
            <button className="btn btn-sm" onClick={()=>{setForm({...e});setEditQIdx(null);setSingleQ({q:"",options:["","","",""],ans:0});setView("compose");}}>✏️ Edit</button>
            {e.published
              ? <button className="btn btn-sm" style={{borderColor:"var(--warn)",color:"var(--warn)"}} onClick={()=>togglePublish(e.id,false)}>📤 Unpublish</button>
              : <button className="btn btn-sm btn-success" onClick={()=>togglePublish(e.id,true)}>🚀 Publish</button>
            }
            <button className="btn btn-sm btn-danger" onClick={()=>deleteExam(e.id)}>🗑️</button>
          </div>
        </div>
      </div>
    );
  }
}

// ── Student: CBT Exam View ─────────────────────────────────────────────
// ── Student: CBT Exam View (with anti-malpractice) ───────────────────

export function CbtStudentView({ toast, currentUser }) {
  const [exams,   setExams]   = useState([]);
  const [results, setResults] = useState([]);
  const [mode,    setMode]    = useState("list"); // list | preflight | camsetup | taking | done | review
  const [activeExam,  setActiveExam]  = useState(null);
  const [shuffledQs,  setShuffledQs]  = useState([]);
  const [answers,     setAnswers]     = useState([]);
  const [qIdx,        setQIdx]        = useState(0);
  const [timeLeft,    setTimeLeft]    = useState(0);
  const [myResult,    setMyResult]    = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [genuineFullscreenExit, setGenuineFullscreenExit] = useState(false);
  const [overlayActive,    setOverlayActive]    = useState(false);  // app-on-top overlay
  const [overlayCountdown, setOverlayCountdown] = useState(5);      // 5-4-3-2-1 countdown
  const [tabSwitches,      setTabSwitches]      = useState(0);
  const [violations,       setViolations]       = useState([]);
  const [warningMsg,       setWarningMsg]       = useState("");
  const [showWarning,      setShowWarning]      = useState(false);
  const [penaltyDeductions,setPenaltyDeductions]= useState(0); // 0.5 per non-tab violation
  const [examSubmitted,    setExamSubmitted]    = useState(false); // prevent double-submit
  const [rulesAccepted,    setRulesAccepted]    = useState(false); // rules checkbox on preflight
  // Webcam
  const [camStream,    setCamStream]    = useState(null);
  const [camAllowed,   setCamAllowed]   = useState(null); // null=unknown, true, false
  const [camError,     setCamError]     = useState("");
  const [lastSnapshot, setLastSnapshot] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  // Device lock
  const [deviceBlocked, setDeviceBlocked] = useState(false);
  const [deviceBlockMsg, setDeviceBlockMsg] = useState("");
  // Review mode answer reveal
  const [showAns, setShowAns] = useState({});

  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const myUser  = ls("nv-users",[]).find(u=>u.username===currentUser);
  const myClass = myUser?.class;

  useEffect(() => {
    const u1 = subscribeCbtExams(list => { setExams(list); setLoading(false); });
    const u2 = subscribeCbtResults(list => setResults(list));
    return () => { u1(); u2(); };
  }, []);

  // Cleanup camera on unmount or when not taking
  useEffect(() => {
    if (mode!=="taking"&&mode!=="camsetup") {
      if (camStream) { camStream.getTracks().forEach(t=>t.stop()); setCamStream(null); }
    }
  }, [mode]);

  // Attach stream to video element
  useEffect(() => {
    if (camStream && videoRef.current) {
      videoRef.current.srcObject = camStream;
      videoRef.current.play().catch(()=>{});
    }
  }, [camStream, videoRef.current]);

  // ── Build device fingerprint ──
  const getDeviceFingerprint = async () => {
    const nav = window.navigator;
    const fp  = [nav.userAgent, nav.language, screen.width+"x"+screen.height, screen.colorDepth, nav.hardwareConcurrency, Intl.DateTimeFormat().resolvedOptions().timeZone].join("|");
    // Simple hash
    let hash = 0;
    for (let i=0;i<fp.length;i++) hash = ((hash<<5)-hash)+fp.charCodeAt(i)|0;
    // Try to get public IP via free service
    let ip = "unknown";
    try { const r = await fetch("https://api.ipify.org?format=json"); const d = await r.json(); ip = d.ip||"unknown"; } catch(e){}
    return { fingerprint: Math.abs(hash).toString(16), ip, ua: nav.userAgent.slice(0,120), screen:`${screen.width}x${screen.height}` };
  };

  // ── Register device for this exam, block if another device already registered ──
  const checkDeviceLock = async (exam) => {
    if (!exam.deviceLock) return { allowed: true };
    try {
      const devInfo = await getDeviceFingerprint();
      const devMap  = await cbtDevicesGet();
      const key     = `${exam.id}__${currentUser}`;
      const existing = devMap[key];
      if (existing && existing.fingerprint !== devInfo.fingerprint) {
        return { allowed: false, reason: `This exam was already started on another device (${existing.ip}). Contact your lecturer to reset.`, devInfo };
      }
      // Register this device
      devMap[key] = { ...devInfo, student:currentUser, examId:exam.id, ts:Date.now() };
      await cbtDevicesSave(devMap);
      return { allowed: true, devInfo };
    } catch(e) {
      return { allowed: true, devInfo: null }; // fail open if network issues
    }
  };

  // ── Request webcam access ──
  const requestCam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ width:320, height:240, facingMode:"user" }, audio:false });
      setCamStream(stream);
      setCamAllowed(true);
      setCamError("");
      return stream;
    } catch(e) {
      setCamAllowed(false);
      setCamError(e.name==="NotAllowedError"?"Camera permission denied. You can still take the exam but all violations will be flagged without photo evidence.":"Camera not available: "+e.message);
      return null;
    }
  };

  // ── Capture snapshot from video feed ──
  const captureSnapshot = (stream) => {
    try {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!video||!canvas) return null;
      canvas.width=160; canvas.height=120;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video,0,0,160,120);
      const dataUrl = canvas.toDataURL("image/jpeg",0.6);
      setLastSnapshot(dataUrl);
      return dataUrl;
    } catch(e){ return null; }
  };

  // ── Countdown timer ──
  useEffect(() => {
    if (mode!=="taking") return;
    if (timeLeft<=0) { doSubmit("timeout"); return; }
    const t = setTimeout(()=>setTimeLeft(s=>s-1), 1000);
    return ()=>clearTimeout(t);
  }, [mode, timeLeft]);

  // ── Fisher-Yates shuffle with seed so same student gets same order on refresh ──
  const seededShuffle = useCallback((arr, seed) => {
    const a = [...arr];
    let s = seed;
    for (let i=a.length-1; i>0; i--) {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      const j = Math.abs(s) % (i+1);
      [a[i],a[j]] = [a[j],a[i]];
    }
    return a;
  }, []);

  // Build per-student shuffled question+option order (deterministic per student+exam)
  const buildShuffled = useCallback((exam) => {
    const seed = exam.id + currentUser.split("").reduce((s,c)=>s+c.charCodeAt(0),0);
    const qOrder = exam.shuffleQuestions ? seededShuffle(exam.questions.map((_,i)=>i), seed) : exam.questions.map((_,i)=>i);
    const optOrders = exam.questions.map((_,qi) => {
      if (!exam.shuffleOptions) return [0,1,2,3].filter(i=>exam.questions[qi].options[i]);
      return seededShuffle([0,1,2,3].filter(i=>exam.questions[qi].options[i]), seed+qi*7);
    });
    return qOrder.map(origQIdx => ({
      origQIdx,
      q: exam.questions[origQIdx].q,
      displayOptions: optOrders[origQIdx].map(origOptIdx => ({
        origOptIdx, text: exam.questions[origQIdx].options[origOptIdx]
      })),
      origAns: exam.questions[origQIdx].ans,
    }));
  }, [currentUser, seededShuffle]);

  // ── Fullscreen handling ──────────────────────────────────────────────
  //
  // iPhone / iOS Safari IMPORTANT NOTE:
  //   iOS Safari does NOT support the standard Fullscreen API.
  //   document.fullscreenElement and webkitFullscreenElement are ALWAYS null
  //   on iPhone, so we cannot use fullscreenchange events to detect exits.
  //
  // What we do instead:
  //   • On desktop (Chrome/Firefox/Edge): use fullscreenchange events with a
  //     1500ms grace period — if fullscreen comes back within 1500ms it was
  //     just a system interruption (notification, dialog), not a real exit.
  //
  //   • On iPhone/iOS Safari: the Fullscreen API is unavailable, so we track
  //     "foreground presence" via visibilitychange instead. A GENUINE exit
  //     means the student floated another app on top or left the browser —
  //     the page becomes hidden AND stays hidden. A notification or pull-down
  //     shade hides the page briefly then restores it. We use a 2000ms
  //     window: if the page comes back visible within 2000ms → just a
  //     notification/shade pull → no violation. If still hidden after 2000ms
  //     → genuine overlay/exit → flag it.
  //     We do NOT fire a second violation here if tabSwitchEnabled is also ON
  //     (that handler already covers the hide→show cycle separately).
  //
  // Result: notifications and shade-pulls on iPhone NEVER trigger a
  // fullscreen violation. Only genuine app-overlay or browser-exit does.

  // Detect iPhone/iOS Safari (no Fullscreen API support)
  const _isIOS = typeof window !== "undefined" && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
  const _supportsFullscreenAPI = !_isIOS && !!(
    document.documentElement.requestFullscreen ||
    document.documentElement.webkitRequestFullscreen
  );

  const enterFullscreen = () => {
    if (_supportsFullscreenAPI) {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(()=>{});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
    // On iOS: we can't force fullscreen, but we set isFullscreen=true
    // so the UI reflects that the exam has started in full-focus mode.
    setIsFullscreen(true);
    setGenuineFullscreenExit(false); // clear the re-enter banner
  };
  const exitFullscreen = () => {
    if (_supportsFullscreenAPI) {
      if (document.exitFullscreen) document.exitFullscreen().catch(()=>{});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
    setIsFullscreen(false);
  };

  // ── Desktop fullscreen detection (Fullscreen API) ──────────────────
  useEffect(() => {
    if (!_supportsFullscreenAPI) return; // iOS handles this differently below
    if (mode !== "taking") return;

    let fsEnteredAt  = 0;
    let fsExitTimer  = null;
    let exitPending  = false;

    const onFsChange = () => {
      const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(inFs);

      if (inFs) {
        // Fullscreen entered (or restored) — cancel any pending violation
        fsEnteredAt = Date.now();
        exitPending = false;
        if (fsExitTimer) { clearTimeout(fsExitTimer); fsExitTimer = null; }
        setGenuineFullscreenExit(false); // clear the banner
        return;
      }

      if (mode !== "taking") return;
      if (!activeExam?.fullscreenRequired) return;
      // Must have been genuinely in fullscreen for at least 3s first
      if (Date.now() - fsEnteredAt < 3000) return;

      // Start grace window — notifications & dialogs restore fullscreen within ~800ms.
      // Only flag if fullscreen is still gone after 1500ms.
      exitPending = true;
      fsExitTimer = setTimeout(() => {
        const stillOut = !(document.fullscreenElement || document.webkitFullscreenElement);
        if (stillOut && exitPending) {
          exitPending = false;
          _showOverlay(); // show ☢️ overlay with countdown instead of instant flag
        }
        fsExitTimer = null;
      }, 1500);
    };

    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      if (fsExitTimer) clearTimeout(fsExitTimer);
    };
  }, [mode, activeExam]);

  // ── App-overlay / fullscreen-exit detection (all platforms) ─────────
  //
  // On Android & Desktop with Fullscreen API: handled above via fullscreenchange.
  // On iPhone (no Fullscreen API): we use visibilitychange.
  //
  // Behavior when a floated app is detected:
  //   1. Grace window: 1500ms silence after page hides — filters notifications
  //      and shade pulls which restore visibility almost immediately.
  //   2. After 1500ms if still hidden → show the ☢️ WARNING OVERLAY with a
  //      5-second countdown alarm.
  //   3. If the student dismisses the floated app and returns (page becomes
  //      visible again) BEFORE the countdown reaches 0 → overlay dismissed,
  //      violation still logged but NO auto-submit.
  //   4. If countdown reaches 0 → auto-submit the exam.
  //
  // The overlay + countdown is managed by overlayActive / overlayCountdown state.
  // The alarm sound is generated with the Web Audio API (no external files needed).

  const _iosHiddenAt       = useRef(0);
  const _overlayGraceTimer = useRef(null); // 1500ms grace before overlay appears
  const _overlayCountTimer = useRef(null); // interval for the 5-4-3-2-1 countdown
  const _overlayCountRef   = useRef(5);    // ref mirror of overlayCountdown (avoids stale closure)
  const _alarmCtx          = useRef(null); // Web Audio context for alarm

  // ── Alarm beep helper ─────────────────────────────────────────────
  const _startAlarm = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      _alarmCtx.current = ctx;
      const beep = () => {
        if (!_alarmCtx.current) return;
        try {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type      = "square";
          osc.frequency.setValueAtTime(880, ctx.currentTime);          // high beep
          osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);   // low tone
          gain.gain.setValueAtTime(0.35, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.4);
        } catch(e) {}
      };
      // Beep immediately then every 800ms
      beep();
      const id = setInterval(beep, 800);
      _alarmCtx.current._beepInterval = id;
    } catch(e) {}
  };
  const _stopAlarm = () => {
    try {
      if (_alarmCtx.current?._beepInterval) {
        clearInterval(_alarmCtx.current._beepInterval);
      }
      if (_alarmCtx.current) {
        _alarmCtx.current.close().catch(()=>{});
        _alarmCtx.current = null;
      }
    } catch(e) {}
  };

  // ── Show the overlay with countdown ───────────────────────────────
  const _showOverlay = () => {
    _overlayCountRef.current = 5;
    setOverlayCountdown(5);
    setOverlayActive(true);
    setGenuineFullscreenExit(true);
    _startAlarm();
    // Tick every second
    _overlayCountTimer.current = setInterval(() => {
      _overlayCountRef.current -= 1;
      setOverlayCountdown(_overlayCountRef.current);
      if (_overlayCountRef.current <= 0) {
        _dismissOverlay(true); // true = auto-submit
      }
    }, 1000);
    // Log the violation
    logViolation("fullscreen_exit");
  };

  // ── Dismiss overlay ────────────────────────────────────────────────
  // autoSubmit=true → exam is submitted; false → student came back in time
  const _dismissOverlay = (autoSubmit = false) => {
    if (_overlayCountTimer.current) {
      clearInterval(_overlayCountTimer.current);
      _overlayCountTimer.current = null;
    }
    _stopAlarm();
    setOverlayActive(false);
    if (autoSubmit) {
      doSubmit("overlay_app", undefined, undefined);
    }
  };

  // ── Visibility change handler (works on all platforms) ────────────
  useEffect(() => {
    if (mode !== "taking") return;
    if (!activeExam?.fullscreenRequired) return;

    // On desktop with Fullscreen API, fullscreenchange already handles this.
    // We still run this on ALL platforms so floated-app detection works
    // everywhere (Android Chrome in fullscreen also loses visibility when
    // another app is floated on top).
    const examStartedAt = Date.now();

    const onVis = () => {
      const hidden = document.hidden;

      if (hidden) {
        _iosHiddenAt.current = Date.now();
        // Grace window: 1500ms before showing the overlay.
        // Notifications, shade pulls, and system alerts restore visibility
        // much faster than this — they will cancel the timer below.
        if (_overlayGraceTimer.current) clearTimeout(_overlayGraceTimer.current);
        _overlayGraceTimer.current = setTimeout(() => {
          // Still hidden after 1500ms → genuine app overlay or exit
          if (document.hidden && !overlayActive) {
            // Don't fire within first 5s of exam start
            if (Date.now() - examStartedAt >= 5000) {
              _showOverlay();
            }
          }
          _overlayGraceTimer.current = null;
        }, 1500);
        return;
      }

      // Page is visible again — student dismissed the floated app
      if (_overlayGraceTimer.current) {
        clearTimeout(_overlayGraceTimer.current);
        _overlayGraceTimer.current = null;
      }
      _iosHiddenAt.current = 0;

      // If the countdown overlay is active, dismiss it (student returned in time)
      if (overlayActive) {
        _dismissOverlay(false);
      }
    };

    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (_overlayGraceTimer.current) clearTimeout(_overlayGraceTimer.current);
      if (_overlayCountTimer.current) clearInterval(_overlayCountTimer.current);
      _stopAlarm();
    };
  }, [mode, activeExam, overlayActive]);

  // ── Genuine Tab Switch Detection ─────────────────────────────────────
  // ONLY counts an offense when a student genuinely switches away from the
  // exam tab AND comes back — a complete hide→show cycle.
  //
  // This eliminates false positives from:
  //   - Phone screen locking / dimming
  //   - Browser notifications popping up
  //   - Address bar clicks
  //   - Dev tools, file dialogs, OS popups
  //   - pagehide / beforeunload (too broad — fired by browser crash recovery,
  //     accidental back button, etc. — removed as offense triggers entirely)
  //
  // Warning progression:
  //   • 1st switch onwards → warning with count + remaining switches
  //   • At limit - 1       → FINAL WARNING: next switch will auto-submit
  //   • At limit           → 3-second grace then auto-submit
  const _tabHiddenAt    = useRef(0);     // when the tab went hidden
  const _tabSwitchLock  = useRef(false); // prevents double-count in same cycle
  const _lastViolationTs = useRef(0);    // debounce across rapid events

  useEffect(() => {
    if (mode !== "taking") return;
    if (!activeExam?.tabSwitchEnabled) return; // master toggle OFF — attach nothing

    const onVis = () => {
      const nowHidden = document.hidden;

      if (nowHidden) {
        // Tab is going away — arm the detector
        _tabHiddenAt.current   = Date.now();
        _tabSwitchLock.current = false;
        return;
      }

      // Tab came back into view — only count if:
      //  a) we recorded a prior hide (not a spurious visible fire on mount)
      //  b) hidden for >= 500 ms  (filters instant focus flickers & notifications)
      //  c) haven't already counted this hide→show cycle
      //  d) debounce: at least 1 s since last offense
      const hiddenFor = Date.now() - _tabHiddenAt.current;
      if (_tabHiddenAt.current === 0)    return; // no prior hide
      if (hiddenFor < 500)               return; // too brief — not a real switch
      if (_tabSwitchLock.current)        return; // already counted this cycle
      if (Date.now() - _lastViolationTs.current < 1000) return; // debounce

      _tabSwitchLock.current   = true;
      _tabHiddenAt.current     = 0;
      _lastViolationTs.current = Date.now();
      logViolation("tab_switch");
    };

    document.addEventListener("visibilitychange", onVis);

    // beforeunload — ONLY shows the browser "Leave page?" dialog.
    // No violation is logged here; it fires for too many innocent reasons.
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [mode, activeExam]);

  // ── Right-click & keyboard shortcut block during exam ──
  useEffect(() => {
    if (mode!=="taking") return;
    const noCtx = (e) => e.preventDefault();
    const noKeys = (e) => {
      if ((e.ctrlKey||e.metaKey) && ["c","v","u","a","p","s"].includes(e.key.toLowerCase())) e.preventDefault();
      if (e.key==="F12") e.preventDefault();
      if (e.key==="PrintScreen") { logViolation("screenshot_attempt"); e.preventDefault(); }
    };
    document.addEventListener("contextmenu", noCtx);
    document.addEventListener("keydown", noKeys);
    return () => {
      document.removeEventListener("contextmenu", noCtx);
      document.removeEventListener("keydown", noKeys);
    };
  }, [mode]);

  const logViolation = async (type, extraData={}) => {
    if (!activeExam) return;

    // ── Respect each anti-malpractice toggle strictly ──────────────────
    if (type === "tab_switch") {
      if (!activeExam.tabSwitchEnabled) return; // master toggle OFF — ignore completely
    }
    if (type === "fullscreen_exit") {
      if (!activeExam.fullscreenRequired) return; // fullscreen lockdown is OFF — ignore
    }
    // ───────────────────────────────────────────────────────────────────

    const snapshot = (activeExam.webcamSnapshots && camStream) ? captureSnapshot(camStream) : null;
    const v = { examId:activeExam.id, student:currentUser, type, ts:Date.now(), ...(snapshot?{snapshot}:{}), ...(snapshot?{}:{hasSnapshot:false}), ...extraData };
    const updatedLocal = [...violations, v];
    setViolations(updatedLocal);

    if (type === "tab_switch") {
      // Only genuine tab switches (confirmed hide→show cycle) reach here.
      // page_leave is no longer an offense type — removed entirely.
      const limit = activeExam?.tabSwitchLimit ?? 3;
      const switchCount = updatedLocal.filter(x => x.type === "tab_switch").length;

      try {
        const all = await cbtViolationsGet();
        await cbtViolationsSave([...all, v]);
      } catch(e) {}

      if (limit === 0) {
        // Warn-only mode — log it but never auto-submit
        showWarn(`⚠️ Tab switch #${switchCount} detected. This is being recorded and will be reported to your lecturer.`);

      } else if (switchCount >= limit) {
        // Limit reached — give student 3 seconds to read the message before submitting
        showWarn(`🚨 FINAL VIOLATION: You have switched tabs ${switchCount} time${switchCount===1?"":"s"} — the maximum allowed is ${limit}. Your exam is being submitted in 3 seconds.`);
        setTimeout(() => doSubmit("auto_tab", updatedLocal, penaltyDeductions), 3000);

      } else if (switchCount === limit - 1) {
        // One switch away from auto-submit — show a strong final warning
        showWarn(`🔴 FINAL WARNING — Tab Switch ${switchCount}/${limit}: You have ONE switch remaining before your exam is automatically submitted. DO NOT switch tabs again.`);

      } else {
        // Normal progressive warning
        const remaining = limit - switchCount;
        showWarn(`⚠️ Tab Switch Warning ${switchCount}/${limit}: You switched away from the exam. ${remaining} more switch${remaining===1?"":"es"} will automatically submit your exam.`);
      }

    } else {
      // Other violations: deduct 0.5 mark each time
      const newPenalties = penaltyDeductions + 0.5;
      setPenaltyDeductions(newPenalties);

      if (type==="fullscreen_exit") {
        if (!activeExam.fullscreenRequired) return; // fullscreen not required — ignore exit entirely
        setGenuineFullscreenExit(true); // show the re-enter banner
        showWarn(`⚠️ You exited fullscreen! −0.5 mark deducted (Total deductions: −${newPenalties}). Return to fullscreen immediately.`);
      } else if (type==="screenshot_attempt") {
        showWarn(`🚫 Screenshot attempt detected! −0.5 mark deducted (Total deductions: −${newPenalties}).`);
      } else {
        showWarn(`⚠️ Violation recorded: ${type}. −0.5 mark deducted (Total deductions: −${newPenalties}).`);
      }

      try {
        const all = await cbtViolationsGet();
        await cbtViolationsSave([...all, { ...v, penaltyApplied: 0.5, totalPenalties: newPenalties }]);
      } catch(e){}
    }
  };

  const showWarn = (msg) => {
    setWarningMsg(msg);
    setShowWarning(true);
    // Critical messages (🚨 🔴) stay visible longer so students can read them
    const isCritical = msg.startsWith("🚨") || msg.startsWith("🔴");
    setTimeout(() => setShowWarning(false), isCritical ? 8000 : 5000);
  };

  // ── Start exam — device check first, then cam setup, then preflight ──
  const startExam = async (exam) => {
    if (hasAttempted(exam.id)) { toast("You have already taken this exam.","warn"); return; }

    // 1. Device lock check
    if (exam.deviceLock) {
      toast("🔒 Checking device…","info");
      const { allowed, reason, devInfo } = await checkDeviceLock(exam);
      if (!allowed) {
        setDeviceBlocked(true);
        setDeviceBlockMsg(reason);
        // Log duplicate device violation
        try {
          const all = await cbtViolationsGet();
          await cbtViolationsSave([...all, {examId:exam.id,student:currentUser,type:"duplicate_device",ts:Date.now(),deviceInfo:devInfo}]);
        } catch(e){}
        return;
      }
      // Store devInfo on the exam session for logging
      exam = { ...exam, _devInfo: devInfo };
    }

    const shuffled = buildShuffled(exam);
    setActiveExam(exam);
    setShuffledQs(shuffled);
    setAnswers(new Array(shuffled.length).fill(null));
    setQIdx(0);
    setTimeLeft(exam.duration*60);
    setTabSwitches(0);
    setViolations([]);
    setDeviceBlocked(false);
    setPenaltyDeductions(0);
    setExamSubmitted(false);
    setRulesAccepted(false);

    // 2. If webcam required, go to cam setup screen first
    if (exam.webcamSnapshots) {
      setMode("camsetup");
    } else {
      setMode("preflight");
    }
  };

  const beginAfterPreflight = () => {
    window._cbtExamInProgress = true; // prevents PIN lock during exam
    setMode("taking");
    if (activeExam?.fullscreenRequired) enterFullscreen();
  };

  // ── Submit exam ──
  const doSubmit = async (reason="manual", currentViolations, currentPenalties) => {
    const exam = activeExam;
    if (!exam) return;
    if (examSubmitted) return; // guard against double-submit
    setExamSubmitted(true);
    // Use passed-in values or fall back to state (closures can be stale)
    const vList     = currentViolations  !== undefined ? currentViolations  : violations;
    const penalties = currentPenalties   !== undefined ? currentPenalties   : penaltyDeductions;
    // Calculate raw score using original question/option indices
    const rawScore = shuffledQs.reduce((s, sqObj, i) => {
      const chosen = answers[i];
      if (chosen === null || chosen === undefined) return s;
      const chosenOrigOpt = sqObj.displayOptions[chosen]?.origOptIdx;
      return s + (chosenOrigOpt === sqObj.origAns ? 1 : 0);
    }, 0);
    const total = shuffledQs.length;
    // Apply penalty: 0.5 per non-tab-switch violation, floored at 0
    const penalised = Math.max(0, rawScore - penalties);
    const score     = Math.round(penalised * 10) / 10; // keep 1 decimal
    const pct       = Math.round((score/total)*100);
    const result = {
      examId:exam.id, examTitle:exam.title, student:currentUser,
      score, rawScore, penaltyDeductions:penalties, total,
      percent:pct, submittedAt:Date.now(), reason,
      violations: vList.length,
      autoSubmittedOnLeave: reason==="page_leave",
    };
    const updated = [...results.filter(r=>!(r.examId===exam.id&&r.student===currentUser)), result];
    setResults(updated);
    await cbtResultsSave(updated);
    if (["auto_tab","page_leave"].includes(reason)) {
      const all = await cbtViolationsGet();
      await cbtViolationsSave([...all, {examId:exam.id,student:currentUser,type:"auto_submitted",reason,ts:Date.now()}]);
    }
    window._cbtExamInProgress = false; // allow PIN lock again after exam
    if (document.fullscreenElement) exitFullscreen();
    setMyResult(result);
    setMode("done");
  };

  const isArchived    = (exam) => exam.published && exam.publishedAt && (Date.now()-exam.publishedAt > 24*60*60*1000);
  const hasAttempted  = (examId) => results.some(r=>r.examId===examId&&r.student===currentUser);
  const fmtTime       = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const urgent        = timeLeft<=60&&timeLeft>0;

  const isExamOpen = (e) => {
    if (!e.published || isArchived(e)) return false;
    if (e.startTime) { const s = new Date(e.startTime).getTime(); if (!isNaN(s) && Date.now() < s) return false; }
    return true;
  };
  const available = exams.filter(e=>e.classId===myClass&&isExamOpen(e));
  const archived  = exams.filter(e=>e.published&&e.classId===myClass&&isArchived(e));
  const myResults = results.filter(r=>r.student===currentUser);

  // ── PRE-FLIGHT / INSTRUCTIONS screen ──────────────────────────────
  // Device blocked screen
  if (deviceBlocked) return (
    <div style={{maxWidth:520,margin:"0 auto"}}>
      <div className="card" style={{borderTop:"4px solid var(--danger)",padding:"32px 24px",textAlign:"center"}}>
        <div style={{fontSize:52,marginBottom:12}}>🔒</div>
        <div style={{fontWeight:800,fontSize:18,color:"var(--danger)",marginBottom:8}}>Device Blocked</div>
        <div style={{fontSize:13,color:"var(--text2)",marginBottom:20,lineHeight:1.6}}>{deviceBlockMsg}</div>
        <button className="btn" onClick={()=>{setDeviceBlocked(false);setMode("list");}}>← Back to Exams</button>
      </div>
    </div>
  );

  // Camera setup screen
  if (mode==="camsetup"&&activeExam) return (
    <div style={{maxWidth:520,margin:"0 auto"}}>
      <div className="card" style={{borderTop:"4px solid var(--purple)",padding:"28px 24px"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:44,marginBottom:8}}>📸</div>
          <div style={{fontWeight:800,fontSize:18,marginBottom:4}}>Camera Setup</div>
          <div style={{fontSize:12,color:"var(--text3)"}}>This exam uses webcam monitoring. Your camera will take photos when violations are detected.</div>
        </div>

        {/* Live camera preview */}
        <div style={{position:"relative",width:"100%",maxWidth:320,margin:"0 auto 20px",borderRadius:12,overflow:"hidden",background:"#000",aspectRatio:"4/3"}}>
          <video ref={videoRef} autoPlay playsInline muted style={{width:"100%",height:"100%",objectFit:"cover",display:camAllowed===false?"none":"block"}} />
          <canvas ref={canvasRef} style={{display:"none"}} />
          {camAllowed===null&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:13,textAlign:"center",padding:20}}>
            Click "Allow Camera" below to enable monitoring
          </div>}
          {camAllowed===false&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#fca5a5",fontSize:12,textAlign:"center",padding:20}}>
            📷 Camera unavailable<br/>You can continue without it
          </div>}
          {camAllowed&&<div style={{position:"absolute",top:8,right:8,width:10,height:10,borderRadius:"50%",background:"#22c55e",boxShadow:"0 0 6px #22c55e"}} />}
        </div>

        {camError&&<div style={{fontSize:11,color:"var(--warn)",background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.25)",borderRadius:7,padding:"8px 12px",marginBottom:12,textAlign:"center"}}>{camError}</div>}

        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {camAllowed!==true&&(
            <button className="btn" style={{borderColor:"var(--purple)",color:"var(--purple)",fontWeight:700}}
              onClick={()=>requestCam()}>
              📸 Allow Camera Access
            </button>
          )}
          {camAllowed===true&&(
            <div style={{textAlign:"center",padding:"8px",background:"rgba(34,197,94,.08)",border:"1px solid rgba(34,197,94,.2)",borderRadius:8,fontSize:12,fontWeight:700,color:"var(--success)"}}>
              ✅ Camera ready — photos will be taken silently during the exam
            </div>
          )}
          <button className="btn btn-success" style={{fontWeight:800,fontSize:14}}
            onClick={()=>setMode("preflight")}>
            {camAllowed===true?"Continue to Rules →":"Skip Camera & Continue →"}
          </button>
          <button className="btn btn-sm" style={{color:"var(--text3)"}} onClick={()=>{setMode("list");setActiveExam(null);if(camStream)camStream.getTracks().forEach(t=>t.stop());}}>← Cancel</button>
        </div>
      </div>
    </div>
  );

  if (mode==="preflight"&&activeExam) {
    // Build rules dynamically based on what the lecturer actually enabled
    const rules = [
      // Page-leave is always enforced (not a toggle — it is a core integrity rule)
      { icon:"🚪", title:"No Page-Leaving (CRITICAL)", desc:"Leaving, minimising, or closing this exam page will IMMEDIATELY auto-submit your exam. You will NOT be allowed to continue unless your lecturer permits a retake.", critical:true },
      // Tab switch — only show as CRITICAL if tabSwitchEnabled ON and tabSwitchLimit > 0
      ...(activeExam.tabSwitchEnabled && activeExam.tabSwitchLimit > 0 ? [{ icon:"🔄", title:`No Tab or Window Switching (CRITICAL — limit: ${activeExam.tabSwitchLimit})`, desc:`Switching to another tab or window will be flagged. After ${activeExam.tabSwitchLimit} switch${activeExam.tabSwitchLimit===1?"":"es"} your exam will be automatically submitted.`, critical:true }] : []),
      ...(activeExam.tabSwitchEnabled && activeExam.tabSwitchLimit === 0 ? [{ icon:"🔄", title:"Tab Switching — Warned & Logged", desc:"Switching tabs is recorded and reported to your lecturer, but will not auto-submit your exam.", critical:false }] : []),
      // Fullscreen — only show if fullscreenRequired is ON
      ...(activeExam.fullscreenRequired ? [{ icon:"🖥️", title:"Fullscreen is Mandatory", desc:"The exam runs in fullscreen. Exiting fullscreen is a violation and will deduct 0.5 mark from your score each time.", critical:false }] : []),
      // Webcam — only show if webcamSnapshots is ON
      ...(activeExam.webcamSnapshots ? [{ icon:"📸", title:"Webcam Monitoring Active", desc:"Your camera will take a snapshot each time a violation is detected. Snapshots are reported to your lecturer.", critical:false }] : []),
      { icon:"📸", title:"No Screenshots or Screen Recording", desc:"Any screenshot attempt is automatically detected and logged. Each attempt deducts 0.5 mark from your score.", critical:false },
      { icon:"🚫", title:"No Talking or Communication", desc:"You must not speak to, signal, or communicate with any other student during the exam. This is an honour-bound rule and any reported breach will be treated as malpractice.", critical:false },
      { icon:"📵", title:"No External Assistance", desc:"You must not consult textbooks, notes, phones, or any other materials during the exam. All resources must be closed before you start.", critical:false },
      // Device lock — only show if deviceLock is ON
      ...(activeExam.deviceLock ? [{ icon:"💻", title:"One Device Only", desc:"This exam may only be taken on the device you are starting it on now. Attempting to open it on another device will block your access.", critical:false }] : []),
      { icon:"🖱️", title:"Right-click & Shortcuts Disabled", desc:"Context menus (right-click), Ctrl+C, Ctrl+V, Ctrl+U, F12, and other shortcuts are disabled for the duration of the exam.", critical:false },
      { icon:"⏱️", title:"Timer Cannot Be Paused", desc:"The countdown timer runs continuously. When it reaches zero, your exam is automatically submitted regardless of how many questions you have answered.", critical:false },
      { icon:"1️⃣", title:"One Attempt Only", desc:"You have exactly one attempt. Once submitted — for any reason — you cannot retake the exam unless your lecturer explicitly resets your attempt.", critical:false },
      { icon:"👁️", title:"All Activity Is Monitored & Recorded", desc:"All violations are recorded in real time with timestamps and reported directly to your lecturer.", critical:false },
    ];
    return (
      <div style={{maxWidth:640,margin:"0 auto"}}>
        <div className="card" style={{borderTop:"4px solid var(--danger)",padding:"24px 22px"}}>

          {/* Header */}
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:44,marginBottom:6}}>🛡️</div>
            <div style={{fontWeight:900,fontSize:20,marginBottom:2,color:"var(--danger)"}}>EXAM ANTI-MALPRACTICE RULES</div>
            <div style={{fontWeight:700,fontSize:14,marginBottom:2}}>{activeExam.title}</div>
            <div style={{fontSize:12,color:"var(--text3)"}}>{activeExam.subject}</div>
          </div>

          {/* Stats strip */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:18}}>
            {[
              {icon:"❓",label:"Questions",val:activeExam.questions.length},
              {icon:"⏱️",label:"Duration",val:`${activeExam.duration} min`},
              {icon:"🎯",label:"Attempts",val:"1 only"},
            ].map((s,i)=>(
              <div key={i} style={{padding:"8px 6px",borderRadius:8,background:"var(--bg4)",border:"1px solid var(--border)",textAlign:"center"}}>
                <div style={{fontSize:18,marginBottom:2}}>{s.icon}</div>
                <div style={{fontWeight:800,fontSize:13,color:"var(--accent)"}}>{s.val}</div>
                <div style={{fontSize:10,color:"var(--text3)"}}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Critical warning box */}
          <div style={{background:"rgba(239,68,68,.1)",border:"2px solid var(--danger)",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
            <div style={{fontWeight:900,fontSize:12,color:"var(--danger)",marginBottom:8,letterSpacing:.5}}>⚡ CRITICAL — READ BEFORE YOU START</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {rules.filter(r=>r.critical).map((r,i)=>(
                <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                  <span style={{fontSize:16,flexShrink:0}}>{r.icon}</span>
                  <div>
                    <div style={{fontWeight:800,fontSize:12,color:"var(--danger)"}}>{r.title}</div>
                    <div style={{fontSize:11,color:"var(--text2)",lineHeight:1.5}}>{r.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* All rules list */}
          <div style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:10,padding:"14px",marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:12,color:"var(--text2)",marginBottom:10,letterSpacing:.4}}>📋 ALL EXAM RULES</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {rules.filter(r=>!r.critical).map((r,i)=>(
                <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                  <span style={{fontSize:15,flexShrink:0}}>{r.icon}</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:12,color:"var(--text)"}}>{r.title}</div>
                    <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5}}>{r.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Penalty summary */}
          <div style={{background:"rgba(251,146,60,.07)",border:"1px solid rgba(251,146,60,.35)",borderRadius:9,padding:"10px 14px",marginBottom:16,fontSize:11,lineHeight:1.6,color:"var(--text2)"}}>
            <span style={{fontWeight:900,color:"var(--warn)"}}>⚠️ PENALTY SUMMARY: </span>
            Page leave → <strong style={{color:"var(--danger)"}}>IMMEDIATE AUTO-SUBMISSION.</strong>{" "}
            {activeExam.tabSwitchEnabled && activeExam.tabSwitchLimit > 0
              ? <span>Tab switch → auto-submit after <strong style={{color:"var(--danger)"}}>{activeExam.tabSwitchLimit} switch{activeExam.tabSwitchLimit===1?"":"es"}.</strong>{" "}</span>
              : activeExam.tabSwitchEnabled && activeExam.tabSwitchLimit === 0
              ? <span>Tab switch → <strong style={{color:"var(--warn)"}}>logged only, no auto-submit.</strong>{" "}</span>
              : null}
            {(activeExam.fullscreenRequired) && <span>Fullscreen exit → <strong style={{color:"var(--warn)"}}>−0.5 mark.</strong>{" "}</span>}
            Violations are recorded in real time and reported to your lecturer.
          </div>

          {/* Mandatory agreement checkbox */}
          <div style={{background:"var(--bg4)",border:`2px solid ${rulesAccepted?"var(--success)":"var(--border)"}`,borderRadius:10,padding:"12px 14px",marginBottom:18,cursor:"pointer",transition:"all .2s"}}
            onClick={()=>setRulesAccepted(v=>!v)}>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${rulesAccepted?"var(--success)":"var(--text3)"}`,background:rulesAccepted?"var(--success)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .2s"}}>
                {rulesAccepted&&<span style={{color:"white",fontSize:14,fontWeight:900}}>✓</span>}
              </div>
              <div style={{fontSize:12,fontWeight:700,color:rulesAccepted?"var(--success)":"var(--text2)",lineHeight:1.5}}>
                I have read and understood all the anti-malpractice rules above. I agree to abide by them and accept that any violation will be recorded and may affect my score or result in auto-submission.
              </div>
            </div>
          </div>

          <div style={{display:"flex",gap:10}}>
            <button className="btn btn-sm" style={{flexShrink:0}} onClick={()=>{setMode("list");setActiveExam(null);if(camStream)camStream.getTracks().forEach(t=>t.stop());}}>← Cancel</button>
            <button className="btn btn-success" style={{flex:1,fontWeight:900,fontSize:15,opacity:rulesAccepted?1:.45,cursor:rulesAccepted?"pointer":"not-allowed"}}
              disabled={!rulesAccepted}
              onClick={()=>{if(rulesAccepted)beginAfterPreflight();}}>
              {activeExam.fullscreenRequired?"🖥️ Accept Rules & Enter Fullscreen":"▶ Accept Rules & Start Exam"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── TAKING MODE ──────────────────────────────────────────────────────
  if (mode==="taking"&&activeExam&&shuffledQs.length>0) {
    const sq = shuffledQs[qIdx];
    const answeredCnt = answers.filter(a=>a!==null).length;
    return (
      <div style={{maxWidth:640,margin:"0 auto",userSelect:"none"}}>

        {/* Hidden video + canvas for snapshot capture */}
        <video ref={videoRef} autoPlay playsInline muted style={{position:"fixed",bottom:-9999,left:-9999,width:1,height:1}} />
        <canvas ref={canvasRef} style={{display:"none"}} />

        {/* ☢️ App-overlay / fullscreen-exit WARNING OVERLAY with countdown */}
        {overlayActive&&(
          <div style={{
            position:"fixed",inset:0,zIndex:99999,
            background:"rgba(0,0,0,0.92)",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            gap:16,padding:24,animation:"fadeIn .2s ease",
          }}>
            {/* Pulsing radiation symbol */}
            <div style={{
              fontSize:90,lineHeight:1,
              animation:"pulse 0.6s ease-in-out infinite alternate",
              filter:"drop-shadow(0 0 24px rgba(239,68,68,0.9))",
            }}>☢️</div>

            <div style={{
              color:"#ef4444",fontWeight:900,fontSize:22,textAlign:"center",
              textShadow:"0 0 20px rgba(239,68,68,0.8)",letterSpacing:0.5,
            }}>
              EXAM INTEGRITY VIOLATION
            </div>

            <div style={{
              color:"white",fontWeight:700,fontSize:15,textAlign:"center",
              lineHeight:1.6,maxWidth:320,
            }}>
              Another app is floating on top of your exam screen.<br/>
              <strong style={{color:"#fbbf24"}}>Close it immediately</strong> to continue your exam.
            </div>

            {/* Countdown circle */}
            <div style={{
              width:110,height:110,borderRadius:"50%",
              background: overlayCountdown <= 2
                ? "radial-gradient(circle,rgba(239,68,68,0.35),rgba(239,68,68,0.1))"
                : "radial-gradient(circle,rgba(251,146,60,0.3),rgba(251,146,60,0.08))",
              border: `5px solid ${overlayCountdown <= 2 ? "#ef4444" : "#fb923c"}`,
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              boxShadow: overlayCountdown <= 2
                ? "0 0 30px rgba(239,68,68,0.7),inset 0 0 20px rgba(239,68,68,0.2)"
                : "0 0 20px rgba(251,146,60,0.5)",
              animation: overlayCountdown <= 2 ? "pulse 0.4s ease-in-out infinite alternate" : "none",
              transition:"all 0.4s",
            }}>
              <div style={{
                fontSize:46,fontWeight:900,
                color: overlayCountdown <= 2 ? "#ef4444" : "#fb923c",
                fontFamily:"'DM Mono',monospace",lineHeight:1,
              }}>{overlayCountdown}</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.6)",fontWeight:700,marginTop:2}}>SECONDS</div>
            </div>

            <div style={{
              color: overlayCountdown <= 2 ? "#ef4444" : "#fb923c",
              fontWeight:800,fontSize:13,textAlign:"center",
              animation:"pulse 0.6s ease-in-out infinite alternate",
            }}>
              {overlayCountdown <= 2
                ? "🚨 SUBMITTING NOW..."
                : `Exam auto-submits in ${overlayCountdown} second${overlayCountdown===1?"":"s"}`}
            </div>

            <div style={{
              marginTop:8,padding:"10px 20px",
              background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.15)",
              borderRadius:10,color:"rgba(255,255,255,0.55)",fontSize:11,textAlign:"center",
              maxWidth:300,lineHeight:1.6,
            }}>
              ⚠️ This violation has been recorded and reported to your lecturer.
            </div>
          </div>
        )}

        {/* Violation warning banner */}
        {showWarning&&!overlayActive&&(
          <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",zIndex:9999,
            background:"rgba(239,68,68,.97)",color:"white",borderRadius:12,padding:"12px 20px",
            fontWeight:800,fontSize:14,boxShadow:"0 8px 32px rgba(239,68,68,.4)",maxWidth:520,textAlign:"center",
            animation:"fadeUp .3s ease"}}>
            {warningMsg}
          </div>
        )}

        {/* Cam status dot + last snapshot thumbnail */}
        {camAllowed&&(
          <div style={{position:"fixed",bottom:16,right:16,zIndex:1000,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}>
            <div style={{display:"flex",alignItems:"center",gap:5,background:"rgba(0,0,0,.6)",borderRadius:20,padding:"4px 8px"}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:"#22c55e",boxShadow:"0 0 6px #22c55e"}} />
              <span style={{fontSize:10,color:"white",fontFamily:"'DM Mono',monospace"}}>CAM ON</span>
            </div>
            {lastSnapshot&&<img src={lastSnapshot} style={{width:56,height:42,objectFit:"cover",borderRadius:6,border:"2px solid rgba(168,85,247,.5)",opacity:.7}} title="Last captured snapshot" />}
          </div>
        )}

        {/* Fullscreen re-entry prompt — only shown after a confirmed genuine exit */}
        {activeExam.fullscreenRequired&&genuineFullscreenExit&&mode==="taking"&&(
          <div style={{marginBottom:12,padding:"10px 14px",background:"rgba(239,68,68,.1)",border:"1px solid var(--danger)",borderRadius:10,
            display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>🖥️</span>
            <div style={{flex:1,fontSize:13,fontWeight:700,color:"var(--danger)"}}>Fullscreen mode exited — please return to fullscreen</div>
            <button className="btn btn-sm btn-danger" onClick={enterFullscreen}>Re-enter Fullscreen</button>
          </div>
        )}

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:14,flexWrap:"wrap",
          background:"var(--card)",borderRadius:12,padding:"12px 16px",border:"1px solid var(--border)",boxShadow:"0 2px 12px rgba(0,0,0,.08)"}}>
          <div>
            <div style={{fontWeight:800,fontSize:14}}>{activeExam.title}</div>
            <div style={{display:"flex",gap:10,fontSize:11,color:"var(--text3)",marginTop:2}}>
              <span>{answeredCnt}/{shuffledQs.length} answered</span>
              {tabSwitches>0&&<span style={{color:"var(--danger)",fontWeight:700}}>🚨 {tabSwitches} flag{tabSwitches>1?"s":""}</span>}
              {penaltyDeductions>0&&<span style={{color:"var(--warn)",fontWeight:700}}>⚠️ −{penaltyDeductions} pts penalty</span>}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{
              fontWeight:800,fontSize:20,padding:"6px 16px",borderRadius:10,
              fontFamily:"'DM Mono',monospace",letterSpacing:1,
              background:urgent?"rgba(239,68,68,.1)":"rgba(0,119,182,.08)",
              color:urgent?"var(--danger)":"var(--accent)",
              border:`2px solid ${urgent?"var(--danger)":"var(--accent)"}`,
            }}>⏱ {fmtTime(timeLeft)}</div>
            <button className="btn btn-sm btn-danger"
              onClick={()=>{if(confirm("Submit exam now? This action is final and cannot be undone."))doSubmit("manual");}}>
              Submit ✓
            </button>
          </div>
        </div>

        {/* Question navigator */}
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
          {shuffledQs.map((_,i)=>(
            <div key={i} onClick={()=>setQIdx(i)} style={{
              width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",
              cursor:"pointer",fontSize:11,fontWeight:700,transition:"all .15s",
              background:i===qIdx?"var(--accent)":answers[i]!==null?"rgba(34,197,94,.15)":"var(--bg4)",
              border:`2px solid ${i===qIdx?"var(--accent)":answers[i]!==null?"var(--success)":"var(--border)"}`,
              color:i===qIdx?"white":answers[i]!==null?"var(--success)":"var(--text3)"
            }}>{i+1}</div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="progress-wrap" style={{marginBottom:14}}>
          <div className="progress-fill" style={{width:`${(answeredCnt/shuffledQs.length)*100}%`,background:"var(--accent)"}} />
        </div>

        <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Question {qIdx+1} of {shuffledQs.length}</div>
        <div className="card" style={{marginBottom:12,borderLeft:"3px solid var(--accent)"}}>
          <div style={{fontWeight:700,fontSize:16,lineHeight:1.6}}>{sq.q}</div>
        </div>
        {sq.displayOptions.map((opt,di)=>(
          <div key={di} onClick={()=>setAnswers(prev=>{const n=[...prev];n[qIdx]=di;return n;})}
            className="quiz-opt" style={{
              borderColor:answers[qIdx]===di?"var(--accent)":"var(--border)",
              background:answers[qIdx]===di?"rgba(0,119,182,.12)":"transparent",
              cursor:"pointer",display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:11,opacity:.55,flexShrink:0}}>{"ABCD"[di]}.</span>
            <span style={{flex:1}}>{opt.text}</span>
            {answers[qIdx]===di&&<span style={{color:"var(--accent)",fontWeight:800,fontSize:16}}>✓</span>}
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"space-between"}}>
          <button className="btn btn-sm" disabled={qIdx===0} onClick={()=>setQIdx(q=>q-1)}>← Prev</button>
          {qIdx<shuffledQs.length-1
            ?<button className="btn btn-sm btn-accent" onClick={()=>setQIdx(q=>q+1)}>Next →</button>
            :<button className="btn btn-sm btn-success" onClick={()=>{if(confirm("Submit exam now? This is final."))doSubmit("manual");}}>Submit Exam ✓</button>
          }
        </div>
      </div>
    );
  }

  // ── DONE (result screen) ──────────────────────────────────────────────
  if (mode==="done"&&myResult) {
    const showResults = activeExam?.showResultsImmediately !== false;
    const grade  = myResult.percent>=70?"A":myResult.percent>=60?"B":myResult.percent>=50?"C":myResult.percent>=40?"D":"F";
    const gColor = myResult.percent>=70?"var(--success)":myResult.percent>=50?"var(--warn)":"var(--danger)";
    const isPageLeave = myResult.reason==="page_leave";
    const isAutoTab   = myResult.reason==="auto_tab";
    const isAuto      = isPageLeave||isAutoTab;
    return (
      <div style={{maxWidth:640,margin:"0 auto"}}>
        <div className="card" style={{textAlign:"center",padding:"32px 20px",marginBottom:16,borderTop:`4px solid ${isAuto?"var(--danger)":showResults?gColor:"var(--accent)"}`}}>
          <div style={{fontSize:60,marginBottom:8}}>
            {isAuto?"🚨":showResults?(myResult.percent>=70?"🎉":myResult.percent>=50?"👍":"😔"):"✅"}
          </div>
          <div style={{fontWeight:800,fontSize:22,marginBottom:4}}>
            {isAuto?"Exam Auto-Submitted":"Exam Submitted!"}
          </div>
          {isPageLeave&&(
            <div style={{fontSize:13,color:"var(--danger)",marginBottom:10,fontWeight:700,background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,padding:"10px 14px"}}>
              ⚠️ Your exam was automatically submitted because you left or minimised the exam page.<br/>
              <span style={{fontSize:11,fontWeight:400,color:"var(--text3)"}}>You cannot continue this exam. Contact your lecturer if you believe this was an error.</span>
            </div>
          )}
          {isAutoTab&&!isPageLeave&&(
            <div style={{fontSize:12,color:"var(--danger)",marginBottom:8,fontWeight:700}}>Your exam was auto-submitted because you switched tabs or windows.</div>
          )}
          <div style={{fontSize:13,color:"var(--text3)",marginBottom:20}}>{activeExam?.title}</div>
          {showResults ? (
            <>
              <div style={{display:"flex",justifyContent:"center",gap:28,flexWrap:"wrap",marginBottom:myResult.penaltyDeductions>0?12:0}}>
                <div><div style={{fontSize:42,fontWeight:800,color:"var(--accent)"}}>{myResult.score}/{myResult.total}</div><div style={{fontSize:12,color:"var(--text3)"}}>Final Score</div></div>
                <div><div style={{fontSize:42,fontWeight:800,color:gColor}}>{myResult.percent}%</div><div style={{fontSize:12,color:"var(--text3)"}}>Percentage</div></div>
                <div><div style={{fontSize:42,fontWeight:800,color:gColor}}>{grade}</div><div style={{fontSize:12,color:"var(--text3)"}}>Grade</div></div>
              </div>
              {myResult.penaltyDeductions>0&&(
                <div style={{marginTop:8,padding:"8px 14px",background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.3)",borderRadius:8,fontSize:12}}>
                  <span style={{color:"var(--warn)",fontWeight:800}}>⚠️ Penalty applied: </span>
                  <span style={{color:"var(--text2)"}}>Raw score {myResult.rawScore}/{myResult.total} − {myResult.penaltyDeductions} (violations) = <strong>{myResult.score}</strong></span>
                </div>
              )}
            </>
          ) : (
            <div style={{padding:"16px 20px",background:"var(--bg4)",borderRadius:10,border:"1px solid var(--border)"}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Your response has been recorded.</div>
              <div style={{fontSize:12,color:"var(--text3)"}}>Your lecturer will release results when ready.</div>
            </div>
          )}
          {myResult.violations>0&&<div style={{marginTop:14,fontSize:12,color:"var(--danger)",fontWeight:700}}>🚨 {myResult.violations} violation{myResult.violations>1?"s":""} recorded during this exam.</div>}
        </div>
        {showResults && <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>Answer Review</div>}
        {showResults && <div>
        {shuffledQs.map((sq,i)=>{
          const chosen       = answers[i];
          const chosenOrigOpt = chosen!==null&&chosen!==undefined ? sq.displayOptions[chosen]?.origOptIdx : null;
          const correct      = chosenOrigOpt===sq.origAns;
          return (
            <div key={i} className="card" style={{marginBottom:10,borderLeft:`3px solid ${chosenOrigOpt!==null?correct?"var(--success)":"var(--danger)":"var(--border)"}`}}>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:16}}>{chosenOrigOpt!==null?correct?"✅":"❌":"⬜"}</span>
                <div style={{fontWeight:700,fontSize:13,flex:1}}>{i+1}. {sq.q}</div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {sq.displayOptions.map((opt,di)=>{
                  const isCorrectOpt = opt.origOptIdx===sq.origAns;
                  const isChosen     = di===chosen;
                  return (
                    <span key={di} style={{fontSize:11,padding:"3px 9px",borderRadius:6,
                      background:isCorrectOpt?"rgba(34,197,94,.15)":isChosen&&!isCorrectOpt?"rgba(239,68,68,.1)":"transparent",
                      border:`1px solid ${isCorrectOpt?"var(--success)":isChosen&&!isCorrectOpt?"var(--danger)":"var(--border)"}`,
                      color:isCorrectOpt?"var(--success)":isChosen&&!isCorrectOpt?"var(--danger)":"var(--text3)",
                      fontWeight:isCorrectOpt?800:400
                    }}>{"ABCD"[di]}. {opt.text}{isCorrectOpt?" ✓":""}{isChosen&&!isCorrectOpt?" ✗":""}</span>
                  );
                })}
              </div>
              {(chosen===null||chosen===undefined)&&<div style={{fontSize:11,color:"var(--text3)",marginTop:5,fontStyle:"italic"}}>— Not answered</div>}
            </div>
          );
        })}
        </div>}
        <button className="btn btn-accent" onClick={()=>{setMode("list");setActiveExam(null);setMyResult(null);}}>← Back to Exams</button>
      </div>
    );
  }

  // ── REVIEW MODE (archived) ────────────────────────────────────────────
  if (mode==="review"&&activeExam) {
    const myR = myResults.find(r=>r.examId===activeExam.id);
    return (
      <div style={{maxWidth:680,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
          <button className="btn btn-sm" onClick={()=>{setMode("list");setActiveExam(null);}}>← Back</button>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:15,color:"var(--warn)"}}>🗄️ {activeExam.title}</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>Archived • Read-Only Review Mode</div>
          </div>
          <button className="btn btn-sm" onClick={()=>setShowAns(activeExam.questions.reduce((o,_,i)=>({...o,[i]:true}),{}))}>Show All ✓</button>
          <button className="btn btn-sm" onClick={()=>setShowAns({})}>Hide All</button>
        </div>
        {myR&&(
          <div className="card" style={{marginBottom:14,textAlign:"center",borderTop:`3px solid ${myR.percent>=70?"var(--success)":myR.percent>=50?"var(--warn)":"var(--danger)"}`}}>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:4}}>Your score on this exam</div>
            <div style={{fontWeight:800,fontSize:20,color:"var(--accent)"}}>{myR.score}/{myR.total} • {myR.percent}% • Grade {myR.percent>=70?"A":myR.percent>=60?"B":myR.percent>=50?"C":myR.percent>=40?"D":"F"}</div>
          </div>
        )}
        {activeExam.questions.map((q,i)=>(
          <div key={i} className="card" style={{marginBottom:10,borderLeft:`3px solid ${showAns[i]?"var(--success)":"var(--border)"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
              <div style={{fontWeight:700,fontSize:13,flex:1,lineHeight:1.5}}>Q{i+1}. {q.q}</div>
              <button className="btn btn-sm" style={{flexShrink:0,fontSize:11,borderColor:"var(--accent)",color:"var(--accent)"}}
                onClick={()=>setShowAns(s=>({...s,[i]:!s[i]}))}>
                {showAns[i]?"Hide":"Show Answer"}
              </button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {q.options.filter(o=>o).map((opt,oi)=>(
                <span key={oi} style={{fontSize:12,padding:"4px 11px",borderRadius:7,transition:"all .2s",
                  background:showAns[i]&&oi===q.ans?"rgba(34,197,94,.15)":"var(--bg4)",
                  border:`1px solid ${showAns[i]&&oi===q.ans?"var(--success)":"var(--border)"}`,
                  color:showAns[i]&&oi===q.ans?"var(--success)":"var(--text3)",
                  fontWeight:showAns[i]&&oi===q.ans?800:400
                }}>{"ABCD"[oi]}. {opt}{showAns[i]&&oi===q.ans?" ✓":""}</span>
              ))}
            </div>
          </div>
        ))}
        <button className="btn" onClick={()=>{setMode("list");setActiveExam(null);}}>← Back to Exams</button>
      </div>
    );
  }

  // ── LIST VIEW ──────────────────────────────────────────────────────────
  if (loading) return <div style={{textAlign:"center",padding:60,color:"var(--text3)"}}>⏳ Loading exams…</div>;

  return (
    <div>
      <div className="sec-title">📝 CBT Exams</div>
      <div style={{fontSize:12,color:"var(--text3)",marginBottom:20}}>
        Computer-Based Tests for your class. One attempt per exam. Archived exams are available in read-only Review Mode.
      </div>

      {available.length===0&&archived.length===0&&(
        <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}>
          <div style={{fontSize:52,marginBottom:12}}>📋</div>
          <div style={{fontWeight:700,marginBottom:6}}>No exams available</div>
          <div style={{fontSize:12}}>Your lecturer hasn't published any exams for your class yet.</div>
        </div>
      )}

      {available.length>0&&(
        <div style={{marginBottom:22}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--success)",marginBottom:8}}>✅ Available Now</div>
          {available.map(e=>{
            const attempted = hasAttempted(e.id);
            const myR       = myResults.find(r=>r.examId===e.id);
            return (
              <div key={e.id} className="card" style={{marginBottom:10,borderLeft:`4px solid ${attempted?"var(--success)":"var(--accent)"}`}}>
                <div style={{display:"flex",gap:10,alignItems:"flex-start",flexWrap:"wrap"}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                      <div style={{fontWeight:800,fontSize:15}}>{e.title}</div>
                      {attempted
                        ?<span className="tag tag-success" style={{fontSize:10}}>✅ Completed</span>
                        :<span className="tag" style={{fontSize:10,borderColor:"var(--accent)",color:"var(--accent)"}}>📝 Available</span>
                      }
                    </div>
                    {e.subject&&<div style={{fontSize:12,color:"var(--text3)",marginBottom:3}}>📚 {e.subject}</div>}
                    <div style={{display:"flex",flexWrap:"wrap",gap:10,fontSize:11,color:"var(--text3)"}}>
                      <span>❓ {e.questions.length}Q</span>
                      <span>⏱ {e.duration}min</span>
                      {e.shuffleQuestions&&<span style={{color:"var(--danger)"}}>🔀 Shuffled</span>}
                      {e.fullscreenRequired&&<span style={{color:"var(--danger)"}}>🖥️ Fullscreen</span>}
                      {myR&&<span style={{color:"var(--success)",fontWeight:700}}>Score: {myR.score}/{myR.total} ({myR.percent}%)</span>}
                    </div>
                  </div>
                  <div>
                    {attempted
                      ?<button className="btn btn-sm" onClick={()=>{setActiveExam(e);setMyResult(myR||null);setMode("done");setShuffledQs(buildShuffled(e));}}>📊 View Result</button>
                      :<button className="btn btn-accent" onClick={()=>startExam(e)}>▶ Start Exam</button>
                    }
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {archived.length>0&&(
        <div>
          <div style={{fontWeight:800,fontSize:13,color:"var(--warn)",marginBottom:4}}>🗄️ Archived — Review Mode Only</div>
          <div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>Exams older than 24 hours. Questions and answers are visible for study.</div>
          {archived.map(e=>{
            const myR = myResults.find(r=>r.examId===e.id);
            return (
              <div key={e.id} className="card" style={{marginBottom:10,borderLeft:"4px solid var(--warn)",opacity:.9}}>
                <div style={{display:"flex",gap:10,alignItems:"flex-start",flexWrap:"wrap"}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                      <div style={{fontWeight:800,fontSize:15}}>{e.title}</div>
                      <span style={{fontSize:10,padding:"2px 8px",borderRadius:12,background:"rgba(251,146,60,.12)",color:"var(--warn)",fontWeight:700}}>🗄️ Archived</span>
                    </div>
                    {e.subject&&<div style={{fontSize:12,color:"var(--text3)",marginBottom:3}}>📚 {e.subject}</div>}
                    <div style={{display:"flex",flexWrap:"wrap",gap:10,fontSize:11,color:"var(--text3)"}}>
                      <span>❓ {e.questions.length}Q</span>
                      {myR&&<span style={{color:"var(--success)",fontWeight:700}}>Score: {myR.score}/{myR.total} ({myR.percent}%)</span>}
                    </div>
                  </div>
                  <button className="btn btn-sm" style={{borderColor:"var(--warn)",color:"var(--warn)"}}
                    onClick={()=>{setActiveExam(e);setShowAns({});setMode("review");}}>📖 Review</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {myResults.length>0&&(
        <div style={{marginTop:24}}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📊 My Results History</div>
          <div className="card" style={{padding:0,overflow:"hidden"}}>
            <table className="tbl">
              <thead><tr><th>Exam</th><th>Score</th><th>%</th><th>Grade</th><th>Flags</th><th>Date</th></tr></thead>
              <tbody>
                {myResults.sort((a,b)=>b.submittedAt-a.submittedAt).map((r,i)=>{
                  const grade  = r.percent>=70?"A":r.percent>=60?"B":r.percent>=50?"C":r.percent>=40?"D":"F";
                  const gColor = r.percent>=70?"var(--success)":r.percent>=50?"var(--warn)":"var(--danger)";
                  return (
                    <tr key={i}>
                      <td style={{fontWeight:600}}>{r.examTitle}</td>
                      <td style={{color:"var(--accent)",fontWeight:700}}>
                        {r.score}/{r.total}
                        {r.penaltyDeductions>0&&<span style={{fontSize:10,color:"var(--warn)",marginLeft:4}}>−{r.penaltyDeductions}</span>}
                      </td>
                      <td style={{color:gColor,fontWeight:700}}>{r.percent}%</td>
                      <td><span style={{fontWeight:800,color:gColor}}>{grade}</span></td>
                      <td>
                        {r.autoSubmittedOnLeave
                          ? <span style={{color:"var(--danger)",fontWeight:700}}>🚪 Left page</span>
                          : r.reason==="auto_tab"
                            ? <span style={{color:"var(--danger)",fontWeight:700}}>🔄 Tab switch</span>
                            : r.violations>0
                              ? <span style={{color:"var(--warn)",fontWeight:700}}>⚠️ {r.violations}</span>
                              : <span style={{color:"var(--success)"}}>✅ 0</span>}
                      </td>
                      <td style={{fontSize:11,color:"var(--text3)"}}>{r.submittedAt?new Date(r.submittedAt).toLocaleDateString():"-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// NURSING COUNCIL EXAM SITE
// ════════════════════════════════════════════════════════════════════════════

// ── Admin: Daily Mock Manager ─────────────────────────────────────────────
// Admin adds/deletes questions. All questions (up to 250) are served per mock.
// Uses chunked Firestore storage to bypass the 1 MB document limit.

// ── ROBUST QUESTION PARSER ─────────────────────────────────────────────────
// Handles: numbered (1. 2. 3.), Q: format, with/without blank lines,
// inline Answer: lines, and a separate answer-key column.

export function NcDailyMockExam({ toast, currentUser, onBack, isAdmin }) {
  const isUnlockedFull = isAdmin || useNcAccess(currentUser);
  const [pool] = useSharedData("nv-daily-mock", []);
  const mockTitle = ls("nv-daily-mock-title", "");
  const [archive, setArchive] = useSharedData("nv-nc-archive", []);
  const [phase, setPhase] = useState("intro");
  const [answers, setAnswers] = useState([]);
  const [qIdx, setQIdx] = useState(0);
  const [finalAnswers, setFinalAnswers] = useState(null);
  const [unlocked, setUnlocked] = useState(isUnlockedFull);
  const today = new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});
  const questions = getDailyMockQuestions(pool);

  const saveToArchive = async () => {
    if (!questions.length) return toast("No questions to archive","error");
    const entry = {
      id: `arc_dm_${Date.now()}`,
      type: "dailymock",
      spec: "general",
      title: `Daily Mock — ${today}`,
      savedAt: Date.now(),
      questions,
    };
    const newArc = [...archive.filter(e=>e.title!==entry.title), entry];
    setArchive(newArc);
    const ok = await saveShared("ncArchive", newArc);
    toast(ok?"✅ Daily Mock saved to archive!":"⚠️ Saved locally — sync failed", ok?"success":"warn");
  };

  const submit = () => {
    setFinalAnswers([...answers]);
    setPhase("result");
    const score = questions.reduce((s,q,i)=>answers[i]===q.ans?s+1:s,0);
    const results = ls("nv-results",[]);
    saveMyData("results","nv-results",[...results,{id:Date.now(),subject:`Daily Mock — ${today}`,type:"NC Daily Mock",score,total:questions.length,pct:Math.round(score/questions.length*100),date:new Date().toLocaleDateString()}]);
    toast("Daily mock submitted! 🎉","success");
  };

  if (pool.length === 0) return (
    <div style={{textAlign:"center",padding:"56px 20px",color:"var(--text3)"}}>
      <div style={{fontSize:52,marginBottom:12}}>📅</div>
      <div style={{fontWeight:700,fontSize:15,marginBottom:6,color:"#2d4a1e"}}>No Questions Yet</div>
      <div style={{fontSize:12,marginBottom:16}}>Admin hasn't added daily mock questions yet. Check back soon!</div>
      <button className="nc-btn" onClick={onBack}>← Back</button>
    </div>
  );

  // Gate daily mock mid-exam: first NC_MOCK_FREE_LIMIT (15) questions are free,
  // then show paywall to continue — same pattern as specialty papers
  if (!unlocked && !isAdmin && phase === "exam" && qIdx >= NC_MOCK_FREE_LIMIT) {
    const preview = (
      <div>
        {questions.slice(0, NC_MOCK_FREE_LIMIT).map((q, i) => (
          <div key={i} className="nc-card" style={{marginBottom:6,opacity:.7,borderLeft:"3px solid #4a7a2e"}}>
            <div style={{fontWeight:700,fontSize:12,color:"#2d4a1e"}}>Q{i+1}. {q.q}</div>
          </div>
        ))}
      </div>
    );
    return (
      <div style={{maxWidth:500,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <button className="nc-btn" onClick={onBack}>← Back</button>
          <div style={{fontWeight:800,fontSize:16,color:"#2d4a1e"}}>📅 {mockTitle || "Daily Mock Exam"}</div>
        </div>
        <NcPaywall currentUser={currentUser} onUnlocked={()=>setUnlocked(true)} toast={toast} preview={preview} isMock />
      </div>
    );
  }

  if (phase==="intro") return (
    <div style={{maxWidth:600,margin:"0 auto"}}>
      <div className="nc-card" style={{textAlign:"center",padding:"32px 28px"}}>
        <div style={{fontSize:52,marginBottom:10}}>📅</div>
        <div style={{fontWeight:800,fontSize:22,color:"#2d4a1e",marginBottom:4}}>{mockTitle || "Daily Mock Exam"}</div>
        <div style={{fontSize:13,color:"#6b8a52",marginBottom:20}}>{today} • {questions.length} Questions • Mixed Specialties</div>
        {!isUnlockedFull && (
          <div style={{padding:"8px 14px",borderRadius:9,marginBottom:16,background:"rgba(251,146,60,.1)",border:"1px solid rgba(251,146,60,.3)",fontSize:12,color:"#c05621",fontWeight:700,textAlign:"center"}}>
            ⚠️ Free preview: first {NC_MOCK_FREE_LIMIT} questions — enter a production code to unlock all {questions.length}
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:24}}>
          {[{icon:"❓",label:`${questions.length} Questions`},{icon:"⏱",label:"No time limit"},{icon:"📊",label:"Score tracked"}].map((s,i)=>(
            <div key={i} style={{background:"rgba(74,122,46,.07)",borderRadius:10,padding:"12px 8px",textAlign:"center"}}>
              <div style={{fontSize:22,marginBottom:3}}>{s.icon}</div>
              <div style={{fontSize:11,fontWeight:700,color:"#2d4a1e"}}>{s.label}</div>
            </div>
          ))}
        </div>
        {isAdmin&&(
          <button className="btn btn-sm" style={{marginBottom:16,borderColor:"#4a7a2e",color:"#4a7a2e"}} onClick={saveToArchive}>
            🗄️ Save Today's Mock to Archive
          </button>
        )}
        <div style={{display:"flex",gap:10}}>
          <button className="nc-btn" style={{flex:1}} onClick={onBack}>← Back</button>
          <button className="nc-btn nc-btn-primary" style={{flex:2,fontSize:15}} onClick={()=>{setAnswers(Array(questions.length).fill(null));setQIdx(0);setPhase("exam");}}>▶ Start Daily Mock</button>
        </div>
      </div>
    </div>
  );

  if (phase==="result") {
    const score = questions.reduce((s,q,i)=>finalAnswers[i]===q.ans?s+1:s,0);
    const pct = Math.round(score/questions.length*100);
    return (
      <div style={{maxWidth:640,margin:"0 auto"}}>
        <div className="nc-card" style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:48,marginBottom:6}}>{pct>=80?"🎉":pct>=60?"👍":"📚"}</div>
          <div style={{fontWeight:800,fontSize:20,color:"#2d4a1e",marginBottom:4}}>{mockTitle || "Daily Mock"} — Complete!</div>
          <div style={{fontWeight:800,fontSize:52,color:pct>=70?"#4a7a2e":pct>=50?"#c05621":"#991b1b",lineHeight:1}}>{score}/{questions.length}</div>
          <div style={{fontSize:16,color:"#6b8a52",marginBottom:10}}>{pct}% — {pct>=80?"Excellent":pct>=60?"Good Pass":pct>=40?"Borderline":"Needs Improvement"}</div>
          <div className="nc-progress-wrap" style={{maxWidth:300,margin:"0 auto 16px"}}>
            <div className="nc-progress-fill" style={{width:`${pct}%`}} />
          </div>
          {isAdmin&&(
            <button className="btn btn-sm" style={{borderColor:"#4a7a2e",color:"#4a7a2e",marginBottom:8}} onClick={saveToArchive}>
              🗄️ Save to Archive
            </button>
          )}
        </div>
        <div style={{fontWeight:800,fontSize:14,color:"#2d4a1e",marginBottom:10}}>📋 Answer Review</div>
        {questions.map((q,i)=>{
          const correct = finalAnswers[i]===q.ans;
          return (
            <div key={i} className="nc-card" style={{marginBottom:10,borderLeft:`4px solid ${finalAnswers[i]===null?"#d4c9a8":correct?"#22c55e":"#ef4444"}`}}>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:16}}>{finalAnswers[i]===null?"⬜":correct?"✅":"❌"}</span>
                <div style={{fontWeight:700,fontSize:13,flex:1}}>{i+1}. {q.q}</div>
                <span style={{fontSize:10,padding:"2px 7px",borderRadius:5,background:"rgba(74,122,46,.1)",color:"#2d4a1e",fontWeight:700}}>{q.cat}</span>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {q.options.map((opt,oi)=>(
                  <span key={oi} style={{fontSize:11,padding:"3px 9px",borderRadius:6,
                    background:oi===q.ans?"rgba(34,197,94,.15)":oi===finalAnswers[i]&&!correct?"rgba(239,68,68,.1)":"transparent",
                    border:`1px solid ${oi===q.ans?"#22c55e":oi===finalAnswers[i]&&!correct?"#ef4444":"#d4c9a8"}`,
                    color:oi===q.ans?"#15803d":oi===finalAnswers[i]&&!correct?"#dc2626":"#6b8a52",fontWeight:oi===q.ans?800:400
                  }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}{oi===finalAnswers[i]&&oi!==q.ans?" ✗":""}</span>
                ))}
              </div>
            </div>
          );
        })}
        <div style={{textAlign:"center",marginTop:16}}>
          <button className="nc-btn" onClick={onBack}>← Back to NC Exams</button>
        </div>
      </div>
    );
  }

  const q = questions[qIdx];
  const answeredCount = answers.filter(a=>a!==null).length;
  return (
    <div style={{maxWidth:620,margin:"0 auto"}}>
      <div className="nc-card" style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:"#2d4a1e"}}>📅 {mockTitle || "Daily Mock"} — {today}</div>
            <div style={{fontSize:11,color:"#6b8a52"}}>{answeredCount}/{questions.length} answered</div>
          </div>
          <button className="nc-btn nc-btn-primary" onClick={()=>{if(confirm("Submit exam now?"))submit();}}>Submit ✓</button>
        </div>
      </div>
      {!unlocked && !isAdmin && (
        <div style={{padding:"6px 12px",borderRadius:8,marginBottom:10,background:"rgba(251,146,60,.1)",border:"1px solid rgba(251,146,60,.3)",fontSize:12,color:"#c05621",fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
          ⚠️ Free preview: {NC_MOCK_FREE_LIMIT} of {questions.length} questions — <span style={{textDecoration:"underline",cursor:"pointer"}} onClick={()=>setQIdx(NC_MOCK_FREE_LIMIT)}>🔓 Unlock all</span>
        </div>
      )}
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
        {questions.map((_,i)=>{
          const isLocked = !unlocked && !isAdmin && i >= NC_MOCK_FREE_LIMIT;
          return isLocked ? (
            <div key={i} onClick={()=>setQIdx(NC_MOCK_FREE_LIMIT)}
              style={{width:30,height:30,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:12,
                background:"#f5f0e8",border:"2px dashed #d4c9a8",color:"#6b8a52"}}>🔒</div>
          ) : (
            <div key={i} onClick={()=>setQIdx(i)} style={{width:30,height:30,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11,fontWeight:700,transition:"all .15s",
              background:i===qIdx?"#4a7a2e":answers[i]!==null?"rgba(34,197,94,.15)":"#f5f0e8",
              border:`2px solid ${i===qIdx?"#4a7a2e":answers[i]!==null?"#22c55e":"#d4c9a8"}`,
              color:i===qIdx?"white":answers[i]!==null?"#15803d":"#6b8a52"}}>{i+1}</div>
          );
        })}
      </div>
      <div className="nc-progress-wrap" style={{marginBottom:14}}>
        <div className="nc-progress-fill" style={{width:`${(answeredCount/questions.length)*100}%`}} />
      </div>
      <div style={{fontSize:10,color:"#6b8a52",marginBottom:4}}>Question {qIdx+1} of {questions.length} • <span style={{background:"rgba(74,122,46,.1)",borderRadius:4,padding:"1px 5px",color:"#2d4a1e",fontWeight:700}}>{q.cat}</span></div>
      <div className="nc-card" style={{marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:16,lineHeight:1.6,color:"#1a2e0a"}}>{q.q}</div>
      </div>
      {q.options.map((opt,i)=>(
        <div key={i} onClick={()=>setAnswers(prev=>{const n=[...prev];n[qIdx]=i;return n;})}
          className={`nc-quiz-opt${answers[qIdx]===i?" selected":""}`}>
          <span style={{fontSize:11,opacity:.7,marginRight:6}}>{"ABCD"[i]}.</span>{opt}
          {answers[qIdx]===i&&<span style={{float:"right",color:"#4a7a2e",fontWeight:800}}>✓</span>}
        </div>
      ))}
      <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"space-between"}}>
        <button className="nc-btn" disabled={qIdx===0} onClick={()=>setQIdx(q=>q-1)}>← Prev</button>
        {qIdx<questions.length-1
          ?<button className="nc-btn nc-btn-primary" onClick={()=>setQIdx(q=>q+1)}>Next →</button>
          :<button className="nc-btn nc-btn-primary" onClick={()=>{if(confirm("Submit exam?"))submit();}}>Submit ✓</button>
        }
      </div>
    </div>
  );
}


// ── NC Specialty Exam View ─────────────────────────────────────────────────
