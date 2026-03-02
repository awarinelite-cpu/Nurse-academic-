import { useState, useEffect, useCallback, useRef } from "react";

// ─── EMAILJS CONFIG ──────────────────────────────────────────────────
// EmailJS free tier: 200 emails/month — sign up at https://www.emailjs.com
// Fill in your own IDs below after creating a free account:
const EMAILJS_PUBLIC_KEY  = "PDEu7sKFo4tLDnn0x";
const EMAILJS_SERVICE_ID  = "service_jqh2a8i";
const EMAILJS_TEMPLATE_ID = "template_60264xt";

// Lazy-loads the EmailJS SDK from CDN (only once)
let _emailjsReady = false;
const loadEmailJS = () => new Promise((resolve, reject) => {
  if (_emailjsReady) { resolve(window.emailjs); return; }
  if (document.getElementById("emailjs-sdk")) {
    // Script already injected — wait for it
    const wait = setInterval(() => {
      if (window.emailjs) { _emailjsReady = true; clearInterval(wait); resolve(window.emailjs); }
    }, 50);
    return;
  }
  const s = document.createElement("script");
  s.id  = "emailjs-sdk";
  s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
  s.onload = () => {
    window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    _emailjsReady = true;
    resolve(window.emailjs);
  };
  s.onerror = reject;
  document.head.appendChild(s);
});

// Sends the password-reset email via EmailJS.
// Your template must have these variables: {{to_email}}, {{reset_code}}, {{app_name}}
const sendResetEmail = async (toEmail, code) => {
  const ejs = await loadEmailJS();
  await ejs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    to_email:   toEmail,
    reset_code: code,
    app_name:   "Nursing Academic Hub",
  });
};

// ─── LOCAL STORAGE HELPERS ───────────────────────────────────────────
const ls    = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ─── FIREBASE FIRESTORE SYNC LAYER ───────────────────────────────────
//
// HOW TO SET UP FIREBASE (5 minutes, completely free):
//
//  1. Go to https://console.firebase.google.com
//  2. Click "Create a project" → name it "NursingHub" → Continue
//  3. Disable Google Analytics (not needed) → Create project
//  4. In the left sidebar click "Firestore Database" → Create database
//     → Start in TEST MODE → choose any region → Enable
//  5. In the left sidebar click the gear icon ⚙️ → Project settings
//  6. Scroll down to "Your apps" → click the </> (Web) icon
//  7. Register app with any nickname → copy the firebaseConfig object
//  8. Paste each value into the FIREBASE_CONFIG below
//  9. Redeploy to Render — sync will work immediately!
//
// IMPORTANT: After testing, go to Firestore → Rules and set:
//   allow read, write: if true;   ← keeps it open (fine for internal school use)

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyD91f4UJKPXZEpfXV_QoggsZq1R_9WcC4s",
  authDomain:        "the-elites-nurses.firebaseapp.com",
  projectId:         "the-elites-nurses",
  storageBucket:     "the-elites-nurses.firebasestorage.app",
  messagingSenderId: "44425476386",
  appId:             "1:44425476386:web:396cd7764e92152ceccd7b",
  measurementId:     "G-0NL42MXWRP",
};

// ── Firebase SDK loader (loaded once from CDN) ──────────────────────
let _db = null;           // Firestore instance
let _fbReady = false;     // true once SDK is loaded & db initialised
let _fbReadyPromise = null;

const _loadFirebase = () => {
  if (_fbReadyPromise) return _fbReadyPromise;
  _fbReadyPromise = new Promise((resolve) => {
    // Check if already configured
    const cfg = FIREBASE_CONFIG;
    if (!cfg.apiKey || !cfg.projectId) {
      console.warn("[Firebase] Not configured — fill in FIREBASE_CONFIG in App.jsx");
      resolve(false); return;
    }
    // Load Firebase SDKs from CDN
    const load = (src) => new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    Promise.all([
      load("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js"),
      load("https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js"),
    ]).then(() => {
      try {
        const app = !window.firebase.apps.length
          ? window.firebase.initializeApp(cfg)
          : window.firebase.app();
        _db = window.firebase.firestore(app);
        _fbReady = true;
        console.log("[Firebase] Connected ✅");
        resolve(true);
      } catch (e) {
        console.error("[Firebase] Init failed:", e.message);
        resolve(false);
      }
    }).catch(e => { console.error("[Firebase] SDK load failed:", e.message); resolve(false); });
  });
  return _fbReadyPromise;
};

// ── Core read/write using a single "shared" document ─────────────────
// All shared app data lives in:   collection("nv") / doc("shared")
// All exam results live in:       collection("nv") / doc("exams")
// All essay subs live in:         collection("nv") / doc("essays")
// Password resets:                collection("nv") / doc("resets")

const _DOC_SHARED = "shared";
const _DOC_EXAMS  = "exams";
const _DOC_ESSAYS = "essays";
const _DOC_RESETS = "resets";

// In-memory cache to reduce Firestore reads
const _cache = {};
const _cacheTime = {};
const CACHE_TTL = 15000; // 15 seconds

const _getDoc = async (docId) => {
  if (_cache[docId] && Date.now() - _cacheTime[docId] < CACHE_TTL) return _cache[docId];
  const ready = await _loadFirebase();
  if (!ready) return null;
  try {
    const snap = await _db.collection("nv").doc(docId).get();
    const data = snap.exists ? snap.data() : {};
    _cache[docId] = data;
    _cacheTime[docId] = Date.now();
    return data;
  } catch (e) { console.warn("[Firebase] getDoc failed:", docId, e.message); return null; }
};

const _setDocField = async (docId, field, val) => {
  const ready = await _loadFirebase();
  if (!ready) return false;
  try {
    await _db.collection("nv").doc(docId).set({ [field]: val }, { merge: true });
    // Update cache
    if (!_cache[docId]) _cache[docId] = {};
    _cache[docId][field] = val;
    _cacheTime[docId] = Date.now();
    return true;
  } catch (e) { console.error("[Firebase] setDocField failed:", docId, field, e.message); return false; }
};

const _setDocFields = async (docId, fields) => {
  const ready = await _loadFirebase();
  if (!ready) return false;
  try {
    await _db.collection("nv").doc(docId).set(fields, { merge: true });
    _cache[docId] = { ...(_cache[docId] || {}), ...fields };
    _cacheTime[docId] = Date.now();
    return true;
  } catch (e) { console.error("[Firebase] setDocFields failed:", docId, e.message); return false; }
};

// ── Shared data read/write ────────────────────────────────────────────
const bsGet = async (key) => {
  const doc = await _getDoc(_DOC_SHARED);
  return doc ? (doc[key] ?? null) : null;
};
const bsSet = async (key, val) => _setDocField(_DOC_SHARED, key, val);

// ── Exam/essay/reset helpers ──────────────────────────────────────────
const examBsGet = async (key) => {
  // Try exams doc first, fallback to shared
  const doc = await _getDoc(_DOC_EXAMS);
  if (doc && doc[key] !== undefined) return doc[key];
  return null;
};
const examBsSet = async (key, val) => _setDocField(_DOC_EXAMS, key, val);

// ── REACTIVE SYNC ─────────────────────────────────────────────────────
const NV_SYNC_EVENT = "nv-sync";
const dispatchSync = () => window.dispatchEvent(new CustomEvent(NV_SYNC_EVENT));

function useSharedData(lsKey, fallback) {
  const [value, setValue] = useState(() => ls(lsKey, fallback));
  useEffect(() => {
    const handler = () => setValue(ls(lsKey, fallback));
    window.addEventListener(NV_SYNC_EVENT, handler);
    handler();
    return () => window.removeEventListener(NV_SYNC_EVENT, handler);
  }, [lsKey]);
  return [value, setValue];
}

// Dual-write: localStorage immediately + Firestore async
const dbSet = async (lsKey, bsKey, val) => {
  lsSet(lsKey, val);
  dispatchSync();
  const ok = await bsSet(bsKey, val);
  if (!ok) console.error("[dbSet] Firestore write failed for", bsKey);
  return ok;
};

const dbLoad = async (lsKey, bsKey, fallback) => {
  try {
    const remote = await bsGet(bsKey);
    if (remote !== null && remote !== undefined) { lsSet(lsKey, remote); return remote; }
  } catch (e) { console.warn("[dbLoad] failed for", bsKey, e.message); }
  return ls(lsKey, fallback);
};

// ── Shared storage key map ────────────────────────────────────────────
const SK = {
  users:         ["nv-users",         "users"],
  classes:       ["nv-classes",       "classes"],
  drugs:         ["nv-drugs",         "drugs"],
  labs:          ["nv-labs",          "labs"],
  pq:            ["nv-pq",            "pq"],
  skills:        ["nv-skillsdb",      "skills"],
  announcements: ["nv-announcements", "announcements"],
  handouts:      ["nv-handouts",      "handouts"],
  essayBanks:    ["nv-essay-banks",   "essayBanks"],
  nursingExams:  ["nv-nursing-exams", "nursingExams"],
  dailyMock:     ["nv-daily-mock",    "dailyMock"],
  ncArchive:     ["nv-nc-archive",    "ncArchive"],
  schoolPQ:      ["nv-school-pq",     "schoolPQ"],
  folders:       ["nv-folders",       "folders"],
  cbtExams:      ["nv-cbt-exams",     "cbtExams"],
  cbtResults:    ["nv-cbt-results",   "cbtResults"],
};

const saveShared = async (key, val) => {
  const [lk, bk] = SK[key];
  return await dbSet(lk, bk, val);
};
const loadShared = async (key, fallback) => {
  const [lk, bk] = SK[key];
  return dbLoad(lk, bk, fallback);
};

// ── Per-user private data (localStorage only) ─────────────────────────
const uKey = (user, suffix) => `u:${user}:${suffix}`;
let _currentUser = "";
const setCurrentUserRef = (u) => { _currentUser = u; };
const saveMyData = (suffix, lsKey, val) => { lsSet(lsKey, val); };
const syncUserPrivateData = async (username) => {};

// ── Essay submissions ─────────────────────────────────────────────────
const saveEssaySubmissionToBackend = async (studentEmail, bankId, data) => {
  const ready = await _loadFirebase(); if (!ready) return;
  try {
    const key   = `sub_${bankId}_${studentEmail.replace(/[@.]/g,"_")}`;
    const idxSnap = await _db.collection("nv").doc(_DOC_ESSAYS).get();
    const idx   = idxSnap.exists ? (idxSnap.data().index || []) : [];
    const entry = { key, student: studentEmail, bankId: String(bankId), date: data.date, graded: !!(data.manualGrade || data.feedback) };
    await _db.collection("nv").doc(_DOC_ESSAYS).set({
      [key]: data,
      index: [...idx.filter(e => e.key !== key), entry]
    }, { merge: true });
    delete _cache[_DOC_ESSAYS];
  } catch (e) { console.warn("[saveEssaySub] failed:", e.message); }
};

const saveManualGradeToBackend = async (studentEmail, bankId, gradeData) => {
  const ready = await _loadFirebase(); if (!ready) return null;
  try {
    const key      = `sub_${bankId}_${studentEmail.replace(/[@.]/g,"_")}`;
    const docSnap  = await _db.collection("nv").doc(_DOC_ESSAYS).get();
    const docData  = docSnap.exists ? docSnap.data() : {};
    const existing = docData[key] || {};
    const updated  = { ...existing, manualGrade: gradeData, gradedDate: new Date().toLocaleDateString(), graded: true };
    const idx      = (docData.index || []).map(e => e.key === key ? { ...e, graded: true } : e);
    await _db.collection("nv").doc(_DOC_ESSAYS).set({ [key]: updated, index: idx }, { merge: true });
    delete _cache[_DOC_ESSAYS];
    // Mirror grade into student local storage
    const attKey = `nv-essay-att-${studentEmail}`;
    const att    = ls(attKey, {});
    att[String(bankId)] = { ...att[String(bankId)], manualGrade: gradeData, gradedDate: new Date().toLocaleDateString() };
    lsSet(attKey, att);
    return updated;
  } catch (e) { console.warn("[saveManualGrade] failed:", e.message); return null; }
};

// ── CBT Exam Firestore helpers ─────────────────────────────────────────
// CBT exams live in: collection("nv") / doc("cbtExams")
// CBT results live in: collection("nv") / doc("cbtResults")
const _DOC_CBT_EXAMS   = "cbtExams";
const _DOC_CBT_RESULTS = "cbtResults";

const cbtExamsGet = async () => {
  const doc = await _getDoc(_DOC_CBT_EXAMS);
  return doc ? (doc.list || []) : [];
};
const cbtExamsSave = async (list) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    await _db.collection("nv").doc(_DOC_CBT_EXAMS).set({ list }, { merge: false });
    if (!_cache[_DOC_CBT_EXAMS]) _cache[_DOC_CBT_EXAMS] = {};
    _cache[_DOC_CBT_EXAMS].list = list;
    _cacheTime[_DOC_CBT_EXAMS] = Date.now();
    return true;
  } catch(e){ console.error("[CBT] save exams failed:", e.message); return false; }
};

const cbtResultsGet = async () => {
  const doc = await _getDoc(_DOC_CBT_RESULTS);
  return doc ? (doc.list || []) : [];
};
const cbtResultsSave = async (list) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    await _db.collection("nv").doc(_DOC_CBT_RESULTS).set({ list }, { merge: false });
    if (!_cache[_DOC_CBT_RESULTS]) _cache[_DOC_CBT_RESULTS] = {};
    _cache[_DOC_CBT_RESULTS].list = list;
    _cacheTime[_DOC_CBT_RESULTS] = Date.now();
    return true;
  } catch(e){ console.error("[CBT] save results failed:", e.message); return false; }
};

// Subscribe to CBT exams in real-time (5s polling fallback for compatibility)
const subscribeCbtExams = (cb) => {
  let cancelled = false;
  const poll = async () => {
    if (cancelled) return;
    delete _cache[_DOC_CBT_EXAMS];
    const list = await cbtExamsGet();
    if (!cancelled) cb(list);
    setTimeout(() => { if (!cancelled) poll(); }, 6000);
  };
  poll();
  return () => { cancelled = true; };
};

const subscribeCbtResults = (cb) => {
  let cancelled = false;
  const poll = async () => {
    if (cancelled) return;
    delete _cache[_DOC_CBT_RESULTS];
    const list = await cbtResultsGet();
    if (!cancelled) cb(list);
    setTimeout(() => { if (!cancelled) poll(); }, 6000);
  };
  poll();
  return () => { cancelled = true; };
};


// ── CBT Violations (malpractice flags) ───────────────────────────────
const _DOC_CBT_VIOLATIONS = "cbtViolations";
const _DOC_CBT_DEVICES    = "cbtDevices";   // { examId_student: { ip, fingerprint, ua, student, examId, ts } }

const cbtViolationsSave = async (list) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  // Strip large snapshot data before Firestore (keep only metadata + small thumb flag)
  const slim = list.map(v => {
    if (v.snapshot) return { ...v, snapshot: v.snapshot.slice(0,100)+"[img]", hasSnapshot:true };
    return v;
  });
  try {
    await _db.collection("nv").doc(_DOC_CBT_VIOLATIONS).set({ list: slim }, { merge: false });
    if (!_cache[_DOC_CBT_VIOLATIONS]) _cache[_DOC_CBT_VIOLATIONS] = {};
    _cache[_DOC_CBT_VIOLATIONS].list = slim;
    _cacheTime[_DOC_CBT_VIOLATIONS] = Date.now();
    return true;
  } catch(e){ return false; }
};

// Device registry helpers
const cbtDevicesGet = async () => {
  const doc = await _getDoc(_DOC_CBT_DEVICES);
  return doc ? (doc.map || {}) : {};
};
const cbtDevicesSave = async (map) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    await _db.collection("nv").doc(_DOC_CBT_DEVICES).set({ map }, { merge: false });
    return true;
  } catch(e){ return false; }
};

const cbtViolationsGet = async () => {
  const doc = await _getDoc(_DOC_CBT_VIOLATIONS);
  return doc ? (doc.list || []) : [];
};

const subscribeCbtViolations = (cb) => {
  let cancelled = false;
  const poll = async () => {
    if (cancelled) return;
    delete _cache[_DOC_CBT_VIOLATIONS];
    const list = await cbtViolationsGet();
    if (!cancelled) cb(list);
    setTimeout(() => { if (!cancelled) poll(); }, 6000);
  };
  poll();
  return () => { cancelled = true; };
};

let _storageHealthy = null;
const checkStorageHealth = async () => {
  const cfg = FIREBASE_CONFIG;
  if (!cfg.apiKey || !cfg.projectId) {
    _storageHealthy = false;
    console.warn("[Sync] Firebase not configured yet");
    return false;
  }
  try {
    const ready = await _loadFirebase();
    _storageHealthy = ready;
    console.log(ready ? "[Sync] Firebase health check PASSED ✅" : "[Sync] Firebase health check FAILED");
    return ready;
  } catch (e) {
    _storageHealthy = false;
    console.error("[Sync] Firebase health check FAILED:", e.message);
    return false;
  }
};

// ── Hydrate from Firestore ────────────────────────────────────────────
// Fetches the entire "shared" document in ONE read, hydrates all
// localStorage keys, then fires the reactive sync event.
const hydrateFromBackend = async () => {
  const cfg = FIREBASE_CONFIG;
  if (!cfg.apiKey || !cfg.projectId) return;
  try {
    const doc = await _getDoc(_DOC_SHARED);
    if (!doc) return;
    const defaults = {
      users:         [{username:"admin@gmail.com",password:"admin123",role:"admin",class:"",joined:"System"}],
      classes:       DEFAULT_CLASSES, drugs: DEFAULT_DRUGS, labs: DEFAULT_LABS,
      pq:            DEFAULT_PQ,      skills: DEFAULT_SKILLS, announcements: DEFAULT_ANNOUNCEMENTS,
      handouts:      [],  essayBanks: [], nursingExams: {general:[],midwifery:[],publichealth:[]},
      schoolPQ:      {},  folders:    {}, schoolExams:  [],
    };
    Object.entries(SK).forEach(([key, [lsKey, bk]]) => {
      const remote = doc[bk];
      if (remote !== undefined && remote !== null) lsSet(lsKey, remote);
      else if (!localStorage.getItem(lsKey)) lsSet(lsKey, defaults[key] || []);
    });
    dispatchSync();
    console.log("[Sync] Hydrated from Firestore ✅");
  } catch (e) { console.warn("[Sync] Hydration failed:", e.message); }
};

// ─── DEFAULT DATA ───────────────────────────────────────────────────
const DEFAULT_CLASSES = [
  { id:"nd1",   label:"ND ONE",       desc:"National Diploma Year One",             courses:["Anatomy & Physiology","Community Health","Pharmacology","Nursing Fundamentals"], color:"#3E8E95" },
  { id:"nd2",   label:"ND TWO",       desc:"National Diploma Year Two",             courses:["Medical-Surgical Nursing","Maternal Health","Paediatrics","Mental Health"], color:"#3E8E95" },
  { id:"hnd1",  label:"HND ONE",      desc:"Higher National Diploma Year One",      courses:["Advanced Pharmacology","Research Methods","Epidemiology","Clinical Practicum"], color:"#5aada0" },
  { id:"hnd2",  label:"HND TWO",      desc:"Higher National Diploma Year Two",      courses:["Health Policy","Nursing Leadership","Evidence-Based Practice","Thesis"], color:"#5aada0" },
  { id:"cn1",   label:"CN YEAR 1",    desc:"Community Nursing Year One",            courses:["Community Assessment","Health Promotion","Family Nursing","Biostatistics","Environmental Health"], color:"#facc15" },
  { id:"cn2",   label:"CN YEAR 2",    desc:"Community Nursing Year Two",            courses:["Occupational Health","School Health","Geriatric Care","Disaster Nursing","Practicum"], color:"#facc15" },
  { id:"bnsc1", label:"BNSc 1",       desc:"Bachelor of Nursing Science Year One",  courses:["Human Anatomy","Physiology","Biochemistry","Sociology","Nursing Theory"], color:"#a78bfa" },
  { id:"bnsc2", label:"BNSc 2",       desc:"Bachelor of Nursing Science Year Two",  courses:["Pathophysiology","Pharmacology","Med-Surg Nursing","Nutrition","Psychology"], color:"#a78bfa" },
  { id:"bnsc3", label:"BNSc 3",       desc:"Bachelor of Nursing Science Year Three",courses:["Maternal-Child Nursing","Psychiatric Nursing","Critical Care","Research I","Practicum"], color:"#f472b6" },
  { id:"bnsc4", label:"BNSc 4",       desc:"Bachelor of Nursing Science Year Four", courses:["Advanced Practice","Health Systems","Leadership","Research II","Elective"], color:"#f472b6" },
  { id:"bnscf", label:"BNSc FINAL",   desc:"Bachelor of Nursing Science Final Year",courses:["Capstone Project","Clinical Leadership","Health Policy","Advanced Practicum","Dissertation"], color:"#fb923c" },
];
const DEFAULT_DRUGS = [
  { id:1, name:"Paracetamol",    class:"Analgesic/Antipyretic",     dose:"500-1000mg every 4-6h",   max:"4g/day",       uses:"Pain, fever",                         contraindications:"Liver disease",                   side_effects:"Rare at therapeutic doses; overdose causes hepatotoxicity" },
  { id:2, name:"Amoxicillin",    class:"Penicillin Antibiotic",     dose:"250-500mg every 8h",      max:"3g/day",       uses:"Bacterial infections",                contraindications:"Penicillin allergy",              side_effects:"Rash, diarrhea, nausea" },
  { id:3, name:"Metronidazole",  class:"Antiprotozoal/Antibiotic",  dose:"400-500mg every 8h",      max:"4g/day",       uses:"Anaerobic infections, H.pylori",       contraindications:"1st trimester pregnancy",         side_effects:"Metallic taste, nausea, disulfiram-like reaction with alcohol" },
  { id:4, name:"Ibuprofen",      class:"NSAID",                     dose:"400-600mg every 6-8h",    max:"2400mg/day",   uses:"Pain, inflammation, fever",            contraindications:"Peptic ulcer, renal impairment",  side_effects:"GI irritation, renal impairment, CVS risk" },
  { id:5, name:"Omeprazole",     class:"Proton Pump Inhibitor",     dose:"20-40mg once daily",      max:"80mg/day",     uses:"GERD, peptic ulcer",                  contraindications:"Hypersensitivity",                side_effects:"Headache, diarrhea, hypomagnesemia" },
];
const DEFAULT_LABS = [
  { id:1, test:"Haemoglobin (Hb)",    male:"13.5-17.5 g/dL",       female:"12.0-15.5 g/dL",       notes:"Low = anaemia; High = polycythaemia" },
  { id:2, test:"WBC Count",           male:"4.5-11.0 x10^3/uL",    female:"4.5-11.0 x10^3/uL",   notes:"High = infection/inflammation; Low = immunosuppression" },
  { id:3, test:"Platelets",           male:"150-400 x10^3/uL",     female:"150-400 x10^3/uL",    notes:"Low = bleeding risk; High = thrombosis risk" },
  { id:4, test:"Random Blood Sugar",  male:"<11.1 mmol/L",          female:"<11.1 mmol/L",         notes:">= 11.1 mmol/L suggests diabetes" },
  { id:5, test:"Fasting Blood Sugar", male:"3.9-5.5 mmol/L",        female:"3.9-5.5 mmol/L",       notes:"5.6-6.9 = prediabetes; >= 7.0 = diabetes" },
];
const DEFAULT_PQ = [
  { id:1, subject:"Anatomy & Physiology", year:"2023", questions:[
    { q:"Which part of the brain controls balance and coordination?", options:["Cerebrum","Cerebellum","Medulla Oblongata","Thalamus"], ans:1 },
    { q:"The normal adult heart rate is:", options:["40-60 bpm","60-100 bpm","100-120 bpm","120-140 bpm"], ans:1 },
  ]},
  { id:2, subject:"Pharmacology", year:"2023", questions:[
    { q:"The antidote for paracetamol overdose is:", options:["Naloxone","Flumazenil","N-Acetylcysteine","Atropine"], ans:2 },
  ]},
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
const initData = () => {
  if (!localStorage.getItem("nv-classes"))       lsSet("nv-classes",       DEFAULT_CLASSES);
  if (!localStorage.getItem("nv-drugs"))         lsSet("nv-drugs",         DEFAULT_DRUGS);
  if (!localStorage.getItem("nv-labs"))          lsSet("nv-labs",          DEFAULT_LABS);
  if (!localStorage.getItem("nv-pq"))            lsSet("nv-pq",            DEFAULT_PQ);
  if (!localStorage.getItem("nv-skillsdb"))      lsSet("nv-skillsdb",      DEFAULT_SKILLS);
  if (!localStorage.getItem("nv-announcements")) lsSet("nv-announcements", DEFAULT_ANNOUNCEMENTS);
  if (!localStorage.getItem("nv-users"))         lsSet("nv-users",         [{username:"admin@gmail.com",password:"admin123",role:"admin",class:"",joined:"System"}]);
};

// ─── STYLES ─────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}

/* ── LIGHT MODE (default: sky-blue/white) ── */
:root{
  --bg:#e8f4fc;--bg2:#d6ecf8;--bg3:#c4e4f4;--bg4:#f0f8ff;
  --card:#ffffff;--card2:#eaf4fb;
  --accent:#0077b6;--accent2:#0096c7;--accent3:#48cae4;
  --warn:#fb923c;--danger:#ef4444;--success:#22c55e;--purple:#7c3aed;
  --border:rgba(0,119,182,0.18);--border2:rgba(0,119,182,0.35);
  --text:#000000;--text2:#1a3a4a;--text3:#4a7a94;
  --radius:14px;--radius2:10px;
  --admin:#7c3aed;--admin2:#6d28d9;
  --sidebar-bg:rgba(0,100,160,0.92);
  --topbar-bg:rgba(220,240,255,0.90);
  --body-bg:linear-gradient(160deg,#e8f4fc 0%,#f0f8ff 60%,#cce8f4 100%);
}

/* ── DARK MODE ── */
body.dark{
  --bg:#0d1b2a;--bg2:#102030;--bg3:#0a1520;--bg4:#071018;
  --card:#132035;--card2:#1a2d45;
  --accent:#48cae4;--accent2:#00b4d8;--accent3:#90e0ef;
  --border:rgba(72,202,228,0.14);--border2:rgba(72,202,228,0.28);
  --text:#e8f4fc;--text2:#90cfe0;--text3:#4a7a94;
  --sidebar-bg:rgba(7,16,24,0.95);
  --topbar-bg:rgba(10,21,32,0.92);
  --body-bg:linear-gradient(160deg,#0d1b2a 0%,#102030 60%,#071018 100%);
}

/* ── DIM BLUE MODE ── */
body.dim{
  --bg:#1a2d45;--bg2:#1e3554;--bg3:#152438;--bg4:#112030;
  --card:#1e3554;--card2:#253f65;
  --accent:#90e0ef;--accent2:#48cae4;--accent3:#caf0f8;
  --border:rgba(144,224,239,0.15);--border2:rgba(144,224,239,0.28);
  --text:#cce8f8;--text2:#90cfe0;--text3:#5590b0;
  --sidebar-bg:rgba(15,28,48,0.96);
  --topbar-bg:rgba(20,36,58,0.94);
  --body-bg:linear-gradient(160deg,#1a2d45 0%,#1e3554 60%,#102030 100%);
}

body{
  font-family:'Times New Roman',Times,serif;
  font-weight:700;
  background:var(--body-bg) fixed;
  min-height:100vh;
  overflow-x:hidden;
  color:var(--text);
}

/* Override mono and Syne for headings/labels to also use TNR */
.auth-logo-name,.topbar-title,.sec-title,.stat-val,.sidebar-logo-name{font-family:'Times New Roman',Times,serif!important;font-weight:800;}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.lbl,.nav-sec,.auth-sub,.stat-lbl,.stat-sub,.auth-notice,.auth-switch,.auth-tab,.theme-btn,.admin-badge-side{font-family:'Times New Roman',Times,serif!important;}
.inp,.btn-primary,.nav-item,.card,.card2{font-family:'Times New Roman',Times,serif!important;}

::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-thumb{background:var(--accent2);border-radius:10px;}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
@keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
@keyframes slideIn{from{transform:translateX(110%);opacity:0;}to{transform:translateX(0);opacity:1;}}
@keyframes spin{to{transform:rotate(360deg);}}

/* ── AUTH PAGE ── */
.auth-page{
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:20px;
  position:relative;
  overflow:hidden;
}
.auth-bg-img{
  position:absolute;inset:0;
  background-image:url('https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1400&q=80');
  background-size:cover;
  background-position:center 30%;
  z-index:0;
}
.auth-bg-img::after{
  content:'';
  position:absolute;inset:0;
  background:linear-gradient(135deg,rgba(0,100,160,0.72) 0%,rgba(0,50,100,0.55) 100%);
}
.auth-wrap{position:relative;z-index:1;width:100%;max-width:460px;margin:auto;}
.auth-card{
  background:rgba(255,255,255,0.93);
  backdrop-filter:blur(20px);
  border:2px solid rgba(0,119,182,0.25);
  border-radius:22px;
  padding:38px 34px;
  width:100%;
  animation:fadeUp .5s ease;
  box-shadow:0 40px 80px rgba(0,50,100,.35);
}
body.dark .auth-card{background:rgba(13,27,42,0.95);border-color:rgba(72,202,228,0.3);}
body.dim .auth-card{background:rgba(20,40,70,0.95);border-color:rgba(144,224,239,0.25);}
.auth-logo{display:flex;align-items:center;gap:10px;margin-bottom:5px;}
.auth-logo-icon{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 4px 12px rgba(0,119,182,0.3);}
.auth-logo-name{font-size:22px;font-weight:800;color:var(--accent);}
.auth-sub{font-size:12px;color:var(--text3);margin-bottom:26px;font-style:italic;}
.auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:20px;}
.auth-tab{padding:9px;text-align:center;border-radius:9px;border:1px solid var(--border);font-size:13px;cursor:pointer;color:var(--text3);background:transparent;transition:all .2s;font-weight:700;}
.auth-tab.active{background:rgba(0,119,182,0.12);border-color:var(--accent);color:var(--accent);}
.admin-tab-hint{text-align:center;margin-bottom:14px;font-size:12px;color:var(--admin);background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.2);border-radius:8px;padding:6px;font-weight:700;}
.lbl{font-size:11px;color:var(--text3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px;display:block;font-weight:800;}
.inp{width:100%;background:var(--bg4);border:2px solid var(--border);border-radius:9px;padding:11px 14px;color:var(--text);font-size:14px;font-weight:700;outline:none;transition:border-color .2s;margin-bottom:13px;}
.inp:focus{border-color:var(--accent);}
.inp-wrap{position:relative;margin-bottom:13px;}
.inp-wrap .inp{margin-bottom:0;}
.inp-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text3);cursor:pointer;font-size:15px;}
.btn-primary{width:100%;padding:13px;background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;border-radius:10px;font-size:15px;font-weight:800;color:white;cursor:pointer;transition:all .2s;margin-top:4px;letter-spacing:.03em;}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(0,119,182,.35);}
.btn-admin{background:linear-gradient(135deg,var(--admin),var(--admin2));}
.btn-admin:hover{box-shadow:0 8px 24px rgba(124,58,237,.3);}
.auth-switch{text-align:center;margin-top:12px;font-size:13px;color:var(--text3);font-weight:700;}
.auth-switch span{color:var(--accent);cursor:pointer;text-decoration:underline;}
.auth-notice{background:rgba(0,150,199,.07);border:1px solid rgba(0,150,199,.22);border-radius:10px;padding:10px 14px;font-size:12px;color:var(--accent2);margin-top:16px;line-height:1.6;display:flex;gap:8px;font-weight:700;}

/* ── SHELL ── */
.app-shell{display:flex;height:100vh;overflow:hidden;}
.sidebar{width:240px;min-width:240px;background:var(--sidebar-bg);backdrop-filter:blur(14px);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;padding:0 0 20px;z-index:10;transition:transform .3s;}
.sidebar-head{padding:16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:9px;}
.sidebar-logo-icon{width:36px;height:36px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:18px;}
.sidebar-logo-name{font-size:17px;font-weight:800;color:var(--accent3);}
body.light .sidebar-logo-name{color:#ffffff;}
.admin-badge-side{display:inline-flex;align-items:center;gap:4px;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);border-radius:20px;padding:2px 8px;font-size:10px;color:var(--purple);margin-left:auto;font-weight:800;}
.nav-sec{padding:12px 16px 3px;font-size:9px;color:rgba(200,230,255,0.5);letter-spacing:1.5px;text-transform:uppercase;font-weight:800;}
body.light .nav-sec{color:rgba(255,255,255,0.6);}
.nav-item{display:flex;align-items:center;gap:9px;padding:9px 16px;margin:1px 8px;border-radius:9px;cursor:pointer;font-size:13px;color:rgba(200,230,255,0.85);transition:all .15s;user-select:none;font-weight:700;}
body.light .nav-item{color:rgba(255,255,255,0.9);}
.nav-item:hover{background:rgba(72,202,228,.15);color:#ffffff;}
.nav-item.active{background:rgba(72,202,228,.22);color:#ffffff;}
body.light .nav-item.active{background:rgba(255,255,255,.22);color:#ffffff;}
.nav-item.admin-nav{color:rgba(167,139,250,0.9);}
.nav-item.admin-nav:hover{background:rgba(124,58,237,.1);}
.nav-item.admin-nav.active{background:rgba(124,58,237,.2);color:var(--purple);}
.nav-icon{font-size:15px;width:20px;text-align:center;flex-shrink:0;}
.class-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.nav-item .nav-icon{pointer-events:none;}
.main-area{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.topbar{padding:13px 22px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);background:var(--topbar-bg);backdrop-filter:blur(10px);flex-shrink:0;gap:10px;}
.topbar-left{display:flex;align-items:center;gap:10px;}
.topbar-title{font-size:16px;font-weight:800;color:var(--text);}
.topbar-right{display:flex;align-items:center;gap:8px;}
.theme-btn{background:rgba(0,119,182,.1);border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:11px;color:var(--text2);cursor:pointer;transition:all .2s;font-weight:800;}
.theme-btn:hover{border-color:var(--accent);color:var(--accent);}
.icon-btn{width:34px;height:34px;border-radius:50%;background:rgba(0,119,182,.1);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;transition:all .2s;}
.icon-btn:hover{border-color:var(--accent);}
.page-content{flex:1;overflow-y:auto;padding:22px 24px;}
.hamburger{display:none;background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9;}

/* ── CARDS / COMMON ── */
.card{background:var(--card);backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:var(--radius);padding:18px;color:var(--text);}
.card2{background:var(--card2);backdrop-filter:blur(6px);border:1px solid var(--border);border-radius:var(--radius2);padding:14px;}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;}
.stat-card{background:var(--card);backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:var(--radius);padding:16px;animation:fadeUp .4s ease both;}
.stat-lbl{font-size:9px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin-bottom:5px;font-weight:800;}
.stat-val{font-size:28px;font-weight:800;color:var(--accent);}
.stat-sub{font-size:11px;color:var(--text3);margin-top:3px;font-weight:700;}
.sec-title{font-size:18px;font-weight:800;margin-bottom:4px;color:var(--text);}
.sec-sub{font-size:12px;color:var(--text3);margin-bottom:16px;font-weight:700;}
.search-wrap{position:relative;margin-bottom:18px;}
.search-wrap input{width:100%;background:var(--card);border:2px solid var(--border);border-radius:10px;padding:10px 14px 10px 36px;color:var(--text);font-size:14px;font-family:'Times New Roman',Times,serif;font-weight:700;outline:none;transition:border-color .2s;}
.search-wrap input:focus{border-color:var(--accent);}
.search-ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text3);font-size:14px;}
.class-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;cursor:pointer;transition:all .2s;animation:fadeUp .4s ease both;position:relative;overflow:hidden;}
.class-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--cc);}
.class-card:hover{border-color:var(--cc);transform:translateY(-2px);}
.class-tag{display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;margin-bottom:8px;color:var(--cc);background:rgba(0,119,182,.1);}
.class-name{font-size:16px;font-weight:800;margin-bottom:4px;color:var(--text);}
.class-desc{font-size:12px;color:var(--text3);margin-bottom:10px;line-height:1.5;font-weight:700;}
.class-meta{display:flex;gap:14px;font-size:11px;color:var(--text3);font-weight:700;}

/* BUTTONS */
.btn{padding:8px 16px;border-radius:9px;border:1px solid var(--border);font-family:'Times New Roman',Times,serif;font-size:13px;cursor:pointer;transition:all .2s;background:transparent;color:var(--text2);font-weight:700;}
.btn:hover{border-color:var(--border2);color:var(--text);}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.btn-accent{background:var(--accent);border-color:var(--accent);color:white;font-weight:700;}
.btn-accent:hover{background:var(--accent2);border-color:var(--accent2);}
.btn-sm{padding:5px 11px;font-size:12px;border-radius:7px;}
.btn-danger{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.3);color:var(--danger);}
.btn-danger:hover{background:rgba(239,68,68,.2);}
.btn-purple{background:var(--admin);border-color:var(--admin);color:white;font-weight:700;}
.btn-purple:hover{background:var(--admin2);}
.btn-success{background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.3);color:var(--success);font-weight:700;}
.btn-warn{background:rgba(251,146,60,.12);border-color:rgba(251,146,60,.3);color:var(--warn);}

/* MODAL */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px;animation:fadeIn .2s;}
.modal{background:var(--card);backdrop-filter:blur(16px);border:1px solid var(--border2);border-radius:18px;padding:26px;width:100%;max-width:540px;max-height:88vh;overflow-y:auto;animation:fadeUp .3s ease;color:var(--text);}
.modal.lg{max-width:720px;}
.modal.xl{max-width:900px;}
.modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;}
.modal-title{font-size:17px;font-weight:800;color:var(--text);}
.modal-close{background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer;padding:2px 8px;border-radius:6px;transition:all .2s;}
.modal-close:hover{background:rgba(0,0,0,.08);color:var(--text);}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}

/* TABLES */
.tbl{width:100%;border-collapse:collapse;}
.tbl th{padding:10px 12px;text-align:left;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--border);font-weight:800;}
.tbl td{padding:11px 12px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:middle;font-weight:700;color:var(--text);}
.tbl tbody tr:hover{background:rgba(0,119,182,.05);}
.tbl tbody tr:last-child td{border-bottom:none;}
.tbl-actions{display:flex;gap:6px;align-items:center;}
.bulk-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);border-radius:10px;margin-bottom:12px;animation:fadeUp .2s ease;}
.bulk-bar-count{font-size:13px;font-weight:800;color:var(--danger);flex:1;}
.cb-row{width:16px;height:16px;accent-color:var(--danger);cursor:pointer;flex-shrink:0;}
.cb-all{width:16px;height:16px;accent-color:var(--accent);cursor:pointer;}

/* TAGS */
.tag{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;border:1px solid var(--border);font-weight:800;}
.tag-accent{background:rgba(0,119,182,.12);border-color:var(--accent);color:var(--accent);}
.tag-success{background:rgba(34,197,94,.1);border-color:var(--success);color:var(--success);}
.tag-warn{background:rgba(251,146,60,.1);border-color:var(--warn);color:var(--warn);}
.tag-danger{background:rgba(239,68,68,.1);border-color:var(--danger);color:var(--danger);}
.tag-purple{background:rgba(124,58,237,.1);border-color:var(--purple);color:var(--purple);}

/* TOAST */
.toast-wrap{position:fixed;bottom:22px;right:22px;display:flex;flex-direction:column;gap:8px;z-index:9999;}
.toast{background:var(--card);border:1px solid var(--border2);border-radius:10px;padding:11px 15px;font-size:13px;font-family:'Times New Roman',Times,serif;font-weight:700;animation:slideIn .3s ease;box-shadow:0 8px 24px rgba(0,0,0,.2);display:flex;align-items:center;gap:8px;min-width:220px;color:var(--text);}
.toast.success{border-left:3px solid var(--success);}
.toast.error{border-left:3px solid var(--danger);}
.toast.info{border-left:3px solid var(--accent);}
.toast.warn{border-left:3px solid var(--warn);}

/* ADMIN SPECIFIC */
.admin-header{background:linear-gradient(135deg,rgba(124,58,237,.12),rgba(109,40,217,.06));border:1px solid rgba(124,58,237,.22);border-radius:14px;padding:20px 22px;margin-bottom:22px;display:flex;align-items:center;gap:14px;}
.admin-header-icon{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,var(--admin),var(--admin2));display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;}
.admin-header-title{font-size:20px;font-weight:800;color:var(--text);}
.admin-header-sub{font-size:12px;color:var(--text3);margin-top:2px;font-weight:700;}
.admin-tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;}
.admin-tab{padding:7px 14px;border-radius:8px;border:1px solid var(--border);font-size:12px;cursor:pointer;color:var(--text3);background:transparent;transition:all .2s;font-weight:700;}
.admin-tab:hover{border-color:rgba(124,58,237,.4);color:var(--purple);}
.admin-tab.active{background:rgba(124,58,237,.15);border-color:var(--admin);color:var(--purple);}
.paste-box{width:100%;background:var(--bg4);border:1px dashed var(--border2);border-radius:9px;padding:12px 14px;color:var(--text);font-size:13px;font-family:'Times New Roman',Times,serif;font-weight:700;outline:none;resize:vertical;min-height:90px;margin-bottom:10px;line-height:1.6;}
.paste-box:focus{border-color:var(--accent);}
.parse-preview{background:var(--bg4);border:1px solid var(--border);border-radius:9px;padding:12px;margin-bottom:12px;max-height:200px;overflow-y:auto;}
.parse-item{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;font-weight:700;}
.parse-item:last-child{border-bottom:none;}
.parse-check{color:var(--success);font-size:14px;}
.section-divider{border:none;border-top:1px solid var(--border);margin:18px 0;}
.user-row{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg4);border-radius:10px;margin-bottom:8px;}
.user-av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:white;flex-shrink:0;}
.progress-wrap{background:var(--bg4);border-radius:20px;height:6px;overflow:hidden;}
.progress-fill{height:100%;border-radius:20px;transition:width .5s;}

/* TT */
.tt-badge{display:inline-block;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:700;}
.fc-lbl{font-size:9px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;}
.fc-text{font-size:17px;font-weight:800;line-height:1.4;color:var(--text);}

/* QUIZ */
.quiz-opt{padding:11px 15px;border:1px solid var(--border);border-radius:10px;cursor:pointer;margin-bottom:7px;transition:all .2s;font-size:14px;font-weight:700;color:var(--text);}
.quiz-opt:hover:not(.answered){border-color:var(--accent2);background:rgba(0,119,182,.05);}
.quiz-opt.correct{border-color:var(--success);background:rgba(34,197,94,.1);color:var(--success);}
.quiz-opt.wrong{border-color:var(--danger);background:rgba(239,68,68,.1);color:var(--danger);}
.quiz-opt.reveal{border-color:var(--success);background:rgba(34,197,94,.06);}

/* GPA */
.gpa-bar-wrap{background:var(--bg4);border-radius:20px;height:8px;margin:12px 0;overflow:hidden;}
.gpa-bar{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:20px;transition:width .6s ease;}
.course-row{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg4);border-radius:10px;margin-bottom:8px;}

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
@media(max-width:600px){
  .grid5,.grid4{grid-template-columns:repeat(2,1fr);}
  .grid3,.grid2{grid-template-columns:1fr;}
  .page-content{padding:14px;}
  .topbar{padding:11px 14px;}
  .form-row{grid-template-columns:1fr;}
}

/* ══ NURSING COUNCIL SITE THEME ══ */
.nc-shell{display:flex;height:100vh;overflow:hidden;background:#faf8f3;}
.nc-sidebar{
  width:240px;min-width:240px;
  background:linear-gradient(180deg,#2d4a1e 0%,#3a5f25 40%,#2d4a1e 100%);
  backdrop-filter:blur(14px);border-right:3px solid #4a7a2e;
  display:flex;flex-direction:column;overflow-y:auto;padding:0 0 20px;z-index:10;transition:transform .3s;
}
.nc-sidebar-head{padding:16px;border-bottom:2px solid #4a7a2e;display:flex;align-items:center;gap:9px;}
.nc-sidebar-logo-icon{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#5a9e35,#3d7a22);display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 3px 8px rgba(0,0,0,.3);}
.nc-sidebar-logo-name{font-size:15px;font-weight:800;color:#c8e6a0;font-family:'Times New Roman',serif;}
.nc-nav-sec{padding:12px 16px 3px;font-size:9px;color:rgba(200,230,150,0.55);letter-spacing:1.5px;text-transform:uppercase;font-weight:800;font-family:'Times New Roman',serif;}
.nc-nav-item{display:flex;align-items:center;gap:9px;padding:9px 16px;margin:1px 8px;border-radius:9px;cursor:pointer;font-size:13px;color:rgba(200,230,150,0.85);transition:all .15s;user-select:none;font-weight:700;font-family:'Times New Roman',serif;}
.nc-nav-item:hover{background:rgba(100,180,50,.2);color:#d4f0a0;}
.nc-nav-item.active{background:rgba(90,158,53,.3);color:#c8e6a0;border-left:3px solid #7bc950;}
.nc-main-area{flex:1;display:flex;flex-direction:column;overflow:hidden;background:#faf8f3;}
.nc-topbar{
  padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;
  background:rgba(255,253,248,0.96);border-bottom:2px solid #d4c9a8;
  backdrop-filter:blur(10px);flex-shrink:0;
}
.nc-page-content{flex:1;overflow-y:auto;padding:24px;background:#faf8f3;}
.nc-card{background:#ffffff;border:1.5px solid #d4c9a8;border-radius:14px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.05);}
.nc-card2{background:#f5f0e8;border:1px solid #d4c9a8;border-radius:10px;padding:14px;}
.nc-sec-title{font-size:20px;font-weight:800;color:#2d4a1e;margin-bottom:4px;font-family:'Times New Roman',serif;}
.nc-sec-sub{font-size:12px;color:#6b8a52;margin-bottom:20px;}
.nc-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(90,158,53,.12);border:1.5px solid #5a9e35;border-radius:20px;padding:3px 10px;font-size:11px;color:#2d4a1e;font-weight:800;}
.nc-toggle-btn{
  display:inline-flex;align-items:center;gap:8px;padding:8px 18px;
  background:linear-gradient(135deg,#2d4a1e,#4a7a2e);border:none;border-radius:25px;
  color:#c8e6a0;font-weight:800;font-size:13px;cursor:pointer;transition:all .2s;
  font-family:'Times New Roman',serif;box-shadow:0 3px 10px rgba(45,74,30,.3);
}
.nc-toggle-btn:hover{transform:translateY(-1px);box-shadow:0 5px 15px rgba(45,74,30,.4);}
.school-toggle-btn{
  display:inline-flex;align-items:center;gap:8px;padding:8px 18px;
  background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;border-radius:25px;
  color:white;font-weight:800;font-size:13px;cursor:pointer;transition:all .2s;
  font-family:'Times New Roman',serif;box-shadow:0 3px 10px rgba(0,119,182,.3);
}
.school-toggle-btn:hover{transform:translateY(-1px);box-shadow:0 5px 15px rgba(0,119,182,.4);}
.nc-quiz-opt{padding:12px 16px;border:1.5px solid #d4c9a8;border-radius:10px;cursor:pointer;margin-bottom:8px;transition:all .2s;font-size:14px;font-weight:700;color:#1a2e0a;background:#fff;}
.nc-quiz-opt:hover:not(.answered){border-color:#5a9e35;background:rgba(90,158,53,.05);}
.nc-quiz-opt.correct{border-color:#22c55e;background:rgba(34,197,94,.1);color:#15803d;}
.nc-quiz-opt.wrong{border-color:#ef4444;background:rgba(239,68,68,.1);color:#dc2626;}
.nc-quiz-opt.selected{border-color:#5a9e35;background:rgba(90,158,53,.1);}
.nc-btn{padding:9px 18px;border-radius:9px;border:1.5px solid #5a9e35;color:#2d4a1e;background:#fff;font-weight:800;font-size:13px;cursor:pointer;transition:all .15s;font-family:'Times New Roman',serif;}
.nc-btn:hover{background:rgba(90,158,53,.08);}
.nc-btn-primary{background:linear-gradient(135deg,#4a7a2e,#5a9e35);border:none;color:#fff;box-shadow:0 3px 10px rgba(74,122,46,.3);}
.nc-btn-primary:hover{transform:translateY(-1px);box-shadow:0 5px 15px rgba(74,122,46,.4);}
.nc-progress-wrap{background:#e8e0d0;border-radius:20px;height:7px;overflow:hidden;}
.nc-progress-fill{height:100%;border-radius:20px;background:linear-gradient(90deg,#4a7a2e,#7bc950);transition:width .5s;}
.nc-specialty-card{
  background:#fff;border:2px solid #d4c9a8;border-radius:14px;padding:18px;cursor:pointer;
  transition:all .2s;text-align:center;
}
.nc-specialty-card:hover{border-color:#5a9e35;transform:translateY(-2px);box-shadow:0 6px 18px rgba(45,74,30,.12);}
.nc-specialty-card.active{border-color:#4a7a2e;background:rgba(74,122,46,.06);}
@media(max-width:900px){
  .nc-sidebar{position:fixed;top:0;left:0;height:100vh;transform:translateX(-100%);}
  .nc-sidebar.open{transform:translateX(0);}
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
    { key:"schoolpq", label:"🏫 School Past Questions" },
    { key:"nursingexams", label:"🎓 Nursing Exams" },
    { key:"skills", label:"✅ Skills" },
    { key:"announcements", label:"📢 Announcements" },
    { key:"handouts", label:"📄 Handouts" },
    { key:"retakes", label:"🔄 Exam Retakes" },
    { key:"essay", label:"✍️ Essay Exams" },
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
      {tab==="schoolpq" && <AdminSchoolPQ toast={toast} />}
      {tab==="nursingexams" && <AdminNursingExams toast={toast} />}
      {tab==="skills" && <AdminSkills toast={toast} />}
      {tab==="announcements" && <AdminAnnouncements toast={toast} />}
      {tab==="handouts" && <AdminHandouts toast={toast} />}
      {tab==="retakes" && <AdminExamRetakes toast={toast} />}
      {tab==="essay" && <AdminEssayExams toast={toast} />}
    </div>
  );
}

// ── Admin Overview ───────────────────────────────────────────────────
function AdminOverview({ toast }) {
  const [users] = useSharedData("nv-users", []);
  const [drugs] = useSharedData("nv-drugs", []);
  const [labs] = useSharedData("nv-labs", []);
  const [pq] = useSharedData("nv-pq", []);
  const [skills] = useSharedData("nv-skillsdb", []);
  const [classes] = useSharedData("nv-classes", []);
  const [handouts] = useSharedData("nv-handouts", []);
  const [announcements] = useSharedData("nv-announcements", []);

  const stats = [
    {lbl:"Users",val:users.length,icon:"👥",color:"var(--accent)"},
    {lbl:"Classes",val:classes.length,icon:"🏫",color:"var(--accent2)"},
    {lbl:"Drugs",val:drugs.length,icon:"💊",color:"var(--warn)"},
    {lbl:"Lab Tests",val:labs.length,icon:"🧪",color:"var(--success)"},
    {lbl:"Question Banks",val:pq.length,icon:"❓",color:"var(--purple)"},
    {lbl:"Skills",val:skills.length,icon:"✅",color:"var(--success)"},
    {lbl:"Handouts",val:handouts.length,icon:"📄",color:"var(--warn)"},
    {lbl:"Announcements",val:announcements.length,icon:"📢",color:"var(--purple)"},
  ];

  const exportAll = () => {
    const data = { users, classes, drugs, labs, pq, skills, handouts, announcements, exported: new Date().toISOString() };
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
          <button className="btn btn-danger" onClick={()=>{if(confirm("Reset ALL data to defaults? This cannot be undone!")){["nv-classes","nv-drugs","nv-labs","nv-pq","nv-skillsdb","nv-announcements","nv-handouts"].forEach(k=>localStorage.removeItem(k));initData();toast("Data reset to defaults","warn");}}}>🔄 Reset to Defaults</button>
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
  const [users, setUsers] = useSharedData("nv-users", []);
  const [edit, setEdit] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({username:"",password:"",role:"student",class:"",displayName:""});
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [search, setSearch] = useState("");
  const [showPw, setShowPw] = useState({});
  const [viewUser, setViewUser] = useState(null);

  const save = () => {
    if (!form.username||!form.password) return toast("Email & password required","error");
    if (!edit && users.find(u=>u.username===form.username)) return toast("Email already registered","error");
    let u;
    const entry = {...form, displayName: form.displayName||form.username.split("@")[0]};
    if (edit) { u = users.map(x=>x.username===edit?{...x,...entry}:x); toast("User profile updated ✅","success"); }
    else { u = [...users,{...entry,joined:new Date().toLocaleDateString()}]; toast("User added ✅","success"); }
    setUsers(u); saveShared("users",u); setEdit(null); setShowAdd(false);
    setForm({username:"",password:"",role:"student",class:"",displayName:""});
  };

  const del = (username) => {
    if (username==="admin@gmail.com") return toast("Cannot delete the main admin account","error");
    if (!confirm(`Permanently delete "${username}"? This cannot be undone.`)) return;
    const u = users.filter(x=>x.username!==username);
    setUsers(u); saveShared("users",u); toast("User deleted","success");
    if (viewUser?.username===username) setViewUser(null);
  };

  const roleColor = (r) => r==="admin"?"tag-purple":r==="lecturer"?"tag-warn":"tag-accent";
  const filtered = users.filter(u=>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    (u.displayName||"").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div className="sec-title">👥 Users ({users.length})</div>
          <div style={{fontSize:12,color:"var(--text3)"}}>Manage all registered accounts</div>
        </div>
        <button className="btn btn-purple" onClick={()=>{setShowAdd(true);setEdit(null);setForm({username:"",password:"",role:"student",class:"",displayName:""});}}>+ Add User</button>
      </div>

      <div className="search-wrap" style={{marginBottom:14}}>
        <span className="search-ico">🔍</span>
        <input placeholder="Search by email or display name..." value={search} onChange={e=>setSearch(e.target.value)} />
        {search&&<span style={{cursor:"pointer",color:"var(--text3)",fontSize:16,marginRight:4}} onClick={()=>setSearch("")}>✕</span>}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.map(u=>(
          <div key={u.username} className="card" style={{padding:"12px 16px",borderLeft:`3px solid ${u.role==="admin"?"var(--purple)":u.role==="lecturer"?"var(--warn)":"var(--accent)"}`}}>
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div className="user-av" style={{flexShrink:0}}>{(u.displayName||u.username)[0].toUpperCase()}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:2}}>{u.displayName||u.username.split("@")[0]}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:3}}>📧 {u.username}</div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span className={`tag ${roleColor(u.role||"student")}`}>{u.role||"student"}</span>
                  {u.class&&<span style={{fontSize:11,color:"var(--accent2)"}}>🏫 {classes.find(c=>c.id===u.class)?.label||u.class}</span>}
                  <span style={{fontSize:11,color:"var(--text3)"}}>📅 {u.joined||"—"}</span>
                </div>
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button className="btn btn-sm btn-accent" onClick={()=>setViewUser(u)}>👁 View</button>
                <button className="btn btn-sm" onClick={()=>{
                  setEdit(u.username);
                  setForm({username:u.username,password:u.password,role:u.role||"student",class:u.class||"",displayName:u.displayName||""});
                  setShowAdd(true);
                }}>✏️ Edit</button>
                <button className="btn btn-sm btn-danger" onClick={()=>del(u.username)}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length===0&&<div style={{textAlign:"center",padding:"40px",color:"var(--text3)",fontSize:13}}>No users found.</div>}
      </div>

      {/* View User Profile Modal */}
      {viewUser&&(
        <div className="modal-overlay" onClick={()=>setViewUser(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">👁 User Profile</div>
              <button className="modal-close" onClick={()=>setViewUser(null)}>✕</button>
            </div>
            <div style={{textAlign:"center",marginBottom:16}}>
              <div className="user-av" style={{width:56,height:56,fontSize:26,margin:"0 auto 8px"}}>{(viewUser.displayName||viewUser.username)[0].toUpperCase()}</div>
              <div style={{fontWeight:800,fontSize:18}}>{viewUser.displayName||viewUser.username.split("@")[0]}</div>
              <span className={`tag ${roleColor(viewUser.role||"student")}`} style={{marginTop:4,display:"inline-block"}}>{viewUser.role||"student"}</span>
            </div>
            <div style={{background:"var(--bg4)",borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
              {[
                {lbl:"📧 Email / Username", val: viewUser.username},
                {lbl:"🔑 Password", val: showPw[viewUser.username] ? viewUser.password : "••••••••", action: ()=>setShowPw(p=>({...p,[viewUser.username]:!p[viewUser.username]})), actionLabel: showPw[viewUser.username]?"🙈 Hide":"👁 Show"},
                {lbl:"👤 Display Name", val: viewUser.displayName||viewUser.username.split("@")[0]},
                {lbl:"🏫 Class", val: classes.find(c=>c.id===viewUser.class)?.label||"No class assigned"},
                {lbl:"📅 Joined", val: viewUser.joined||"Unknown"},
              ].map(row=>(
                <div key={row.lbl} style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid var(--border)",paddingBottom:8}}>
                  <div>
                    <div style={{fontSize:11,color:"var(--text3)",marginBottom:2}}>{row.lbl}</div>
                    <div style={{fontWeight:600,fontSize:13,fontFamily:row.lbl.includes("Password")?"'DM Mono',monospace":"inherit"}}>{row.val}</div>
                  </div>
                  {row.action&&<button className="btn btn-sm" onClick={row.action}>{row.actionLabel}</button>}
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={()=>{
                setEdit(viewUser.username);
                setForm({username:viewUser.username,password:viewUser.password,role:viewUser.role||"student",class:viewUser.class||"",displayName:viewUser.displayName||""});
                setShowAdd(true); setViewUser(null);
              }}>✏️ Edit Profile</button>
              <button className="btn btn-danger" onClick={()=>del(viewUser.username)}>🗑️ Delete</button>
              <button className="btn" onClick={()=>setViewUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {showAdd&&(
        <div className="modal-overlay" onClick={()=>setShowAdd(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">{edit?"✏️ Edit User":"➕ Add User"}</div>
              <button className="modal-close" onClick={()=>setShowAdd(false)}>✕</button>
            </div>
            <label className="lbl">📧 Email (Username)</label>
            <input className="inp" type="email" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} disabled={!!edit} placeholder="user@email.com" />
            <label className="lbl">🔑 Password</label>
            <div className="inp-wrap">
              <input className="inp" type={showPw["modal"]?"text":"password"} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Enter password" />
              <button className="inp-eye" onClick={()=>setShowPw(p=>({...p,modal:!p.modal}))}>{showPw["modal"]?"🙈":"👁"}</button>
            </div>
            <label className="lbl">👤 Display Name</label>
            <input className="inp" value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})} placeholder="e.g. Dr. Adeyemi or John Doe" />
            <label className="lbl">🎭 Role</label>
            <select className="inp" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
              <option value="student">Student</option>
              <option value="lecturer">Lecturer</option>
              <option value="admin">Admin</option>
            </select>
            <label className="lbl">🏫 Class</label>
            <select className="inp" value={form.class} onChange={e=>setForm({...form,class:e.target.value})}>
              <option value="">— No class —</option>
              {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-purple" style={{flex:1}} onClick={save}>💾 Save</button>
              <button className="btn" onClick={()=>setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin Classes ────────────────────────────────────────────────────
function AdminClasses({ toast }) {
  const [classes, setClasses] = useSharedData("nv-classes", DEFAULT_CLASSES);
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
  const [drugs, setDrugs] = useSharedData("nv-drugs", DEFAULT_DRUGS);
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

  const [selDrugs, setSelDrugs] = useState(new Set());
  const del = (id) => { const u=drugs.filter(d=>d.id!==id); setDrugs(u); saveShared("drugs",u); setSelDrugs(s=>{const n=new Set(s);n.delete(id);return n;}); toast("Deleted","success"); };
  const delSel = () => { if(!selDrugs.size)return; const u=drugs.filter(d=>!selDrugs.has(d.id)); setDrugs(u); saveShared("drugs",u); toast(`${selDrugs.size} drug(s) deleted`,"success"); setSelDrugs(new Set()); };
  const filtered = drugs.filter(d=>d.name.toLowerCase().includes(search.toLowerCase())||d.class.toLowerCase().includes(search.toLowerCase()));
  const allFilt = filtered.length>0 && filtered.every(d=>selDrugs.has(d.id));
  const togAll = () => { if(allFilt){setSelDrugs(s=>{const n=new Set(s);filtered.forEach(d=>n.delete(d.id));return n;});}else{setSelDrugs(s=>{const n=new Set(s);filtered.forEach(d=>n.add(d.id));return n;});}; };
  const togOne = (id) => setSelDrugs(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">💊 Drug Guide ({drugs.length} drugs)</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
          {drugs.length>0&&<button className="btn btn-sm btn-danger" onClick={()=>{if(window.confirm(`Delete all ${drugs.length} drugs? This cannot be undone.`)){setDrugs([]);saveShared("drugs",[]);setSelDrugs(new Set());toast("All drugs deleted","success");}}}>🗑️ Delete All</button>}
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm(blank);}}>+ Add Drug</button>
        </div>
      </div>

      {selDrugs.size>0&&(
        <div className="bulk-bar">
          <span className="bulk-bar-count">☑ {selDrugs.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={delSel}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={()=>setSelDrugs(new Set())}>✕ Clear</button>
        </div>
      )}

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
          <thead><tr>
            <th style={{width:36,padding:'10px 8px'}}><input type="checkbox" className="cb-all" checked={allFilt} onChange={togAll} title="Select all" /></th>
            <th>Drug Name</th><th>Class</th><th>Dose</th><th>Uses</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map((d,i)=>(
              <tr key={d.id} style={{background:selDrugs.has(d.id)?"rgba(239,68,68,.04)":""}}>
                <td style={{padding:'8px'}}><input type="checkbox" className="cb-row" checked={selDrugs.has(d.id)} onChange={()=>togOne(d.id)} /></td>
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
  const [labs, setLabs] = useSharedData("nv-labs", DEFAULT_LABS);
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

  const [selLabs, setSelLabs] = useState(new Set());
  const del = (id) => { const u=labs.filter(l=>l.id!==id); setLabs(u); saveShared("labs",u); setSelLabs(s=>{const n=new Set(s);n.delete(id);return n;}); toast("Deleted","success"); };
  const delSelLabs = () => { if(!selLabs.size)return; const u=labs.filter(l=>!selLabs.has(l.id)); setLabs(u); saveShared("labs",u); toast(`${selLabs.size} test(s) deleted`,"success"); setSelLabs(new Set()); };
  const allLabs = labs.length>0 && labs.every(l=>selLabs.has(l.id));
  const togAllLabs = () => { if(allLabs){setSelLabs(new Set());}else{setSelLabs(new Set(labs.map(l=>l.id)));} };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">🧪 Lab Reference ({labs.length} tests)</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
          {labs.length>0&&<button className="btn btn-sm btn-danger" onClick={()=>{if(window.confirm(`Delete all ${labs.length} lab tests? This cannot be undone.`)){setLabs([]);saveShared("labs",[]);setSelLabs(new Set());toast("All lab tests deleted","success");}}}>🗑️ Delete All</button>}
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm(blank);}}>+ Add Test</button>
        </div>
      </div>

      {selLabs.size>0&&(
        <div className="bulk-bar">
          <span className="bulk-bar-count">☑ {selLabs.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={delSelLabs}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={()=>setSelLabs(new Set())}>✕ Clear</button>
        </div>
      )}

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
          <thead><tr>
            <th style={{width:36,padding:'10px 8px'}}><input type="checkbox" className="cb-all" checked={allLabs} onChange={togAllLabs} title="Select all" /></th>
            <th>Test</th><th>Male</th><th>Female</th><th>Notes</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {labs.map((l,i)=>(
              <tr key={l.id} style={{background:selLabs.has(l.id)?"rgba(239,68,68,.04)":""}}>
                <td style={{padding:'8px'}}><input type="checkbox" className="cb-row" checked={selLabs.has(l.id)} onChange={()=>setSelLabs(s=>{const n=new Set(s);n.has(l.id)?n.delete(l.id):n.add(l.id);return n;})} /></td>
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
function AdminPQ({ toast }) {
  const [banks, setBanks] = useSharedData("nv-pq", DEFAULT_PQ);
  const [selBank, setSelBank] = useState(null);
  const [showBankModal, setShowBankModal] = useState(false);
  const [showQModal, setShowQModal] = useState(false);
  const [editBank, setEditBank] = useState(null);
  const [editQ, setEditQ] = useState(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteAnswers, setPasteAnswers] = useState("");
  const [parsed, setParsed] = useState([]);
  const [bankForm, setBankForm] = useState({subject:"",year:""});
  const [qForm, setQForm] = useState({q:"",options:["","","",""],ans:0});

  const parsePaste = () => {
    // Format:
    // Q: Question text
    // A: Option A
    // B: Option B
    // C: Option C
    // D: Option D
    // ANS: B (optional, can be overridden by answers column)
    const blocks = pasteText.trim().split(/\n\s*\n/).filter(b=>b.trim());
    const ansLines = pasteAnswers.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const items = blocks.map((block,idx)=>{
      const lines = block.split("\n").map(l=>l.trim()).filter(Boolean);
      let q="",options=["","","",""],ans=0;
      lines.forEach(line=>{
        const lower=line.toLowerCase();
        if (lower.startsWith("q:")) q=line.slice(2).trim();
        else if (lower.startsWith("a:")) options[0]=line.slice(2).trim();
        else if (lower.startsWith("b:")) options[1]=line.slice(2).trim();
        else if (lower.startsWith("c:")) options[2]=line.slice(2).trim();
        else if (lower.startsWith("d:")) options[3]=line.slice(2).trim();
        else if (lower.startsWith("ans:")) { const a=line.slice(4).trim().toUpperCase(); ans=["A","B","C","D"].indexOf(a); if(ans<0)ans=0; }
      });
      if (!q && lines[0]) q=lines[0];
      // Override with answers column if provided
      if (ansLines[idx]) { const a=["A","B","C","D"].indexOf(ansLines[idx][0]?.toUpperCase()); if(a>=0)ans=a; }
      return {q,options,ans};
    }).filter(item=>item.q);
    setParsed(items);
  };

  const importParsed = async () => {
    if (!selBank) return toast("Select a bank first","error");
    const updated = banks.map(b=>b.id===selBank?{...b,questions:[...b.questions,...parsed.map(p=>({...p}))]}:b);
    setBanks(updated);
    const ok = await saveShared("pq", updated);
    if (ok) {
      toast(`${parsed.length} questions imported & synced! ✅`,"success");
    } else {
      toast(`${parsed.length} questions saved locally — ⚠️ sync failed, check connection`,"warn");
    }
    setPasteText(""); setPasteAnswers(""); setParsed([]); setPasteMode(false);
  };

  const saveBank = () => {
    if (!bankForm.subject) return toast("Subject required","error");
    let u;
    if (editBank!==null) { u=banks.map((b,i)=>i===editBank?{...b,...bankForm}:b); toast("Updated","success"); }
    else { u=[...banks,{...bankForm,id:Date.now(),questions:[]}]; toast("Bank created","success"); }
    setBanks(u); saveShared("pq",u); setShowBankModal(false); setEditBank(null); setBankForm({subject:"",year:""});
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
        <button className="btn btn-purple" onClick={()=>{setShowBankModal(true);setEditBank(null);setBankForm({subject:"",year:""});}}>+ New Bank</button>
      </div>

      <div className="grid2" style={{marginBottom:20}}>
        {banks.map((b,i)=>(
          <div key={b.id} className={`card${selBank===b.id?" ":" "}`} style={{cursor:"pointer",border:selBank===b.id?"1px solid var(--purple)":"1px solid var(--border)",transition:"border .2s"}} onClick={()=>setSelBank(b.id)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{b.subject}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginTop:3}}>{b.year} · {b.questions.length} questions</div>
              </div>
              <div style={{display:"flex",gap:5}}>
                <button className="btn btn-sm" onClick={e=>{e.stopPropagation();setEditBank(i);setBankForm({subject:b.subject,year:b.year});setShowBankModal(true);}}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();delBank(b.id);}}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {currentBank&&(
        <div className="card">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700}}>{currentBank.subject} — Questions ({currentBank.questions.length})</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
              <button className="btn btn-purple btn-sm" onClick={()=>{setShowQModal(true);setEditQ(null);setQForm({q:"",options:["","","",""],ans:0});}}>+ Add Q</button>
            </div>
          </div>

          {pasteMode&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:8}}>Paste questions in the left column and answers (one letter per line: A/B/C/D) in the right column. Answers column overrides any ANS: in the question text.</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--accent)",marginBottom:4}}>📝 Questions (with A/B/C/D options)</div>
                  <textarea className="paste-box" placeholder={"Q: What is the normal adult temperature?\nA: 35.0°C\nB: 36.1–37.2°C\nC: 38.5°C\nD: 40.0°C\n\nQ: Which organ produces insulin?\nA: Liver\nB: Kidney\nC: Pancreas\nD: Spleen"} value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsed([]);}} rows={10} />
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ Answers (one per line: A / B / C / D)</div>
                  <textarea className="paste-box" placeholder={"B\nC"} value={pasteAnswers} onChange={e=>{setPasteAnswers(e.target.value);setParsed([]);}} rows={10} style={{borderColor:"rgba(34,197,94,.35)"}} />
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:parsed.length?10:0}}>
                <button className="btn btn-accent" onClick={parsePaste}>🔍 Parse</button>
                {parsed.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Import {parsed.length} Questions</button>}
                <button className="btn" onClick={()=>{setPasteMode(false);setParsed([]);setPasteText("");setPasteAnswers("");}}>Cancel</button>
              </div>
              {parsed.length>0&&<div className="parse-preview">{parsed.map((p,i)=><div key={i} className="parse-item"><span className="parse-check">✓</span><span style={{flex:1}}>{p.q}</span><span style={{color:"var(--accent)"}}>ANS: {"ABCD"[p.ans]}</span></div>)}</div>}
            </div>
          )}

          {currentBank.questions.map((q,qi)=>(
            <div key={qi} className="card2" style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:6}}>{qi+1}. {q.q}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {q.options.map((opt,oi)=>(
                      <span key={oi} style={{fontSize:11,padding:"2px 8px",borderRadius:5,background:oi===q.ans?"rgba(74,222,128,.15)":"rgba(255,255,255,.05)",border:`1px solid ${oi===q.ans?"var(--success)":"var(--border)"}`,color:oi===q.ans?"var(--success)":"var(--text3)"}}>{"ABCD"[oi]}. {opt}</span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0}}>
                  <button className="btn btn-sm" onClick={()=>{setEditQ(qi);setQForm({...q,options:[...q.options]});setShowQModal(true);}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>delQ(currentBank.id,qi)}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showBankModal&&(
        <div className="modal-overlay" onClick={()=>setShowBankModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{editBank!==null?"Edit":"New"} Question Bank</div><button className="modal-close" onClick={()=>setShowBankModal(false)}>✕</button></div>
            <label className="lbl">Subject</label><input className="inp" value={bankForm.subject} onChange={e=>setBankForm({...bankForm,subject:e.target.value})} placeholder="e.g. Medical-Surgical Nursing" />
            <label className="lbl">Year</label><input className="inp" value={bankForm.year} onChange={e=>setBankForm({...bankForm,year:e.target.value})} placeholder="e.g. 2024" />
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

// ── Admin Skills ─────────────────────────────────────────────────────
function AdminSkills({ toast }) {
  const [skills, setSkills] = useSharedData("nv-skillsdb", DEFAULT_SKILLS);
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

  const [selSkills, setSelSkills] = useState(new Set());
  const del = (id) => { const u=skills.filter(s=>s.id!==id); setSkills(u); saveShared("skills",u); setSelSkills(s=>{const n=new Set(s);n.delete(id);return n;}); toast("Deleted","success"); };
  const delSelSkills = () => { if(!selSkills.size)return; const u=skills.filter(s=>!selSkills.has(s.id)); setSkills(u); saveShared("skills",u); toast(`${selSkills.size} skill(s) deleted`,"success"); setSelSkills(new Set()); };
  const allSkills = skills.length>0 && skills.every(s=>selSkills.has(s.id));
  const togAllSkills = () => { if(allSkills){setSelSkills(new Set());}else{setSelSkills(new Set(skills.map(s=>s.id)));} };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">✅ Skills Checklist ({skills.length})</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-success btn-sm" onClick={()=>setPasteMode(p=>!p)}>📋 Paste</button>
          {skills.length>0&&<button className="btn btn-sm btn-danger" onClick={()=>{if(window.confirm(`Delete all ${skills.length} skills? This cannot be undone.`)){setSkills([]);saveShared("skills",[]);setSelSkills(new Set());toast("All skills deleted","success");}}}>🗑️ Delete All</button>}
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm({name:""});}}>+ Add Skill</button>
        </div>
      </div>

      {selSkills.size>0&&(
        <div className="bulk-bar">
          <span className="bulk-bar-count">☑ {selSkills.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={delSelSkills}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={()=>setSelSkills(new Set())}>✕ Clear</button>
        </div>
      )}

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

      <div style={{display:"flex",alignItems:"center",gap:10,padding:"6px 12px",background:"var(--bg4)",borderRadius:8,marginBottom:10}}>
        <input type="checkbox" className="cb-all" checked={allSkills} onChange={togAllSkills} title="Select all" />
        <span style={{fontSize:12,color:"var(--text3)",fontWeight:700}}>Select All ({skills.length})</span>
      </div>
      {skills.map((s,i)=>(
        <div key={s.id} className="card2" style={{marginBottom:8,display:"flex",alignItems:"center",gap:12,background:selSkills.has(s.id)?"rgba(239,68,68,.04)":""}}>
          <input type="checkbox" className="cb-row" checked={selSkills.has(s.id)} onChange={()=>setSelSkills(ss=>{const n=new Set(ss);n.has(s.id)?n.delete(s.id):n.add(s.id);return n;})} />
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
  const [items, setItems] = useSharedData("nv-announcements", DEFAULT_ANNOUNCEMENTS);
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

  const [selAnnos, setSelAnnos] = useState(new Set());
  const del = (id) => { const u=items.filter(a=>a.id!==id); setItems(u); saveShared("announcements",u); setSelAnnos(s=>{const n=new Set(s);n.delete(id);return n;}); toast("Deleted","success"); };
  const delSelAnnos = () => { if(!selAnnos.size)return; const u=items.filter(a=>!selAnnos.has(a.id)); setItems(u); saveShared("announcements",u); toast(`${selAnnos.size} announcement(s) deleted`,"success"); setSelAnnos(new Set()); };
  const allAnnos = items.length>0 && items.every(a=>selAnnos.has(a.id));
  const togglePin = (id) => { const u=items.map(a=>a.id===id?{...a,pinned:!a.pinned}:a); setItems(u); saveShared("announcements",u); };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">📢 Announcements ({items.length})</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {items.length>0&&<label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"var(--text3)",cursor:"pointer"}}><input type="checkbox" className="cb-all" checked={allAnnos} onChange={()=>{if(allAnnos){setSelAnnos(new Set());}else{setSelAnnos(new Set(items.map(a=>a.id)));} }} />All</label>}
          <button className="btn btn-purple" onClick={()=>{setShowModal(true);setEdit(null);setForm({title:"",body:"",pinned:false});}}>+ Post Announcement</button>
        </div>
      </div>
      {selAnnos.size>0&&(
        <div className="bulk-bar">
          <span className="bulk-bar-count">☑ {selAnnos.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={delSelAnnos}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={()=>setSelAnnos(new Set())}>✕ Clear</button>
        </div>
      )}
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
            <div style={{display:"flex",gap:5,flexShrink:0,alignItems:"center"}}>
              <input type="checkbox" className="cb-row" checked={selAnnos.has(a.id)} onChange={()=>setSelAnnos(s=>{const n=new Set(s);n.has(a.id)?n.delete(a.id):n.add(a.id);return n;})} />
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
  const [banks] = useState(()=>ls("nv-pq",DEFAULT_PQ));
  const [users, setUsers] = useState(()=>ls("nv-users",[]));
  const [attempts, setAttempts] = useState({});
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
  const [banks, setBanks] = useSharedData("nv-essay-banks", []);
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
      const ready = await _loadFirebase();
      if (!ready) { toast("Firebase not connected","error"); setLoadingSubs(false); return; }
      const snap = await _db.collection("nv").doc(_DOC_ESSAYS).get();
      if (!snap.exists) { setSubmissions([]); setLoadingSubs(false); return; }
      const data = snap.data();
      const idx  = data.index || [];
      const allSubs = idx.map(e => {
        const d = data[e.key];
        return d ? { ...d, student: e.student, bankId: e.bankId, graded: e.graded } : null;
      }).filter(Boolean);
      setSubmissions(allSubs);
    } catch (e) { console.error(e); toast("Could not load submissions", "error"); }
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
function AdminHandouts({ toast }) {
  const [handouts, setHandouts] = useSharedData("nv-handouts", []);
  const [folders, setFolders] = useSharedData("nv-folders", {});
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [viewTab, setViewTab] = useState("list"); // "list" | "folders"
  const [showInitModal, setShowInitModal] = useState(false);
  const [initClass, setInitClass] = useState("");
  // Rename lecturer modal
  const [renameLec, setRenameLec] = useState(null); // {classId, course, oldName}
  const [renameLecVal, setRenameLecVal] = useState("");

  const del = (id) => { const u=handouts.filter(h=>h.id!==id); setHandouts(u); saveShared("handouts",u); toast("Deleted","success"); };
  const clearAll = () => { if(!confirm("Delete ALL handouts?"))return; setHandouts([]); saveShared("handouts",[]); toast("All handouts cleared","warn"); };

  const saveFolders = (f) => { setFolders(f); saveShared("folders", f); };

  // Delete a course folder (and all its handouts inside)
  const deleteCourseFolder = (classId, course) => {
    if(!confirm(`Delete course folder "${course}" and all handouts inside it?`)) return;
    const f = {...folders};
    if(f[classId]) { delete f[classId][course]; }
    saveFolders(f);
    // Also remove handouts belonging to this course/class
    const u = handouts.filter(h=>!(h.classId===classId&&h.course===course));
    setHandouts(u); saveShared("handouts",u);
    toast(`📂 Course folder "${course}" deleted`,"success");
  };

  // Delete a lecturer folder
  const deleteLecturerFolder = (classId, course, lecName) => {
    if(!confirm(`Delete lecturer folder "${lecName}" from ${course}? Their handouts will also be removed.`)) return;
    const f = {...folders};
    if(f[classId]?.[course]) {
      f[classId][course] = f[classId][course].filter(l=>l!==lecName);
    }
    saveFolders(f);
    const u = handouts.filter(h=>!(h.classId===classId&&h.course===course&&(h.lecturerName===lecName||h.uploadedBy?.split("@")[0]===lecName)));
    setHandouts(u); saveShared("handouts",u);
    toast(`👨‍🏫 Lecturer folder "${lecName}" deleted`,"success");
  };

  // Rename lecturer
  const doRenameLecturer = () => {
    if(!renameLecVal.trim()) return toast("Enter a name","error");
    const {classId, course, oldName} = renameLec;
    const f = {...folders};
    if(f[classId]?.[course]) {
      f[classId][course] = f[classId][course].map(l=>l===oldName?renameLecVal.trim():l);
    }
    saveFolders(f);
    // Also rename in handouts
    const u = handouts.map(h=>{
      if(h.classId===classId&&h.course===course&&(h.lecturerName===oldName||h.uploadedBy?.split("@")[0]===oldName)) {
        return {...h,lecturerName:renameLecVal.trim()};
      }
      return h;
    });
    setHandouts(u); saveShared("handouts",u);
    toast(`✅ Renamed "${oldName}" → "${renameLecVal.trim()}"`,"success");
    setRenameLec(null); setRenameLecVal("");
  };

  // Initialize all course folders for a class from its default courses
  const initFoldersForClass = () => {
    if (!initClass) return toast("Select a class","error");
    const cls = classes.find(c=>c.id===initClass);
    if (!cls) return;
    const existing = folders[initClass]||{};
    const newFolders = {...existing};
    (cls.courses||[]).forEach(course=>{ if(!newFolders[course]) newFolders[course]=[]; });
    const f = {...folders,[initClass]:newFolders};
    saveFolders(f);
    toast(`✅ All ${(cls.courses||[]).length} course folders created for ${cls.label}!`,"success");
    setShowInitModal(false); setInitClass("");
  };

  // Init all classes at once
  const initAllFolders = () => {
    if(!confirm("Create course folders for ALL classes? This sets up the default course structure.")) return;
    const f = {...folders};
    classes.forEach(cls=>{
      if(!f[cls.id]) f[cls.id]={};
      (cls.courses||[]).forEach(course=>{ if(!f[cls.id][course]) f[cls.id][course]=[]; });
    });
    saveFolders(f);
    toast("✅ Course folders initialized for all classes!","success");
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div className="sec-title">📄 Handouts Management ({handouts.length})</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className={`btn btn-sm${viewTab==="list"?" btn-accent":""}`} onClick={()=>setViewTab("list")}>📋 Handouts List</button>
          <button className={`btn btn-sm${viewTab==="folders"?" btn-accent":""}`} onClick={()=>setViewTab("folders")}>📁 Folder Structure</button>
          {handouts.length>0&&<button className="btn btn-danger btn-sm" onClick={clearAll}>🗑️ Clear All</button>}
        </div>
      </div>

      {viewTab==="folders"&&(
        <div>
          <div style={{background:"rgba(0,119,182,.07)",border:"1px solid rgba(0,119,182,.18)",borderRadius:10,padding:"12px 16px",fontSize:13,color:"var(--accent2)",marginBottom:16,display:"flex",gap:10,alignItems:"flex-start"}}>
            <span>📁</span>
            <div><b>Folder Structure</b><br/><span style={{fontSize:12}}>Manage class → course → lecturer folders. Delete folders or rename lecturers.</span></div>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
            <button className="btn btn-accent" onClick={initAllFolders}>⚡ Initialize All Classes</button>
            <button className="btn btn-sm btn-purple" onClick={()=>{setInitClass("");setShowInitModal(true);}}>+ Init One Class</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {classes.map(cls=>{
              const classFolders = folders[cls.id]||{};
              const courseList = Object.keys(classFolders);
              return (
                <div key={cls.id} className="card" style={{borderLeft:`4px solid ${cls.color||"var(--accent)"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:courseList.length?12:0}}>
                    <div>
                      <div style={{fontWeight:800,fontSize:14}}>{cls.label}</div>
                      <div style={{fontSize:11,color:"var(--text3)"}}>{cls.desc} · {courseList.length} course folder{courseList.length!==1?"s":""}</div>
                    </div>
                    <button className="btn btn-sm" onClick={()=>{
                      const existing=folders[cls.id]||{};
                      const newF={...existing};
                      (cls.courses||[]).forEach(c=>{ if(!newF[c]) newF[c]=[]; });
                      saveFolders({...folders,[cls.id]:newF});
                      toast(`✅ Folders for ${cls.label} synced!`,"success");
                    }}>⚡ Sync</button>
                  </div>
                  {courseList.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {courseList.map(course=>{
                        const lecturers = classFolders[course]||[];
                        const hCount = handouts.filter(h=>h.classId===cls.id&&h.course===course).length;
                        // Also get lecturers from handouts not in folder list
                        const fromHandouts = [...new Set(handouts.filter(h=>h.classId===cls.id&&h.course===course).map(h=>h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown"))];
                        const allLecturers = [...new Set([...lecturers,...fromHandouts])];
                        return (
                          <div key={course} style={{background:"var(--bg4)",borderRadius:9,padding:"10px 12px",border:"1px solid var(--border)"}}>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:allLecturers.length?8:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:16}}>📂</span>
                                <div>
                                  <div style={{fontWeight:700,fontSize:13}}>{course}</div>
                                  <div style={{fontSize:10,color:"var(--text3)"}}>{allLecturers.length} lecturer{allLecturers.length!==1?"s":" "} · {hCount} file{hCount!==1?"s":""}</div>
                                </div>
                              </div>
                              <button className="btn btn-sm btn-danger" onClick={()=>deleteCourseFolder(cls.id,course)} title="Delete course folder">🗑️ Delete</button>
                            </div>
                            {allLecturers.length>0&&(
                              <div style={{display:"flex",flexWrap:"wrap",gap:6,paddingLeft:8}}>
                                {allLecturers.map(lec=>{
                                  const lhCount=handouts.filter(h=>h.classId===cls.id&&h.course===course&&(h.lecturerName===lec||h.uploadedBy?.split("@")[0]===lec)).length;
                                  return (
                                    <div key={lec} style={{display:"flex",alignItems:"center",gap:4,fontSize:11,padding:"3px 8px",borderRadius:7,border:"1px solid var(--border2)",background:"rgba(124,58,237,.06)"}}>
                                      <span>👨‍🏫</span>
                                      <span style={{color:"var(--purple)",fontWeight:600}}>{lec}</span>
                                      <span style={{color:"var(--text3)"}}>({lhCount})</span>
                                      <button title="Rename" onClick={()=>{setRenameLec({classId:cls.id,course,oldName:lec});setRenameLecVal(lec);}}
                                        style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--accent)",padding:"0 2px"}}>✏️</button>
                                      <button title="Delete" onClick={()=>deleteLecturerFolder(cls.id,course,lec)}
                                        style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--danger)",padding:"0 2px"}}>✕</button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {courseList.length===0&&(
                    <div style={{fontSize:12,color:"var(--text3)"}}>No folders yet — click "Sync" to create from class defaults</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewTab==="list"&&(
        handouts.length===0?<div style={{textAlign:"center",padding:"40px",color:"var(--text3)",fontFamily:"'DM Mono',monospace",fontSize:13}}>No handouts uploaded yet.</div>:(
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="tbl">
            <thead><tr><th>Title</th><th>Class</th><th>Course</th><th>Lecturer</th><th>Date</th><th>Action</th></tr></thead>
            <tbody>
              {handouts.map(h=>{
                const c=classes.find(x=>x.id===h.classId);
                return (
                  <tr key={h.id}>
                    <td style={{fontWeight:600}}>{h.title}{h.pdfName&&<span style={{marginLeft:5,fontSize:10,color:"var(--danger)"}}>📄</span>}</td>
                    <td><span className="tag tag-accent">{c?.label||"General"}</span></td>
                    <td style={{fontSize:12,color:"var(--text3)"}}>{h.course||"—"}</td>
                    <td style={{fontSize:12,color:"var(--purple)"}}>{h.lecturerName||h.uploadedBy?.split("@")[0]||"—"}</td>
                    <td style={{fontSize:12,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{h.date}</td>
                    <td><button className="btn btn-sm btn-danger" onClick={()=>del(h.id)}>🗑️</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Rename Lecturer Modal */}
      {renameLec&&(
        <div className="modal-overlay" onClick={()=>setRenameLec(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">✏️ Rename Lecturer</div><button className="modal-close" onClick={()=>setRenameLec(null)}>✕</button></div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>
              Renaming <b>"{renameLec.oldName}"</b> in course <b>{renameLec.course}</b>. This will also update their name on all uploaded handouts.
            </div>
            <label className="lbl">New Lecturer Name</label>
            <input className="inp" value={renameLecVal} onChange={e=>setRenameLecVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doRenameLecturer()} autoFocus />
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={doRenameLecturer}>✅ Rename</button>
              <button className="btn" onClick={()=>setRenameLec(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showInitModal&&(
        <div className="modal-overlay" onClick={()=>setShowInitModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">⚡ Initialize Course Folders</div><button className="modal-close" onClick={()=>setShowInitModal(false)}>✕</button></div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>Creates empty course folders for all default courses in the selected class.</div>
            <label className="lbl">Select Class</label>
            <select className="inp" value={initClass} onChange={e=>setInitClass(e.target.value)}>
              <option value="">— Choose a class —</option>
              {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {initClass&&(
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Will create folders for:</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                  {(classes.find(c=>c.id===initClass)?.courses||[]).map(c=><span key={c} style={{fontSize:11,padding:"2px 8px",borderRadius:6,border:"1px solid var(--border2)",color:"var(--accent2)"}}>📂 {c}</span>)}
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={initFoldersForClass}>⚡ Create Folders</button>
              <button className="btn" onClick={()=>setShowInitModal(false)}>Cancel</button>
            </div>
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
  const [handouts] = useSharedData("nv-handouts", []);
  const [classes] = useSharedData("nv-classes", DEFAULT_CLASSES);
  const [_announcements] = useSharedData("nv-announcements", []);
  const announcements = _announcements.filter(a=>a.pinned);
  const [openGroup, setOpenGroup] = useState(null);

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
function HandoutViewModal({ item, onClose }) {
  const [pdfSrc, setPdfSrc] = useState(item.pdfData || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pdfSrc && item.hasPdf && item.pdfKey) {
      setLoading(true);
      examBsGet(item.pdfKey || "").then(data => {
        if (data) setPdfSrc(data);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [item]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:800,width:"95vw"}} onClick={e=>e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">{item.title}</div>
          <button className="modal-close" onClick={onClose}>X</button>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
          {item.course&&<span className="tag tag-accent">{item.course}</span>}
          {item.lecturerName&&<span className="tag" style={{borderColor:"var(--purple)",color:"var(--purple)"}}>{item.lecturerName}</span>}
          {(item.pdfName||item.hasPdf)&&<span className="tag" style={{borderColor:"var(--danger)",color:"var(--danger)"}}>PDF</span>}
          <div style={{fontSize:10,color:"var(--text3)",fontFamily:"monospace",marginLeft:"auto"}}>
            Added {item.date}{item.uploadedBy&&` by ${item.uploadedBy.split("@")[0]}`}
          </div>
        </div>
        {(item.hasPdf || item.pdfData) ? (
          loading ? (
            <div style={{textAlign:"center",padding:"60px 0",color:"var(--text3)"}}>
              <div>Loading PDF...</div>
            </div>
          ) : pdfSrc ? (
            <div>
              <div style={{background:"var(--bg4)",borderRadius:10,padding:"8px 12px",marginBottom:10,display:"flex",alignItems:"center",gap:10,fontSize:12}}>
                <span>PDF: {item.pdfName||"Document"}</span>
                <a href={pdfSrc} download={item.pdfName||"handout.pdf"}
                  style={{background:"var(--accent)",color:"white",padding:"5px 14px",borderRadius:8,textDecoration:"none",fontSize:12,fontWeight:700,marginLeft:"auto"}}
                  onClick={e=>e.stopPropagation()}>Download</a>
              </div>
              <iframe src={pdfSrc} style={{width:"100%",height:"65vh",border:"1px solid var(--border)",borderRadius:10,display:"block"}} title={item.title} />
            </div>
          ) : (
            <div style={{textAlign:"center",padding:"40px",color:"var(--text3)"}}>
              Could not load PDF. It may not have synced yet — try refreshing.
            </div>
          )
        ) : (
          <div style={{maxHeight:"65vh",overflowY:"auto",padding:"4px 0"}}>
            <div style={{fontSize:14,lineHeight:1.9,color:"var(--text2)",whiteSpace:"pre-wrap"}}>{item.note||"No content."}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Handouts({ selectedClass, toast, currentUser, isLecturer }) {
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [handouts, setHandouts] = useSharedData("nv-handouts", []);
  // folders: { classId: { course: [lecturerName,...] } }
  const [folders, setFolders] = useSharedData("nv-folders", {});
  const allUsers = ls("nv-users",[]);
  const lecturers = allUsers.filter(u=>u.role==="lecturer"||u.role==="admin");

  // Upload form
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({title:"", note:"", classId: selectedClass?.id||"", course:"", lecturerName:"", uploadType:"text"});
  const [pdfFile, setPdfFile] = useState(null); const [pdfName, setPdfName] = useState("");

  // Folder creation modals
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [showLecturerModal, setShowLecturerModal] = useState(false);
  const [newLecturerName, setNewLecturerName] = useState("");
  // Rename course folder
  const [renameCourseTarget, setRenameCourseTarget] = useState(null); // old course name
  const [renameCourseVal, setRenameCourseVal] = useState("");

  // Drill-down navigation: null = top level
  const [drillClass, setDrillClass] = useState(selectedClass?.id||null);
  const [drillCourse, setDrillCourse] = useState(null);
  const [drillLecturer, setDrillLecturer] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const [filter, setFilter] = useState("");

  // Save folders helper
  const saveFolders = (f) => { setFolders(f); saveShared("folders", f); };

  // Ensure course folders include both handout-derived courses AND manually created ones
  const getCoursesForClass = (classId) => {
    const cls = classes.find(c=>c.id===classId);
    const fromHandouts = handouts.filter(h=>h.classId===classId).map(h=>h.course).filter(Boolean);
    const fromFolders = Object.keys(folders[classId]||{});
    const defaultCourses = cls?.courses||[];
    return [...new Set([...defaultCourses,...fromFolders,...fromHandouts])];
  };

  // Get lecturers for a course (folders + handout-derived)
  const getLecturersForCourse = (classId, course) => {
    const fromFolders = (folders[classId]?.[course])||[];
    const fromHandouts = handouts.filter(h=>h.classId===classId&&h.course===course).map(h=>h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown").filter(Boolean);
    return [...new Set([...fromFolders,...fromHandouts])];
  };

  // Create a course folder
  const createCourseFolder = () => {
    if (!newCourseName.trim()) return toast("Enter course name","error");
    if (!drillClass) return;
    const f = {...folders, [drillClass]:{...(folders[drillClass]||{}), [newCourseName.trim()]:folders[drillClass]?.[newCourseName.trim()]||[]}};
    saveFolders(f);
    toast(`📂 Course folder "${newCourseName.trim()}" created!`,"success");
    setShowCourseModal(false); setNewCourseName("");
  };

  // Create a lecturer folder inside a course
  const createLecturerFolder = () => {
    if (!newLecturerName.trim()) return toast("Enter lecturer name","error");
    if (!drillClass||!drillCourse) return;
    const existing = (folders[drillClass]?.[drillCourse])||[];
    if (existing.includes(newLecturerName.trim())) return toast("Lecturer folder already exists","warn");
    const f = {...folders,[drillClass]:{...(folders[drillClass]||{}),[drillCourse]:[...existing,newLecturerName.trim()]}};
    saveFolders(f);
    toast(`👨‍🏫 Lecturer folder "${newLecturerName.trim()}" created!`,"success");
    setShowLecturerModal(false); setNewLecturerName("");
  };

  // Rename a course folder — updates folders map + all handouts that reference the old name
  const renameCourseFolder = () => {
    const oldName = renameCourseTarget;
    const newName = renameCourseVal.trim();
    if (!newName) return toast("Enter a new name","error");
    if (newName === oldName) { setRenameCourseTarget(null); return; }
    if (!drillClass) return;
    // Rename in folders map
    const classF = {...(folders[drillClass]||{})};
    classF[newName] = classF[oldName] || [];
    delete classF[oldName];
    const f = {...folders, [drillClass]: classF};
    saveFolders(f);
    // Rename in all handouts
    const updatedHandouts = handouts.map(h =>
      h.classId===drillClass && h.course===oldName ? {...h, course:newName} : h
    );
    setHandouts(updatedHandouts); saveShared("handouts", updatedHandouts);
    // Also rename in class default courses list if it exists there
    const updatedClasses = classes.map(c => {
      if (c.id !== drillClass) return c;
      return {...c, courses: c.courses.map(co => co===oldName ? newName : co)};
    });
    // Save classes update
    const { saveShared: _s, ..._ } = {}; // dummy
    saveShared("classes", updatedClasses);
    // Update local classes through shared data — use localStorage directly
    lsSet("nv-classes", updatedClasses);
    toast(`✏️ Course renamed to "${newName}"`, "success");
    setRenameCourseTarget(null); setRenameCourseVal("");
    if (drillCourse === oldName) setDrillCourse(newName);
  };

  const selCls = classes.find(c=>c.id===drillClass);

  const pushNotification = (item) => {
    const notifs = ls("nv-notifications", []);
    const notif = {
      id: Date.now(), type:"handout",
      title:`New handout: ${item.title}`,
      body:`${item.lecturerName||currentUser.split("@")[0]} uploaded ${item.pdfName?"a PDF ":"notes "}for ${item.course||"your class"}`,
      from: currentUser, date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
      read: false, handoutId: item.id,
    };
    saveMyData("notifications","nv-notifications",[notif,...notifs]);
  };

  const handlePdfChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.type !== "application/pdf") return toast("Please select a PDF file","error");
    // Keep under 3.5MB so base64 fits in 5MB backend storage limit
    if (file.size > 3.5*1024*1024) return toast("PDF must be under 3.5MB for cross-device sync","error");
    const reader = new FileReader();
    reader.onload = (ev) => { setPdfFile(ev.target.result); setPdfName(file.name); };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!form.title.trim()) return toast("Enter a title","error");
    if (!form.classId) return toast("Select a class","error");
    if (!form.course) return toast("Select a course","error");
    if (!form.lecturerName.trim()) return toast("Enter lecturer name","error");
    if (form.uploadType==="pdf" && !pdfFile) return toast("Select a PDF file","error");

    const itemId = Date.now();
    // Store PDF data SEPARATELY under its own key (not in the handouts array)
    // This prevents the handouts metadata array from exceeding the 5MB backend limit
    if (form.uploadType==="pdf" && pdfFile) {
      const pdfOk = await examBsSet(`handout-pdf:${itemId}`, pdfFile);
      if (!pdfOk) {
        toast("❌ PDF too large to sync — try a smaller file (under 3.5MB)","error");
        return;
      }
    }
    const item = {
      id: itemId, title: form.title, note: form.note,
      classId: form.classId, course: form.course, lecturerName: form.lecturerName,
      date: new Date().toLocaleDateString(), uploadedBy: currentUser,
      // Only store filename in the array, not the full base64 data
      ...(form.uploadType==="pdf" ? {hasPdf:true, pdfName, pdfKey:`handout-pdf:${itemId}`} : {})
    };
    const u=[...handouts,item]; setHandouts(u);
    const ok = await saveShared("handouts", u);
    if (!ok) {
      toast("⚠️ Saved locally but failed to sync to server — check connection","warn");
    } else {
      toast("Handout published! Students notified. ✅","success");
    }
    pushNotification(item);
    setForm({title:"",note:"",classId:drillClass||"",course:drillCourse||"",lecturerName:"",uploadType:"text"});
    setPdfFile(null); setPdfName(""); setShowAdd(false);
    if (!drillClass) setDrillClass(item.classId);
  };

  const del=(id)=>{const u=handouts.filter(h=>h.id!==id);setHandouts(u);saveShared("handouts",u);toast("Deleted","info");};

  // Computed collections for drill-down
  const classHandouts = handouts.filter(h=>h.classId===drillClass);
  const coursesInClass = drillClass ? getCoursesForClass(drillClass) : [];
  const courseHandouts = classHandouts.filter(h=>h.course===drillCourse);
  const lecturersInCourse = drillClass&&drillCourse ? getLecturersForCourse(drillClass, drillCourse) : [];
  const lecturerHandouts = courseHandouts.filter(h=>(h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown")===drillLecturer);

  // Search filtering (only at leaf level)
  const searchFiltered = filter
    ? handouts.filter(h=>h.title.toLowerCase().includes(filter.toLowerCase())||h.course?.toLowerCase().includes(filter.toLowerCase())||h.lecturerName?.toLowerCase().includes(filter.toLowerCase()))
    : null;

  // Breadcrumb
  const Breadcrumb = () => (
    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,marginBottom:12,flexWrap:"wrap"}}>
      <span style={{color:"var(--accent)",cursor:"pointer",fontWeight:800}} onClick={()=>{setDrillClass(null);setDrillCourse(null);setDrillLecturer(null);setFilter("");}}>🏠 All Classes</span>
      {drillClass&&<><span style={{color:"var(--text3)"}}>›</span>
        <span style={{color:drillCourse?"var(--accent)":"var(--text)",cursor:drillCourse?"pointer":"default",fontWeight:800}}
          onClick={()=>{if(drillCourse){setDrillCourse(null);setDrillLecturer(null);}}}>{selCls?.label||drillClass}</span></>}
      {drillCourse&&<><span style={{color:"var(--text3)"}}>›</span>
        <span style={{color:drillLecturer?"var(--accent)":"var(--text)",cursor:drillLecturer?"pointer":"default",fontWeight:800}}
          onClick={()=>{if(drillLecturer)setDrillLecturer(null);}}>{drillCourse}</span></>}
      {drillLecturer&&<><span style={{color:"var(--text3)"}}>›</span>
        <span style={{fontWeight:800,color:"var(--text)"}}>👨‍🏫 {drillLecturer}</span></>}
    </div>
  );

  // Folder card component
  const FolderCard = ({icon, label, sublabel, count, countLabel, color, onClick}) => (
    <div className="card" style={{cursor:"pointer",borderLeft:`4px solid ${color}`,transition:"all .2s",userSelect:"none"}} onClick={onClick}
      onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
      onMouseLeave={e=>e.currentTarget.style.transform=""}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:44,height:44,borderRadius:12,background:`${color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{icon}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>{sublabel}</div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontWeight:800,fontSize:18,color}}>{count}</div>
          <div style={{fontSize:10,color:"var(--text3)"}}>{countLabel}</div>
        </div>
        <div style={{color:"var(--text3)",fontSize:16,marginLeft:4}}>›</div>
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div className="sec-title">📄 Handouts</div>
          <div className="sec-sub">{handouts.length} total · organised by class › course › lecturer</div>
        </div>
        {isLecturer && !drillLecturer && <button className="btn btn-accent" onClick={()=>setShowAdd(p=>!p)}>+ Upload Handout</button>}
      </div>

      {/* Search bar */}
      <div className="search-wrap" style={{marginBottom:16}}>
        <span className="search-ico">🔍</span>
        <input placeholder="Search handouts by title, course, lecturer..." value={filter} onChange={e=>setFilter(e.target.value)} />
        {filter&&<span style={{cursor:"pointer",color:"var(--text3)",fontSize:16,marginRight:4}} onClick={()=>setFilter("")}>✕</span>}
      </div>

      {/* ── Upload form (inline, not modal) ── */}
      {showAdd&&isLecturer&&(
        <div className="card" style={{marginBottom:20,border:"1px solid var(--border2)",animation:"fadeUp .25s ease"}}>
          <div style={{fontWeight:800,fontSize:14,color:"var(--accent)",marginBottom:16}}>📤 Upload New Handout</div>
          {/* 4-column upload row */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginBottom:12}}>
            {/* Class */}
            <div>
              <label className="lbl">Class *</label>
              <select className="inp" style={{marginBottom:0}} value={form.classId} onChange={e=>setForm({...form,classId:e.target.value,course:""})}>
                <option value="">— Select class —</option>
                {classes.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            {/* Course */}
            <div>
              <label className="lbl">Course *</label>
              <select className="inp" style={{marginBottom:0}} value={form.course} onChange={e=>setForm({...form,course:e.target.value})} disabled={!form.classId}>
                <option value="">— Select course —</option>
                {(form.classId ? getCoursesForClass(form.classId) : []).map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {/* Lecturer */}
            <div>
              <label className="lbl">Lecturer Name *</label>
              <input className="inp" style={{marginBottom:0}} placeholder="Your name or title" value={form.lecturerName}
                onChange={e=>setForm({...form,lecturerName:e.target.value})}
                list="lecturer-name-suggestions" />
              <datalist id="lecturer-name-suggestions">
                {lecturers.map(l=><option key={l.username} value={l.username.split("@")[0]} />)}
              </datalist>
            </div>
            {/* Title */}
            <div>
              <label className="lbl">Handout Title *</label>
              <input className="inp" style={{marginBottom:0}} placeholder="e.g. Week 3 Notes" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} />
            </div>
          </div>
          {/* Content type */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            {["text","pdf"].map(t=>(
              <div key={t} onClick={()=>setForm({...form,uploadType:t})} style={{padding:"10px",border:`1px solid ${form.uploadType===t?"var(--accent)":"var(--border)"}`,borderRadius:9,cursor:"pointer",textAlign:"center",background:form.uploadType===t?"rgba(0,119,182,.10)":"transparent",fontSize:13,color:form.uploadType===t?"var(--accent)":"var(--text3)",transition:"all .2s"}}>
                {t==="text"?"📝 Text Notes":"📄 PDF File"}
              </div>
            ))}
          </div>
          {form.uploadType==="text" ? (
            <div style={{marginBottom:12}}>
              <label className="lbl">Content</label>
              <textarea className="inp" rows={4} style={{resize:"vertical",marginBottom:0}} placeholder="Paste or type notes..." value={form.note} onChange={e=>setForm({...form,note:e.target.value})} />
            </div>
          ) : (
            <div style={{marginBottom:12}}>
              <label className="lbl">PDF File (max 10MB)</label>
              <label style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",border:"2px dashed var(--border2)",borderRadius:10,cursor:"pointer",background:"var(--bg4)"}}>
                <span style={{fontSize:24}}>📄</span>
                <div style={{flex:1}}>{pdfName?<span style={{color:"var(--accent)",fontSize:13}}>{pdfName}</span>:<span style={{color:"var(--text3)",fontSize:13}}>Click to select PDF...</span>}</div>
                <input type="file" accept=".pdf" style={{display:"none"}} onChange={handlePdfChange} />
              </label>
            </div>
          )}
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-accent" onClick={save}>📤 Publish & Notify Students</button>
            <button className="btn" onClick={()=>{setShowAdd(false);setForm({title:"",note:"",classId:drillClass||"",course:drillCourse||"",lecturerName:"",uploadType:"text"});setPdfFile(null);setPdfName("");}}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Search results override ── */}
      {filter&&searchFiltered!==null&&(
        <div>
          <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>🔍 {searchFiltered.length} result{searchFiltered.length!==1?"s":""} for "{filter}"</div>
          {searchFiltered.length===0 ? (
            <div style={{textAlign:"center",padding:32,color:"var(--text3)"}}>No handouts match your search.</div>
          ) : (
            <div className="grid2">
              {searchFiltered.map(h=>{
                const c=classes.find(x=>x.id===h.classId);
                return (
                  <div key={h.id} className="card" style={{cursor:"pointer"}} onClick={()=>setViewItem(h)}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        <span className="tag tag-accent">{c?.label||"?"}</span>
                        {h.course&&<span className="tag" style={{borderColor:"var(--accent2)",color:"var(--accent2)"}}>{h.course}</span>}
                        {h.pdfName&&<span className="tag" style={{borderColor:"var(--danger)",color:"var(--danger)"}}>📄 PDF</span>}
                      </div>
                      {isLecturer&&<button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();del(h.id);}}>✕</button>}
                    </div>
                    <div style={{fontWeight:800,fontSize:14,marginBottom:3}}>{h.title}</div>
                    <div style={{fontSize:11,color:"var(--purple)",marginBottom:4}}>👨‍🏫 {h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown"}</div>
                    <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace"}}>{h.date}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Folder drill-down (only shown when not searching) ── */}
      {!filter&&(
        <>
          <Breadcrumb />

          {/* Level 0: All classes */}
          {!drillClass&&(
            <>
            {isLecturer&&(
              <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
                <span style={{fontSize:12,color:"var(--text3)"}}>Click a class folder to browse courses</span>
              </div>
            )}
            {classes.length===0 ? (
              <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:14}}>
                <div style={{fontSize:52,marginBottom:12}}>📁</div>
                <div style={{fontWeight:700}}>No classes available</div>
              </div>
            ) : (
              <div className="grid2">
                {classes.map(c=>{
                  const cnt = handouts.filter(h=>h.classId===c.id).length;
                  const allCourses = getCoursesForClass(c.id);
                  return (
                    <FolderCard key={c.id} icon="📁" label={c.label} sublabel={`${c.desc} · ${allCourses.length} course${allCourses.length!==1?"s":""}`}
                      count={cnt} countLabel={`handout${cnt!==1?"s":""}`} color={c.color||"var(--accent)"}
                      onClick={()=>{setDrillClass(c.id);setDrillCourse(null);setDrillLecturer(null);}} />
                  );
                })}
              </div>
            )}
            </>
          )}

          {/* Level 1: Courses inside a class */}
          {drillClass&&!drillCourse&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{fontWeight:800,fontSize:15,color:"var(--accent)"}}>
                  📁 {selCls?.label} — Courses
                </div>
                {isLecturer&&(
                  <button className="btn btn-sm btn-accent" onClick={()=>{setNewCourseName("");setShowCourseModal(true);}}>
                    + New Course Folder
                  </button>
                )}
              </div>
              {coursesInClass.length===0 ? (
                <div style={{textAlign:"center",padding:40,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:12}}>
                  <div style={{fontSize:40,marginBottom:8}}>📂</div>
                  <div>No course folders yet for this class</div>
                  {isLecturer&&<div style={{fontSize:12,marginTop:6}}>Click "+ New Course Folder" to create one</div>}
                </div>
              ) : (
                <div className="grid2">
                  {coursesInClass.map(course=>{
                    const cnt = classHandouts.filter(h=>h.course===course).length;
                    const lecCount = getLecturersForCourse(drillClass, course).length;
                    return (
                      <div key={course} style={{position:"relative"}}>
                        <FolderCard icon="📂" label={course}
                          sublabel={`${lecCount} lecturer${lecCount!==1?"s":""}`}
                          count={cnt} countLabel={`file${cnt!==1?"s":""}`} color="var(--accent2)"
                          onClick={()=>{setDrillCourse(course);setDrillLecturer(null);}} />
                        {isLecturer&&(
                          <button
                            onClick={e=>{e.stopPropagation();setRenameCourseTarget(course);setRenameCourseVal(course);}}
                            title="Rename course folder"
                            style={{position:"absolute",top:10,right:10,background:"rgba(0,119,182,.12)",border:"1px solid rgba(0,119,182,.25)",
                              borderRadius:7,padding:"3px 8px",fontSize:11,cursor:"pointer",color:"var(--accent)",fontWeight:700,zIndex:2}}>
                            ✏️ Rename
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Level 2: Lecturers inside a course */}
          {drillClass&&drillCourse&&!drillLecturer&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{fontWeight:800,fontSize:15,color:"var(--accent2)"}}>
                  📂 {drillCourse} — Lecturers
                </div>
                {isLecturer&&(
                  <button className="btn btn-sm btn-accent" onClick={()=>{setNewLecturerName("");setShowLecturerModal(true);}}>
                    + New Lecturer Folder
                  </button>
                )}
              </div>
              {lecturersInCourse.length===0 ? (
                <div style={{textAlign:"center",padding:40,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:12}}>
                  <div style={{fontSize:40,marginBottom:8}}>👨‍🏫</div>
                  <div>No lecturer folders yet</div>
                  {isLecturer&&<div style={{fontSize:12,marginTop:6}}>Click "+ New Lecturer Folder" to create one</div>}
                </div>
              ) : (
                <div className="grid2">
                  {lecturersInCourse.map(lec=>{
                    const cnt = courseHandouts.filter(h=>(h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown")===lec).length;
                    return (
                      <FolderCard key={lec} icon="👨‍🏫" label={lec}
                        sublabel="Lecturer"
                        count={cnt} countLabel={`file${cnt!==1?"s":""}`} color="var(--purple)"
                        onClick={()=>setDrillLecturer(lec)} />
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Level 3: Handouts inside a lecturer folder */}
          {drillClass&&drillCourse&&drillLecturer&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{fontWeight:800,fontSize:15,color:"var(--purple)"}}>
                  👨‍🏫 {drillLecturer} — {drillCourse}
                </div>
                {isLecturer&&(
                  <button className="btn btn-sm btn-accent" onClick={()=>{
                    setForm({title:"",note:"",classId:drillClass,course:drillCourse,lecturerName:drillLecturer,uploadType:"text"});
                    setShowAdd(p=>!p);
                  }}>
                    {showAdd?"✕ Cancel":"+ Upload Handout"}
                  </button>
                )}
              </div>
              {lecturerHandouts.length===0 ? (
                <div style={{textAlign:"center",padding:40,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:12}}>
                  <div style={{fontSize:40,marginBottom:8}}>📄</div>
                  <div>No handouts in this folder yet</div>
                </div>
              ) : (
                <div className="grid2">
                  {lecturerHandouts.map(h=>(
                    <div key={h.id} className="card" style={{cursor:"pointer"}} onClick={()=>setViewItem(h)}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                          {h.pdfName&&<span className="tag" style={{borderColor:"var(--danger)",color:"var(--danger)",background:"rgba(248,113,113,.08)"}}>📄 PDF</span>}
                          <span className="tag" style={{borderColor:"var(--accent2)",color:"var(--accent2)"}}>📂 {h.course}</span>
                        </div>
                        {isLecturer&&<button className="btn btn-sm btn-danger" onClick={e=>{e.stopPropagation();del(h.id);}}>✕</button>}
                      </div>
                      <div style={{fontWeight:800,fontSize:14,marginBottom:6}}>{h.title}</div>
                      {h.pdfName ? (
                        <div style={{fontSize:12,color:"var(--text3)",display:"flex",alignItems:"center",gap:6}}>📎 {h.pdfName}</div>
                      ) : (
                        <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{h.note||"No content"}</div>
                      )}
                      <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginTop:8,display:"flex",justifyContent:"space-between"}}>
                        <span>{h.date}</span>
                        <span>by {h.lecturerName||h.uploadedBy?.split("@")[0]||"Unknown"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── View handout modal ── */}
      {viewItem&&(
        <HandoutViewModal item={viewItem} onClose={()=>setViewItem(null)} />
      )}
      {/* ── Create Course Folder Modal ── */}
      {showCourseModal&&(
        <div className="modal-overlay" onClick={()=>setShowCourseModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">📂 Create Course Folder</div>
              <button className="modal-close" onClick={()=>setShowCourseModal(false)}>✕</button>
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>
              Creating a course folder inside <b>{selCls?.label}</b>
            </div>
            <label className="lbl">Course Name *</label>
            <input className="inp" placeholder="e.g. Anatomy & Physiology" value={newCourseName}
              onChange={e=>setNewCourseName(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&createCourseFolder()}
              list="existing-courses-list" />
            <datalist id="existing-courses-list">
              {(selCls?.courses||[]).map(c=><option key={c} value={c}/>)}
            </datalist>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Or pick a course from this class:</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {(selCls?.courses||[]).map(c=>(
                  <span key={c} onClick={()=>setNewCourseName(c)}
                    style={{fontSize:11,padding:"3px 10px",borderRadius:7,border:"1px solid var(--border2)",cursor:"pointer",
                      background:newCourseName===c?"rgba(0,119,182,.15)":"transparent",
                      color:newCourseName===c?"var(--accent)":"var(--text3)"}}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={createCourseFolder}>📂 Create Folder</button>
              <button className="btn" onClick={()=>setShowCourseModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Lecturer Folder Modal ── */}
      {showLecturerModal&&(
        <div className="modal-overlay" onClick={()=>setShowLecturerModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">👨‍🏫 Create Lecturer Folder</div>
              <button className="modal-close" onClick={()=>setShowLecturerModal(false)}>✕</button>
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>
              Creating a lecturer folder inside <b>{drillCourse}</b> ({selCls?.label})
            </div>
            <label className="lbl">Lecturer Name *</label>
            <input className="inp" placeholder="e.g. Dr. Adeyemi" value={newLecturerName}
              onChange={e=>setNewLecturerName(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&createLecturerFolder()}
              list="existing-lecturers-list" />
            <datalist id="existing-lecturers-list">
              {lecturers.map(l=><option key={l.username} value={l.username.split("@")[0]}/>)}
            </datalist>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Or pick a registered lecturer:</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {lecturers.map(l=>{
                  const name=l.username.split("@")[0];
                  return (
                    <span key={l.username} onClick={()=>setNewLecturerName(name)}
                      style={{fontSize:11,padding:"3px 10px",borderRadius:7,border:"1px solid var(--border2)",cursor:"pointer",
                        background:newLecturerName===name?"rgba(124,58,237,.15)":"transparent",
                        color:newLecturerName===name?"var(--purple)":"var(--text3)"}}>
                      👨‍🏫 {name}
                    </span>
                  );
                })}
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-purple" style={{flex:1}} onClick={createLecturerFolder}>👨‍🏫 Create Folder</button>
              <button className="btn" onClick={()=>setShowLecturerModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* ── Rename Course Folder Modal ── */}
      {renameCourseTarget&&(
        <div className="modal-overlay" onClick={()=>setRenameCourseTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title">✏️ Rename Course Folder</div>
              <button className="modal-close" onClick={()=>setRenameCourseTarget(null)}>✕</button>
            </div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:14}}>
              Renaming <b style={{color:"var(--accent2)"}}>📂 {renameCourseTarget}</b> inside <b>{selCls?.label}</b>.
              All handouts in this folder will be updated automatically.
            </div>
            <label className="lbl">New Course Name *</label>
            <input className="inp" placeholder="e.g. Advanced Pharmacology"
              value={renameCourseVal}
              onChange={e=>setRenameCourseVal(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&renameCourseFolder()}
              autoFocus />
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-accent" style={{flex:1}} onClick={renameCourseFolder}>✏️ Rename</button>
              <button className="btn" onClick={()=>setRenameCourseTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// STUDENT PROFILE
// ═══════════════════════════════════════════════════════════════════════
const AVATAR_EMOJIS = ["👩‍⚕️","👨‍⚕️","🧑‍⚕️","👩‍🎓","👨‍🎓","🧑‍🎓","👩‍💼","👨‍💼","🌟","🏆","💡","🦋","🌺","🎯","🩺","🧬","💊","🏥"];
const YEAR_OPTIONS = ["Year 1","Year 2","Year 3","Year 4","Year 5","Postgraduate","Intern","Other"];

function StudentProfile({ currentUser, toast }) {
  const [users, setUsers] = useSharedData("nv-users", []);
  const [classes] = useSharedData("nv-classes", DEFAULT_CLASSES);
  const results = ls("nv-results", []);

  const me = users.find(u => u.username === currentUser) || {};

  const [editMode, setEditMode] = useState(false);
  const [showPwSection, setShowPwSection] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [form, setForm] = useState({
    displayName: me.displayName || currentUser.split("@")[0],
    phone: me.phone || "",
    bio: me.bio || "",
    class: me.class || "",
    yearOfStudy: me.yearOfStudy || "",
    avatar: me.avatar || "👩‍⚕️",
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
      avatar: u.avatar || "👩‍⚕️",
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
  const roleLabel = me.role === "admin" ? "🛡️ Admin" : me.role === "lecturer" ? "👨‍🏫 Lecturer" : "🎓 Student";
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
          Academic Information
        </div>

        {!editMode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { icon: "🏫", label: "Class", val: myClass ? `${myClass.label} — ${myClass.desc}` : "No class assigned" },
              { icon: "📅", label: "Year of Study", val: form.yearOfStudy || "Not set" },
              { icon: "🎓", label: "Role", val: roleLabel },
            ].map((row, i) => (
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
                <div style={{ fontSize: 11, color: "var(--text3)" }}>{r.type || "Exam"} · {r.date}</div>
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

function Results({ toast }) {
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
function MCQExamView({ toast, currentUser, banks, onBack, backLabel }) {
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
    <div>
      {onBack && <button className="btn btn-sm" style={{marginBottom:14}} onClick={onBack}>{backLabel||"← Back"}</button>}
      <div className="grid2">
      {banks.map((b,i)=>{
        const att = ls(attKey,{})[String(b.id)];
        return (
          <div key={b.id} className="card" style={{animation:`fadeUp .4s ease ${i*.08}s both`}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,marginBottom:4}}>{b.subject}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:10}}>{b.year} · {b.questions.length} questions</div>
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
function EssayExamView({ toast, currentUser, essayBanks }) {
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
              {sel.questions.length} questions · {answeredCount}/{sel.questions.length} answered · {totalWords} words total
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
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>{b.questions.length} questions · {b.questions.reduce((s,q)=>s+(+q.marks||10),0)} total marks</div>
                {b.description&&<div style={{fontSize:11,color:"var(--text3)",marginBottom:8,fontStyle:"italic"}}>{b.description}</div>}
                {att ? (
                  <div>
                    {att.pendingManualGrade && !att.manualGrade && (
                      <div style={{background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.25)",borderRadius:8,padding:"8px 12px",fontSize:12,color:"var(--warn)",marginBottom:6}}>
                        ⏳ Submitted · Awaiting manual grading from your lecturer
                      </div>
                    )}
                    {att.manualGrade && (
                      <div style={{marginBottom:6}}>
                        <div style={{fontSize:14,fontWeight:700,marginBottom:2}}>Grade: <span style={{color:"var(--accent)"}}>{att.manualGrade.grade}</span> · {att.manualGrade.pct}%</div>
                        {att.manualGrade.overallComment && <div style={{fontSize:12,color:"var(--text2)"}}>{att.manualGrade.overallComment}</div>}
                        <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginTop:4}}>✏️ Manually graded on {att.gradedDate}</div>
                      </div>
                    )}
                    {att.grade && !att.manualGrade && <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>Grade: <span style={{color:"var(--accent)"}}>{att.grade}</span> · {att.pct}%</div>}
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

// ─── ADMIN: School Past Questions ──────────────────────────────────────
function AdminSchoolPQ({ toast }) {
  const classes = ls("nv-classes", DEFAULT_CLASSES);
  const [data, setData] = useSharedData("nv-school-pq", {});
  // Navigation state: class → course → question type
  const [selClass, setSelClass] = useState(null);
  const [selCourse, setSelCourse] = useState(null);
  const [qTab, setQTab] = useState("mcq"); // "mcq" | "essay"
  // MCQ state
  const [mcqMode, setMcqMode] = useState("single"); // "single" | "paste"
  const [singleForm, setSingleForm] = useState({q:"",options:["","","",""],ans:0,year:""});
  const [pasteText, setPasteText] = useState("");
  const [pasteAnswers, setPasteAnswers] = useState("");
  const [parsed, setParsed] = useState([]);
  const [editMcqIdx, setEditMcqIdx] = useState(null);
  // Essay state
  const [essayMode, setEssayMode] = useState("single");
  const [essayForm, setEssayForm] = useState({q:"",marks:"10",modelAnswer:"",year:""});
  const [essayPasteText, setEssayPasteText] = useState("");
  const [essayPasteAnswers, setEssayPasteAnswers] = useState("");
  const [essayParsed, setEssayParsed] = useState([]);
  const [editEssayIdx, setEditEssayIdx] = useState(null);

  const saveData = async (nd) => {
    setData(nd);
    const ok = await saveShared("schoolPQ", nd);
    if (!ok) toast("⚠️ Saved locally but failed to sync — check connection","warn");
    return ok;
  };

  // key: classId__courseName
  const courseKey = (cid, course) => `${cid}__${course}`;
  const getCourse = (cid, course) => data[courseKey(cid,course)] || {mcq:[],essay:[]};
  const saveCourse = async (cid, course, courseData) => saveData({...data,[courseKey(cid,course)]:courseData});

  // ── MCQ parse ──
  const parseMCQ = () => {
    const blocks = pasteText.trim().split(/\n\s*\n+/).filter(b=>b.trim());
    const ansLines = pasteAnswers.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const items = blocks.map((block,idx)=>{
      const lines = block.split("\n").map(l=>l.trim()).filter(Boolean);
      let q="",options=["","","",""],ans=0,year="";
      lines.forEach(line=>{
        const ansM = line.match(/^(?:ANS|ANSWER|Ans|Answer)[.:)]\s*([A-Da-d])/i);
        const yearM = line.match(/^(?:YEAR|Year)[.:)]\s*(\d{4})/i);
        if(ansM){ans="ABCD".indexOf(ansM[1].toUpperCase());if(ans<0)ans=0;return;}
        if(yearM){year=yearM[1];return;}
        const m=line.match(/^([QqAaBbCcDd])[.):\s]\s*(.+)$/);
        if(m){
          const l2=m[1].toUpperCase();
          if(l2==="Q")q=m[2];
          else if(l2==="A")options[0]=m[2];
          else if(l2==="B")options[1]=m[2];
          else if(l2==="C")options[2]=m[2];
          else if(l2==="D")options[3]=m[2];
        } else if(!q) q=line.replace(/^\d+[.)]\s*/,"");
      });
      // Override with answers column if provided
      if (ansLines[idx]) { const a="ABCD".indexOf(ansLines[idx][0]?.toUpperCase()); if(a>=0)ans=a; }
      return {q:q.trim(),options,ans,year};
    }).filter(i=>i.q&&i.options.some(o=>o));
    setParsed(items);
    if(!items.length)toast("No questions parsed. Check format.","error");
    else toast(`${items.length} MCQ(s) parsed!`,"success");
  };

  const importMCQ = async () => {
    if(!parsed.length||!selClass||!selCourse)return;
    const cd=getCourse(selClass,selCourse);
    const nd={...data,[courseKey(selClass,selCourse)]:{...cd,mcq:[...cd.mcq,...parsed.map(p=>({...p,id:Date.now()+Math.random()}))]}};
    setData(nd);
    const ok = await saveShared("schoolPQ", nd);
    if (ok) {
      toast(`${parsed.length} MCQ(s) added & synced! ✅`,"success");
    } else {
      toast(`${parsed.length} MCQ(s) saved locally — ⚠️ sync failed`,"warn");
    }
    setParsed([]); setPasteText(""); setPasteAnswers("");
  };

  const saveSingleMCQ = () => {
    if(!singleForm.q.trim())return toast("Question required","error");
    if(!singleForm.options[0]||!singleForm.options[1])return toast("At least options A & B required","error");
    const cd=getCourse(selClass,selCourse);
    const q={q:singleForm.q.trim(),options:singleForm.options.map(o=>o.trim()),ans:singleForm.ans,year:singleForm.year,id:Date.now()};
    const mcq=editMcqIdx!==null?cd.mcq.map((qq,i)=>i===editMcqIdx?q:qq):[...cd.mcq,q];
    saveCourse(selClass,selCourse,{...cd,mcq});
    setSingleForm({q:"",options:["","","",""],ans:0,year:""});setEditMcqIdx(null);
    toast(editMcqIdx!==null?"MCQ updated":"MCQ added","success");
  };

  const delMCQ = (i) => {
    const cd=getCourse(selClass,selCourse);
    saveCourse(selClass,selCourse,{...cd,mcq:cd.mcq.filter((_,idx)=>idx!==i)});
    toast("Deleted","success");
  };

  // ── Essay parse ──
  const parseEssay = () => {
    const blocks = essayPasteText.trim().split(/\n\s*\n+/).filter(b=>b.trim());
    const ansLines = essayPasteAnswers.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const items = blocks.map((block,idx)=>{
      const lines=block.split("\n").map(l=>l.trim()).filter(Boolean);
      let q="",marks="10",modelAnswer="",year="";
      lines.forEach(line=>{
        const marksM=line.match(/^(?:MARKS?|Mark|Points?)[.:)]\s*(\d+)/i);
        const ansM=line.match(/^(?:ANSWER|MODEL\s*ANSWER|Key|Hint)[.:)]\s*(.+)/i);
        const yearM=line.match(/^(?:YEAR|Year)[.:)]\s*(\d{4})/i);
        const qM=line.match(/^(?:Q|QUESTION)[.:)]\s*(.+)/i);
        if(marksM){marks=marksM[1];return;}
        if(ansM){modelAnswer=ansM[1];return;}
        if(yearM){year=yearM[1];return;}
        if(qM){q=qM[1];return;}
        if(!q) q=line.replace(/^\d+[.)]\s*/,"");
      });
      // Override model answer with answers column if provided
      if (ansLines[idx]) modelAnswer = ansLines[idx];
      return {q:q.trim(),marks,modelAnswer,year};
    }).filter(i=>i.q);
    setEssayParsed(items);
    if(!items.length)toast("No essay questions parsed. Check format.","error");
    else toast(`${items.length} essay question(s) parsed!`,"success");
  };

  const importEssay = () => {
    if(!essayParsed.length||!selClass||!selCourse)return;
    const cd=getCourse(selClass,selCourse);
    saveCourse(selClass,selCourse,{...cd,essay:[...cd.essay,...essayParsed.map(p=>({...p,id:Date.now()+Math.random()}))]});
    setEssayParsed([]); setEssayPasteText(""); setEssayPasteAnswers(""); toast(`${essayParsed.length} essay question(s) added!`,"success");
  };

  const saveSingleEssay = () => {
    if(!essayForm.q.trim())return toast("Question required","error");
    const cd=getCourse(selClass,selCourse);
    const q={q:essayForm.q.trim(),marks:essayForm.marks,modelAnswer:essayForm.modelAnswer,year:essayForm.year,id:Date.now()};
    const essay=editEssayIdx!==null?cd.essay.map((qq,i)=>i===editEssayIdx?q:qq):[...cd.essay,q];
    saveCourse(selClass,selCourse,{...cd,essay});
    setEssayForm({q:"",marks:"10",modelAnswer:"",year:""});setEditEssayIdx(null);
    toast(editEssayIdx!==null?"Essay updated":"Essay question added","success");
  };

  const delEssay = (i) => {
    const cd=getCourse(selClass,selCourse);
    saveCourse(selClass,selCourse,{...cd,essay:cd.essay.filter((_,idx)=>idx!==i)});
    toast("Deleted","success");
  };

  const currentClass = classes.find(c=>c.id===selClass);
  const cd = selClass&&selCourse ? getCourse(selClass,selCourse) : null;

  return (
    <div>
      <div className="sec-title" style={{marginBottom:4}}>🏫 School Past Questions</div>
      <div style={{fontSize:12,color:"var(--text3)",marginBottom:18}}>Organised by class → course. Add MCQ and essay past questions. Students can practice by class and course.</div>

      {/* ── STEP 1: Select Class ── */}
      <div style={{marginBottom:16}}>
        <label className="lbl">Step 1: Select Class</label>
        <select className="inp" value={selClass||""} onChange={e=>{setSelClass(e.target.value||null);setSelCourse(null);setParsed([]);setPasteText("");setPasteAnswers("");setEssayParsed([]);setEssayPasteText("");setEssayPasteAnswers("");}}>
          <option value="">— Select a class —</option>
          {classes.map(c=><option key={c.id} value={c.id}>{c.label} — {c.desc}</option>)}
        </select>
      </div>

      {selClass && currentClass && (
        <div style={{marginBottom:16}}>
          <label className="lbl">Step 2: Select Course</label>
          <select className="inp" value={selCourse||""} onChange={e=>{setSelCourse(e.target.value||null);setParsed([]);setPasteText("");setPasteAnswers("");setEssayParsed([]);setEssayPasteText("");setEssayPasteAnswers("");setEditMcqIdx(null);setEditEssayIdx(null);}}>
            <option value="">— Select a course —</option>
            {(currentClass.courses||[]).map(course=>{
              const cData=getCourse(selClass,course);
              return <option key={course} value={course}>{course} ({cData.mcq.length} MCQ, {cData.essay.length} Essay)</option>;
            })}
          </select>
        </div>
      )}

      {selClass && selCourse && cd && (
        <div>
          {/* Class + Course breadcrumb */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,padding:"10px 14px",background:"rgba(0,119,182,.07)",borderRadius:10,border:"1px solid rgba(0,119,182,.18)",flexWrap:"wrap"}}>
            <span style={{fontSize:18}}>{currentClass?.color?<span style={{width:10,height:10,borderRadius:"50%",background:currentClass.color,display:"inline-block",marginRight:4}}/>:""}</span>
            <span style={{fontWeight:800,color:"var(--accent)"}}>{currentClass?.label}</span>
            <span style={{color:"var(--text3)"}}>›</span>
            <span style={{fontWeight:800,color:"var(--text)"}}>{selCourse}</span>
            <span style={{marginLeft:"auto",fontSize:11,color:"var(--text3)"}}>{cd.mcq.length} MCQ · {cd.essay.length} Essay</span>
          </div>

          {/* MCQ / Essay tabs */}
          <div style={{display:"flex",gap:8,marginBottom:18}}>
            {[{key:"mcq",icon:"📝",label:"MCQ Past Questions"},{key:"essay",icon:"✍️",label:"Essay Past Questions"}].map(t=>(
              <div key={t.key} onClick={()=>{setQTab(t.key);setEditMcqIdx(null);setEditEssayIdx(null);}} style={{
                flex:1,padding:"10px 14px",borderRadius:10,cursor:"pointer",transition:"all .2s",textAlign:"center",
                border:`2px solid ${qTab===t.key?"var(--accent)":"var(--border)"}`,
                background:qTab===t.key?"rgba(0,119,182,.1)":"var(--card)"}}>
                <div style={{fontSize:20,marginBottom:3}}>{t.icon}</div>
                <div style={{fontWeight:800,fontSize:13,color:qTab===t.key?"var(--accent)":"var(--text)"}}>{t.label}</div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>{t.key==="mcq"?cd.mcq.length:cd.essay.length} question{(t.key==="mcq"?cd.mcq.length:cd.essay.length)!==1?"s":""}</div>
              </div>
            ))}
          </div>

          {/* ══ MCQ SECTION ══ */}
          {qTab==="mcq"&&(
            <div>
              {/* Mode toggle */}
              <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
                <div style={{fontWeight:800,fontSize:13,flex:1,color:"var(--accent)"}}>Add MCQ Questions</div>
                <button className={`btn btn-sm${mcqMode==="single"?" btn-accent":""}`} onClick={()=>{setMcqMode("single");setEditMcqIdx(null);}}>✏️ Single</button>
                <button className={`btn btn-sm${mcqMode==="paste"?" btn-accent":""}`} onClick={()=>setMcqMode("paste")}>📋 Paste Multiple</button>
              </div>

              {/* Single MCQ form */}
              {mcqMode==="single"&&(
                <div className="card2" style={{marginBottom:14}}>
                  <div style={{fontWeight:800,marginBottom:10,fontSize:13,color:"var(--accent)"}}>{editMcqIdx!==null?`✏️ Edit Question ${editMcqIdx+1}`:"✏️ New MCQ Question"}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginBottom:8}}>
                    <div>
                      <label className="lbl">Question Text *</label>
                      <textarea className="inp" rows={3} style={{resize:"vertical",marginBottom:0}} value={singleForm.q}
                        onChange={e=>setSingleForm({...singleForm,q:e.target.value})} placeholder="Type the question here..." />
                    </div>
                    <div style={{minWidth:90}}>
                      <label className="lbl">Year</label>
                      <input className="inp" style={{marginBottom:0}} placeholder="e.g. 2023" value={singleForm.year}
                        onChange={e=>setSingleForm({...singleForm,year:e.target.value})} />
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    {["A","B","C","D"].map((l,i)=>(
                      <div key={l}>
                        <label className="lbl">Option {l}{i<2?" *":""}</label>
                        <input className="inp" style={{marginBottom:0}} placeholder={`Option ${l}...`} value={singleForm.options[i]}
                          onChange={e=>{const o=[...singleForm.options];o[i]=e.target.value;setSingleForm({...singleForm,options:o});}} />
                      </div>
                    ))}
                  </div>
                  <label className="lbl">Correct Answer *</label>
                  <select className="inp" value={singleForm.ans} onChange={e=>setSingleForm({...singleForm,ans:+e.target.value})}>
                    {["A","B","C","D"].map((l,i)=><option key={l} value={i}>Option {l}{singleForm.options[i]?`: ${singleForm.options[i]}`:""}</option>)}
                  </select>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn btn-accent" onClick={saveSingleMCQ}>{editMcqIdx!==null?"💾 Update":"➕ Add MCQ"}</button>
                    {editMcqIdx!==null&&<button className="btn" onClick={()=>{setEditMcqIdx(null);setSingleForm({q:"",options:["","","",""],ans:0,year:""});}}>Cancel</button>}
                  </div>
                </div>
              )}

              {/* Paste MCQ */}
              {mcqMode==="paste"&&(
                <div className="card2" style={{marginBottom:14}}>
                  <div style={{fontWeight:800,marginBottom:8,fontSize:13,color:"var(--accent)"}}>📋 Paste Multiple MCQ Questions</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--accent)",marginBottom:4}}>📝 Questions (with A/B/C/D options)</div>
                      <textarea className="paste-box" rows={12}
                        placeholder={"Q: Which nerve controls the diaphragm?\nA: Vagus nerve\nB: Phrenic nerve\nC: Intercostal nerve\nD: Brachial nerve\nYEAR: 2023\n\nQ: Normal CVP is:\nA: 0-2 cmH2O\nB: 2-6 cmH2O\nC: 5-10 cmH2O\nD: 10-15 cmH2O"}
                        value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsed([]);}} />
                    </div>
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ Answers (one per line: A / B / C / D)</div>
                      <textarea className="paste-box" rows={12}
                        placeholder={"B\nC"}
                        value={pasteAnswers} onChange={e=>{setPasteAnswers(e.target.value);setParsed([]);}} style={{borderColor:"rgba(34,197,94,.35)"}} />
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button className="btn btn-accent" onClick={parseMCQ}>🔍 Auto-Parse</button>
                    {parsed.length>0&&<button className="btn btn-success" onClick={importMCQ}>✅ Add {parsed.length} MCQ{parsed.length!==1?"s":""}</button>}
                    <button className="btn" onClick={()=>{setParsed([]);setPasteText("");setPasteAnswers("");}}>🗑️ Clear</button>
                  </div>
                  {parsed.length>0&&(
                    <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
                      <div style={{padding:"8px 12px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>✓ {parsed.length} parsed — review then click "Add MCQs"</div>
                      {parsed.map((p,i)=>(
                        <div key={i} style={{padding:"8px 12px",borderTop:"1px solid var(--border)"}}>
                          <div style={{fontWeight:700,fontSize:12,marginBottom:4}}>{i+1}. {p.q}{p.year?<span style={{color:"var(--text3)",fontWeight:400}}> ({p.year})</span>:""}</div>
                          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                            {p.options.filter(o=>o).map((opt,oi)=>(
                              <span key={oi} style={{fontSize:11,padding:"2px 7px",borderRadius:5,
                                background:oi===p.ans?"rgba(34,197,94,.15)":"var(--bg4)",
                                border:`1px solid ${oi===p.ans?"var(--success)":"var(--border)"}`,
                                color:oi===p.ans?"var(--success)":"var(--text3)",fontWeight:oi===p.ans?800:400
                              }}>{"ABCD"[oi]}. {opt}{oi===p.ans?" ✓":""}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* MCQ List */}
              <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>📝 {cd.mcq.length} MCQ Question{cd.mcq.length!==1?"s":""}</div>
              {cd.mcq.length===0&&<div style={{textAlign:"center",padding:20,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:10,fontSize:13}}>No MCQ questions yet. Add above.</div>}
              {cd.mcq.map((q,qi)=>(
                <div key={qi} className="card2" style={{marginBottom:8,borderLeft:`3px solid ${qi===editMcqIdx?"var(--accent)":"var(--border)"}`}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{width:24,height:24,borderRadius:7,background:"rgba(0,119,182,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"var(--accent)",flexShrink:0}}>{qi+1}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13,marginBottom:5}}>{q.q}{q.year?<span style={{fontSize:10,color:"var(--text3)",fontWeight:400,marginLeft:6}}>({q.year})</span>:""}</div>
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
                      <button className="btn btn-sm" onClick={()=>{setSingleForm({q:q.q,options:[...q.options],ans:q.ans,year:q.year||""});setEditMcqIdx(qi);setMcqMode("single");}}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={()=>delMCQ(qi)}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ══ ESSAY SECTION ══ */}
          {qTab==="essay"&&(
            <div>
              <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
                <div style={{fontWeight:800,fontSize:13,flex:1,color:"var(--purple)"}}>Add Essay Questions</div>
                <button className={`btn btn-sm${essayMode==="single"?" btn-purple":""}`} onClick={()=>{setEssayMode("single");setEditEssayIdx(null);}}>✏️ Single</button>
                <button className={`btn btn-sm${essayMode==="paste"?" btn-purple":""}`} onClick={()=>setEssayMode("paste")}>📋 Paste Multiple</button>
              </div>

              {/* Single essay form */}
              {essayMode==="single"&&(
                <div className="card2" style={{marginBottom:14,border:"1px solid rgba(124,58,237,.2)"}}>
                  <div style={{fontWeight:800,marginBottom:10,fontSize:13,color:"var(--purple)"}}>{editEssayIdx!==null?`✏️ Edit Essay Q${editEssayIdx+1}`:"✏️ New Essay Question"}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px",gap:8,marginBottom:8}}>
                    <div>
                      <label className="lbl">Question / Essay Prompt *</label>
                      <textarea className="inp" rows={3} style={{resize:"vertical",marginBottom:0}} value={essayForm.q}
                        onChange={e=>setEssayForm({...essayForm,q:e.target.value})} placeholder="Write the essay question or prompt..." />
                    </div>
                    <div>
                      <label className="lbl">Marks</label>
                      <input className="inp" style={{marginBottom:0}} type="number" min="1" max="100" value={essayForm.marks}
                        onChange={e=>setEssayForm({...essayForm,marks:e.target.value})} />
                    </div>
                    <div>
                      <label className="lbl">Year</label>
                      <input className="inp" style={{marginBottom:0}} placeholder="2023" value={essayForm.year}
                        onChange={e=>setEssayForm({...essayForm,year:e.target.value})} />
                    </div>
                  </div>
                  <label className="lbl">Model Answer / Key Points (optional)</label>
                  <textarea className="inp" rows={3} style={{resize:"vertical"}} value={essayForm.modelAnswer}
                    onChange={e=>setEssayForm({...essayForm,modelAnswer:e.target.value})}
                    placeholder="Key points students should cover in their answer..." />
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn btn-purple" onClick={saveSingleEssay}>{editEssayIdx!==null?"💾 Update":"➕ Add Essay Q"}</button>
                    {editEssayIdx!==null&&<button className="btn" onClick={()=>{setEditEssayIdx(null);setEssayForm({q:"",marks:"10",modelAnswer:"",year:""});}}>Cancel</button>}
                  </div>
                </div>
              )}

              {/* Paste essay questions */}
              {essayMode==="paste"&&(
                <div className="card2" style={{marginBottom:14,border:"1px solid rgba(124,58,237,.2)"}}>
                  <div style={{fontWeight:800,marginBottom:8,fontSize:13,color:"var(--purple)"}}>📋 Paste Multiple Essay Questions</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--purple)",marginBottom:4}}>📝 Essay Questions</div>
                      <textarea className="paste-box" rows={12}
                        placeholder={"Q: Discuss the nursing management of a patient with pulmonary tuberculosis.\nMARKS: 20\nYEAR: 2023\n\nQ: Explain the pathophysiology of heart failure and its nursing implications.\nMARKS: 15\nYEAR: 2022"}
                        value={essayPasteText} onChange={e=>{setEssayPasteText(e.target.value);setEssayParsed([]);}} />
                    </div>
                    <div>
                      <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ Model Answers / Key Points (one per line)</div>
                      <textarea className="paste-box" rows={12}
                        placeholder={"Isolation, DOTS therapy, infection control, health education\nReduced cardiac output, compensatory mechanisms, fluid management"}
                        value={essayPasteAnswers} onChange={e=>{setEssayPasteAnswers(e.target.value);setEssayParsed([]);}} style={{borderColor:"rgba(34,197,94,.35)"}} />
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button className="btn btn-purple" onClick={parseEssay}>🔍 Auto-Parse</button>
                    {essayParsed.length>0&&<button className="btn btn-success" onClick={importEssay}>✅ Add {essayParsed.length} Essay Q{essayParsed.length!==1?"s":""}</button>}
                    <button className="btn" onClick={()=>{setEssayParsed([]);setEssayPasteText("");setEssayPasteAnswers("");}}>🗑️ Clear</button>
                  </div>
                  {essayParsed.length>0&&(
                    <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
                      <div style={{padding:"8px 12px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>✓ {essayParsed.length} parsed — review then add</div>
                      {essayParsed.map((p,i)=>(
                        <div key={i} style={{padding:"8px 12px",borderTop:"1px solid var(--border)"}}>
                          <div style={{fontWeight:700,fontSize:12,marginBottom:3}}>{i+1}. {p.q}</div>
                          <div style={{fontSize:11,color:"var(--text3)"}}>
                            {p.marks&&<span style={{marginRight:10}}>📊 {p.marks} marks</span>}
                            {p.year&&<span>📅 {p.year}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Essay List */}
              <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>✍️ {cd.essay.length} Essay Question{cd.essay.length!==1?"s":""}</div>
              {cd.essay.length===0&&<div style={{textAlign:"center",padding:20,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:10,fontSize:13}}>No essay questions yet. Add above.</div>}
              {cd.essay.map((q,qi)=>(
                <div key={qi} className="card2" style={{marginBottom:8,borderLeft:`3px solid ${qi===editEssayIdx?"var(--purple)":"var(--border)"}`}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{width:24,height:24,borderRadius:7,background:"rgba(124,58,237,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"var(--purple)",flexShrink:0}}>{qi+1}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{q.q}</div>
                      <div style={{display:"flex",gap:10,fontSize:11,color:"var(--text3)",flexWrap:"wrap"}}>
                        {q.marks&&<span>📊 {q.marks} marks</span>}
                        {q.year&&<span>📅 {q.year}</span>}
                        {q.modelAnswer&&<span style={{color:"var(--success)"}}>✓ Model answer provided</span>}
                      </div>
                      {q.modelAnswer&&<div style={{fontSize:11,color:"var(--text3)",marginTop:4,padding:"4px 8px",background:"rgba(34,197,94,.05)",borderRadius:6,border:"1px solid rgba(34,197,94,.15)"}}>💡 {q.modelAnswer}</div>}
                    </div>
                    <div style={{display:"flex",gap:4,flexShrink:0}}>
                      <button className="btn btn-sm" onClick={()=>{setEssayForm({q:q.q,marks:q.marks||"10",modelAnswer:q.modelAnswer||"",year:q.year||""});setEditEssayIdx(qi);setEssayMode("single");}}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={()=>delEssay(qi)}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─── NURSING EXAM META ────────────────────────────────────────────────
const NURSING_EXAM_META = {
  general:     { key:"general",     label:"General Nursing Council Exam",  short:"General Nursing",      icon:"🏥", color:"#0077b6", desc:"Covers nursing fundamentals, anatomy, pharmacology, medical-surgical nursing and professional ethics." },
  midwifery:   { key:"midwifery",   label:"Midwifery Council Exam",        short:"Midwifery",            icon:"🤰", color:"#c2185b", desc:"Covers antenatal care, labour & delivery, postnatal care, neonatal assessment and obstetric emergencies." },
  publichealth:{ key:"publichealth",label:"Public Health Nursing Exam",    short:"Public Health Nursing", icon:"🌍", color:"#2e7d32", desc:"Covers epidemiology, disease surveillance, health promotion, immunisation and community nursing." },
};

// ─── NC DATA HELPERS ──────────────────────────────────────────────────
// data shape: data[specialty][year] = { paper1, paper2, osce }
// paper1/paper2: { questions:[{q,options,ans}], published, publishedAt }
// osce: { checklists:[{id,heading,steps:[]}], published, publishedAt }
const NC_YEARS = ["2020","2021","2022","2023","2024","2025"];
const NC_PAPER_TYPES = [
  { key:"paper1", label:"Paper 1", icon:"📄" },
  { key:"paper2", label:"Paper 2", icon:"📋" },
  { key:"osce",   label:"OSCE",    icon:"🩺" },
];
const emptyPaper  = () => ({ questions:[], published:false, publishedAt:null });
const emptyOsce   = () => ({ checklists:[], published:false, publishedAt:null });
const emptyYear   = () => ({ paper1:emptyPaper(), paper2:emptyPaper(), osce:emptyOsce() });
const getYearData = (data, spec, year) => {
  const d = (data[spec]||{})[year];
  if (!d) return emptyYear();
  return {
    paper1: d.paper1||emptyPaper(),
    paper2: d.paper2||emptyPaper(),
    osce:   d.osce||emptyOsce(),
  };
};
const setYearPaperData = (data, spec, year, paperKey, val) => {
  const specData = data[spec]||{};
  const yearData = getYearData(data, spec, year);
  return { ...data, [spec]: { ...specData, [year]: { ...yearData, [paperKey]: val } } };
};

// Check if a paper has been archived (published > 24h ago)
const isPaperArchived = (paper) => {
  if (!paper || !paper.publishedAt) return false;
  return (Date.now() - paper.publishedAt) > 24 * 60 * 60 * 1000;
};

// ═══════════════════════════════════════════════════════════════════════
// ADMIN: Nursing Council Exams Manager (Year → Paper1/Paper2/OSCE)
// ═══════════════════════════════════════════════════════════════════════
function AdminNursingExams({ toast }) {
  const [data, setData] = useSharedData("nv-nursing-exams", {});
  const [archive, setArchive] = useSharedData("nv-nc-archive", []);
  const [activeSpec, setActiveSpec] = useState("general");
  const [selYear, setSelYear] = useState("2025");
  const [selPaper, setSelPaper] = useState("paper1"); // paper1|paper2|osce

  // MCQ states
  const [mcqMode, setMcqMode] = useState("single"); // single|paste
  const [singleForm, setSingleForm] = useState({q:"",options:["","","",""],ans:0});
  const [editQIdx, setEditQIdx] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteAnswers, setPasteAnswers] = useState("");
  const [parsedMcq, setParsedMcq] = useState([]);

  // OSCE states
  const [osceText, setOsceText] = useState("");
  const [parsedOsce, setParsedOsce] = useState([]);
  const [editCheckIdx, setEditCheckIdx] = useState(null);
  const [editCheckForm, setEditCheckForm] = useState({heading:"", steps:""});

  const meta = NURSING_EXAM_META[activeSpec];
  const yearData = getYearData(data, activeSpec, selYear);
  const paperData = yearData[selPaper];

  const saveData = async (newData) => {
    setData(newData);
    const ok = await saveShared("nursingExams", newData);
    if (!ok) toast("⚠️ Saved locally but sync failed","warn");
    return ok;
  };

  const updatePaper = async (patch) => {
    const nd = setYearPaperData(data, activeSpec, selYear, selPaper, { ...paperData, ...patch });
    return saveData(nd);
  };

  // ── Archive helpers ──
  const saveArchive = async (newArr) => {
    setArchive(newArr);
    const ok = await saveShared("ncArchive", newArr);
    if (!ok) toast("⚠️ Archive saved locally — sync failed","warn");
    return ok;
  };

  const saveCurrentToArchive = async () => {
    const isOsce = selPaper === "osce";
    const pd = isOsce ? (yearData.osce||emptyOsce()) : paperData;
    const hasContent = isOsce ? (pd.checklists?.length||0)>0 : (pd.questions?.length||0)>0;
    if (!hasContent) return toast("Nothing to archive — add content first","error");
    const pt = NC_PAPER_TYPES.find(p=>p.key===selPaper);
    const entry = {
      id: `arc_${activeSpec}_${selYear}_${selPaper}_${Date.now()}`,
      type: isOsce ? "osce" : "paper",
      spec: activeSpec,
      year: selYear,
      paperKey: selPaper,
      title: `${meta.short} ${selYear} ${pt.label}`,
      savedAt: Date.now(),
      ...(isOsce ? {checklists: pd.checklists} : {questions: pd.questions}),
    };
    // Replace any existing entry for same spec/year/paper
    const filtered = archive.filter(e=>!(e.spec===activeSpec&&e.year===selYear&&e.paperKey===selPaper));
    const ok = await saveArchive([...filtered, entry]);
    toast(ok?"✅ Saved to archive! Students can retake anytime.":"✅ Saved locally","success");
  };

  // ── Delete all helpers ──
  const deleteAllQuestions = () => {
    if (!(paperData.questions?.length>0)) return toast("No questions to delete","error");
    if (!confirm(`Delete ALL ${paperData.questions.length} questions from this paper?`)) return;
    updatePaper({questions:[]});
    setEditQIdx(null); setSingleForm({q:"",options:["","","",""],ans:0});
    toast("🗑️ All questions deleted","success");
  };

  const deleteAllChecklists = () => {
    const osce = yearData.osce||emptyOsce();
    if (!(osce.checklists?.length>0)) return toast("No checklists to delete","error");
    if (!confirm(`Delete ALL ${osce.checklists.length} OSCE checklists?`)) return;
    const nd = setYearPaperData(data, activeSpec, selYear, "osce", {...osce, checklists:[]});
    saveData(nd); setEditCheckIdx(null);
    toast("🗑️ All checklists deleted","success");
  };

  // ── MCQ helpers ──
  const parseMcq = () => {
    const blocks = pasteText.trim().split(/\n\s*\n+/).filter(b=>b.trim());
    const ansLines = pasteAnswers.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const items = blocks.map((block,idx)=>{
      const lines = block.split("\n").map(l=>l.trim()).filter(Boolean);
      let q="", options=["","","",""], ans=0;
      lines.forEach(line=>{
        const ansM = line.match(/^(?:ANS|ANSWER|Ans|Answer)[.:)]\s*([A-Da-d])/i);
        if (ansM) { ans="ABCD".indexOf(ansM[1].toUpperCase()); if(ans<0)ans=0; return; }
        const m = line.match(/^([QqAaBbCcDd])[.):\s]\s*(.+)$/);
        if (m) {
          const L=m[1].toUpperCase();
          if(L==="Q")q=m[2]; else if(L==="A")options[0]=m[2]; else if(L==="B")options[1]=m[2]; else if(L==="C")options[2]=m[2]; else if(L==="D")options[3]=m[2];
        } else if(!q) q=line.replace(/^\d+[.)]\s*/,"");
      });
      if(ansLines[idx]){const a="ABCD".indexOf(ansLines[idx][0]?.toUpperCase());if(a>=0)ans=a;}
      return {q:q.trim(),options,ans};
    }).filter(i=>i.q&&i.options.some(o=>o));
    setParsedMcq(items);
    if(!items.length) toast("No questions parsed — check format","error");
    else toast(`✅ ${items.length} question(s) parsed!`,"success");
  };

  const addSingleMcq = () => {
    if(!singleForm.q.trim()) return toast("Question text required","error");
    if(!singleForm.options[0]||!singleForm.options[1]) return toast("At least options A and B required","error");
    const q={q:singleForm.q.trim(),options:singleForm.options.map(o=>o.trim()),ans:singleForm.ans};
    let qs;
    if(editQIdx!==null){ qs=paperData.questions.map((qq,i)=>i===editQIdx?q:qq); setEditQIdx(null); toast("✏️ Question updated","success"); }
    else { qs=[...paperData.questions,q]; toast("➕ Question added","success"); }
    updatePaper({questions:qs});
    setSingleForm({q:"",options:["","","",""],ans:0});
  };

  const importParsedMcq = () => {
    if(!parsedMcq.length) return;
    updatePaper({questions:[...paperData.questions,...parsedMcq]});
    setParsedMcq([]); setPasteText(""); setPasteAnswers("");
    toast(`✅ ${parsedMcq.length} questions imported!`,"success");
  };

  const deleteQ = (qi) => {
    updatePaper({questions:paperData.questions.filter((_,i)=>i!==qi)});
    toast("Deleted","success");
  };

  const publishPaper = () => {
    updatePaper({published:true,publishedAt:Date.now()});
    toast("🚀 Published! Students can see this now.","success");
  };
  const unpublishPaper = () => {
    updatePaper({published:false,publishedAt:null});
    toast("Paper unpublished","warn");
  };

  // ── OSCE helpers ──
  const parseOsce = () => {
    // Format: HEADING: <title>\n- step1\n- step2\n\nHEADING: <title>\n...
    // Also supports: ## <title> or numbered heading
    const blocks = osceText.trim().split(/\n\s*\n+/).filter(b=>b.trim());
    const items = blocks.map(block=>{
      const lines = block.split("\n").map(l=>l.trim()).filter(Boolean);
      let heading="", steps=[];
      lines.forEach((line,i)=>{
        if(i===0||line.match(/^(?:HEADING|SKILL|PROCEDURE|##|###)[:\s]/i)||
          (!line.match(/^[-•*✓\d]/)&&i===0)){
          heading=line.replace(/^(?:HEADING|SKILL|PROCEDURE|##|###)[:\s]*/i,"").replace(/^\d+[.)]\s*/,"").trim();
        } else {
          const step=line.replace(/^[-•*✓✔\d.)\s]+/,"").trim();
          if(step) steps.push(step);
        }
      });
      if(!heading&&lines.length) heading=lines[0];
      return {heading:heading.trim(),steps};
    }).filter(i=>i.heading);
    setParsedOsce(items);
    if(!items.length) toast("No checklists parsed — check format","error");
    else toast(`✅ ${items.length} checklist(s) parsed!`,"success");
  };

  const importOsce = () => {
    if(!parsedOsce.length) return;
    const newChecks = parsedOsce.map(p=>({id:Date.now()+Math.random(),heading:p.heading,steps:p.steps}));
    const osce = yearData.osce || emptyOsce();
    const nd = setYearPaperData(data,activeSpec,selYear,"osce",{...osce,checklists:[...(osce.checklists||[]),...newChecks]});
    saveData(nd);
    setParsedOsce([]); setOsceText("");
    toast(`✅ ${newChecks.length} checklist(s) added!`,"success");
  };

  const saveEditChecklist = () => {
    if(!editCheckForm.heading.trim()) return toast("Heading required","error");
    const steps = editCheckForm.steps.split("\n").map(s=>s.replace(/^[-•*✓\d.)\s]+/,"").trim()).filter(Boolean);
    const osce = yearData.osce || emptyOsce();
    const checklists = (osce.checklists||[]).map((c,i)=>
      i===editCheckIdx ? {...c,heading:editCheckForm.heading.trim(),steps} : c
    );
    const nd = setYearPaperData(data,activeSpec,selYear,"osce",{...osce,checklists});
    saveData(nd);
    setEditCheckIdx(null); setEditCheckForm({heading:"",steps:""});
    toast("✏️ Checklist updated","success");
  };

  const deleteChecklist = (ci) => {
    if(!confirm("Delete this OSCE checklist?")) return;
    const osce = yearData.osce || emptyOsce();
    const nd = setYearPaperData(data,activeSpec,selYear,"osce",{...osce,checklists:(osce.checklists||[]).filter((_,i)=>i!==ci)});
    saveData(nd);
    toast("Checklist deleted","success");
  };

  const publishOsce = () => {
    const osce = yearData.osce || emptyOsce();
    const nd = setYearPaperData(data,activeSpec,selYear,"osce",{...osce,published:true,publishedAt:Date.now()});
    saveData(nd); toast("🚀 OSCE Published!","success");
  };
  const unpublishOsce = () => {
    const osce = yearData.osce || emptyOsce();
    const nd = setYearPaperData(data,activeSpec,selYear,"osce",{...osce,published:false,publishedAt:null});
    saveData(nd); toast("OSCE Unpublished","warn");
  };

  const specKeys = Object.keys(NURSING_EXAM_META);
  const isOsce = selPaper==="osce";
  const osceData = yearData.osce || emptyOsce();
  const archived = isPaperArchived(isOsce ? osceData : paperData);

  return (
    <div>
      <div className="sec-title" style={{marginBottom:4}}>🎓 Nursing Council Exams Manager</div>
      <div style={{fontSize:12,color:"var(--text3)",marginBottom:18}}>
        Select specialty → year → paper type to add, edit or delete questions and OSCE checklists.
      </div>

      {/* ── Specialty tabs ── */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {specKeys.map(key=>{
          const m=NURSING_EXAM_META[key];
          return (
            <div key={key} onClick={()=>{setActiveSpec(key);setEditQIdx(null);setParsedMcq([]);setParsedOsce([]);setEditCheckIdx(null);}}
              style={{flex:"1 1 160px",padding:"13px 14px",borderRadius:12,cursor:"pointer",transition:"all .2s",textAlign:"center",
                border:`2px solid ${activeSpec===key?m.color:"var(--border)"}`,
                background:activeSpec===key?`${m.color}18`:"var(--card)"}}>
              <div style={{fontSize:26,marginBottom:3}}>{m.icon}</div>
              <div style={{fontWeight:800,fontSize:13,color:activeSpec===key?m.color:"var(--text)"}}>{m.short}</div>
            </div>
          );
        })}
      </div>

      {/* ── Year + Paper selectors ── */}
      <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:"1 1 160px"}}>
          <label className="lbl">📅 Year</label>
          <select className="inp" style={{marginBottom:0}} value={selYear} onChange={e=>{setSelYear(e.target.value);setEditQIdx(null);setParsedMcq([]);setEditCheckIdx(null);}}>
            {NC_YEARS.slice().reverse().map(y=>(
              <option key={y} value={y}>{y} Past Questions</option>
            ))}
          </select>
        </div>
        <div style={{flex:"1 1 220px"}}>
          <label className="lbl">📑 Paper Type</label>
          <div style={{display:"flex",gap:6}}>
            {NC_PAPER_TYPES.map(pt=>(
              <div key={pt.key} onClick={()=>{setSelPaper(pt.key);setEditQIdx(null);setParsedMcq([]);setEditCheckIdx(null);}}
                style={{flex:1,padding:"9px 10px",borderRadius:9,cursor:"pointer",textAlign:"center",transition:"all .2s",
                  border:`2px solid ${selPaper===pt.key?meta.color:"var(--border)"}`,
                  background:selPaper===pt.key?`${meta.color}15`:"var(--card)"}}>
                <div style={{fontSize:16,marginBottom:2}}>{pt.icon}</div>
                <div style={{fontWeight:800,fontSize:11,color:selPaper===pt.key?meta.color:"var(--text)"}}>{pt.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section header ── */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,padding:"12px 16px",
        background:`${meta.color}10`,borderRadius:12,border:`1.5px solid ${meta.color}30`,flexWrap:"wrap"}}>
        <div style={{width:40,height:40,borderRadius:10,background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{meta.icon}</div>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:15,color:meta.color}}>{meta.short} — {selYear} {NC_PAPER_TYPES.find(p=>p.key===selPaper)?.label}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>
            {isOsce ? `${osceData.checklists?.length||0} checklist(s)` : `${paperData.questions?.length||0} question(s)`}
            {" · "}
            {(isOsce?osceData:paperData).published ? "🟢 Published" : "📋 Draft"}
          </div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {(isOsce?osceData:paperData).published
            ? <button className="btn btn-sm btn-warn" onClick={isOsce?unpublishOsce:unpublishPaper}>⏸ Unpublish</button>
            : <button className="btn btn-sm btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}}
                onClick={isOsce?publishOsce:publishPaper}>🚀 Publish</button>
          }
          <button className="btn btn-sm" style={{borderColor:"var(--accent)",color:"var(--accent)"}}
            onClick={saveCurrentToArchive}>🗄️ Archive</button>
          {!isOsce&&(paperData.questions?.length||0)>0&&(
            <button className="btn btn-sm btn-danger" onClick={deleteAllQuestions} title="Delete all questions">🗑️ All Q</button>
          )}
          {isOsce&&(osceData.checklists?.length||0)>0&&(
            <button className="btn btn-sm btn-danger" onClick={deleteAllChecklists} title="Delete all checklists">🗑️ All</button>
          )}
        </div>
      </div>

      {/* ════ MCQ EDITOR (paper1 / paper2) ════ */}
      {!isOsce && (
        <div>
          {/* Mode tabs */}
          <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{fontWeight:800,fontSize:13,flex:1,color:meta.color}}>Add MCQ Questions</div>
            <button className={`btn btn-sm${mcqMode==="single"?" btn-accent":""}`}
              style={mcqMode==="single"?{background:meta.color,border:"none"}:{}}
              onClick={()=>{setMcqMode("single");setEditQIdx(null);}}>✏️ Single</button>
            <button className={`btn btn-sm${mcqMode==="paste"?" btn-accent":""}`}
              style={mcqMode==="paste"?{background:meta.color,border:"none"}:{}}
              onClick={()=>setMcqMode("paste")}>📋 Paste Multiple</button>
          </div>

          {/* Single form */}
          {mcqMode==="single"&&(
            <div className="card2" style={{marginBottom:14,border:`1px solid ${meta.color}30`}}>
              <div style={{fontWeight:800,marginBottom:10,fontSize:13,color:meta.color}}>
                {editQIdx!==null?`✏️ Editing Q${editQIdx+1}`:"✏️ New Question"}
              </div>
              <label className="lbl">Question Text *</label>
              <textarea className="inp" rows={3} style={{resize:"vertical"}} value={singleForm.q}
                onChange={e=>setSingleForm({...singleForm,q:e.target.value})} placeholder="Type the question here..." />
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                {["A","B","C","D"].map((L,i)=>(
                  <div key={L}>
                    <label className="lbl">Option {L}{i<2?" *":""}</label>
                    <input className="inp" style={{marginBottom:0}} placeholder={`Option ${L}...`} value={singleForm.options[i]}
                      onChange={e=>{const o=[...singleForm.options];o[i]=e.target.value;setSingleForm({...singleForm,options:o});}} />
                  </div>
                ))}
              </div>
              <label className="lbl">Correct Answer *</label>
              <select className="inp" value={singleForm.ans} onChange={e=>setSingleForm({...singleForm,ans:+e.target.value})}>
                {["A","B","C","D"].map((L,i)=><option key={L} value={i}>Option {L}{singleForm.options[i]?`: ${singleForm.options[i]}`:""}</option>)}
              </select>
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}}
                  onClick={addSingleMcq}>{editQIdx!==null?"💾 Update":"➕ Add Question"}</button>
                {editQIdx!==null&&<button className="btn" onClick={()=>{setEditQIdx(null);setSingleForm({q:"",options:["","","",""],ans:0});}}>Cancel</button>}
              </div>
            </div>
          )}

          {/* Paste form */}
          {mcqMode==="paste"&&(
            <div className="card2" style={{marginBottom:14,border:`1px solid ${meta.color}30`}}>
              <div style={{fontWeight:800,marginBottom:8,fontSize:13,color:meta.color}}>📋 Paste Multiple Questions</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:meta.color,marginBottom:4}}>📝 Questions (Q: / A: / B: / C: / D:)</div>
                  <textarea className="paste-box" rows={14}
                    placeholder={"Q: Normal adult temperature is:\nA: 35.0°C\nB: 36.1–37.2°C\nC: 38.5°C\nD: 40.0°C\n\nQ: Which organ produces insulin?\nA: Liver\nB: Kidney\nC: Pancreas\nD: Spleen"}
                    value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsedMcq([]);}} />
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ Answers (one per line: A / B / C / D)</div>
                  <textarea className="paste-box" rows={14} placeholder={"B\nC"} style={{borderColor:"rgba(34,197,94,.35)"}}
                    value={pasteAnswers} onChange={e=>{setPasteAnswers(e.target.value);setParsedMcq([]);}} />
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button className="btn btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}}
                  onClick={parseMcq}>🔍 Auto-Parse</button>
                {parsedMcq.length>0&&<button className="btn btn-success" onClick={importParsedMcq}>✅ Add {parsedMcq.length} Question{parsedMcq.length!==1?"s":""}</button>}
                <button className="btn" onClick={()=>{setParsedMcq([]);setPasteText("");setPasteAnswers("");}}>🗑️ Clear</button>
              </div>
              {parsedMcq.length>0&&(
                <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
                  <div style={{padding:"8px 14px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>
                    ✓ {parsedMcq.length} parsed — review then import
                  </div>
                  {parsedMcq.map((p,i)=>(
                    <div key={i} style={{padding:"8px 14px",borderTop:"1px solid var(--border)"}}>
                      <div style={{fontWeight:700,fontSize:12,marginBottom:5}}>{i+1}. {p.q}</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {p.options.filter(o=>o).map((opt,oi)=>(
                          <span key={oi} style={{fontSize:11,padding:"2px 8px",borderRadius:5,
                            background:oi===p.ans?"rgba(34,197,94,.15)":"var(--bg4)",
                            border:`1px solid ${oi===p.ans?"var(--success)":"var(--border)"}`,
                            color:oi===p.ans?"var(--success)":"var(--text3)",fontWeight:oi===p.ans?800:400
                          }}>{"ABCD"[oi]}. {opt}{oi===p.ans?" ✓":""}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Questions list */}
          <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>
            📋 {paperData.questions?.length||0} Question{(paperData.questions?.length||0)!==1?"s":""} in this Paper
          </div>
          {(paperData.questions?.length||0)===0&&(
            <div style={{textAlign:"center",padding:20,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:10}}>
              No questions yet — add above.
            </div>
          )}
          {(paperData.questions||[]).map((q,qi)=>(
            <div key={qi} className="card2" style={{marginBottom:8,borderLeft:`3px solid ${qi===editQIdx?meta.color:"var(--border)"}`}}>
              <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{width:26,height:26,borderRadius:7,background:`${meta.color}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:meta.color,flexShrink:0}}>{qi+1}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>{q.q}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {q.options.filter(o=>o).map((opt,oi)=>(
                      <span key={oi} style={{fontSize:11,padding:"2px 9px",borderRadius:5,
                        background:oi===q.ans?"rgba(34,197,94,.12)":"transparent",
                        border:`1px solid ${oi===q.ans?"var(--success)":"var(--border)"}`,
                        color:oi===q.ans?"var(--success)":"var(--text3)",fontWeight:oi===q.ans?800:400
                      }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}</span>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <button className="btn btn-sm" onClick={()=>{setSingleForm({q:q.q,options:[...q.options],ans:q.ans});setEditQIdx(qi);setMcqMode("single");}}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>deleteQ(qi)}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════ OSCE EDITOR ════ */}
      {isOsce && (
        <div>
          {/* Paste area */}
          <div className="card2" style={{marginBottom:16,border:`1px solid ${meta.color}30`}}>
            <div style={{fontWeight:800,fontSize:13,color:meta.color,marginBottom:8}}>🩺 Add OSCE Checklists</div>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:10,lineHeight:1.6}}>
              Paste one or more checklists below. Separate checklists with a blank line.<br/>
              First line of each block = the skill heading. Remaining lines (starting with - or • or numbers) = procedure steps.
            </div>
            <div style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",marginBottom:10,fontSize:12,color:"var(--text3)"}}>
              <div style={{fontWeight:800,marginBottom:5}}>📋 Format example:</div>
              <pre style={{fontFamily:"monospace",fontSize:11,margin:0,whiteSpace:"pre-wrap",opacity:.85}}>{`Venepuncture / Blood Collection
- Wash hands and don PPE
- Verify patient identity and consent
- Select appropriate vein (antecubital fossa)
- Apply tourniquet 5–10 cm above site
- Clean site with 70% alcohol swab, allow to dry
- Insert needle at 15–30° angle, bevel up
- Collect required blood into correct tubes
- Release tourniquet before withdrawing needle
- Apply pressure and dispose of sharps safely

Urinary Catheterisation (Male)
- Explain procedure and obtain consent
- Assemble sterile catheterisation pack
- Clean urethral meatus with antiseptic
- Apply sterile draping
- Insert lubricated catheter gently
- Inflate balloon with sterile water (10 mL)
- Attach drainage bag and secure catheter`}</pre>
            </div>
            <textarea className="inp" rows={14} style={{fontFamily:"monospace",fontSize:12,resize:"vertical"}}
              value={osceText} onChange={e=>{setOsceText(e.target.value);setParsedOsce([]);}}
              placeholder="Paste your OSCE checklists here..." />
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:4}}>
              <button className="btn btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}}
                onClick={parseOsce}>🔍 Auto-Parse Checklists</button>
              {parsedOsce.length>0&&<button className="btn btn-success" onClick={importOsce}>✅ Add {parsedOsce.length} Checklist{parsedOsce.length!==1?"s":""}</button>}
              <button className="btn" onClick={()=>{setParsedOsce([]);setOsceText("");}}>🗑️ Clear</button>
            </div>
            {parsedOsce.length>0&&(
              <div style={{marginTop:12,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
                <div style={{padding:"8px 14px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>
                  ✓ {parsedOsce.length} checklist{parsedOsce.length!==1?"s":""} parsed — review then import
                </div>
                {parsedOsce.map((c,i)=>(
                  <div key={i} style={{padding:"10px 14px",borderTop:"1px solid var(--border)"}}>
                    <div style={{fontWeight:800,fontSize:13,color:meta.color,marginBottom:6}}>🩺 {c.heading}</div>
                    {c.steps.map((s,si)=>(
                      <div key={si} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:12,marginBottom:3}}>
                        <span style={{color:"var(--success)",flexShrink:0,marginTop:1}}>✓</span>
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Edit checklist inline */}
          {editCheckIdx!==null&&(
            <div className="card2" style={{marginBottom:14,border:`2px solid ${meta.color}`,background:`${meta.color}07`}}>
              <div style={{fontWeight:800,fontSize:13,color:meta.color,marginBottom:10}}>✏️ Edit Checklist</div>
              <label className="lbl">Skill / Procedure Heading *</label>
              <input className="inp" value={editCheckForm.heading} onChange={e=>setEditCheckForm({...editCheckForm,heading:e.target.value})} placeholder="e.g. Venepuncture / Blood Collection" />
              <label className="lbl">Procedure Steps (one step per line)</label>
              <textarea className="inp" rows={10} style={{fontFamily:"monospace",fontSize:12,resize:"vertical"}}
                value={editCheckForm.steps} onChange={e=>setEditCheckForm({...editCheckForm,steps:e.target.value})}
                placeholder={"- Wash hands and don PPE\n- Verify patient identity\n- Explain procedure..."} />
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}} onClick={saveEditChecklist}>💾 Save Changes</button>
                <button className="btn" onClick={()=>{setEditCheckIdx(null);setEditCheckForm({heading:"",steps:""});}}>Cancel</button>
              </div>
            </div>
          )}

          {/* Checklists list */}
          <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>
            🩺 {osceData.checklists?.length||0} OSCE Checklist{(osceData.checklists?.length||0)!==1?"s":""}
          </div>
          {(osceData.checklists?.length||0)===0&&(
            <div style={{textAlign:"center",padding:20,color:"var(--text3)",fontSize:13,border:"1px dashed var(--border)",borderRadius:10}}>
              No OSCE checklists yet — paste and import above.
            </div>
          )}
          {(osceData.checklists||[]).map((c,ci)=>(
            <div key={c.id||ci} className="card2" style={{marginBottom:10,borderLeft:`3px solid ${ci===editCheckIdx?meta.color:"var(--border)"}`}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:800,fontSize:14,color:meta.color,marginBottom:8}}>🩺 {c.heading}</div>
                  {c.steps.map((s,si)=>(
                    <div key={si} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:13,marginBottom:4}}>
                      <span style={{color:"var(--success)",flexShrink:0,marginTop:1}}>✓</span>
                      <span style={{color:"var(--text2)"}}>{s}</span>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <button className="btn btn-sm" onClick={()=>{
                    setEditCheckIdx(ci);
                    setEditCheckForm({heading:c.heading, steps:c.steps.join("\n")});
                  }}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>deleteChecklist(ci)}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// STUDENT: Nursing Exams View (Year dropdown → Paper1/Paper2/OSCE)
// ═══════════════════════════════════════════════════════════════════════
function NursingExamsView({ toast, currentUser, initialExam, isAdmin }) {
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
      onBack={()=>{setMode(null);setActivePaper(null);}} />;
  }
  if (mode==="review" && activePaper) {
    return <NursingReviewMode paper={activePaper} meta={meta} onBack={()=>{setMode(null);setActivePaper(null);}} />;
  }
  if (mode==="osce" && activePaper) {
    return <NursingOsceView osce={activePaper} meta={meta} year={selYear}
      onBack={()=>{setMode(null);setActivePaper(null);setSelPaper(null);}} />;
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

      {/* Year dropdown */}
      <div style={{marginBottom:18}}>
        <label className="lbl">📅 Select Year</label>
        <select className="inp" style={{maxWidth:280}} value={selYear} onChange={e=>{setSelYear(e.target.value);setSelPaper(null);}}>
          {NC_YEARS.slice().reverse().map(y=>{
            const cnt = getYearSummary(activeSpec, y);
            return <option key={y} value={y}>{y} Past Questions{cnt>0?` (${cnt} available)`:""}</option>;
          })}
        </select>
      </div>

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
                {visible&&archived&&" · 🗃️"}
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
                  {archived&&" · 🗃️ Archived"}
                </div>
              </div>
              {archived&&<span className="tag" style={{borderColor:"var(--text3)",color:"var(--text3)"}}>🗃️ Archive</span>}
            </div>

            {selPaper!=="osce"&&(
              <>
                {att&&(
                  <div style={{marginBottom:14,padding:"10px 14px",background:`${att.pct>=70?"rgba(34,197,94,.07)":att.pct>=50?"rgba(251,146,60,.07)":"rgba(239,68,68,.07)"}`,borderRadius:10,border:`1px solid ${att.pct>=70?"var(--success)":att.pct>=50?"var(--warn)":"var(--danger)"}`}}>
                    <div style={{fontWeight:800,fontSize:13}}>Your Score: <span style={{color:att.pct>=70?"var(--success)":att.pct>=50?"var(--warn)":"var(--danger)"}}>{att.score}/{att.total} — {att.pct}%</span></div>
                    <div style={{fontSize:10,color:"var(--text3)",marginTop:2}}>Taken {att.date} · 🔒 1 attempt used</div>
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
function NursingOsceView({ osce, meta, year, onBack }) {
  const [ticked, setTicked] = useState({});
  const [expandAll, setExpandAll] = useState(true);
  const [expanded, setExpanded] = useState({});

  const toggle = (ci, si) => {
    const key = `${ci}-${si}`;
    setTicked(t=>({...t,[key]:!t[key]}));
  };
  const toggleSection = (ci) => setExpanded(e=>({...e,[ci]:!e[ci]}));

  const checklists = osce.checklists || [];
  const totalSteps = checklists.reduce((s,c)=>s+c.steps.length,0);
  const tickedCount = Object.values(ticked).filter(Boolean).length;

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,flexWrap:"wrap"}}>
        <button className="btn btn-sm" onClick={onBack}>← Back</button>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:16,color:meta.color}}>{meta.icon} {meta.short} — {year} OSCE</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>Clinical Skills Checklists · {checklists.length} skill{checklists.length!==1?"s":""}</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn btn-sm" onClick={()=>{setExpandAll(true);setExpanded({});}}>Expand All</button>
          <button className="btn btn-sm" onClick={()=>{setExpandAll(false);setExpanded(checklists.reduce((o,_,i)=>({...o,[i]:true}),{}));}}>Collapse All</button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="card" style={{marginBottom:18,padding:"14px 18px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontWeight:800,fontSize:13}}>Practice Progress</div>
          <div style={{fontWeight:800,fontSize:13,color:meta.color}}>{tickedCount}/{totalSteps}</div>
        </div>
        <div className="progress-wrap">
          <div className="progress-fill" style={{width:`${totalSteps>0?(tickedCount/totalSteps)*100:0}%`,background:`linear-gradient(90deg,${meta.color},${meta.color}bb)`}} />
        </div>
        <div style={{fontSize:10,color:"var(--text3)",marginTop:5}}>Tick each step as you practise — progress resets on refresh</div>
      </div>

      {checklists.map((c,ci)=>{
        const isCollapsed = expandAll ? (expanded[ci]===true) : (expanded[ci]!==true);
        const stepsTickedHere = c.steps.filter((_,si)=>ticked[`${ci}-${si}`]).length;
        return (
          <div key={c.id||ci} className="card" style={{marginBottom:14,borderLeft:`4px solid ${meta.color}`}}>
            {/* Checklist heading */}
            <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"2px 0"}}
              onClick={()=>toggleSection(ci)}>
              <div style={{width:36,height:36,borderRadius:9,background:`${meta.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🩺</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:15,color:meta.color}}>{c.heading}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>{stepsTickedHere}/{c.steps.length} steps checked</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {stepsTickedHere===c.steps.length&&c.steps.length>0&&<span style={{fontSize:11,fontWeight:700,color:"var(--success)"}}>✅ Complete</span>}
                <span style={{fontSize:13,color:"var(--text3)",transition:"transform .2s",display:"inline-block",transform:isCollapsed?"rotate(-90deg)":"rotate(0deg)"}}>▾</span>
              </div>
            </div>

            {!isCollapsed&&(
              <div style={{marginTop:14,borderTop:"1px solid var(--border)",paddingTop:12}}>
                {c.steps.map((step,si)=>{
                  const key=`${ci}-${si}`;
                  const done=!!ticked[key];
                  return (
                    <div key={si} onClick={()=>toggle(ci,si)}
                      style={{display:"flex",alignItems:"flex-start",gap:12,padding:"9px 8px",borderRadius:8,cursor:"pointer",
                        background:done?`${meta.color}08`:"transparent",marginBottom:3,transition:"background .15s",
                        border:`1px solid ${done?meta.color+"30":"transparent"}`}}>
                      <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${done?meta.color:"var(--border2)"}`,
                        background:done?meta.color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",
                        flexShrink:0,transition:"all .2s",marginTop:1}}>
                        {done&&<span style={{color:"white",fontSize:12,fontWeight:800}}>✓</span>}
                      </div>
                      <div style={{fontSize:14,fontWeight:done?700:500,color:done?"var(--text)":"var(--text2)",
                        textDecoration:done?"none":"none",lineHeight:1.5}}>
                        {step}
                      </div>
                    </div>
                  );
                })}
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
function NursingMCQExam({ toast, currentUser, paper, meta, onBack }) {
  const attKey = `nv-ne-att-${currentUser}`;
  const [answers, setAnswers] = useState(new Array(paper.questions.length).fill(null));
  const [qIdx, setQIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [finalAnswers, setFinalAnswers] = useState([]);

  const submitExam = () => {
    const unanswered = answers.filter(a=>a===null).length;
    if (unanswered>0&&!confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) return;
    const snap=[...answers];
    const score=paper.questions.reduce((s,q,i)=>snap[i]===q.ans?s+1:s,0);
    const pct=Math.round((score/paper.questions.length)*100);
    const att=ls(attKey,{});
    att[String(paper.id)]={score,total:paper.questions.length,pct,answers:snap,date:new Date().toLocaleDateString()};
    lsSet(attKey,att);
    const results=ls("nv-results",[]);
    lsSet("nv-results",[...results,{id:Date.now(),subject:paper.title,type:`${meta.short} Exam`,score,total:paper.questions.length,pct,date:new Date().toLocaleDateString()}]);
    setFinalAnswers(snap); setDone(true);
    toast("Exam submitted! Your results are saved.","success");
  };

  if (done) {
    const score=paper.questions.reduce((s,q,i)=>finalAnswers[i]===q.ans?s+1:s,0);
    const pct=Math.round((score/paper.questions.length)*100);
    return (
      <div style={{maxWidth:620,margin:"0 auto"}}>
        <div style={{textAlign:"center",padding:"28px 0 20px"}}>
          <div style={{fontSize:52,marginBottom:8}}>{pct>=70?"🎉":pct>=50?"👍":"📚"}</div>
          <div style={{fontWeight:800,fontSize:20,marginBottom:4}}>Exam Complete!</div>
          <div style={{fontWeight:800,fontSize:48,color:pct>=70?"var(--success)":pct>=50?"var(--warn)":"var(--danger)",lineHeight:1}}>{score}/{paper.questions.length}</div>
          <div style={{fontSize:20,marginBottom:4}}>{pct}%</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>🔒 1 attempt used — contact admin to reset</div>
        </div>
        <div style={{marginTop:14}}>
          {paper.questions.map((q,i)=>{
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

  const q=paper.questions[qIdx];
  const answeredCount=answers.filter(a=>a!==null).length;
  return (
    <div style={{maxWidth:600,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:meta.color}}>{meta.icon} {paper.title}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>{answeredCount}/{paper.questions.length} answered · click any number to jump</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-sm" onClick={onBack}>✕ Exit</button>
          <button className="btn btn-sm btn-accent" style={{background:`linear-gradient(135deg,${meta.color},${meta.color}bb)`,border:"none"}} onClick={submitExam}>Submit ✓</button>
        </div>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
        {paper.questions.map((_,i)=>(
          <div key={i} onClick={()=>setQIdx(i)} style={{width:30,height:30,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11,fontWeight:700,transition:"all .15s",
            background:i===qIdx?meta.color:answers[i]!==null?"rgba(34,197,94,.12)":"var(--bg4)",
            border:`2px solid ${i===qIdx?meta.color:answers[i]!==null?"var(--success)":"var(--border)"}`,
            color:i===qIdx?"white":answers[i]!==null?"var(--success)":"var(--text3)"
          }}>{i+1}</div>
        ))}
      </div>
      <div className="progress-wrap" style={{marginBottom:14}}>
        <div className="progress-fill" style={{width:`${(answeredCount/paper.questions.length)*100}%`,background:meta.color}} />
      </div>
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Question {qIdx+1} of {paper.questions.length}</div>
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
function NursingReviewMode({ paper, meta, onBack }) {
  const [showAns, setShowAns] = useState({});
  const [search, setSearch] = useState("");
  const allQ = paper.questions;
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
function SchoolPastQuestionsView({ toast, currentUser }) {
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
                <span className="tag" style={{marginLeft:"auto"}}>{cd.mcq.length} MCQ · {cd.essay.length} Essay</span>
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
                        <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>Timed · score tracked · 1 attempt</div>
                      </div>
                      <div className="card" style={{flex:1,minWidth:160,textAlign:"center",padding:"16px 12px",cursor:"pointer",borderTop:"3px solid var(--purple)"}}
                        onClick={()=>{setExamPaper({questions:cd.mcq,title:`${selCourse} — Review Mode`,courseKey:ck(selClass,selCourse),classLabel:currentClass.label,course:selCourse});setExamMode("review");}}>
                        <div style={{fontSize:28,marginBottom:6}}>📖</div>
                        <div style={{fontWeight:800,fontSize:13,color:"var(--purple)"}}>Review Mode</div>
                        <div style={{fontSize:11,color:"var(--text3)",marginTop:3}}>See answers · no attempt limit</div>
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
function SchoolMCQExam({ toast, currentUser, paper, onBack }) {
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
    lsSet(attKey,att);
    const results=ls("nv-results",[]);
    lsSet("nv-results",[...results,{id:Date.now(),subject:paper.title,type:"School Past Q",score,total:paper.questions.length,pct,date:new Date().toLocaleDateString()}]);
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
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>Question {qIdx+1} of {paper.questions.length}{q.year?` · ${q.year}`:""}</div>
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
function SchoolMCQReview({ paper, onBack }) {
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
function SchoolOnlyPastQuestionsView({ toast, currentUser }) {
  const [tab, setTab] = useState("school");
  const [mcqBanks] = useSharedData("nv-pq", DEFAULT_PQ);
  const [essayBanks] = useSharedData("nv-essay-banks", []);
  const TABS = [
    {key:"school", icon:"🏫", label:"School Past Questions", sub:"Browse by class & course"},
    {key:"mcq", icon:"📝", label:"General MCQ Banks", sub:"Admin-uploaded question sets"},
    {key:"essay", icon:"✍️", label:"Essay Exams", sub:"Long answer · AI graded"},
  ];
  return (
    <div>
      <div style={{marginBottom:20}}>
        <div className="sec-title">🏫 School Past Questions</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>School past questions organised by class & course, plus MCQ banks and essay exams.</div>
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
      {tab==="mcq" && <MCQExamView toast={toast} currentUser={currentUser} banks={mcqBanks} />}
      {tab==="essay" && <EssayExamView toast={toast} currentUser={currentUser} essayBanks={essayBanks} />}
    </div>
  );
}

// ─── STUDENT: Nursing Council Exams Only (sidebar nav) ───────────────────
function NursingExamsStandaloneView({ toast, currentUser, initialExam }) {
  return (
    <div>
      <div style={{marginBottom:20}}>
        <div className="sec-title">🎓 Nursing Council Exams</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>GNC · Midwifery · Public Health Nursing past papers and live exam sessions.</div>
      </div>
      <NursingExamsView toast={toast} currentUser={currentUser} initialExam={initialExam} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ─── MAIN: Past Questions Page (tabs: School PQ + Nursing Exams) ──────
function PastQuestionsView({ toast, currentUser }) {
  const [tab, setTab] = useState("school");
  const [mcqBanks] = useSharedData("nv-pq", DEFAULT_PQ);
  const [essayBanks] = useSharedData("nv-essay-banks", []);

  const TABS = [
    {key:"school", icon:"🏫", label:"School Past Questions", sub:"Browse by class & course"},
    {key:"nursing", icon:"🎓", label:"Nursing Council Exams", sub:"GNC · Midwifery · Public Health"},
    {key:"mcq", icon:"📝", label:"General MCQ Banks", sub:"Admin-uploaded question sets"},
    {key:"essay", icon:"✍️", label:"Essay Exams", sub:"Long answer · AI graded"},
  ];

  return (
    <div>
      <div style={{marginBottom:20}}>
        <div className="sec-title">📚 Past Questions & Exams</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>School past questions organised by class & course. Nursing exams and MCQ banks also available.</div>
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
      {tab==="mcq" && <MCQExamView toast={toast} currentUser={currentUser} banks={mcqBanks} />}
      {tab==="essay" && <EssayExamView toast={toast} currentUser={currentUser} essayBanks={essayBanks} />}
    </div>
  );
}

function DrugGuideView() {
  const [drugs, setDrugs] = useSharedData("nv-drugs", DEFAULT_DRUGS);
  const [search, setSearch] = useState(""); const [sel, setSel] = useState(null);
  const [sdSel, setSdSel] = useState(new Set());
  const filtered = drugs.filter(d=>d.name.toLowerCase().includes(search.toLowerCase())||d.class.toLowerCase().includes(search.toLowerCase()));
  const sdDel = (id,e) => { if(e)e.stopPropagation(); const u=drugs.filter(d=>d.id!==id); setDrugs(u); saveShared("drugs",u); setSdSel(s=>{const n=new Set(s);n.delete(id);return n;}); if(sel?.id===id)setSel(null); };
  const sdDelSel = () => { if(!sdSel.size)return; const u=drugs.filter(d=>!sdSel.has(d.id)); setDrugs(u); saveShared("drugs",u); setSdSel(new Set()); };
  const sdAllFilt = filtered.length>0 && filtered.every(d=>sdSel.has(d.id));
  const sdTogAll = () => { if(sdAllFilt){setSdSel(s=>{const n=new Set(s);filtered.forEach(d=>n.delete(d.id));return n;});}else{setSdSel(s=>{const n=new Set(s);filtered.forEach(d=>n.add(d.id));return n;});} };
  return(
    <div>
      <div className="sec-title">💊 Drug Guide</div>
      <div className="sec-sub">Quick reference for medications</div>
      {sdSel.size>0&&(
        <div className="bulk-bar">
          <span className="bulk-bar-count">☑ {sdSel.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={sdDelSel}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={()=>setSdSel(new Set())}>✕ Clear</button>
        </div>
      )}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <div className="search-wrap" style={{flex:1,marginBottom:0}}><span className="search-ico">🔍</span><input placeholder="Search drugs..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
        {filtered.length>0&&<label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"var(--text3)",cursor:"pointer",whiteSpace:"nowrap"}}><input type="checkbox" className="cb-all" checked={sdAllFilt} onChange={sdTogAll} />Select all</label>}
      </div>
      <div className="grid2">
        {filtered.map((d,i)=>(
          <div key={d.id} className="card" style={{cursor:"pointer",animation:`fadeUp .3s ease ${i*.05}s both`,outline:sdSel.has(d.id)?"2px solid var(--danger)":"none"}} onClick={()=>setSel(d)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:7}}>
                <input type="checkbox" className="cb-row" checked={sdSel.has(d.id)} onChange={e=>{e.stopPropagation();setSdSel(s=>{const n=new Set(s);n.has(d.id)?n.delete(d.id):n.add(d.id);return n;});}} onClick={e=>e.stopPropagation()} />
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15}}>{d.name}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span className="tag tag-accent">{d.class?.split("/")[0]}</span>
                <button className="btn btn-sm btn-danger" style={{padding:"2px 7px"}} onClick={e=>sdDel(d.id,e)}>🗑️</button>
              </div>
            </div>
            <div style={{fontSize:12,color:"var(--text3)"}}><b style={{color:"var(--text2)"}}>Dose:</b> {d.dose}</div>
            <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}><b style={{color:"var(--text2)"}}>Uses:</b> {d.uses}</div>
          </div>
        ))}
      </div>
      {sel&&(
        <div className="modal-overlay" onClick={()=>setSel(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-head"><div className="modal-title">{sel.name}</div><button className="modal-close" onClick={()=>setSel(null)}>✕</button></div>
            <span className="tag tag-accent" style={{marginBottom:16,display:"inline-block"}}>{sel.class}</span>
            {[["💊 Dose",sel.dose],["📊 Max",sel.max],["✅ Uses",sel.uses],["⚠️ Contraindications",sel.contraindications],["⚡ Side Effects",sel.side_effects]].map(([l,v])=>(
              <div key={l} style={{marginBottom:14}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:"1px"}}>{l}</div>
                <div style={{fontSize:14,color:"var(--text2)"}}>{v||"—"}</div>
              </div>
            ))}
            <button className="btn btn-sm btn-danger" style={{marginTop:8,width:"100%"}} onClick={()=>{sdDel(sel.id,null);setSel(null);}}>🗑️ Delete This Drug</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LabReferenceView() {
  const [labs, setLabs] = useSharedData("nv-labs", DEFAULT_LABS);
  const [search, setSearch] = useState("");
  const [slSel, setSlSel] = useState(new Set());
  const filtered = labs.filter(l=>l.test.toLowerCase().includes(search.toLowerCase()));
  const slDel = (id) => { const u=labs.filter(l=>l.id!==id); setLabs(u); saveShared("labs",u); setSlSel(s=>{const n=new Set(s);n.delete(id);return n;}); };
  const slDelSel = () => { if(!slSel.size)return; const u=labs.filter(l=>!slSel.has(l.id)); setLabs(u); saveShared("labs",u); setSlSel(new Set()); };
  const slAllFilt = filtered.length>0 && filtered.every(l=>slSel.has(l.id));
  const slTogAll = () => { if(slAllFilt){setSlSel(s=>{const n=new Set(s);filtered.forEach(l=>n.delete(l.id));return n;});}else{setSlSel(s=>{const n=new Set(s);filtered.forEach(l=>n.add(l.id));return n;});} };
  return(
    <div>
      <div className="sec-title">🧪 Lab Reference</div>
      <div className="sec-sub">Normal laboratory values</div>
      {slSel.size>0&&(
        <div className="bulk-bar">
          <span className="bulk-bar-count">☑ {slSel.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={slDelSel}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={()=>setSlSel(new Set())}>✕ Clear</button>
        </div>
      )}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <div className="search-wrap" style={{flex:1,marginBottom:0}}><span className="search-ico">🔍</span><input placeholder="Search test name..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
        {filtered.length>0&&<label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"var(--text3)",cursor:"pointer",whiteSpace:"nowrap"}}><input type="checkbox" className="cb-all" checked={slAllFilt} onChange={slTogAll} />Select all</label>}
      </div>
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <table className="tbl">
          <thead><tr>
            <th style={{width:36,padding:'10px 8px'}}><input type="checkbox" className="cb-all" checked={slAllFilt} onChange={slTogAll} /></th>
            <th>Test</th><th>Male</th><th>Female</th><th>Notes</th><th style={{width:52}}></th>
          </tr></thead>
          <tbody>
            {filtered.map(r=>(
              <tr key={r.id} style={{background:slSel.has(r.id)?"rgba(239,68,68,.04)":""}}>
                <td style={{padding:'8px'}}><input type="checkbox" className="cb-row" checked={slSel.has(r.id)} onChange={()=>setSlSel(s=>{const n=new Set(s);n.has(r.id)?n.delete(r.id):n.add(r.id);return n;})} /></td>
                <td style={{fontWeight:700}}>{r.test}</td>
                <td style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--accent)"}}>{r.male}</td>
                <td style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--accent2)"}}>{r.female}</td>
                <td style={{fontSize:12,color:"var(--text3)"}}>{r.notes}</td>
                <td><button className="btn btn-sm btn-danger" style={{padding:"3px 8px"}} onClick={()=>slDel(r.id)}>🗑️</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SkillsView() {
  const [skillsDb, setSkillsDb] = useSharedData("nv-skillsdb", DEFAULT_SKILLS);
  const [done, setDone] = useState(()=>ls("nv-skills-done",{}));
  const [ssSel, setSsSel] = useState(new Set());
  const toggle=(id)=>{const u={...done,[id]:!done[id]};setDone(u);saveMyData("skills-done","nv-skills-done",u);};
  const ssDel=(id,e)=>{e.stopPropagation();const u=skillsDb.filter(s=>s.id!==id);setSkillsDb(u);saveShared("skills",u);setSsSel(s=>{const n=new Set(s);n.delete(id);return n;});};
  const ssDelSel=()=>{if(!ssSel.size)return;const u=skillsDb.filter(s=>!ssSel.has(s.id));setSkillsDb(u);saveShared("skills",u);setSsSel(new Set());};
  const ssAll=skillsDb.length>0&&skillsDb.every(s=>ssSel.has(s.id));
  const count = skillsDb.filter(s=>done[s.id]).length;
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <div className="sec-title" style={{marginBottom:0}}>✅ Skills Checklist</div>
        <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"var(--text3)",cursor:"pointer"}}>
          <input type="checkbox" className="cb-all" checked={ssAll} onChange={()=>{if(ssAll){setSsSel(new Set());}else{setSsSel(new Set(skillsDb.map(s=>s.id)));}}} />
          All
        </label>
      </div>
      <div className="sec-sub">Track clinical competencies</div>
      {ssSel.size>0&&(
        <div className="bulk-bar">
          <span className="bulk-bar-count">☑ {ssSel.size} selected</span>
          <button className="btn btn-sm btn-danger" onClick={ssDelSel}>🗑️ Delete Selected</button>
          <button className="btn btn-sm" onClick={()=>setSsSel(new Set())}>✕ Clear</button>
        </div>
      )}
      <div className="card" style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:12,color:"var(--text3)"}}>Progress</span>
          <span style={{fontSize:12,color:"var(--accent)"}}>{count}/{skillsDb.length}</span>
        </div>
        <div className="progress-wrap"><div className="progress-fill" style={{width:`${skillsDb.length>0?(count/skillsDb.length)*100:0}%`,background:"linear-gradient(90deg,var(--accent),var(--accent2))"}} /></div>
      </div>
      {skillsDb.map(s=>(
        <div key={s.id} className="card2" style={{marginBottom:8,display:"flex",alignItems:"center",gap:12,cursor:"pointer",opacity:done[s.id]?.6:1,outline:ssSel.has(s.id)?"2px solid var(--danger)":"none"}} onClick={()=>toggle(s.id)}>
          <input type="checkbox" className="cb-row" checked={ssSel.has(s.id)} onChange={e=>{e.stopPropagation();setSsSel(ss=>{const n=new Set(ss);n.has(s.id)?n.delete(s.id):n.add(s.id);return n;});}} onClick={e=>e.stopPropagation()} />
          <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${done[s.id]?"var(--success)":"var(--border2)"}`,background:done[s.id]?"var(--success)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .2s"}}>{done[s.id]&&<span style={{fontSize:12,color:"white"}}>✓</span>}</div>
          <div style={{fontSize:14,fontWeight:500,textDecoration:done[s.id]?"line-through":"none",flex:1}}>{s.name}</div>
          {done[s.id]&&<span className="tag tag-success">Done</span>}
          <button className="btn btn-sm btn-danger" style={{padding:"2px 7px",flexShrink:0}} onClick={e=>ssDel(s.id,e)}>🗑️</button>
        </div>
      ))}
    </div>
  );
}

function GPACalc({ toast }) {
  const [courses, setCourses] = useState(()=>ls("nv-gpa-courses",[]));
  const [form, setForm] = useState({name:"",units:"",grade:""});
  const GRADES=[{l:"A",p:"5.0"},{l:"B",p:"4.0"},{l:"C",p:"3.0"},{l:"D",p:"2.0"},{l:"E",p:"1.0"},{l:"F",p:"0.0"}];
  const [gpaSel, setGpaSel] = useState(new Set());
  const add=()=>{if(!form.name||!form.units||!form.grade)return toast("Fill all fields","error");const u=[...courses,{...form,id:Date.now(),units:+form.units,grade:+form.grade}];setCourses(u);saveMyData("gpa-courses","nv-gpa-courses",u);setForm({name:"",units:"",grade:""});};
  const gpaDelOne=(id)=>{const u=courses.filter(x=>x.id!==id);setCourses(u);saveMyData("gpa-courses","nv-gpa-courses",u);setGpaSel(s=>{const n=new Set(s);n.delete(id);return n;});};
  const gpaDelSel=()=>{if(!gpaSel.size)return;const u=courses.filter(c=>!gpaSel.has(c.id));setCourses(u);saveMyData("gpa-courses","nv-gpa-courses",u);setGpaSel(new Set());};
  const gpaAll=courses.length>0&&courses.every(c=>gpaSel.has(c.id));
  const tp=courses.reduce((s,c)=>s+c.units*c.grade,0),tu=courses.reduce((s,c)=>s+c.units,0),gpa=tu>0?tp/tu:0;
  const cls=gpa>=4.5?"First Class":gpa>=3.5?"Second Class Upper":gpa>=2.5?"Second Class Lower":gpa>=1.5?"Third Class":"Fail";
  const clsColor=gpa>=4.5?"var(--accent)":gpa>=3.5?"var(--accent2)":gpa>=2.5?"var(--warn)":"var(--danger)";
  return<div><div className="sec-title">🎓 GPA Calculator</div><div className="sec-sub">5.0 scale</div>{courses.length>0&&<div className="card" style={{marginBottom:18,textAlign:"center"}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"var(--text3)",marginBottom:6,textTransform:"uppercase",letterSpacing:"1px"}}>Your GPA</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:56,fontWeight:800,color:"var(--accent)"}}>{gpa.toFixed(2)}</div><div style={{fontSize:16,color:clsColor,fontWeight:600,marginBottom:8}}>{cls}</div><div className="gpa-bar-wrap"><div className="gpa-bar" style={{width:`${(gpa/5)*100}%`}} /></div></div>}<div className="card" style={{marginBottom:14}}><div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,marginBottom:12}}>Add Course</div><div className="grid3" style={{gap:10,alignItems:"end"}}><div><label className="lbl">Course</label><input className="inp" style={{marginBottom:0}} placeholder="Pharmacology" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></div><div><label className="lbl">Units</label><input className="inp" style={{marginBottom:0}} type="number" min="1" max="6" value={form.units} onChange={e=>setForm({...form,units:e.target.value})} /></div><div><label className="lbl">Grade</label><select className="inp" style={{marginBottom:0}} value={form.grade} onChange={e=>setForm({...form,grade:e.target.value})}><option value="">Select...</option>{GRADES.map(g=><option key={g.l} value={g.p}>{g.l} ({g.p})</option>)}</select></div></div><button className="btn btn-accent" style={{marginTop:10}} onClick={add}>Add</button></div>{courses.length>0&&(
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
    </div>;
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

function Messages({ user, toast }) {
  const [msgs, setMsgs] = useState(()=>ls("nv-messages",[{id:1,from:"System",text:"Welcome to Nursing Academic Hub! 🎉",time:"Now",read:true}]));
  const [input, setInput] = useState("");
  const [announcements] = useSharedData("nv-announcements", []);
  const send=()=>{if(!input.trim())return;const msg={id:Date.now(),from:user,text:input,time:"Just now",read:true,mine:true};const u=[...msgs,msg];setMsgs(u);saveMyData("messages","nv-messages",u);setInput("");};
  return<div><div className="sec-title">💬 Messages</div><div className="sec-sub">Notifications and chat</div>{announcements.filter(a=>a.pinned).map(a=><div key={a.id} style={{background:"rgba(251,146,60,.08)",border:"1px solid rgba(251,146,60,.2)",borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:13}}><b>📌 {a.title}:</b> {a.body}</div>)}<div className="card" style={{marginBottom:14,minHeight:250,display:"flex",flexDirection:"column",gap:8,padding:14}}>{msgs.map(m=><div key={m.id} style={{display:"flex",gap:8,alignItems:"flex-start",justifyContent:m.mine?"flex-end":"flex-start"}}>{!m.mine&&<div style={{width:30,height:30,borderRadius:50,background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>📢</div>}<div style={{maxWidth:"75%"}}>{!m.mine&&<div style={{fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",marginBottom:3}}>{m.from} · {m.time}</div>}<div style={{background:m.mine?"linear-gradient(135deg,var(--accent),var(--accent2))":"var(--card2)",borderRadius:m.mine?"14px 14px 4px 14px":"14px 14px 14px 4px",padding:"9px 13px",fontSize:14,color:m.mine?"white":"var(--text)"}}>{m.text}</div></div></div>)}</div><div style={{display:"flex",gap:8}}><input className="inp" style={{flex:1,marginBottom:0}} placeholder="Type a message..." value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} /><button className="btn btn-accent" onClick={send}>Send</button></div></div>;
}

function Notifications({ currentUser, onRead }) {
  const [notifs, setNotifs] = useState(()=>ls("nv-notifications",[]));

  useEffect(() => {
    // Mark all as read
    const updated = notifs.map(n=>({...n,read:true}));
    setNotifs(updated); saveMyData("notifications","nv-notifications",updated);
    if (onRead) onRead();
  }, []);

  const del = (id) => { const u=notifs.filter(n=>n.id!==id); setNotifs(u); saveMyData("notifications","nv-notifications",u); };
  const clearAll = () => { setNotifs([]); saveMyData("notifications","nv-notifications",[]); };

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
            <div key={n.id} className="card" style={{marginBottom:10,borderLeft:`3px solid ${typeColor(n.type)}`,animation:`fadeUp .3s ease ${i*.04}s both`,opacity:n.read ? 0.85 : 1}}>
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


// ════════════════════════════════════════════════════════════════════
// ─── CBT EXAM SYSTEM ─────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

// ── Shared parser: handles both single & pasted multi-question blocks ─
// Supports formats:
//   Q: text / 1. text / plain text
//   A:/B:/C:/D: or (A)/(B) or A) or numbered 1) 2) 3) 4)
//   Inline "ANS: B" or separate answers column
const parseCbtQuestions = (qText, ansText = "") => {
  const ansLines = ansText.trim().split("\n").map(l => l.trim()).filter(Boolean);

  // Split into blocks by blank line OR by question number pattern
  let rawBlocks = qText.trim().split(/\n\s*\n+/);

  // If no blank lines but multiple "Q:" or "1." patterns, split on those
  if (rawBlocks.length === 1) {
    const unified = rawBlocks[0];
    const qStarts = [...unified.matchAll(/(?:^|\n)(?:Q\s*[:\-\.\)]\s*\d*|(?:\d+)\s*[\.\)]\s+(?=[A-Z])|(?:\d+)\s*[\.\)][^\n]+\n\s*[AaBb]\s*[\.\):])/gm)];
    if (qStarts.length > 1) {
      // Re-split on question-number lines
      rawBlocks = unified.split(/(?=\n(?:\d+)[\.\)]\s+|\nQ\s*[:.\-]\s*)/i).filter(b => b.trim());
    }
  }

  const items = rawBlocks.map((block, idx) => {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    let q = "", options = ["", "", "", ""], ans = 0, foundAns = false;

    lines.forEach(line => {
      // Check for inline answer declaration
      const ansMatch = line.match(/^(?:ANS|ANSWER|Answer|Ans)\s*[:.\-)]\s*([A-Da-d1-4])/i);
      if (ansMatch) {
        const a = ansMatch[1].toUpperCase();
        const idx2 = ["A","B","C","D","1","2","3","4"].indexOf(a);
        ans = idx2 >= 4 ? idx2 - 4 : idx2 >= 0 ? idx2 : 0;
        foundAns = true;
        return;
      }

      // Match option lines: A. / A: / A) / (A) / 1. / 1) / a. etc.
      const optMatch = line.match(/^[\(\[]?\s*([AaBbCcDd1-4])\s*[\)\]:\.\-]\s*(.+)$/);
      if (optMatch) {
        const letter = optMatch[1].toUpperCase();
        const text   = optMatch[2].trim();
        const oi = { A:0, B:1, C:2, D:3, "1":0, "2":1, "3":2, "4":3 }[letter];
        if (oi !== undefined) { options[oi] = text; return; }
      }

      // Match question line: Q: / Q. / Q- / 1. / 2) / plain
      const qMatch = line.match(/^(?:Q\s*[:.\-]\s*\d*\s*|(?:\d+)\s*[\.\)]\s*)(.+)$/i);
      if (qMatch && !q) { q = qMatch[1].trim(); return; }

      // Fallback: first non-option line becomes question
      if (!q && !line.match(/^[\(\[]?[AaBbCcDd1-4][\)\]:.]/)) { q = line.replace(/^\d+[\.\)]\s*/, "").trim(); }
    });

    // Override answer from answers column if provided
    if (ansLines[idx]) {
      const a = ansLines[idx][0]?.toUpperCase();
      const mapped = { A:0, B:1, C:2, D:3, "1":0, "2":1, "3":2, "4":3 }[a];
      if (mapped !== undefined) { ans = mapped; foundAns = true; }
    }

    return { q: q.trim(), options, ans, _hasAns: foundAns || !!ansLines[idx] };
  }).filter(item => item.q && item.options.some(o => o));

  return items;
};

// ── Lecturer: CBT Exam Manager ───────────────────────────────────────
function CbtExamManager({ toast, currentUser }) {
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
    shuffleQuestions:true, shuffleOptions:true, fullscreenRequired:true, tabSwitchLimit:3, webcamSnapshots:true, deviceLock:true };
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

  // Load live data
  useEffect(() => {
    const u1 = subscribeCbtExams(list => { setExams(list); setLoading(false); });
    const u2 = subscribeCbtResults(list => setResults(list));
    const u3 = subscribeCbtViolations(list => setViolations(list));
    return () => { u1(); u2(); u3(); };
  }, []);

  // ── Auto-parse on paste text change ──
  useEffect(() => {
    if (!pasteQ.trim()) { setParsed([]); setParseMsg(""); return; }
    const items = parseCbtQuestions(pasteQ, pasteA);
    setParsed(items);
    if (items.length === 0) setParseMsg("⚠️ No questions detected — check your format.");
    else {
      const withAns  = items.filter(i => i._hasAns).length;
      const noAns    = items.length - withAns;
      setParseMsg(`✅ ${items.length} question${items.length>1?"s":""} detected${noAns>0?` · ⚠️ ${noAns} missing answer`:""}. Review below then import.`);
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
  const isArchived = (exam) => exam.published && exam.publishedAt && (Date.now()-exam.publishedAt > 24*60*60*1000);
  const getStatus  = (exam) => {
    if (!exam.published) return { label:"📋 Draft", color:"var(--text3)", bg:"rgba(128,128,128,.1)" };
    if (isArchived(exam)) return { label:"🗄️ Archived", color:"var(--warn)", bg:"rgba(251,146,60,.12)" };
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
      return `<tr style="background:${i%2===0?"#f0f8ff":"white"}">
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;font-weight:bold;">${i+1}</td>
        <td style="padding:8px 12px;border:1px solid #ccc;">${r.student}</td>
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;color:#0077b6;font-weight:bold;">${r.score}/${r.total}</td>
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;font-weight:bold;color:${gc}">${r.percent}%</td>
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;font-weight:bold;color:${gc}">${grade}</td>
        <td style="padding:8px 12px;border:1px solid #ccc;text-align:center;font-size:12px;color:#666">${r.submittedAt?new Date(r.submittedAt).toLocaleString():"-"}</td>
      </tr>`;
    }).join("");
    const w = window.open("","_blank","width=960,height=720");
    w.document.write(`<!DOCTYPE html><html><head><title>${exam.title} – Results</title>
    <style>body{font-family:'Times New Roman',serif;padding:32px;color:#000}h1{margin-bottom:4px}p{font-size:13px;color:#555;margin-bottom:20px}
    table{width:100%;border-collapse:collapse}th{background:#0077b6;color:white;padding:10px 12px;border:1px solid #ccc}
    @media print{.no-print{display:none}}</style></head>
    <body>
    <h1>📋 ${exam.title}</h1>
    <p>Class: ${cls?.label||exam.classId} &nbsp;·&nbsp; Subject: ${exam.subject||"—"} &nbsp;·&nbsp; Questions: ${exam.questions.length} &nbsp;·&nbsp; Duration: ${exam.duration} min &nbsp;·&nbsp; Generated: ${new Date().toLocaleString()}</p>
    <button class="no-print" onclick="window.print()" style="margin-bottom:16px;padding:8px 20px;background:#0077b6;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px">🖨️ Print</button>
    <table><thead><tr><th>#</th><th>Student</th><th>Score</th><th>%</th><th>Grade</th><th>Submitted</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${rList.length===0?"<p style='margin-top:16px;color:#888'>No submissions yet.</p>":""}
    ${notTaken.length>0?`<p style="margin-top:20px;color:#b45309;font-size:13px">⏳ Not yet taken (${notTaken.length}): ${notTaken.map(s=>s.username).join(", ")}</p>`:""}
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
          <div style={{padding:"10px 12px",borderRadius:9,border:"1px solid var(--border)"}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:3}}>🚨 Tab Switch Limit</div>
            <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>Auto-submit after N switches (0 = warn only)</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="range" min="0" max="10" value={form.tabSwitchLimit??3}
                onChange={e=>setForm(f=>({...f,tabSwitchLimit:+e.target.value}))}
                style={{flex:1,accentColor:"var(--danger)"}} />
              <span style={{fontWeight:800,fontSize:18,color:"var(--danger)",minWidth:28,textAlign:"center"}}>{form.tabSwitchLimit??3}</span>
            </div>
            <div style={{fontSize:10,color:"var(--text3)",marginTop:4}}>{(form.tabSwitchLimit??3)===0?"Warn only, never auto-submit":`Auto-submit after ${form.tabSwitchLimit} tab switch${form.tabSwitchLimit===1?"":"es"}`}</div>
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
                  <span style={{fontWeight:400,color:"var(--text3)",marginLeft:8}}>Supports: Q:/1./numbered · A:/B: or A)/B) or 1)/2) options · ANS: inline</span>
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
        Drafts are saved but invisible to students · Published exams auto-archive after 24 hours
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
              {classes.find(c=>c.id===selExam.classId)?.label} · {selExam.questions.length}Q · {selExam.duration}min
              {selExam.publishedAt&&<span style={{marginLeft:8}}>Published: {new Date(selExam.publishedAt).toLocaleString()}</span>}
            </div>
          </div>
          <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:status.bg,color:status.color,fontWeight:700}}>{status.label}</span>
          <button className="btn btn-sm" style={{borderColor:"var(--accent)",color:"var(--accent)"}} onClick={()=>printResults(selExam)}>🖨️ Print Results</button>
          <button className="btn btn-sm" onClick={()=>{setForm({...selExam});setView("compose");}}>✏️ Edit</button>
        </div>

        {/* Summary stats */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:16}}>
          {[
            {icon:"👨‍🎓",label:"Enrolled",    val:studentsInClass.length,    color:"var(--accent)"},
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
                          🌐 {devInfo.ip||"unknown IP"} · {devInfo.ua?.slice(0,60)||"unknown UA"}
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
                              title={`${v.type} · ${new Date(v.ts).toLocaleTimeString()}`}
                            />
                            <div style={{position:"absolute",bottom:2,left:2,right:2,fontSize:9,
                              background:"rgba(0,0,0,.65)",color:"white",borderRadius:3,padding:"1px 3px",textAlign:"center"}}>
                              {v.type==="tab_switch"?"Tab":v.type==="fullscreen_exit"?"FS exit":"Flag"} {new Date(v.ts).toLocaleTimeString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Event timeline */}
                    <div style={{maxHeight:110,overflowY:"auto"}}>
                      {vList.map((v,i)=>(
                        <div key={i} style={{fontSize:11,color:"var(--text3)",padding:"2px 0",display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{color:v.type==="auto_submitted"||v.type==="duplicate_device"?"var(--danger)":v.type==="tab_switch"?"var(--warn)":v.type==="screenshot_attempt"?"var(--purple)":"var(--accent)",fontWeight:700}}>
                            {v.type==="tab_switch"?"🔄 Tab switch":v.type==="fullscreen_exit"?"🖥️ Fullscreen exit":v.type==="auto_submitted"?"⚡ Auto-submitted":v.type==="duplicate_device"?"🔒 Duplicate device":v.type==="screenshot_attempt"?"📷 Screenshot attempt":"⚠️ "+v.type}
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
function CbtStudentView({ toast, currentUser }) {
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
  const [tabSwitches,  setTabSwitches]  = useState(0);
  const [violations,   setViolations]   = useState([]);
  const [warningMsg,   setWarningMsg]   = useState("");
  const [showWarning,  setShowWarning]  = useState(false);
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

  // ── Fullscreen handling ──
  const enterFullscreen = () => {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  };
  const exitFullscreen = () => {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  };
  useEffect(() => {
    const onFsChange = () => {
      const inFs = !!(document.fullscreenElement||document.webkitFullscreenElement);
      setIsFullscreen(inFs);
      if (!inFs && mode==="taking") logViolation("fullscreen_exit");
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, [mode]);

  // ── Tab/window visibility detection ──
  useEffect(() => {
    if (mode!=="taking") return;
    const onVis = () => { if (document.hidden) logViolation("tab_switch"); };
    document.addEventListener("visibilitychange", onVis);
    const onBlur = () => logViolation("tab_switch");
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
    };
  }, [mode, tabSwitches, activeExam]);

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
    const snapshot = (activeExam.webcamSnapshots && camStream) ? captureSnapshot(camStream) : null;
    const v = { examId:activeExam.id, student:currentUser, type, ts:Date.now(), ...(snapshot?{snapshot}:{}), ...(snapshot?{}:{hasSnapshot:false}), ...extraData };
    const updatedLocal = [...violations, v];
    setViolations(updatedLocal);

    if (type==="tab_switch") {
      setTabSwitches(prev => {
        const newCount = prev + 1;
        const limit = activeExam.tabSwitchLimit ?? 3;
        if (limit > 0 && newCount >= limit) {
          showWarn(`🚨 You switched tabs ${newCount} time${newCount>1?"s":""}. Your exam is being auto-submitted.`);
          setTimeout(() => doSubmit("auto_tab"), 2500);
        } else {
          showWarn(`⚠️ Tab switch detected (${newCount}${limit>0?`/${limit}`:""})! Return immediately or your exam may be auto-submitted.`);
        }
        return newCount;
      });
    } else if (type==="fullscreen_exit") {
      if (activeExam.fullscreenRequired) {
        showWarn("⚠️ You left fullscreen mode! This has been flagged. Return to fullscreen to continue.");
      }
    }

    // Save to Firestore (violations list kept in memory includes full snapshots; Firestore strips them to metadata)
    try {
      const all = await cbtViolationsGet();
      const updated = [...all, v];
      await cbtViolationsSave(updated);
    } catch(e) {}
  };

  const showWarn = (msg) => {
    setWarningMsg(msg);
    setShowWarning(true);
    setTimeout(() => setShowWarning(false), 5000);
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

    // 2. If webcam required, go to cam setup screen first
    if (exam.webcamSnapshots) {
      setMode("camsetup");
    } else {
      setMode("preflight");
    }
  };

  const beginAfterPreflight = () => {
    setMode("taking");
    if (activeExam?.fullscreenRequired) enterFullscreen();
  };

  // ── Submit exam ──
  const doSubmit = async (reason="manual") => {
    const exam = activeExam;
    if (!exam) return;
    // Calculate score using original question/option indices
    const score = shuffledQs.reduce((s, sqObj, i) => {
      const chosen = answers[i]; // index into displayOptions
      if (chosen === null || chosen === undefined) return s;
      const chosenOrigOpt = sqObj.displayOptions[chosen]?.origOptIdx;
      return s + (chosenOrigOpt === sqObj.origAns ? 1 : 0);
    }, 0);
    const total = shuffledQs.length;
    const pct   = Math.round((score/total)*100);
    const result = {
      examId:exam.id, examTitle:exam.title, student:currentUser, score, total,
      percent:pct, submittedAt:Date.now(), reason,
      violations: violations.length,
    };
    const updated = [...results.filter(r=>!(r.examId===exam.id&&r.student===currentUser)), result];
    setResults(updated);
    await cbtResultsSave(updated);
    if (reason==="auto_tab") {
      const all = await cbtViolationsGet();
      await cbtViolationsSave([...all, {examId:exam.id,student:currentUser,type:"auto_submitted",ts:Date.now()}]);
    }
    if (document.fullscreenElement) exitFullscreen();
    setMyResult(result);
    setMode("done");
  };

  const isArchived    = (exam) => exam.published && exam.publishedAt && (Date.now()-exam.publishedAt > 24*60*60*1000);
  const hasAttempted  = (examId) => results.some(r=>r.examId===examId&&r.student===currentUser);
  const fmtTime       = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const urgent        = timeLeft<=60&&timeLeft>0;

  const available = exams.filter(e=>e.published&&e.classId===myClass&&!isArchived(e));
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

  if (mode==="preflight"&&activeExam) return (
    <div style={{maxWidth:580,margin:"0 auto"}}>
      <div className="card" style={{borderTop:"4px solid var(--accent)",padding:"28px 24px"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:48,marginBottom:8}}>📋</div>
          <div style={{fontWeight:800,fontSize:20,marginBottom:4}}>{activeExam.title}</div>
          <div style={{fontSize:13,color:"var(--text3)"}}>{activeExam.subject}</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
          {[
            {icon:"❓",label:"Questions",val:activeExam.questions.length},
            {icon:"⏱",label:"Duration",val:`${activeExam.duration} minutes`},
            {icon:"🔀",label:"Question Order",val:activeExam.shuffleQuestions?"Shuffled":"Fixed"},
            {icon:"🎲",label:"Option Order",val:activeExam.shuffleOptions?"Shuffled":"Fixed"},
          ].map((s,i)=>(
            <div key={i} style={{padding:"10px 12px",borderRadius:9,background:"var(--bg4)",border:"1px solid var(--border)",textAlign:"center"}}>
              <div style={{fontSize:20,marginBottom:3}}>{s.icon}</div>
              <div style={{fontWeight:800,fontSize:15,color:"var(--accent)"}}>{s.val}</div>
              <div style={{fontSize:11,color:"var(--text3)"}}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{background:"rgba(239,68,68,.05)",border:"1px solid rgba(239,68,68,.2)",borderRadius:10,padding:"14px 16px",marginBottom:20}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--danger)",marginBottom:10}}>🛡️ Exam Rules — Read Carefully</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {[
              activeExam.fullscreenRequired && "🖥️ Exam will run in fullscreen. Exiting fullscreen will be flagged.",
              activeExam.tabSwitchLimit>0
                ? `🔄 You may NOT switch tabs or windows. After ${activeExam.tabSwitchLimit} switch${activeExam.tabSwitchLimit===1?"":"es"} your exam will be auto-submitted.`
                : "🔄 Tab switches will be logged and reported to your lecturer.",
              activeExam.webcamSnapshots && "📸 Your webcam will silently take a photo each time a violation is detected.",
              activeExam.deviceLock && "🔒 Only one device is allowed. Opening this exam on another device will be flagged.",
              "🚫 Right-clicking and keyboard shortcuts (Ctrl+C, F12, etc.) are disabled.",
              "⏱ The timer cannot be paused. When it reaches zero, your exam auto-submits.",
              "📵 One attempt only. You cannot retake unless your lecturer resets you.",
              "🔀 Questions and options may appear in a different order to your classmates.",
            ].filter(Boolean).map((rule,i)=>(
              <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:12,color:"var(--text2)"}}>
                <span style={{flexShrink:0}}>{rule.slice(0,2)}</span>
                <span>{rule.slice(2)}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{fontSize:12,color:"var(--text3)",textAlign:"center",marginBottom:16}}>
          By clicking Start, you agree to abide by the exam rules. Violations are recorded and reported.
        </div>
        <div style={{display:"flex",gap:10}}>
          <button className="btn" style={{flex:1}} onClick={()=>{setMode("list");setActiveExam(null);if(camStream)camStream.getTracks().forEach(t=>t.stop());}}>← Cancel</button>
          <button className="btn btn-success" style={{flex:2,fontWeight:800,fontSize:15}} onClick={beginAfterPreflight}>
            {activeExam.fullscreenRequired?"🖥️ Enter Fullscreen & Start":"▶ Start Exam Now"}
          </button>
        </div>
      </div>
    </div>
  );

  // ── TAKING MODE ──────────────────────────────────────────────────────
  if (mode==="taking"&&activeExam&&shuffledQs.length>0) {
    const sq = shuffledQs[qIdx];
    const answeredCnt = answers.filter(a=>a!==null).length;
    return (
      <div style={{maxWidth:640,margin:"0 auto",userSelect:"none"}}>

        {/* Hidden video + canvas for snapshot capture */}
        <video ref={videoRef} autoPlay playsInline muted style={{position:"fixed",bottom:-9999,left:-9999,width:1,height:1}} />
        <canvas ref={canvasRef} style={{display:"none"}} />

        {/* Violation warning banner */}
        {showWarning&&(
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

        {/* Fullscreen re-entry prompt */}
        {activeExam.fullscreenRequired&&!isFullscreen&&mode==="taking"&&(
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
    const grade  = myResult.percent>=70?"A":myResult.percent>=60?"B":myResult.percent>=50?"C":myResult.percent>=40?"D":"F";
    const gColor = myResult.percent>=70?"var(--success)":myResult.percent>=50?"var(--warn)":"var(--danger)";
    return (
      <div style={{maxWidth:640,margin:"0 auto"}}>
        <div className="card" style={{textAlign:"center",padding:"32px 20px",marginBottom:16,borderTop:`4px solid ${gColor}`}}>
          <div style={{fontSize:60,marginBottom:8}}>
            {myResult.reason==="auto_tab"?"🚨":myResult.percent>=70?"🎉":myResult.percent>=50?"👍":"😔"}
          </div>
          <div style={{fontWeight:800,fontSize:22,marginBottom:4}}>
            {myResult.reason==="auto_tab"?"Exam Auto-Submitted":"Exam Submitted!"}
          </div>
          {myResult.reason==="auto_tab"&&<div style={{fontSize:12,color:"var(--danger)",marginBottom:8,fontWeight:700}}>Your exam was auto-submitted due to repeated tab switching.</div>}
          <div style={{fontSize:13,color:"var(--text3)",marginBottom:20}}>{activeExam?.title}</div>
          <div style={{display:"flex",justifyContent:"center",gap:28,flexWrap:"wrap"}}>
            <div><div style={{fontSize:42,fontWeight:800,color:"var(--accent)"}}>{myResult.score}/{myResult.total}</div><div style={{fontSize:12,color:"var(--text3)"}}>Score</div></div>
            <div><div style={{fontSize:42,fontWeight:800,color:gColor}}>{myResult.percent}%</div><div style={{fontSize:12,color:"var(--text3)"}}>Percentage</div></div>
            <div><div style={{fontSize:42,fontWeight:800,color:gColor}}>{grade}</div><div style={{fontSize:12,color:"var(--text3)"}}>Grade</div></div>
          </div>
          {myResult.violations>0&&<div style={{marginTop:14,fontSize:12,color:"var(--danger)",fontWeight:700}}>🚨 {myResult.violations} violation{myResult.violations>1?"s":""} recorded during this exam.</div>}
        </div>
        <div style={{fontWeight:800,fontSize:14,marginBottom:10}}>📋 Answer Review</div>
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
            <div style={{fontSize:11,color:"var(--text3)"}}>Archived · Read-Only Review Mode</div>
          </div>
          <button className="btn btn-sm" onClick={()=>setShowAns(activeExam.questions.reduce((o,_,i)=>({...o,[i]:true}),{}))}>Show All ✓</button>
          <button className="btn btn-sm" onClick={()=>setShowAns({})}>Hide All</button>
        </div>
        {myR&&(
          <div className="card" style={{marginBottom:14,textAlign:"center",borderTop:`3px solid ${myR.percent>=70?"var(--success)":myR.percent>=50?"var(--warn)":"var(--danger)"}`}}>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:4}}>Your score on this exam</div>
            <div style={{fontWeight:800,fontSize:20,color:"var(--accent)"}}>{myR.score}/{myR.total} · {myR.percent}% · Grade {myR.percent>=70?"A":myR.percent>=60?"B":myR.percent>=50?"C":myR.percent>=40?"D":"F"}</div>
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
                      <td style={{color:"var(--accent)",fontWeight:700}}>{r.score}/{r.total}</td>
                      <td style={{color:gColor,fontWeight:700}}>{r.percent}%</td>
                      <td><span style={{fontWeight:800,color:gColor}}>{grade}</span></td>
                      <td>{r.violations>0?<span style={{color:"var(--danger)",fontWeight:700}}>🚨 {r.violations}</span>:<span style={{color:"var(--success)"}}>✅ 0</span>}</td>
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
// Admin adds/deletes questions. 20 are selected daily by date-seed from the pool.
function AdminDailyMockManager({ toast }) {
  const [pool, setPool] = useSharedData("nv-daily-mock", []);
  const [mode, setMode] = useState("single"); // "single"|"paste"
  const [form, setForm] = useState({q:"", options:["","","",""], ans:0, cat:"General"});
  const [editIdx, setEditIdx] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteAnswers, setPasteAnswers] = useState("");
  const [parsedQ, setParsedQ] = useState([]);
  const CATS = ["General","Pharmacology","Physiology","Midwifery","Public Health","Paediatrics","Psychiatric","Critical Care","Anatomy"];

  const save = async (newPool) => {
    setPool(newPool);
    const ok = await saveShared("dailyMock", newPool);
    if (!ok) toast("⚠️ Saved locally — sync failed","warn");
  };

  const addSingle = () => {
    if (!form.q.trim()) return toast("Question text required","error");
    if (!form.options[0]||!form.options[1]) return toast("At least options A & B required","error");
    const q = {id:Date.now(), q:form.q.trim(), options:form.options.map(o=>o.trim()), ans:form.ans, cat:form.cat};
    let np;
    if (editIdx!==null) { np=pool.map((p,i)=>i===editIdx?q:p); toast("✏️ Question updated","success"); setEditIdx(null); }
    else { np=[...pool,q]; toast("➕ Question added to pool","success"); }
    save(np);
    setForm({q:"",options:["","","",""],ans:0,cat:"General"});
  };

  const parsePaste = () => {
    const blocks = pasteText.trim().split(/\n\s*\n+/).filter(b=>b.trim());
    const ansLines = pasteAnswers.trim().split("\n").map(l=>l.trim()).filter(Boolean);
    const items = blocks.map((block,idx)=>{
      const lines=block.split("\n").map(l=>l.trim()).filter(Boolean);
      let q="",options=["","","",""],ans=0;
      lines.forEach(line=>{
        const am=line.match(/^(?:ANS|ANSWER)[.:)]\s*([A-Da-d])/i);
        if(am){ans="ABCD".indexOf(am[1].toUpperCase());if(ans<0)ans=0;return;}
        const m=line.match(/^([QqAaBbCcDd])[.):\s]\s*(.+)$/);
        if(m){const L=m[1].toUpperCase();if(L==="Q")q=m[2];else if(L==="A")options[0]=m[2];else if(L==="B")options[1]=m[2];else if(L==="C")options[2]=m[2];else if(L==="D")options[3]=m[2];}
        else if(!q) q=line.replace(/^\d+[.)]\s*/,"");
      });
      if(ansLines[idx]){const a="ABCD".indexOf(ansLines[idx][0]?.toUpperCase());if(a>=0)ans=a;}
      return {id:Date.now()+idx,q:q.trim(),options,ans,cat:"General"};
    }).filter(i=>i.q&&i.options.some(o=>o));
    setParsedQ(items);
    if(!items.length) toast("No questions parsed","error");
    else toast(`✅ ${items.length} parsed!`,"success");
  };

  const importParsed = () => {
    if (!parsedQ.length) return;
    save([...pool,...parsedQ]);
    setParsedQ([]); setPasteText(""); setPasteAnswers("");
    toast(`✅ ${parsedQ.length} questions added to pool!`,"success");
  };

  const deleteOne = (i) => {
    if (!confirm("Delete this question?")) return;
    save(pool.filter((_,idx)=>idx!==i));
    if(editIdx===i) { setEditIdx(null); setForm({q:"",options:["","","",""],ans:0,cat:"General"}); }
    toast("Deleted","success");
  };

  const deleteAll = () => {
    if (!confirm(`Delete ALL ${pool.length} questions from the daily mock pool? This cannot be undone.`)) return;
    save([]);
    toast("🗑️ All questions deleted","success");
  };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:"#4a7a2e"}}>📅 Daily Mock Question Pool</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
            {pool.length} question{pool.length!==1?"s":""} in pool · 20 are selected daily by date
          </div>
        </div>
        {pool.length>0&&(
          <button className="btn btn-sm btn-danger" onClick={deleteAll}>🗑️ Delete All</button>
        )}
      </div>

      {/* Mode tabs */}
      <div style={{display:"flex",gap:8,margin:"14px 0 12px",flexWrap:"wrap"}}>
        <button className={`btn btn-sm${mode==="single"?" btn-accent":""}`}
          style={mode==="single"?{background:"#4a7a2e",border:"none"}:{}}
          onClick={()=>{setMode("single");setEditIdx(null);setForm({q:"",options:["","","",""],ans:0,cat:"General"});}}>✏️ Single</button>
        <button className={`btn btn-sm${mode==="paste"?" btn-accent":""}`}
          style={mode==="paste"?{background:"#4a7a2e",border:"none"}:{}}
          onClick={()=>setMode("paste")}>📋 Paste Multiple</button>
      </div>

      {/* Single form */}
      {mode==="single"&&(
        <div className="card2" style={{marginBottom:14,border:"1px solid #4a7a2e30"}}>
          <div style={{fontWeight:800,fontSize:13,color:"#4a7a2e",marginBottom:10}}>
            {editIdx!==null?`✏️ Editing Q${editIdx+1}`:"✏️ New Question"}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginBottom:8}}>
            <div>
              <label className="lbl">Question *</label>
              <textarea className="inp" rows={3} style={{resize:"vertical"}} value={form.q}
                onChange={e=>setForm({...form,q:e.target.value})} placeholder="Question text..." />
            </div>
            <div>
              <label className="lbl">Category</label>
              <select className="inp" value={form.cat} onChange={e=>setForm({...form,cat:e.target.value})}>
                {CATS.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            {["A","B","C","D"].map((L,i)=>(
              <div key={L}>
                <label className="lbl">Option {L}{i<2?" *":""}</label>
                <input className="inp" style={{marginBottom:0}} placeholder={`Option ${L}...`} value={form.options[i]}
                  onChange={e=>{const o=[...form.options];o[i]=e.target.value;setForm({...form,options:o});}} />
              </div>
            ))}
          </div>
          <label className="lbl">Correct Answer *</label>
          <select className="inp" value={form.ans} onChange={e=>setForm({...form,ans:+e.target.value})}>
            {["A","B","C","D"].map((L,i)=><option key={L} value={i}>Option {L}{form.options[i]?`: ${form.options[i]}`:""}</option>)}
          </select>
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-accent" style={{background:"linear-gradient(135deg,#4a7a2e,#6aaa40)",border:"none"}}
              onClick={addSingle}>{editIdx!==null?"💾 Update":"➕ Add to Pool"}</button>
            {editIdx!==null&&<button className="btn" onClick={()=>{setEditIdx(null);setForm({q:"",options:["","","",""],ans:0,cat:"General"});}}>Cancel</button>}
          </div>
        </div>
      )}

      {/* Paste form */}
      {mode==="paste"&&(
        <div className="card2" style={{marginBottom:14,border:"1px solid #4a7a2e30"}}>
          <div style={{fontWeight:800,fontSize:13,color:"#4a7a2e",marginBottom:8}}>📋 Paste Multiple Questions</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"#4a7a2e",marginBottom:4}}>📝 Questions</div>
              <textarea className="paste-box" rows={12}
                placeholder={"Q: Normal adult temp is:\nA: 35°C\nB: 36.1-37.2°C\nC: 38.5°C\nD: 40°C\n\nQ: Insulin is produced by:\nA: Alpha cells\nB: Beta cells\nC: Delta cells\nD: Acinar cells"}
                value={pasteText} onChange={e=>{setPasteText(e.target.value);setParsedQ([]);}} />
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"var(--success)",marginBottom:4}}>✅ Answers (A/B/C/D)</div>
              <textarea className="paste-box" rows={12} placeholder={"B\nB"} style={{borderColor:"rgba(34,197,94,.35)"}}
                value={pasteAnswers} onChange={e=>{setPasteAnswers(e.target.value);setParsedQ([]);}} />
            </div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button className="btn btn-accent" style={{background:"linear-gradient(135deg,#4a7a2e,#6aaa40)",border:"none"}}
              onClick={parsePaste}>🔍 Parse</button>
            {parsedQ.length>0&&<button className="btn btn-success" onClick={importParsed}>✅ Add {parsedQ.length} to Pool</button>}
            <button className="btn" onClick={()=>{setParsedQ([]);setPasteText("");setPasteAnswers("");}}>🗑️ Clear</button>
          </div>
          {parsedQ.length>0&&(
            <div style={{marginTop:10,border:"1px solid var(--success)",borderRadius:8,overflow:"hidden"}}>
              <div style={{padding:"8px 14px",background:"rgba(34,197,94,.1)",fontSize:12,fontWeight:800,color:"var(--success)"}}>
                ✓ {parsedQ.length} parsed — import below
              </div>
              {parsedQ.map((p,i)=>(
                <div key={i} style={{padding:"8px 14px",borderTop:"1px solid var(--border)"}}>
                  <div style={{fontWeight:700,fontSize:12,marginBottom:4}}>{i+1}. {p.q}</div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {p.options.filter(o=>o).map((opt,oi)=>(
                      <span key={oi} style={{fontSize:11,padding:"2px 8px",borderRadius:5,
                        background:oi===p.ans?"rgba(34,197,94,.15)":"var(--bg4)",
                        border:`1px solid ${oi===p.ans?"var(--success)":"var(--border)"}`,
                        color:oi===p.ans?"var(--success)":"var(--text3)",fontWeight:oi===p.ans?800:400
                      }}>{"ABCD"[oi]}. {opt}{oi===p.ans?" ✓":""}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pool list */}
      <div style={{fontWeight:800,fontSize:13,marginBottom:10,color:"var(--text)"}}>
        📋 Question Pool ({pool.length})
        {pool.length<20&&pool.length>0&&<span style={{fontSize:11,color:"var(--warn)",fontWeight:500,marginLeft:8}}>⚠️ Add at least 20 for daily rotation</span>}
      </div>
      {pool.length===0&&(
        <div style={{textAlign:"center",padding:24,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:10,fontSize:13}}>
          No questions yet — add above.
        </div>
      )}
      {pool.map((q,i)=>(
        <div key={q.id||i} className="card2" style={{marginBottom:8,borderLeft:`3px solid ${i===editIdx?"#4a7a2e":"var(--border)"}`}}>
          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{width:26,height:26,borderRadius:7,background:"rgba(74,122,46,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#4a7a2e",flexShrink:0}}>{i+1}</div>
            <div style={{flex:1}}>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:5,flexWrap:"wrap"}}>
                <div style={{fontWeight:700,fontSize:13,flex:1}}>{q.q}</div>
                <span style={{fontSize:10,padding:"2px 7px",borderRadius:5,background:"rgba(74,122,46,.1)",color:"#2d4a1e",fontWeight:700,flexShrink:0}}>{q.cat}</span>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {q.options.filter(o=>o).map((opt,oi)=>(
                  <span key={oi} style={{fontSize:11,padding:"2px 9px",borderRadius:5,
                    background:oi===q.ans?"rgba(34,197,94,.12)":"transparent",
                    border:`1px solid ${oi===q.ans?"var(--success)":"var(--border)"}`,
                    color:oi===q.ans?"var(--success)":"var(--text3)",fontWeight:oi===q.ans?800:400
                  }}>{"ABCD"[oi]}. {opt}{oi===q.ans?" ✓":""}</span>
                ))}
              </div>
            </div>
            <div style={{display:"flex",gap:4,flexShrink:0}}>
              <button className="btn btn-sm" onClick={()=>{
                setForm({q:q.q,options:[...q.options],ans:q.ans,cat:q.cat||"General"});
                setEditIdx(i); setMode("single");
              }}>✏️</button>
              <button className="btn btn-sm btn-danger" onClick={()=>deleteOne(i)}>🗑️</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── NC Archive helpers ─────────────────────────────────────────────────────
// Archive entry shape:
// { id, type:"paper"|"osce"|"dailymock", spec, year, paperKey, title, savedAt,
//   questions?:[...], checklists?:[...] }
function useNcArchive() {
  return useSharedData("nv-nc-archive", []);
}

// ── Admin: Archive Manager ─────────────────────────────────────────────────
function AdminNcArchiveManager({ toast }) {
  const [archive, setArchive] = useSharedData("nv-nc-archive", []);

  const saveArchive = async (newArr) => {
    setArchive(newArr);
    const ok = await saveShared("ncArchive", newArr);
    if (!ok) toast("⚠️ Saved locally — sync failed","warn");
  };

  const deleteEntry = (id) => {
    if (!confirm("Remove this entry from archive?")) return;
    saveArchive(archive.filter(e=>e.id!==id));
    toast("Removed from archive","success");
  };

  const deleteAll = () => {
    if (!confirm(`Delete ALL ${archive.length} archive entries? Students will lose access to these.`)) return;
    saveArchive([]);
    toast("🗑️ Archive cleared","success");
  };

  const grouped = archive.reduce((g,e)=>{
    const key = e.spec||"Other";
    if (!g[key]) g[key]=[];
    g[key].push(e);
    return g;
  },{});

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:"var(--accent)"}}>🗄️ NC Exam Archive</div>
          <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>
            {archive.length} item{archive.length!==1?"s":""} saved · Students can retake or review anytime
          </div>
        </div>
        {archive.length>0&&<button className="btn btn-sm btn-danger" onClick={deleteAll}>🗑️ Delete All</button>}
      </div>

      {archive.length===0&&(
        <div style={{textAlign:"center",padding:28,color:"var(--text3)",border:"1px dashed var(--border)",borderRadius:10,marginTop:14}}>
          <div style={{fontSize:36,marginBottom:8}}>🗄️</div>
          <div style={{fontSize:13}}>No archived items yet.<br/>Use the "Save to Archive" button on any paper or OSCE.</div>
        </div>
      )}

      {Object.entries(grouped).map(([spec, entries])=>(
        <div key={spec} style={{marginTop:14}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--accent)",marginBottom:8,padding:"4px 0",borderBottom:"1px solid var(--border)"}}>
            {NURSING_EXAM_META[spec]?.icon||"📋"} {NURSING_EXAM_META[spec]?.short||spec}
          </div>
          {entries.map(e=>(
            <div key={e.id} className="card2" style={{marginBottom:8,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{fontSize:20}}>{e.type==="osce"?"🩺":e.type==="dailymock"?"📅":"📄"}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13}}>{e.title}</div>
                <div style={{fontSize:11,color:"var(--text3)"}}>
                  {e.type==="osce"?`${e.checklists?.length||0} skills`:e.type==="dailymock"?`${e.questions?.length||0} questions`:`${e.questions?.length||0} questions`}
                  {" · "}Saved {new Date(e.savedAt).toLocaleDateString()}
                </div>
              </div>
              <button className="btn btn-sm btn-danger" onClick={()=>deleteEntry(e.id)}>🗑️</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Student: NC Archive View ───────────────────────────────────────────────
function NcArchiveView({ toast, currentUser }) {
  const [archive] = useNcArchive();
  const [sel, setSel] = useState(null);
  const [mode, setMode] = useState(null); // "exam"|"review"|"osce"

  if (mode==="exam"&&sel) {
    const meta = NURSING_EXAM_META[sel.spec]||{color:"#4a7a2e",icon:"📋",short:sel.spec||"Archive"};
    return <NursingMCQExam toast={toast} currentUser={currentUser}
      paper={{...sel, id:`arc_${sel.id}`, title:sel.title}}
      meta={meta} onBack={()=>{setMode(null);setSel(null);}} />;
  }
  if (mode==="review"&&sel) {
    const meta = NURSING_EXAM_META[sel.spec]||{color:"#4a7a2e",icon:"📋",short:sel.spec||"Archive"};
    return <NursingReviewMode paper={{...sel,title:sel.title}} meta={meta}
      onBack={()=>{setMode(null);setSel(null);}} />;
  }
  if (mode==="osce"&&sel) {
    const meta = NURSING_EXAM_META[sel.spec]||{color:"#4a7a2e",icon:"🩺",short:sel.spec||"Archive"};
    return <NursingOsceView osce={sel} meta={meta} year={sel.year||""}
      onBack={()=>{setMode(null);setSel(null);}} />;
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
        {archive.length} item{archive.length!==1?"s":" "} · Retake anytime · No attempt limit
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
                        {e.type==="dailymock"?"📅 Daily Mock":"📄 Past Paper"} · {e.questions?.length||0} questions
                        {" · "}🗄️ {new Date(e.savedAt).toLocaleDateString()}
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
                      <div style={{fontSize:11,color:"var(--text3)"}}>🩺 {e.checklists?.length||0} clinical skills · 🗄️ {new Date(e.savedAt).toLocaleDateString()}</div>
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
function getDailyMockQuestions(pool) {
  if (!pool || pool.length === 0) return [];
  const today = new Date();
  const seed = today.getFullYear()*10000 + (today.getMonth()+1)*100 + today.getDate();
  const count = Math.min(20, pool.length);
  const shuffled = [...pool].sort((a,b)=>{
    const ha = (seed * (pool.indexOf(a)+1)) % 997;
    const hb = (seed * (pool.indexOf(b)+1)) % 997;
    return ha - hb;
  });
  return shuffled.slice(0, count);
}

function NcDailyMockExam({ toast, currentUser, onBack, isAdmin }) {
  const [pool] = useSharedData("nv-daily-mock", []);
  const [archive, setArchive] = useSharedData("nv-nc-archive", []);
  const [phase, setPhase] = useState("intro");
  const [answers, setAnswers] = useState([]);
  const [qIdx, setQIdx] = useState(0);
  const [finalAnswers, setFinalAnswers] = useState(null);
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
    lsSet("nv-results",[...results,{id:Date.now(),subject:`Daily Mock — ${today}`,type:"NC Daily Mock",score,total:questions.length,pct:Math.round(score/questions.length*100),date:new Date().toLocaleDateString()}]);
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

  if (phase==="intro") return (
    <div style={{maxWidth:600,margin:"0 auto"}}>
      <div className="nc-card" style={{textAlign:"center",padding:"32px 28px"}}>
        <div style={{fontSize:52,marginBottom:10}}>📅</div>
        <div style={{fontWeight:800,fontSize:22,color:"#2d4a1e",marginBottom:4}}>Daily Mock Exam</div>
        <div style={{fontSize:13,color:"#6b8a52",marginBottom:20}}>{today} · {questions.length} Questions · Mixed Specialties</div>
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
          <div style={{fontWeight:800,fontSize:20,color:"#2d4a1e",marginBottom:4}}>Daily Mock Complete!</div>
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
            <div style={{fontWeight:800,fontSize:15,color:"#2d4a1e"}}>📅 Daily Mock — {today}</div>
            <div style={{fontSize:11,color:"#6b8a52"}}>{answeredCount}/{questions.length} answered</div>
          </div>
          <button className="nc-btn nc-btn-primary" onClick={()=>{if(confirm("Submit exam now?"))submit();}}>Submit ✓</button>
        </div>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
        {questions.map((_,i)=>(
          <div key={i} onClick={()=>setQIdx(i)} style={{width:30,height:30,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11,fontWeight:700,transition:"all .15s",
            background:i===qIdx?"#4a7a2e":answers[i]!==null?"rgba(34,197,94,.15)":"#f5f0e8",
            border:`2px solid ${i===qIdx?"#4a7a2e":answers[i]!==null?"#22c55e":"#d4c9a8"}`,
            color:i===qIdx?"white":answers[i]!==null?"#15803d":"#6b8a52"}}>{i+1}</div>
        ))}
      </div>
      <div className="nc-progress-wrap" style={{marginBottom:14}}>
        <div className="nc-progress-fill" style={{width:`${(answeredCount/questions.length)*100}%`}} />
      </div>
      <div style={{fontSize:10,color:"#6b8a52",marginBottom:4}}>Question {qIdx+1} of {questions.length} · <span style={{background:"rgba(74,122,46,.1)",borderRadius:4,padding:"1px 5px",color:"#2d4a1e",fontWeight:700}}>{q.cat}</span></div>
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
function NcSpecialtyExams({ toast, currentUser, isAdmin }) {
  // Delegates entirely to NursingExamsView which now has Year → Paper1/Paper2/OSCE
  return (
    <div>
      <div className="nc-sec-title">🎓 Specialty Exam Papers</div>
      <div className="nc-sec-sub">Select specialty · choose year · pick Paper 1, Paper 2 or OSCE</div>
      <NursingExamsView toast={toast} currentUser={currentUser} isAdmin={isAdmin} />
    </div>
  );
}


// ── NC Dashboard ────────────────────────────────────────────────────────────
function NcDashboard({ currentUser, onNavigate }) {
  const today = new Date().toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
  const results = ls("nv-results",[]).filter(r=>r.type&&r.type.includes("NC"));
  const mockDone = results.some(r=>r.subject?.includes(new Date().toLocaleDateString()));
  return (
    <div>
      <div style={{marginBottom:24}}>
        <div className="nc-sec-title">🏛️ Nursing Council Exam Centre</div>
        <div className="nc-sec-sub">{today}</div>
      </div>
      {/* Daily mock card */}
      <div className="nc-card" style={{marginBottom:20,borderTop:"4px solid #4a7a2e",background:mockDone?"#f5f0e8":"#fff"}}>
        <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
          <div style={{width:52,height:52,borderRadius:12,background:"linear-gradient(135deg,#4a7a2e,#7bc950)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26}}>📅</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:16,color:"#2d4a1e",marginBottom:2}}>Today's Daily Mock Exam</div>
            <div style={{fontSize:12,color:"#6b8a52"}}>20 mixed questions · Updates every day · {mockDone?"Completed ✅":"Not taken yet"}</div>
          </div>
          {!mockDone&&<button className="nc-btn nc-btn-primary" style={{fontSize:13}} onClick={()=>onNavigate("daily")}>Start Now →</button>}
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
function NursingCouncilSite({ currentUser, isAdmin, onSwitchToSchool, toast, themeMode, setThemeMode }) {
  const [activeNav, setActiveNav] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      case "specialty": return <NcSpecialtyExams toast={toast} currentUser={currentUser} isAdmin={isAdmin} />;
      case "archive": return <NcArchiveView toast={toast} currentUser={currentUser} />;
      case "results": return <Results toast={toast} />;
      default: return <NcDashboard currentUser={currentUser} onNavigate={setActiveNav} />;
    }
  };

  return (
    <>
      <style>{CSS}</style>
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
            <div key={item.key} className={`nc-nav-item${activeNav===item.key?" active":""}`} onClick={()=>{setActiveNav(item.key);setSidebarOpen(false);}}>
              <span style={{marginRight:4}}>{item.icon}</span>{item.label}
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
export default function App() {
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false); // true if storage unavailable

  const runSync = async () => {
    setSyncing(true);
    const healthy = await checkStorageHealth();
    setSyncError(!healthy);
    await hydrateFromBackend();
    setSyncing(false);
    return healthy;
  };

  useEffect(() => {
    initData(); runSync();
    // Auto-sync every 60 seconds while app is open
    const interval = setInterval(() => { hydrateFromBackend(); }, 60000);
    // Also sync when tab regains focus (user switches back from another device)
    const onFocus = () => hydrateFromBackend();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, []);

  useEffect(() => {
    // ── PWA: inject manifest link ──
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = {
        name:"Nursing Academic Hub",short_name:"NursingHub",
        description:"Nursing school handouts, resources & exams",
        start_url:"/",display:"standalone",
        background_color:"#e8f4fc",theme_color:"#0077b6",
        icons:[
          {src:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏥</text></svg>",sizes:"any",type:"image/svg+xml"}
        ]
      };
      const blob=new Blob([JSON.stringify(manifest)],{type:"application/manifest+json"});
      const url=URL.createObjectURL(blob);
      const link=document.createElement("link");link.rel="manifest";link.href=url;
      document.head.appendChild(link);
    }
    // ── PWA: register service worker ──
    if ("serviceWorker" in navigator) {
      const swCode = `
const CACHE='nursing-hub-v1';
const URLS=['/'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(URLS).catch(()=>{}))));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).then(r=>{
    const rc=r.clone();
    caches.open(CACHE).then(c=>c.put(e.request,rc));
    return r;
  }).catch(()=>caches.match(e.request)));
});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
      `;
      const swBlob=new Blob([swCode],{type:"application/javascript"});
      const swUrl=URL.createObjectURL(swBlob);
      navigator.serviceWorker.register(swUrl).catch(()=>{});
    }
    // ── PWA: meta tags ──
    const metas = [
      ["mobile-web-app-capable","yes"],["apple-mobile-web-app-capable","yes"],
      ["apple-mobile-web-app-status-bar-style","default"],
      ["apple-mobile-web-app-title","NursingHub"],["theme-color","#0077b6"],
    ];
    metas.forEach(([name,content])=>{
      if(!document.querySelector(`meta[name="${name}"]`)){
        const m=document.createElement("meta");m.name=name;m.content=content;document.head.appendChild(m);
      }
    });
  }, []);

  const [page, setPage] = useState("auth");
  const [siteMode, setSiteMode] = useState(() => ls("nv-site-mode","school")); // "school" | "nursing"
  const switchToNursing = () => { setSiteMode("nursing"); lsSet("nv-site-mode","nursing"); };
  const switchToSchool  = () => { setSiteMode("school");  lsSet("nv-site-mode","school"); };
  const [authTab, setAuthTab] = useState("signin");
  const [loginType, setLoginType] = useState("student"); // "student" | "admin"
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [showPw, setShowPw] = useState(false);
  const [regUser, setRegUser] = useState(""); const [regPw, setRegPw] = useState(""); const [regClass, setRegClass] = useState("");
  const [activeNav, setActiveNav] = useState("dashboard"); const [activeTool, setActiveTool] = useState(null);
  const [themeMode, setThemeMode] = useState("light"); const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState([]); const [currentUser, setCurrentUser] = useState(""); const [isAdmin, setIsAdmin] = useState(false);
  const [selectedClass, setSelectedClass] = useState(null);
  const [navHistory, setNavHistory] = useState([]);
  const [isLecturer, setIsLecturer] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);
  const [unreadNotifs, setUnreadNotifs] = useState(()=>{
    const notifs = ls("nv-notifications", []);
    return notifs.filter(n => !n.read).length;
  });
  // Forgot password states
  const [forgotMode, setForgotMode] = useState(false); // false | "email" | "code"
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotNewPw, setForgotNewPw] = useState("");
  const [_resetCode, _setResetCode] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  // ── Saved credentials (device-local, this user only) ──
  // Key: "nv-saved-cred" → { email, password, savedAt }
  // If a different user logs in on this device, save their email only (no password)
  const [credSaved, setCredSaved] = useState(false); // shows "remembered" badge

  useEffect(() => {
    // Pre-fill login fields from device-local saved credential
    try {
      const raw = localStorage.getItem("nv-saved-cred");
      if (!raw) return;
      const cred = JSON.parse(raw);
      if (cred?.email) setUsername(cred.email);
      if (cred?.password) { setPassword(cred.password); setCredSaved(true); }
    } catch(e) {}
  }, []);

  useEffect(() => { document.body.className = themeMode; }, [themeMode]);

  // Save credential to this device only.
  // Same user → store email + password. Different user → store email only, no password.
  const saveCredential = (email, pw) => {
    try {
      const raw = localStorage.getItem("nv-saved-cred");
      const existing = raw ? JSON.parse(raw) : null;
      if (!existing || existing.email === email) {
        localStorage.setItem("nv-saved-cred", JSON.stringify({ email, password: pw, savedAt: Date.now() }));
      } else {
        // New user on same device — save email but not their password
        localStorage.setItem("nv-saved-cred", JSON.stringify({ email, password: "", savedAt: Date.now() }));
      }
      setCredSaved(true);
    } catch(e) {}
  };

  const toast = (msg, type="info") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  };

  // ── Forgot Password ──
  const sendResetCode = async () => {
    if (!forgotEmail.trim()) return toast("Enter your email","error");
    const users = ls("nv-users",[]);
    const user = users.find(u=>u.username===forgotEmail.trim());
    if (!user) return toast("No account found with that email","error");
    setForgotLoading(true);
    // Generate 6-digit code and store in backend (10-min expiry)
    const code = String(Math.floor(100000+Math.random()*900000));
    _setResetCode(code);
    await examBsSet(`reset:${forgotEmail.trim()}`, {code, expires: Date.now()+600000});

    // ── Send real email via EmailJS ──
    const emailConfigured =
      EMAILJS_PUBLIC_KEY  !== "YOUR_PUBLIC_KEY"  &&
      EMAILJS_SERVICE_ID  !== "YOUR_SERVICE_ID"  &&
      EMAILJS_TEMPLATE_ID !== "YOUR_TEMPLATE_ID";

    if (emailConfigured) {
      try {
        await sendResetEmail(forgotEmail.trim(), code);
        setForgotLoading(false);
        setForgotMode("code");
        toast("📧 Reset code sent! Check your inbox (and spam folder).","success");
      } catch (err) {
        console.error("EmailJS error:", err);
        setForgotLoading(false);
        setForgotMode("code");
        // Fallback: show code on screen if email fails
        toast(`⚠️ Email failed — your code is: ${code}  (valid 10 min)`, "warn");
      }
    } else {
      // EmailJS not yet configured — show code in toast as fallback
      setForgotLoading(false);
      setForgotMode("code");
      toast(`📧 Reset code: ${code} — valid 10 minutes`, "success");
    }
  };

  const verifyResetCode = async () => {
    if (!forgotCode.trim()) return toast("Enter the reset code","error");
    if (!forgotNewPw.trim() || forgotNewPw.length < 6) return toast("Password must be at least 6 characters","error");
    setForgotLoading(true);
    // Check code from backend (works cross-device) or local fallback
    const stored = await examBsGet(`reset:${forgotEmail.trim()}`);
    const localCode = _resetCode;
    const codeMatch = (stored?.code===forgotCode.trim()&&Date.now()<stored?.expires) || localCode===forgotCode.trim();
    if (!codeMatch) { setForgotLoading(false); return toast("Invalid or expired code","error"); }
    // Update password in both localStorage and backend
    const users = ls("nv-users",[]);
    const updated = users.map(u=>u.username===forgotEmail.trim()?{...u,password:forgotNewPw.trim()}:u);
    saveShared("users",updated);
    // Clear reset code from backend
    try { await examBsSet(`reset:${forgotEmail.trim()}`, null); } catch {}
    setForgotLoading(false);
    setForgotMode(false); setForgotEmail(""); setForgotCode(""); setForgotNewPw(""); _setResetCode("");
    toast("✅ Password reset! You can now sign in.","success");
  };

  const login = async () => {
    if (!username || !password) return toast("Fill in all fields", "error");
    // Step 1: Check localStorage instantly (sub 100ms)
    const localUsers = ls("nv-users", []);
    const localUser = localUsers.find(u => u.username === username && u.password === password);
    if (localUser) {
      // Instant login from cache
      if (loginType === "admin" && localUser.role !== "admin") return toast("Not an admin account", "error");
      setCurrentUserRef(username); setCurrentUser(username);
      setIsAdmin(localUser.role === "admin"); setIsLecturer(localUser.role === "lecturer");
      setPage("app");
      toast(`Welcome back! 👋`, "success");
      saveCredential(username, password);
      // Sync everything in background (non-blocking)
      syncUserPrivateData(username).then(()=>{
        const notifs = ls("nv-notifications", []);
        setUnreadNotifs(notifs.filter(n => !n.read).length);
      });
      loadShared("users", localUsers); // refresh users from backend silently
      return;
    }
    // Step 2: Not in local cache → fetch from backend with 4s timeout
    try {
      const fresh = await Promise.race([
        loadShared("users", [{username:"admin@gmail.com",password:"admin123",role:"admin",class:"",joined:"System"}]),
        new Promise((_,reject) => setTimeout(()=>reject(new Error("timeout")), 4000))
      ]);
      const remoteUser = (fresh||[]).find(u => u.username === username && u.password === password);
      if (!remoteUser) return toast("Invalid email or password", "error");
      if (loginType === "admin" && remoteUser.role !== "admin") return toast("Not an admin account", "error");
      setCurrentUserRef(username); setCurrentUser(username);
      setIsAdmin(remoteUser.role === "admin"); setIsLecturer(remoteUser.role === "lecturer");
      setPage("app");
      toast(`Welcome back! 👋`, "success");
      saveCredential(username, password);
      syncUserPrivateData(username).then(()=>{
        const notifs = ls("nv-notifications", []);
        setUnreadNotifs(notifs.filter(n => !n.read).length);
      });
    } catch (e) {
      toast("Login failed — check your connection and try again", "error");
    }
  };

  const register = () => {
    if (!regUser || !regPw) return toast("Fill in all fields", "error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regUser)) return toast("Enter a valid email address", "error");
    const users = ls("nv-users", []);
    if (users.find(u => u.username === regUser)) return toast("Email already registered", "error");
    const displayName = regUser.split("@")[0];
    const newUsers = [...users, { username: regUser, password: regPw, role: "student", class: regClass, displayName, joined: new Date().toLocaleDateString() }];
    saveShared("users", newUsers);
    setCurrentUserRef(regUser); setCurrentUser(regUser);
    setIsAdmin(false); setIsLecturer(false);
    setPage("app");
    toast(`Welcome! 🎉`, "success");
    saveCredential(regUser, regPw);
  };

  const [selectedExamType, setSelectedExamType] = useState(null);

  const navigate = (section, cls = null, examType = null) => {
    setNavHistory(h => [...h, { nav: activeNav, tool: activeTool, cls: selectedClass }]);
    setActiveNav(section); setActiveTool(null); if (cls) setSelectedClass(cls);
    if (examType) setSelectedExamType(examType); else setSelectedExamType(null);
    setSidebarOpen(false);
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
    if (activeTool === "med-calc") return <MedCalc />;
    if (activeTool === "skills") return <SkillsView />;
    if (activeTool === "gpa") return <GPACalc toast={toast} />;
    switch (activeNav) {
      case "dashboard": return <Dashboard user={currentUser} onNavigate={navigate} />;
      case "handouts": return <Handouts selectedClass={selectedClass} toast={toast} currentUser={currentUser} isLecturer={isLecturer||isAdmin} />;
      case "results": return <Results toast={toast} />;
      case "cbt": return (isLecturer||isAdmin)
        ? <CbtExamManager toast={toast} currentUser={currentUser} />
        : <CbtStudentView toast={toast} currentUser={currentUser} />;
      case "questions": return <SchoolOnlyPastQuestionsView toast={toast} currentUser={currentUser} />;
      case "nursingexams": return <NursingExamsStandaloneView toast={toast} currentUser={currentUser} initialExam={selectedExamType} />;
      case "messages": return <Messages user={currentUser} toast={toast} />;
      case "notifications": return <Notifications currentUser={currentUser} onRead={()=>setUnreadNotifs(0)} />;
      case "profile": return <StudentProfile currentUser={currentUser} toast={toast} />;
      default: return <Dashboard user={currentUser} onNavigate={navigate} />;
    }
  };

  const NAV = [
    { icon:"⊞", label:"Dashboard", key:"dashboard" },
    { icon:"📄", label:"All Handouts", key:"handouts" },
    { icon:"📊", label:"Results", key:"results" },
    { icon:"📝", label:"CBT Exams", key:"cbt" },
    { icon:"🏫", label:"School Past Questions", key:"questions" },
    { icon:"🔔", label:"Notifications", key:"notifications" },
    { icon:"💬", label:"Messages", key:"messages" },
    { icon:"👤", label:"My Profile", key:"profile" },
  ];
  const TOOLS = [
    { icon:"🧪", label:"Lab Reference", key:"lab-ref" },
    { icon:"💊", label:"Drug Guide", key:"drug-guide" },
    { icon:"🧮", label:"Med Calculator", key:"med-calc" },
    { icon:"✅", label:"Skills Checklist", key:"skills" },
    { icon:"🎓", label:"GPA Calculator", key:"gpa" },
  ];

  if (page === "auth") return (
    <>
      <style>{CSS}</style>
      <div className="auth-page">
        <div className="auth-bg-img" />
        <div className="auth-wrap">
          <div className="auth-card">
            <div className="auth-logo">
              <div className="auth-logo-icon">🏥</div>
              <div className="auth-logo-name">Nursing Academic Hub</div>
              <span style={{marginLeft:4,fontSize:20}}>🌙</span>
            </div>
            <div className="auth-sub">// nursing school handouts &amp; resources</div>

            {/* Hidden admin toggle */}
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:4}}>
              <div onClick={()=>setLoginType(t=>t==="admin"?"student":"admin")} style={{width:5,height:5,borderRadius:"50%",background:"rgba(255,255,255,0.06)",cursor:"pointer"}} />
            </div>

            {/* ── Forgot Password Flow ── */}
            {forgotMode ? (
              <>
                <div style={{textAlign:"center",marginBottom:16}}>
                  <div style={{fontSize:32,marginBottom:6}}>{forgotMode==="code"?"🔑":"📧"}</div>
                  <div style={{fontWeight:800,fontSize:16,marginBottom:4}}>{forgotMode==="code"?"Enter Reset Code":"Reset Password"}</div>
                  <div style={{fontSize:12,color:"var(--text3)"}}>
                    {forgotMode==="code"?`We sent a 6-digit code to ${forgotEmail}`:"Enter your registered email address"}
                  </div>
                </div>
                {forgotMode==="email"&&(
                  <>
                    <label className="lbl">Email Address</label>
                    <input className="inp" type="email" placeholder="your@email.com" value={forgotEmail}
                      onChange={e=>setForgotEmail(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&sendResetCode()} />
                    <button className="btn-primary" onClick={sendResetCode} disabled={forgotLoading}>
                      {forgotLoading?"📤 Sending...":"📧 Send Reset Code"}
                    </button>
                  </>
                )}
                {forgotMode==="code"&&(
                  <>
                    <label className="lbl">Reset Code</label>
                    <input className="inp" type="text" placeholder="6-digit code" maxLength={6} value={forgotCode}
                      onChange={e=>setForgotCode(e.target.value)} />
                    <label className="lbl">New Password</label>
                    <input className="inp" type="password" placeholder="Min 6 characters" value={forgotNewPw}
                      onChange={e=>setForgotNewPw(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&verifyResetCode()} />
                    <button className="btn-primary" onClick={verifyResetCode} disabled={forgotLoading}>
                      {forgotLoading?"⏳ Verifying...":"🔐 Reset Password"}
                    </button>
                    <div style={{textAlign:"center",marginTop:8}}>
                      <span style={{fontSize:12,color:"var(--accent)",cursor:"pointer"}} onClick={()=>{setForgotMode("email");setForgotCode("");setForgotNewPw("");}}>
                        ← Resend code
                      </span>
                    </div>
                  </>
                )}
                <div className="auth-switch" style={{marginTop:12}}>
                  <span onClick={()=>{setForgotMode(false);setForgotEmail("");setForgotCode("");setForgotNewPw("");}}>← Back to Sign In</span>
                </div>
              </>
            ) : (
              <>
                <div className="auth-tabs">
                  <div className={`auth-tab${authTab==="signin"?" active":""}`} onClick={()=>setAuthTab("signin")}>Sign In</div>
                  <div className={`auth-tab${authTab==="register"?" active":""}`} onClick={()=>setAuthTab("register")}>Create Account</div>
                </div>

                {authTab==="signin" ? (
                  <>
                    <label className="lbl" style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      Email
                      {credSaved&&<span style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"rgba(34,197,94,.12)",color:"var(--success)",fontWeight:700}}>🔒 Remembered</span>}
                    </label>
                    <input className="inp" type="email" placeholder="Enter your email" autoComplete="username" value={username} onChange={e=>{setUsername(e.target.value);setCredSaved(false);}} onKeyDown={e=>e.key==="Enter"&&login()} />
                    <label className="lbl">Password</label>
                    <div className="inp-wrap">
                      <input className="inp" type={showPw?"text":"password"} placeholder="••••••••" autoComplete="current-password" value={password} onChange={e=>{setPassword(e.target.value);}} onKeyDown={e=>e.key==="Enter"&&login()} />
                      <button className="inp-eye" onClick={()=>setShowPw(p=>!p)}>{showPw?"🙈":"👁"}</button>
                    </div>
                    <button className={`btn-primary${loginType==="admin"?" btn-admin":""}`} onClick={login}>
                      {loginType==="admin"?"🛡️ Admin Sign In →":"Sign In →"}
                    </button>
                    <div style={{textAlign:"center",marginTop:10}}>
                      <span style={{fontSize:12,color:"var(--accent2)",cursor:"pointer",textDecoration:"underline"}}
                        onClick={()=>{setForgotMode("email");setForgotEmail(username||"");}}>
                        🔑 Forgot password?
                      </span>
                    </div>
                    <div className="auth-switch" style={{marginTop:6}}>No account? <span onClick={()=>setAuthTab("register")}>Register here</span></div>
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
              </>
            )}
          </div>
        </div>
      </div>
      <Toasts list={toasts} />
    </>
  );

  if (siteMode === "nursing") {
    return <NursingCouncilSite
      currentUser={currentUser} isAdmin={isAdmin}
      onSwitchToSchool={switchToSchool}
      toast={toast} themeMode={themeMode} setThemeMode={setThemeMode}
    />;
  }

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
          {(() => {
            const groups = [
              { key:"bnsc", label:"BNSc", icon:"🎓", match: c => c.id?.startsWith("bnsc") || c.label?.toLowerCase().includes("bnsc") },
              { key:"ndhnd", label:"ND / HND", icon:"📚", match: c => ["nd","hnd"].some(p => c.id?.startsWith(p) || c.label?.toLowerCase().startsWith(p)) },
              { key:"cn", label:"Community Nursing", icon:"🏥", match: c => c.id?.startsWith("cn") || c.label?.toLowerCase().includes("community") || c.label?.toLowerCase().includes("cn ") },
            ];
            const assigned = new Set();
            const grouped = groups.map(g => {
              const members = classes.filter(c => { if(assigned.has(c.id)) return false; if(g.match(c)){assigned.add(c.id);return true;} return false; });
              return {...g, members};
            });
            const others = classes.filter(c => !assigned.has(c.id));
            return (
              <>
                {grouped.map(group => (
                  <div key={group.key}>
                    <div
                      className="nav-item"
                      style={{justifyContent:"space-between",cursor:"pointer"}}
                      onClick={()=>setOpenGroup(openGroup===group.key ? null : group.key)}
                    >
                      <span style={{display:"flex",alignItems:"center",gap:9}}>
                        <span className="nav-icon">{group.icon}</span>{group.label}
                      </span>
                      <span style={{fontSize:11,color:"var(--text3)",display:"inline-block",transition:"transform .2s",transform:openGroup===group.key?"rotate(180deg)":"rotate(0deg)"}}>▾</span>
                    </div>
                    {openGroup===group.key && group.members.map(c=>(
                      <div key={c.id} className="nav-item" style={{paddingLeft:30,fontSize:13}} onClick={()=>{navigate("handouts",c);setSidebarOpen(false);}}>
                        <span className="class-dot" style={{background:c.color}} />{c.label}
                      </div>
                    ))}
                  </div>
                ))}
                {others.map(c=>(
                  <div key={c.id} className="nav-item" onClick={()=>navigate("handouts",c)}>
                    <span className="class-dot" style={{background:c.color}} />{c.label}
                  </div>
                ))}
              </>
            );
          })()}

          <div style={{padding:"16px 8px 0"}}>
            <div className={`nav-item${activeNav==="profile"?" active":""}`}
              style={{marginBottom:4}} onClick={()=>navigate("profile")}>
              <span className="nav-icon">👤</span>
              <span>My Profile</span>
            </div>
            <div className="nav-item" style={{color:"#7bc950",background:"rgba(90,158,53,.15)",borderRadius:9,marginBottom:4}} onClick={switchToNursing}>
              <span className="nav-icon">🏛️</span>NC Exam Centre
            </div>
            <div className="nav-item" style={{color:"var(--danger)",marginBottom:12}} onClick={()=>{setPage("auth");setCurrentUser("");setIsAdmin(false);setIsLecturer(false);setNavHistory([]);}}>
              <span className="nav-icon">🚪</span>Sign Out
            </div>

            {/* ── Profile card at bottom of sidebar ── */}
            <div onClick={()=>{navigate("profile");setSidebarOpen(false);}} style={{
              padding:"12px 14px", borderRadius:14,
              background:"var(--bg4)", border:"1.5px solid var(--border)",
              cursor:"pointer", transition:"all .2s", marginBottom:8,
            }}
            onMouseEnter={e=>e.currentTarget.style.borderColor="var(--accent)"}
            onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}
            >
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                {/* Avatar circle */}
                <div style={{
                  width:44, height:44, borderRadius:"50%", flexShrink:0,
                  background:"linear-gradient(135deg,var(--accent),var(--accent2))",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:24, border:"2px solid var(--border2)",
                  boxShadow:"0 2px 8px rgba(0,0,0,.15)",
                }}>
                  {(()=>{const me=ls("nv-users",[]).find(u=>u.username===currentUser);return me?.avatar||(currentUser[0]||"?").toUpperCase();})()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:800,fontSize:13,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {(()=>{const me=ls("nv-users",[]).find(u=>u.username===currentUser);return me?.displayName||currentUser.split("@")[0];})()}
                  </div>
                  <div style={{fontSize:10,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {currentUser}
                  </div>
                  <div style={{fontSize:10,marginTop:2,color:"var(--accent)",fontWeight:700}}>
                    {(()=>{const me=ls("nv-users",[]).find(u=>u.username===currentUser);const cls=ls("nv-classes",DEFAULT_CLASSES).find(c=>c.id===me?.class);return cls?`🏫 ${cls.label}`:isAdmin?"🛡️ Admin":isLecturer?"👨‍🏫 Lecturer":"🎓 Student";})()}
                  </div>
                </div>
                <div style={{fontSize:14,color:"var(--text3)",flexShrink:0}}>›</div>
              </div>
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
              <button className="nc-toggle-btn" onClick={switchToNursing} title="Switch to Nursing Council Exam Site">
                🏛️ NC Exams
              </button>
              <div className="theme-btn" onClick={()=>setThemeMode(m=>m==="light"?"dark":m==="dark"?"dim":"light")}>{themeMode==="light"?"🌙 Dark":themeMode==="dark"?"💙 Dim":"☀️ Light"}</div>
              <div className="icon-btn" title={syncError?"⚠️ JSONBin not configured or unreachable — tap to retry":"Sync data from server"}
                onClick={()=>{ if(!syncing) runSync().then(ok=>ok?toast("✅ Data synced!","success"):toast("❌ Sync failed — check JSONBin API key or connection","error")); }}
                style={{opacity:syncing?.5:1,cursor:syncing?"wait":"pointer",position:"relative"}}>
                <span style={{display:"inline-block",animation:syncing?"spin 1s linear infinite":"none"}}>{syncError?"⚠️":"🔄"}</span>
                {syncError&&<span style={{position:"absolute",top:-3,right:-3,width:8,height:8,borderRadius:"50%",background:"var(--danger)"}}/>}
              </div>
              <div className="icon-btn" style={{position:"relative"}} onClick={()=>navigate("notifications")}>
                🔔
                {unreadNotifs > 0 && <span style={{position:"absolute",top:-4,right:-4,background:"var(--danger)",color:"white",borderRadius:"50%",width:16,height:16,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontWeight:700}}>{unreadNotifs>9?"9+":unreadNotifs}</span>}
              </div>
              <div onClick={()=>navigate("profile")} title="My Profile"
                style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),var(--accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,cursor:"pointer",border:`2px solid ${activeNav==="profile"?"white":"transparent"}`,transition:"all .2s",flexShrink:0}}>
                {(()=>{const me=ls("nv-users",[]).find(u=>u.username===currentUser);return me?.avatar||(currentUser[0]||"?").toUpperCase();})()}
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
