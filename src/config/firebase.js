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

// ── MAIN SITE Firebase config ──────────────────────────────────────────
export const FIREBASE_CONFIG_MAIN = {
  apiKey:            "AIzaSyB_bSeHflIDhihDhDUE1p1kKZpJId0dxA8",
  authDomain:        "medicare-c6196.firebaseapp.com",
  projectId:         "medicare-c6196",
  storageBucket:     "medicare-c6196.firebasestorage.app",
  messagingSenderId: "632103735569",
  appId:             "1:632103735569:web:458561690c6c4c6efbbcb0",
};

// ── CLONE SITE Firebase config (nurse-academic-school-b.onrender.com) ──
export const FIREBASE_CONFIG_CLONE = {
  apiKey:            "AIzaSyDH5jtyCEDTUkhqw1gEOw8p7lxfzhUITpM",
  authDomain:        "nurseexamprep-6956a.firebaseapp.com",
  projectId:         "nurseexamprep-6956a",
  storageBucket:     "nurseexamprep-6956a.firebasestorage.app",
  messagingSenderId: "726798762408",
  appId:             "1:726798762408:web:da9b75b3e9eded124f1d9d",
};

// ── Auto-select config based on hostname ───────────────────────────────
const _IS_CLONE = typeof window !== "undefined" &&
  window.location.hostname === "nurse-academic-school-b.onrender.com";
export const FIREBASE_CONFIG = _IS_CLONE ? FIREBASE_CONFIG_CLONE : FIREBASE_CONFIG_MAIN;

// ── FCM VAPID key — get from Firebase Console → Project Settings → Cloud Messaging → Web Push certificates ──
// Replace the string below with your actual VAPID key
export const FCM_VAPID_KEY = "BKcxnd9gn28KuXuB6BTZnGRA08QYUmKamGxrWHgJLIvog7P13jMrs5WZcmnisJ5k7Dvhxeir0BK-AvpEW2fQcw8"; // e.g. "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3"
