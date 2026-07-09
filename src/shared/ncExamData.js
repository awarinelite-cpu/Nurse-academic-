export const NURSING_EXAM_META = {
  general:     { key:"general",     label:"General Nursing Council Exam",  short:"General Nursing",      icon:"🏥", color:"#0077b6", desc:"Covers nursing fundamentals, anatomy, pharmacology, medical-surgical nursing and professional ethics." },
  midwifery:   { key:"midwifery",   label:"Midwifery Council Exam",        short:"Midwifery",            icon:"🤰", color:"#c2185b", desc:"Covers antenatal care, labour & delivery, postnatal care, neonatal assessment and obstetric emergencies." },
  publichealth:{ key:"publichealth",label:"Public Health Nursing Exam",    short:"Public Health Nursing", icon:"🌍", color:"#2e7d32", desc:"Covers epidemiology, disease surveillance, health promotion, immunisation and community nursing." },
};

// ─── NC DATA HELPERS ──────────────────────────────────────────────────
// data shape: data[specialty][year] = { paper1, paper2, osce }
// paper1/paper2: { questions:[{q,options,ans}], published, publishedAt }
// osce: { checklists:[{id,heading,steps:[]}], published, publishedAt }

export const NC_YEARS = ["2020","2021","2022","2023","2024","2025"];

export const NC_PAPER_TYPES = [
  { key:"paper1", label:"Paper 1", icon:"📄" },
  { key:"paper2", label:"Paper 2", icon:"📋" },
  { key:"osce",   label:"OSCE",    icon:"🩺" },
];

export const emptyPaper  = () => ({ questions:[], published:false, publishedAt:null });

export const emptyOsce   = () => ({ checklists:[], published:false, publishedAt:null });

export const emptyYear   = () => ({ paper1:emptyPaper(), paper2:emptyPaper(), osce:emptyOsce() });

export const getYearData = (data, spec, year) => {
  const d = (data[spec]||{})[year];
  if (!d) return emptyYear();
  return {
    paper1: d.paper1||emptyPaper(),
    paper2: d.paper2||emptyPaper(),
    osce:   d.osce||emptyOsce(),
  };
};

export const setYearPaperData = (data, spec, year, paperKey, val) => {
  const specData = data[spec]||{};
  const yearData = getYearData(data, spec, year);
  return { ...data, [spec]: { ...specData, [year]: { ...yearData, [paperKey]: val } } };
};

// Check if a paper has been archived (published > 24h ago)

export const isPaperArchived = (paper) => {
  if (!paper || !paper.publishedAt) return false;
  return (Date.now() - paper.publishedAt) > 24 * 60 * 60 * 1000;
};

// ═══════════════════════════════════════════════════════════════════════
// NC ACCESS / MONETISATION SYSTEM
// ═══════════════════════════════════════════════════════════════════════

export const NC_FREE_LIMIT = 10;      // free questions per specialty paper

export const NC_MOCK_FREE_LIMIT = 15; // free questions for the daily mock exam

// ── Helper: check if the current user has full NC access ─────────────
// ══════════════════════════════════════════════════════════════════════
// ── MAXIMUM-STRENGTH DEVICE IDENTITY SYSTEM ──────────────────────────
// Browsers cannot read IMEI (blocked by all mobile OS / W3C).
// Instead we capture 10 hardware-level signals + server-side Firebase
// registration to create a device lock that is effectively unique:
//
//  1. Canvas GPU rendering hash  — GPU chip-specific sub-pixel math
//  2. WebGL renderer string      — exact GPU model ("Adreno 640" etc.)
//  3. AudioContext DSP hash      — audio chip floating-point signature
//  4. Installed font set         — differs per device/OS
//  5. Screen resolution+DPR      — hardware screen spec
//  6. CPU cores + RAM + touch    — hardware concurrency & memory
//  7. Battery state              — charge level (Android Chrome)
//  8. Timezone + locale          — regional hardware config
//  9. Platform + UserAgent       — browser/OS string
// 10. IndexedDB persistent UUID  — random ID written to browser DB,
//     survives refreshes, can't be read from another device
//  + Public IP captured at activation (stored in Firebase for audit)
//  + Firebase device registration (server-side — can't be cleared
//    by wiping localStorage or using incognito)
// ══════════════════════════════════════════════════════════════════════
