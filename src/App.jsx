import React, { useState, useEffect, useCallback, useRef } from "react";

// ─── IN-MEMORY CACHE + LOCAL STORAGE (L1 + L2) ──────────────────────
// _mem is the primary in-process cache. Reads hit _mem first (zero-cost),
// then fall through to localStorage, then to the supplied default.
const _mem = {};
const _lsAvail = (() => { try { localStorage.setItem("__t","1"); localStorage.removeItem("__t"); return true; } catch { return false; } })();
const ls = (k, d) => {
  if (_mem[k] !== undefined) return _mem[k];           // L1 hit
  try {
    if (_lsAvail) { const v = localStorage.getItem(k); if (v !== null) { const p = JSON.parse(v); _mem[k] = p; return p; } }
  } catch {}
  return d;
};
const lsSet = (k, v) => {
  _mem[k] = v;
  try { if (_lsAvail) localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

// ─── BACKEND STORAGE (window.storage - persistent across devices) ────
// shared:true  = all users see this data (admin-managed content)
// shared:false = private per-user data
const bsGet = async (key, shared = true) => {
  try {
    if (typeof window === "undefined" || !window.storage) return null;
    const r = await window.storage.get(key, shared);
    if (!r || r.value === undefined || r.value === null) return null;
    return JSON.parse(r.value);
  } catch { return null; }
};
const bsSet = async (key, val, shared = true) => {
  try {
    if (typeof window === "undefined" || !window.storage) return;
    await window.storage.set(key, JSON.stringify(val), shared);
  } catch {}
};

// Dual-write: localStorage first (instant UI) + backend async (persistence)
// For shared admin-managed data:
const dbSet = (lsKey, bsKey, val) => { lsSet(lsKey, val); bsSet(bsKey, val, true); };
// For private per-user data:
const dbSetUser = (lsKey, bsKey, val) => { lsSet(lsKey, val); bsSet(bsKey, val, false); };

// Pull from backend, hydrate localStorage, return value (or local fallback)
const dbLoad = async (lsKey, bsKey, fallback, shared = true) => {
  try { const remote = await bsGet(bsKey, shared); if (remote !== null) { lsSet(lsKey, remote); return remote; } } catch {}
  return ls(lsKey, fallback);
};

// Shared (admin-managed) storage keys: [localStorage key, backend key]
const SK = {
  users:         ["nv-users",         "db:users"],
  classes:       ["nv-classes",       "db:classes"],
  drugs:         ["nv-drugs",         "db:drugs"],
  labs:          ["nv-labs",          "db:labs"],
  pq:            ["nv-pq",            "db:pq"],
  decks:         ["nv-decks",         "db:decks"],
  dict:          ["nv-dict",          "db:dict"],
  skills:        ["nv-skillsdb",      "db:skills"],
  announcements: ["nv-announcements", "db:announcements"],
  handouts:      ["nv-handouts",      "db:handouts"],
  essayBanks:    ["nv-essay-banks",   "db:essay-banks"],
  classExams:    ["nv-class-exams",   "db:class-exams"],
};
// saveShared: write to cache+localStorage immediately, fire backend async, notify React subscribers
const _sharedSubs = {}; // key → Set of () => void
const notifyKey = (key) => { (_sharedSubs[key] || new Set()).forEach(fn => fn()); };
const saveShared = (key, val) => {
  const [lk, bk] = SK[key]; dbSet(lk, bk, val); notifyKey(key);
};
const loadShared = async (key, fallback) => { const [lk, bk] = SK[key]; return dbLoad(lk, bk, fallback, true); };

// ─── useShared(key, fallback) ─────────────────────────────────────────
// Reactive hook: returns current value from cache and auto-rerenders when
// saveShared() is called or hydrateFromBackend() completes for this key.
const useShared = (key, fallback) => {
  const [lk] = SK[key] || ["__unknown__"];
  const [val, setVal] = useState(() => ls(lk, fallback));
  useEffect(() => {
    const refresh = () => setVal(ls(lk, fallback));
    if (!_sharedSubs[key]) _sharedSubs[key] = new Set();
    _sharedSubs[key].add(refresh);
    // Also listen for the global hydration event
    window.addEventListener("nv:shared-hydrated", refresh);
    return () => {
      _sharedSubs[key].delete(refresh);
      window.removeEventListener("nv:shared-hydrated", refresh);
    };
  }, [key]);
  return val;
};

// ─── useMyData(suffix, lsKey, fallback) ──────────────────────────────
// Reactive hook for per-user private data. Re-renders when backend hydration
// pushes fresh data to cache after login.
const _userSubs = {}; // lsKey → Set of () => void
const notifyUserKey = (lsKey) => { (_userSubs[lsKey] || new Set()).forEach(fn => fn()); };
const saveMyDataNotify = (suffix, lsKey, val) => {
  lsSet(lsKey, val);
  if (_currentUser) bsSet(uKey(_currentUser, suffix), val, false);
  notifyUserKey(lsKey);
};
const useMyData = (lsKey, fallback) => {
  const [val, setVal] = useState(() => ls(lsKey, fallback));
  useEffect(() => {
    const refresh = () => setVal(ls(lsKey, fallback));
    if (!_userSubs[lsKey]) _userSubs[lsKey] = new Set();
    _userSubs[lsKey].add(refresh);
    window.addEventListener("nv:user-hydrated", refresh);
    return () => {
      _userSubs[lsKey].delete(refresh);
      window.removeEventListener("nv:user-hydrated", refresh);
    };
  }, [lsKey]);
  return val;
};


// ─── useHydratedShared(lsKey, skKey, fallback) ───────────────────────
// Drop-in upgrade for components using useState(()=>ls(lsKey, fallback)).
// Returns [val, setVal] where setVal also persists to backend via saveShared.
const useHydratedShared = (lsKey, skKey, fallback) => {
  const [val, setValInner] = useState(() => ls(lsKey, fallback));
  useEffect(() => {
    const refresh = () => setValInner(ls(lsKey, fallback));
    if (skKey && _sharedSubs[skKey]) {
      _sharedSubs[skKey].add(refresh);
    }
    window.addEventListener("nv:shared-hydrated", refresh);
    return () => {
      if (skKey && _sharedSubs[skKey]) _sharedSubs[skKey].delete(refresh);
      window.removeEventListener("nv:shared-hydrated", refresh);
    };
  }, [lsKey, skKey]);
  const setVal = useCallback((v) => {
    setValInner(v);
    if (skKey) saveShared(skKey, v);
    else lsSet(lsKey, v);
  }, [lsKey, skKey]);
  return [val, setVal];
};

// ─── useHydratedUser(lsKey, suffix, fallback) ────────────────────────
// Drop-in upgrade for per-user data components.
const useHydratedUser = (lsKey, suffix, fallback) => {
  const [val, setValInner] = useState(() => ls(lsKey, fallback));
  useEffect(() => {
    const refresh = () => setValInner(ls(lsKey, fallback));
    if (!_userSubs[lsKey]) _userSubs[lsKey] = new Set();
    _userSubs[lsKey].add(refresh);
    window.addEventListener("nv:user-hydrated", refresh);
    return () => {
      _userSubs[lsKey].delete(refresh);
      window.removeEventListener("nv:user-hydrated", refresh);
    };
  }, [lsKey]);
  const setVal = useCallback((v) => {
    setValInner(v);
    saveMyData(suffix, lsKey, v);
  }, [lsKey, suffix]);
  return [val, setVal];
};


const saveUser = (user, suffix, lsKey, val) => { lsSet(lsKey, val); bsSet(uKey(user, suffix), val, false); };
const loadUser = async (user, suffix, lsKey, fallback) => dbLoad(lsKey, uKey(user, suffix), fallback, false);

// Module-level current user ref (set on login, used by components for backend saves)
let _currentUser = "";
const setCurrentUserRef = (u) => { _currentUser = u; };
const saveMyData = (suffix, lsKey, val) => {
  lsSet(lsKey, val);
  if (_currentUser) bsSet(uKey(_currentUser, suffix), val, false);
  notifyUserKey(lsKey);
};

// ─── ESSAY SUBMISSION BACKEND ────────────────────────────────────────
const saveEssaySubmissionToBackend = async (studentEmail, bankId, data) => {
  const key = `essay-sub:${bankId}:${studentEmail}`;
  await bsSet(key, data, true);
  try {
    const idx = await bsGet("essay-submissions-index", true) || [];
    const entry = { key, student: studentEmail, bankId: String(bankId), date: data.date, graded: !!(data.manualGrade || data.feedback) };
    await bsSet("essay-submissions-index", [...idx.filter(e => e.key !== key), entry], true);
  } catch {}
};

const saveManualGradeToBackend = async (studentEmail, bankId, gradeData) => {
  const key = `essay-sub:${bankId}:${studentEmail}`;
  const existing = await bsGet(key, true) || {};
  const updated = { ...existing, manualGrade: gradeData, gradedDate: new Date().toLocaleDateString(), graded: true };
  await bsSet(key, updated, true);
  const idx = await bsGet("essay-submissions-index", true) || [];
  await bsSet("essay-submissions-index", idx.map(e => e.key === key ? { ...e, graded: true } : e), true);
  // Mirror grade to student private storage so they see the result
  const attKey = `nv-essay-att-${studentEmail}`;
  const att = ls(attKey, {});
  att[String(bankId)] = { ...att[String(bankId)], manualGrade: gradeData, gradedDate: new Date().toLocaleDateString() };
  lsSet(attKey, att);
  await bsSet(uKey(studentEmail, "essay-att"), att, false);
  return updated;
};
// ─── DEFAULT DATA ───────────────────────────────────────────────────
const DEFAULT_CLASSES = [
  { id:"nd1", label:"ND ONE", desc:"National Diploma Year One", courses:["Anatomy & Physiology","Community Health","Pharmacology","Nursing Fundamentals"], color:"#3E8E95" },
  { id:"nd2", label:"ND TWO", desc:"National Diploma Year Two", courses:["Medical-Surgical Nursing","Maternal Health","Paediatrics","Mental Health"], color:"#3E8E95" },
  { id:"hnd1", label:"HND ONE", desc:"Higher National Diploma Year One", courses:["Advanced Pharmacology","Research Methods","Epidemiology","Clinical Practicum"], color:"#5aada0" },
  { id:"hnd2", label:"HND TWO", desc:"Higher National Diploma Year Two", courses:["Health Policy","Nursing Leadership","Evidence-Based Practice","Thesis"], color:"#5aada0" },
  { id:"cn1", label:"CN YEAR 1", desc:"Community Nursing Year One", courses:["Community Assessment","Health Promotion","Family Nursing","Biostatistics","Environmental Health"], color:"#facc15" },
  { id:"cn2", label:"CN YEAR 2", desc:"Community Nursing Year Two", courses:["Occupational Health","School Health","Geriatric Care","Disaster Nursing","Practicum"], color:"#facc15" },
  { id:"bnsc1", label:"BNSc 1", desc:"Bachelor of Nursing Science Year One", courses:["Human Anatomy","Physiology","Biochemistry","Sociology","Nursing Theory"], color:"#a78bfa" },
  { id:"bnsc2", label:"BNSc 2", desc:"Bachelor of Nursing Science Year Two", courses:["Pathophysiology","Pharmacology","Med-Surg Nursing","Nutrition","Psychology"], color:"#a78bfa" },
  { id:"bnsc3", label:"BNSc 3", desc:"Bachelor of Nursing Science Year Three", courses:["Maternal-Child Nursing","Psychiatric Nursing","Critical Care","Research I","Practicum"], color:"#f472b6" },
  { id:"bnsc4", label:"BNSc 4", desc:"Bachelor of Nursing Science Year Four", courses:["Advanced Practice","Health Systems","Leadership","Research II","Elective"], color:"#f472b6" },
  { id:"bnscf", label:"BNSc FINAL", desc:"Bachelor of Nursing Science Final Year", courses:["Capstone Project","Clinical Leadership","Health Policy","Advanced Practicum","Dissertation"], color:"#fb923c" },
];
const DEFAULT_DRUGS = [
  { id:1, name:"Paracetamol", class:"Analgesic/Antipyretic", dose:"500-1000mg every 4-6h", max:"4g/day", uses:"Pain, fever", contraindications:"Liver disease", side_effects:"Rare at therapeutic doses; overdose causes hepatotoxicity" },
  { id:2, name:"Amoxicillin", class:"Penicillin Antibiotic", dose:"250-500mg every 8h", max:"3g/day", uses:"Bacterial infections", contraindications:"Penicillin allergy", side_effects:"Rash, diarrhea, nausea" },
  { id:3, name:"Metronidazole", class:"Antiprotozoal/Antibiotic", dose:"400-500mg every 8h", max:"4g/day", uses:"Anaerobic infections, H.pylori", contraindications:"1st trimester pregnancy", side_effects:"Metallic taste, nausea, disulfiram-like reaction with alcohol" },
  { id:4, name:"Ibuprofen", class:"NSAID", dose:"400-600mg every 6-8h", max:"2400mg/day", uses:"Pain, inflammation, fever", contraindications:"Peptic ulcer, renal impairment", side_effects:"GI irritation, renal impairment, CVS risk" },
  { id:5, name:"Omeprazole", class:"Proton Pump Inhibitor", dose:"20-40mg once daily", max:"80mg/day", uses:"GERD, peptic ulcer", contraindications:"Hypersensitivity", side_effects:"Headache, diarrhea, hypomagnesemia" },
];
const DEFAULT_LABS = [
  { id:1, test:"Haemoglobin (Hb)", male:"13.5–17.5 g/dL", female:"12.0–15.5 g/dL", notes:"Low = anaemia; High = polycythaemia" },
  { id:2, test:"WBC Count", male:"4.5–11.0 ×10³/μL", female:"4.5–11.0 ×10³/μL", notes:"High = infection/inflammation; Low = immunosuppression" },
  { id:3, test:"Platelets", male:"150–400 ×10³/μL", female:"150–400 ×10³/μL", notes:"Low = bleeding risk; High = thrombosis risk" },
  { id:4, test:"Random Blood Sugar", male:"<11.1 mmol/L", female:"<11.1 mmol/L", notes:"≥11.1 mmol/L suggests diabetes" },
  { id:5, test:"Fasting Blood Sugar", male:"3.9–5.5 mmol/L", female:"3.9–5.5 mmol/L", notes:"5.6–6.9 = prediabetes; ≥7.0 = diabetes" },
];
const DEFAULT_PQ = [
  { id:1, subject:"Anatomy & Physiology", year:"2023", questions:[
    { q:"Which part of the brain controls balance and coordination?", options:["Cerebrum","Cerebellum","Medulla Oblongata","Thalamus"], ans:1 },
    { q:"The normal adult heart rate is:", options:["40–60 bpm","60–100 bpm","100–120 bpm","120–140 bpm"], ans:1 },
  ]},
  { id:2, subject:"Pharmacology", year:"2023", questions:[
    { q:"The antidote for paracetamol overdose is:", options:["Naloxone","Flumazenil","N-Acetylcysteine","Atropine"], ans:2 },
  ]},
];
const DEFAULT_DECKS = [
  { id:"vital-signs", name:"Vital Signs", cards:[
    { id:1, front:"Normal adult temperature", back:"36.1°C – 37.2°C (97°F – 99°F)" },
    { id:2, front:"Normal adult pulse rate", back:"60–100 bpm" },
    { id:3, front:"Normal SpO2", back:"95–100%" },
  ]},
  { id:"nursing-procedures", name:"Nursing Procedures", cards:[
    { id:1, front:"5 Rights of Medication", back:"Right Patient, Right Drug, Right Dose, Right Route, Right Time" },
    { id:2, front:"Glasgow Coma Scale range", back:"3–15 (3 = deep coma, 15 = fully conscious)" },
  ]},
];
const DEFAULT_DICT = [
  { id:1, term:"Aetiology", def:"The cause or origin of a disease or condition" },
  { id:2, term:"Analgesia", def:"Absence of pain sensation without loss of consciousness" },
  { id:3, term:"Bradycardia", def:"A heart rate below 60 beats per minute" },
  { id:4, term:"Cyanosis", def:"Bluish discolouration of skin due to inadequate oxygen" },
  { id:5, term:"Dyspnoea", def:"Difficulty breathing or shortness of breath" },
];
const DEFAULT_SKILLS = [
  { id:1, name:"IV cannulation" }, { id:2, name:"Urinary catheterisation" },
  { id:3, name:"Wound dressing" }, { id:4, name:"Blood glucose monitoring" },
  { id:5, name:"Basic Life Support (BLS)" },
];
const DEFAULT_ANNOUNCEMENTS = [
  { id:1, title:"Welcome to Nursing Academic Hub!", body:"Your nursing study platform is ready. Explore all features.", date:"Today", pinned:true },
];

// ─── INIT STORAGE ───────────────────────────────────────────────────
// Seeds localStorage with defaults on first run, then backend hydrates over it
const initData = () => {
  if (!ls("nv-classes", null)) lsSet("nv-classes", DEFAULT_CLASSES);
  if (!ls("nv-drugs", null)) lsSet("nv-drugs", DEFAULT_DRUGS);
  if (!ls("nv-labs", null)) lsSet("nv-labs", DEFAULT_LABS);
  if (!ls("nv-pq", null)) lsSet("nv-pq", DEFAULT_PQ);
  if (!ls("nv-decks", null)) lsSet("nv-decks", DEFAULT_DECKS);
  if (!ls("nv-dict", null)) lsSet("nv-dict", DEFAULT_DICT);
  if (!ls("nv-skillsdb", null)) lsSet("nv-skillsdb", DEFAULT_SKILLS);
  if (!ls("nv-announcements", null)) lsSet("nv-announcements", DEFAULT_ANNOUNCEMENTS);
  if (!ls("nv-users", null)) lsSet("nv-users", [{username:"admin@gmail.com",password:"admin123",role:"admin",class:"",joined:"System"}]);
};
// Run immediately at module load so _mem is populated before first render
initData();

// Hydrate all shared data from backend in parallel.
// After each key resolves, notify its React subscribers immediately so the
// UI updates key-by-key rather than waiting for the full batch.
const hydrateFromBackend = async () => {
  const defaults = {
    users: [{username:"admin@gmail.com",password:"admin123",role:"admin",class:"",joined:"System"}],
    classes: DEFAULT_CLASSES, drugs: DEFAULT_DRUGS, labs: DEFAULT_LABS,
    pq: DEFAULT_PQ, decks: DEFAULT_DECKS, dict: DEFAULT_DICT,
    skills: DEFAULT_SKILLS, announcements: DEFAULT_ANNOUNCEMENTS,
    handouts: [], essayBanks: [], classExams: [],
  };
  // Use allSettled so one failing key never blocks the rest
  await Promise.allSettled(
    Object.keys(SK).map(async key => {
      try { await loadShared(key, defaults[key] || []); notifyKey(key); } catch {}
    })
  );
  window.dispatchEvent(new CustomEvent("nv:shared-hydrated"));
};

// ─── STYLES ─────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&family=Instrument+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
:root{
  --bg:#1a3a40;--bg2:#163238;--bg3:#122b30;--bg4:#0f2428;
  --card:#1e4048;--card2:#244850;
  --accent:#3E8E95;--accent2:#5aada0;--accent3:#BFD2C5;
  --warn:#fb923c;--danger:#f87171;--success:#4ade80;--purple:#a78bfa;
  --border:rgba(255,255,255,0.09);--border2:rgba(255,255,255,0.18);
  --text:#e8f4f5;--text2:#a8c5c8;--text3:#5a8a8e;
  --radius:14px;--radius2:10px;
  --admin:#7c3aed;--admin2:#6d28d9;
}
body{font-family:'Instrument Sans',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden;}
body.light{
  --bg:#eef5f6;--bg2:#e0ecee;--bg3:#d2e4e7;--bg4:#c2d8dc;
  --card:#ddeef0;--card2:#cde4e7;
  --border:rgba(0,80,90,0.12);--border2:rgba(0,80,90,0.24);
  --text:#0f2d32;--text2:#2a6068;--text3:#6a9ea4;
}
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-thumb{background:var(--accent);border-radius:10px;}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
@keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
@keyframes slideIn{from{transform:translateX(110%);opacity:0;}to{transform:translateX(0);opacity:1;}}
@keyframes spin{to{transform:rotate(360deg);}}

/* AUTH */
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:url('https://images.unsplash.com/photo-1544717305-2782549b5136?w=1600&q=80') center/cover no-repeat;padding:20px;position:relative;}
.auth-page::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(5,18,35,0.72) 0%,rgba(10,30,50,0.60) 50%,rgba(5,18,35,0.78) 100%);backdrop-filter:blur(1px);}
.auth-page > *{position:relative;z-index:1;}
.auth-card{background:rgba(10,22,40,0.78);border:1px solid rgba(62,142,149,0.35);border-radius:22px;padding:38px 34px;width:100%;max-width:420px;animation:fadeUp .5s ease;box-shadow:0 40px 80px rgba(0,0,0,.6),0 0 0 1px rgba(62,142,149,0.1) inset;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}
.auth-logo{display:flex;align-items:center;gap:10px;margin-bottom:5px;}
.auth-logo-icon{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:20px;}
.auth-logo-name{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:var(--accent);}
.auth-sub{font-family:'DM Mono',monospace;font-size:11px;color:var(--text3);margin-bottom:26px;}
.auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:20px;}
.auth-tab{padding:9px;text-align:center;border-radius:9px;border:1px solid var(--border);font-family:'DM Mono',monospace;font-size:12px;cursor:pointer;color:var(--text3);background:transparent;transition:all .2s;}
.auth-tab.active{background:rgba(62,142,149,.15);border-color:var(--accent);color:var(--accent);}
.admin-tab-hint{text-align:center;margin-bottom:14px;font-size:11px;font-family:'DM Mono',monospace;color:var(--admin);background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.2);border-radius:8px;padding:6px;}
.lbl{font-family:'DM Mono',monospace;font-size:10px;color:var(--text3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:5px;display:block;}
.inp{width:100%;background:var(--bg4);border:1px solid var(--border);border-radius:9px;padding:11px 14px;color:var(--text);font-size:14px;font-family:'Instrument Sans',sans-serif;outline:none;transition:border-color .2s;margin-bottom:13px;}
.inp:focus{border-color:var(--accent);}
.inp-wrap{position:relative;margin-bottom:13px;}
.inp-wrap .inp{margin-bottom:0;}
.inp-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text3);cursor:pointer;font-size:15px;}
.btn-primary{width:100%;padding:13px;background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;border-radius:10px;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:white;cursor:pointer;transition:all .2s;margin-top:4px;}
.btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 24px rgba(62,142,149,.3);}
.btn-primary.loading,.btn-primary:disabled{opacity:.7;cursor:not-allowed;transform:none;}
.btn-admin{background:linear-gradient(135deg,var(--admin),var(--admin2));}
.btn-admin:hover{box-shadow:0 8px 24px rgba(124,58,237,.3);}
.auth-switch{text-align:center;margin-top:12px;font-size:12px;color:var(--text3);font-family:'DM Mono',monospace;}
.auth-switch span{color:var(--accent);cursor:pointer;text-decoration:underline;}
.auth-notice{background:rgba(251,191,36,.07);border:1px solid rgba(251,191,36,.2);border-radius:10px;padding:10px 14px;font-size:11px;color:#fbbf24;font-family:'DM Mono',monospace;margin-top:16px;line-height:1.6;display:flex;gap:8px;}

/* SHELL */
.app-shell{display:flex;height:100vh;overflow:hidden;}
.sidebar{width:240px;min-width:240px;background:var(--bg3);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;padding:0 0 20px;z-index:10;transition:transform .3s;}
.sidebar-head{padding:16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:9px;}
.sidebar-logo-icon{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:17px;}
.sidebar-logo-name{font-family:'Syne',sans-serif;font-size:19px;font-weight:800;color:var(--accent);}
.admin-badge-side{display:inline-flex;align-items:center;gap:4px;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);border-radius:20px;padding:2px 8px;font-size:10px;font-family:'DM Mono',monospace;color:var(--purple);margin-left:auto;}
.nav-sec{padding:12px 16px 3px;font-family:'DM Mono',monospace;font-size:9px;color:var(--text3);letter-spacing:1.5px;text-transform:uppercase;}
.nav-item{display:flex;align-items:center;gap:9px;padding:9px 16px;margin:1px 8px;border-radius:9px;cursor:pointer;font-size:13.5px;color:var(--text2);transition:all .15s;user-select:none;}
.nav-item:hover{background:rgba(62,142,149,.1);color:var(--text);}
.nav-item.active{background:rgba(62,142,149,.18);color:var(--accent);}
.nav-item.admin-nav{color:var(--purple);}
.nav-item.admin-nav:hover{background:rgba(124,58,237,.1);}
.nav-item.admin-nav.active{background:rgba(124,58,237,.18);color:var(--purple);}
.nav-icon{font-size:15px;width:20px;text-align:center;flex-shrink:0;}
.class-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.main-area{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.topbar{padding:13px 22px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);background:var(--bg3);flex-shrink:0;gap:10px;}
.topbar-left{display:flex;align-items:center;gap:10px;}
.topbar-title{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;}
.topbar-right{display:flex;align-items:center;gap:8px;}
.theme-btn{background:rgba(62,142,149,.1);border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:11px;font-family:'DM Mono',monospace;color:var(--text2);cursor:pointer;transition:all .2s;}
.theme-btn:hover{border-color:var(--accent);color:var(--accent);}
.icon-btn{width:34px;height:34px;border-radius:50%;background:rgba(62,142,149,.1);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;transition:all .2s;}
.icon-btn:hover{border-color:var(--accent);}
.page-content{flex:1;overflow-y:auto;padding:22px 24px;}
.hamburger{display:none;background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9;}

/* CARDS / COMMON */
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px;}
.card2{background:var(--card2);border:1px solid var(--border);border-radius:var(--radius2);padding:14px;}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;animation:fadeUp .4s ease both;}
.stat-lbl{font-family:'DM Mono',monospace;font-size:9px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin-bottom:5px;}
.stat-val{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--accent);}
.stat-sub{font-size:11px;color:var(--text3);margin-top:3px;}
.sec-title{font-family:'Syne',sans-serif;font-size:18px;font-weight:700;margin-bottom:4px;}
.sec-sub{font-size:12px;color:var(--text3);font-family:'DM Mono',monospace;margin-bottom:16px;}
.search-wrap{position:relative;margin-bottom:18px;}
.search-wrap input{width:100%;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px 10px 36px;color:var(--text);font-size:14px;font-family:'Instrument Sans',sans-serif;outline:none;transition:border-color .2s;}
.search-wrap input:focus{border-color:var(--accent);}
.search-ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text3);font-size:14px;}
.class-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;cursor:pointer;transition:all .2s;animation:fadeUp .4s ease both;position:relative;overflow:hidden;}
.class-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--cc);}
.class-card:hover{border-color:var(--cc);transform:translateY(-2px);}
.class-tag{display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-family:'DM Mono',monospace;font-weight:600;margin-bottom:8px;color:var(--cc);background:rgba(62,142,149,.1);}
.class-name{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;margin-bottom:4px;}
.class-desc{font-size:12px;color:var(--text3);margin-bottom:10px;line-height:1.5;}
.class-meta{display:flex;gap:14px;font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;}

/* BUTTONS */
.btn{padding:8px 16px;border-radius:9px;border:1px solid var(--border);font-family:'Instrument Sans',sans-serif;font-size:13px;cursor:pointer;transition:all .2s;background:transparent;color:var(--text2);}
.btn:hover{border-color:var(--border2);color:var(--text);}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.btn-accent{background:var(--accent);border-color:var(--accent);color:white;font-weight:600;}
.btn-accent:hover{background:var(--accent2);border-color:var(--accent2);}
.btn-sm{padding:5px 11px;font-size:12px;border-radius:7px;}
.btn-danger{background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.3);color:var(--danger);}
.btn-danger:hover{background:rgba(248,113,113,.22);}
.btn-purple{background:var(--admin);border-color:var(--admin);color:white;font-weight:600;}
.btn-purple:hover{background:var(--admin2);}
.btn-success{background:rgba(74,222,128,.15);border-color:rgba(74,222,128,.3);color:var(--success);font-weight:600;}
.btn-warn{background:rgba(251,146,60,.12);border-color:rgba(251,146,60,.3);color:var(--warn);}

/* MODAL */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px;animation:fadeIn .2s;}
.modal{background:var(--bg2);border:1px solid var(--border2);border-radius:18px;padding:26px;width:100%;max-width:540px;max-height:88vh;overflow-y:auto;animation:fadeUp .3s ease;}
.modal.lg{max-width:720px;}
.modal.xl{max-width:900px;}
.modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;}
.modal-title{font-family:'Syne',sans-serif;font-size:17px;font-weight:700;}
.modal-close{background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer;padding:2px 8px;border-radius:6px;transition:all .2s;}
.modal-close:hover{background:rgba(255,255,255,.08);color:var(--text);}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}

/* TABLES */
.tbl{width:100%;border-collapse:collapse;}
.tbl th{padding:10px 12px;text-align:left;font-size:10px;font-family:'DM Mono',monospace;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--border);}
.tbl td{padding:11px 12px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:middle;}
.tbl tbody tr:hover{background:rgba(62,142,149,.05);}
.tbl tbody tr:last-child td{border-bottom:none;}
.tbl-actions{display:flex;gap:6px;align-items:center;}

/* TAGS */
.tag{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-family:'DM Mono',monospace;border:1px solid var(--border);}
.tag-accent{background:rgba(62,142,149,.15);border-color:var(--accent);color:var(--accent);}
.tag-success{background:rgba(74,222,128,.1);border-color:var(--success);color:var(--success);}
.tag-warn{background:rgba(251,146,60,.1);border-color:var(--warn);color:var(--warn);}
.tag-danger{background:rgba(248,113,113,.1);border-color:var(--danger);color:var(--danger);}
.tag-purple{background:rgba(167,139,250,.1);border-color:var(--purple);color:var(--purple);}

/* TOAST */
.toast-wrap{position:fixed;bottom:22px;right:22px;display:flex;flex-direction:column;gap:8px;z-index:9999;}
.toast{background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:11px 15px;font-size:13px;font-family:'DM Mono',monospace;animation:slideIn .3s ease;box-shadow:0 8px 24px rgba(0,0,0,.3);display:flex;align-items:center;gap:8px;min-width:220px;}
.toast.success{border-left:3px solid var(--success);}
.toast.error{border-left:3px solid var(--danger);}
.toast.info{border-left:3px solid var(--accent);}
.toast.warn{border-left:3px solid var(--warn);}

/* ADMIN SPECIFIC */
.admin-header{background:linear-gradient(135deg,rgba(124,58,237,.15),rgba(109,40,217,.08));border:1px solid rgba(124,58,237,.25);border-radius:14px;padding:20px 22px;margin-bottom:22px;display:flex;align-items:center;gap:14px;}
.admin-header-icon{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,var(--admin),var(--admin2));display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;}
.admin-header-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;}
.admin-header-sub{font-size:12px;color:var(--text3);font-family:'DM Mono',monospace;margin-top:2px;}
.admin-tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;}
.admin-tab{padding:7px 14px;border-radius:8px;border:1px solid var(--border);font-family:'DM Mono',monospace;font-size:12px;cursor:pointer;color:var(--text3);background:transparent;transition:all .2s;}
.admin-tab:hover{border-color:rgba(124,58,237,.4);color:var(--purple);}
.admin-tab.active{background:rgba(124,58,237,.18);border-color:var(--admin);color:var(--purple);}
.paste-box{width:100%;background:var(--bg4);border:1px dashed var(--border2);border-radius:9px;padding:12px 14px;color:var(--text);font-size:13px;font-family:'DM Mono',monospace;outline:none;resize:vertical;min-height:90px;margin-bottom:10px;line-height:1.6;}
.paste-box:focus{border-color:var(--accent);}
.parse-preview{background:var(--bg4);border:1px solid var(--border);border-radius:9px;padding:12px;margin-bottom:12px;max-height:200px;overflow-y:auto;}
.parse-item{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;font-family:'DM Mono',monospace;}
.parse-item:last-child{border-bottom:none;}
.parse-check{color:var(--success);font-size:14px;}
.section-divider{border:none;border-top:1px solid var(--border);margin:18px 0;}
.user-row{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg4);border-radius:10px;margin-bottom:8px;}
.user-av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;font-family:'Syne',sans-serif;color:white;flex-shrink:0;}
.progress-wrap{background:var(--bg4);border-radius:20px;height:6px;overflow:hidden;}
.progress-fill{height:100%;border-radius:20px;transition:width .5s;}

/* FLASHCARD */
.flashcard{width:100%;min-height:180px;perspective:1000px;cursor:pointer;}
.flashcard-inner{position:relative;width:100%;min-height:180px;transition:transform .6s;transform-style:preserve-3d;}
.flashcard-inner.flipped{transform:rotateY(180deg);}
.flashcard-front,.flashcard-back{position:absolute;width:100%;min-height:180px;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:var(--card2);border:1px solid var(--border);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;flex-direction:column;}
.flashcard-back{transform:rotateY(180deg);background:linear-gradient(135deg,rgba(62,142,149,.15),rgba(90,173,160,.08));border-color:var(--accent);}
.fc-lbl{font-family:'DM Mono',monospace;font-size:9px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em;}
.fc-text{font-family:'Syne',sans-serif;font-size:17px;font-weight:600;line-height:1.4;}

/* QUIZ */
.quiz-opt{padding:11px 15px;border:1px solid var(--border);border-radius:10px;cursor:pointer;margin-bottom:7px;transition:all .2s;font-size:14px;}
.quiz-opt:hover:not(.answered){border-color:var(--border2);background:rgba(255,255,255,.04);}
.quiz-opt.correct{border-color:var(--success);background:rgba(74,222,128,.1);color:var(--success);}
.quiz-opt.wrong{border-color:var(--danger);background:rgba(248,113,113,.1);color:var(--danger);}
.quiz-opt.reveal{border-color:var(--success);background:rgba(74,222,128,.06);}

/* GPA */
.gpa-bar-wrap{background:var(--bg4);border-radius:20px;height:8px;margin:12px 0;overflow:hidden;}
.gpa-bar{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:20px;transition:width .6s ease;}
.course-row{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg4);border-radius:10px;margin-bottom:8px;}

/* TT */
.tt-badge{display:inline-block;padding:3px 9px;border-radius:6px;font-size:11px;font-family:'DM Mono',monospace;font-weight:600;}

/* RESPONSIVE */
@media(max-width:900px){
  .sidebar{position:fixed;top:0;left:0;height:100vh;transform:translateX(-100%);}
  .sidebar.open{transform:translateX(0);}
  .sidebar-overlay.open{display:block;}
  .hamburger{display:block;}
  .grid5{grid-template-columns:repeat(3,1fr);}
  .grid4{grid-template-columns:repeat(2,1fr);}
  .grid3{grid-template-columns:repeat(2,1fr);}
}
@media(max-width:700px){.essay-cols{grid-template-columns:1fr !important;}}
@media(max-width:600px){
  .grid5,.grid4{grid-template-columns:repeat(2,1fr);}
  .grid3,.grid2{grid-template-columns:1fr;}
  .page-content{padding:14px;}
  .topbar{padding:11px 14px;}
  .form-row{grid-template-columns:1fr;}
}
`;

// ─── TOAST ──────────────────────────────────────────────────────────
function Toasts({ list }) {
  return <div className="toast-wrap">{list.map(t=><div key={t.id} className={`toast ${t.type}`}><span>{t.type==="success"?"✅":t.type==="error"?"❌":t.type==="warn"?"⚠️":"ℹ️"}</span>{t.msg}</div>)}</div>;
}

// ════════════════════════════════════════════════════════════════════
// ADMIN PANEL
// ════════════════════════════════════════════════════════════════════
function AdminPanel({ toast, currentUser }) {
  const [tab, setTab] = useState("overview");

  const TABS = [
    { key:"overview", label:"📊 Overview" },
    { key:"users", label:"👥 Users" },
    { key:"classes", label:"🏫 Classes" },
    { key:"drugs", label:"💊 Drugs" },
    { key:"labs", label:"🧪 Labs" },
    { key:"pq", label:"❓ Questions" },
    { key:"flashcards", label:"🃏 Flashcards" },
    { key:"dictionary", label:"📖 Dictionary" },
    { key:"skills", label:"✅ Skills" },
    { key:"announcements", label:"📢 Announcements" },
    { key:"handouts", label:"📄 Handouts" },
    { key:"retakes", label:"🔄 Exam Retakes" },
    { key:"essay", label:"✍️ Essay Exams" },
    { key:"firebase", label:"🔥 Firebase Console" },
  ];

  return (
    <div>
      <div className="admin-header">
        <div className="admin-header-icon">🛡️</div>
        <div>
          <div className="admin-header-title">Admin Control Panel</div>
          <div className="admin-header-sub">Logged in as <b style={{color:"var(--purple)"}}>{currentUser}</b> · Full system access</div>
        </div>
      </div>
      <div className="admin-tabs">
        {TABS.map(t=><div key={t.key} className={`admin-tab${tab===t.key?" active":""}`} onClick={()=>setTab(t.key)}>{t.label}</div>)}
      </div>
      {tab==="overview" && <AdminOverview toast={toast} />}
      {tab==="users" && <AdminUsers toast={toast} />}
      {tab==="classes" && <AdminClasses toast={toast} />}
      {tab==="drugs" && <AdminDrugs toast={toast} />}
      {tab==="labs" && <AdminLabs toast={toast} />}
      {tab==="pq" && <AdminPQ toast={toast} />}
      {tab==="flashcards" && <AdminFlashcards toast={toast} />}
      {tab==="dictionary" && <AdminDictionary toast={toast} />}
      {tab==="skills" && <AdminSkills toast={toast} />}
      {tab==="announcements" && <AdminAnnouncements toast={toast} />}
      {tab==="handouts" && <AdminHandouts toast={toast} />}
      {tab==="retakes" && <AdminExamRetakes toast={toast} />}
      {tab==="essay" && <AdminEssayExams toast={toast} />}
      {tab==="firebase" && <AdminFirebaseConsole toast={toast} />}
    </div>
  );
}

// ── Admin Firebase Console ───────────────────────────────────────────
const HARDCODED_FB_CONFIG = {
  apiKey: "AIzaSyDH5jtyCEDTUkhqw1gEOw8p7lxfzhUITpM",
  authDomain: "nurseexamprep-6956a.firebaseapp.com",
  databaseURL: "https://nurseexamprep-6956a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "nurseexamprep-6956a",
  storageBucket: "nurseexamprep-6956a.firebasestorage.app",
  messagingSenderId: "726798762408",
  appId: "1:726798762408:web:bd1aab8f4347aca04f1d9d"
};

function AdminFirebaseConsole({ toast }) {
  const [fbConfig, setFbConfig] = useState(HARDCODED_FB_CONFIG);
  const [configText, setConfigText] = useState(JSON.stringify(HARDCODED_FB_CONFIG, null, 2));
  const [showSetup, setShowSetup] = useState(false);
  const [fb, setFb] = useState(null);
  const [fbTab, setFbTab] = useState("firestore");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("disconnected"); // disconnected | connecting | connected | error
  const [statusMsg, setStatusMsg] = useState("");

  // Firestore state
  const [collections, setCollections] = useState([]);
  const [selectedCol, setSelectedCol] = useState(null);
  const [docs, setDocs] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [docData, setDocData] = useState(null);
  const [colLoading, setColLoading] = useState(false);

  // Query state
  const [queryCol, setQueryCol] = useState("");
  const [queryField, setQueryField] = useState("");
  const [queryOp, setQueryOp] = useState("==");
  const [queryVal, setQueryVal] = useState("");
  const [queryResults, setQueryResults] = useState(null);
  const [queryRunning, setQueryRunning] = useState(false);

  // Auth state
  const [authUsers, setAuthUsers] = useState([]);
  const [authLoading, setAuthLoading] = useState(false);

  // Manual doc write
  const [writeCol, setWriteCol] = useState("");
  const [writeDocId, setWriteDocId] = useState("");
  const [writeData, setWriteData] = useState("{\n  \n}");
  const [writeMode, setWriteMode] = useState("set");

  const loadFirebaseSDK = () => new Promise((resolve, reject) => {
    if (window._fbSDKLoaded) { resolve(); return; }
    const scripts = [
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js",
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js",
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js",
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js",
    ];
    let loaded = 0;
    scripts.forEach(src => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => { loaded++; if (loaded === scripts.length) { window._fbSDKLoaded = true; resolve(); } };
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  });

  const parseConfig = (text) => {
    try {
      // Try JSON parse first
      const clean = text.trim();
      if (clean.startsWith("{")) return JSON.parse(clean);
      // Try to extract from Firebase SDK snippet
      const m = clean.match(/apiKey:\s*["']([^"']+)["'].*?authDomain:\s*["']([^"']+)["'].*?projectId:\s*["']([^"']+)["'].*?storageBucket:\s*["']([^"']+)["'].*?messagingSenderId:\s*["']([^"']+)["'].*?appId:\s*["']([^"']+)["']/s);
      if (m) return { apiKey:m[1], authDomain:m[2], projectId:m[3], storageBucket:m[4], messagingSenderId:m[5], appId:m[6] };
      return null;
    } catch { return null; }
  };

  const connect = async () => {
    const cfg = parseConfig(configText);
    if (!cfg || !cfg.apiKey || !cfg.projectId) {
      toast("Invalid Firebase config. Paste your full config object or SDK snippet.", "error"); return;
    }
    setLoading(true); setStatus("connecting"); setStatusMsg("Loading Firebase SDK...");
    try {
      await loadFirebaseSDK();
      setStatusMsg("Initializing Firebase app...");
      // Delete existing app if any
      try { window.firebase.app("nv-admin").delete(); } catch {}
      const app = window.firebase.initializeApp(cfg, "nv-admin");
      setFb({ app, db: window.firebase.firestore(app), auth: window.firebase.auth(app), storage: window.firebase.storage(app) });
      setFbConfig(cfg);
      lsSet("nv-firebase-config", cfg);
      setStatus("connected"); setStatusMsg(`Connected to ${cfg.projectId}`);
      setShowSetup(false);
      toast(`Connected to Firebase project: ${cfg.projectId}`, "success");
      // Load collections
      loadCollections(window.firebase.firestore(app));
    } catch (e) {
      setStatus("error"); setStatusMsg(e.message);
      toast("Firebase connection failed: " + e.message, "error");
    }
    setLoading(false);
  };

  const disconnect = () => {
    try { if (fb?.app) fb.app.delete(); } catch {}
    setFb(null); setStatus("disconnected"); setStatusMsg("");
    setCollections([]); setDocs([]); setDocData(null); setSelectedCol(null); setSelectedDoc(null);
    toast("Disconnected. Reload the tab to reconnect.", "info");
  };

  // Auto-connect with hardcoded config on mount
  useEffect(() => {
    autoConnect();
  }, []);

  const autoConnect = async () => {
    setLoading(true); setStatus("connecting"); setStatusMsg("Loading Firebase SDK...");
    try {
      await loadFirebaseSDK();
      setStatusMsg("Initializing Firebase...");
      try { window.firebase.app("nv-admin").delete(); } catch {}
      const app = window.firebase.initializeApp(HARDCODED_FB_CONFIG, "nv-admin");
      const dbRef = window.firebase.firestore(app);
      setFb({ app, db: dbRef, auth: window.firebase.auth(app), storage: window.firebase.storage(app) });
      setStatus("connected"); setStatusMsg("Connected to " + HARDCODED_FB_CONFIG.projectId);
      loadCollections(dbRef);
    } catch (e) {
      setStatus("error"); setStatusMsg(e.message);
    }
    setLoading(false);
  };

  const loadCollections = async (db) => {
    // Firestore REST API to list collections (JS SDK doesn't support listing collections without collection group queries in web)
    // We'll use a common set + let admin add more
    setCollections(["users","courses","handouts","announcements","essays","notifications","settings"]);
  };

  const loadDocs = async (colName) => {
    if (!fb) return;
    setColLoading(true); setDocs([]); setDocData(null); setSelectedDoc(null);
    try {
      const snap = await fb.db.collection(colName).limit(50).get();
      setDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { toast("Error loading collection: " + e.message, "error"); }
    setColLoading(false);
  };

  const loadDoc = async (colName, docId) => {
    if (!fb) return;
    try {
      const snap = await fb.db.collection(colName).doc(docId).get();
      setDocData(snap.exists ? snap.data() : null);
      setSelectedDoc(docId);
    } catch (e) { toast("Error loading document: " + e.message, "error"); }
  };

  const deleteDoc = async (colName, docId) => {
    if (!fb || !confirm(`Delete document "${docId}" from "${colName}"?`)) return;
    try {
      await fb.db.collection(colName).doc(docId).delete();
      toast("Document deleted", "success");
      loadDocs(colName);
    } catch (e) { toast("Delete failed: " + e.message, "error"); }
  };

  const runQuery = async () => {
    if (!fb || !queryCol) { toast("Enter a collection name", "error"); return; }
    setQueryRunning(true); setQueryResults(null);
    try {
      let ref = fb.db.collection(queryCol);
      if (queryField && queryVal) {
        let val = queryVal;
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (!isNaN(val) && val !== "") val = Number(val);
        ref = ref.where(queryField, queryOp, val);
      }
      const snap = await ref.limit(100).get();
      setQueryResults(snap.docs.map(d => ({ _id: d.id, ...d.data() })));
      toast(`${snap.size} document${snap.size===1?"":"s"} found`, "success");
    } catch (e) { toast("Query error: " + e.message, "error"); }
    setQueryRunning(false);
  };

  const writeDoc = async () => {
    if (!fb || !writeCol) { toast("Collection name required", "error"); return; }
    try {
      const data = JSON.parse(writeData);
      if (writeMode === "add") {
        const ref = await fb.db.collection(writeCol).add({ ...data, _createdAt: new Date().toISOString() });
        toast(`Document added: ${ref.id}`, "success");
      } else if (writeMode === "set") {
        if (!writeDocId) { toast("Document ID required for set", "error"); return; }
        await fb.db.collection(writeCol).doc(writeDocId).set(data, { merge: true });
        toast(`Document set/merged: ${writeDocId}`, "success");
      } else if (writeMode === "delete") {
        if (!writeDocId) { toast("Document ID required for delete", "error"); return; }
        if (!confirm(`Delete "${writeDocId}" from "${writeCol}"?`)) return;
        await fb.db.collection(writeCol).doc(writeDocId).delete();
        toast("Document deleted", "success");
      }
      if (selectedCol === writeCol) loadDocs(writeCol);
    } catch (e) { toast("Write error: " + (e.message || "Invalid JSON"), "error"); }
  };

  const statusColor = { disconnected:"var(--text3)", connecting:"var(--warn)", connected:"var(--success)", error:"var(--danger)" }[status];
  const statusIcon = { disconnected:"⚫", connecting:"🟡", connected:"🟢", error:"🔴" }[status];

  const FB_TABS = [
    { key:"firestore", label:"📂 Firestore" },
    { key:"query", label:"🔍 Query" },
    { key:"write", label:"✏️ Write/Delete" },
    { key:"auth", label:"👤 Auth Users" },
    { key:"config", label:"⚙️ Config" },
  ];

  const renderFirestore = () => (
    <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:14,minHeight:400}}>
      {/* Collections panel */}
      <div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)",textTransform:"uppercase",marginBottom:8,letterSpacing:".08em"}}>Collections</div>
        {collections.map(col => (
          <div key={col}
            onClick={() => { setSelectedCol(col); loadDocs(col); }}
            style={{padding:"8px 12px",borderRadius:8,cursor:"pointer",fontSize:13,fontFamily:"'DM Mono',monospace",
              background: selectedCol===col ? "rgba(62,142,149,.2)" : "transparent",
              border: selectedCol===col ? "1px solid var(--accent)" : "1px solid transparent",
              color: selectedCol===col ? "var(--accent)" : "var(--text2)",
              marginBottom:4, transition:"all .15s"
            }}>
            📂 {col}
          </div>
        ))}
        <div style={{marginTop:10}}>
          <input className="inp" placeholder="+ collection name" style={{padding:"7px 10px",fontSize:12,marginBottom:0}}
            onKeyDown={e=>{ if(e.key==="Enter"&&e.target.value.trim()){setCollections(c=>[...new Set([...c,e.target.value.trim()])]);e.target.value="";}}} />
        </div>
      </div>

      {/* Documents panel */}
      <div>
        {!selectedCol ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300,color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:13}}>
            ← Select a collection to browse documents
          </div>
        ) : colLoading ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:13}}>
            Loading...
          </div>
        ) : (
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>
                📂 {selectedCol} <span style={{color:"var(--text3)",fontWeight:400,fontSize:12}}>({docs.length} docs)</span>
              </div>
              <button className="btn btn-sm btn-accent" onClick={()=>loadDocs(selectedCol)}>↻ Refresh</button>
            </div>
            {docs.length === 0 ? (
              <div style={{background:"var(--bg4)",borderRadius:10,padding:20,textAlign:"center",color:"var(--text3)",fontSize:13}}>
                No documents in this collection (or collection doesn't exist)
              </div>
            ) : (
              <div style={{display:"grid",gap:8}}>
                {docs.map(doc => (
                  <div key={doc.id} className="card" style={{padding:"10px 14px",cursor:"pointer",transition:"all .15s",
                    border: selectedDoc===doc.id ? "1px solid var(--accent)" : "1px solid var(--border)"}}
                    onClick={() => loadDoc(selectedCol, doc.id)}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--accent)",marginBottom:3}}>🔑 {doc.id}</div>
                        <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",maxWidth:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {Object.entries(doc).filter(([k])=>k!=="id").slice(0,3).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join(" · ")}
                        </div>
                      </div>
                      <button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();deleteDoc(selectedCol,doc.id);}}>🗑️</button>
                    </div>
                    {selectedDoc === doc.id && docData && (
                      <div style={{marginTop:10,padding:12,background:"var(--bg4)",borderRadius:8,fontFamily:"'DM Mono',monospace",fontSize:11,
                        maxHeight:300,overflow:"auto",whiteSpace:"pre-wrap",color:"var(--accent3)"}}>
                        {JSON.stringify(docData, null, 2)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderQuery = () => (
    <div>
      <div className="card" style={{marginBottom:14}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:14}}>🔍 Firestore Query Builder</div>
        <div className="form-row" style={{gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>
          <div><label className="lbl">Collection</label><input className="inp" placeholder="e.g. users" value={queryCol} onChange={e=>setQueryCol(e.target.value)} style={{marginBottom:0}} /></div>
          <div><label className="lbl">Field (optional)</label><input className="inp" placeholder="e.g. email" value={queryField} onChange={e=>setQueryField(e.target.value)} style={{marginBottom:0}} /></div>
          <div><label className="lbl">Operator</label>
            <select className="inp" value={queryOp} onChange={e=>setQueryOp(e.target.value)} style={{marginBottom:0}}>
              {["==","!=","<","<=",">",">=","array-contains"].map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
          <div><label className="lbl">Value</label><input className="inp" placeholder='e.g. "admin"' value={queryVal} onChange={e=>setQueryVal(e.target.value)} style={{marginBottom:0}} /></div>
        </div>
        <button className="btn btn-accent" onClick={runQuery} disabled={queryRunning}>
          {queryRunning ? "Running..." : "▶ Run Query"}
        </button>
      </div>
      {queryResults !== null && (
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>Results ({queryResults.length})</div>
          {queryResults.length === 0 ? (
            <div style={{color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:12}}>No documents matched the query.</div>
          ) : (
            <div style={{display:"grid",gap:8}}>
              {queryResults.map((doc,i) => (
                <div key={i} style={{background:"var(--bg4)",borderRadius:8,padding:12}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--accent)",marginBottom:6}}>🔑 {doc._id}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--accent3)",whiteSpace:"pre-wrap",maxHeight:200,overflow:"auto"}}>
                    {JSON.stringify({...doc,_id:undefined}, null, 2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderWrite = () => (
    <div className="card">
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:14}}>✏️ Write / Delete Document</div>
      <div className="form-row" style={{gap:10,marginBottom:10}}>
        <div><label className="lbl">Collection</label><input className="inp" placeholder="e.g. users" value={writeCol} onChange={e=>setWriteCol(e.target.value)} style={{marginBottom:0}} /></div>
        <div><label className="lbl">Document ID (leave blank to auto-generate)</label><input className="inp" placeholder="e.g. user123" value={writeDocId} onChange={e=>setWriteDocId(e.target.value)} style={{marginBottom:0}} /></div>
      </div>
      <label className="lbl">Operation</label>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {[["add","➕ Add (auto-ID)"],["set","💾 Set/Merge"],["delete","🗑️ Delete"]].map(([k,l])=>(
          <button key={k} className={`btn btn-sm${writeMode===k?" btn-accent":""}`} onClick={()=>setWriteMode(k)}>{l}</button>
        ))}
      </div>
      {writeMode !== "delete" && (
        <>
          <label className="lbl">Data (JSON)</label>
          <textarea className="paste-box" rows={8} value={writeData} onChange={e=>setWriteData(e.target.value)} style={{fontFamily:"'DM Mono',monospace",fontSize:12}} />
        </>
      )}
      <button className={`btn ${writeMode==="delete"?"btn-danger":"btn-accent"}`} onClick={writeDoc}>
        {writeMode==="add"?"➕ Add Document":writeMode==="set"?"💾 Set/Merge Document":"🗑️ Delete Document"}
      </button>
    </div>
  );

  const renderAuth = () => (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700}}>👤 Firebase Auth Users</div>
        <button className="btn btn-accent btn-sm" onClick={async()=>{
          if (!fb) return;
          setAuthLoading(true);
          try {
            // Firebase Auth SDK doesn't expose user listing in client SDK
            // Use Firestore users collection as proxy
            const snap = await fb.db.collection("users").limit(200).get();
            setAuthUsers(snap.docs.map(d=>({id:d.id,...d.data()})));
          } catch(e){ toast("Load error: "+e.message,"error"); }
          setAuthLoading(false);
        }}>↻ Load Users from Firestore</button>
      </div>
      <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:12,padding:"8px 12px",background:"rgba(251,191,36,.07)",border:"1px solid rgba(251,191,36,.2)",borderRadius:8}}>
        ℹ️ Firebase Auth user listing requires the Admin SDK (server-side). This panel loads user documents from your Firestore "users" collection instead.
      </div>
      {authLoading ? (
        <div style={{textAlign:"center",color:"var(--text3)",padding:30}}>Loading...</div>
      ) : authUsers.length > 0 ? (
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="tbl">
            <thead><tr><th>ID / Email</th><th>Role</th><th>Class</th><th>Joined</th></tr></thead>
            <tbody>
              {authUsers.map(u=>(
                <tr key={u.id}>
                  <td><div style={{display:"flex",alignItems:"center",gap:8}}><div className="user-av" style={{width:28,height:28,fontSize:12}}>{(u.email||u.username||u.id)[0].toUpperCase()}</div><div><div style={{fontWeight:600,fontSize:13}}>{u.email||u.username||"—"}</div><div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{u.id}</div></div></div></td>
                  <td><span className={`tag ${u.role==="admin"?"tag-purple":u.role==="lecturer"?"tag-warn":"tag-accent"}`}>{u.role||"student"}</span></td>
                  <td style={{fontSize:12,color:"var(--text3)"}}>{u.class||"—"}</td>
                  <td style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{u.joined||u.createdAt||"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{textAlign:"center",color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:13,padding:40}}>
          Click "Load Users" to fetch user documents from Firestore.
        </div>
      )}
    </div>
  );

  const renderConfig = () => (
    <div className="card">
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:14}}>⚙️ Firebase Configuration</div>
      <div style={{background:"rgba(74,222,128,.07)",border:"1px solid rgba(74,222,128,.2)",borderRadius:9,padding:"10px 14px",fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--success)",marginBottom:14}}>
        🔒 Config is hardcoded in the app · Project: <b>nurseexamprep-6956a</b>
      </div>
      <div style={{background:"var(--bg4)",borderRadius:8,padding:14,fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--accent3)",whiteSpace:"pre-wrap",marginBottom:14}}>
        {JSON.stringify(HARDCODED_FB_CONFIG, null, 2)}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn btn-accent btn-sm" onClick={autoConnect} disabled={loading}>
          {loading ? "Connecting..." : "↻ Reconnect"}
        </button>
        <button className="btn btn-sm btn-danger" onClick={disconnect}>🔌 Disconnect</button>
      </div>
    </div>
  );

  // Connecting / error state (before fb is ready)
  if (!fb) {
    return (
      <div>
        <div className="admin-header" style={{background:"linear-gradient(135deg,rgba(255,160,0,.12),rgba(255,100,0,.06))",border:"1px solid rgba(255,140,0,.2)"}}>
          <div className="admin-header-icon" style={{background:"linear-gradient(135deg,#f97316,#ef4444)"}}>🔥</div>
          <div>
            <div className="admin-header-title">Firebase Console</div>
            <div className="admin-header-sub">Connecting to <b>nurseexamprep-6956a</b>...</div>
          </div>
          <div style={{marginLeft:"auto"}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:statusColor}}>{statusIcon} {status}</span>
          </div>
        </div>
        {status==="connecting" && (
          <div style={{background:"var(--bg4)",borderRadius:10,padding:30,textAlign:"center",color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:13}}>
            ⏳ {statusMsg || "Connecting to Firebase..."}
          </div>
        )}
        {status==="error" && (
          <div>
            <div style={{background:"rgba(248,113,113,.1)",border:"1px solid var(--danger)",borderRadius:10,padding:"12px 16px",fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--danger)",marginBottom:14}}>❌ {statusMsg}</div>
            <button className="btn btn-accent" onClick={autoConnect} disabled={loading}>{loading?"Retrying...":"↻ Retry Connection"}</button>
          </div>
        )}
        {status==="disconnected" && (
          <div style={{textAlign:"center",padding:30}}>
            <button className="btn btn-accent" onClick={autoConnect}>🔥 Connect to Firebase</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="admin-header" style={{background:"linear-gradient(135deg,rgba(255,160,0,.12),rgba(255,100,0,.06))",border:"1px solid rgba(255,140,0,.2)",marginBottom:16}}>
        <div className="admin-header-icon" style={{background:"linear-gradient(135deg,#f97316,#ef4444)"}}>🔥</div>
        <div style={{flex:1}}>
          <div className="admin-header-title">Firebase Console</div>
          <div className="admin-header-sub" style={{color:"var(--success)"}}>🟢 Connected · {fbConfig?.projectId}</div>
        </div>
        <button className="btn btn-sm btn-danger" onClick={disconnect} style={{flexShrink:0}}>🔌 Disconnect</button>
      </div>

      <div style={{display:"flex",gap:6,marginBottom:18,flexWrap:"wrap"}}>
        {FB_TABS.map(t=>(
          <div key={t.key} className={`admin-tab${fbTab===t.key?" active":""}`} style={{fontSize:12}} onClick={()=>setFbTab(t.key)}>{t.label}</div>
        ))}
      </div>

      {fbTab==="firestore" && renderFirestore()}
      {fbTab==="query" && renderQuery()}
      {fbTab==="write" && renderWrite()}
      {fbTab==="auth" && renderAuth()}
      {fbTab==="config" && renderConfig()}
    </div>
  );
}

// ── Admin Overview ───────────────────────────────────────────────────
function AdminOverview({ toast }) {
  const users = ls("nv-users", []);
  const drugs = ls("nv-drugs", []);
  const labs = ls("nv-labs", []);
  const pq = ls("nv-pq", []);
  const decks = ls("nv-decks", []);
  const dict = ls("nv-dict", []);
  const skills = ls("nv-skillsdb", []);
  const classes = ls("nv-classes", []);
  const handouts = ls("nv-handouts", []);
  const announcements = ls("nv-announcements", []);

  const stats = [
    {lbl:"Users",val:users.length,icon:"👥",color:"var(--accent)"},
    {lbl:"Classes",val:classes.length,icon:"🏫",color:"var(--accent2)"},
    {lbl:"Drugs",val:drugs.length,icon:"💊",color:"var(--warn)"},
    {lbl:"Lab Tests",val:labs.length,icon:"🧪",color:"var(--success)"},
    {lbl:"Question Banks",val:pq.length,icon:"❓",color:"var(--purple)"},
    {lbl:"Flashcard Decks",val:decks.length,icon:"🃏",color:"var(--accent)"},
    {lbl:"Dict Terms",val:dict.length,icon:"📖",color:"var(--accent2)"},
    {lbl:"Skills",val:skills.length,icon:"✅",color:"var(--success)"},
    {lbl:"Handouts",val:handouts.length,icon:"📄",color:"var(--warn)"},
    {lbl:"Announcements",val:announcements.length,icon:"📢",color:"var(--purple)"},
  ];

  const exportAll = () => {
    const data = { users, classes, drugs, labs, pq, decks, dict, skills, handouts, announcements, exported: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "nursing-academic-hub-backup.json"; a.click();
    toast("Backup exported!", "success");
  };

  const importAll = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.classes) saveShared("classes", data.classes);
        if (data.drugs) saveShared("drugs", data.drugs);
        if (data.labs) saveShared("labs", data.labs);
        if (data.pq) saveShared("pq", data.pq);
        if (data.decks) saveShared("decks", data.decks);
        if (data.dict) saveShared("dict", data.dict);
        if (data.skills) saveShared("skills", data.skills);
        if (data.announcements) saveShared("announcements", data.announcements);
        toast("Backup restored! Refresh to see changes.", "success");
      } catch { toast("Invalid backup file", "error"); }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="grid5" style={{marginBottom:20}}>
        {stats.map((s,i)=>(
          <div key={s.lbl} className="stat-card" style={{animationDelay:`${i*.04}s`}}>
            <div style={{fontSize:22,marginBottom:6}}>{s.icon}</div>
            <div className="stat-val" style={{color:s.color,fontSize:24}}>{s.val}</div>
            <div className="stat-lbl" style={{marginTop:4}}>{s.lbl}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{marginBottom:16}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:14}}>💾 Backup & Restore</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button className="btn btn-accent" onClick={exportAll}>⬇️ Export Backup (JSON)</button>
          <label className="btn btn-warn" style={{cursor:"pointer"}}>
            ⬆️ Import Backup
            <input type="file" accept=".json" style={{display:"none"}} onChange={importAll} />
          </label>
          <button className="btn btn-danger" onClick={()=>{if(confirm("Reset ALL data to defaults? This cannot be undone!")){["nv-classes","nv-drugs","nv-labs","nv-pq","nv-decks","nv-dict","nv-skillsdb","nv-announcements","nv-handouts"].forEach(k=>{delete _mem[k];try{if(_lsAvail)localStorage.removeItem(k);}catch{}});initData();toast("Data reset to defaults","warn");}}}>🔄 Reset to Defaults</button>
        </div>
      </div>
      <div className="card">
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:14}}>👥 Recent Users</div>
        {users.slice(-5).reverse().map(u=>(
          <div key={u.username} className="user-row">
            <div className="user-av">{u.username[0].toUpperCase()}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:14}}>{u.username}</div>
              <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{u.class||"No class"} · Joined {u.joined}</div>
            </div>
            <span className={`tag ${u.role==="admin"?"tag-purple":u.role==="lecturer"?"tag-warn":"tag-accent"}`}>{u.role||"student"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Admin Users ──────────────────────────────────────────────────────
function AdminUsers({ toast }) {
  const [users, setUsers] = useHydratedShared("nv-users", "users", []);
  const [edit, setEdit] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({username:"",password:"",role:"student",class:""});
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [search, setSearch] = useState("");

  const save = () => {
    if (!form.username||!form.password) return toast("Username & password required","error");
    if (!edit && users.find(u=>u.username===form.username)) return toast("Username already exists","error");
    let u;
    if (edit) { u = users.map(x=>x.username===edit?{...x,...form}:x); toast("User updated","success"); }
    else { u = [...users,{...form,joined:new Date().toLocaleDateString()}]; toast("User added","success"); }
    setUsers(u); saveShared("users",u); setEdit(null); setShowAdd(false); setForm({username:"",password:"",role:"student",class:""});
  };

  const del = (username) => {
    if (username==="admin") return toast("Cannot delete admin","error");
    if (!confirm(`Delete user "${username}"?`)) return;
    const u = users.filter(x=>x.username!==username); setUsers(u); saveShared("users",u); toast("User deleted","success");
  };

  const filtered = users.filter(u=>u.username.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div><div className="sec-title">👥 Users ({users.length})</div></div>
        <button className="btn btn-purple" onClick={()=>{setShowAdd(true);setEdit(null);setForm({username:"",password:"",role:"student",class:""});}}>+ Add User</button>
      </div>
      <div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search users..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <table className="tbl">
          <thead><tr><th>Username</th><th>Role</th><th>Class</th><th>Joined</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map(u=>(
              <tr key={u.username}>
                <td><div style={{display:"flex",alignItems:"center",gap:9}}><div className="user-av" style={{width:30,height:30,fontSize:13}}>{u.username[0].toUpperCase()}</div><span style={{fontWeight:600}}>{u.username}</span></div></td>
                <td><span className={`tag ${u.role==="admin"?"tag-purple":u.role==="lecturer"?"tag-warn":"tag-accent"}`}>{u.role||"student"}</span></td>
                <td style={{fontSize:12,color:"var(--text3)"}}>{u.class||"—"}</td>
                <td style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{u.joined||"—"}</td>
                <td><div className="tbl-actions">
                  <button className="btn btn-sm" onClick={()=>{setEdit(u.username);setForm({username:u.username,password:u.password,role:u.role||"student",class:u.class||""});setShowAdd(true);}}>✏️ Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>del(u.username)}>🗑️ Del</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAdd&&(
        <div className="modal-overlay" onClick={()=>setShowAdd(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit?"Edit User":"Add User"}</div><button className="modal-close" onClick={()=>setShowAdd(false)}>✕</button></div>
            <label className="lbl">Username</label><input className="inp" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} disabled={!!edit} />
            <label className="lbl">Password</label><input className="inp" type="text" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} />
            <label className="lbl">Role</label>
            <select className="inp" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
              <option value="student">Student</option>
              <option value="lecturer">Lecturer</option>
            </select>
            <label className="lbl">Class</label>
            <select className="inp" value={form.class} onChange={e=>setForm({...form,class:e.target.value})}>
              <option value="">None</option>
              {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={save}>Save</button><button className="btn" onClick={()=>setShowAdd(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Classes ────────────────────────────────────────────────────
function AdminClasses({ toast }) {
  const classes = useShared("classes", DEFAULT_CLASSES);
  const setClasses = (val) => saveShared("classes", val);
  const [edit, setEdit] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState([]);
  const COLORS = ["#3E8E95","#5aada0","#facc15","#a78bfa","#f472b6","#fb923c","#4ade80","#f87171","#60a5fa"];
  const [form, setForm] = useState({id:"",label:"",desc:"",courses:"",color:"#3E8E95"});

  const parsePaste = () => {
    // Supports formats:
    // Line per class: "LABEL | Description | Course1, Course2"
    // Or just names, one per line
    const lines = pasteText.trim().split("\n").filter(l=>l.trim());
    const items = lines.map(line => {
      const parts = line.split("|").map(p=>p.trim());
      if (parts.length>=3) return { label:parts[0], desc:parts[1], courses:parts[2].split(",").map(c=>c.trim()).filter(Boolean) };
      if (parts.length===2) return { label:parts[0], desc:parts[1], courses:[] };
      return { label:parts[0], desc:`${parts[0]} Class`, courses:[] };
    });
    setParsed(items);
  };

  const importParsed = () => {
    const newItems = parsed.map((p,i)=>({
      id:`cls_${Date.now()}_${i}`, label:p.label, desc:p.desc,
      courses:p.courses, color:COLORS[i%COLORS.length]
    }));
    const u = [...classes, ...newItems]; setClasses(u); saveShared("classes",u);
    toast(`${newItems.length} classes imported!`,"success"); setPasteText(""); setParsed([]); setPasteMode(false);
  };

  const save = () => {
    if (!form.label) return toast("Label required","error");
    const courses = form.courses.split(",").map(c=>c.trim()).filter(Boolean);
    if (edit) {
      const u = classes.map(c=>c.id===edit?{...c,...form,courses}:c); setClasses(u); saveShared("classes",u); toast("Updated","success");
    } else {
      const item = {...form, id:`cls_${Date.now()}`, courses}; const u=[...classes,item]; setClasses(u); saveShared("classes",u); toast("Class added","success");
    }
    setShowModal(false); setEdit(null); setForm({id:"",label:"",desc:"",courses:"",color:"#3E8E95"});
  };

  const del = (id) => { if(!confirm("Delete this class?")) return; const u=classes.filter(c=>c.id!==id); setClasses(u); saveShared("classes",u); toast("Deleted","success"); };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">🏫 Classes & Courses ({classes.length})</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste & Import</button>
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm({id:"",label:"",desc:"",courses:"",color:"#3E8E95"});}}>+ Add Class</button>
        </div>
      </div>

      {pasteMode&&(
        <div className="card" style={{marginBottom:18}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:8}}>📋 Paste & Auto-Import Classes</div>
          <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:8}}>Format: <b style={{color:"var(--accent)"}}>LABEL | Description | Course1, Course2, Course3</b><br/>Or just paste class names, one per line.</div>
          <textarea className="paste-box" placeholder={"BNSc 5 | Bachelor of Nursing Science Year Five | Advanced Research, Clinical Leadership, Thesis\nND THREE | National Diploma Year Three | Paediatrics, Community Health\nHND THREE | Higher National Diploma Year Three | Health Policy, Nursing Management"} value={pasteText} onChange={e=>setPasteText(e.target.value)} />
          <div style={{display:"flex",gap:8,marginBottom:parsed.length?10:0}}>
            <button className="btn btn-accent" onClick={parsePaste}>🔍 Parse</button>
            {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length} Classes</button>}
            <button className="btn" onClick={()=>{setPasteMode(false);setParsed([]);setPasteText("");}}>Cancel</button>
          </div>
          {parsed.length>0&&(
            <div className="parse-preview">
              {parsed.map((p,i)=>(
                <div key={i} className="parse-item">
                  <span className="parse-check">✓</span>
                  <b>{p.label}</b> — {p.desc} — <span style={{color:"var(--text3)"}}>{p.courses.length} courses</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid2">
        {classes.map((c,i)=>(
          <div key={c.id} className="card" style={{borderLeft:`3px solid ${c.color}`,animation:`fadeUp .3s ease ${i*.04}s both`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <span style={{display:"inline-block",background:`${c.color}20`,color:c.color,borderRadius:5,padding:"2px 8px",fontSize:10,fontFamily:"'DM Mono',monospace",marginBottom:6}}>{c.label}</span>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{c.label}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{c.desc}</div>
              </div>
              <div style={{display:"flex",gap:5,flexShrink:0}}>
                <button className="btn btn-sm" onClick={()=>{setEdit(c.id);setForm({...c,courses:c.courses.join(", ")});setShowModal(true);}}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={()=>del(c.id)}>🗑️</button>
              </div>
            </div>
            <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{c.courses.length} courses: {c.courses.slice(0,3).join(", ")}{c.courses.length>3?` +${c.courses.length-3} more`:""}</div>
          </div>
        ))}
      </div>

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit?"Edit Class":"Add Class"}</div><button className="modal-close" onClick={()=>setShowModal(false)}>✕</button></div>
            <label className="lbl">Label (e.g. BNSc 5)</label><input className="inp" value={form.label} onChange={e=>setForm({...form,label:e.target.value})} />
            <label className="lbl">Description</label><input className="inp" value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})} />
            <label className="lbl">Courses (comma-separated)</label>
            <textarea className="inp" rows={3} style={{resize:"vertical"}} placeholder="Anatomy, Pharmacology, Nursing Theory..." value={form.courses} onChange={e=>setForm({...form,courses:e.target.value})} />
            <label className="lbl">Color</label>
            <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
              {COLORS.map(c=><div key={c} onClick={()=>setForm({...form,color:c})} style={{width:28,height:28,borderRadius:50,background:c,cursor:"pointer",border:form.color===c?"3px solid white":"3px solid transparent",transition:"all .2s"}} />)}
              <input type="color" value={form.color} onChange={e=>setForm({...form,color:e.target.value})} style={{width:28,height:28,border:"none",background:"none",cursor:"pointer",borderRadius:50}} />
            </div>
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={save}>Save</button><button className="btn" onClick={()=>setShowModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Drugs ──────────────────────────────────────────────────────
function AdminDrugs({ toast }) {
  const [drugs, setDrugs] = useState(()=>ls("nv-drugs",DEFAULT_DRUGS));
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState([]);
  const [search, setSearch] = useState("");
  const blank = {name:"",class:"",dose:"",max:"",uses:"",contraindications:"",side_effects:""};
  const [form, setForm] = useState(blank);

  const parsePaste = () => {
    // Format: DrugName | Class | Dose | MaxDose | Uses | Contraindications | SideEffects
    // Or just names
    const lines = pasteText.trim().split("\n").filter(l=>l.trim());
    const items = lines.map(line=>{
      const p = line.split("|").map(x=>x.trim());
      return { name:p[0]||"", class:p[1]||"", dose:p[2]||"", max:p[3]||"", uses:p[4]||"", contraindications:p[5]||"", side_effects:p[6]||"" };
    });
    setParsed(items);
  };

  const importParsed = () => {
    const items = parsed.map(p=>({...p,id:Date.now()+Math.random()}));
    const u=[...drugs,...items]; setDrugs(u); saveShared("drugs",u);
    toast(`${items.length} drugs imported!`,"success"); setPasteText(""); setParsed([]); setPasteMode(false);
  };

  const save = () => {
    if (!form.name) return toast("Drug name required","error");
    let u;
    if (edit!==null) { u = drugs.map((d,i)=>i===edit?{...form,id:d.id}:d); toast("Updated","success"); }
    else { u = [...drugs,{...form,id:Date.now()}]; toast("Drug added","success"); }
    setDrugs(u); saveShared("drugs",u); setShowModal(false); setEdit(null); setForm(blank);
  };

  const del = (id) => { const u=drugs.filter(d=>d.id!==id); setDrugs(u); saveShared("drugs",u); toast("Deleted","success"); };
  const filtered = drugs.filter(d=>d.name.toLowerCase().includes(search.toLowerCase())||d.class.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">💊 Drug Guide ({drugs.length} drugs)</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm(blank);}}>+ Add Drug</button>
        </div>
      </div>

      {pasteMode&&(
        <div className="card" style={{marginBottom:18}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:6}}>📋 Paste Drugs</div>
          <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:8}}>Format: <b style={{color:"var(--accent)"}}>Name | Class | Dose | MaxDose | Uses | Contraindications | SideEffects</b></div>
          <textarea className="paste-box" placeholder={"Aspirin | NSAID/Antiplatelet | 75-325mg daily | 4g/day | Pain, antiplatelet | Peptic ulcer, asthma | GI bleeding, Reye's syndrome\nFurosemide | Loop Diuretic | 20-80mg daily | 600mg/day | Oedema, heart failure | Allergy, anuria | Hypokalaemia, ototoxicity"} value={pasteText} onChange={e=>setPasteText(e.target.value)} />
          <div style={{display:"flex",gap:8,marginBottom:parsed.length?10:0}}>
            <button className="btn btn-accent" onClick={parsePaste}>🔍 Parse</button>
            {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length}</button>}
            <button className="btn" onClick={()=>{setPasteMode(false);setParsed([]);setPasteText("");}}>Cancel</button>
          </div>
          {parsed.length>0&&<div className="parse-preview">{parsed.map((p,i)=><div key={i} className="parse-item"><span className="parse-check">✓</span><b>{p.name}</b> — {p.class||"No class"} — {p.dose||"No dose"}</div>)}</div>}
        </div>
      )}

      <div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search drugs..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <table className="tbl">
          <thead><tr><th>Drug Name</th><th>Class</th><th>Dose</th><th>Uses</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((d,i)=>(
              <tr key={d.id}>
                <td style={{fontWeight:700}}>{d.name}</td>
                <td><span className="tag">{d.class}</span></td>
                <td style={{fontSize:12,color:"var(--text3)"}}>{d.dose}</td>
                <td style={{fontSize:12,color:"var(--text2)",maxWidth:150}}>{d.uses}</td>
                <td><div className="tbl-actions">
                  <button className="btn btn-sm" onClick={()=>{setEdit(drugs.indexOf(d));setForm({...d});setShowModal(true);}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>del(d.id)}>🗑️</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit!==null?"Edit Drug":"Add Drug"}</div><button className="modal-close" onClick={()=>setShowModal(false)}>✕</button></div>
            {Object.keys(blank).map(k=>(
              <div key={k}><label className="lbl">{k.replace(/_/g," ")}</label><input className="inp" value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} placeholder={k==="name"?"e.g. Aspirin":k==="class"?"e.g. NSAID":""} /></div>
            ))}
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={save}>Save</button><button className="btn" onClick={()=>setShowModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Labs ───────────────────────────────────────────────────────
function AdminLabs({ toast }) {
  const [labs, setLabs] = useState(()=>ls("nv-labs",DEFAULT_LABS));
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState([]);
  const blank = {test:"",male:"",female:"",notes:""};
  const [form, setForm] = useState(blank);

  const parsePaste = () => {
    const lines = pasteText.trim().split("\n").filter(l=>l.trim());
    const items = lines.map(line=>{
      const p = line.split("|").map(x=>x.trim());
      return { test:p[0]||"", male:p[1]||p[0]||"", female:p[2]||p[1]||"", notes:p[3]||"" };
    });
    setParsed(items);
  };

  const importParsed = () => {
    const items = parsed.map(p=>({...p,id:Date.now()+Math.random()}));
    const u=[...labs,...items]; setLabs(u); saveShared("labs",u);
    toast(`${items.length} lab tests imported!`,"success"); setPasteText(""); setParsed([]); setPasteMode(false);
  };

  const save = () => {
    if (!form.test) return toast("Test name required","error");
    let u;
    if (edit!==null) { u=labs.map((l,i)=>i===edit?{...form,id:l.id}:l); toast("Updated","success"); }
    else { u=[...labs,{...form,id:Date.now()}]; toast("Lab test added","success"); }
    setLabs(u); saveShared("labs",u); setShowModal(false); setEdit(null); setForm(blank);
  };

  const del = (id) => { const u=labs.filter(l=>l.id!==id); setLabs(u); saveShared("labs",u); toast("Deleted","success"); };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">🧪 Lab Reference ({labs.length} tests)</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm(blank);}}>+ Add Test</button>
        </div>
      </div>

      {pasteMode&&(
        <div className="card" style={{marginBottom:18}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:6}}>📋 Paste Lab Values</div>
          <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:8}}>Format: <b style={{color:"var(--accent)"}}>Test Name | Male Range | Female Range | Notes</b></div>
          <textarea className="paste-box" placeholder={"Bilirubin (Total) | 0-17 μmol/L | 0-17 μmol/L | Elevated in jaundice\nAST | 10-40 U/L | 10-35 U/L | Liver enzyme"} value={pasteText} onChange={e=>setPasteText(e.target.value)} />
          <div style={{display:"flex",gap:8,marginBottom:parsed.length?10:0}}>
            <button className="btn btn-accent" onClick={parsePaste}>🔍 Parse</button>
            {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length}</button>}
            <button className="btn" onClick={()=>{setPasteMode(false);setParsed([]);setPasteText("");}}>Cancel</button>
          </div>
          {parsed.length>0&&<div className="parse-preview">{parsed.map((p,i)=><div key={i} className="parse-item"><span className="parse-check">✓</span><b>{p.test}</b> — M: {p.male} — F: {p.female}</div>)}</div>}
        </div>
      )}

      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <table className="tbl">
          <thead><tr><th>Test</th><th>Male</th><th>Female</th><th>Notes</th><th>Actions</th></tr></thead>
          <tbody>
            {labs.map((l,i)=>(
              <tr key={l.id}>
                <td style={{fontWeight:700}}>{l.test}</td>
                <td style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--accent)"}}>{l.male}</td>
                <td style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--accent2)"}}>{l.female}</td>
                <td style={{fontSize:12,color:"var(--text3)"}}>{l.notes}</td>
                <td><div className="tbl-actions">
                  <button className="btn btn-sm" onClick={()=>{setEdit(i);setForm({...l});setShowModal(true);}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>del(l.id)}>🗑️</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit!==null?"Edit":"Add"} Lab Test</div><button className="modal-close" onClick={()=>setShowModal(false)}>✕</button></div>
            <label className="lbl">Test Name</label><input className="inp" value={form.test} onChange={e=>setForm({...form,test:e.target.value})} />
            <div className="form-row">
              <div><label className="lbl">Male Range</label><input className="inp" value={form.male} onChange={e=>setForm({...form,male:e.target.value})} /></div>
              <div><label className="lbl">Female Range</label><input className="inp" value={form.female} onChange={e=>setForm({...form,female:e.target.value})} /></div>
            </div>
            <label className="lbl">Notes</label><input className="inp" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} />
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={save}>Save</button><button className="btn" onClick={()=>setShowModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Past Questions ─────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════
// SHARED MCQ PARSER UTILITY
// ════════════════════════════════════════════════════════════════════
const parseMCQText = (text) => {
  const lines = text.trim().split("\n").map(l=>l.trim()).filter(Boolean);
  const answerKeyPattern = /^(\d+)[.)]\s*[A-Da-d]$/;
  const allAnswers = lines.length > 0 && lines.every(l => answerKeyPattern.test(l));
  if (allAnswers) {
    return { type: "answerkey", answers: lines.map(l => { const m = l.match(/(\d+)[.)]\s*([A-Da-d])/); return m ? { num: +m[1], ans: "ABCD".indexOf(m[2].toUpperCase()) } : null; }).filter(Boolean) };
  }
  const rawBlocks = text.trim().split(/\n\s*\n/).filter(b=>b.trim());
  const parseBlock = (block) => {
    const blines = block.split("\n").map(l=>l.trim()).filter(Boolean);
    let q="", options=["","","",""], ans=0;
    for (const line of blines) {
      if (/^q\s*[:.)]\s*/i.test(line)) { q=line.replace(/^q\s*[:.)]\s*/i,"").trim(); continue; }
      if (/^\d+[.)]\s+[^A-Da-d]/.test(line) && !q) { q=line.replace(/^\d+[.)]\s+/,"").trim(); continue; }
      if (/^[Aa]\s*[:.)[\]]\s*/.test(line)) { options[0]=line.replace(/^[Aa]\s*[:.)[\]]\s*/,"").trim(); continue; }
      if (/^[Bb]\s*[:.)[\]]\s*/.test(line)) { options[1]=line.replace(/^[Bb]\s*[:.)[\]]\s*/,"").trim(); continue; }
      if (/^[Cc]\s*[:.)[\]]\s*/.test(line)) { options[2]=line.replace(/^[Cc]\s*[:.)[\]]\s*/,"").trim(); continue; }
      if (/^[Dd]\s*[:.)[\]]\s*/.test(line)) { options[3]=line.replace(/^[Dd]\s*[:.)[\]]\s*/,"").trim(); continue; }
      if (/^(ans|answer|correct|key)\s*[:.)]\s*/i.test(line)) {
        const a=line.replace(/^(ans|answer|correct|key)\s*[:.)]\s*/i,"").trim().toUpperCase()[0];
        ans=["A","B","C","D"].indexOf(a); if(ans<0)ans=0; continue;
      }
      if (/^\*\s*[A-Da-d]/.test(line)) { const a=line.replace(/^\*\s*/,"").trim().toUpperCase()[0]; ans=["A","B","C","D"].indexOf(a); if(ans<0)ans=0; continue; }
      if (!q && line.length>5) { q=line; continue; }
    }
    if (!q) return null;
    const cleanOpts = options.map((o,i)=>o||("Option "+["A","B","C","D"][i]));
    return { q, options:cleanOpts, ans };
  };
  const questions = rawBlocks.map(parseBlock).filter(Boolean);
  return { type:"questions", questions };
};

const applyAnswerKey = (questions, answerKey) => {
  const keyMap = {};
  answerKey.forEach(({num,ans})=>{ keyMap[num]=ans; });
  return questions.map((q,i)=>keyMap[i+1]!==undefined?{...q,ans:keyMap[i+1]}:q);
};

const parseEssayText = (text) => {
  const rawBlocks = text.trim().split(/\n\s*\n/).filter(b=>b.trim());
  return rawBlocks.map(block=>{
    const blines = block.split("\n").map(l=>l.trim()).filter(Boolean);
    let q="", marks=10, wordGuide="100-200", modelAnswer="";
    for (const line of blines) {
      if (/^q\s*[:.)]\s*/i.test(line)) { q=line.replace(/^q\s*[:.)]\s*/i,"").trim(); continue; }
      if (/^\d+[.)]\s+/.test(line) && !q) { q=line.replace(/^\d+[.)]\s+/,"").trim(); continue; }
      if (/^(marks?|pts?|points?)\s*[:.:]\s*/i.test(line)) { marks=+line.replace(/^(marks?|pts?|points?)\s*[:.:]\s*/i,"").trim()||10; continue; }
      if (/^(word[s\s-]*guide|wg)\s*[:.:]\s*/i.test(line)) { wordGuide=line.replace(/^(word[s\s-]*guide|wg)\s*[:.:]\s*/i,"").trim(); continue; }
      if (/^(model|key[\s-]*points?|model[\s-]*answer)\s*[:.:]\s*/i.test(line)) { modelAnswer=line.replace(/^(model|key[\s-]*points?|model[\s-]*answer)\s*[:.:]\s*/i,"").trim(); continue; }
      if (!q && line.length>5) { q=line; continue; }
      if (q && !modelAnswer) modelAnswer+=(modelAnswer?" ":"")+line;
    }
    if (!q) return null;
    return { q, marks, wordGuide, modelAnswer };
  }).filter(Boolean);
};

function AdminPQ({ toast }) {
  const classes = useShared("classes", DEFAULT_CLASSES);
  const [banks, setBanks] = useHydratedShared("nv-pq", "pq", DEFAULT_PQ);
  const [selBank, setSelBank] = useState(null);
  const [showBankModal, setShowBankModal] = useState(false);
  const [showQModal, setShowQModal] = useState(false);
  const [editBank, setEditBank] = useState(null);
  const [editQ, setEditQ] = useState(null);
  const [inputMode, setInputMode] = useState("single");
  const [pasteText, setPasteText] = useState("");
  const [answerKeyText, setAnswerKeyText] = useState("");
  const [parsed, setParsed] = useState([]);
  const [parseError, setParseError] = useState("");
  const [bankForm, setBankForm] = useState({subject:"",year:"",classId:""});
  const [qForm, setQForm] = useState({q:"",options:["","","",""],ans:0});

  const doParse = () => {
    setParseError(""); setParsed([]);
    const result = parseMCQText(pasteText);
    if (result.type === "answerkey") { setParseError("Looks like an answer key — use the Apply Answers tab instead."); return; }
    if (!result.questions.length) { setParseError("Could not parse questions. Check the format guide."); return; }
    setParsed(result.questions);
  };

  const doImport = () => {
    if (!selBank) return toast("Select a bank first","error");
    const updated = banks.map(b=>b.id===selBank?{...b,questions:[...b.questions,...parsed]}:b);
    setBanks(updated); saveShared("pq",updated);
    toast(`${parsed.length} questions imported!`,"success");
    setPasteText(""); setParsed([]); setInputMode("single");
  };

  const doApplyAnswerKey = () => {
    if (!selBank) return toast("Select a bank first","error");
    setParseError("");
    const text = answerKeyText.trim();
    // Try inline format: 1.B 2.C 3.A or 1)B 2)C
    const inlineMatches = [...text.matchAll(/(\d+)[.)]\s*([A-Da-d])/g)];
    if (inlineMatches.length) {
      const key = inlineMatches.map(m=>({num:+m[1], ans:"ABCD".indexOf(m[2].toUpperCase())}));
      const updated = banks.map(b=>b.id===selBank?{...b,questions:applyAnswerKey(b.questions,key)}:b);
      setBanks(updated); saveShared("pq",updated);
      toast(`Applied ${key.length} answers!`,"success"); setAnswerKeyText(""); return;
    }
    // Try line-by-line: "B\nC\nA" (one answer per line, no number)
    const letterLines = text.split("\n").map(l=>l.trim()).filter(l=>/^[A-Da-d]$/.test(l));
    if (letterLines.length) {
      const key = letterLines.map((l,i)=>({num:i+1, ans:"ABCD".indexOf(l.toUpperCase())}));
      const updated = banks.map(b=>b.id===selBank?{...b,questions:applyAnswerKey(b.questions,key)}:b);
      setBanks(updated); saveShared("pq",updated);
      toast(`Applied ${key.length} answers!`,"success"); setAnswerKeyText(""); return;
    }
    setParseError("Could not parse. Use: 1.B 2.C 3.A  or one letter per line.");
  };

  const saveBank = () => {
    if (!bankForm.subject) return toast("Subject required","error");
    let u;
    if (editBank!==null) { u=banks.map((b,i)=>i===editBank?{...b,...bankForm}:b); toast("Updated","success"); }
    else { u=[...banks,{...bankForm,id:Date.now(),questions:[]}]; toast("Bank created","success"); }
    setBanks(u); saveShared("pq",u); setShowBankModal(false); setEditBank(null); setBankForm({subject:"",year:"",classId:""});
  };

  const delBank = (id) => { if(!confirm("Delete this question bank?"))return; const u=banks.filter(b=>b.id!==id); setBanks(u); saveShared("pq",u); if(selBank===id)setSelBank(null); toast("Deleted","success"); };

  const saveQ = () => {
    if (!qForm.q) return toast("Question required","error");
    const updated = banks.map(b=>{
      if (b.id!==selBank) return b;
      let qs;
      if (editQ!==null) { qs=b.questions.map((q,i)=>i===editQ?{...qForm}:q); toast("Updated","success"); }
      else { qs=[...b.questions,{...qForm}]; toast("Question added","success"); }
      return {...b,questions:qs};
    });
    setBanks(updated); saveShared("pq",updated); setShowQModal(false); setEditQ(null); setQForm({q:"",options:["","","",""],ans:0});
  };

  const delQ = (bankId, qIdx) => { const u=banks.map(b=>b.id===bankId?{...b,questions:b.questions.filter((_,i)=>i!==qIdx)}:b); setBanks(u); saveShared("pq",u); toast("Deleted","success"); };
  const currentBank = banks.find(b=>b.id===selBank);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">❓ Past Questions ({banks.length} banks)</div>
        <button className="btn btn-purple" onClick={()=>{setShowBankModal(true);setEditBank(null);setBankForm({subject:"",year:"",classId:""});}}>+ New Bank</button>
      </div>

      <div className="grid2" style={{marginBottom:20}}>
        {banks.map((b,i)=>{
          const cls = classes.find(c=>c.id===b.classId);
          return (
            <div key={b.id} className="card" style={{cursor:"pointer",border:selBank===b.id?"1px solid var(--purple)":"1px solid var(--border)",transition:"border .2s"}} onClick={()=>{setSelBank(b.id);setInputMode("single");setParsed([]);setPasteText("");setAnswerKeyText("");}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  {cls&&<span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:cls.color,background:`${cls.color}20`,padding:"1px 7px",borderRadius:4,marginBottom:5,display:"inline-block"}}>{cls.label}</span>}
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{b.subject}</div>
                  <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{b.year}{b.year?" · ":""}{b.questions.length} questions</div>
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0}}>
                  <button className="btn btn-sm" onClick={e=>{e.stopPropagation();setEditBank(i);setBankForm({subject:b.subject,year:b.year||"",classId:b.classId||""});setShowBankModal(true);}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();delBank(b.id);}}>🗑️</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {currentBank&&(
        <div className="card">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700}}>{currentBank.subject} — {currentBank.questions.length} Questions</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {[{k:"single",icon:"➕",label:"Add One"},{k:"paste",icon:"📋",label:"Paste & Parse"},{k:"answerkey",icon:"🔑",label:"Apply Answers"}].map(({k,icon,label})=>(
                <button key={k} className={`btn btn-sm${inputMode===k?" btn-purple":""}`} onClick={()=>{setInputMode(inputMode===k?"none":k);setParsed([]);setParseError("");}}>{icon} {label}</button>
              ))}
            </div>
          </div>

          {inputMode==="single"&&(
            <div style={{background:"var(--bg4)",borderRadius:10,padding:16,marginBottom:16}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,marginBottom:12}}>➕ Add Single Question</div>
              <label className="lbl">Question</label>
              <textarea className="inp" rows={2} style={{resize:"vertical"}} placeholder="Type question..." value={qForm.q} onChange={e=>setQForm({...qForm,q:e.target.value})} />
              {["A","B","C","D"].map((l,i)=>(
                <div key={l} style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                  <span style={{width:22,fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--text3)",flexShrink:0}}>{l}.</span>
                  <input className="inp" style={{marginBottom:0,flex:1}} placeholder={`Option ${l}`} value={qForm.options[i]} onChange={e=>{const o=[...qForm.options];o[i]=e.target.value;setQForm({...qForm,options:o});}} />
                  <button onClick={()=>setQForm({...qForm,ans:i})} style={{width:28,height:28,borderRadius:6,border:`2px solid ${qForm.ans===i?"var(--success)":"var(--border)"}`,background:qForm.ans===i?"rgba(74,222,128,.15)":"transparent",cursor:"pointer",fontSize:13,flexShrink:0,color:qForm.ans===i?"var(--success)":"var(--text3)"}}>{qForm.ans===i?"✓":"○"}</button>
                </div>
              ))}
              <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:10}}>Click ○ to mark correct · Selected: <b style={{color:"var(--success)"}}>{"ABCD"[qForm.ans]}</b></div>
              <button className="btn btn-purple" onClick={saveQ}>➕ Add Question</button>
            </div>
          )}

          {inputMode==="paste"&&(
            <div style={{background:"var(--bg4)",borderRadius:10,padding:16,marginBottom:16}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,marginBottom:8}}>📋 Paste & Auto-Parse</div>
              <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:10,lineHeight:1.9,background:"rgba(62,142,149,.08)",borderRadius:7,padding:"8px 12px"}}>
                <b style={{color:"var(--accent)"}}>Any of these formats work:</b><br/>
                Q: Question{"  "}A: Opt1{"  "}B: Opt2{"  "}C: Opt3{"  "}D: Opt4{"  "}ANS: B<br/>
                1. Question{"  "}A) Opt1{"  "}B) Opt2{"  "}Answer: B<br/>
                (Separate multiple questions with a blank line)
              </div>
              <textarea className="paste-box" rows={12} placeholder={"Q: What is the normal adult temperature?\nA: 35.0 C\nB: 36.1-37.2 C\nC: 38.5 C\nD: 40.0 C\nANS: B\n\n1. Which organ produces insulin?\nA) Liver\nB) Kidney\nC) Pancreas\nD) Spleen\nAnswer: C"} value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsed([]);setParseError("");}} />
              {parseError&&<div style={{color:"var(--danger)",fontSize:12,fontFamily:"'DM Mono',monospace",marginBottom:8}}>⚠️ {parseError}</div>}
              <div style={{display:"flex",gap:8,marginBottom:parsed.length?12:0}}>
                <button className="btn btn-accent" onClick={doParse}>🔍 Parse</button>
                {parsed.length>0&&<button className="btn btn-success" onClick={doImport}>✅ Import {parsed.length} Questions</button>}
                <button className="btn" onClick={()=>{setInputMode("single");setParsed([]);setPasteText("");setParseError("");}}>Cancel</button>
              </div>
              {parsed.length>0&&(
                <div className="parse-preview">
                  {parsed.map((p,i)=>(
                    <div key={i} className="parse-item">
                      <span className="parse-check">✓</span>
                      <span style={{flex:1,fontSize:12}}>{p.q.slice(0,80)}{p.q.length>80?"...":""}</span>
                      <span style={{color:"var(--success)",fontFamily:"'DM Mono',monospace",fontSize:11,flexShrink:0}}>ANS: {"ABCD"[p.ans]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {inputMode==="answerkey"&&(
            <div style={{background:"var(--bg4)",borderRadius:10,padding:16,marginBottom:16}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,marginBottom:8}}>🔑 Apply Answer Key</div>
              <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:10,lineHeight:1.9,background:"rgba(167,139,250,.08)",borderRadius:7,padding:"8px 12px"}}>
                <b style={{color:"var(--purple)"}}>Paste just the answers (no questions needed):</b><br/>
                1.B 2.C 3.A 4.D 5.B (inline)<br/>
                1) B{"  "}2) C{"  "}3) A (numbered lines)<br/>
                B{"  "}C{"  "}A{"  "}D (one letter per line — maps to Q1, Q2, Q3...)<br/>
                <b>Bank has {currentBank.questions.length} questions.</b>
              </div>
              <textarea className="paste-box" rows={5} placeholder={"1.B 2.C 3.A 4.D 5.B\n\n— or —\n\nB\nC\nA\nD"} value={answerKeyText} onChange={e=>{setAnswerKeyText(e.target.value);setParseError("");}} />
              {parseError&&<div style={{color:"var(--danger)",fontSize:12,fontFamily:"'DM Mono',monospace",marginBottom:8}}>⚠️ {parseError}</div>}
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-purple" onClick={doApplyAnswerKey}>🔑 Apply Answers</button>
                <button className="btn" onClick={()=>{setInputMode("single");setAnswerKeyText("");setParseError("");}}>Cancel</button>
              </div>
            </div>
          )}

          {currentBank.questions.length===0 ? (
            <div style={{textAlign:"center",color:"var(--text3)",padding:30,fontFamily:"'DM Mono',monospace",fontSize:13}}>No questions yet. Use Add One or Paste & Parse above.</div>
          ) : (
            <div style={{display:"grid",gap:8,marginTop:8}}>
              {currentBank.questions.map((q,qi)=>(
                <div key={qi} style={{background:"var(--bg3)",borderRadius:10,padding:"12px 14px",border:"1px solid var(--border)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>{qi+1}. {q.q}</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {q.options.map((opt,oi)=>(
                          <span key={oi} style={{fontSize:11,padding:"3px 9px",borderRadius:5,background:oi===q.ans?"rgba(74,222,128,.15)":"rgba(255,255,255,.04)",border:`1px solid ${oi===q.ans?"var(--success)":"var(--border)"}`,color:oi===q.ans?"var(--success)":"var(--text3)"}}>
                            {"ABCD"[oi]}. {opt}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:5,flexShrink:0}}>
                      <button className="btn btn-sm" onClick={()=>{setEditQ(qi);setQForm({...q});setShowQModal(true);}}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={()=>delQ(currentBank.id,qi)}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showBankModal&&(
        <div className="modal-overlay" onClick={()=>setShowBankModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editBank!==null?"Edit Bank":"New Question Bank"}</div><button className="modal-close" onClick={()=>setShowBankModal(false)}>✕</button></div>
            <label className="lbl">Subject</label><input className="inp" placeholder="e.g. Anatomy & Physiology" value={bankForm.subject} onChange={e=>setBankForm({...bankForm,subject:e.target.value})} />
            <label className="lbl">Year / Exam Label (optional)</label><input className="inp" placeholder="e.g. 2023" value={bankForm.year} onChange={e=>setBankForm({...bankForm,year:e.target.value})} />
            <label className="lbl">Target Class (optional — leave blank for Past Questions)</label>
            <select className="inp" value={bankForm.classId||""} onChange={e=>setBankForm({...bankForm,classId:e.target.value})}>
              <option value="">All Classes (Past Questions)</option>
              {classes.map(c=><option key={c.id} value={c.id}>{c.label} — {c.desc}</option>)}
            </select>
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={saveBank}>Save</button><button className="btn" onClick={()=>setShowBankModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {showQModal&&(
        <div className="modal-overlay" onClick={()=>setShowQModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editQ!==null?"Edit":"Add"} Question</div><button className="modal-close" onClick={()=>setShowQModal(false)}>✕</button></div>
            <label className="lbl">Question</label><textarea className="inp" rows={3} style={{resize:"vertical"}} value={qForm.q} onChange={e=>setQForm({...qForm,q:e.target.value})} />
            {["A","B","C","D"].map((l,i)=>(
              <div key={l}><label className="lbl">Option {l}</label><input className="inp" value={qForm.options[i]} onChange={e=>{const o=[...qForm.options];o[i]=e.target.value;setQForm({...qForm,options:o});}} /></div>
            ))}
            <label className="lbl">Correct Answer</label>
            <select className="inp" value={qForm.ans} onChange={e=>setQForm({...qForm,ans:+e.target.value})}>
              {["A","B","C","D"].map((l,i)=><option key={l} value={i}>Option {l}: {qForm.options[i]}</option>)}
            </select>
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={saveQ}>Save</button><button className="btn" onClick={()=>setShowQModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Flashcards ─────────────────────────────────────────────────
function AdminFlashcards({ toast }) {
  const [decks, setDecks] = useState(()=>ls("nv-decks",DEFAULT_DECKS));
  const [selDeck, setSelDeck] = useState(null);
  const [showDeckModal, setShowDeckModal] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [editDeck, setEditDeck] = useState(null);
  const [editCard, setEditCard] = useState(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState([]);
  const [deckForm, setDeckForm] = useState({name:""});
  const [cardForm, setCardForm] = useState({front:"",back:""});

  const parsePaste = () => {
    // Front | Back  (one per line)
    const lines = pasteText.trim().split("\n").filter(l=>l.trim());
    const items = lines.map(line=>{
      const p = line.split("|").map(x=>x.trim());
      return { front:p[0]||"", back:p[1]||"" };
    }).filter(c=>c.front);
    setParsed(items);
  };

  const importParsed = () => {
    if (!selDeck) return toast("Select a deck first","error");
    const items = parsed.map(p=>({...p,id:Date.now()+Math.random()}));
    const u = decks.map(d=>d.id===selDeck?{...d,cards:[...d.cards,...items]}:d);
    setDecks(u); saveShared("decks",u); toast(`${items.length} cards imported!`,"success"); setPasteText(""); setParsed([]); setPasteMode(false);
  };

  const saveDeck = () => {
    if (!deckForm.name) return toast("Name required","error");
    let u;
    if (editDeck!==null) { u=decks.map(d=>d.id===editDeck?{...d,...deckForm}:d); toast("Updated","success"); }
    else { u=[...decks,{...deckForm,id:`deck_${Date.now()}`,cards:[]}]; toast("Deck created","success"); }
    setDecks(u); saveShared("decks",u); setShowDeckModal(false); setEditDeck(null); setDeckForm({name:""});
  };

  const delDeck = (id) => { if(!confirm("Delete deck?"))return; const u=decks.filter(d=>d.id!==id); setDecks(u); saveShared("decks",u); if(selDeck===id)setSelDeck(null); toast("Deleted","success"); };

  const saveCard = () => {
    if (!cardForm.front) return toast("Front required","error");
    const u = decks.map(d=>{
      if (d.id!==selDeck) return d;
      let cards;
      if (editCard!==null) { cards=d.cards.map((c,i)=>i===editCard?{...cardForm,id:c.id}:c); toast("Updated","success"); }
      else { cards=[...d.cards,{...cardForm,id:Date.now()}]; toast("Card added","success"); }
      return {...d,cards};
    });
    setDecks(u); saveShared("decks",u); setShowCardModal(false); setEditCard(null); setCardForm({front:"",back:""});
  };

  const delCard = (deckId, cardIdx) => { const u=decks.map(d=>d.id===deckId?{...d,cards:d.cards.filter((_,i)=>i!==cardIdx)}:d); setDecks(u); saveShared("decks",u); toast("Deleted","success"); };
  const currentDeck = decks.find(d=>d.id===selDeck);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">🃏 Flashcard Decks ({decks.length})</div>
        <button className="btn btn-purple" onClick={()=>{setShowDeckModal(true);setEditDeck(null);setDeckForm({name:""});}}>+ New Deck</button>
      </div>

      <div className="grid3" style={{marginBottom:20}}>
        {decks.map(d=>(
          <div key={d.id} className="card" style={{cursor:"pointer",border:selDeck===d.id?"1px solid var(--purple)":"1px solid var(--border)"}} onClick={()=>setSelDeck(d.id)}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{d.name}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{d.cards.length} cards</div>
              </div>
              <div style={{display:"flex",gap:5}}>
                <button className="btn btn-sm" onClick={e=>{e.stopPropagation();setEditDeck(d.id);setDeckForm({name:d.name});setShowDeckModal(true);}}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();delDeck(d.id);}}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {currentDeck&&(
        <div className="card">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700}}>{currentDeck.name} — Cards ({currentDeck.cards.length})</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
              <button className="btn btn-purple btn-sm" onClick={()=>{setShowCardModal(true);setEditCard(null);setCardForm({front:"",back:""});}}>+ Add Card</button>
            </div>
          </div>

          {pasteMode&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:8}}>Format: <b style={{color:"var(--accent)"}}>Front text | Back text</b> (one card per line)</div>
              <textarea className="paste-box" placeholder={"Normal adult SpO2 | 95-100%\nNormal adult temperature | 36.1-37.2°C\nGlasgow Coma Scale max score | 15"} value={pasteText} onChange={e=>setPasteText(e.target.value)} />
              <div style={{display:"flex",gap:8,marginBottom:parsed.length?10:0}}>
                <button className="btn btn-accent" onClick={parsePaste}>🔍 Parse</button>
                {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length}</button>}
                <button className="btn" onClick={()=>{setPasteMode(false);setParsed([]);setPasteText("");}}>Cancel</button>
              </div>
              {parsed.length>0&&<div className="parse-preview">{parsed.map((p,i)=><div key={i} className="parse-item"><span className="parse-check">✓</span><b>{p.front}</b> → {p.back}</div>)}</div>}
            </div>
          )}

          <div className="grid2">
            {currentDeck.cards.map((c,ci)=>(
              <div key={c.id||ci} className="card2">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:3}}>FRONT</div>
                    <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>{c.front}</div>
                    <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:3}}>BACK</div>
                    <div style={{fontSize:13,color:"var(--accent)"}}>{c.back}</div>
                  </div>
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    <button className="btn btn-sm" onClick={()=>{setEditCard(ci);setCardForm({front:c.front,back:c.back});setShowCardModal(true);}}>✏️</button>
                    <button className="btn btn-sm btn-danger" onClick={()=>delCard(currentDeck.id,ci)}>🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showDeckModal&&(
        <div className="modal-overlay" onClick={()=>setShowDeckModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editDeck?"Edit":"New"} Deck</div><button className="modal-close" onClick={()=>setShowDeckModal(false)}>✕</button></div>
            <label className="lbl">Deck Name</label><input className="inp" value={deckForm.name} onChange={e=>setDeckForm({name:e.target.value})} placeholder="e.g. Cardiology Drugs" />
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={saveDeck}>Save</button><button className="btn" onClick={()=>setShowDeckModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {showCardModal&&(
        <div className="modal-overlay" onClick={()=>setShowCardModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editCard!==null?"Edit":"Add"} Card</div><button className="modal-close" onClick={()=>setShowCardModal(false)}>✕</button></div>
            <label className="lbl">Front (Question)</label><textarea className="inp" rows={3} style={{resize:"vertical"}} value={cardForm.front} onChange={e=>setCardForm({...cardForm,front:e.target.value})} />
            <label className="lbl">Back (Answer)</label><textarea className="inp" rows={3} style={{resize:"vertical"}} value={cardForm.back} onChange={e=>setCardForm({...cardForm,back:e.target.value})} />
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={saveCard}>Save</button><button className="btn" onClick={()=>setShowCardModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Dictionary ─────────────────────────────────────────────────
function AdminDictionary({ toast }) {
  const [dict, setDict] = useState(()=>ls("nv-dict",DEFAULT_DICT));
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState([]);
  const [form, setForm] = useState({term:"",def:""});
  const [search, setSearch] = useState("");

  const parsePaste = () => {
    const lines = pasteText.trim().split("\n").filter(l=>l.trim());
    const items = lines.map(line=>{
      const idx = line.indexOf("|");
      if (idx>-1) return {term:line.slice(0,idx).trim(),def:line.slice(idx+1).trim()};
      const idx2 = line.indexOf(":");
      if (idx2>-1) return {term:line.slice(0,idx2).trim(),def:line.slice(idx2+1).trim()};
      return {term:line.trim(),def:""};
    }).filter(x=>x.term);
    setParsed(items);
  };

  const importParsed = () => {
    const items = parsed.map(p=>({...p,id:Date.now()+Math.random()}));
    const u=[...dict,...items]; setDict(u); saveShared("dict",u);
    toast(`${items.length} terms imported!`,"success"); setPasteText(""); setParsed([]); setPasteMode(false);
  };

  const save = () => {
    if (!form.term) return toast("Term required","error");
    let u;
    if (edit!==null) { u=dict.map((d,i)=>i===edit?{...form,id:d.id}:d); toast("Updated","success"); }
    else { u=[...dict,{...form,id:Date.now()}]; toast("Term added","success"); }
    setDict(u); saveShared("dict",u); setShowModal(false); setEdit(null); setForm({term:"",def:""});
  };

  const del = (id) => { const u=dict.filter(d=>d.id!==id); setDict(u); saveShared("dict",u); toast("Deleted","success"); };
  const filtered = dict.filter(d=>d.term.toLowerCase().includes(search.toLowerCase())||d.def.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">📖 Dictionary ({dict.length} terms)</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm({term:"",def:""});}}>+ Add Term</button>
        </div>
      </div>

      {pasteMode&&(
        <div className="card" style={{marginBottom:18}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:6}}>📋 Paste Dictionary Terms</div>
          <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:8}}>Format: <b style={{color:"var(--accent)"}}>Term | Definition</b> or <b style={{color:"var(--accent)"}}>Term: Definition</b> (one per line)</div>
          <textarea className="paste-box" placeholder={"Haemoptysis | Coughing up blood from the respiratory tract\nTachypnoea: Abnormally rapid breathing rate above 20 breaths/min\nOliguria | Reduced urine output below 400mL/day in adults"} value={pasteText} onChange={e=>setPasteText(e.target.value)} />
          <div style={{display:"flex",gap:8,marginBottom:parsed.length?10:0}}>
            <button className="btn btn-accent" onClick={parsePaste}>🔍 Parse</button>
            {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length}</button>}
            <button className="btn" onClick={()=>{setPasteMode(false);setParsed([]);setPasteText("");}}>Cancel</button>
          </div>
          {parsed.length>0&&<div className="parse-preview">{parsed.map((p,i)=><div key={i} className="parse-item"><span className="parse-check">✓</span><b style={{color:"var(--accent)"}}>{p.term}</b> — {p.def}</div>)}</div>}
        </div>
      )}

      <div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search terms..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <table className="tbl">
          <thead><tr><th>Term</th><th>Definition</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((d,i)=>(
              <tr key={d.id}>
                <td style={{fontFamily:"'Syne',sans-serif",fontWeight:700,color:"var(--accent)",width:200}}>{d.term}</td>
                <td style={{fontSize:13,color:"var(--text2)"}}>{d.def}</td>
                <td style={{width:90}}><div className="tbl-actions">
                  <button className="btn btn-sm" onClick={()=>{setEdit(i);setForm({term:d.term,def:d.def});setShowModal(true);}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>del(d.id)}>🗑️</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit!==null?"Edit":"Add"} Term</div><button className="modal-close" onClick={()=>setShowModal(false)}>✕</button></div>
            <label className="lbl">Term</label><input className="inp" value={form.term} onChange={e=>setForm({...form,term:e.target.value})} placeholder="e.g. Dyspnoea" />
            <label className="lbl">Definition</label><textarea className="inp" rows={3} style={{resize:"vertical"}} value={form.def} onChange={e=>setForm({...form,def:e.target.value})} placeholder="Clear medical definition..." />
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={save}>Save</button><button className="btn" onClick={()=>setShowModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Skills ─────────────────────────────────────────────────────
function AdminSkills({ toast }) {
  const [skills, setSkills] = useState(()=>ls("nv-skillsdb",DEFAULT_SKILLS));
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState([]);
  const [form, setForm] = useState({name:""});

  const parsePaste = () => {
    const items = pasteText.trim().split("\n").map(l=>l.trim()).filter(l=>l).map(l=>({name:l.replace(/^[\d\.\-\*]+\s*/,"")}));
    setParsed(items);
  };

  const importParsed = () => {
    const items = parsed.map(p=>({...p,id:Date.now()+Math.random()}));
    const u=[...skills,...items]; setSkills(u); saveShared("skills",u);
    toast(`${items.length} skills imported!`,"success"); setPasteText(""); setParsed([]); setPasteMode(false);
  };

  const save = () => {
    if (!form.name) return toast("Skill name required","error");
    let u;
    if (edit!==null) { u=skills.map((s,i)=>i===edit?{...s,name:form.name}:s); toast("Updated","success"); }
    else { u=[...skills,{name:form.name,id:Date.now()}]; toast("Skill added","success"); }
    setSkills(u); saveShared("skills",u); setShowModal(false); setEdit(null); setForm({name:""});
  };

  const del = (id) => { const u=skills.filter(s=>s.id!==id); setSkills(u); saveShared("skills",u); toast("Deleted","success"); };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">✅ Skills Checklist ({skills.length})</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm({name:""});}}>+ Add Skill</button>
        </div>
      </div>

      {pasteMode&&(
        <div className="card" style={{marginBottom:18}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:6}}>📋 Paste Skills</div>
          <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:8}}>One skill per line. Numbers/bullets at the start are auto-removed.</div>
          <textarea className="paste-box" placeholder={"1. Nasogastric tube insertion\n2. Tracheostomy care\n- Chest physiotherapy\nCardiovascular assessment\nPain assessment (PQRST)"} value={pasteText} onChange={e=>setPasteText(e.target.value)} />
          <div style={{display:"flex",gap:8,marginBottom:parsed.length?10:0}}>
            <button className="btn btn-accent" onClick={parsePaste}>🔍 Parse</button>
            {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length}</button>}
            <button className="btn" onClick={()=>{setPasteMode(false);setParsed([]);setPasteText("");}}>Cancel</button>
          </div>
          {parsed.length>0&&<div className="parse-preview">{parsed.map((p,i)=><div key={i} className="parse-item"><span className="parse-check">✓</span>{p.name}</div>)}</div>}
        </div>
      )}

      {skills.map((s,i)=>(
        <div key={s.id} className="card2" style={{marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:24,height:24,borderRadius:6,background:"rgba(62,142,149,.15)",border:"1px solid var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"var(--accent)",flexShrink:0}}>{i+1}</div>
          <div style={{flex:1,fontWeight:500,fontSize:14}}>{s.name}</div>
          <button className="btn btn-sm" onClick={()=>{setEdit(i);setForm({name:s.name});setShowModal(true);}}>✏️</button>
          <button className="btn btn-sm btn-danger" onClick={()=>del(s.id)}>🗑️</button>
        </div>
      ))}

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit!==null?"Edit":"Add"} Skill</div><button className="modal-close" onClick={()=>setShowModal(false)}>✕</button></div>
            <label className="lbl">Skill Name</label><input className="inp" value={form.name} onChange={e=>setForm({name:e.target.value})} placeholder="e.g. IV cannulation" />
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={save}>Save</button><button className="btn" onClick={()=>setShowModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Announcements ──────────────────────────────────────────────
function AdminAnnouncements({ toast }) {
  const [items, setItems] = useHydratedShared("nv-announcements", "announcements", DEFAULT_ANNOUNCEMENTS);
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({title:"",body:"",pinned:false});

  const save = () => {
    if (!form.title) return toast("Title required","error");
    let u;
    const item = {...form,date:new Date().toLocaleDateString(),id:edit||Date.now()};
    if (edit) { u=items.map(a=>a.id===edit?item:a); toast("Updated","success"); }
    else { u=[item,...items]; toast("Announcement posted!","success"); }
    setItems(u); saveShared("announcements",u); setShowModal(false); setEdit(null); setForm({title:"",body:"",pinned:false});
  };

  const del = (id) => { const u=items.filter(a=>a.id!==id); setItems(u); saveShared("announcements",u); toast("Deleted","success"); };
  const togglePin = (id) => { const u=items.map(a=>a.id===id?{...a,pinned:!a.pinned}:a); setItems(u); saveShared("announcements",u); };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">📢 Announcements ({items.length})</div>
        <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm({title:"",body:"",pinned:false});}}>+ Post Announcement</button>
      </div>
      {items.map(a=>(
        <div key={a.id} className="card" style={{marginBottom:12,borderLeft:a.pinned?"3px solid var(--warn)":"3px solid var(--border)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                {a.pinned&&<span className="tag tag-warn">📌 Pinned</span>}
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{a.title}</div>
              </div>
              <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.6,marginBottom:8}}>{a.body}</div>
              <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{a.date}</div>
            </div>
            <div style={{display:"flex",gap:5,flexShrink:0}}>
              <button className="btn btn-sm" title="Toggle pin" onClick={()=>togglePin(a.id)}>{a.pinned?"📌":"📍"}</button>
              <button className="btn btn-sm" onClick={()=>{setEdit(a.id);setForm({title:a.title,body:a.body,pinned:a.pinned});setShowModal(true);}}>✏️</button>
              <button className="btn btn-sm btn-danger" onClick={()=>del(a.id)}>🗑️</button>
            </div>
          </div>
        </div>
      ))}

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit?"Edit":"Post"} Announcement</div><button className="modal-close" onClick={()=>setShowModal(false)}>✕</button></div>
            <label className="lbl">Title</label><input className="inp" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Exam timetable released" />
            <label className="lbl">Body</label><textarea className="inp" rows={4} style={{resize:"vertical"}} value={form.body} onChange={e=>setForm({...form,body:e.target.value})} placeholder="Announcement details..." />
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <input type="checkbox" id="pin" checked={form.pinned} onChange={e=>setForm({...form,pinned:e.target.checked})} />
              <label htmlFor="pin" style={{fontSize:13,cursor:"pointer"}}>📌 Pin this announcement</label>
            </div>
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={save}>Post</button><button className="btn" onClick={()=>setShowModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Exam Retakes ───────────────────────────────────────────────
function AdminExamRetakes({ toast }) {
  const banks = useShared("pq", DEFAULT_PQ);
  const [users] = useHydratedShared("nv-users", "users", []);
  const [attempts, setAttempts] = useState(()=>ls("nv-exam-attempts",{}));
  const [search, setSearch] = useState("");

  const resetUserExam = (username, bankId) => {
    // Reset is stored per-user per-bank in nv-exam-attempts-<username>
    const key = `nv-exam-attempts-${username}`;
    const userAttempts = ls(key, {});
    const updated = { ...userAttempts };
    delete updated[bankId];
    saveMyData("mcq-att",key,updated);
    toast(`Retake reset for ${username} on "${banks.find(b=>b.id===bankId)?.subject||bankId}"`, "success");
    // force re-render
    setAttempts(prev=>({...prev}));
  };

  const resetAllExams = (username) => {
    if (!confirm(`Reset ALL exam attempts for ${username}?`)) return;
    saveMyData("mcq-att",`nv-exam-attempts-${username}`,{});
    toast(`All exam attempts reset for ${username}`, "success");
    setAttempts(prev=>({...prev}));
  };

  const students = users.filter(u=>u.role!=="admin");
  const filtered = students.filter(u=>u.username.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div className="sec-title">🔄 Exam Retake Management</div>
      <div className="sec-sub">View and reset student MCQ &amp; essay exam attempts (1 attempt per exam)</div>
      <div style={{background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.2)",borderRadius:10,padding:"10px 16px",fontSize:13,color:"var(--warn)",marginBottom:16}}>
        ℹ️ Students are allowed 1 attempt per exam. Use this panel to reset MCQ attempts where necessary. Essay attempts are managed in the Essay Exams tab.
      </div>
      <div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search students..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
      {filtered.map(u=>{
        const userAttempts = ls(`nv-exam-attempts-${u.username}`, {});
        const hasAttempts = Object.keys(userAttempts).length > 0;
        return (
          <div key={u.username} className="card" style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:hasAttempts?12:0}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div className="user-av">{u.username[0].toUpperCase()}</div>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>{u.username}</div>
                  <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{u.class||"No class"}</div>
                </div>
              </div>
              {hasAttempts&&<button className="btn btn-sm btn-warn" onClick={()=>resetAllExams(u.username)}>Reset All</button>}
            </div>
            {hasAttempts ? (
              <div>
                {Object.entries(userAttempts).map(([bankId, data])=>{
                  const bank = banks.find(b=>b.id===bankId||String(b.id)===String(bankId));
                  const locked = data.attempts >= 2;
                  return (
                    <div key={bankId} className="card2" style={{marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600,fontSize:13}}>{bank?.subject||`Exam #${bankId}`}</div>
                        <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>
                          {data.attempts}/2 attempts · Best: {data.results.length>0?Math.max(...data.results.map(r=>r.pct)):0}%
                          {data.results.some(r=>r.auto)&&<span style={{color:"var(--danger)",marginLeft:6}}>⚠️ Auto-submitted</span>}
                        </div>
                      </div>
                      {locked&&<span className="tag tag-danger">🔒 Locked</span>}
                      <button className="btn btn-sm btn-accent" onClick={()=>resetUserExam(u.username, bankId)}>
                        🔄 Grant Retake
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>No exam attempts recorded.</div>
            )}
          </div>
        );
      })}
      {filtered.length===0&&<div style={{textAlign:"center",padding:"40px",color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:13}}>No students found.</div>}
    </div>
  );
}


// ── Admin Essay Exams ────────────────────────────────────────────────
function AdminEssayExams({ toast }) {
  const [banks, setBanks] = useHydratedShared("nv-essay-banks", "essayBanks", []);
  const [selBank, setSelBank] = useState(null);
  const [showBankModal, setShowBankModal] = useState(false);
  const [showQModal, setShowQModal] = useState(false);
  const [editBank, setEditBank] = useState(null);
  const [editQ, setEditQ] = useState(null);
  const [bankForm, setBankForm] = useState({subject:"",description:""});
  const [qForm, setQForm] = useState({q:"",marks:10,wordGuide:"100-200",modelAnswer:""});
  const [adminTab, setAdminTab] = useState("banks"); // "banks" | "grade"
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [gradingStudent, setGradingStudent] = useState(null); // {submission, bankId}
  const [gradeForm, setGradeForm] = useState({}); // {qIdx: {marksAwarded, feedback}}
  const [overallComment, setOverallComment] = useState("");
  const [savingGrade, setSavingGrade] = useState(false);

  const saveBank = () => {
    if (!bankForm.subject.trim()) return toast("Subject required","error");
    let u;
    if (editBank!==null) { u=banks.map((b,i)=>i===editBank?{...b,...bankForm}:b); toast("Updated","success"); }
    else { u=[...banks,{...bankForm,id:Date.now(),questions:[]}]; toast("Essay bank created","success"); }
    setBanks(u); saveShared("essayBanks",u); setShowBankModal(false); setEditBank(null); setBankForm({subject:"",description:""});
  };

  const delBank = (id) => {
    if(!window.confirm("Delete this essay bank?")) return;
    const u=banks.filter(b=>b.id!==id); setBanks(u); saveShared("essayBanks",u);
    if(selBank===id) setSelBank(null); toast("Deleted","success");
  };

  const saveQ = () => {
    if (!qForm.q.trim()) return toast("Question required","error");
    const updated = banks.map(b=>{
      if (b.id!==selBank) return b;
      let qs;
      if (editQ!==null) { qs=b.questions.map((q,i)=>i===editQ?{...qForm,marks:+qForm.marks}:q); toast("Updated","success"); }
      else { qs=[...b.questions,{...qForm,marks:+qForm.marks}]; toast("Question added","success"); }
      return {...b,questions:qs};
    });
    setBanks(updated); saveShared("essayBanks",updated);
    setShowQModal(false); setEditQ(null); setQForm({q:"",marks:10,wordGuide:"100-200",modelAnswer:""});
  };

  const delQ = (bankId, qIdx) => {
    const u=banks.map(b=>b.id===bankId?{...b,questions:b.questions.filter((_,i)=>i!==qIdx)}:b);
    setBanks(u); saveShared("essayBanks",u); toast("Deleted","success");
  };

  const resetStudentEssay = (username, bankId) => {
    const key = `nv-essay-att-${username}`;
    const att = ls(key, {});
    delete att[bankId];
    lsSet(key, att);
    toast(`Essay attempt reset for ${username}`, "success");
  };

  const loadSubmissions = async () => {
    setLoadingSubs(true);
    try {
      const idx = await bsGet("essay-submissions-index") || [];
      const allSubs = await Promise.all(idx.map(async e => {
        const d = await bsGet(e.key);
        return d ? { ...d, student: e.student, bankId: e.bankId, graded: e.graded } : null;
      }));
      setSubmissions(allSubs.filter(Boolean));
    } catch { toast("Could not load submissions", "error"); }
    setLoadingSubs(false);
  };

  useEffect(() => {
    if (adminTab === "grade") loadSubmissions();
  }, [adminTab]);

  const startManualGrade = (sub) => {
    const initForm = {};
    (sub.questions || []).forEach((_, i) => { initForm[i] = { marksAwarded: 0, feedback: "" }; });
    setGradeForm(initForm);
    setOverallComment("");
    setGradingStudent(sub);
  };

  const submitManualGrade = async () => {
    if (!gradingStudent) return;
    setSavingGrade(true);
    const questions = (gradingStudent.questions || []);
    const totalScore = Object.values(gradeForm).reduce((s, v) => s + (+v.marksAwarded || 0), 0);
    const totalMarks = questions.reduce((s, q) => s + (+q.marks || 10), 0);
    const pct = totalMarks > 0 ? Math.round((totalScore / totalMarks) * 100) : 0;
    const grade = pct >= 70 ? "A" : pct >= 60 ? "B" : pct >= 50 ? "C" : pct >= 40 ? "D" : "F";
    const gradeData = {
      score: totalScore, total: totalMarks, pct, grade,
      overallComment, gradedBy: "Lecturer",
      questions: questions.map((q, i) => ({
        q: q.q, maxMarks: q.marks || 10,
        marksAwarded: +gradeForm[i]?.marksAwarded || 0,
        feedback: gradeForm[i]?.feedback || ""
      }))
    };
    try {
      await saveManualGradeToBackend(gradingStudent.student, gradingStudent.bankId, gradeData);
      toast(`Grade saved for ${gradingStudent.student}`, "success");
      setGradingStudent(null);
      loadSubmissions();
    } catch { toast("Failed to save grade", "error"); }
    setSavingGrade(false);
  };

  const currentBank = banks.find(b=>b.id===selBank);
  const users = ls("nv-users",[]).filter(u=>u.role==="student");

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div className="sec-title">✍️ Essay Exams</div>
          <div className="sec-sub">Create essay exams · AI or manual grading · 1 attempt per student</div>
        </div>
        {adminTab === "banks" && <button className="btn btn-purple" onClick={()=>{setShowBankModal(true);setEditBank(null);setBankForm({subject:"",description:""});}}>+ New Essay Exam</button>}
        {adminTab === "grade" && <button className="btn btn-accent btn-sm" onClick={loadSubmissions}>🔄 Refresh</button>}
      </div>

      {/* Admin tabs */}
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {[
          {key:"banks",label:"📋 Exam Banks"},
          {key:"grade",label:"📝 Manual Grading"},
        ].map(t=>(
          <div key={t.key} onClick={()=>setAdminTab(t.key)} style={{
            padding:"8px 18px",borderRadius:9,cursor:"pointer",fontSize:13,fontFamily:"'DM Mono',monospace",transition:"all .2s",
            border:`1px solid ${adminTab===t.key?"var(--purple)":"var(--border)"}`,
            background:adminTab===t.key?"rgba(124,58,237,.15)":"transparent",
            color:adminTab===t.key?"var(--purple)":"var(--text3)"
          }}>{t.label}</div>
        ))}
      </div>

      {adminTab === "grade" && (
        <div>
          {/* Manual grading modal */}
          {gradingStudent && (
            <div className="modal-overlay" onClick={()=>setGradingStudent(null)}>
              <div className="modal xl" onClick={e=>e.stopPropagation()} style={{maxHeight:"90vh"}}>
                <div className="modal-head">
                  <div className="modal-title">✏️ Grade Essay — {gradingStudent.student?.split("@")[0]}</div>
                  <button className="modal-close" onClick={()=>setGradingStudent(null)}>✕</button>
                </div>
                <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:16}}>
                  Subject: <b style={{color:"var(--accent)"}}>{gradingStudent.subject}</b> · Submitted {gradingStudent.date}
                </div>
                {(gradingStudent.questions || []).map((q, i) => (
                  <div key={i} className="card" style={{marginBottom:14}}>
                    <div style={{fontWeight:700,fontSize:14,marginBottom:6}}>Q{i+1}. {q.q} <span style={{color:"var(--accent)",fontFamily:"'DM Mono',monospace",fontSize:11}}>[{q.marks||10} marks]</span></div>
                    <div style={{background:"var(--bg4)",borderRadius:9,padding:"10px 14px",fontSize:13,color:"var(--text2)",lineHeight:1.6,marginBottom:10,fontStyle:"italic",borderLeft:"2px solid var(--border2)"}}>
                      {(gradingStudent.answers || {})[i] || "(no answer)"}
                    </div>
                    <div className="form-row">
                      <div>
                        <label className="lbl">Marks Awarded (max {q.marks||10})</label>
                        <input className="inp" type="number" min="0" max={q.marks||10}
                          value={gradeForm[i]?.marksAwarded||0}
                          onChange={e=>setGradeForm(f=>({...f,[i]:{...f[i],marksAwarded:Math.min(+e.target.value,q.marks||10)}}))}
                        />
                      </div>
                      <div>
                        <label className="lbl">Feedback</label>
                        <input className="inp" placeholder="Brief feedback for this answer..."
                          value={gradeForm[i]?.feedback||""}
                          onChange={e=>setGradeForm(f=>({...f,[i]:{...f[i],feedback:e.target.value}}))}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <label className="lbl">Overall Comment</label>
                <textarea className="inp" rows={3} style={{resize:"vertical"}} placeholder="Overall performance summary..."
                  value={overallComment} onChange={e=>setOverallComment(e.target.value)} />
                <div style={{background:"rgba(62,142,149,.08)",border:"1px solid rgba(62,142,149,.2)",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13}}>
                  📊 Total: <b style={{color:"var(--accent)"}}>{Object.values(gradeForm).reduce((s,v)=>s+(+v.marksAwarded||0),0)}</b> / {(gradingStudent.questions||[]).reduce((s,q)=>s+(+q.marks||10),0)} marks
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn btn-purple" style={{flex:1}} onClick={submitManualGrade} disabled={savingGrade}>
                    {savingGrade?"Saving...":"💾 Save Grade & Notify Student"}
                  </button>
                  <button className="btn" onClick={()=>setGradingStudent(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {loadingSubs ? (
            <div style={{textAlign:"center",padding:"40px",color:"var(--text3)"}}>
              <div style={{fontSize:32,animation:"spin 1.5s linear infinite",display:"inline-block",marginBottom:12}}>⏳</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>Loading submissions from backend...</div>
            </div>
          ) : submissions.length === 0 ? (
            <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}>
              <div style={{fontSize:48,marginBottom:12}}>📭</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>No essay submissions in backend yet.</div>
              <div style={{fontSize:12,marginTop:6}}>Submissions appear here when students submit their essays.</div>
            </div>
          ) : (
            <div>
              <div style={{background:"rgba(251,146,60,.07)",border:"1px solid rgba(251,146,60,.2)",borderRadius:10,padding:"10px 16px",fontSize:13,color:"var(--warn)",marginBottom:16}}>
                ℹ️ All essay submissions are stored in the backend. You can manually grade submissions here when AI is unavailable.
              </div>
              <div className="card" style={{padding:0,overflow:"hidden"}}>
                <table className="tbl">
                  <thead><tr><th>Student</th><th>Exam</th><th>Submitted</th><th>Status</th><th>Score</th><th>Action</th></tr></thead>
                  <tbody>
                    {submissions.map((sub, i) => {
                      const bank = banks.find(b=>String(b.id)===String(sub.bankId));
                      const isPending = sub.pendingManualGrade && !sub.manualGrade;
                      const isAIGraded = sub.gradedByAI && sub.feedback;
                      const isManualGraded = !!sub.manualGrade;
                      return (
                        <tr key={i}>
                          <td style={{fontWeight:600}}>{sub.student?.split("@")[0]}<br/><span style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{sub.student}</span></td>
                          <td style={{fontSize:12,color:"var(--text2)"}}>{bank?.subject || sub.subject || `Exam #${sub.bankId}`}</td>
                          <td style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{sub.date}</td>
                          <td>
                            {isPending && <span className="tag tag-warn">⏳ Needs Grading</span>}
                            {isAIGraded && <span className="tag tag-success">🤖 AI Graded</span>}
                            {isManualGraded && <span className="tag tag-accent">✏️ Manually Graded</span>}
                          </td>
                          <td style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700}}>
                            {isAIGraded && `${sub.feedback?.overallPct}% (${sub.feedback?.grade})`}
                            {isManualGraded && `${sub.manualGrade?.pct}% (${sub.manualGrade?.grade})`}
                            {isPending && "—"}
                          </td>
                          <td>
                            <button className="btn btn-sm btn-purple" onClick={()=>startManualGrade(sub)}>
                              {isManualGraded ? "✏️ Re-grade" : isPending ? "📝 Grade Now" : "👁 View"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {adminTab === "banks" && (
      <div>
        <div className="grid2" style={{marginBottom:16}}>
        {banks.map((b,i)=>(
          <div key={b.id} className="card" style={{cursor:"pointer",border:selBank===b.id?"1px solid var(--purple)":"1px solid var(--border)",transition:"border .2s"}} onClick={()=>setSelBank(b.id)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{b.subject}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{b.questions.length} questions · {b.questions.reduce((s,q)=>s+(q.marks||10),0)} total marks</div>
                {b.description&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{b.description}</div>}
              </div>
              <div style={{display:"flex",gap:5,flexShrink:0}}>
                <button className="btn btn-sm" onClick={e=>{e.stopPropagation();setEditBank(i);setBankForm({subject:b.subject,description:b.description||""});setShowBankModal(true);}}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();delBank(b.id);}}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
        {banks.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:"40px",color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:13}}>No essay exams yet. Create one above.</div>}
        </div>

      {currentBank&&(
        <div className="card" style={{marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700}}>{currentBank.subject} — Questions ({currentBank.questions.length})</div>
            <button className="btn btn-purple btn-sm" onClick={()=>{setShowQModal(true);setEditQ(null);setQForm({q:"",marks:10,wordGuide:"100-200",modelAnswer:""});}}>+ Add Question</button>
          </div>
          {currentBank.questions.length===0&&<div style={{textAlign:"center",padding:"20px",color:"var(--text3)",fontSize:13}}>No questions yet.</div>}
          {currentBank.questions.map((q,qi)=>(
            <div key={qi} className="card2" style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:4}}>{qi+1}. {q.q}</div>
                  <div style={{display:"flex",gap:8,fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",flexWrap:"wrap"}}>
                    <span style={{color:"var(--accent)"}}>{q.marks||10} marks</span>
                    <span>· {q.wordGuide||"100-200"} words</span>
                    {q.modelAnswer&&<span style={{color:"var(--success)"}}>· Model answer set ✓</span>}
                  </div>
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0}}>
                  <button className="btn btn-sm" onClick={()=>{setEditQ(qi);setQForm({q:q.q,marks:q.marks||10,wordGuide:q.wordGuide||"100-200",modelAnswer:q.modelAnswer||""});setShowQModal(true);}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>delQ(currentBank.id,qi)}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Student attempt tracker */}
      {selBank&&users.length>0&&(
        <div className="card">
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>Student Attempts</div>
          {users.map(u=>{
            const att = ls(`nv-essay-att-${u.username}`,{})[selBank];
            return (
              <div key={u.username} className="card2" style={{marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
                <div className="user-av" style={{width:30,height:30,fontSize:12}}>{u.username[0].toUpperCase()}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:13}}>{u.username}</div>
                  <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>
                    {att ? `Submitted ${att.date} · Score: ${att.score!==null?`${att.score}/${att.total||100} (${att.pct}%)`:"Pending manual grade"}` : "Not attempted"}
                  </div>
                </div>
                {att&&<button className="btn btn-sm btn-accent" onClick={()=>resetStudentEssay(u.username,selBank)}>🔄 Reset</button>}
                {!att&&<span style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>—</span>}
              </div>
            );
          })}
        </div>
      )}

      {showBankModal&&(
        <div className="modal-overlay" onClick={()=>setShowBankModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editBank!==null?"Edit":"New"} Essay Exam</div><button className="modal-close" onClick={()=>setShowBankModal(false)}>✕</button></div>
            <label className="lbl">Subject / Title</label><input className="inp" value={bankForm.subject} onChange={e=>setBankForm({...bankForm,subject:e.target.value})} placeholder="e.g. Medical-Surgical Nursing Essay" />
            <label className="lbl">Description (optional)</label><input className="inp" value={bankForm.description} onChange={e=>setBankForm({...bankForm,description:e.target.value})} placeholder="Brief description of this essay exam" />
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={saveBank}>Save</button><button className="btn" onClick={()=>setShowBankModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {showQModal&&(
        <div className="modal-overlay" onClick={()=>setShowQModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editQ!==null?"Edit":"Add"} Essay Question</div><button className="modal-close" onClick={()=>setShowQModal(false)}>✕</button></div>
            <label className="lbl">Question</label><textarea className="inp" rows={3} style={{resize:"vertical"}} value={qForm.q} onChange={e=>setQForm({...qForm,q:e.target.value})} placeholder="e.g. Describe the nursing management of a patient with acute myocardial infarction." />
            <div className="form-row">
              <div><label className="lbl">Marks</label><input className="inp" type="number" min="1" max="100" value={qForm.marks} onChange={e=>setQForm({...qForm,marks:e.target.value})} /></div>
              <div><label className="lbl">Word Guide</label><input className="inp" value={qForm.wordGuide} onChange={e=>setQForm({...qForm,wordGuide:e.target.value})} placeholder="e.g. 150-250" /></div>
            </div>
            <label className="lbl">Model Answer (guides AI grading)</label><textarea className="inp" rows={4} style={{resize:"vertical"}} value={qForm.modelAnswer} onChange={e=>setQForm({...qForm,modelAnswer:e.target.value})} placeholder="Key points the AI should look for when grading this question..." />
            <div style={{display:"flex",gap:8}}><button className="btn btn-purple" style={{flex:1}} onClick={saveQ}>Save</button><button className="btn" onClick={()=>setShowQModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  );
}

// ── Admin Handouts ───────────────────────────────────────────────────
// ─── Shared file-upload helpers ──────────────────────────────────────
const FILE_TYPES = {
  "application/pdf":                                    { ext:"pdf",  icon:"📄", label:"PDF"   },
  "application/msword":                                 { ext:"doc",  icon:"📝", label:"Word"  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                                                        { ext:"docx", icon:"📝", label:"Word"  },
  "application/vnd.ms-powerpoint":                      { ext:"ppt",  icon:"📊", label:"PPT"   },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
                                                        { ext:"pptx", icon:"📊", label:"PPT"   },
  "image/jpeg":                                         { ext:"jpg",  icon:"🖼️", label:"Image" },
  "image/png":                                          { ext:"png",  icon:"🖼️", label:"Image" },
  "image/gif":                                          { ext:"gif",  icon:"🖼️", label:"Image" },
  "image/webp":                                         { ext:"webp", icon:"🖼️", label:"Image" },
};
const ACCEPTED_TYPES = Object.keys(FILE_TYPES).join(",");
const fileIcon  = (mime) => FILE_TYPES[mime]?.icon  || "📎";
const fileLabel = (mime) => FILE_TYPES[mime]?.label || "File";

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = () => rej(new Error("Read failed"));
    r.readAsDataURL(file);
  });
}

// FileViewer: renders PDF in iframe, images inline, others as download
function FileViewer({ handout }) {
  if (!handout.fileData) {
    if (handout.fileUrl) return (
      <div style={{textAlign:"center",padding:20}}>
        <a href={handout.fileUrl} target="_blank" rel="noreferrer"
          style={{background:"var(--accent)",color:"white",padding:"10px 22px",borderRadius:10,textDecoration:"none",fontWeight:700}}>
          🔗 Open Link
        </a>
      </div>
    );
    return <div style={{fontSize:13,color:"var(--text3)",textAlign:"center",padding:30}}>No file attached.</div>;
  }
  const mime = handout.fileMime || "";
  const isImage = mime.startsWith("image/");
  const isPdf   = mime === "application/pdf";
  return (
    <div>
      <div style={{background:"var(--bg4)",borderRadius:10,padding:"8px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:10,fontSize:12,color:"var(--text3)"}}>
        <span style={{fontSize:18}}>{fileIcon(mime)}</span>
        <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{handout.fileName}</span>
        <a href={handout.fileData} download={handout.fileName}
          style={{background:"var(--accent)",color:"white",padding:"5px 14px",borderRadius:8,textDecoration:"none",fontSize:12,fontWeight:700,flexShrink:0}}
          onClick={e=>e.stopPropagation()}>
          ⬇️ Download
        </a>
      </div>
      {isPdf && (
        <iframe src={handout.fileData} title={handout.title}
          style={{width:"100%",height:"65vh",border:"1px solid var(--border)",borderRadius:10,display:"block"}} />
      )}
      {isImage && (
        <img src={handout.fileData} alt={handout.title}
          style={{width:"100%",maxHeight:"65vh",objectFit:"contain",borderRadius:10,border:"1px solid var(--border)"}} />
      )}
      {!isPdf && !isImage && (
        <div style={{background:"var(--bg4)",borderRadius:10,padding:"40px 20px",textAlign:"center",color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}>{fileIcon(mime)}</div>
          <div style={{fontSize:14,marginBottom:16}}>Preview not available for {fileLabel(mime)} files</div>
          <a href={handout.fileData} download={handout.fileName}
            style={{background:"var(--accent)",color:"white",padding:"10px 22px",borderRadius:10,textDecoration:"none",fontWeight:700}}>
            ⬇️ Download to view
          </a>
        </div>
      )}
    </div>
  );
}

// UploadDropzone: reusable drag-and-drop file picker
function UploadDropzone({ fileData, fileName, fileMime, onChange, uploading }) {
  const [drag, setDrag] = useState(false);
  const handleFile = async (file) => {
    if (!FILE_TYPES[file.type]) return onChange(null, null, null, "Unsupported file type. Accepted: PDF, Word, PPT, Images");
    if (file.size > 15 * 1024 * 1024) return onChange(null, null, null, "File must be under 15MB");
    try {
      const data = await readFileAsDataURL(file);
      onChange(data, file.name, file.type, null);
    } catch { onChange(null, null, null, "Failed to read file"); }
  };
  return (
    <label
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)handleFile(f);}}
      style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,
        padding:"20px 14px",border:`2px dashed ${drag?"var(--accent)":fileData?"var(--success)":"var(--border2)"}`,
        borderRadius:12,cursor:"pointer",background:drag?"rgba(62,142,149,.08)":fileData?"rgba(74,222,128,.06)":"var(--bg4)",
        transition:"all .2s",minHeight:90,textAlign:"center"}}>
      {uploading ? (
        <><span style={{fontSize:28}}>⏳</span><span style={{fontSize:12,color:"var(--text3)"}}>Processing…</span></>
      ) : fileData ? (
        <><span style={{fontSize:28}}>{fileIcon(fileMime)}</span>
          <span style={{fontSize:13,color:"var(--success)",fontWeight:600,wordBreak:"break-all"}}>{fileName}</span>
          <span style={{fontSize:11,color:"var(--text3)"}}>Click to change</span>
        </>
      ) : (
        <><span style={{fontSize:28}}>📁</span>
          <span style={{fontSize:13,color:"var(--text3)"}}>Drag & drop or click to upload</span>
          <span style={{fontSize:11,color:"var(--text3)"}}>PDF · Word · PPT · Images · max 15 MB</span>
        </>
      )}
      <input type="file" accept={ACCEPTED_TYPES} style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)handleFile(f);}} />
    </label>
  );
}

function AdminHandouts({ toast }) {
  const [handouts, setHandouts] = useHydratedShared("nv-handouts", "handouts", []);
  const classes = useShared("classes", DEFAULT_CLASSES);
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({title:"",description:"",classId:"",course:""});
  const [fileData, setFileData] = useState(null);
  const [fileName, setFileName] = useState("");
  const [fileMime, setFileMime] = useState("");

  const openAdd = () => {
    setEdit(null); setForm({title:"",description:"",classId:"",course:""});
    setFileData(null); setFileName(""); setFileMime(""); setShowModal(true);
  };
  const openEdit = (h) => {
    setEdit(h.id); setForm({title:h.title,description:h.description||"",classId:h.classId||"",course:h.course||""});
    setFileData(h.fileData||null); setFileName(h.fileName||""); setFileMime(h.fileMime||""); setShowModal(true);
  };

  const handleFile = (data, name, mime, err) => {
    if (err) return toast(err, "error");
    setFileData(data); setFileName(name); setFileMime(mime);
  };

  const save = () => {
    if (!form.title.trim()) return toast("Title required", "error");
    const base = { ...form, id: edit || Date.now(), uploadedBy:"admin", date: new Date().toLocaleDateString(),
      fileData: fileData||null, fileName: fileName||"", fileMime: fileMime||"" };
    const u = edit ? handouts.map(h=>h.id===edit?base:h) : [...handouts, base];
    setHandouts(u); setShowModal(false);
    toast(edit ? "Handout updated!" : "Handout uploaded!", "success");
  };

  const del = (id) => {
    if (!confirm("Delete this handout?")) return;
    const u = handouts.filter(h=>h.id!==id); setHandouts(u); toast("Deleted","success");
  };

  const selCls = classes.find(c=>c.id===form.classId);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">📄 All Handouts ({handouts.length})</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-accent" onClick={openAdd}>+ Upload Handout</button>
          {handouts.length>0&&<button className="btn btn-danger btn-sm" onClick={()=>{if(!confirm("Delete ALL handouts?"))return;setHandouts([]);toast("All cleared","warn");}}>🗑️ Clear All</button>}
        </div>
      </div>

      {handouts.length===0 ? (
        <div style={{textAlign:"center",padding:"50px 20px",color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}>📭</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>No handouts yet. Upload the first one!</div>
        </div>
      ) : (
        <div className="grid2">
          {handouts.map(h=>{
            const c=classes.find(x=>x.id===h.classId);
            return (
              <div key={h.id} className="card" style={{cursor:"pointer",borderLeft:`3px solid ${c?.color||"var(--accent)"}`}}
                onClick={()=>setViewItem(h)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {c&&<span className="tag tag-accent">{c.label}</span>}
                    {h.course&&<span className="tag">{h.course}</span>}
                    {h.fileData&&<span className="tag" style={{borderColor:"var(--accent2)",color:"var(--accent2)"}}>{fileIcon(h.fileMime)} {fileLabel(h.fileMime)}</span>}
                  </div>
                  <div style={{display:"flex",gap:4,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                    <button className="btn btn-sm" onClick={()=>openEdit(h)}>✏️</button>
                    <button className="btn btn-sm btn-danger" onClick={()=>del(h.id)}>🗑️</button>
                  </div>
                </div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,marginBottom:4}}>{h.title}</div>
                {h.description&&<div style={{fontSize:12,color:"var(--text2)",marginBottom:6,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{h.description}</div>}
                {!h.fileData&&!h.description&&<div style={{fontSize:12,color:"var(--text3)"}}>Text notes</div>}
                <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginTop:8}}>
                  {h.date} · by {h.uploadedBy?.split("@")[0]||"admin"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" style={{maxWidth:520}} onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">{edit?"Edit Handout":"Upload Handout"}</div>
              <button className="modal-close" onClick={()=>setShowModal(false)}>✕</button>
            </div>
            <label className="lbl">Title *</label>
            <input className="inp" placeholder="e.g. Week 3 – Pharmacokinetics" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} />
            <label className="lbl">Description</label>
            <textarea className="inp" rows={2} style={{resize:"vertical"}} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} />
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label className="lbl">Class</label>
                <select className="inp" value={form.classId} onChange={e=>setForm({...form,classId:e.target.value,course:""})}>
                  <option value="">All classes</option>
                  {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl">Course</label>
                <select className="inp" value={form.course} onChange={e=>setForm({...form,course:e.target.value})} disabled={!selCls}>
                  <option value="">General</option>
                  {(selCls?.courses||[]).map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <label className="lbl" style={{marginTop:4}}>Attach File (optional)</label>
            <UploadDropzone fileData={fileData} fileName={fileName} fileMime={fileMime} onChange={handleFile} uploading={uploading} />
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={save}>
                {edit?"💾 Save Changes":"📤 Upload & Publish"}
              </button>
              <button className="btn" onClick={()=>setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {viewItem&&(
        <div className="modal-overlay" onClick={()=>setViewItem(null)}>
          <div className="modal" style={{maxWidth:800,width:"95vw"}} onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">{viewItem.title}</div>
              <button className="modal-close" onClick={()=>setViewItem(null)}>✕</button>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
              {classes.find(c=>c.id===viewItem.classId)&&<span className="tag tag-accent">{classes.find(c=>c.id===viewItem.classId).label}</span>}
              {viewItem.course&&<span className="tag">{viewItem.course}</span>}
              <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginLeft:"auto"}}>
                {viewItem.date} · by {viewItem.uploadedBy?.split("@")[0]||"admin"}
              </div>
            </div>
            {viewItem.description&&<div style={{fontSize:13,color:"var(--text2)",marginBottom:14,lineHeight:1.6}}>{viewItem.description}</div>}
            <FileViewer handout={viewItem} />
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// STUDENT VIEWS
// ════════════════════════════════════════════════════════════════════
function Dashboard({ user, onNavigate }) {
  const handouts = useShared("handouts", []);
  const classes = useShared("classes", DEFAULT_CLASSES);
  const announcements = useShared("announcements", []).filter(a=>a.pinned);
  const results = useMyData("nv-results", []);
  const users = useShared("users", []);
  return (
    <div>
      {announcements.length>0&&announcements.map(a=>(
        <div key={a.id} style={{background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.25)",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",gap:10}}>
          <span>📌</span>
          <div><div style={{fontWeight:700,marginBottom:2}}>{a.title}</div><div style={{fontSize:13,color:"var(--text2)"}}>{a.body}</div></div>
        </div>
      ))}
      <div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search handouts, courses, tools..." /></div>
      <div className="grid5" style={{marginBottom:24}}>
        {[
          {lbl:"CLASSES",val:classes.length,sub:"Active programs"},
          {lbl:"COURSES",val:classes.reduce((s,c)=>s+c.courses.length,0),sub:"Across all classes"},
          {lbl:"HANDOUTS",val:handouts.length,sub:"Total uploaded"},
          {lbl:"RESULTS",val:results.length,sub:"Test & exam scores"},
          {lbl:"USERS",val:users.length,sub:"Registered accounts"},
        ].map((s,i)=>(
          <div key={s.lbl} className="stat-card" style={{animationDelay:`${i*.06}s`}}>
            <div className="stat-lbl">{s.lbl}</div>
            <div className="stat-val">{s.val}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="sec-title">Classes</div>
      <div className="sec-sub">Select a class to browse courses and handouts</div>
      <div className="grid2">
        {classes.map((c,i)=>(
          <div className="class-card" key={c.id} style={{"--cc":c.color,animationDelay:`${.08+i*.03}s`}} onClick={()=>onNavigate("handouts",c)}>
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
  );
}

function Handouts({ selectedClass, toast, currentUser, isLecturer }) {
  const classes = useShared("classes", DEFAULT_CLASSES);
  const [handouts, setHandouts] = useHydratedShared("nv-handouts", "handouts", []);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selClass, setSelClass] = useState(selectedClass?.id||"");
  const [selCourse, setSelCourse] = useState("");
  const [filter, setFilter] = useState("");
  const [viewItem, setViewItem] = useState(null);
  const [fileData, setFileData] = useState(null);
  const [fileName, setFileName] = useState("");
  const [fileMime, setFileMime] = useState("");
  const [uploading] = useState(false);

  const pushNotification = (item) => {
    const notifs = ls("nv-notifications", []);
    saveMyData("notifications","nv-notifications",[{
      id:Date.now(), type:"handout",
      title:`New handout: ${item.title}`,
      body:`${currentUser.split("@")[0]} uploaded ${item.fileName?`a ${fileLabel(item.fileMime)} file`:"notes"}${item.course?` for ${item.course}`:""}`,
      from:currentUser, date:new Date().toLocaleDateString(),
      time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
      read:false, handoutId:item.id
    }, ...notifs]);
  };

  const handleFile = (data, name, mime, err) => {
    if (err) return toast(err, "error");
    setFileData(data); setFileName(name); setFileMime(mime);
  };

  const save = () => {
    if (!title.trim()) return toast("Enter a title","error");
    const item = {
      id:Date.now(), title, description, classId:selClass, course:selCourse,
      date:new Date().toLocaleDateString(), uploadedBy:currentUser,
      fileData:fileData||null, fileName:fileName||"", fileMime:fileMime||""
    };
    const u=[...handouts,item]; setHandouts(u);
    pushNotification(item);
    setTitle(""); setDescription(""); setFileData(null); setFileName(""); setFileMime("");
    setShowAdd(false); toast("Handout published! Students notified. ✅","success");
  };

  const del=(id)=>{ setHandouts(handouts.filter(h=>h.id!==id)); toast("Deleted","info"); };
  const filtered=handouts.filter(h=>h.title.toLowerCase().includes(filter.toLowerCase())||(h.course||"").toLowerCase().includes(filter.toLowerCase()));
  const cls=classes.find(c=>c.id===selClass);

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div><div className="sec-title">📄 All Handouts</div><div className="sec-sub">{handouts.length} handouts stored</div></div>
        {isLecturer && <button className="btn btn-accent" onClick={()=>setShowAdd(true)}>+ Upload Handout</button>}
      </div>
      <div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search handouts…" value={filter} onChange={e=>setFilter(e.target.value)} /></div>

      {filtered.length===0 ? (
        <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}>📭</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>No handouts yet!</div>
        </div>
      ) : (
        <div className="grid2">
          {filtered.map(h=>{
            const c=classes.find(x=>x.id===h.classId);
            return (
              <div key={h.id} className="card" style={{cursor:"pointer",borderLeft:`3px solid ${c?.color||"var(--accent)"}`}} onClick={()=>setViewItem(h)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {c&&<div className="tag tag-accent">{c.label}</div>}
                    {h.fileData&&<span className="tag" style={{borderColor:"var(--accent2)",color:"var(--accent2)"}}>{fileIcon(h.fileMime)} {fileLabel(h.fileMime)}</span>}
                    {/* legacy PDF support */}
                    {!h.fileData&&h.pdfName&&<span className="tag" style={{borderColor:"var(--danger)",color:"var(--danger)"}}>📄 PDF</span>}
                  </div>
                  {isLecturer && <button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();del(h.id);}}>✕</button>}
                </div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,marginBottom:4}}>{h.title}</div>
                {h.course&&<div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>{h.course}</div>}
                {h.fileData ? (
                  <div style={{fontSize:12,color:"var(--text3)",display:"flex",alignItems:"center",gap:6}}>
                    {fileIcon(h.fileMime)} {h.fileName}
                  </div>
                ) : h.pdfName ? (
                  <div style={{fontSize:12,color:"var(--text3)",display:"flex",alignItems:"center",gap:6}}>📎 {h.pdfName}</div>
                ) : (
                  <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{h.note||h.description||"No content"}</div>
                )}
                <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginTop:8,display:"flex",justifyContent:"space-between"}}>
                  <span>{h.date}</span>
                  {h.uploadedBy&&<span>by {h.uploadedBy.split("@")[0]}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Modal (lecturers only) */}
      {showAdd&&(
        <div className="modal-overlay" onClick={()=>setShowAdd(false)}>
          <div className="modal" style={{maxWidth:520}} onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">Upload Handout</div><button className="modal-close" onClick={()=>setShowAdd(false)}>✕</button></div>
            <label className="lbl">Title *</label>
            <input className="inp" placeholder="e.g. Chapter 3 Notes" value={title} onChange={e=>setTitle(e.target.value)} />
            <label className="lbl">Description</label>
            <textarea className="inp" rows={2} style={{resize:"vertical"}} value={description} onChange={e=>setDescription(e.target.value)} />
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label className="lbl">Class</label>
                <select className="inp" value={selClass} onChange={e=>{setSelClass(e.target.value);setSelCourse("");}}>
                  <option value="">Select class…</option>
                  {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl">Course</label>
                <select className="inp" value={selCourse} onChange={e=>setSelCourse(e.target.value)} disabled={!cls}>
                  <option value="">General</option>
                  {(cls?.courses||[]).map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <label className="lbl" style={{marginTop:4}}>Attach File</label>
            <UploadDropzone fileData={fileData} fileName={fileName} fileMime={fileMime} onChange={handleFile} uploading={uploading} />
            {fileData&&(
              <button className="btn btn-sm btn-danger" style={{marginTop:6}} onClick={()=>{setFileData(null);setFileName("");setFileMime("");}}>
                ✕ Remove file
              </button>
            )}
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={save}>📤 Publish & Notify Students</button>
              <button className="btn" onClick={()=>setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewItem&&(
        <div className="modal-overlay" onClick={()=>setViewItem(null)}>
          <div className="modal" style={{maxWidth:800,width:"95vw"}} onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">{viewItem.title}</div>
              <button className="modal-close" onClick={()=>setViewItem(null)}>✕</button>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
              {viewItem.course&&<div className="tag tag-accent">{viewItem.course}</div>}
              {viewItem.fileData&&<div className="tag" style={{borderColor:"var(--accent2)",color:"var(--accent2)"}}>{fileIcon(viewItem.fileMime)} {fileLabel(viewItem.fileMime)}</div>}
              {!viewItem.fileData&&viewItem.pdfName&&<div className="tag" style={{borderColor:"var(--danger)",color:"var(--danger)"}}>📄 PDF</div>}
              <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginLeft:"auto"}}>
                Added {viewItem.date}{viewItem.uploadedBy&&` · by ${viewItem.uploadedBy.split("@")[0]}`}
              </div>
            </div>
            {viewItem.description&&<div style={{fontSize:13,color:"var(--text2)",marginBottom:14,lineHeight:1.6}}>{viewItem.description}</div>}
            {/* Render new-style file or legacy pdfData */}
            {viewItem.fileData ? (
              <FileViewer handout={viewItem} />
            ) : viewItem.pdfData ? (
              <FileViewer handout={{...viewItem, fileData:viewItem.pdfData, fileName:viewItem.pdfName, fileMime:"application/pdf"}} />
            ) : (
              <div style={{maxHeight:"65vh",overflowY:"auto",padding:"4px 0"}}>
                <div style={{fontSize:14,lineHeight:1.9,color:"var(--text2)",whiteSpace:"pre-wrap"}}>{viewItem.note||viewItem.description||"No content."}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MCQ Exam View ────────────────────────────────────────────────────
function MCQExamView({ toast, currentUser, banks }) {
  const attKey = `nv-mcq-att-${currentUser}`;
  const [att, setAtt] = useHydratedUser(attKey, "mcq-att", {});
  const [sel, setSel] = useState(null);
  const [active, setActive] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [qIdx, setQIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [finalAnswers, setFinalAnswers] = useState([]);

  const startExam = (bank) => {
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
    const newAtt = { ...att, [String(sel.id)]: { score, total: sel.questions.length, pct, answers: snap, date: new Date().toLocaleDateString() } };
    setAtt(newAtt); // useHydratedUser auto-saves to backend
    const results = ls("nv-results", []);
    saveMyData("results","nv-results",[...results, { id:Date.now(), subject:sel.subject, type:"MCQ Exam", score, total:sel.questions.length, pct, date:new Date().toLocaleDateString() }]);
    notifyUserKey("nv-results");
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
          <button className="btn" onClick={()=>{setSel(null);setDone(false);}}>← Back to Exams</button>
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
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>{answeredCount}/{sel.questions.length} answered · click any number to jump</div>
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
    <div className="grid2">
      {banks.map((b,i)=>{
        const bankAtt = att[String(b.id)];
        return (
          <div key={b.id} className="card" style={{animation:`fadeUp .4s ease ${i*.08}s both`}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,marginBottom:4}}>{b.subject}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>{b.year} · {b.questions.length} questions</div>
            {bankAtt ? (
              <div>
                <div style={{fontSize:13,marginBottom:4}}>Score: <span style={{fontWeight:700,color:bankAtt.pct>=70?"var(--success)":bankAtt.pct>=50?"var(--warn)":"var(--danger)"}}>{bankAtt.score}/{bankAtt.total} ({bankAtt.pct}%)</span></div>
                <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>🔒 Attempted {bankAtt.date}</div>
              </div>
            ) : (
              <button className="btn btn-accent btn-sm" onClick={()=>startExam(b)}>Start Exam ▶</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Essay Exam View ───────────────────────────────────────────────────
function EssayExamView({ toast, currentUser, essayBanks }) {
  const attKey = `nv-essay-att-${currentUser}`;
  const [essayAtt, setEssayAtt] = useHydratedUser(attKey, "essay-att", {});
  const [sel, setSel] = useState(null);
  const [active, setActive] = useState(false);
  const [answers, setAnswers] = useState({});
  const [done, setDone] = useState(false);
  const [grading, setGrading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [savedAnswers, setSavedAnswers] = useState({});

  const startExam = (bank) => {
    if (essayAtt[String(bank.id)]) { toast("You have already used your 1 attempt for this essay.", "error"); return; }
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
    const qaText = sel.questions.map((q,i)=>`Q${i+1} [${q.marks||10} marks]: ${q.q}\nKey points to look for: ${q.modelAnswer||"Use professional nursing knowledge"}\nStudent answer: ${(snap[i]||"(no answer)").trim()}`).join("\n\n");

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
      const newEssayAtt = { ...essayAtt, [String(sel.id)]: attData };
      setEssayAtt(newEssayAtt);

      // Save to backend for lecturer visibility
      saveEssaySubmissionToBackend(currentUser, sel.id, { ...submissionBase, feedback:parsed, gradedByAI:true, grade:parsed.grade, pct:parsed.overallPct });

      const results = ls("nv-results",[]);
      saveMyData("results","nv-results",[...results,{id:Date.now(),subject:sel.subject,type:"Essay (AI)",score:parsed.overallScore,total:totalMarks,pct:parsed.overallPct,date:new Date().toLocaleDateString()}]);
      notifyUserKey("nv-results");

      setFeedback(parsed);
    } catch(e) {
      // AI unavailable — save submission for MANUAL LECTURER GRADING
      const attData = { date:new Date().toLocaleDateString(), score:null, total:totalMarks, pct:null, grade:null, answers:snap, feedback:null, pendingManualGrade:true };
      const newEssayAtt = { ...essayAtt, [String(sel.id)]: attData };
      setEssayAtt(newEssayAtt);

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
      <div style={{maxWidth:"100%"}}>
        {/* ── Sticky header ── */}
        <div style={{position:"sticky",top:0,zIndex:50,background:"var(--bg2)",borderBottom:"1px solid var(--border)",padding:"10px 0 10px",marginBottom:18}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16}}>{sel.subject}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)",marginTop:2}}>
                {sel.questions.length} questions · {answeredCount}/{sel.questions.length} answered · {totalWords} words total
              </div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--purple)",background:"rgba(167,139,250,.1)",border:"1px solid rgba(167,139,250,.25)",borderRadius:7,padding:"4px 10px"}}>
                🤖 AI graded · 1 attempt
              </div>
              <button className="btn" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>{if(window.confirm("Exit? Your answers will NOT be saved."))setActive(false);}}>✕ Exit</button>
              <button className="btn btn-accent" style={{fontSize:12,padding:"6px 14px"}} onClick={submitEssay}>Submit ▶</button>
            </div>
          </div>
          {/* Progress bar */}
          <div style={{marginTop:8,background:"var(--bg4)",borderRadius:20,height:4,overflow:"hidden"}}>
            <div style={{height:"100%",background:"linear-gradient(90deg,var(--accent),var(--accent2))",borderRadius:20,transition:"width .4s",width:`${(answeredCount/sel.questions.length)*100}%`}} />
          </div>
        </div>

        {/* ── Questions ── */}
        {sel.questions.map((q,i)=>{
          const wc = ((answers[i]||"").trim().split(/\s+/).filter(Boolean)).length;
          const guide = q.wordGuide||"100–200";
          const guideMax = parseInt((guide+"").split(/[-–]/)[1])||200;
          const wcPct = Math.min(100, Math.round((wc/guideMax)*100));
          const wcColor = wc===0?"var(--text3)":wc<(guideMax*0.4)?"var(--danger)":wc<(guideMax*0.7)?"var(--warn)":"var(--success)";
          return (
            <div key={i} className="card" style={{marginBottom:18,padding:0,overflow:"hidden",border:"1px solid var(--border)"}}>
              {/* Question number banner */}
              <div style={{background:"linear-gradient(90deg,rgba(62,142,149,.18),transparent)",borderBottom:"1px solid var(--border)",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--accent)",fontWeight:700,letterSpacing:".06em"}}>
                  QUESTION {i+1} OF {sel.questions.length}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--text3)"}}>Guide: {guide} words</span>
                  <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:13,color:"var(--accent)",background:"rgba(62,142,149,.12)",borderRadius:6,padding:"2px 9px"}}>{q.marks||10} marks</span>
                </div>
              </div>

              {/* Two-column layout: Question | Answer */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",minHeight:260}}>
                {/* LEFT: Question */}
                <div style={{padding:"18px 20px",borderRight:"1px solid var(--border)",background:"var(--bg3)"}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:".1em",marginBottom:10}}>Question</div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,lineHeight:1.6,color:"var(--text)"}}>{q.q}</div>
                  {q.description&&<div style={{fontSize:12,color:"var(--text2)",marginTop:10,lineHeight:1.6,fontStyle:"italic"}}>{q.description}</div>}
                  <div style={{marginTop:"auto",paddingTop:16}}>
                    <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",lineHeight:1.7,background:"var(--bg4)",borderRadius:8,padding:"8px 12px",marginTop:12}}>
                      📌 Write a structured answer<br/>
                      📌 Use nursing terminology<br/>
                      📌 Cover all key points<br/>
                      📌 Aim for {guide} words
                    </div>
                  </div>
                </div>

                {/* RIGHT: Answer textarea */}
                <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",background:"var(--bg2)"}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:".1em",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span>Your Answer</span>
                    {(answers[i]||"").trim()&&<span style={{color:"var(--success)",fontSize:9}}>✓ Answered</span>}
                  </div>
                  <textarea
                    style={{flex:1,width:"100%",minHeight:200,background:"var(--bg4)",border:`1px solid ${(answers[i]||"").trim()?"var(--accent)":"var(--border)"}`,borderRadius:10,padding:"12px 14px",color:"var(--text)",fontSize:13,fontFamily:"'Instrument Sans',sans-serif",lineHeight:1.7,outline:"none",resize:"vertical",transition:"border-color .2s"}}
                    placeholder={`Write your answer here (aim for ${guide} words)…

Tip: Be specific, use nursing terms, and cover all aspects of the question.`}
                    value={answers[i]||""}
                    onChange={e=>setAnswers(a=>({...a,[i]:e.target.value}))}
                  />
                  {/* Word count bar */}
                  <div style={{marginTop:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:wcColor,fontWeight:700}}>{wc} words</span>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>target: {guide}</span>
                    </div>
                    <div style={{background:"var(--bg4)",borderRadius:20,height:3,overflow:"hidden"}}>
                      <div style={{height:"100%",background:wcColor,borderRadius:20,transition:"width .3s",width:`${wcPct}%`}} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* ── Submit footer ── */}
        <div style={{display:"flex",gap:10,justifyContent:"space-between",alignItems:"center",paddingBottom:32,flexWrap:"wrap"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--text3)"}}>
            {answeredCount}/{sel.questions.length} questions answered · {totalWords} words total
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn" onClick={()=>{if(window.confirm("Exit? Your answers will NOT be saved."))setActive(false);}}>✕ Exit Without Saving</button>
            <button className="btn btn-accent" style={{fontWeight:700}} onClick={submitEssay}>🤖 Submit for AI Grading →</button>
          </div>
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
            const bankAtt = essayAtt[String(b.id)];
            return (
              <div key={b.id} className="card" style={{animation:`fadeUp .4s ease ${i*.08}s both`}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,marginBottom:4}}>{b.subject}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>{b.questions.length} questions · {b.questions.reduce((s,q)=>s+(+q.marks||10),0)} total marks</div>
                {b.description&&<div style={{fontSize:11,color:"var(--text3)",marginBottom:8,fontStyle:"italic"}}>{b.description}</div>}
                {bankAtt ? (
                  <div>
                    {bankAtt.pendingManualGrade && !bankAtt.manualGrade && (
                      <div style={{background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.25)",borderRadius:8,padding:"8px 12px",fontSize:12,color:"var(--warn)",marginBottom:6}}>
                        ⏳ Submitted · Awaiting manual grading from your lecturer
                      </div>
                    )}
                    {bankAtt.manualGrade && (
                      <div style={{marginBottom:6}}>
                        <div style={{fontSize:14,fontWeight:700,marginBottom:2}}>Grade: <span style={{color:"var(--accent)"}}>{bankAtt.manualGrade.grade}</span> · {bankAtt.manualGrade.pct}%</div>
                        {bankAtt.manualGrade.overallComment && <div style={{fontSize:12,color:"var(--text2)"}}>{bankAtt.manualGrade.overallComment}</div>}
                        <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginTop:4}}>✏️ Manually graded on {bankAtt.gradedDate}</div>
                      </div>
                    )}
                    {bankAtt.grade && !bankAtt.manualGrade && <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>Grade: <span style={{color:"var(--accent)"}}>{bankAtt.grade}</span> · {bankAtt.pct}%</div>}
                    <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>🔒 Submitted {bankAtt.date} — contact lecturer to reset</div>
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


// ════════════════════════════════════════════════════════════════════
// LECTURER PORTAL
// ════════════════════════════════════════════════════════════════════
function LecturerPage({ toast, currentUser }) {
  const [tab, setTab] = useState("handouts");
  const TABS = [
    { key:"handouts",  label:"📄 Handouts" },
    { key:"setexam",   label:"🏆 Set Class Exam" },
    { key:"mcq",       label:"📝 MCQ Banks" },
    { key:"essay",     label:"✍️ Essay Exams" },
    { key:"announce",  label:"📢 Announcements" },
    { key:"students",  label:"👥 My Students" },
  ];

  return (
    <div>
      <div className="admin-header" style={{background:"linear-gradient(135deg,rgba(251,146,60,.12),rgba(234,179,8,.06))",border:"1px solid rgba(251,146,60,.25)",marginBottom:18}}>
        <div className="admin-header-icon" style={{background:"linear-gradient(135deg,#f97316,#eab308)"}}>👨‍🏫</div>
        <div>
          <div className="admin-header-title">Lecturer Portal</div>
          <div className="admin-header-sub">Logged in as <b style={{color:"var(--warn)"}}>{currentUser}</b> · Manage your content</div>
        </div>
      </div>
      <div className="admin-tabs" style={{marginBottom:20}}>
        {TABS.map(t=><div key={t.key} className={`admin-tab${tab===t.key?" active":""}`} style={tab===t.key?{background:"rgba(251,146,60,.18)",borderColor:"#f97316",color:"#f97316"}:{}} onClick={()=>setTab(t.key)}>{t.label}</div>)}
      </div>
      {tab==="handouts"  && <LecturerHandouts toast={toast} currentUser={currentUser} />}
      {tab==="setexam"   && <LecturerSetExam toast={toast} currentUser={currentUser} />}
      {tab==="mcq"       && <LecturerMCQ toast={toast} currentUser={currentUser} />}
      {tab==="essay"     && <LecturerEssay toast={toast} currentUser={currentUser} />}
      {tab==="announce"  && <LecturerAnnouncements toast={toast} currentUser={currentUser} />}
      {tab==="students"  && <LecturerStudents toast={toast} />}
    </div>
  );
}

function LecturerSetExam({ toast, currentUser }) {
  const classes = useShared("classes", DEFAULT_CLASSES);
  const [exams, setExams] = useHydratedShared("nv-class-exams", "classExams", []);
  const [view, setView] = useState("list"); // list | create | manage
  const [selExam, setSelExam] = useState(null);
  const [inputMode, setInputMode] = useState("paste"); // paste | single
  const [pasteText, setPasteText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [parsed, setParsed] = useState([]);
  const [parseError, setParseError] = useState("");
  const [singleQ, setSingleQ] = useState({ q: "", options: ["", "", "", ""], ans: 0 });
  const [examForm, setExamForm] = useState({
    title: "", classId: "", subject: "", date: "", duration: 60,
    instructions: "", totalMarks: "", passMark: "", isPublished: false,
  });
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const myExams = exams.filter(e => e.createdBy === currentUser);

  const saveExams = (updated) => {
    setExams(updated); // useHydratedShared handles saveShared("classExams", ...) automatically
  };

  // ── Parse answer key helper ──
  const parseAnswerKey = (text) => {
    if (!text.trim()) return null;
    const inline = [...text.matchAll(/(\d+)[.)]\s*([A-Da-d])/g)];
    if (inline.length) return inline.map(m => ({ num: +m[1], ans: "ABCD".indexOf(m[2].toUpperCase()) }));
    const lines = text.split("\n").map(l => l.trim()).filter(l => /^[A-Da-d]$/.test(l));
    if (lines.length) return lines.map((l, i) => ({ num: i + 1, ans: "ABCD".indexOf(l.toUpperCase()) }));
    return null;
  };

  // ── Parse & preview ──
  const doParse = () => {
    setParseError(""); setParsed([]);
    if (!pasteText.trim()) { setParseError("Paste questions in the left column first."); return; }
    const result = parseMCQText(pasteText);
    if (result.type === "answerkey") { setParseError("Left column looks like an answer key — paste full questions with options here."); return; }
    if (!result.questions.length) { setParseError("Could not parse questions. Check the format guide."); return; }
    let qs = result.questions;
    if (answerText.trim()) {
      const key = parseAnswerKey(answerText);
      if (key && key.length) { qs = applyAnswerKey(qs, key); }
      else setParseError("Questions parsed OK but answer key format unrecognised — answers from question text used instead.");
    }
    setParsed(qs);
  };

  // ── Add single question to draft ──
  const addSingleQ = () => {
    if (!singleQ.q.trim()) { toast("Question text required", "error"); return; }
    setParsed(prev => [...prev, { ...singleQ }]);
    setSingleQ({ q: "", options: ["", "", "", ""], ans: 0 });
    toast("Question added to draft!", "success");
  };

  const removeFromParsed = (idx) => setParsed(prev => prev.filter((_, i) => i !== idx));

  // ── Create / update exam ──
  const createExam = (publish) => {
    setFormError("");
    if (!examForm.title.trim()) { setFormError("Exam title is required."); return; }
    if (!examForm.classId) { setFormError("Please select a target class."); return; }
    if (parsed.length === 0) { setFormError("Add at least one question before saving."); return; }

    const exam = {
      id: Date.now(),
      ...examForm,
      duration: +examForm.duration || 60,
      totalMarks: +examForm.totalMarks || parsed.length,
      passMark: +examForm.passMark || Math.ceil(parsed.length * 0.5),
      isPublished: publish,
      questions: parsed,
      createdBy: currentUser,
      createdDate: new Date().toLocaleDateString(),
      questionCount: parsed.length,
    };
    const updated = [...exams, exam];
    saveExams(updated);
    toast(publish ? `Exam published to ${classes.find(c=>c.id===examForm.classId)?.label}!` : "Exam saved as draft!", "success");
    setView("list"); resetForm();
  };

  const updateExam = (examId, changes) => {
    const updated = exams.map(e => e.id === examId ? { ...e, ...changes } : e);
    saveExams(updated);
  };

  const deleteExam = (id) => {
    const updated = exams.filter(e => e.id !== id);
    saveExams(updated);
    if (selExam?.id === id) { setSelExam(null); setView("list"); }
    toast("Exam deleted", "success");
  };

  const publishToggle = (exam) => {
    updateExam(exam.id, { isPublished: !exam.isPublished });
    toast(exam.isPublished ? "Exam unpublished (hidden from students)" : "Exam published!", "success");
    setSelExam(prev => prev?.id === exam.id ? { ...prev, isPublished: !prev.isPublished } : prev);
  };

  const resetForm = () => {
    setExamForm({ title: "", classId: "", subject: "", date: "", duration: 60, instructions: "", totalMarks: "", passMark: "", isPublished: false });
    setPasteText(""); setAnswerText(""); setParsed([]); setParseError(""); setFormError("");
    setSingleQ({ q: "", options: ["", "", "", ""], ans: 0 });
  };

  const openManage = (exam) => { setSelExam(exam); setView("manage"); };

  // ══════════════════════════════════════════════
  //  LIST VIEW
  // ══════════════════════════════════════════════
  if (view === "list") return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">🏆 Set Class Exam</div>
          <div className="sec-sub">Create, manage and publish exams to specific classes</div>
        </div>
        <button className="btn btn-accent" style={{ fontWeight: 700, padding: "10px 20px" }} onClick={() => { resetForm(); setView("create"); }}>
          ＋ Create New Exam
        </button>
      </div>

      {myExams.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "60px 40px", color: "var(--text3)" }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>🏆</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 6, color: "var(--text2)" }}>No exams yet</div>
          <div style={{ fontSize: 13, fontFamily: "'DM Mono',monospace", marginBottom: 20 }}>Create your first class exam and publish it to students</div>
          <button className="btn btn-accent" onClick={() => { resetForm(); setView("create"); }}>＋ Create First Exam</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {myExams.map(exam => {
            const cls = classes.find(c => c.id === exam.classId);
            return (
              <div key={exam.id} className="card" style={{ border: `1px solid ${exam.isPublished ? "rgba(74,222,128,.35)" : "var(--border)"}`, background: exam.isPublished ? "rgba(74,222,128,.04)" : "var(--card)", animation: "fadeUp .3s ease" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1 }}>
                    {/* Class badge + status */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {cls && <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", fontWeight: 700, background: `${cls.color}22`, color: cls.color, border: `1px solid ${cls.color}55`, borderRadius: 5, padding: "2px 8px" }}>{cls.label}</span>}
                      <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: exam.isPublished ? "rgba(74,222,128,.15)" : "rgba(251,146,60,.12)", color: exam.isPublished ? "var(--success)" : "var(--warn)", border: `1px solid ${exam.isPublished ? "rgba(74,222,128,.3)" : "rgba(251,146,60,.3)"}` }}>
                        {exam.isPublished ? "● LIVE" : "○ DRAFT"}
                      </span>
                      {exam.subject && <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "'DM Mono',monospace" }}>{exam.subject}</span>}
                    </div>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{exam.title}</div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--text3)", fontFamily: "'DM Mono',monospace" }}>
                      <span>📝 {exam.questionCount} questions</span>
                      <span>⏱ {exam.duration} min</span>
                      {exam.date && <span>📅 {exam.date}</span>}
                      <span>🎯 Pass: {exam.passMark}/{exam.totalMarks}</span>
                      <span style={{ color: "var(--text3)" }}>Created {exam.createdDate}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                    <button className="btn btn-sm" onClick={() => openManage(exam)} style={{ fontWeight: 700 }}>Manage ▶</button>
                    <button className="btn btn-sm" style={{ background: exam.isPublished ? "rgba(239,68,68,.1)" : "rgba(74,222,128,.1)", color: exam.isPublished ? "var(--danger)" : "var(--success)", border: `1px solid ${exam.isPublished ? "rgba(239,68,68,.3)" : "rgba(74,222,128,.3)"}`, fontWeight: 700 }} onClick={() => publishToggle(exam)}>
                      {exam.isPublished ? "Unpublish" : "Publish"}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(exam.id)}>🗑️</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-head"><div className="modal-title">⚠️ Delete Exam?</div><button className="modal-close" onClick={() => setConfirmDelete(null)}>✕</button></div>
            <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20 }}>This will permanently delete the exam and all its questions. Students who have attempted it will retain their scores.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-danger" style={{ flex: 1, fontWeight: 700 }} onClick={() => { deleteExam(confirmDelete); setConfirmDelete(null); }}>Yes, Delete</button>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ══════════════════════════════════════════════
  //  MANAGE VIEW — exam detail + question list
  // ══════════════════════════════════════════════
  if (view === "manage" && selExam) {
    const liveExam = exams.find(e => e.id === selExam.id) || selExam;
    const cls = classes.find(c => c.id === liveExam.classId);
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => setView("list")}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18 }}>{liveExam.title}</div>
            <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "'DM Mono',monospace" }}>{cls?.label} · {liveExam.questionCount} questions · {liveExam.duration} min</div>
          </div>
          <button className="btn btn-sm" style={{ background: liveExam.isPublished ? "rgba(239,68,68,.1)" : "rgba(74,222,128,.1)", color: liveExam.isPublished ? "var(--danger)" : "var(--success)", border: `1px solid ${liveExam.isPublished ? "rgba(239,68,68,.3)" : "rgba(74,222,128,.3)"}`, fontWeight: 700 }} onClick={() => publishToggle(liveExam)}>
            {liveExam.isPublished ? "● Unpublish" : "○ Publish"}
          </button>
        </div>

        {/* Meta strip */}
        <div className="card" style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12 }}>
          {[
            ["🏫 Class", cls?.label || liveExam.classId],
            ["📝 Questions", liveExam.questionCount],
            ["⏱ Duration", `${liveExam.duration} min`],
            ["🎯 Pass Mark", `${liveExam.passMark} / ${liveExam.totalMarks}`],
            ["📅 Date", liveExam.date || "—"],
            ["Status", liveExam.isPublished ? "Published ●" : "Draft ○"],
          ].map(([k, v]) => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>{k}</div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{v}</div>
            </div>
          ))}
        </div>

        {liveExam.instructions && (
          <div style={{ background: "rgba(62,142,149,.08)", border: "1px solid rgba(62,142,149,.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "var(--accent)", fontWeight: 700, display: "block", marginBottom: 4 }}>INSTRUCTIONS</span>
            {liveExam.instructions}
          </div>
        )}

        {/* Question list */}
        <div style={{ background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg4)", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14 }}>
            Questions ({liveExam.questions?.length || 0})
          </div>
          {(!liveExam.questions || liveExam.questions.length === 0) ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text3)", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>No questions in this exam.</div>
          ) : (
            <div style={{ padding: 12, display: "grid", gap: 8, maxHeight: 520, overflowY: "auto" }}>
              {liveExam.questions.map((q, qi) => (
                <div key={qi} style={{ background: "var(--bg2)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{qi + 1}. {q.q}</div>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700, color: "var(--success)", background: "rgba(74,222,128,.12)", border: "1px solid rgba(74,222,128,.25)", borderRadius: 5, padding: "1px 8px", flexShrink: 0 }}>ANS: {"ABCD"[q.ans]}</span>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {q.options.map((o, oi) => (
                      <span key={oi} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 5, background: oi === q.ans ? "rgba(74,222,128,.15)" : "rgba(255,255,255,.04)", border: `1px solid ${oi === q.ans ? "var(--success)" : "var(--border)"}`, color: oi === q.ans ? "var(--success)" : "var(--text3)" }}>
                        {"ABCD"[oi]}. {o}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════
  //  CREATE VIEW
  // ══════════════════════════════════════════════
  return (
    <div>
      {/* Back + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button className="btn btn-sm" onClick={() => { setView("list"); resetForm(); }}>← Back</button>
        <div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18 }}>🏆 Create Class Exam</div>
          <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "'DM Mono',monospace" }}>Set up exam details, add questions, then publish to your class</div>
        </div>
      </div>

      {/* ─── Step 1: Exam Details ─── */}
      <div style={{ background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 16 }}>
        <div style={{ background: "linear-gradient(90deg,rgba(62,142,149,.14),transparent)", borderBottom: "1px solid var(--border)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</span>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15, color: "var(--accent)" }}>Exam Details</div>
        </div>
        <div style={{ padding: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label className="lbl">Exam Title *</label>
            <input className="inp" placeholder="e.g. Mid-Semester MCQ — Pharmacology" value={examForm.title} onChange={e => setExamForm({ ...examForm, title: e.target.value })} />
          </div>
          <div>
            <label className="lbl">Target Class *</label>
            <select className="inp" value={examForm.classId} onChange={e => setExamForm({ ...examForm, classId: e.target.value })}>
              <option value="">Select class...</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.label} — {c.desc}</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">Subject / Course</label>
            <input className="inp" placeholder="e.g. Pharmacology" value={examForm.subject} onChange={e => setExamForm({ ...examForm, subject: e.target.value })} />
          </div>
          <div>
            <label className="lbl">Exam Date</label>
            <input className="inp" type="date" value={examForm.date} onChange={e => setExamForm({ ...examForm, date: e.target.value })} />
          </div>
          <div>
            <label className="lbl">Duration (minutes)</label>
            <input className="inp" type="number" min="10" max="300" value={examForm.duration} onChange={e => setExamForm({ ...examForm, duration: e.target.value })} />
          </div>
          <div>
            <label className="lbl">Total Marks (leave blank = auto)</label>
            <input className="inp" type="number" placeholder="Auto-set from question count" value={examForm.totalMarks} onChange={e => setExamForm({ ...examForm, totalMarks: e.target.value })} />
          </div>
          <div>
            <label className="lbl">Pass Mark (leave blank = 50%)</label>
            <input className="inp" type="number" placeholder="Auto = 50% of total" value={examForm.passMark} onChange={e => setExamForm({ ...examForm, passMark: e.target.value })} />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label className="lbl">Instructions (optional)</label>
            <textarea className="inp" rows={2} style={{ resize: "vertical" }} placeholder="e.g. Answer all questions. Time allowed: 60 minutes. No calculators permitted." value={examForm.instructions} onChange={e => setExamForm({ ...examForm, instructions: e.target.value })} />
          </div>
        </div>
      </div>

      {/* ─── Step 2: Add Questions ─── */}
      <div style={{ background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 16 }}>
        <div style={{ background: "linear-gradient(90deg,rgba(251,146,60,.14),transparent)", borderBottom: "1px solid var(--border)", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--warn)", color: "#000", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>2</span>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15, color: "var(--warn)" }}>Add Questions</div>
          </div>
          {parsed.length > 0 && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "var(--success)", background: "rgba(74,222,128,.1)", border: "1px solid rgba(74,222,128,.3)", borderRadius: 6, padding: "3px 10px" }}>✓ {parsed.length} questions in draft</span>}
        </div>

        {/* Mode selector */}
        <div style={{ padding: "14px 18px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { k: "paste", icon: "📋", label: "Paste Questions & Answers", sub: "Bulk import with auto-parse" },
            { k: "single", icon: "➕", label: "Add Single Question", sub: "Type one question manually" },
          ].map(({ k, icon, label, sub }) => (
            <button key={k} onClick={() => { setInputMode(k); setParseError(""); }}
              style={{ flex: 1, minWidth: 180, padding: "11px 16px", borderRadius: 10, border: `2px solid ${inputMode === k ? "var(--warn)" : "var(--border)"}`, background: inputMode === k ? "rgba(251,146,60,.12)" : "transparent", cursor: "pointer", textAlign: "left", transition: "all .2s" }}>
              <div style={{ fontSize: 16, marginBottom: 2 }}>{icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: inputMode === k ? "var(--warn)" : "var(--text2)" }}>{label}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "'DM Mono',monospace" }}>{sub}</div>
            </button>
          ))}
        </div>

        {/* ── PASTE MODE ── */}
        {inputMode === "paste" && (
          <div style={{ padding: 18 }}>
            <div style={{ background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
              {/* Header */}
              <div style={{ background: "linear-gradient(90deg,rgba(251,146,60,.1),rgba(74,222,128,.04))", borderBottom: "1px solid var(--border)", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontSize: 12, color: "var(--text2)", fontFamily: "'DM Mono',monospace" }}>Paste questions left · paste answer key right (optional) · then Parse</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-accent" style={{ fontWeight: 700 }} onClick={doParse}>🔍 Parse Questions</button>
                  {parsed.length > 0 && <button className="btn" style={{ fontSize: 12 }} onClick={() => { setParsed([]); setPasteText(""); setAnswerText(""); setParseError(""); }}>🗑 Clear Draft</button>}
                </div>
              </div>

              {/* Two columns */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                {/* LEFT — Questions */}
                <div style={{ borderRight: "1px solid var(--border)" }}>
                  <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg3)" }}>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700, color: "var(--warn)", textTransform: "uppercase", letterSpacing: ".08em" }}>Questions Column</span>
                  </div>
                  <div style={{ padding: "8px 12px", background: "rgba(251,146,60,.03)", borderBottom: "1px solid var(--border)", fontFamily: "'DM Mono',monospace", fontSize: 10, color: "var(--text3)", lineHeight: 2 }}>
                    <b style={{ color: "var(--warn)" }}>Accepted formats:</b><br />
                    <span style={{ color: "var(--accent)" }}>Q: Which organ produces insulin?</span><br />
                    A: Liver{"  "}B: Kidney{"  "}C: Pancreas{"  "}D: Spleen<br />
                    ANS: C{"  "}← optional (or use right column)<br /><br />
                    <span style={{ color: "var(--accent)" }}>1. Normal adult SpO₂?</span><br />
                    A) 85-90%{"  "}B) 95-100%{"  "}C) 80-85%{"  "}D: 90%<br /><br />
                    <b>Separate questions with a blank line</b>
                  </div>
                  <textarea
                    style={{ width: "100%", minHeight: 280, background: "var(--bg)", border: "none", padding: "12px 14px", color: "var(--text)", fontSize: 12, fontFamily: "'DM Mono',monospace", lineHeight: 1.8, outline: "none", resize: "vertical", boxSizing: "border-box" }}
                    placeholder={"Q: What is normal adult temperature?\nA: 35.0°C\nB: 36.1-37.2°C\nC: 38.5°C\nD: 40.0°C\nANS: B\n\nQ: Which organ produces insulin?\nA: Liver\nB: Kidney\nC: Pancreas\nD: Spleen"}
                    value={pasteText}
                    onChange={e => { setPasteText(e.target.value); setParsed([]); setParseError(""); }}
                  />
                </div>

                {/* RIGHT — Answer Key */}
                <div>
                  <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg3)" }}>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700, color: "var(--success)", textTransform: "uppercase", letterSpacing: ".08em" }}>Answer Key Column</span>
                    <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "'DM Mono',monospace", marginLeft: 8 }}>· optional if answers embedded</span>
                  </div>
                  <div style={{ padding: "8px 12px", background: "rgba(74,222,128,.03)", borderBottom: "1px solid var(--border)", fontFamily: "'DM Mono',monospace", fontSize: 10, color: "var(--text3)", lineHeight: 2 }}>
                    <b style={{ color: "var(--success)" }}>Accepted formats:</b><br />
                    <span style={{ color: "var(--accent)" }}>1.B 2.C 3.A 4.D</span>{"  "}← inline<br />
                    <span style={{ color: "var(--accent)" }}>1) B</span><br />
                    <span style={{ color: "var(--accent)" }}>2) C</span>{"  "}← numbered lines<br />
                    <span style={{ color: "var(--accent)" }}>B</span><br />
                    <span style={{ color: "var(--accent)" }}>C</span>{"  "}← one letter/line (maps to Q1, Q2...)<br /><br />
                    <b>Leave blank if answers are in questions</b>
                  </div>
                  <textarea
                    style={{ width: "100%", minHeight: 280, background: "var(--bg)", border: "none", padding: "12px 14px", color: "var(--text)", fontSize: 12, fontFamily: "'DM Mono',monospace", lineHeight: 1.8, outline: "none", resize: "vertical", boxSizing: "border-box" }}
                    placeholder={"1.B 2.C 3.A\n\n— or —\n\n1) B\n2) C\n3) A\n\n— or —\n\nB\nC\nA"}
                    value={answerText}
                    onChange={e => { setAnswerText(e.target.value); setParseError(""); }}
                  />
                </div>
              </div>

              {parseError && (
                <div style={{ padding: "10px 16px", background: "rgba(239,68,68,.08)", borderTop: "1px solid rgba(239,68,68,.2)", color: "var(--danger)", fontSize: 12, fontFamily: "'DM Mono',monospace" }}>⚠️ {parseError}</div>
              )}
            </div>
          </div>
        )}

        {/* ── SINGLE MODE ── */}
        {inputMode === "single" && (
          <div style={{ padding: 18 }}>
            <div style={{ background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border)", padding: 18 }}>
              <label className="lbl">Question *</label>
              <textarea className="inp" rows={2} style={{ resize: "vertical" }} placeholder="Type your question..." value={singleQ.q} onChange={e => setSingleQ({ ...singleQ, q: e.target.value })} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                {["A", "B", "C", "D"].map((l, i) => (
                  <div key={l} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => setSingleQ({ ...singleQ, ans: i })}
                      style={{ width: 34, height: 34, borderRadius: 8, border: `2px solid ${singleQ.ans === i ? "var(--success)" : "var(--border)"}`, background: singleQ.ans === i ? "rgba(74,222,128,.15)" : "transparent", cursor: "pointer", fontSize: 13, fontWeight: 800, color: singleQ.ans === i ? "var(--success)" : "var(--text3)", fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>{l}</button>
                    <input className="inp" style={{ marginBottom: 0, flex: 1 }} placeholder={`Option ${l}`} value={singleQ.options[i]} onChange={e => { const o = [...singleQ.options]; o[i] = e.target.value; setSingleQ({ ...singleQ, options: o }); }} />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "'DM Mono',monospace", marginBottom: 14 }}>
                Click a letter button to mark as correct answer · Currently: <b style={{ color: "var(--success)" }}>Option {"ABCD"[singleQ.ans]}</b>
              </div>
              <button className="btn btn-accent" style={{ fontWeight: 700 }} onClick={addSingleQ}>➕ Add to Exam</button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Question Draft Preview ─── */}
      {parsed.length > 0 && (
        <div style={{ background: "var(--bg3)", borderRadius: 14, border: "1px solid rgba(74,222,128,.3)", overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "rgba(74,222,128,.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15, color: "var(--success)" }}>✓ Draft Questions ({parsed.length})</span>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "var(--text3)", marginLeft: 10 }}>Review before saving the exam</span>
            </div>
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto", padding: "10px 12px", display: "grid", gap: 7 }}>
            {parsed.map((p, i) => (
              <div key={i} style={{ background: "var(--bg2)", borderRadius: 9, padding: "10px 12px", border: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{i + 1}. {p.q}</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {p.options.map((o, oi) => (
                      <span key={oi} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: oi === p.ans ? "rgba(74,222,128,.15)" : "rgba(255,255,255,.04)", border: `1px solid ${oi === p.ans ? "var(--success)" : "var(--border)"}`, color: oi === p.ans ? "var(--success)" : "var(--text3)" }}>
                        {"ABCD"[oi]}. {o}
                      </span>
                    ))}
                  </div>
                </div>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700, color: "var(--success)", background: "rgba(74,222,128,.12)", border: "1px solid rgba(74,222,128,.25)", borderRadius: 5, padding: "1px 8px", flexShrink: 0 }}>ANS: {"ABCD"[p.ans]}</span>
                <button className="btn btn-sm btn-danger" style={{ padding: "3px 8px", fontSize: 11, flexShrink: 0 }} onClick={() => removeFromParsed(i)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Step 3: Save ─── */}
      <div style={{ background: "var(--bg3)", borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(90deg,rgba(168,139,250,.12),transparent)", borderBottom: "1px solid var(--border)", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "#a78bfa", color: "#fff", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>3</span>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15, color: "#a78bfa" }}>Save & Publish</div>
        </div>
        <div style={{ padding: 18 }}>
          {formError && (
            <div style={{ background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 8, padding: "10px 14px", color: "var(--danger)", fontSize: 13, fontFamily: "'DM Mono',monospace", marginBottom: 14 }}>⚠️ {formError}</div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" style={{ flex: 1, minWidth: 140, background: "rgba(251,146,60,.1)", color: "var(--warn)", border: "1px solid rgba(251,146,60,.3)", fontWeight: 700, padding: "12px" }} onClick={() => createExam(false)}>
              💾 Save as Draft
            </button>
            <button className="btn btn-accent" style={{ flex: 2, minWidth: 200, fontWeight: 800, fontSize: 14, padding: "12px" }} onClick={() => createExam(true)}>
              🚀 Publish Exam to Class
            </button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "'DM Mono',monospace", marginTop: 10 }}>
            Draft = only you can see it · Published = visible to all students in the selected class
          </div>
        </div>
      </div>
    </div>
  );
}

function LecturerHandouts({ toast, currentUser }) {
  const [handouts, setHandouts] = useHydratedShared("nv-handouts", "handouts", []);
  const classes = useShared("classes", DEFAULT_CLASSES);
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({title:"",description:"",classId:"",course:""});
  const [fileData, setFileData] = useState(null);
  const [fileName, setFileName] = useState("");
  const [fileMime, setFileMime] = useState("");

  const myHandouts = handouts.filter(h=>h.uploadedBy===currentUser);

  const openAdd = () => {
    setEdit(null); setForm({title:"",description:"",classId:"",course:""});
    setFileData(null); setFileName(""); setFileMime(""); setShowModal(true);
  };
  const openEdit = (h) => {
    setEdit(h.id); setForm({title:h.title,description:h.description||"",classId:h.classId||"",course:h.course||""});
    setFileData(h.fileData||null); setFileName(h.fileName||""); setFileMime(h.fileMime||""); setShowModal(true);
  };

  const handleFile = (data, name, mime, err) => {
    if (err) return toast(err, "error");
    setFileData(data); setFileName(name); setFileMime(mime);
  };

  const pushNotification = (h) => {
    const notifs = ls("nv-notifications", []);
    saveMyData("notifications","nv-notifications",[{
      id:Date.now(), type:"handout",
      title:`New handout: ${h.title}`,
      body:`${currentUser.split("@")[0]} uploaded ${h.fileName ? `a ${fileLabel(h.fileMime)} file` : "notes"}${h.course?` for ${h.course}`:""}`,
      from:currentUser, date:new Date().toLocaleDateString(),
      time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
      read:false, handoutId:h.id
    }, ...notifs]);
  };

  const save = () => {
    if (!form.title.trim() || !form.classId) return toast("Title and class required","error");
    const base = { ...form, uploadedBy:currentUser, date:new Date().toLocaleDateString(),
      fileData:fileData||null, fileName:fileName||"", fileMime:fileMime||"" };
    let u;
    if (edit!==null) {
      u = handouts.map(h=>h.id===edit?{...h,...base}:h); toast("Handout updated!","success");
    } else {
      const h = {...base, id:Date.now()};
      u = [...handouts, h]; pushNotification(h);
      toast("Handout published! Students notified. ✅","success");
    }
    setHandouts(u); setShowModal(false);
    setEdit(null); setForm({title:"",description:"",classId:"",course:""});
    setFileData(null); setFileName(""); setFileMime("");
  };

  const del = (id) => {
    if (!window.confirm("Delete this handout?")) return;
    setHandouts(handouts.filter(h=>h.id!==id)); toast("Deleted","info");
  };

  const selCls = classes.find(c=>c.id===form.classId);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div className="sec-title">📄 My Handouts ({myHandouts.length})</div>
        <button className="btn btn-accent" onClick={openAdd}>+ Upload Handout</button>
      </div>

      {myHandouts.length===0 ? (
        <div className="card" style={{textAlign:"center",padding:40,color:"var(--text3)"}}>
          <div style={{fontSize:40,marginBottom:10}}>📁</div>
          <div style={{marginBottom:12}}>No handouts yet. Upload your first one!</div>
          <button className="btn btn-accent" onClick={openAdd}>+ Upload Now</button>
        </div>
      ) : (
        <div className="grid2">
          {myHandouts.map(h=>{
            const cls = classes.find(c=>c.id===h.classId);
            return (
              <div key={h.id} className="card" style={{cursor:"pointer",borderLeft:`3px solid ${cls?.color||"var(--accent)"}`}}
                onClick={()=>setViewItem(h)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {cls&&<span className="tag tag-accent">{cls.label}</span>}
                    {h.course&&<span className="tag" style={{fontSize:10}}>{h.course}</span>}
                    {h.fileData&&<span className="tag" style={{borderColor:"var(--accent2)",color:"var(--accent2)"}}>{fileIcon(h.fileMime)} {fileLabel(h.fileMime)}</span>}
                  </div>
                  <div style={{display:"flex",gap:4,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                    <button className="btn btn-sm" onClick={()=>openEdit(h)}>✏️</button>
                    <button className="btn btn-sm btn-danger" onClick={()=>del(h.id)}>🗑️</button>
                  </div>
                </div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,marginBottom:4}}>{h.title}</div>
                {h.description&&<div style={{fontSize:12,color:"var(--text2)",marginBottom:4,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{h.description}</div>}
                {!h.fileData&&!h.description&&<div style={{fontSize:12,color:"var(--text3)"}}>Text notes</div>}
                <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginTop:8}}>{h.date}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload / Edit Modal */}
      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" style={{maxWidth:520}} onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">{edit?"Edit Handout":"Upload Handout"}</div>
              <button className="modal-close" onClick={()=>setShowModal(false)}>✕</button>
            </div>
            <label className="lbl">Title *</label>
            <input className="inp" placeholder="e.g. Lecture 3 – Pharmacokinetics" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} />
            <label className="lbl">Description (optional)</label>
            <textarea className="inp" rows={2} style={{resize:"vertical"}} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} />
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label className="lbl">Class *</label>
                <select className="inp" value={form.classId} onChange={e=>setForm({...form,classId:e.target.value,course:""})}>
                  <option value="">Select class…</option>
                  {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl">Course</label>
                <select className="inp" value={form.course} onChange={e=>setForm({...form,course:e.target.value})} disabled={!selCls}>
                  <option value="">General</option>
                  {(selCls?.courses||[]).map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <label className="lbl" style={{marginTop:4}}>Attach File</label>
            <UploadDropzone fileData={fileData} fileName={fileName} fileMime={fileMime} onChange={handleFile} uploading={uploading} />
            {fileData&&(
              <button className="btn btn-sm btn-danger" style={{marginTop:6}} onClick={()=>{setFileData(null);setFileName("");setFileMime("");}}>
                ✕ Remove file
              </button>
            )}
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={save}>
                {edit?"💾 Save Changes":"📤 Publish & Notify Students"}
              </button>
              <button className="btn" onClick={()=>setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewItem&&(
        <div className="modal-overlay" onClick={()=>setViewItem(null)}>
          <div className="modal" style={{maxWidth:800,width:"95vw"}} onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">{viewItem.title}</div>
              <button className="modal-close" onClick={()=>setViewItem(null)}>✕</button>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
              {classes.find(c=>c.id===viewItem.classId)&&<span className="tag tag-accent">{classes.find(c=>c.id===viewItem.classId).label}</span>}
              {viewItem.course&&<span className="tag">{viewItem.course}</span>}
              <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginLeft:"auto"}}>
                {viewItem.date}
              </div>
            </div>
            {viewItem.description&&<div style={{fontSize:13,color:"var(--text2)",marginBottom:14,lineHeight:1.6}}>{viewItem.description}</div>}
            <FileViewer handout={viewItem} />
          </div>
        </div>
      )}
    </div>
  );
}

function LecturerEssay({ toast, currentUser }) {
  const [banks, setBanks] = useHydratedShared("nv-essay-banks", "essayBanks", []);
  const [selBank, setSelBank] = useState(null);
  const [showBankModal, setShowBankModal] = useState(false);
  const [showQModal, setShowQModal] = useState(false);
  const [editBank, setEditBank] = useState(null);
  const [editQ, setEditQ] = useState(null);
  const [qInputMode, setQInputMode] = useState("single");
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState([]);
  const [parseError, setParseError] = useState("");
  const [bankForm, setBankForm] = useState({subject:"",description:"",classId:""});
  const [qForm, setQForm] = useState({q:"",marks:10,wordGuide:"100-200",modelAnswer:""});
  const [subTab, setSubTab] = useState("banks");
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [gradingStudent, setGradingStudent] = useState(null);
  const [gradeForm, setGradeForm] = useState({});
  const [overallComment, setOverallComment] = useState("");
  const [savingGrade, setSavingGrade] = useState(false);
  const classes = ls("nv-classes", DEFAULT_CLASSES);

  const myBanks = banks.filter(b=>b.createdBy===currentUser||!b.createdBy);

  const saveBank = () => {
    if (!bankForm.subject.trim()) return toast("Subject required","error");
    let u;
    if (editBank!==null) { u=banks.map((b,i)=>i===editBank?{...b,...bankForm}:b); toast("Updated","success"); }
    else { u=[...banks,{...bankForm,id:Date.now(),questions:[],createdBy:currentUser}]; toast("Essay bank created","success"); }
    setBanks(u); saveShared("essayBanks",u); setShowBankModal(false); setEditBank(null); setBankForm({subject:"",description:"",classId:""});
  };

  const delBank = (id) => {
    if(!window.confirm("Delete this essay bank?")) return;
    const u=banks.filter(b=>b.id!==id); setBanks(u); saveShared("essayBanks",u);
    if(selBank===id) setSelBank(null); toast("Deleted","success");
  };

  const saveQ = () => {
    if (!qForm.q.trim()) return toast("Question required","error");
    const updated = banks.map(b=>{
      if (b.id!==selBank) return b;
      let qs;
      if (editQ!==null) { qs=b.questions.map((q,i)=>i===editQ?{...qForm,marks:+qForm.marks}:q); toast("Updated","success"); }
      else { qs=[...b.questions,{...qForm,marks:+qForm.marks}]; toast("Question added","success"); }
      return {...b,questions:qs};
    });
    setBanks(updated); saveShared("essayBanks",updated);
    setShowQModal(false); setEditQ(null); setQForm({q:"",marks:10,wordGuide:"100-200",modelAnswer:""});
  };

  const delQ = (bankId, qIdx) => {
    const u=banks.map(b=>b.id===bankId?{...b,questions:b.questions.filter((_,i)=>i!==qIdx)}:b);
    setBanks(u); saveShared("essayBanks",u); toast("Deleted","success");
  };

  const doParsEssay = () => {
    setParseError(""); setParsed([]);
    const items = parseEssayText(pasteText);
    if (!items.length) { setParseError("Could not parse essay questions. Check the format guide."); return; }
    setParsed(items);
  };

  const doImportEssay = () => {
    if (!selBank) return toast("Select a bank first","error");
    const updated = banks.map(b=>b.id===selBank?{...b,questions:[...b.questions,...parsed]}:b);
    setBanks(updated); saveShared("essayBanks",updated);
    toast(`${parsed.length} essay questions imported!`,"success");
    setPasteText(""); setParsed([]); setQInputMode("single");
  };

  const loadSubmissions = async () => {
    setLoadingSubs(true);
    try {
      const idx = await bsGet("essay-submissions-index") || [];
      const allSubs = await Promise.all(idx.map(async e => {
        const d = await bsGet(e.key);
        return d ? { ...d, student: e.student, bankId: e.bankId, graded: e.graded } : null;
      }));
      setSubmissions(allSubs.filter(Boolean));
    } catch { toast("Could not load submissions","error"); }
    setLoadingSubs(false);
  };

  useEffect(()=>{ if(subTab==="grade") loadSubmissions(); },[subTab]);

  const startGrade = (sub) => {
    const initForm = {};
    (sub.questions||[]).forEach((_,i)=>{ initForm[i]={marksAwarded:0,feedback:""}; });
    setGradeForm(initForm); setOverallComment(""); setGradingStudent(sub);
  };

  const submitGrade = async () => {
    if(!gradingStudent) return;
    setSavingGrade(true);
    const questions = gradingStudent.questions||[];
    const totalScore = Object.values(gradeForm).reduce((s,v)=>s+(+v.marksAwarded||0),0);
    const totalMarks = questions.reduce((s,q)=>s+(+q.marks||10),0);
    const pct = totalMarks>0?Math.round((totalScore/totalMarks)*100):0;
    const grade = pct>=70?"A":pct>=60?"B":pct>=50?"C":pct>=40?"D":"F";
    const gradeData = {
      overallScore:totalScore, totalMarks, overallPct:pct, grade,
      overallComment, gradedBy:currentUser,
      questions: questions.map((_,i)=>({
        marksAwarded:+gradeForm[i]?.marksAwarded||0,
        maxMarks:+questions[i]?.marks||10,
        feedback:gradeForm[i]?.feedback||""
      }))
    };
    await saveManualGradeToBackend(gradingStudent.student, gradingStudent.bankId, gradeData);
    toast(`Grade saved for ${gradingStudent.student}!`,"success");
    setSavingGrade(false); setGradingStudent(null); loadSubmissions();
  };

  const selBankObj = banks.find(b=>b.id===selBank);

  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["banks","📚 Essay Banks"],["grade","🗂️ Grade Submissions"]].map(([k,l])=>(
          <div key={k} className={`admin-tab${subTab===k?" active":""}`} onClick={()=>setSubTab(k)}>{l}</div>
        ))}
      </div>

      {subTab==="banks" && (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div className="sec-title">✍️ Essay Exam Banks ({myBanks.length})</div>
            <button className="btn btn-accent" onClick={()=>{setShowBankModal(true);setEditBank(null);setBankForm({subject:"",description:"",classId:""});}}>+ New Bank</button>
          </div>
          <div className="grid2">
            {myBanks.map((b,i)=>{
              const cls = classes.find(c=>c.id===b.classId);
              return (
                <div key={b.id} className={`card${selBank===b.id?" ":" "}`} style={{cursor:"pointer",border:`1px solid ${selBank===b.id?"var(--accent)":"var(--border)"}`,background:selBank===b.id?"rgba(62,142,149,.08)":"var(--card)",animation:`fadeUp .3s ease ${i*.06}s both`}} onClick={()=>setSelBank(selBank===b.id?null:b.id)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      {cls&&<span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:cls.color,background:`${cls.color}20`,padding:"1px 7px",borderRadius:4,marginBottom:6,display:"inline-block"}}>{cls.label}</span>}
                      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{b.subject}</div>
                      {b.description&&<div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{b.description}</div>}
                      <div style={{fontSize:11,color:"var(--text3)",marginTop:6,fontFamily:"'DM Mono',monospace"}}>{b.questions?.length||0} questions</div>
                    </div>
                    <div style={{display:"flex",gap:5}}>
                      <button className="btn btn-sm" onClick={e=>{e.stopPropagation();setEditBank(banks.indexOf(b));setBankForm({subject:b.subject,description:b.description||"",classId:b.classId||""});setShowBankModal(true);}}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();delBank(b.id);}}>🗑️</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {selBankObj&&(
            <div className="card" style={{marginTop:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>Questions — {selBankObj.subject}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {[{k:"single",icon:"➕",label:"Add One"},{k:"paste",icon:"📋",label:"Paste & Parse"}].map(({k,icon,label})=>(
                  <button key={k} className={`btn btn-sm${qInputMode===k?" btn-accent":""}`} style={qInputMode===k?{borderColor:"var(--warn)",color:"var(--warn)",background:"rgba(251,146,60,.15)"}:{}} onClick={()=>{setQInputMode(qInputMode===k?"none":k);setParsed([]);setParseError("");}}>{icon} {label}</button>
                ))}
              </div>
              </div>
              {qInputMode==="single"&&(
                <div style={{background:"var(--bg4)",borderRadius:10,padding:14,marginBottom:14}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,marginBottom:10}}>➕ Add Single Question</div>
                  <label className="lbl">Question</label>
                  <textarea className="inp" rows={2} style={{resize:"vertical"}} placeholder="Enter essay question..." value={qForm.q} onChange={e=>setQForm({...qForm,q:e.target.value})} />
                  <div className="form-row">
                    <div><label className="lbl">Marks</label><input className="inp" type="number" min={1} value={qForm.marks} onChange={e=>setQForm({...qForm,marks:e.target.value})} /></div>
                    <div><label className="lbl">Word Guide</label><input className="inp" placeholder="e.g. 150-250" value={qForm.wordGuide} onChange={e=>setQForm({...qForm,wordGuide:e.target.value})} /></div>
                  </div>
                  <label className="lbl">Model Answer (for AI grading)</label>
                  <textarea className="inp" rows={2} style={{resize:"vertical"}} placeholder="Key points students should cover..." value={qForm.modelAnswer} onChange={e=>setQForm({...qForm,modelAnswer:e.target.value})} />
                  <button className="btn btn-accent" onClick={saveQ}>➕ Add Question</button>
                </div>
              )}

              {qInputMode==="paste"&&(
                <div style={{background:"var(--bg4)",borderRadius:10,padding:14,marginBottom:14}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,marginBottom:8}}>📋 Paste & Auto-Parse Essay Questions</div>
                  <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:10,lineHeight:1.9,background:"rgba(251,146,60,.07)",borderRadius:7,padding:"8px 12px"}}>
                    <b style={{color:"var(--warn)"}}>Supported formats (separate questions with blank line):</b><br/>
                    Q: Question text↵Marks: 20↵Model: key points to cover<br/>
                    1. Question text↵Marks: 15↵Word Guide: 150-200<br/>
                    (Just the question text also works — marks default to 10)
                  </div>
                  <textarea className="paste-box" rows={10} placeholder={"Q: Explain the nursing management of a patient with Type 2 Diabetes.\nMarks: 20\nWord Guide: 200-300\nModel: Include monitoring blood glucose, diet education, medication adherence\n\n1. Describe the pathophysiology of hypertension.\nMarks: 15"} value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsed([]);setParseError("");}} />
                  {parseError&&<div style={{color:"var(--danger)",fontSize:12,marginBottom:8}}>⚠️ {parseError}</div>}
                  <div style={{display:"flex",gap:8,marginBottom:parsed.length?12:0}}>
                    <button className="btn btn-accent" onClick={doParsEssay}>🔍 Parse</button>
                    {parsed.length>0&&<button className="btn btn-success" onClick={doImportEssay}>✅ Import {parsed.length} Questions</button>}
                    <button className="btn" onClick={()=>{setQInputMode("single");setParsed([]);setPasteText("");setParseError("");}}>Cancel</button>
                  </div>
                  {parsed.length>0&&(
                    <div className="parse-preview">
                      {parsed.map((p,i)=>(
                        <div key={i} className="parse-item">
                          <span className="parse-check">✓</span>
                          <span style={{flex:1,fontSize:12}}>{p.q.slice(0,70)}{p.q.length>70?"...":""}</span>
                          <span style={{color:"var(--warn)",fontFamily:"'DM Mono',monospace",fontSize:11,flexShrink:0}}>{p.marks} marks</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(!selBankObj.questions||selBankObj.questions.length===0) ? (
                <div style={{textAlign:"center",color:"var(--text3)",padding:20,fontFamily:"'DM Mono',monospace",fontSize:12}}>No questions yet. Add your first question.</div>
              ) : selBankObj.questions.map((q,i)=>(
                <div key={i} style={{background:"var(--bg4)",borderRadius:10,padding:"12px 14px",marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--accent)",marginBottom:4}}>Q{i+1} · {q.marks||10} marks · {q.wordGuide||"100-200"} words</div>
                      <div style={{fontSize:14,fontWeight:600,marginBottom:q.modelAnswer?6:0}}>{q.q}</div>
                      {q.modelAnswer&&<div style={{fontSize:12,color:"var(--text3)",borderTop:"1px solid var(--border)",paddingTop:6,marginTop:6}}><b>Model: </b>{q.modelAnswer}</div>}
                    </div>
                    <div style={{display:"flex",gap:5,flexShrink:0}}>
                      <button className="btn btn-sm" onClick={()=>{setEditQ(i);setQForm({...q,marks:q.marks||10});setShowQModal(true);}}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={()=>delQ(selBank,i)}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showBankModal&&(
            <div className="modal-overlay" onClick={()=>setShowBankModal(false)}>
              <div className="modal" onClick={e=>e.stopPropagation()}>
                <div className="modal-head"><div className="modal-title">{editBank!==null?"Edit Bank":"New Essay Bank"}</div><button className="modal-close" onClick={()=>setShowBankModal(false)}>✕</button></div>
                <label className="lbl">Subject / Title</label>
                <input className="inp" placeholder="e.g. Maternal Health — Final Essay" value={bankForm.subject} onChange={e=>setBankForm({...bankForm,subject:e.target.value})} />
                <label className="lbl">Description (optional)</label>
                <textarea className="inp" rows={2} style={{resize:"vertical"}} value={bankForm.description} onChange={e=>setBankForm({...bankForm,description:e.target.value})} />
                <label className="lbl">Target Class</label>
                <select className="inp" value={bankForm.classId} onChange={e=>setBankForm({...bankForm,classId:e.target.value})}>
                  <option value="">All Classes</option>
                  {classes.map(c=><option key={c.id} value={c.id}>{c.label} — {c.desc}</option>)}
                </select>
                <div style={{display:"flex",gap:8}}><button className="btn btn-accent" style={{flex:1}} onClick={saveBank}>Save</button><button className="btn" onClick={()=>setShowBankModal(false)}>Cancel</button></div>
              </div>
            </div>
          )}

          {showQModal&&(
            <div className="modal-overlay" onClick={()=>setShowQModal(false)}>
              <div className="modal" onClick={e=>e.stopPropagation()}>
                <div className="modal-head"><div className="modal-title">{editQ!==null?"Edit Question":"Add Question"}</div><button className="modal-close" onClick={()=>setShowQModal(false)}>✕</button></div>
                <label className="lbl">Question</label>
                <textarea className="inp" rows={3} style={{resize:"vertical"}} placeholder="Enter the essay question..." value={qForm.q} onChange={e=>setQForm({...qForm,q:e.target.value})} />
                <div className="form-row">
                  <div><label className="lbl">Marks</label><input className="inp" type="number" min={1} max={100} value={qForm.marks} onChange={e=>setQForm({...qForm,marks:e.target.value})} /></div>
                  <div><label className="lbl">Word Guide</label><input className="inp" placeholder="e.g. 150-250" value={qForm.wordGuide} onChange={e=>setQForm({...qForm,wordGuide:e.target.value})} /></div>
                </div>
                <label className="lbl">Model Answer (for AI grading)</label>
                <textarea className="inp" rows={3} style={{resize:"vertical"}} placeholder="Key points the student should cover..." value={qForm.modelAnswer} onChange={e=>setQForm({...qForm,modelAnswer:e.target.value})} />
                <div style={{display:"flex",gap:8}}><button className="btn btn-accent" style={{flex:1}} onClick={saveQ}>Save</button><button className="btn" onClick={()=>setShowQModal(false)}>Cancel</button></div>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab==="grade" && (
        <div>
          {gradingStudent ? (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                <button className="btn btn-sm" onClick={()=>setGradingStudent(null)}>← Back</button>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700}}>Grading: {gradingStudent.student}</div>
                <span className="tag">{gradingStudent.subject}</span>
              </div>
              {(gradingStudent.questions||[]).map((q,i)=>(
                <div key={i} className="card" style={{marginBottom:12}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--accent)",marginBottom:4}}>Q{i+1} · Max {q.marks||10} marks</div>
                  <div style={{fontWeight:600,marginBottom:8}}>{q.q}</div>
                  <div style={{background:"var(--bg4)",borderRadius:8,padding:"10px 12px",fontSize:13,color:"var(--text2)",marginBottom:10,fontStyle:"italic"}}>{(gradingStudent.answers||{})[i]||"(no answer)"}</div>
                  <div className="form-row">
                    <div><label className="lbl">Marks Awarded (max {q.marks||10})</label><input className="inp" type="number" min={0} max={q.marks||10} value={gradeForm[i]?.marksAwarded||0} onChange={e=>setGradeForm(f=>({...f,[i]:{...f[i],marksAwarded:e.target.value}}))} /></div>
                    <div><label className="lbl">Feedback</label><input className="inp" placeholder="Brief feedback..." value={gradeForm[i]?.feedback||""} onChange={e=>setGradeForm(f=>({...f,[i]:{...f[i],feedback:e.target.value}}))} /></div>
                  </div>
                </div>
              ))}
              <label className="lbl">Overall Comment</label>
              <textarea className="inp" rows={3} style={{resize:"vertical"}} placeholder="Overall performance summary..." value={overallComment} onChange={e=>setOverallComment(e.target.value)} />
              <button className="btn btn-accent" onClick={submitGrade} disabled={savingGrade}>{savingGrade?"Saving...":"💾 Submit Grade"}</button>
            </div>
          ) : (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div className="sec-title">🗂️ Essay Submissions</div>
                <button className="btn btn-sm btn-accent" onClick={loadSubmissions}>{loadingSubs?"Loading...":"↻ Refresh"}</button>
              </div>
              {loadingSubs ? (
                <div style={{textAlign:"center",color:"var(--text3)",padding:40}}>Loading submissions...</div>
              ) : submissions.length===0 ? (
                <div className="card" style={{textAlign:"center",padding:40,color:"var(--text3)"}}>No submissions found.</div>
              ) : (
                <div className="card" style={{padding:0,overflow:"hidden"}}>
                  <table className="tbl">
                    <thead><tr><th>Student</th><th>Exam</th><th>Date</th><th>Status</th><th>Action</th></tr></thead>
                    <tbody>
                      {submissions.map((s,i)=>(
                        <tr key={i}>
                          <td style={{fontWeight:600,fontSize:13}}>{s.student}</td>
                          <td style={{fontSize:13}}>{s.subject||"—"}</td>
                          <td style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{s.date||"—"}</td>
                          <td>{s.graded?<span className="tag tag-success">✅ Graded</span>:<span className="tag tag-warn">⏳ Pending</span>}</td>
                          <td><button className="btn btn-sm btn-accent" onClick={()=>startGrade(s)}>📝 Grade</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LecturerAnnouncements({ toast, currentUser }) {
  const [announcements, setAnnouncements] = useHydratedShared("nv-announcements", "announcements", DEFAULT_ANNOUNCEMENTS);
  const [form, setForm] = useState({title:"",body:"",pinned:false});
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);

  const save = () => {
    if (!form.title.trim()||!form.body.trim()) return toast("Title and body required","error");
    let u;
    if (edit!==null) {
      u = announcements.map((a,i)=>i===edit?{...a,...form}:a); toast("Updated","success");
    } else {
      u = [...announcements,{...form,id:Date.now(),date:new Date().toLocaleDateString(),postedBy:currentUser}]; toast("Announcement posted!","success");
    }
    setAnnouncements(u); saveShared("announcements",u); setShowModal(false); setEdit(null); setForm({title:"",body:"",pinned:false});
  };

  const del = (i) => {
    if(!window.confirm("Delete this announcement?")) return;
    const u=announcements.filter((_,j)=>j!==i); setAnnouncements(u); saveShared("announcements",u); toast("Deleted","success");
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div className="sec-title">📢 Announcements ({announcements.length})</div>
        <button className="btn btn-accent" onClick={()=>{setShowModal(true);setEdit(null);setForm({title:"",body:"",pinned:false});}}>+ Post</button>
      </div>
      <div style={{display:"grid",gap:10}}>
        {announcements.map((a,i)=>(
          <div key={a.id||i} className="card" style={{borderLeft:`3px solid ${a.pinned?"var(--warn)":"var(--accent)"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  {a.pinned&&<span className="tag tag-warn" style={{fontSize:9}}>📌 Pinned</span>}
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>{a.date}</span>
                </div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,marginBottom:5}}>{a.title}</div>
                <div style={{fontSize:13,color:"var(--text2)",lineHeight:1.6}}>{a.body}</div>
              </div>
              <div style={{display:"flex",gap:5,flexShrink:0,marginLeft:10}}>
                <button className="btn btn-sm" onClick={()=>{setEdit(i);setForm({title:a.title,body:a.body,pinned:a.pinned||false});setShowModal(true);}}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={()=>del(i)}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {showModal&&(
        <div className="modal-overlay" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{edit!==null?"Edit Announcement":"New Announcement"}</div><button className="modal-close" onClick={()=>setShowModal(false)}>✕</button></div>
            <label className="lbl">Title</label>
            <input className="inp" placeholder="Announcement title..." value={form.title} onChange={e=>setForm({...form,title:e.target.value})} />
            <label className="lbl">Body</label>
            <textarea className="inp" rows={4} style={{resize:"vertical"}} placeholder="Full announcement text..." value={form.body} onChange={e=>setForm({...form,body:e.target.value})} />
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:14,fontSize:13}}>
              <input type="checkbox" checked={form.pinned} onChange={e=>setForm({...form,pinned:e.target.checked})} />
              📌 Pin to top
            </label>
            <div style={{display:"flex",gap:8}}><button className="btn btn-accent" style={{flex:1}} onClick={save}>Post</button><button className="btn" onClick={()=>setShowModal(false)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function LecturerStudents({ toast }) {
  const users = ls("nv-users",[]).filter(u=>u.role==="student");
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [filterClass, setFilterClass] = useState("");
  const filtered = filterClass ? users.filter(u=>u.class===filterClass) : users;
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">👥 Students ({filtered.length})</div>
        <select className="inp" style={{width:"auto",marginBottom:0,padding:"7px 12px",fontSize:13}} value={filterClass} onChange={e=>setFilterClass(e.target.value)}>
          <option value="">All Classes</option>
          {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      {filtered.length===0 ? (
        <div className="card" style={{textAlign:"center",padding:40,color:"var(--text3)"}}>No students found.</div>
      ) : (
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="tbl">
            <thead><tr><th>Student</th><th>Class</th><th>Joined</th></tr></thead>
            <tbody>
              {filtered.map(u=>{
                const cls = classes.find(c=>c.id===u.class);
                return (
                  <tr key={u.username}>
                    <td><div style={{display:"flex",alignItems:"center",gap:8}}><div className="user-av" style={{width:30,height:30,fontSize:13}}>{u.username[0].toUpperCase()}</div><span style={{fontWeight:600,fontSize:13}}>{u.username}</span></div></td>
                    <td>{cls?<span className="tag tag-accent">{cls.label}</span>:<span style={{color:"var(--text3)",fontSize:12}}>—</span>}</td>
                    <td style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{u.joined||"—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// CLASS EXAMS VIEW (Student)
// ════════════════════════════════════════════════════════════════════
function ClassExamsView({ toast, currentUser, userClass }) {
  const [tab, setTab] = useState("set");
  const allMCQ = useShared("pq", DEFAULT_PQ);
  const allEssay = useShared("essayBanks", []);
  const allClassExams = useShared("classExams", []);

  // Filter by student's class
  const mcqBanks = allMCQ.filter(b=>!b.classId || b.classId===userClass);
  const essayBanks = allEssay.filter(b=>!b.classId || b.classId===userClass);
  // Only published exams for this student's class
  const classExams = allClassExams.filter(e => e.isPublished && e.classId === userClass);

  return (
    <div>
      <div style={{marginBottom:20}}>
        <div className="sec-title">📝 Class Exams</div>
        <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:16}}>
          Exams assigned to your class · 1 attempt per exam
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[
            {key:"set",icon:"🏆",label:"Set Exams",sub:`${classExams.length} available`},
            {key:"mcq",icon:"📝",label:"MCQ Banks",sub:`${mcqBanks.length} available`},
            {key:"essay",icon:"✍️",label:"Essay Exams",sub:`${essayBanks.length} available`}
          ].map(t=>(
            <div key={t.key} onClick={()=>setTab(t.key)} style={{
              flex:1,minWidth:140,padding:"12px 16px",borderRadius:11,cursor:"pointer",transition:"all .2s",
              border:`1px solid ${tab===t.key?"var(--warn)":"var(--border)"}`,
              background:tab===t.key?"rgba(251,146,60,.1)":"transparent",textAlign:"center"
            }}>
              <div style={{fontSize:22,marginBottom:4}}>{t.icon}</div>
              <div style={{fontWeight:700,fontSize:13,color:tab===t.key?"var(--warn)":"var(--text2)"}}>{t.label}</div>
              <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginTop:2}}>{t.sub}</div>
            </div>
          ))}
        </div>
      </div>
      {tab==="set" && <SetExamStudentView toast={toast} currentUser={currentUser} classExams={classExams} />}
      {tab==="mcq" && <MCQExamView toast={toast} currentUser={currentUser} banks={mcqBanks} />}
      {tab==="essay" && <EssayExamView toast={toast} currentUser={currentUser} essayBanks={essayBanks} />}
    </div>
  );
}

// ─── Student view for lecturer-set exams ─────────────────────────────
function SetExamStudentView({ toast, currentUser, classExams }) {
  const [sel, setSel] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [started, setStarted] = useState(false);
  const [attempts, setAttempts] = useHydratedUser(`nv-set-exam-att-${currentUser}`, "set-exam-att", {});
  const [qIdx, setQIdx] = useState(0);

  const startExam = (exam) => {
    if (attempts[String(exam.id)]) { toast("You have already used your 1 attempt for this exam.", "error"); return; }
    setSel(exam); setAnswers({}); setSubmitted(false); setScore(null); setQIdx(0);
    setTimeLeft(exam.duration * 60);
    setStarted(true);
  };

  React.useEffect(() => {
    if (!started || timeLeft === null || submitted) return;
    if (timeLeft <= 0) { submitExam(); return; }
    const t = setTimeout(() => setTimeLeft(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [started, timeLeft, submitted]);

  const submitExam = () => {
    if (!sel) return;
    let correct = 0;
    sel.questions.forEach((q, i) => { if (answers[i] === q.ans) correct++; });
    const pct = Math.round((correct / sel.questions.length) * 100);
    const pass = correct >= (sel.passMark || Math.ceil(sel.questions.length * 0.5));
    setScore({ correct, total: sel.questions.length, pct, pass });
    setSubmitted(true);
    const newAtt = { ...attempts, [String(sel.id)]: { date: new Date().toLocaleDateString(), score: correct, total: sel.questions.length, pct, pass } };
    setAttempts(newAtt); // useHydratedUser auto-saves to backend
    toast(pass ? `Passed! ${correct}/${sel.questions.length} (${pct}%)` : `Submitted: ${correct}/${sel.questions.length} (${pct}%)`, pass ? "success" : "warn");
  };

  const fmtTime = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  if (started && sel && !submitted) {
    const q = sel.questions[qIdx];
    const urgent = timeLeft !== null && timeLeft < 120;
    return (
      <div>
        {/* Top bar */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16}}>{sel.title}</div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:urgent?"var(--danger)":"var(--text2)",background:urgent?"rgba(239,68,68,.1)":"var(--bg3)",padding:"6px 14px",borderRadius:8,border:`1px solid ${urgent?"rgba(239,68,68,.3)":"var(--border)"}`}}>⏱ {fmtTime(timeLeft)}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--text3)"}}>{Object.keys(answers).length}/{sel.questions.length} answered</span>
            <button className="btn btn-accent btn-sm" style={{fontWeight:700}} onClick={submitExam}>Submit ✓</button>
          </div>
        </div>
        {/* Progress */}
        <div className="progress-wrap" style={{marginBottom:18,height:6}}>
          <div className="progress-fill" style={{width:`${((qIdx+1)/sel.questions.length)*100}%`,background:"var(--warn)"}} />
        </div>
        {/* Question */}
        <div className="card" style={{marginBottom:14}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)",marginBottom:8}}>Q {qIdx+1} of {sel.questions.length}</div>
          <div style={{fontWeight:600,fontSize:15,lineHeight:1.6,marginBottom:16}}>{q.q}</div>
          <div style={{display:"grid",gap:8}}>
            {q.options.map((o, oi) => (
              <button key={oi} onClick={() => setAnswers(a => ({...a,[qIdx]:oi}))}
                style={{padding:"12px 16px",borderRadius:10,border:`2px solid ${answers[qIdx]===oi?"var(--warn)":"var(--border)"}`,background:answers[qIdx]===oi?"rgba(251,146,60,.12)":"var(--bg3)",cursor:"pointer",textAlign:"left",fontSize:14,fontWeight:answers[qIdx]===oi?700:400,color:answers[qIdx]===oi?"var(--warn)":"var(--text2)",transition:"all .15s",display:"flex",alignItems:"center",gap:12}}>
                <span style={{width:28,height:28,borderRadius:7,border:`1.5px solid ${answers[qIdx]===oi?"var(--warn)":"var(--border)"}`,background:answers[qIdx]===oi?"var(--warn)":"transparent",color:answers[qIdx]===oi?"#000":"var(--text3)",fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{"ABCD"[oi]}</span>
                {o}
              </button>
            ))}
          </div>
        </div>
        {/* Nav */}
        <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
          <button className="btn btn-sm" disabled={qIdx===0} onClick={() => setQIdx(i=>i-1)}>← Prev</button>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"center",flex:1}}>
            {sel.questions.map((_,i) => (
              <button key={i} onClick={() => setQIdx(i)}
                style={{width:30,height:30,borderRadius:6,border:`1.5px solid ${qIdx===i?"var(--warn)":answers[i]!==undefined?"var(--success)":"var(--border)"}`,background:qIdx===i?"rgba(251,146,60,.15)":answers[i]!==undefined?"rgba(74,222,128,.1)":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:qIdx===i?"var(--warn)":answers[i]!==undefined?"var(--success)":"var(--text3)",fontFamily:"'DM Mono',monospace"}}>
                {i+1}
              </button>
            ))}
          </div>
          {qIdx < sel.questions.length - 1
            ? <button className="btn btn-sm btn-accent" onClick={() => setQIdx(i=>i+1)}>Next →</button>
            : <button className="btn btn-sm btn-accent" style={{fontWeight:700}} onClick={submitExam}>Submit ✓</button>
          }
        </div>
      </div>
    );
  }

  if (submitted && score && sel) return (
    <div>
      <div className="card" style={{textAlign:"center",padding:"40px 30px",marginBottom:20,border:`1px solid ${score.pass?"rgba(74,222,128,.35)":"rgba(239,68,68,.25)"}`,background:score.pass?"rgba(74,222,128,.05)":"rgba(239,68,68,.03)"}}>
        <div style={{fontSize:52,marginBottom:12}}>{score.pass?"🎉":"📋"}</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:24,marginBottom:4}}>{score.pass?"Passed!":"Submitted"}</div>
        <div style={{fontSize:14,color:"var(--text2)",marginBottom:16}}>{sel.title}</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:36,fontWeight:700,color:score.pass?"var(--success)":"var(--warn)"}}>{score.pct}%</div>
        <div style={{fontSize:14,color:"var(--text3)",marginBottom:8}}>{score.correct} / {score.total} correct</div>
        <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:16}}>Pass mark: {sel.passMark || Math.ceil(sel.questions.length*0.5)} / {sel.totalMarks || sel.questions.length}</div>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--text3)"}}>🔒 1 attempt used — contact your lecturer to reset</span>
      </div>
      <button className="btn btn-sm" onClick={() => { setSel(null); setStarted(false); }}>← Back to Exams</button>
    </div>
  );

  // Exam list
  if (classExams.length === 0) return (
    <div className="card" style={{textAlign:"center",padding:"50px 30px",color:"var(--text3)"}}>
      <div style={{fontSize:44,marginBottom:10}}>🏆</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>No class exams available yet.</div>
      <div style={{fontSize:12,marginTop:6}}>Your lecturer will publish exams here when ready.</div>
    </div>
  );

  return (
    <div style={{display:"grid",gap:12}}>
      {classExams.map(exam => {
        const att = attempts[String(exam.id)];
        return (
          <div key={exam.id} className="card" style={{animation:"fadeUp .3s ease",border:att?"1px solid rgba(74,222,128,.2)":"1px solid var(--border)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1}}>
                {exam.subject && <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--accent)",marginBottom:4}}>{exam.subject}</div>}
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:6}}>{exam.title}</div>
                <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>
                  <span>📝 {exam.questionCount} Qs</span>
                  <span>⏱ {exam.duration} min</span>
                  {exam.date && <span>📅 {exam.date}</span>}
                  <span>🎯 Pass: {exam.passMark}/{exam.totalMarks}</span>
                </div>
                {exam.instructions && <div style={{fontSize:12,color:"var(--text2)",marginTop:8,lineHeight:1.5,fontStyle:"italic"}}>📋 {exam.instructions}</div>}
                {att && (
                  <div style={{marginTop:8,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--success)",background:"rgba(74,222,128,.1)",border:"1px solid rgba(74,222,128,.25)",borderRadius:5,padding:"2px 8px"}}>✓ Completed {att.date}</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--text2)",background:"var(--bg3)",borderRadius:5,padding:"2px 8px",border:"1px solid var(--border)"}}>{att.correct}/{att.total} · {att.pct}%</span>
                    {att.pass && <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--success)"}}>PASSED</span>}
                  </div>
                )}
              </div>
              {!att
                ? <button className="btn btn-accent btn-sm" style={{fontWeight:700}} onClick={() => startExam(exam)}>Start Exam ▶</button>
                : <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--text3)"}}>🔒 Attempted</span>
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Exams & Questions wrapper ────────────────────────────────────
function PastQuestionsView({ toast, currentUser }) {
  const [tab, setTab] = useState("mcq");
  const mcqBanks = useShared("pq", DEFAULT_PQ);
  const essayBanks = useShared("essayBanks", []);

  return (
    <div>
      <div style={{marginBottom:20}}>
        <div className="sec-title">📋 Exams & Past Questions</div>
        <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:16}}>Each exam: 1 attempt only, tracked per student</div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[
            {key:"mcq",icon:"📝",label:"MCQ Exams",sub:"Multiple choice · navigate freely"},
            {key:"essay",icon:"✍️",label:"Essay Exams",sub:"Long answer · AI or manual grading"}
          ].map(t=>(
            <div key={t.key} onClick={()=>setTab(t.key)} style={{
              flex:1,minWidth:160,padding:"12px 16px",borderRadius:11,cursor:"pointer",transition:"all .2s",
              border:`1px solid ${tab===t.key?"var(--accent)":"var(--border)"}`,
              background:tab===t.key?"rgba(62,142,149,.12)":"transparent",textAlign:"center"
            }}>
              <div style={{fontSize:22,marginBottom:4}}>{t.icon}</div>
              <div style={{fontWeight:700,fontSize:14,color:tab===t.key?"var(--accent)":"var(--text2)"}}>{t.label}</div>
              <div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginTop:2}}>{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {tab==="mcq"
        ? <MCQExamView toast={toast} currentUser={currentUser} banks={mcqBanks} />
        : <EssayExamView toast={toast} currentUser={currentUser} essayBanks={essayBanks} />
      }
    </div>
  );
}

function FlashcardsView() {
  const [decks] = useState(()=>ls("nv-decks",DEFAULT_DECKS));
  const [selDeck, setSelDeck] = useState(null); const [cardIdx, setCardIdx] = useState(0); const [flipped, setFlipped] = useState(false);
  if(selDeck){const deck=decks.find(d=>d.id===selDeck);const card=deck.cards[cardIdx];return<div><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}><button className="btn btn-sm" onClick={()=>setSelDeck(null)}>← Back</button><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:16}}>{deck.name}</div><div style={{marginLeft:"auto",fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--text3)"}}>{cardIdx+1}/{deck.cards.length}</div></div><div className="progress-wrap" style={{marginBottom:18}}><div className="progress-fill" style={{width:`${((cardIdx+1)/deck.cards.length)*100}%`,background:"var(--accent)"}} /></div><div className="flashcard" onClick={()=>setFlipped(f=>!f)}><div className={`flashcard-inner${flipped?" flipped":""}`}><div className="flashcard-front"><div className="fc-lbl">QUESTION — tap to flip</div><div className="fc-text">{card.front}</div></div><div className="flashcard-back"><div className="fc-lbl">ANSWER</div><div className="fc-text">{card.back}</div></div></div></div><div style={{display:"flex",gap:10,marginTop:18,justifyContent:"center"}}><button className="btn" disabled={cardIdx===0} onClick={()=>{setCardIdx(i=>i-1);setFlipped(false);}}>← Prev</button><button className="btn btn-accent" onClick={()=>setFlipped(f=>!f)}>Flip 🔄</button><button className="btn" disabled={cardIdx>=deck.cards.length-1} onClick={()=>{setCardIdx(i=>i+1);setFlipped(false);}}>Next →</button></div></div>;}
  return<div><div className="sec-title">🃏 Flashcards</div><div className="sec-sub">Study with interactive cards</div><div className="grid2">{decks.map((d,i)=><div key={d.id} className="card" style={{cursor:"pointer",animation:`fadeUp .4s ease ${i*.08}s both`}} onClick={()=>{setSelDeck(d.id);setCardIdx(0);setFlipped(false);}}><div style={{fontSize:32,marginBottom:8}}>🃏</div><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:16,marginBottom:4}}>{d.name}</div><div style={{fontSize:12,color:"var(--text3)"}}>{d.cards.length} cards</div></div>)}</div></div>;
}

function DrugGuideView() {
  const [drugs] = useState(()=>ls("nv-drugs",DEFAULT_DRUGS));
  const [search, setSearch] = useState(""); const [sel, setSel] = useState(null);
  const filtered = drugs.filter(d=>d.name.toLowerCase().includes(search.toLowerCase())||d.class.toLowerCase().includes(search.toLowerCase()));
  return<div><div className="sec-title">💊 Drug Guide</div><div className="sec-sub">Quick reference for medications</div><div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search drugs..." value={search} onChange={e=>setSearch(e.target.value)} /></div><div className="grid2">{filtered.map((d,i)=><div key={d.id} className="card" style={{cursor:"pointer",animation:`fadeUp .3s ease ${i*.05}s both`}} onClick={()=>setSel(d)}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{d.name}</div><span className="tag tag-accent">{d.class?.split("/")[0]}</span></div><div style={{fontSize:12,color:"var(--text3)"}}><b style={{color:"var(--text2)"}}>Dose:</b> {d.dose}</div><div style={{fontSize:12,color:"var(--text3)",marginTop:4}}><b style={{color:"var(--text2)"}}>Uses:</b> {d.uses}</div></div>)}</div>{sel&&<div className="modal-overlay" onClick={()=>setSel(null)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div className="modal-title">{sel.name}</div><button className="modal-close" onClick={()=>setSel(null)}>✕</button></div><span className="tag tag-accent" style={{marginBottom:16,display:"inline-block"}}>{sel.class}</span>{[["💊 Dose",sel.dose],["📊 Max",sel.max],["✅ Uses",sel.uses],["⚠️ Contraindications",sel.contraindications],["⚡ Side Effects",sel.side_effects]].map(([l,v])=><div key={l} style={{marginBottom:14}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:"1px"}}>{l}</div><div style={{fontSize:14,color:"var(--text2)"}}>{v||"—"}</div></div>)}</div></div>}</div>;
}

function LabReferenceView() {
  const [labs] = useState(()=>ls("nv-labs",DEFAULT_LABS));
  const [search, setSearch] = useState("");
  const filtered = labs.filter(l=>l.test.toLowerCase().includes(search.toLowerCase()));
  return<div><div className="sec-title">🧪 Lab Reference</div><div className="sec-sub">Normal laboratory values</div><div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search test name..." value={search} onChange={e=>setSearch(e.target.value)} /></div><div className="card" style={{padding:0,overflow:"hidden"}}><table className="tbl"><thead><tr><th>Test</th><th>Male</th><th>Female</th><th>Notes</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id}><td style={{fontWeight:700}}>{r.test}</td><td style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--accent)"}}>{r.male}</td><td style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--accent2)"}}>{r.female}</td><td style={{fontSize:12,color:"var(--text3)"}}>{r.notes}</td></tr>)}</tbody></table></div></div>;
}

function DictionaryView() {
  const [dict] = useState(()=>ls("nv-dict",DEFAULT_DICT));
  const [search, setSearch] = useState("");
  const filtered = dict.filter(d=>d.term.toLowerCase().includes(search.toLowerCase())||d.def.toLowerCase().includes(search.toLowerCase()));
  return<div><div className="sec-title">📖 Medical Dictionary</div><div className="sec-sub">{dict.length} terms</div><div className="search-wrap"><span className="search-ico">🔍</span><input placeholder="Search terms..." value={search} onChange={e=>setSearch(e.target.value)} /></div><div className="grid2">{filtered.map((t,i)=><div key={t.id} className="card2" style={{animation:`fadeUp .3s ease ${i*.03}s both`}}><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,color:"var(--accent)",marginBottom:5}}>{t.term}</div><div style={{fontSize:13,color:"var(--text2)",lineHeight:1.5}}>{t.def}</div></div>)}</div></div>;
}

function SkillsView() {
  const skillsDb = useShared("skills", DEFAULT_SKILLS);
  const [done, setDone] = useHydratedUser("nv-skills-done", "skills-done", {});
  const toggle=(id)=>{const u={...done,[id]:!done[id]};setDone(u);};
  const count = skillsDb.filter(s=>done[s.id]).length;
  return<div><div className="sec-title">✅ Skills Checklist</div><div className="sec-sub">Track clinical competencies</div><div className="card" style={{marginBottom:16}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--text3)"}}>Progress</span><span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--accent)"}}>{count}/{skillsDb.length}</span></div><div className="progress-wrap"><div className="progress-fill" style={{width:`${skillsDb.length>0?(count/skillsDb.length)*100:0}%`,background:"linear-gradient(90deg,var(--accent),var(--accent2))"}} /></div></div>{skillsDb.map(s=><div key={s.id} className="card2" style={{marginBottom:8,display:"flex",alignItems:"center",gap:12,cursor:"pointer",opacity:done[s.id]?.6:1}} onClick={()=>toggle(s.id)}><div style={{width:22,height:22,borderRadius:6,border:`2px solid ${done[s.id]?"var(--success)":"var(--border2)"}`,background:done[s.id]?"var(--success)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .2s"}}>{done[s.id]&&<span style={{fontSize:12,color:"white"}}>✓</span>}</div><div style={{fontSize:14,fontWeight:500,textDecoration:done[s.id]?"line-through":"none",flex:1}}>{s.name}</div>{done[s.id]&&<span className="tag tag-success">Done</span>}</div>)}</div>;
}

function GPACalc({ toast }) {
  const [courses, setCourses] = useHydratedUser("nv-gpa-courses", "gpa-courses", []);
  const [form, setForm] = useState({name:"",units:"",grade:""});
  const GRADES=[{l:"A",p:"5.0"},{l:"B",p:"4.0"},{l:"C",p:"3.0"},{l:"D",p:"2.0"},{l:"E",p:"1.0"},{l:"F",p:"0.0"}];
  const add=()=>{if(!form.name||!form.units||!form.grade)return toast("Fill all fields","error");const u=[...courses,{...form,id:Date.now(),units:+form.units,grade:+form.grade}];setCourses(u);setForm({name:"",units:"",grade:""});};
  const tp=courses.reduce((s,c)=>s+c.units*c.grade,0),tu=courses.reduce((s,c)=>s+c.units,0),gpa=tu>0?tp/tu:0;
  const cls=gpa>=4.5?"First Class":gpa>=3.5?"Second Class Upper":gpa>=2.5?"Second Class Lower":gpa>=1.5?"Third Class":"Fail";
  const clsColor=gpa>=4.5?"var(--accent)":gpa>=3.5?"var(--accent2)":gpa>=2.5?"var(--warn)":"var(--danger)";
  return<div><div className="sec-title">🎓 GPA Calculator</div><div className="sec-sub">5.0 scale</div>{courses.length>0&&<div className="card" style={{marginBottom:18,textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)",marginBottom:6,textTransform:"uppercase",letterSpacing:"1px"}}>Your GPA</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:56,fontWeight:800,color:"var(--accent)"}}>{gpa.toFixed(2)}</div><div style={{fontSize:16,color:clsColor,fontWeight:600,marginBottom:8}}>{cls}</div><div className="gpa-bar-wrap"><div className="gpa-bar" style={{width:`${(gpa/5)*100}%`}} /></div></div>}<div className="card" style={{marginBottom:14}}><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>Add Course</div><div className="grid3" style={{gap:10,alignItems:"end"}}><div><label className="lbl">Course</label><input className="inp" style={{marginBottom:0}} placeholder="Pharmacology" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div><div><label className="lbl">Units</label><input className="inp" style={{marginBottom:0}} type="number" min="1" max="6" value={form.units} onChange={e=>setForm({...form,units:e.target.value})} /></div><div><label className="lbl">Grade</label><select className="inp" style={{marginBottom:0}} value={form.grade} onChange={e=>setForm({...form,grade:e.target.value})}><option value="">Select...</option>{GRADES.map(g=><option key={g.l} value={g.p}>{g.l} ({g.p})</option>)}</select></div></div><button className="btn btn-accent" style={{marginTop:10}} onClick={add}>Add</button></div>{courses.map((c,i)=><div key={c.id} className="course-row"><div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{c.name}</div><div style={{fontSize:11,color:"var(--text3)"}}>{c.units} unit{c.units>1?"s":""}</div></div><div style={{width:36,height:36,borderRadius:9,background:"rgba(62,142,149,.1)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Syne',sans-serif",fontWeight:700,color:"var(--accent)"}}>{GRADES.find(g=>+g.p===c.grade)?.l}</div><button className="btn btn-sm btn-danger" onClick={()=>{const u=courses.filter(x=>x.id!==c.id);setCourses(u);saveMyData("gpa-courses","nv-gpa-courses",u);}}>✕</button></div>)}{courses.length>0&&<button className="btn btn-sm btn-danger" style={{marginTop:8}} onClick={()=>{setCourses([]);saveMyData("gpa-courses","nv-gpa-courses",[]);}}>Clear All</button>}</div>;
}

function MedCalc() {
  const [dose,setDose]=useState("");const [weight,setWeight]=useState("");const [avail,setAvail]=useState("");const [vol,setVol]=useState("");
  const result=dose&&weight?(+dose*+weight).toFixed(2):null;
  const volume=result&&avail&&vol?((+result/+avail)*+vol).toFixed(2):null;
  const [bmi,setBmi]=useState({h:"",w:""});
  const bmiVal=bmi.h&&bmi.w?(+bmi.w/(+bmi.h/100)**2).toFixed(1):null;
  const bmiCls=bmiVal?+bmiVal<18.5?"Underweight":+bmiVal<25?"Normal":+bmiVal<30?"Overweight":"Obese":null;
  return<div><div className="sec-title">🧮 Med Calculator</div><div className="sec-sub">Drug dosage & BMI</div><div className="grid2"><div className="card"><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>💊 Dose Calculator</div><label className="lbl">Dose (mg/kg)</label><input className="inp" type="number" placeholder="10" value={dose} onChange={e=>setDose(e.target.value)} /><label className="lbl">Weight (kg)</label><input className="inp" type="number" placeholder="70" value={weight} onChange={e=>setWeight(e.target.value)} />{result&&<div className="card2" style={{textAlign:"center",marginBottom:12}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>REQUIRED DOSE</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:26,fontWeight:800,color:"var(--accent)"}}>{result} mg</div></div>}<label className="lbl">Drug Available (mg)</label><input className="inp" type="number" value={avail} onChange={e=>setAvail(e.target.value)} /><label className="lbl">Available Volume (mL)</label><input className="inp" type="number" value={vol} onChange={e=>setVol(e.target.value)} />{volume&&<div className="card2" style={{textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>GIVE</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:26,fontWeight:800,color:"var(--accent2)"}}>{volume} mL</div></div>}</div><div className="card"><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>⚖️ BMI</div><label className="lbl">Height (cm)</label><input className="inp" type="number" value={bmi.h} onChange={e=>setBmi({...bmi,h:e.target.value})} /><label className="lbl">Weight (kg)</label><input className="inp" type="number" value={bmi.w} onChange={e=>setBmi({...bmi,w:e.target.value})} />{bmiVal&&<div className="card2" style={{textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)"}}>BMI</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:48,fontWeight:800,color:"var(--accent)"}}>{bmiVal}</div><div style={{color:+bmiVal<18.5?"var(--warn)":+bmiVal<25?"var(--success)":+bmiVal<30?"var(--warn)":"var(--danger)",fontWeight:600}}>{bmiCls}</div></div>}</div></div></div>;
}

function Timetable({ toast }) {
  const [tt, setTt] = useHydratedUser("nv-timetable", "timetable", []);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({day:"Monday",time:"",subject:"",venue:"",type:"Lecture"});
  const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const COLORS={Lecture:"var(--accent)",Practical:"var(--warn)",Tutorial:"var(--accent2)",Clinical:"var(--danger)"};
  const save=()=>{if(!form.time||!form.subject)return toast("Fill required fields","error");const u=[...tt,{...form,id:Date.now()}];setTt(u);setShowAdd(false);toast("Added!","success");};
  return<div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}><div><div className="sec-title">📅 Timetable</div><div className="sec-sub">Weekly schedule</div></div><button className="btn btn-accent" onClick={()=>setShowAdd(true)}>+ Add Class</button></div>{DAYS.map(day=>{const dc=tt.filter(t=>t.day===day);if(!dc.length)return null;return<div key={day} style={{marginBottom:18}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--text3)",marginBottom:8,textTransform:"uppercase",letterSpacing:"1px"}}>{day}</div>{dc.sort((a,b)=>a.time.localeCompare(b.time)).map(c=><div key={c.id} className="card2" style={{marginBottom:7,display:"flex",alignItems:"center",gap:12,borderLeft:`3px solid ${COLORS[c.type]||"var(--accent)"}`}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:"var(--accent)",minWidth:48}}>{c.time}</div><div style={{flex:1}}><div style={{fontWeight:600,fontSize:14}}>{c.subject}</div>{c.venue&&<div style={{fontSize:11,color:"var(--text3)"}}>{c.venue}</div>}</div><span className="tt-badge" style={{background:`${COLORS[c.type]||"var(--accent)"}20`,color:COLORS[c.type]||"var(--accent)"}}>{c.type}</span><button className="btn btn-sm btn-danger" onClick={()=>{const u=tt.filter(x=>x.id!==c.id);setTt(u);saveMyData("timetable","nv-timetable",u);}}>✕</button></div>)}</div>;})} {tt.length===0&&<div style={{textAlign:"center",padding:"50px",color:"var(--text3)"}}><div style={{fontSize:48}}>📅</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:13,marginTop:12}}>No classes added.</div></div>}{showAdd&&<div className="modal-overlay" onClick={()=>setShowAdd(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div className="modal-title">Add Class</div><button className="modal-close" onClick={()=>setShowAdd(false)}>✕</button></div>{[["Day","day","select"],["Time","time","time"],["Subject","subject","text"],["Venue","venue","text"],["Type","type","select"]].map(([l,k,t])=><div key={k}><label className="lbl">{l}</label>{t==="select"?<select className="inp" value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}>{k==="day"?DAYS.map(d=><option key={d}>{d}</option>):["Lecture","Practical","Tutorial","Clinical"].map(d=><option key={d}>{d}</option>)}</select>:<input className="inp" type={t} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} />}</div>)}<div style={{display:"flex",gap:8}}><button className="btn btn-accent" style={{flex:1}} onClick={save}>Save</button><button className="btn" onClick={()=>setShowAdd(false)}>Cancel</button></div></div></div>}</div>;
}

function StudyPlanner({ toast }) {
  const [tasks, setTasks] = useHydratedUser("nv-tasks", "tasks", []);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({task:"",subject:"",due:"",priority:"Medium"});
  const save=()=>{if(!form.task)return toast("Enter task","error");const u=[...tasks,{...form,id:Date.now(),done:false}];setTasks(u);setForm({task:"",subject:"",due:"",priority:"Medium"});setShowAdd(false);toast("Task added!","success");};
  const toggle=(id)=>{const u=tasks.map(t=>t.id===id?{...t,done:!t.done}:t);setTasks(u);};
  const del=(id)=>{const u=tasks.filter(t=>t.id!==id);setTasks(u);};
  const pColor={High:"var(--danger)",Medium:"var(--warn)",Low:"var(--accent)"};
  const pending=tasks.filter(t=>!t.done).length;
  return<div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}><div><div className="sec-title">📅 Study Planner</div><div className="sec-sub">{pending} task{pending!==1?"s":""} pending</div></div><button className="btn btn-accent" onClick={()=>setShowAdd(true)}>+ Add Task</button></div>{tasks.length===0&&<div style={{textAlign:"center",padding:"60px",color:"var(--text3)"}}><div style={{fontSize:48}}>✅</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:13,marginTop:12}}>No tasks!</div></div>}{tasks.map(t=><div key={t.id} className="card2" style={{marginBottom:8,display:"flex",alignItems:"center",gap:12,opacity:t.done?.5:1}}><div style={{width:22,height:22,borderRadius:6,border:`2px solid ${t.done?"var(--success)":"var(--border2)"}`,background:t.done?"var(--success)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .2s"}} onClick={()=>toggle(t.id)}>{t.done&&<span style={{fontSize:12,color:"white"}}>✓</span>}</div><div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,textDecoration:t.done?"line-through":"none"}}>{t.task}</div>{(t.subject||t.due)&&<div style={{fontSize:11,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{t.subject}{t.subject&&t.due?" · ":""}{t.due}</div>}</div><span className="tag" style={{borderColor:pColor[t.priority],color:pColor[t.priority]}}>{t.priority}</span><button className="btn btn-sm btn-danger" onClick={()=>del(t.id)}>✕</button></div>)}{showAdd&&<div className="modal-overlay" onClick={()=>setShowAdd(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div className="modal-title">Add Task</div><button className="modal-close" onClick={()=>setShowAdd(false)}>✕</button></div><label className="lbl">Task</label><input className="inp" value={form.task} onChange={e=>setForm({...form,task:e.target.value})} /><label className="lbl">Subject</label><input className="inp" value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})} /><label className="lbl">Due Date</label><input className="inp" type="date" value={form.due} onChange={e=>setForm({...form,due:e.target.value})} /><label className="lbl">Priority</label><select className="inp" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{["High","Medium","Low"].map(p=><option key={p}>{p}</option>)}</select><div style={{display:"flex",gap:8}}><button className="btn btn-accent" style={{flex:1}} onClick={save}>Add</button><button className="btn" onClick={()=>setShowAdd(false)}>Cancel</button></div></div></div>}</div>;
}

function Messages({ user, toast }) {
  const [msgs, setMsgs] = useState(()=>ls("nv-messages",[{id:1,from:"System",text:"Welcome to Nursing Academic Hub! 🎉",time:"Now",read:true}]));
  const [input, setInput] = useState("");
  const announcements = ls("nv-announcements",[]);
  const send=()=>{if(!input.trim())return;const msg={id:Date.now(),from:user,text:input,time:"Just now",read:true,mine:true};const u=[...msgs,msg];setMsgs(u);saveMyData("messages","nv-messages",u);setInput("");};
  return<div><div className="sec-title">💬 Messages</div><div className="sec-sub">Notifications and chat</div>{announcements.filter(a=>a.pinned).map(a=><div key={a.id} style={{background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.2)",borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:13}}><b>📌 {a.title}:</b> {a.body}</div>)}<div className="card" style={{marginBottom:14,minHeight:250,display:"flex",flexDirection:"column",gap:8,padding:14}}>{msgs.map(m=><div key={m.id} style={{display:"flex",gap:8,alignItems:"flex-start",justifyContent:m.mine?"flex-end":"flex-start"}}>{!m.mine&&<div style={{width:30,height:30,borderRadius:50,background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>📢</div>}<div style={{maxWidth:"75%"}}>{!m.mine&&<div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:3}}>{m.from} · {m.time}</div>}<div style={{background:m.mine?"linear-gradient(135deg,var(--accent),var(--accent2))":"var(--card2)",borderRadius:m.mine?"14px 14px 4px 14px":"14px 14px 14px 4px",padding:"9px 13px",fontSize:14,color:m.mine?"white":"var(--text)"}}>{m.text}</div></div></div>)}</div><div style={{display:"flex",gap:8}}><input className="inp" style={{flex:1,marginBottom:0}} placeholder="Type a message..." value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} /><button className="btn btn-accent" onClick={send}>Send</button></div></div>;
}

function Notifications({ currentUser, onRead }) {
  const [notifs, setNotifs] = useHydratedUser("nv-notifications", "notifications", []);

  useEffect(() => {
    // Mark all as read
    const updated = notifs.map(n=>({...n,read:true}));
    setNotifs(updated);
    if (onRead) onRead();
  }, []);

  const del = (id) => { const u=notifs.filter(n=>n.id!==id); setNotifs(u); };
  const clearAll = () => { setNotifs([]); };

  const typeIcon = (type) => { if(type==="handout")return"📄"; if(type==="announcement")return"📢"; return"🔔"; };
  const typeColor = (type) => { if(type==="handout")return"var(--accent)"; if(type==="announcement")return"var(--warn)"; return"var(--text3)"; };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div><div className="sec-title">🔔 Notifications</div><div className="sec-sub">{notifs.length} notification{notifs.length!==1?"s":""}</div></div>
        {notifs.length>0&&<button className="btn btn-sm btn-danger" onClick={clearAll}>🗑️ Clear All</button>}
      </div>
      {notifs.length===0 ? (
        <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}>
          <div style={{fontSize:48,marginBottom:12}}>🔔</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:13}}>No notifications yet.</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:6}}>You'll be notified when lecturers upload new handouts.</div>
        </div>
      ) : (
        <div>
          {notifs.map((n,i)=>(
            <div key={n.id} className="card" style={{marginBottom:10,borderLeft:`3px solid ${typeColor(n.type)}`,animation:`fadeUp .3s ease ${i*.04}s both`,opacity:n.read?.85:1}}>
              <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{fontSize:22,flexShrink:0,marginTop:2}}>{typeIcon(n.type)}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>{n.title}</div>
                  <div style={{fontSize:13,color:"var(--text2)",marginBottom:6}}>{n.body}</div>
                  <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{n.date} · {n.time}</div>
                </div>
                <button className="btn btn-sm" style={{flexShrink:0}} onClick={()=>del(n.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StudyProgress() {
  const results = useMyData("nv-results", []);
  const tasks = useMyData("nv-tasks", []);
  const skillsDb = useShared("skills", DEFAULT_SKILLS);
  const done = useMyData("nv-skills-done", {});
  const doneTasks=tasks.filter(t=>t.done).length;const doneSkills=skillsDb.filter(s=>done[s.id]).length;
  const avg=results.length>0?Math.round(results.reduce((s,r)=>s+r.pct,0)/results.length):0;
  return<div><div className="sec-title">📈 Study Progress</div><div className="sec-sub">Your academic overview</div><div className="grid3" style={{marginBottom:20}}>{[{lbl:"Avg Score",val:`${avg}%`,sub:`${results.length} results`,color:"var(--accent)"},{lbl:"Tasks Done",val:`${doneTasks}/${tasks.length}`,sub:"Completed",color:"var(--success)"},{lbl:"Skills",val:`${doneSkills}/${skillsDb.length}`,sub:"Competencies",color:"var(--accent2)"}].map(s=><div key={s.lbl} className="stat-card"><div className="stat-lbl">{s.lbl}</div><div className="stat-val" style={{color:s.color,fontSize:24}}>{s.val}</div><div className="stat-sub">{s.sub}</div></div>)}</div>{results.length>0&&<div className="card"><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>Recent Results</div>{results.slice(-5).reverse().map(r=><div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:"1px solid var(--border)"}}><div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{r.subject}</div><div style={{fontSize:11,color:"var(--text3)"}}>{r.type} · {r.date}</div></div><div style={{flex:1,background:"var(--bg4)",borderRadius:20,height:6,overflow:"hidden"}}><div style={{height:"100%",borderRadius:20,width:`${r.pct}%`,background:r.pct>=70?"var(--success)":r.pct>=50?"var(--warn)":"var(--danger)"}} /></div><span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:r.pct>=70?"var(--success)":r.pct>=50?"var(--warn)":"var(--danger)",minWidth:40,textAlign:"right"}}>{r.pct}%</span></div>)}</div>}</div>;
}

// ════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════
export default function App() {
  useEffect(() => { hydrateFromBackend(); }, []);

  const [page, setPage] = useState("auth");
  const [authTab, setAuthTab] = useState("signin");
  const [loginType, setLoginType] = useState("student"); // "student" | "admin"
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [showPw, setShowPw] = useState(false);
  const [regUser, setRegUser] = useState(""); const [regPw, setRegPw] = useState(""); const [regClass, setRegClass] = useState("");
  const [activeNav, setActiveNav] = useState("dashboard"); const [activeTool, setActiveTool] = useState(null);
  const [darkMode, setDarkMode] = useState(true); const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState([]); const [currentUser, setCurrentUser] = useState(""); const [isAdmin, setIsAdmin] = useState(false);
  const [selectedClass, setSelectedClass] = useState(null);
  const [navHistory, setNavHistory] = useState([]);
  const [isLecturer, setIsLecturer] = useState(false);
  const [currentUserClass, setCurrentUserClass] = useState("");
  const [unreadNotifs, setUnreadNotifs] = useState(()=>{
    const notifs = ls("nv-notifications", []);
    return notifs.filter(n => !n.read).length;
  });

  useEffect(() => { document.body.className = darkMode ? "" : "light"; }, [darkMode]);

  const toast = (msg, type="info") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  };

  const [loginLoading, setLoginLoading] = useState(false);

  const login = async () => {
    if (!username || !password) return toast("Fill in all fields", "error");
    setLoginLoading(true);

    // Helper: attempt a backend load but NEVER throw — always fall back gracefully
    const safeLoad = async (fn) => { try { await fn(); } catch(e) { console.warn("safeLoad:", e); } };

    // 1. Fetch user list from backend (required for cross-device login)
    //    Falls back to localStorage if backend is unreachable
    await safeLoad(() => loadShared("users", [{username:"admin@gmail.com",password:"admin123",role:"admin",class:"",joined:"System"}]));
    notifyKey("users");

    const users = ls("nv-users", [{username:"admin@gmail.com",password:"admin123",role:"admin",class:"",joined:"System"}]);
    console.log("Users found:", users.length, "Looking for:", username);
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) { toast("Invalid credentials — check email & password", "error"); setLoginLoading(false); return; }
    if (loginType === "admin" && user.role !== "admin") { toast("Not an admin account", "error"); setLoginLoading(false); return; }

    // 2. Hydrate all other shared content + this user's private data in parallel.
    //    Promise.allSettled means NO single failure can block login.
    const u = username;
    await Promise.allSettled([
      ...Object.keys(SK).filter(k => k !== "users").map(k =>
        safeLoad(() => loadShared(k, [])).then(() => notifyKey(k))
      ),
      safeLoad(() => loadUser(u, "results",       "nv-results",           [])).then(() => notifyUserKey("nv-results")),
      safeLoad(() => loadUser(u, "notifications", "nv-notifications",     [])).then(() => notifyUserKey("nv-notifications")),
      safeLoad(() => loadUser(u, "essay-att",     `nv-essay-att-${u}`,    {})).then(() => notifyUserKey(`nv-essay-att-${u}`)),
      safeLoad(() => loadUser(u, "mcq-att",       `nv-mcq-att-${u}`,      {})).then(() => notifyUserKey(`nv-mcq-att-${u}`)),
      safeLoad(() => loadUser(u, "set-exam-att",  `nv-set-exam-att-${u}`, {})).then(() => notifyUserKey(`nv-set-exam-att-${u}`)),
      safeLoad(() => loadUser(u, "tasks",         "nv-tasks",             [])).then(() => notifyUserKey("nv-tasks")),
      safeLoad(() => loadUser(u, "timetable",     "nv-timetable",         [])).then(() => notifyUserKey("nv-timetable")),
      safeLoad(() => loadUser(u, "gpa-courses",   "nv-gpa-courses",       [])).then(() => notifyUserKey("nv-gpa-courses")),
      safeLoad(() => loadUser(u, "skills-done",   "nv-skills-done",       {})).then(() => notifyUserKey("nv-skills-done")),
      safeLoad(() => loadUser(u, "messages",      "nv-messages",          [])).then(() => notifyUserKey("nv-messages")),
    ]);

    // 3. All done — enter the app regardless of any storage errors above
    window.dispatchEvent(new CustomEvent("nv:user-hydrated"));
    window.dispatchEvent(new CustomEvent("nv:shared-hydrated"));

    setCurrentUserRef(u);
    setCurrentUser(u);
    setIsAdmin(user.role === "admin");
    setIsLecturer(user.role === "lecturer");
    setCurrentUserClass(user.class || "");
    setPage("app");
    const notifs = ls("nv-notifications", []);
    setUnreadNotifs(notifs.filter(n => !n.read).length);
    toast("Welcome back! 👋", "success");
    setLoginLoading(false);
  };

  const register = () => {
    if (!regUser || !regPw) return toast("Fill in all fields", "error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regUser)) return toast("Enter a valid email address", "error");
    const users = ls("nv-users", []);
    if (users.find(u => u.username === regUser)) return toast("Email already registered", "error");
    const newUsers = [...users, { username: regUser, password: regPw, role: "student", class: regClass, joined: new Date().toLocaleDateString() }];
    saveShared("users", newUsers); setCurrentUserRef(regUser); setCurrentUser(regUser); setIsAdmin(false); setPage("app");
    toast(`Welcome! 🎉`, "success");
  };

  const navigate = (section, cls = null) => {
    setNavHistory(h => [...h, { nav: activeNav, tool: activeTool, cls: selectedClass }]);
    setActiveNav(section); setActiveTool(null); if (cls) setSelectedClass(cls); setSidebarOpen(false);
  };
  const navTool = (tool) => {
    setNavHistory(h => [...h, { nav: activeNav, tool: activeTool, cls: selectedClass }]);
    setActiveTool(tool); setActiveNav(null); setSidebarOpen(false);
  };
  const goBack = () => {
    if (navHistory.length === 0) return;
    const prev = navHistory[navHistory.length - 1];
    setNavHistory(h => h.slice(0, -1));
    setActiveNav(prev.nav); setActiveTool(prev.tool); if (prev.cls) setSelectedClass(prev.cls);
  };

  const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

  const classes = ls("nv-classes", DEFAULT_CLASSES);

  const renderContent = () => {
    if (activeNav === "admin") return <AdminPanel toast={toast} currentUser={currentUser} />;
    if (activeTool === "drug-guide") return <DrugGuideView />;
    if (activeTool === "lab-ref") return <LabReferenceView />;
    if (activeTool === "flashcards") return <FlashcardsView />;
    if (activeTool === "med-calc") return <MedCalc />;
    if (activeTool === "study-planner") return <StudyPlanner toast={toast} />;
    if (activeTool === "skills") return <SkillsView />;
    if (activeTool === "dictionary") return <DictionaryView />;
    if (activeTool === "gpa") return <GPACalc toast={toast} />;
    if (activeTool === "progress") return <StudyProgress />;
    switch (activeNav) {
      case "dashboard": return <Dashboard user={currentUser} onNavigate={navigate} />;
      case "timetable": return <Timetable toast={toast} />;
      case "handouts": return <Handouts selectedClass={selectedClass} toast={toast} currentUser={currentUser} isLecturer={isLecturer||isAdmin} />;
      case "results": return <Results toast={toast} />;
      case "questions": return <PastQuestionsView toast={toast} currentUser={currentUser} />;
      case "classexams": return <ClassExamsView toast={toast} currentUser={currentUser} userClass={currentUserClass} />;
      case "lecturer": return <LecturerPage toast={toast} currentUser={currentUser} />;
      case "messages": return <Messages user={currentUser} toast={toast} />;
      case "notifications": return <Notifications currentUser={currentUser} onRead={()=>setUnreadNotifs(0)} />;
      default: return <Dashboard user={currentUser} onNavigate={navigate} />;
    }
  };

  const NAV = [
    { icon:"⊞", label:"Dashboard", key:"dashboard" },
    { icon:"📅", label:"Timetable", key:"timetable" },
    { icon:"📄", label:"All Handouts", key:"handouts" },
    { icon:"📊", label:"Results", key:"results" },
    { icon:"❓", label:"Past Questions", key:"questions" },
    { icon:"📝", label:"Class Exams", key:"classexams" },
    { icon:"🔔", label:"Notifications", key:"notifications" },
    { icon:"💬", label:"Messages", key:"messages" },
  ];
  const TOOLS = [
    { icon:"🧪", label:"Lab Reference", key:"lab-ref" },
    { icon:"💊", label:"Drug Guide", key:"drug-guide" },
    { icon:"🃏", label:"Flashcards", key:"flashcards" },
    { icon:"🧮", label:"Med Calculator", key:"med-calc" },
    { icon:"📅", label:"Study Planner", key:"study-planner" },
    { icon:"✅", label:"Skills Checklist", key:"skills" },
    { icon:"📖", label:"Dictionary", key:"dictionary" },
    { icon:"🎓", label:"GPA Calculator", key:"gpa" },
    { icon:"📈", label:"Study Progress", key:"progress" },
  ];

  if (page === "auth") return (
    <>
      <style>{CSS}</style>
      <div className="auth-page">
        <div className="auth-wrap" style={{width:"100%",maxWidth:440,padding:20,margin:"auto",position:"relative",zIndex:1}}>
          <div className="auth-card">
            <div className="auth-logo">
              <div className="auth-logo-icon">🏥</div>
              <div className="auth-logo-name">Nursing Academic Hub</div>
              <span style={{marginLeft:4,fontSize:20}}>🌙</span>
            </div>
            <div className="auth-sub">// nursing school handouts &amp; resources</div>

            {/* Hidden admin toggle - invisible dot */}
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:4}}>
              <div onClick={()=>setLoginType(t=>t==="admin"?"student":"admin")} style={{width:5,height:5,borderRadius:"50%",background:"rgba(255,255,255,0.06)",cursor:"pointer"}} />
            </div>

            <div className="auth-tabs">
              <div className={`auth-tab${authTab==="signin"?" active":""}`} onClick={()=>setAuthTab("signin")}>Sign In</div>
              <div className={`auth-tab${authTab==="register"?" active":""}`} onClick={()=>setAuthTab("register")}>Create Account</div>
            </div>

            {authTab==="signin" ? (
              <>
                <label className="lbl">Email</label>
                <input className="inp" type="email" placeholder="Enter your email" value={username} onChange={e=>setUsername(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} />
                <label className="lbl">Password</label>
                <div className="inp-wrap">
                  <input className="inp" type={showPw?"text":"password"} placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} />
                  <button className="inp-eye" onClick={()=>setShowPw(p=>!p)}>{showPw?"🙈":"👁"}</button>
                </div>
                <button className={`btn-primary${loginType==="admin"?" btn-admin":""}${loginLoading?" loading":""}`} onClick={login} disabled={loginLoading}>
                  {loginLoading ? "⏳ Signing in..." : loginType==="admin" ? "🛡️ Admin Sign In →" : "Sign In →"}
                </button>
                <div className="auth-switch">No account? <span onClick={()=>setAuthTab("register")}>Register here</span></div>
              </>
            ) : (
              <>
                <label className="lbl">Email</label>
                <input className="inp" type="email" placeholder="Enter your email" value={regUser} onChange={e=>setRegUser(e.target.value)} />
                <label className="lbl">Password</label>
                <input className="inp" type="password" placeholder="Choose password" value={regPw} onChange={e=>setRegPw(e.target.value)} />
                <label className="lbl">Your Class</label>
                <select className="inp" value={regClass} onChange={e=>setRegClass(e.target.value)}>
                  <option value="">Select class...</option>
                  {classes.map(c=><option key={c.id} value={c.id}>{c.label} — {c.desc}</option>)}
                </select>
                <button className="btn-primary" onClick={register}>Create Account →</button>
                <div className="auth-switch">Have account? <span onClick={()=>setAuthTab("signin")}>Sign in</span></div>
              </>
            )}
            <div className="auth-notice"><span>💾</span><span>Essay submissions are stored in a shared backend database. Other data is stored on this device.</span></div>
          </div>
        </div>
      </div>
      <Toasts list={toasts} />
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="app-shell">
        <div className={`sidebar-overlay${sidebarOpen?" open":""}`} onClick={()=>setSidebarOpen(false)} />
        <div className={`sidebar${sidebarOpen?" open":""}`}>
          <div className="sidebar-head">
            <div className="sidebar-logo-icon">🏥</div>
            <div className="sidebar-logo-name">Nursing Academic Hub</div>
            {isAdmin&&<span className="admin-badge-side">🛡️ Admin</span>}
          </div>

          {isAdmin&&(
            <>
              <div className="nav-sec">Admin</div>
              <div className={`nav-item admin-nav${activeNav==="admin"?" active":""}`} onClick={()=>navigate("admin")}>
                <span className="nav-icon">🛡️</span>Admin Panel
              </div>
            </>
          )}

          {isLecturer&&!isAdmin&&(
            <>
              <div className="nav-sec">Lecturer</div>
              <div className={`nav-item${activeNav==="lecturer"?" active":""}`} style={{color:"var(--warn)"}} onClick={()=>navigate("lecturer")}>
                <span className="nav-icon">👨‍🏫</span>Lecturer Portal
              </div>
            </>
          )}

          <div className="nav-sec">Navigation</div>
          {NAV.map(item=>(
            <div key={item.key} className={`nav-item${activeNav===item.key&&!activeTool?" active":""}`} onClick={()=>navigate(item.key)}>
              <span className="nav-icon">{item.icon}</span>{item.label}
              {item.key==="notifications"&&unreadNotifs>0&&<span style={{marginLeft:"auto",background:"var(--danger)",color:"white",borderRadius:"50%",width:18,height:18,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontWeight:700,flexShrink:0}}>{unreadNotifs>9?"9+":unreadNotifs}</span>}
            </div>
          ))}

          <div className="nav-sec" style={{marginTop:6}}>Clinical Tools</div>
          {TOOLS.map(item=>(
            <div key={item.key} className={`nav-item${activeTool===item.key?" active":""}`} onClick={()=>navTool(item.key)}>
              <span className="nav-icon">{item.icon}</span>{item.label}
            </div>
          ))}

          <div className="nav-sec" style={{marginTop:6}}>Classes</div>
          {classes.map(c=>(
            <div key={c.id} className="nav-item" onClick={()=>navigate("handouts",c)}>
              <span className="class-dot" style={{background:c.color}} />{c.label}
            </div>
          ))}

          <div style={{padding:"16px 8px 0"}}>
            <div className="nav-item" style={{color:"var(--danger)"}} onClick={()=>{setPage("auth");setCurrentUser("");setIsAdmin(false);setIsLecturer(false);setNavHistory([]);}}>
              <span className="nav-icon">🚪</span>Sign Out
            </div>
          </div>
        </div>

        <div className="main-area">
          <div className="topbar">
            <div className="topbar-left">
              <button className="hamburger" onClick={()=>setSidebarOpen(o=>!o)}>☰</button>
              {navHistory.length > 0 && (
                <button className="btn btn-sm" style={{padding:"5px 10px",fontSize:13}} onClick={goBack}>← Back</button>
              )}
              <div className="topbar-title">
                {activeNav==="admin" ? "🛡️ Admin Panel" : `${greeting()}, `}
                {activeNav!=="admin"&&<span style={{color:"var(--accent)"}}>{currentUser.split("@")[0]}</span>}
                {activeNav!=="admin"&&" 👋"}
              </div>
              {isAdmin&&activeNav!=="admin"&&<span className="tag tag-purple" style={{fontSize:10}}>🛡️ Admin</span>}
              {isLecturer&&!isAdmin&&<span className="tag" style={{fontSize:10,borderColor:"var(--accent2)",color:"var(--accent2)"}}>👨‍🏫 Lecturer</span>}
            </div>
            <div className="topbar-right">
              <div className="theme-btn" onClick={()=>setDarkMode(d=>!d)}>{darkMode?"☀️ Light":"🌙 Dark"}</div>
              <div className="icon-btn" style={{position:"relative"}} onClick={()=>navigate("notifications")}>
                🔔
                {unreadNotifs > 0 && <span style={{position:"absolute",top:-4,right:-4,background:"var(--danger)",color:"white",borderRadius:"50%",width:16,height:16,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontWeight:700}}>{unreadNotifs>9?"9+":unreadNotifs}</span>}
              </div>
            </div>
          </div>
          <div className="page-content">{renderContent()}</div>
        </div>
      </div>
      <Toasts list={toasts} />
    </>
  );
}
