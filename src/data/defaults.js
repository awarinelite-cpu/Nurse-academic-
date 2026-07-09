import { ls, lsSet } from "../utils/storage";

// ─── DEFAULT DATA ───────────────────────────────────────────────────
export const DEFAULT_CLASSES = [
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
export const DEFAULT_DRUGS = [
  { id:1, name:"Paracetamol",    class:"Analgesic/Antipyretic",     dose:"500-1000mg every 4-6h",   max:"4g/day",       uses:"Pain, fever",                         contraindications:"Liver disease",                   side_effects:"Rare at therapeutic doses; overdose causes hepatotoxicity" },
  { id:2, name:"Amoxicillin",    class:"Penicillin Antibiotic",     dose:"250-500mg every 8h",      max:"3g/day",       uses:"Bacterial infections",                contraindications:"Penicillin allergy",              side_effects:"Rash, diarrhea, nausea" },
  { id:3, name:"Metronidazole",  class:"Antiprotozoal/Antibiotic",  dose:"400-500mg every 8h",      max:"4g/day",       uses:"Anaerobic infections, H.pylori",       contraindications:"1st trimester pregnancy",         side_effects:"Metallic taste, nausea, disulfiram-like reaction with alcohol" },
  { id:4, name:"Ibuprofen",      class:"NSAID",                     dose:"400-600mg every 6-8h",    max:"2400mg/day",   uses:"Pain, inflammation, fever",            contraindications:"Peptic ulcer, renal impairment",  side_effects:"GI irritation, renal impairment, CVS risk" },
  { id:5, name:"Omeprazole",     class:"Proton Pump Inhibitor",     dose:"20-40mg once daily",      max:"80mg/day",     uses:"GERD, peptic ulcer",                  contraindications:"Hypersensitivity",                side_effects:"Headache, diarrhea, hypomagnesemia" },
];
export const DEFAULT_LABS = [
  { id:1, test:"Hemoglobin (Hb)",        normal:"Male: 13–18 g/dL\nFemale: 12–16 g/dL",  low:"Anemia, blood loss, malnutrition",            high:"Dehydration, polycythemia" },
  { id:2, test:"White Blood Cells (WBC)", normal:"4,000–11,000 /μL",                        low:"Bone marrow failure, viral infection",         high:"Infection, inflammation, leukemia" },
  { id:3, test:"Red Blood Cells (RBC)",   normal:"Male: 4.5–6.0 ×10⁶/μL\nFemale: 4.0–5.5 ×10⁶/μL", low:"Anemia, bleeding",             high:"Polycythemia, dehydration" },
  { id:4, test:"Platelets",              normal:"150,000–400,000 /μL",                      low:"Bleeding disorders, bone marrow disease",      high:"Infection, inflammation, clotting disorders" },
  { id:5, test:"Fasting Blood Glucose",  normal:"70–100 mg/dL",                             low:"Hypoglycemia, insulin overdose",               high:"Diabetes mellitus" },
  { id:6, test:"Urea",                   normal:"15–40 mg/dL",                              low:"Liver disease, malnutrition",                  high:"Kidney disease, dehydration" },
  { id:7, test:"Creatinine",             normal:"0.6–1.3 mg/dL",                            low:"Muscle wasting",                              high:"Kidney failure, dehydration" },
];
export const DEFAULT_PQ = [
  { id:1, subject:"Anatomy & Physiology", year:"2023", questions:[
    { q:"Which part of the brain controls balance and coordination?", options:["Cerebrum","Cerebellum","Medulla Oblongata","Thalamus"], ans:1 },
    { q:"The normal adult heart rate is:", options:["40-60 bpm","60-100 bpm","100-120 bpm","120-140 bpm"], ans:1 },
  ]},
  { id:2, subject:"Pharmacology", year:"2023", questions:[
    { q:"The antidote for paracetamol overdose is:", options:["Naloxone","Flumazenil","N-Acetylcysteine","Atropine"], ans:2 },
  ]},
];
export const DEFAULT_SKILLS = [
  { id:1, name:"IV cannulation" }, { id:2, name:"Urinary catheterisation" },
  { id:3, name:"Wound dressing" }, { id:4, name:"Blood glucose monitoring" },
  { id:5, name:"Basic Life Support (BLS)" },
];
export const DEFAULT_ANNOUNCEMENTS = [
  { id:1, title:"Welcome to Nursing Academic Hub!", body:"Your nursing study platform is ready. Explore all features.", date:"Today", pinned:true },
];

// ─── INIT STORAGE ───────────────────────────────────────────────────
export const initData = () => {
  if (!ls("nv-classes", null))       lsSet("nv-classes",       DEFAULT_CLASSES);
  if (!ls("nv-drugs", null))         lsSet("nv-drugs",         DEFAULT_DRUGS);
  if (!ls("nv-labs", null))          lsSet("nv-labs",          DEFAULT_LABS);
  if (!ls("nv-pq", null))            lsSet("nv-pq",            DEFAULT_PQ);
  if (!ls("nv-skillsdb", null))      lsSet("nv-skillsdb",      DEFAULT_SKILLS);
  if (!ls("nv-announcements", null)) lsSet("nv-announcements", DEFAULT_ANNOUNCEMENTS);
  if (!ls("nv-users", null))         lsSet("nv-users",         [{username:"admin@gmail.com",password:"admin123",role:"admin",class:"",joined:"System"}]);
};
