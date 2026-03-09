import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const WARDS = [
  "Ward A – General Medicine","Ward B – Surgical","Ward C – Pediatrics",
  "Ward D – Cardiology","Ward E – Orthopedics","Ward F – ICU",
  "Ward G – Maternity","Ward H – Oncology",
];
const ROLES = [
  { value:"nurse", label:"Ward Nurse" },
  { value:"supervisor", label:"Supervisor / Overall Nurse" },
  { value:"wardmaster", label:"Ward Master" },
];
const SHIFTS = ["Morning (07:00–15:00)","Afternoon (15:00–23:00)","Night (23:00–07:00)"];

const today = () => new Date().toISOString().split("T")[0];
const nowTime = () => new Date().toTimeString().slice(0,5);
const uid = () => Math.random().toString(36).slice(2,10);

// ─── IN-MEMORY STORE ──────────────────────────────────────────────────────────
const Store = (() => {
  let users = [];
  let patients = [];
  let session = null;
  let overallNurse = null;
  return {
    registerUser: (d) => {
      if (users.find(u=>u.username===d.username)) return {ok:false,error:"Username already taken."};
      const u = {...d, id:uid(), createdAt:new Date().toISOString()};
      users.push(u);
      return {ok:true, user:{id:u.id,name:u.name,username:u.username,role:u.role,ward:u.ward}};
    },
    loginUser: (username, password) => {
      const u = users.find(u=>u.username===username);
      if (!u) return {ok:false, error:"User not found."};
      if (u.password!==password) return {ok:false, error:"Incorrect password."};
      session = {id:u.id,name:u.name,username:u.username,role:u.role,ward:u.ward};
      return {ok:true, user:session};
    },
    getSession: () => session,
    logout: () => { session=null; },
    getUsers: () => users.map(u=>({id:u.id,name:u.name,username:u.username,role:u.role,ward:u.ward})),
    getPatients: () => patients,
    getPatient: (id) => patients.find(p=>p.id===id)||null,
    createPatient: (d) => {
      const p = {
        id:"PT-"+uid(), status:"active", createdAt:new Date().toISOString(),
        vitals:[], medAdminLogs:[], glucoseReadings:[], fluidEntries:[],
        prescriptions:[], nursingReports:[], statusHistory:[], transfusions:[],
        ...d,
      };
      patients.push(p);
      return {ok:true, patient:p};
    },
    updatePatient: (id, data) => {
      const i = patients.findIndex(p=>p.id===id);
      if (i===-1) return {ok:false};
      patients[i] = {...patients[i], ...data, updatedAt:new Date().toISOString()};
      return {ok:true, patient:patients[i]};
    },
    addVitals: (id, v) => {
      const p = patients.find(p=>p.id===id);
      if (!p) return {ok:false};
      p.vitals = [{...v,id:uid(),recordedAt:new Date().toISOString()}, ...p.vitals];
      return {ok:true, patient:p};
    },
    addGlucose: (id, r) => {
      const p = patients.find(p=>p.id===id);
      if (!p) return {ok:false};
      p.glucoseReadings = [{...r,id:uid()}, ...p.glucoseReadings];
      return {ok:true, patient:p};
    },
    addFluid: (id, e) => {
      const p = patients.find(p=>p.id===id);
      if (!p) return {ok:false};
      p.fluidEntries = [{...e,id:uid()}, ...p.fluidEntries];
      return {ok:true, patient:p};
    },
    addMedAdmin: (id, e) => {
      const p = patients.find(p=>p.id===id);
      if (!p) return {ok:false};
      p.medAdminLogs = [{...e,id:uid()}, ...p.medAdminLogs];
      return {ok:true, patient:p};
    },
    savePrescriptions: (id, list) => {
      const p = patients.find(p=>p.id===id);
      if (!p) return {ok:false};
      p.prescriptions = list;
      return {ok:true, patient:p};
    },
    addNursingReport: (id, r) => {
      const p = patients.find(p=>p.id===id);
      if (!p) return {ok:false};
      p.nursingReports = [...p.nursingReports,{...r,id:uid()}];
      return {ok:true, patient:p};
    },
    addTransfusion: (id, r) => {
      const p = patients.find(p=>p.id===id);
      if (!p) return {ok:false};
      p.transfusions = [{...r,id:uid()}, ...(p.transfusions||[])];
      return {ok:true, patient:p};
    },
    applyStatus: (id, action, ward, notes, date) => {
      const p = patients.find(p=>p.id===id);
      if (!p) return {ok:false};
      const entry = {action,date,notes,id:uid()};
      if (action==="discharge") p.status="discharged";
      else if (action==="transfer" && ward) { p.ward=ward; entry.toWard=ward; }
      p.statusHistory = [...(p.statusHistory||[]), entry];
      return {ok:true, patient:p};
    },
    setOverallNurse: (name) => { overallNurse=name; return name; },
    getOverallNurse: () => overallNurse,
  };
})();

// ─── AI CLIENT ────────────────────────────────────────────────────────────────
const AI = {
  async call(system, user, maxTokens=800) {
    const res = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"claude-sonnet-4-20250514", max_tokens:maxTokens,
        system, messages:[{role:"user",content:user}],
      }),
    });
    if (!res.ok) throw new Error("API error "+res.status);
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    return d.content.map(c=>c.type==="text"?c.text:"").join("");
  },
  summarize: (p) => AI.call(
    "You are a clinical AI assistant for nurses. Write a concise professional patient handover summary in plain text under 200 words.",
    JSON.stringify({name:p.name,diagnosis:p.diagnosis,ward:p.ward,status:p.status,allergies:p.allergies,physician:p.physician,admission:p.admission,latestVitals:p.vitals[0]||null,medications:(p.prescriptions||[]).map(m=>m.drug+" "+m.dosage)})
  ),
  careSuggestions: (p) => AI.call(
    "You are a senior nurse AI advisor. Suggest top 5 prioritized nursing care actions for the current shift. Plain text, numbered, under 200 words.",
    `Patient: ${p.name} | Diagnosis: ${p.diagnosis||"N/A"} | Allergies: ${p.allergies||"none"} | Status: ${p.status} | Ward: ${p.ward||"unknown"} | Latest vitals: ${JSON.stringify(p.vitals[0]||{})}`
  ),
  checkInteractions: (meds) => AI.call(
    "You are a clinical pharmacist AI. Check for drug-drug interactions. Plain text, flag High/Medium/Low risk, under 150 words.",
    "Medications: "+meds.map(m=>`${m.drug} ${m.dosage} (${m.route})`).join(", ")
  ),
  analyzeVitals: (v,name,dx) => AI.call(
    "You are a clinical nurse AI. Analyze vitals for abnormalities. Flag concerns, suggest actions. Plain text, under 100 words.",
    `Patient: ${name} | Diagnosis: ${dx||"unknown"}\nBP=${v.bp}, HR=${v.hr}bpm, Temp=${v.temp}°C, RR=${v.rr}/min, SpO2=${v.spo2}%`
  ),
  chat: (msg) => AI.call(
    "You are Claude, an AI clinical assistant for nurses. Give concise, evidence-based, practical answers. Plain text. Always advise consulting a physician for clinical decisions.",
    msg, 800
  ),
};

// ─── STYLES ───────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,700;1,9..144,400&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0b1623; --bg2: #0f1e2e; --bg3: #132438; --card: #162b40; --card2: #1a3350;
    --accent: #2dd4bf; --accent2: #14b8a6; --accent3: rgba(45,212,191,0.12);
    --blue: #3b82f6; --purple: #818cf8;
    --t1: #e2eef9; --t2: #7fa8c9; --t3: #4d7a9a;
    --success: #34d399; --warning: #fbbf24; --danger: #f87171;
    --border: rgba(45,212,191,0.14); --border2: rgba(255,255,255,0.06);
    --shadow: 0 8px 32px rgba(0,0,0,0.5);
    --r: 12px; --r-sm: 8px; --r-lg: 18px;
    --font: 'DM Sans', sans-serif; --mono: 'DM Mono', monospace; --display: 'Fraunces', serif;
  }
  body { font-family: var(--font); background: var(--bg); color: var(--t1); min-height: 100vh; }
  input, select, textarea, button { font-family: var(--font); }
  input[type=number]::-webkit-outer-spin-button,
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }

  /* Layout */
  .app { display: flex; min-height: 100vh; }
  .sidebar { width: 220px; min-height: 100vh; background: var(--bg2); border-right: 1px solid var(--border2); display: flex; flex-direction: column; position: fixed; top: 0; left: 0; bottom: 0; z-index: 100; }
  .main { flex: 1; margin-left: 220px; display: flex; flex-direction: column; min-height: 100vh; }
  .topbar { height: 60px; background: var(--bg2); border-bottom: 1px solid var(--border2); display: flex; align-items: center; justify-content: space-between; padding: 0 24px; position: sticky; top: 0; z-index: 50; }
  .content { flex: 1; display: flex; overflow: hidden; }

  /* Sidebar */
  .sb-logo { padding: 20px 16px; border-bottom: 1px solid var(--border2); }
  .sb-logo-mark { display: flex; align-items: center; gap: 10px; }
  .sb-icon { width: 34px; height: 34px; background: linear-gradient(135deg, var(--accent), var(--accent2)); border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
  .sb-name { font-family: var(--display); font-size: 17px; font-weight: 700; color: var(--t1); }
  .sb-sub { font-size: 10px; color: var(--t3); letter-spacing: 0.5px; text-transform: uppercase; }
  .sb-user { padding: 14px 16px; border-bottom: 1px solid var(--border2); display: flex; align-items: center; gap: 10px; }
  .sb-avatar { width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--purple)); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; color: #000; }
  .sb-uname { font-size: 12px; font-weight: 600; color: var(--t1); }
  .sb-urole { font-size: 10px; color: var(--accent); }
  .sb-nav { flex: 1; padding: 12px 8px; overflow-y: auto; }
  .nav-section { font-size: 9px; font-weight: 700; color: var(--t3); text-transform: uppercase; letter-spacing: 1px; padding: 12px 8px 4px; }
  .nav-btn { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px 10px; border: none; border-radius: var(--r-sm); background: none; color: var(--t2); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s; margin-bottom: 1px; text-align: left; }
  .nav-btn:hover { background: var(--accent3); color: var(--t1); }
  .nav-btn.active { background: var(--accent3); color: var(--accent); border: 1px solid var(--border); }
  .nav-btn .ni { font-size: 14px; width: 18px; text-align: center; }
  .sb-footer { padding: 12px 8px; border-top: 1px solid var(--border2); }

  /* Topbar */
  .tb-title { font-family: var(--display); font-size: 17px; font-weight: 700; }
  .tb-sub { font-size: 11px; color: var(--t2); margin-top: 1px; }
  .tb-right { display: flex; align-items: center; gap: 8px; }
  .badge-live { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; background: rgba(52,211,153,0.1); color: var(--success); border: 1px solid rgba(52,211,153,0.2); }
  .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

  /* Buttons */
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: var(--r-sm); border: none; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
  .btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #000; }
  .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
  .btn-secondary { background: var(--accent3); color: var(--accent); border: 1px solid var(--border); }
  .btn-secondary:hover { background: rgba(45,212,191,0.2); }
  .btn-danger { background: rgba(248,113,113,0.1); color: var(--danger); border: 1px solid rgba(248,113,113,0.2); }
  .btn-danger:hover { background: rgba(248,113,113,0.2); }
  .btn-ghost { background: rgba(255,255,255,0.04); color: var(--t2); border: 1px solid var(--border2); }
  .btn-ghost:hover { background: rgba(255,255,255,0.08); color: var(--t1); }
  .btn-lg { padding: 12px 20px; font-size: 14px; border-radius: var(--r); width: 100%; justify-content: center; }
  .btn-sm { padding: 5px 10px; font-size: 11px; }

  /* Forms */
  .form-group { margin-bottom: 14px; }
  .form-label { display: block; font-size: 10px; font-weight: 700; color: var(--t3); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 5px; }
  .form-input, .form-select, .form-textarea {
    width: 100%; padding: 10px 14px; background: var(--bg3); border: 1px solid var(--border2);
    border-radius: var(--r-sm); color: var(--t1); font-size: 13px; outline: none;
    transition: border-color 0.15s; font-family: var(--font);
    -webkit-appearance: none; appearance: none;
  }
  .form-input:focus, .form-select:focus, .form-textarea:focus { border-color: var(--accent); }
  .form-input::placeholder, .form-textarea::placeholder { color: var(--t3); }
  .form-textarea { resize: vertical; min-height: 80px; }
  .form-select option { background: var(--bg2); }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-hint { font-size: 11px; color: var(--t3); margin-top: 4px; }
  .form-error { font-size: 12px; color: var(--danger); margin-top: 6px; padding: 8px 12px; background: rgba(248,113,113,0.08); border-radius: var(--r-sm); border: 1px solid rgba(248,113,113,0.2); }
  .form-success { font-size: 12px; color: var(--success); margin-top: 6px; padding: 8px 12px; background: rgba(52,211,153,0.08); border-radius: var(--r-sm); }

  /* Cards */
  .card { background: var(--card); border: 1px solid var(--border2); border-radius: var(--r-lg); }
  .card-header { padding: 16px 20px; border-bottom: 1px solid var(--border2); display: flex; align-items: center; justify-content: space-between; }
  .card-title { font-size: 13px; font-weight: 700; color: var(--t1); }
  .card-body { padding: 16px 20px; }

  /* Patient list panel */
  .pt-panel { width: 260px; background: var(--bg2); border-right: 1px solid var(--border2); display: flex; flex-direction: column; flex-shrink: 0; }
  .pt-panel-header { padding: 16px 14px; border-bottom: 1px solid var(--border2); }
  .pt-panel-title { font-size: 13px; font-weight: 700; margin-bottom: 10px; }
  .filter-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
  .filter-tab { flex: 1; padding: 5px; border: none; border-radius: var(--r-sm); background: var(--bg3); color: var(--t2); font-size: 11px; font-weight: 600; cursor: pointer; font-family: var(--font); transition: all 0.15s; }
  .filter-tab.active { background: var(--accent3); color: var(--accent); }
  .pt-list { flex: 1; overflow-y: auto; padding: 8px; }
  .pt-card { padding: 11px 12px; border-radius: var(--r-sm); cursor: pointer; border: 1px solid transparent; transition: all 0.15s; margin-bottom: 4px; }
  .pt-card:hover { background: var(--accent3); border-color: var(--border); }
  .pt-card.active { background: var(--accent3); border-color: var(--accent); }
  .pt-name { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
  .pt-meta { font-size: 11px; color: var(--t2); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

  /* Detail area */
  .pt-detail { flex: 1; overflow-y: auto; padding: 22px; }
  .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--t3); text-align: center; padding: 40px; }
  .empty-icon { font-size: 48px; opacity: 0.25; margin-bottom: 12px; }
  .empty-text { font-size: 15px; font-weight: 600; color: var(--t2); margin-bottom: 6px; }
  .empty-sub { font-size: 12px; }

  /* Patient header */
  .pt-header { background: linear-gradient(135deg, var(--card), var(--card2)); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 20px 24px; margin-bottom: 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .pt-header-info h2 { font-family: var(--display); font-size: 22px; font-weight: 700; }
  .pt-header-meta { font-size: 12px; color: var(--t2); margin-top: 4px; display: flex; gap: 12px; flex-wrap: wrap; }
  .pt-header-actions { display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

  /* AI Bar */
  .ai-bar { background: linear-gradient(135deg, rgba(45,212,191,0.08), rgba(129,140,248,0.06)); border: 1px solid var(--border); border-radius: var(--r); padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ai-bar-label { font-size: 11px; font-weight: 700; color: var(--accent); margin-right: 4px; white-space: nowrap; }
  .ai-btn { padding: 5px 12px; border: 1px solid var(--border); border-radius: 20px; background: rgba(45,212,191,0.08); color: var(--t1); font-size: 11px; font-weight: 600; cursor: pointer; font-family: var(--font); transition: all 0.15s; }
  .ai-btn:hover { background: rgba(45,212,191,0.18); color: var(--accent); }
  .ai-btn:disabled { opacity: 0.5; cursor: wait; }

  /* Stat cards */
  .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .stat-card { background: var(--card); border: 1px solid var(--border2); border-radius: var(--r); padding: 14px 16px; }
  .stat-icon { font-size: 18px; margin-bottom: 6px; }
  .stat-label { font-size: 10px; color: var(--t2); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-value { font-family: var(--mono); font-size: 20px; font-weight: 500; color: var(--t1); margin: 2px 0; }
  .stat-unit { font-size: 10px; color: var(--t3); }

  /* Quick actions */
  .quick-actions { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin-bottom: 16px; }
  .quick-btn { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--card); border: 1px solid var(--border2); border-radius: var(--r-sm); cursor: pointer; font-size: 12px; font-weight: 500; color: var(--t2); font-family: var(--font); transition: all 0.15s; text-align: left; }
  .quick-btn:hover { background: var(--accent3); border-color: var(--border); color: var(--t1); }
  .quick-btn-icon { font-size: 15px; }

  /* Tabs */
  .tabs-bar { display: flex; gap: 2px; background: var(--card); border: 1px solid var(--border2); border-radius: var(--r); padding: 4px; margin-bottom: 16px; overflow-x: auto; }
  .tab-btn { padding: 7px 14px; border: none; border-radius: var(--r-sm); background: none; color: var(--t2); font-size: 12px; font-weight: 600; cursor: pointer; font-family: var(--font); transition: all 0.15s; white-space: nowrap; }
  .tab-btn.active { background: var(--bg3); color: var(--accent); }

  /* Tables */
  .table-wrap { overflow-x: auto; border-radius: var(--r); border: 1px solid var(--border2); }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 9px 14px; text-align: left; font-size: 10px; font-weight: 700; color: var(--t3); text-transform: uppercase; letter-spacing: 0.5px; background: var(--bg3); border-bottom: 1px solid var(--border2); white-space: nowrap; }
  td { padding: 10px 14px; font-size: 12px; border-bottom: 1px solid var(--border2); color: var(--t1); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(45,212,191,0.03); }

  /* Status badges */
  .badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; }
  .badge-active { background: rgba(52,211,153,0.12); color: var(--success); }
  .badge-discharged { background: rgba(248,113,113,0.1); color: var(--danger); }
  .badge-given { background: rgba(52,211,153,0.12); color: var(--success); }
  .badge-missed { background: rgba(248,113,113,0.1); color: var(--danger); }
  .badge-held { background: rgba(251,191,36,0.1); color: var(--warning); }

  /* Modal */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px); }
  .modal { background: var(--card); border: 1px solid var(--border); border-radius: var(--r-lg); width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; position: relative; }
  .modal-lg { max-width: 700px; }
  .modal-xl { max-width: 860px; }
  .modal-header { padding: 18px 22px; border-bottom: 1px solid var(--border2); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; background: var(--card); z-index: 1; border-radius: var(--r-lg) var(--r-lg) 0 0; }
  .modal-title { font-family: var(--display); font-size: 16px; font-weight: 700; }
  .modal-close { background: none; border: none; color: var(--t2); font-size: 18px; cursor: pointer; line-height: 1; padding: 2px 6px; border-radius: 6px; }
  .modal-close:hover { color: var(--t1); background: var(--bg3); }
  .modal-body { padding: 20px 22px; }
  .modal-footer { padding: 14px 22px; border-top: 1px solid var(--border2); display: flex; gap: 8px; justify-content: flex-end; }

  /* Login */
  .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse 80% 60% at 20% 20%, rgba(45,212,191,0.07) 0%, transparent 60%), var(--bg); padding: 20px; }
  .login-box { width: 100%; max-width: 400px; background: var(--card); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 40px 36px; box-shadow: var(--shadow); position: relative; overflow: hidden; }
  .login-box::before { content:''; position:absolute; top:-1px; left:25%; right:25%; height:2px; background: linear-gradient(90deg, transparent, var(--accent), transparent); }
  .login-logo { text-align: center; margin-bottom: 28px; }
  .login-icon { width: 52px; height: 52px; background: linear-gradient(135deg, var(--accent), var(--accent2)); border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 24px; margin: 0 auto 10px; }
  .login-title { font-family: var(--display); font-size: 24px; font-weight: 700; }
  .login-sub { font-size: 12px; color: var(--t2); margin-top: 3px; }
  .tab-switcher { display: flex; background: var(--bg3); border-radius: var(--r-sm); padding: 3px; margin-bottom: 22px; }
  .tab-switch-btn { flex: 1; padding: 8px; border: none; border-radius: var(--r-sm); background: none; color: var(--t2); font-size: 12px; font-weight: 600; cursor: pointer; font-family: var(--font); transition: all 0.2s; }
  .tab-switch-btn.active { background: var(--card2); color: var(--accent); }

  /* Profile card */
  .profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .profile-item label { font-size: 10px; color: var(--t3); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px; }
  .profile-item span { font-size: 13px; font-weight: 600; }

  /* Toast */
  .toast { position: fixed; bottom: 24px; right: 24px; background: var(--card2); border: 1px solid var(--border); border-radius: var(--r); padding: 12px 18px; font-size: 13px; font-weight: 600; color: var(--t1); box-shadow: var(--shadow); z-index: 9999; transform: translateY(20px); opacity: 0; transition: all 0.25s; pointer-events: none; }
  .toast.show { transform: translateY(0); opacity: 1; }
  .toast-success { border-color: rgba(52,211,153,0.3); }
  .toast-error { border-color: rgba(248,113,113,0.3); color: var(--danger); }

  /* AI Chat */
  .ai-chat-msg { padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.6; max-width: 86%; }
  .ai-chat-msg.user { background: var(--accent3); border: 1px solid var(--border); border-radius: 12px 12px 4px 12px; margin-left: auto; }
  .ai-chat-msg.assistant { background: var(--bg3); border: 1px solid var(--border2); border-radius: 12px 12px 12px 4px; }
  .ai-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Info card (visit tab) */
  .info-card { background: var(--card); border: 1px solid var(--border2); border-radius: var(--r-lg); padding: 18px 20px; margin-bottom: 14px; }
  .info-card h4 { font-size: 12px; font-weight: 700; color: var(--t2); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 14px; }

  /* Vital chips */
  .vitals-row { display: grid; grid-template-columns: repeat(5,1fr); gap: 8px; margin-top: 12px; }
  .vital-chip { background: var(--bg3); border: 1px solid var(--border2); border-radius: var(--r-sm); padding: 10px 8px; text-align: center; }
  .vital-chip label { font-size: 9px; color: var(--t3); text-transform: uppercase; display: block; margin-bottom: 3px; letter-spacing: 0.5px; }
  .vital-chip span { font-family: var(--mono); font-size: 13px; font-weight: 500; color: var(--accent); }

  /* Fluid balance */
  .fluid-balance { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-bottom: 14px; }
  .fluid-stat { background: var(--bg3); border: 1px solid var(--border2); border-radius: var(--r-sm); padding: 12px; text-align: center; }
  .fluid-stat label { font-size: 10px; color: var(--t3); display: block; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fluid-stat span { font-family: var(--mono); font-size: 16px; font-weight: 500; color: var(--t1); }

  /* Med row */
  .med-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr auto; gap: 8px; margin-bottom: 8px; align-items: center; }
  .med-row-admin { display: grid; grid-template-columns: 110px 80px 2fr 1fr 1fr 1fr auto; gap: 8px; margin-bottom: 8px; align-items: center; }

  /* Reports dashboard */
  .report-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }

  /* Overall nurse panel */
  .overall-panel { background: var(--bg3); border: 1px solid var(--border2); border-radius: var(--r); padding: 14px; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
  .overall-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--t3); flex-shrink: 0; }
  .overall-dot.on { background: var(--success); box-shadow: 0 0 8px var(--success); }

  /* Print */
  @media print { .sidebar, .topbar, .ai-bar, .quick-actions, .btn, button { display: none !important; } .main { margin-left: 0 !important; } }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
`;

// ─── UTILITY COMPONENTS ───────────────────────────────────────────────────────
function Modal({ open, onClose, title, children, size="" }) {
  useEffect(() => {
    const h = (e) => { if (e.key==="Escape") onClose(); };
    if (open) document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className={`modal ${size}`}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toast({ msg, type }) {
  return <div className={`toast ${msg?"show":""} ${type==="error"?"toast-error":"toast-success"}`}>{msg}</div>;
}

function useToast() {
  const [state, setState] = useState({ msg:"", type:"success" });
  const show = useCallback((msg, type="success") => {
    setState({ msg, type });
    setTimeout(() => setState(s=>s.msg===msg?{...s,msg:""}:s), 3000);
  }, []);
  return [state, show];
}

function Spinner() {
  return <span className="ai-spinner" />;
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [tab, setTab] = useState("login");
  const [loginData, setLoginData] = useState({ username:"", password:"" });
  const [regData, setRegData] = useState({ name:"", username:"", password:"", role:"", ward:"" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const showMsg = (text, type="error") => setMsg({ text, type });

  const doLogin = () => {
    if (!loginData.username || !loginData.password) { showMsg("Enter username and password."); return; }
    setBusy(true);
    const r = Store.loginUser(loginData.username, loginData.password);
    setBusy(false);
    if (r.ok) onLogin(r.user);
    else showMsg(r.error);
  };

  const doRegister = () => {
    if (!regData.name || !regData.username || !regData.password || !regData.role) { showMsg("Fill in all required fields."); return; }
    const r = Store.registerUser(regData);
    if (!r.ok) { showMsg(r.error); return; }
    showMsg("Account created! You can now log in.", "success");
    setTab("login");
    setLoginData({ username: regData.username, password: regData.password });
  };

  const demoLogin = () => {
    const demo = { id:"demo", name:"Demo Nurse", username:"demo", role:"supervisor", ward:"" };
    Store.registerUser({ ...demo, password:"demo" });
    onLogin(Store.loginUser("demo","demo").user);
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">
          <div className="login-icon">⚕️</div>
          <div className="login-title">MedRecord</div>
          <div className="login-sub">Hospital Electronic Medical Records</div>
        </div>
        <div className="tab-switcher">
          <button className={`tab-switch-btn ${tab==="login"?"active":""}`} onClick={()=>{setTab("login");setMsg(null)}}>Sign In</button>
          <button className={`tab-switch-btn ${tab==="register"?"active":""}`} onClick={()=>{setTab("register");setMsg(null)}}>Register</button>
        </div>

        {tab==="login" && (
          <>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input className="form-input" placeholder="Enter username" value={loginData.username} onChange={e=>setLoginData(d=>({...d,username:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&doLogin()} />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" placeholder="Enter password" value={loginData.password} onChange={e=>setLoginData(d=>({...d,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&doLogin()} />
            </div>
            {msg && <div className={msg.type==="error"?"form-error":"form-success"}>{msg.text}</div>}
            <button className="btn btn-primary btn-lg" style={{marginTop:16}} onClick={doLogin} disabled={busy}>
              {busy ? <Spinner /> : "Sign In"}
            </button>

          </>
        )}

        {tab==="register" && (
          <>
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input className="form-input" placeholder="Your full name" value={regData.name} onChange={e=>setRegData(d=>({...d,name:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">Username *</label>
              <input className="form-input" placeholder="Choose a username" value={regData.username} onChange={e=>setRegData(d=>({...d,username:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">Password *</label>
              <input className="form-input" type="password" placeholder="Choose a password" value={regData.password} onChange={e=>setRegData(d=>({...d,password:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">Role *</label>
              <select className="form-select" value={regData.role} onChange={e=>setRegData(d=>({...d,role:e.target.value}))}>
                <option value="">Select role</option>
                {ROLES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {regData.role && regData.role!=="supervisor" && (
              <div className="form-group">
                <label className="form-label">Ward Assignment</label>
                <select className="form-select" value={regData.ward} onChange={e=>setRegData(d=>({...d,ward:e.target.value}))}>
                  <option value="">Select ward</option>
                  {WARDS.map(w=><option key={w}>{w}</option>)}
                </select>
              </div>
            )}
            {msg && <div className={msg.type==="error"?"form-error":"form-success"}>{msg.text}</div>}
            <button className="btn btn-primary btn-lg" style={{marginTop:8}} onClick={doRegister}>Create Account</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function AddPatientModal({ open, onClose, onSave, user }) {
  const blank = { name:"",emr:"",dob:"",gender:"Male",ward:"",physician:"",admission:today(),diagnosis:"",allergies:"" };
  const [d, setD] = useState(blank);
  const set = (k,v) => setD(x=>({...x,[k]:v}));
  const save = () => {
    if (!d.name || !d.emr || !d.ward) { alert("Name, EMR, and Ward are required."); return; }
    const r = Store.createPatient({ ...d, createdBy: user?.name||"—" });
    if (r.ok) { onSave(r.patient); setD(blank); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add New Patient">
      <div className="modal-body">
        <div className="form-row">
          <div className="form-group"><label className="form-label">Full Name *</label><input className="form-input" value={d.name} onChange={e=>set("name",e.target.value)} placeholder="Patient full name" /></div>
          <div className="form-group"><label className="form-label">EMR Number *</label><input className="form-input" value={d.emr} onChange={e=>set("emr",e.target.value)} placeholder="EMR / MRN" /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Date of Birth</label><input className="form-input" type="date" value={d.dob} onChange={e=>set("dob",e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Gender</label><select className="form-select" value={d.gender} onChange={e=>set("gender",e.target.value)}><option>Male</option><option>Female</option><option>Other</option></select></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Ward Assignment *</label><select className="form-select" value={d.ward} onChange={e=>set("ward",e.target.value)}><option value="">Select ward</option>{WARDS.map(w=><option key={w}>{w}</option>)}</select></div>
          <div className="form-group"><label className="form-label">Attending Physician</label><input className="form-input" value={d.physician} onChange={e=>set("physician",e.target.value)} placeholder="Physician name" /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Admission Date</label><input className="form-input" type="date" value={d.admission} onChange={e=>set("admission",e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Primary Diagnosis</label><input className="form-input" value={d.diagnosis} onChange={e=>set("diagnosis",e.target.value)} placeholder="e.g. Hypertension" /></div>
        </div>
        <div className="form-group"><label className="form-label">Known Allergies</label><input className="form-input" value={d.allergies} onChange={e=>set("allergies",e.target.value)} placeholder="e.g. Penicillin, Sulfa drugs" /></div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>✚ Add Patient</button>
      </div>
    </Modal>
  );
}

function VitalsModal({ open, onClose, onSave, nurse }) {
  const blank = { date:today(), time:nowTime(), bp:"", hr:"", temp:"", rr:"", spo2:"", notes:"" };
  const [d, setD] = useState(blank);
  const set = (k,v) => setD(x=>({...x,[k]:v}));
  const save = () => { onSave({...d, nurse:nurse||"—"}); setD(blank); onClose(); };
  return (
    <Modal open={open} onClose={onClose} title="💓 Add Vital Signs">
      <div className="modal-body">
        <div className="form-row">
          <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={d.date} onChange={e=>set("date",e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Time</label><input className="form-input" type="time" value={d.time} onChange={e=>set("time",e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Blood Pressure (mmHg)</label><input className="form-input" value={d.bp} onChange={e=>set("bp",e.target.value)} placeholder="120/80" /></div>
          <div className="form-group"><label className="form-label">Heart Rate (bpm)</label><input className="form-input" type="number" value={d.hr} onChange={e=>set("hr",e.target.value)} placeholder="72" /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Temperature (°C)</label><input className="form-input" type="number" step="0.1" value={d.temp} onChange={e=>set("temp",e.target.value)} placeholder="36.6" /></div>
          <div className="form-group"><label className="form-label">Respiratory Rate (/min)</label><input className="form-input" type="number" value={d.rr} onChange={e=>set("rr",e.target.value)} placeholder="16" /></div>
        </div>
        <div className="form-group"><label className="form-label">SpO₂ (%)</label><input className="form-input" type="number" value={d.spo2} onChange={e=>set("spo2",e.target.value)} placeholder="98" /></div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={d.notes} onChange={e=>set("notes",e.target.value)} placeholder="Additional observations…" /></div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>💾 Save Vital Signs</button>
      </div>
    </Modal>
  );
}

function GlucoseModal({ open, onClose, onSave, nurse }) {
  const blank = { date:today(), fasting:"", postbf:"", prelunch:"", postlunch:"", predinner:"", bedtime:"", notes:"" };
  const [d, setD] = useState(blank);
  const set = (k,v) => setD(x=>({...x,[k]:v}));
  const save = () => { onSave({...d, nurse:nurse||"—"}); setD(blank); onClose(); };
  const field = (label, key) => (
    <div className="form-group"><label className="form-label">{label}</label><input className="form-input" type="number" step="0.1" value={d[key]} onChange={e=>set(key,e.target.value)} placeholder="mmol/L" /></div>
  );
  return (
    <Modal open={open} onClose={onClose} title="🩸 Blood Glucose Reading">
      <div className="modal-body">
        <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={d.date} onChange={e=>set("date",e.target.value)} /></div>
        <p style={{fontSize:11,color:"var(--t2)",marginBottom:12}}>Enter readings in mmol/L. Leave blank if not taken.</p>
        <div className="form-row">{field("Fasting","fasting")}{field("Post-Breakfast","postbf")}</div>
        <div className="form-row">{field("Pre-Lunch","prelunch")}{field("Post-Lunch","postlunch")}</div>
        <div className="form-row">{field("Pre-Dinner","predinner")}{field("Bedtime","bedtime")}</div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={d.notes} onChange={e=>set("notes",e.target.value)} /></div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>💾 Save Reading</button>
      </div>
    </Modal>
  );
}

function FluidModal({ open, onClose, onSave, nurse }) {
  const blank = { date:today(), time:nowTime(), oral:"", iv:"", urine:"", other:"", notes:"" };
  const [d, setD] = useState(blank);
  const set = (k,v) => setD(x=>({...x,[k]:v}));
  const save = () => { onSave({...d, nurse:nurse||"—"}); setD(blank); onClose(); };
  return (
    <Modal open={open} onClose={onClose} title="💧 Fluid Intake & Output">
      <div className="modal-body">
        <div className="form-row">
          <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={d.date} onChange={e=>set("date",e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Time</label><input className="form-input" type="time" value={d.time} onChange={e=>set("time",e.target.value)} /></div>
        </div>
        <p style={{fontSize:11,color:"var(--accent)",marginBottom:10,fontWeight:600}}>Intake (mL)</p>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Oral</label><input className="form-input" type="number" value={d.oral} onChange={e=>set("oral",e.target.value)} placeholder="0" /></div>
          <div className="form-group"><label className="form-label">IV / NG Tube</label><input className="form-input" type="number" value={d.iv} onChange={e=>set("iv",e.target.value)} placeholder="0" /></div>
        </div>
        <p style={{fontSize:11,color:"var(--danger)",marginBottom:10,fontWeight:600}}>Output (mL)</p>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Urine</label><input className="form-input" type="number" value={d.urine} onChange={e=>set("urine",e.target.value)} placeholder="0" /></div>
          <div className="form-group"><label className="form-label">Other (Drain/Vomit)</label><input className="form-input" type="number" value={d.other} onChange={e=>set("other",e.target.value)} placeholder="0" /></div>
        </div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={d.notes} onChange={e=>set("notes",e.target.value)} /></div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>💾 Save Entry</button>
      </div>
    </Modal>
  );
}

function PrescriptionModal({ open, onClose, patient, onSave }) {
  const [rows, setRows] = useState(patient?.prescriptions||[]);
  useEffect(() => { if (open) setRows(patient?.prescriptions||[]); }, [open, patient]);
  const addRow = () => setRows(r=>[...r,{id:uid(),drug:"",dosage:"",route:"PO",freq:"",start:today(),end:"",instructions:""}]);
  const setRow = (i,k,v) => setRows(r=>r.map((x,j)=>j===i?{...x,[k]:v}:x));
  const removeRow = (i) => setRows(r=>r.filter((_,j)=>j!==i));
  const save = () => { onSave(rows); onClose(); };
  return (
    <Modal open={open} onClose={onClose} title="📝 Medication Prescription Plan" size="modal-xl">
      <div className="modal-body">
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <button className="btn btn-secondary" onClick={addRow}>+ Add Medication</button>
        </div>
        {rows.length===0 && <div style={{textAlign:"center",padding:24,color:"var(--t3)"}}>No medications added. Click + Add Medication.</div>}
        {rows.map((r,i)=>(
          <div key={r.id} style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:"var(--r-sm)",padding:12,marginBottom:8}}>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr auto",gap:8,alignItems:"end"}}>
              <div><label className="form-label">Drug Name</label><input className="form-input" value={r.drug} onChange={e=>setRow(i,"drug",e.target.value)} placeholder="Drug name" /></div>
              <div><label className="form-label">Dosage</label><input className="form-input" value={r.dosage} onChange={e=>setRow(i,"dosage",e.target.value)} placeholder="500mg" /></div>
              <div><label className="form-label">Route</label><select className="form-select" value={r.route} onChange={e=>setRow(i,"route",e.target.value)}><option>PO</option><option>IV</option><option>IM</option><option>SC</option><option>SL</option><option>Topical</option><option>Inhaled</option></select></div>
              <div><label className="form-label">Frequency</label><input className="form-input" value={r.freq} onChange={e=>setRow(i,"freq",e.target.value)} placeholder="BD, TID…" /></div>
              <div><label className="form-label">Start Date</label><input className="form-input" type="date" value={r.start} onChange={e=>setRow(i,"start",e.target.value)} /></div>
              <div><label className="form-label">End Date</label><input className="form-input" type="date" value={r.end} onChange={e=>setRow(i,"end",e.target.value)} /></div>
              <div style={{paddingTop:18}}><button className="btn btn-danger btn-sm" onClick={()=>removeRow(i)}>✕</button></div>
            </div>
            <div style={{marginTop:8}}><label className="form-label">Instructions</label><input className="form-input" value={r.instructions} onChange={e=>setRow(i,"instructions",e.target.value)} placeholder="e.g. Take with food" /></div>
          </div>
        ))}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>💾 Save Prescription Plan</button>
      </div>
    </Modal>
  );
}

function MedAdminModal({ open, onClose, patient, nurse, onSave }) {
  const blank = { date:today(), time:nowTime(), drug:"", dosage:"", route:"PO", status:"Given", notes:"" };
  const [d, setD] = useState(blank);
  const set = (k,v) => setD(x=>({...x,[k]:v}));
  const save = () => { onSave({...d, nurse:nurse||"—"}); setD(blank); onClose(); };
  return (
    <Modal open={open} onClose={onClose} title="💊 Medication Administration Record" size="modal-lg">
      <div className="modal-body">
        <div className="form-row">
          <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={d.date} onChange={e=>set("date",e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Time</label><input className="form-input" type="time" value={d.time} onChange={e=>set("time",e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Drug Name</label><input className="form-input" value={d.drug} onChange={e=>set("drug",e.target.value)} placeholder="Drug name" /></div>
          <div className="form-group"><label className="form-label">Dosage Given</label><input className="form-input" value={d.dosage} onChange={e=>set("dosage",e.target.value)} placeholder="500mg" /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Route</label><select className="form-select" value={d.route} onChange={e=>set("route",e.target.value)}><option>PO (Oral)</option><option>IV</option><option>IM</option><option>SC</option><option>Topical</option><option>Inhalation</option></select></div>
          <div className="form-group"><label className="form-label">Administration Status</label><select className="form-select" value={d.status} onChange={e=>set("status",e.target.value)}><option>Given</option><option>Missed</option><option>Refused</option><option>Held</option><option>Withheld</option></select></div>
        </div>
        <div className="form-group"><label className="form-label">Notes / Reason</label><textarea className="form-textarea" value={d.notes} onChange={e=>set("notes",e.target.value)} placeholder="Any notes or reason for hold/miss…" /></div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>💾 Record Administration</button>
      </div>
    </Modal>
  );
}

function NursingReportModal({ open, onClose, patient, nurse, onSave }) {
  const [d, setD] = useState({ date:today(), shift:SHIFTS[0], report:"", nurseOnDuty:nurse||"" });
  const set = (k,v) => setD(x=>({...x,[k]:v}));
  useEffect(()=>{ if (open) setD(x=>({...x,nurseOnDuty:nurse||""})); },[open,nurse]);
  const save = () => {
    if (!d.report.trim()) { alert("Report content is required."); return; }
    onSave(d); setD({ date:today(), shift:SHIFTS[0], report:"", nurseOnDuty:nurse||"" }); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="📝 Add Nursing Report">
      <div className="modal-body">
        <div className="form-row">
          <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={d.date} onChange={e=>set("date",e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Shift</label><select className="form-select" value={d.shift} onChange={e=>set("shift",e.target.value)}>{SHIFTS.map(s=><option key={s}>{s}</option>)}</select></div>
        </div>
        <div className="form-group"><label className="form-label">Nurse on Duty</label><input className="form-input" value={d.nurseOnDuty} onChange={e=>set("nurseOnDuty",e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Report *</label><textarea className="form-textarea" style={{minHeight:120}} value={d.report} onChange={e=>set("report",e.target.value)} placeholder="Enter nursing report for this shift…" /></div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>💾 Save Report</button>
      </div>
    </Modal>
  );
}

function DailyCareModal({ open, onClose, patient, nurse, onSave, onAIGenerate }) {
  const [d, setD] = useState({ date:today(), shift:SHIFTS[0], condition:"", adl:"", diet:"", wounds:"", pain:"", concerns:"" });
  const set = (k,v) => setD(x=>({...x,[k]:v}));
  const [busy, setBusy] = useState(false);
  const genAI = async () => {
    setBusy(true);
    try {
      const result = await AI.call(
        "You are a clinical documentation AI. Generate a professional nursing note suitable for medical records. Plain text. Under 200 words.",
        `Patient: ${patient?.name} | Shift: ${d.shift} | Condition: ${d.condition} | Diet: ${d.diet} | Pain: ${d.pain} | Concerns: ${d.concerns}`
      );
      setD(x=>({...x,condition:result}));
    } catch(e) { alert("AI error: "+e.message); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={onClose} title="🗒️ Daily Care Report" size="modal-lg">
      <div className="modal-body">
        <div className="form-row">
          <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={d.date} onChange={e=>set("date",e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Shift</label><select className="form-select" value={d.shift} onChange={e=>set("shift",e.target.value)}>{SHIFTS.map(s=><option key={s}>{s}</option>)}</select></div>
        </div>
        <div className="form-group">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <label className="form-label" style={{marginBottom:0}}>General Condition</label>
            <button className="btn btn-secondary btn-sm" onClick={genAI} disabled={busy}>{busy?<Spinner/>:"🤖 AI Generate"}</button>
          </div>
          <textarea className="form-textarea" value={d.condition} onChange={e=>set("condition",e.target.value)} placeholder="Patient's general condition this shift…" />
        </div>
        <div className="form-group"><label className="form-label">Activities of Daily Living (ADL)</label><textarea className="form-textarea" value={d.adl} onChange={e=>set("adl",e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Diet & Nutrition</label><textarea className="form-textarea" value={d.diet} onChange={e=>set("diet",e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Wounds & Skin Care</label><textarea className="form-textarea" value={d.wounds} onChange={e=>set("wounds",e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Pain Assessment</label><textarea className="form-textarea" value={d.pain} onChange={e=>set("pain",e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Concerns & Follow-up</label><textarea className="form-textarea" value={d.concerns} onChange={e=>set("concerns",e.target.value)} /></div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={()=>{ onSave(d); onClose(); }}>💾 Save Daily Care Report</button>
      </div>
    </Modal>
  );
}

function StatusModal({ open, onClose, patient, onSave }) {
  const [d, setD] = useState({ action:"transfer", ward:WARDS[0], notes:"", date:today() });
  const set = (k,v) => setD(x=>({...x,[k]:v}));
  const save = () => { onSave(d.action, d.ward, d.notes, d.date); onClose(); };
  return (
    <Modal open={open} onClose={onClose} title="⇄ Transfer / Discharge">
      <div className="modal-body">
        <div className="form-group"><label className="form-label">Action</label>
          <select className="form-select" value={d.action} onChange={e=>set("action",e.target.value)}>
            <option value="transfer">Transfer to Another Ward</option>
            <option value="discharge">Discharge Patient</option>
            <option value="active">Reactivate Patient</option>
          </select>
        </div>
        {d.action==="transfer" && <div className="form-group"><label className="form-label">Transfer to Ward</label><select className="form-select" value={d.ward} onChange={e=>set("ward",e.target.value)}>{WARDS.map(w=><option key={w}>{w}</option>)}</select></div>}
        <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={d.date} onChange={e=>set("date",e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={d.notes} onChange={e=>set("notes",e.target.value)} /></div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Apply</button>
      </div>
    </Modal>
  );
}

function TransfusionModal({ open, onClose, nurse, onSave }) {
  const [d, setD] = useState({ date:today(), bloodType:"", units:"", notes:"" });
  const set = (k,v) => setD(x=>({...x,[k]:v}));
  const save = () => { onSave({...d, nurse:nurse||"—"}); setD({ date:today(), bloodType:"", units:"", notes:"" }); onClose(); };
  return (
    <Modal open={open} onClose={onClose} title="🩸 Blood Transfusion Record">
      <div className="modal-body">
        <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={d.date} onChange={e=>set("date",e.target.value)} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Blood Type</label><input className="form-input" value={d.bloodType} onChange={e=>set("bloodType",e.target.value)} placeholder="A+, O−, etc." /></div>
          <div className="form-group"><label className="form-label">Units</label><input className="form-input" type="number" value={d.units} onChange={e=>set("units",e.target.value)} placeholder="1" /></div>
        </div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={d.notes} onChange={e=>set("notes",e.target.value)} /></div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>💾 Save Record</button>
      </div>
    </Modal>
  );
}

function OverallNurseModal({ open, onClose, users, overallNurse, onAssign, onEnd }) {
  const [sel, setSel] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="👑 Overall Nurse of the Day">
      <div className="modal-body">
        <div className="overall-panel">
          <div className={`overall-dot ${overallNurse?"on":""}`} />
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{overallNurse||"No overall nurse assigned"}</div>
            <div style={{fontSize:11,color:"var(--t2)"}}>{overallNurse?"Currently on duty":"Shift not started"}</div>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Assign Nurse</label>
          <select className="form-select" value={sel} onChange={e=>setSel(e.target.value)}>
            <option value="">— Select nurse —</option>
            {users.map(u=><option key={u.id} value={u.name}>{u.name} ({u.role})</option>)}
          </select>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-primary" style={{flex:1}} onClick={()=>{ if(sel){onAssign(sel);setSel("");} }}>✅ Assign</button>
          <button className="btn btn-danger" style={{flex:1}} onClick={onEnd}>End Shift</button>
        </div>
      </div>
    </Modal>
  );
}

function AIChatModal({ open, onClose }) {
  const [msgs, setMsgs] = useState([
    { role:"assistant", text:"👋 Hello! I'm your AI clinical assistant.\n\nI can help with drug information, vitals interpretation, nursing care plans, patient summaries, and any clinical question.\n\n⚠️ Always verify with clinical protocols. AI assists, not replaces, clinical judgment." }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef();
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[msgs]);

  const send = async (text) => {
    const q = text || input.trim();
    if (!q || busy) return;
    setInput("");
    setMsgs(m=>[...m,{role:"user",text:q}]);
    setBusy(true);
    try {
      const r = await AI.chat(q);
      setMsgs(m=>[...m,{role:"assistant",text:r}]);
    } catch(e) {
      setMsgs(m=>[...m,{role:"assistant",text:"Error: "+e.message+". Check your API key."}]);
    }
    setBusy(false);
  };

  const quickQ = ["What are nursing priorities for diabetes?","Signs of sepsis to watch for?","How to interpret SpO2 readings?","Medication safety checks before administration?"];

  return (
    <Modal open={open} onClose={onClose} title="🤖 Claude AI Clinical Assistant" size="modal-lg">
      <div style={{display:"flex",flexDirection:"column",height:"60vh"}}>
        <div style={{flex:1,overflowY:"auto",padding:"14px 18px",display:"flex",flexDirection:"column",gap:10}}>
          {msgs.map((m,i)=>(
            <div key={i} className={`ai-chat-msg ${m.role}`}>
              <pre style={{whiteSpace:"pre-wrap",fontFamily:"var(--font)",fontSize:13,lineHeight:1.6,margin:0}}>{m.text}</pre>
            </div>
          ))}
          {busy && <div className="ai-chat-msg assistant"><Spinner /> &nbsp;Thinking…</div>}
          <div ref={bottomRef} />
        </div>
        <div style={{padding:"10px 16px",borderTop:"1px solid var(--border2)"}}>
          <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
            {quickQ.map((q,i)=><button key={i} className="ai-btn btn-sm" onClick={()=>send(q)}>{q}</button>)}
          </div>
          <div style={{display:"flex",gap:8}}>
            <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Ask any clinical question…" style={{flex:1,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:"var(--r-sm)",padding:"9px 12px",color:"var(--t1)",fontSize:13,fontFamily:"var(--font)",resize:"none",outline:"none",minHeight:40,maxHeight:100}} />
            <button onClick={()=>send()} disabled={busy} style={{width:40,height:40,borderRadius:"var(--r-sm)",background:"linear-gradient(135deg,var(--accent),var(--accent2))",border:"none",color:"#000",fontSize:18,cursor:"pointer",flexShrink:0,alignSelf:"flex-end"}}>➤</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function AIResultModal({ open, onClose, title, content, loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="modal-lg">
      <div className="modal-body">
        {loading ? (
          <div style={{display:"flex",alignItems:"center",gap:10,color:"var(--accent)",padding:"20px 0"}}>
            <Spinner /> Analyzing with AI…
          </div>
        ) : (
          <pre style={{whiteSpace:"pre-wrap",fontFamily:"var(--font)",fontSize:13,lineHeight:1.7,color:"var(--t1)"}}>{content}</pre>
        )}
      </div>
      <div className="modal-footer">
        {!loading && <button className="btn btn-secondary" onClick={()=>navigator.clipboard?.writeText(content)}>📋 Copy</button>}
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

// ─── PATIENT TABS ─────────────────────────────────────────────────────────────
function VisitTab({ patient }) {
  const v = patient.vitals?.[0] || {};
  return (
    <div>
      <div className="info-card">
        <h4>Patient Information</h4>
        <div style={{display:"flex",gap:20,marginBottom:16,paddingBottom:16,borderBottom:"1px solid var(--border2)"}}>
          <div style={{width:58,height:58,borderRadius:"50%",background:"linear-gradient(135deg,var(--accent),var(--purple))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0,border:"3px solid var(--accent)"}}>👤</div>
          <div>
            <div style={{fontFamily:"var(--display)",fontSize:18,fontWeight:700}}>{patient.name}</div>
            <div style={{fontSize:12,color:"var(--accent)",marginTop:2}}>EMR: {patient.emr||"—"}</div>
            <div style={{fontSize:12,color:"var(--t2)",marginTop:2}}>Ward: {patient.ward||"—"}</div>
            <div style={{marginTop:6}}><span className={`badge badge-${patient.status||"active"}`}>{patient.status||"Active"}</span></div>
          </div>
        </div>
        <div className="profile-grid">
          <div className="profile-item"><label>Date of Birth</label><span>{patient.dob||"—"}</span></div>
          <div className="profile-item"><label>Gender</label><span>{patient.gender||"—"}</span></div>
          <div className="profile-item"><label>Attending Physician</label><span>{patient.physician||"—"}</span></div>
          <div className="profile-item"><label>Admission Date</label><span>{patient.admission||"—"}</span></div>
          <div className="profile-item" style={{gridColumn:"1/-1"}}><label>Primary Diagnosis</label><span>{patient.diagnosis||"—"}</span></div>
          <div className="profile-item" style={{gridColumn:"1/-1"}}><label>Known Allergies</label><span style={{color:patient.allergies?"var(--danger)":"var(--t2)"}}>{patient.allergies||"No known allergies"}</span></div>
        </div>
        {patient.vitals?.length>0 && (
          <>
            <div style={{fontSize:11,color:"var(--t3)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginTop:14,marginBottom:8}}>Latest Vitals</div>
            <div className="vitals-row">
              {[["BP",v.bp,"mmHg"],["HR",v.hr,"bpm"],["Temp",v.temp,"°C"],["RR",v.rr,"/min"],["SpO₂",v.spo2,"%"]].map(([l,val,u])=>(
                <div className="vital-chip" key={l}><label>{l}</label><span>{val||"—"}{val?<small style={{fontSize:9,color:"var(--t3)"}}>{u}</small>:""}</span></div>
              ))}
            </div>
          </>
        )}
      </div>
      {patient.statusHistory?.length>0 && (
        <div className="info-card">
          <h4>Status History</h4>
          <div className="table-wrap">
            <table><thead><tr><th>Date</th><th>Action</th><th>Ward</th><th>Notes</th></tr></thead>
            <tbody>{patient.statusHistory.map(h=><tr key={h.id}><td>{h.date}</td><td style={{textTransform:"capitalize"}}>{h.action}</td><td>{h.toWard||"—"}</td><td>{h.notes||"—"}</td></tr>)}</tbody></table>
          </div>
        </div>
      )}
    </div>
  );
}

function VitalsTab({ patient }) {
  const rows = patient.vitals||[];
  return (
    <div className="info-card">
      <h4>Vital Signs Log ({rows.length} records)</h4>
      {rows.length===0 ? <div className="empty-state" style={{padding:24}}><div className="empty-icon">💓</div><div className="empty-text">No vitals recorded</div></div> : (
        <div className="table-wrap">
          <table><thead><tr><th>Date</th><th>Time</th><th>BP (mmHg)</th><th>HR (bpm)</th><th>Temp (°C)</th><th>RR (/min)</th><th>SpO₂ (%)</th><th>Nurse</th><th>Notes</th></tr></thead>
          <tbody>{rows.map(r=><tr key={r.id}><td>{r.date}</td><td>{r.time}</td><td style={{fontFamily:"var(--mono)"}}>{r.bp||"—"}</td><td style={{fontFamily:"var(--mono)"}}>{r.hr||"—"}</td><td style={{fontFamily:"var(--mono)"}}>{r.temp||"—"}</td><td style={{fontFamily:"var(--mono)"}}>{r.rr||"—"}</td><td style={{fontFamily:"var(--mono)"}}>{r.spo2||"—"}</td><td>{r.nurse}</td><td>{r.notes||"—"}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

function PrescriptionTab({ patient }) {
  const rows = patient.prescriptions||[];
  return (
    <div className="info-card">
      <h4>Medication Prescription Plan ({rows.length} medications)</h4>
      {rows.length===0 ? <div className="empty-state" style={{padding:24}}><div className="empty-icon">📝</div><div className="empty-text">No prescriptions recorded</div></div> : (
        <div className="table-wrap">
          <table><thead><tr><th>Drug</th><th>Dosage</th><th>Route</th><th>Frequency</th><th>Start</th><th>End</th><th>Instructions</th></tr></thead>
          <tbody>{rows.map((r,i)=><tr key={i}><td style={{fontWeight:600}}>{r.drug}</td><td>{r.dosage}</td><td>{r.route}</td><td>{r.freq}</td><td>{r.start}</td><td>{r.end||"Ongoing"}</td><td>{r.instructions||"—"}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

function MedAdminTab({ patient }) {
  const rows = patient.medAdminLogs||[];
  return (
    <div className="info-card">
      <h4>Medication Administration Records ({rows.length} entries)</h4>
      {rows.length===0 ? <div className="empty-state" style={{padding:24}}><div className="empty-icon">💊</div><div className="empty-text">No administration records</div></div> : (
        <div className="table-wrap">
          <table><thead><tr><th>Date</th><th>Time</th><th>Drug</th><th>Dosage</th><th>Route</th><th>Status</th><th>Nurse</th><th>Notes</th></tr></thead>
          <tbody>{rows.map(r=><tr key={r.id}><td>{r.date}</td><td>{r.time}</td><td style={{fontWeight:600}}>{r.drug}</td><td>{r.dosage}</td><td>{r.route}</td><td><span className={`badge badge-${(r.status||"given").toLowerCase()}`}>{r.status}</span></td><td>{r.nurse}</td><td>{r.notes||"—"}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

function GlycemicTab({ patient }) {
  const rows = patient.glucoseReadings||[];
  const fields = ["fasting","postbf","prelunch","postlunch","predinner","bedtime"];
  const labels = ["Fasting","Post-BF","Pre-Lunch","Post-Lunch","Pre-Dinner","Bedtime"];
  return (
    <div className="info-card">
      <h4>Blood Glucose Log ({rows.length} records)</h4>
      {rows.length===0 ? <div className="empty-state" style={{padding:24}}><div className="empty-icon">🩸</div><div className="empty-text">No glucose readings recorded</div></div> : (
        <div className="table-wrap">
          <table><thead><tr><th>Date</th>{labels.map(l=><th key={l}>{l}</th>)}<th>Nurse</th><th>Notes</th></tr></thead>
          <tbody>{rows.map(r=><tr key={r.id}><td>{r.date}</td>{fields.map(f=><td key={f} style={{fontFamily:"var(--mono)"}}>{r[f]||"—"}</td>)}<td>{r.nurse}</td><td>{r.notes||"—"}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

function FluidTab({ patient }) {
  const rows = patient.fluidEntries||[];
  let totalIn=0, totalOut=0;
  rows.forEach(r=>{ totalIn+=(+r.oral||0)+(+r.iv||0); totalOut+=(+r.urine||0)+(+r.other||0); });
  const bal = totalIn-totalOut;
  return (
    <div>
      <div className="fluid-balance">
        <div className="fluid-stat"><label>Total Intake</label><span style={{color:"var(--success)"}}>{totalIn} mL</span></div>
        <div className="fluid-stat"><label>Total Output</label><span style={{color:"var(--danger)"}}>{totalOut} mL</span></div>
        <div className="fluid-stat"><label>Net Balance</label><span style={{color:bal>=0?"var(--success)":"var(--danger)"}}>{bal>=0?"+":""}{bal} mL</span></div>
      </div>
      <div className="info-card">
        <h4>Fluid I/O Log ({rows.length} entries)</h4>
        {rows.length===0 ? <div className="empty-state" style={{padding:24}}><div className="empty-icon">💧</div><div className="empty-text">No fluid entries recorded</div></div> : (
          <div className="table-wrap">
            <table><thead><tr><th>Date</th><th>Time</th><th>Oral (mL)</th><th>IV (mL)</th><th>Urine (mL)</th><th>Other (mL)</th><th>Nurse</th><th>Notes</th></tr></thead>
            <tbody>{rows.map(r=><tr key={r.id}><td>{r.date}</td><td>{r.time}</td><td>{r.oral||0}</td><td>{r.iv||0}</td><td>{r.urine||0}</td><td>{r.other||0}</td><td>{r.nurse}</td><td>{r.notes||"—"}</td></tr>)}</tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}

function NursingTab({ patient }) {
  const rows = patient.nursingReports||[];
  return (
    <div className="info-card">
      <h4>Nursing Reports ({rows.length} entries)</h4>
      {rows.length===0 ? <div className="empty-state" style={{padding:24}}><div className="empty-icon">📋</div><div className="empty-text">No nursing reports recorded</div></div> : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {rows.map(r=>(
            <div key={r.id} style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:"var(--r-sm)",padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{fontFamily:"var(--mono)",fontSize:12,color:"var(--accent)"}}>{r.date}</span>
                  <span style={{fontSize:11,background:"var(--accent3)",color:"var(--accent)",padding:"2px 8px",borderRadius:20}}>{r.shift}</span>
                </div>
                <span style={{fontSize:12,color:"var(--t2)"}}>👤 {r.nurseOnDuty||r.nurse||"—"}</span>
              </div>
              <p style={{fontSize:13,lineHeight:1.6,color:"var(--t1)"}}>{r.report}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TransfusionTab({ patient }) {
  const rows = patient.transfusions||[];
  return (
    <div className="info-card">
      <h4>Blood Transfusion Records ({rows.length} entries)</h4>
      {rows.length===0 ? <div className="empty-state" style={{padding:24}}><div className="empty-icon">🩸</div><div className="empty-text">No transfusion records</div></div> : (
        <div className="table-wrap">
          <table><thead><tr><th>Date</th><th>Blood Type</th><th>Units</th><th>Nurse</th><th>Notes</th></tr></thead>
          <tbody>{rows.map(r=><tr key={r.id}><td>{r.date}</td><td style={{fontFamily:"var(--mono)",fontWeight:600}}>{r.bloodType}</td><td>{r.units}</td><td>{r.nurse}</td><td>{r.notes||"—"}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PATIENT DETAIL ──────────────────────────────────────────────────────
function PatientDetail({ patient, user, onUpdate, toast }) {
  const [activeTab, setActiveTab] = useState("visit");
  const [modals, setModals] = useState({});
  const [aiResult, setAiResult] = useState({ open:false, title:"", content:"", loading:false });
  const openM = (m) => setModals(x=>({...x,[m]:true}));
  const closeM = (m) => setModals(x=>({...x,[m]:false}));

  const refresh = (r) => onUpdate(r.patient);

  const runAI = async (title, fn) => {
    setAiResult({ open:true, title, content:"", loading:true });
    try { const r = await fn(); setAiResult({ open:true, title, content:r, loading:false }); }
    catch(e) { setAiResult({ open:true, title:"Error", content:e.message, loading:false }); }
  };

  const tabs = [
    ["visit","📋 Visit Info"],["vitals","💓 Vitals"],["prescription","📝 Prescription"],
    ["medadmin","💊 Med Admin"],["glycemic","🩸 Glycemic"],["fluid","💧 Fluid I/O"],
    ["nursing","📝 Nursing"],["transfusion","🩸 Transfusion"],
  ];

  const latestV = patient.vitals?.[0] || {};

  return (
    <div className="pt-detail">
      {/* Header */}
      <div className="pt-header">
        <div className="pt-header-info">
          <h2>{patient.name}</h2>
          <div className="pt-header-meta">
            <span>EMR: {patient.emr||"—"}</span>
            <span>•</span><span>{patient.ward||"—"}</span>
            <span>•</span><span className={`badge badge-${patient.status||"active"}`}>{patient.status||"Active"}</span>
            {patient.diagnosis && <><span>•</span><span>{patient.diagnosis}</span></>}
          </div>
          <div style={{fontSize:11,color:"var(--t3)",marginTop:4}}>
            Physician: {patient.physician||"—"} &nbsp;|&nbsp; Admitted: {patient.admission||"—"}
            {patient.allergies && <span style={{color:"var(--danger)"}}> &nbsp;|&nbsp; ⚠️ {patient.allergies}</span>}
          </div>
        </div>
        <div className="pt-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={()=>openM("status")}>⇄ Transfer / Discharge</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>window.print()}>🖨️ Print</button>
        </div>
      </div>

      {/* AI Bar */}
      <div className="ai-bar">
        <span className="ai-bar-label">🤖 AI</span>
        <button className="ai-btn" onClick={()=>runAI("📋 Patient Summary", ()=>AI.summarize(patient))}>Summarize</button>
        <button className="ai-btn" onClick={()=>runAI("🧠 Care Suggestions", ()=>AI.careSuggestions(patient))}>Care Plan</button>
        <button className="ai-btn" onClick={()=>{ if(!patient.prescriptions?.length){toast("Add medications first.","error");return;} runAI("⚠️ Drug Interactions", ()=>AI.checkInteractions(patient.prescriptions)); }}>Drug Interactions</button>
        <button className="ai-btn" onClick={()=>{ if(!patient.vitals?.length){toast("Record vitals first.","error");return;} runAI("🔍 Vitals Analysis", ()=>AI.analyzeVitals(latestV,patient.name,patient.diagnosis)); }}>Analyze Vitals</button>
      </div>

      {/* Stats */}
      <div className="stats-row">
        {[["🩸","Blood Pressure",latestV.bp||"—","mmHg"],["💓","Heart Rate",latestV.hr||"—","bpm"],["🌡️","Temperature",latestV.temp||"—","°C"],["💨","SpO₂",latestV.spo2||"—","%"],["📋","Prescriptions",(patient.prescriptions||[]).length,"active"]].map(([icon,label,val,unit])=>(
          <div className="stat-card" key={label}>
            <div className="stat-icon">{icon}</div>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{val}</div>
            <div className="stat-unit">{unit}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        {[
          ["💓","Add Vitals",()=>openM("vitals")],
          ["💊","Med Administration",()=>openM("medAdmin")],
          ["📝","Prescription Plan",()=>openM("prescription")],
          ["🩸","Blood Glucose",()=>openM("glucose")],
          ["💧","Fluid I/O",()=>openM("fluid")],
          ["📋","Nursing Report",()=>openM("nursing")],
          ["🗒️","Daily Care",()=>openM("dailyCare")],
          ["🩸","Transfusion",()=>openM("transfusion")],
        ].map(([icon,label,fn])=>(
          <button key={label} className="quick-btn" onClick={fn}><span className="quick-btn-icon">{icon}</span>{label}</button>
        ))}
      </div>

      {/* Tabs */}
      <div className="tabs-bar">
        {tabs.map(([k,l])=><button key={k} className={`tab-btn ${activeTab===k?"active":""}`} onClick={()=>setActiveTab(k)}>{l}</button>)}
      </div>

      {/* Tab Content */}
      {activeTab==="visit" && <VisitTab patient={patient} />}
      {activeTab==="vitals" && <VitalsTab patient={patient} />}
      {activeTab==="prescription" && <PrescriptionTab patient={patient} />}
      {activeTab==="medadmin" && <MedAdminTab patient={patient} />}
      {activeTab==="glycemic" && <GlycemicTab patient={patient} />}
      {activeTab==="fluid" && <FluidTab patient={patient} />}
      {activeTab==="nursing" && <NursingTab patient={patient} />}
      {activeTab==="transfusion" && <TransfusionTab patient={patient} />}

      {/* Modals */}
      <VitalsModal open={!!modals.vitals} onClose={()=>closeM("vitals")} nurse={user?.name} onSave={v=>{ const r=Store.addVitals(patient.id,v); if(r.ok){refresh(r);toast("Vital signs saved.");} }} />
      <GlucoseModal open={!!modals.glucose} onClose={()=>closeM("glucose")} nurse={user?.name} onSave={g=>{ const r=Store.addGlucose(patient.id,g); if(r.ok){refresh(r);toast("Glucose reading saved.");} }} />
      <FluidModal open={!!modals.fluid} onClose={()=>closeM("fluid")} nurse={user?.name} onSave={f=>{ const r=Store.addFluid(patient.id,f); if(r.ok){refresh(r);toast("Fluid entry saved.");} }} />
      <MedAdminModal open={!!modals.medAdmin} onClose={()=>closeM("medAdmin")} patient={patient} nurse={user?.name} onSave={e=>{ const r=Store.addMedAdmin(patient.id,e); if(r.ok){refresh(r);toast("Administration recorded.");} }} />
      <PrescriptionModal open={!!modals.prescription} onClose={()=>closeM("prescription")} patient={patient} onSave={list=>{ const r=Store.savePrescriptions(patient.id,list); if(r.ok){refresh(r);toast("Prescriptions saved.");} }} />
      <NursingReportModal open={!!modals.nursing} onClose={()=>closeM("nursing")} patient={patient} nurse={user?.name} onSave={rp=>{ const r=Store.addNursingReport(patient.id,rp); if(r.ok){refresh(r);toast("Nursing report saved.");} }} />
      <DailyCareModal open={!!modals.dailyCare} onClose={()=>closeM("dailyCare")} patient={patient} nurse={user?.name} onSave={()=>toast("Daily care report saved.")} />
      <TransfusionModal open={!!modals.transfusion} onClose={()=>closeM("transfusion")} nurse={user?.name} onSave={t=>{ const r=Store.addTransfusion(patient.id,t); if(r.ok){refresh(r);toast("Transfusion record saved.");} }} />
      <StatusModal open={!!modals.status} onClose={()=>closeM("status")} patient={patient} onSave={(action,ward,notes,date)=>{ const r=Store.applyStatus(patient.id,action,ward,notes,date); if(r.ok){refresh(r);toast("Status updated.");} }} />
      <AIResultModal open={aiResult.open} onClose={()=>setAiResult(x=>({...x,open:false}))} title={aiResult.title} content={aiResult.content} loading={aiResult.loading} />
    </div>
  );
}

// ─── REPORTS SECTION ──────────────────────────────────────────────────────────
function ReportsSection({ patients }) {
  const allReports = patients.flatMap(p=>(p.nursingReports||[]).map(r=>({...r,patientName:p.name,ward:p.ward})));
  allReports.sort((a,b)=>b.date.localeCompare(a.date));
  const exportCSV = () => {
    const rows = [["Patient","EMR","Ward","Status","Diagnosis","Admission"],...patients.map(p=>[p.name,p.emr||"",p.ward||"",p.status||"active",p.diagnosis||"",p.admission||""])];
    const csv = rows.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv); a.download="medrecord.csv"; a.click();
  };
  return (
    <div style={{flex:1,overflowY:"auto",padding:22}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div><div style={{fontFamily:"var(--display)",fontSize:18,fontWeight:700}}>Nursing Reports Dashboard</div>
        <div style={{fontSize:12,color:"var(--t2)",marginTop:2}}>{allReports.length} total reports across {patients.length} patients</div></div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-secondary btn-sm" onClick={exportCSV}>📊 Export CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>window.print()}>🖨️ Print</button>
        </div>
      </div>
      <div className="report-grid">
        {patients.map(p=>(
          <div key={p.id} className="card" style={{padding:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div><div style={{fontWeight:700,fontSize:14}}>{p.name}</div><div style={{fontSize:11,color:"var(--t2)"}}>{p.ward||"—"} &nbsp;•&nbsp; EMR {p.emr||"—"}</div></div>
              <span className={`badge badge-${p.status||"active"}`}>{p.status||"active"}</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
              {[["Vitals",p.vitals?.length||0],["Medications",p.prescriptions?.length||0],["Nursing Reports",p.nursingReports?.length||0],["Fluid Entries",p.fluidEntries?.length||0]].map(([l,n])=>(
                <div key={l} style={{background:"var(--bg3)",borderRadius:"var(--r-sm)",padding:"8px 10px",textAlign:"center"}}>
                  <div style={{fontFamily:"var(--mono)",fontSize:18,fontWeight:500}}>{n}</div>
                  <div style={{fontSize:10,color:"var(--t3)"}}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {allReports.length>0 && (
        <div style={{marginTop:20}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>All Nursing Reports</div>
          <div className="table-wrap">
            <table><thead><tr><th>Date</th><th>Patient</th><th>Ward</th><th>Shift</th><th>Report</th><th>Nurse</th></tr></thead>
            <tbody>{allReports.map(r=><tr key={r.id}><td style={{fontFamily:"var(--mono)",whiteSpace:"nowrap"}}>{r.date}</td><td style={{fontWeight:600}}>{r.patientName}</td><td>{r.ward}</td><td>{r.shift}</td><td style={{maxWidth:320}}>{r.report}</td><td>{r.nurseOnDuty||r.nurse||"—"}</td></tr>)}</tbody></table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function MainApp({ user, onLogout }) {
  const [patients, setPatients] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("active");
  const [section, setSection] = useState("patients");
  const [overallNurse, setOverallNurse] = useState(null);
  const [modals, setModals] = useState({});
  const [toastState, showToast] = useToast();
  const openM = (m) => setModals(x=>({...x,[m]:true}));
  const closeM = (m) => setModals(x=>({...x,[m]:false}));

  const filtered = patients.filter(p => {
    if (filter==="active") return (p.status||"active")==="active";
    if (filter==="discharged") return p.status==="discharged";
    return true;
  });

  const selected = patients.find(p=>p.id===selectedId)||null;

  const handleAddPatient = (p) => {
    setPatients(ps=>[...ps, p]);
    setSelectedId(p.id);
    showToast("Patient added.");
  };

  const handleUpdatePatient = (updated) => {
    setPatients(ps=>ps.map(p=>p.id===updated.id?updated:p));
  };

  const roleLabel = user.role==="wardmaster"?"Ward Master":user.role==="supervisor"?"Supervisor":"Ward Nurse";

  return (
    <div className="app">
      <style>{css}</style>
      <Toast msg={toastState.msg} type={toastState.type} />

      {/* Sidebar */}
      <nav className="sidebar">
        <div className="sb-logo">
          <div className="sb-logo-mark">
            <div className="sb-icon">⚕️</div>
            <div><div className="sb-name">MedRecord</div><div className="sb-sub">EMR System</div></div>
          </div>
        </div>
        <div className="sb-user">
          <div className="sb-avatar">{user.name.charAt(0).toUpperCase()}</div>
          <div><div className="sb-uname">{user.name}</div><div className="sb-urole">{roleLabel}</div></div>
        </div>
        <div className="sb-nav">
          <div className="nav-section">Clinical</div>
          <button className={`nav-btn ${section==="patients"?"active":""}`} onClick={()=>setSection("patients")}><span className="ni">🏥</span>Patients</button>
          <button className={`nav-btn ${section==="reports"?"active":""}`} onClick={()=>setSection("reports")}><span className="ni">📊</span>Reports</button>
          <button className="nav-btn" onClick={()=>openM("overallNurse")}><span className="ni">👑</span>Overall Nurse</button>
          <div className="nav-section">AI Tools</div>
          <button className="nav-btn" onClick={()=>openM("aiChat")} style={{color:"var(--purple)"}}><span className="ni">🤖</span>Ask Claude AI</button>
          <div className="nav-section">Account</div>
          <button className="nav-btn btn-danger" onClick={onLogout}><span className="ni">🚪</span>Logout</button>
        </div>
        {overallNurse && (
          <div className="sb-footer">
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"var(--success)"}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:"var(--success)",boxShadow:"0 0 6px var(--success)"}} />
              <span style={{fontWeight:600}}>{overallNurse}</span>
              <span style={{color:"var(--t3)"}}>on duty</span>
            </div>
          </div>
        )}
      </nav>

      {/* Main */}
      <div className="main">
        <div className="topbar">
          <div>
            <div className="tb-title">{section==="patients"?"Patient Records":"Reports Dashboard"}</div>
            <div className="tb-sub">{section==="patients"? `${filtered.length} ${filter} patient${filtered.length!==1?"s":""}` : `${patients.length} total patients`}</div>
          </div>
          <div className="tb-right">
            <span className="badge-live"><span className="badge-dot" />Live</span>
            <button className="btn btn-secondary btn-sm" onClick={()=>openM("overallNurse")}>👑 Overall Nurse</button>
          </div>
        </div>

        <div className="content">
          {section==="patients" && (
            <>
              {/* Patient List */}
              <div className="pt-panel">
                <div className="pt-panel-header">
                  <div className="pt-panel-title">Patients</div>
                  <div className="filter-tabs">
                    {[["active","Active"],["all","All"],["discharged","Discharged"]].map(([f,l])=>(
                      <button key={f} className={`filter-tab ${filter===f?"active":""}`} onClick={()=>setFilter(f)}>{l}</button>
                    ))}
                  </div>
                  <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={()=>openM("addPatient")}>+ Add New Patient</button>
                </div>
                <div className="pt-list">
                  {filtered.length===0 ? (
                    <div style={{textAlign:"center",padding:"32px 12px",color:"var(--t3)",fontSize:12}}>
                      <div style={{fontSize:28,marginBottom:8,opacity:0.3}}>📋</div>
                      {filter==="active"?"No active patients.":"No patients found."}
                    </div>
                  ) : filtered.map(p=>(
                    <div key={p.id} className={`pt-card ${selectedId===p.id?"active":""}`} onClick={()=>setSelectedId(p.id)}>
                      <div className="pt-name">{p.name}</div>
                      <div className="pt-meta">
                        <span>{p.ward||"—"}</span>
                        <span className={`badge badge-${p.status||"active"}`}>{p.status||"Active"}</span>
                      </div>
                      <div style={{fontSize:10,color:"var(--t3)",marginTop:3}}>EMR: {p.emr||"—"} &nbsp;•&nbsp; {p.diagnosis||"No diagnosis"}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Patient Detail */}
              {selected ? (
                <PatientDetail key={selected.id} patient={selected} user={user} onUpdate={handleUpdatePatient} toast={showToast} />
              ) : (
                <div className="pt-detail">
                  <div className="empty-state">
                    <div className="empty-icon">📋</div>
                    <div className="empty-text">No Patient Selected</div>
                    <div className="empty-sub">Select a patient from the list or add a new one to begin recording clinical data.</div>
                  </div>
                </div>
              )}
            </>
          )}
          {section==="reports" && <ReportsSection patients={patients} />}
        </div>
      </div>

      {/* Global Modals */}
      <AddPatientModal open={!!modals.addPatient} onClose={()=>closeM("addPatient")} onSave={handleAddPatient} user={user} />
      <OverallNurseModal
        open={!!modals.overallNurse} onClose={()=>closeM("overallNurse")}
        users={Store.getUsers()} overallNurse={overallNurse}
        onAssign={n=>{ Store.setOverallNurse(n); setOverallNurse(n); showToast(n+" assigned as Overall Nurse."); closeM("overallNurse"); }}
        onEnd={()=>{ Store.setOverallNurse(null); setOverallNurse(null); showToast("Shift ended."); closeM("overallNurse"); }}
      />
      <AIChatModal open={!!modals.aiChat} onClose={()=>closeM("aiChat")} />
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);

  if (!user) {
    return (
      <>
        <style>{css}</style>
        <LoginPage onLogin={setUser} />
      </>
    );
  }

  return <MainApp user={user} onLogout={()=>{ Store.logout(); setUser(null); }} />;
}
