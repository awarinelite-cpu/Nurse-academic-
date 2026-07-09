// ─── FIREBASE MODULAR SDK CLIENT ─────────────────────────────────────
//
// Replaces the old CDN firebase-compat script loading. This is the
// single source of `app`, `auth`, and `db` for the entire application.
// Every file that previously did `window.firebase...` should import
// from here instead.

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

import { FIREBASE_CONFIG } from "./firebase.js";

export const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);

export const auth = getAuth(app);
export const db = getFirestore(app);
