/* @jsxRuntime classic */
import React, { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";

import { auth, db } from "./config/firebaseClient";
import { FCM_VAPID_KEY } from "./config/firebase";
import { EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID } from "./config/keys";
import { DEFAULT_CLASSES, initData } from "./data/defaults";
import { _db, _loadFirebase, _safeKey, checkStorageHealth, clearCallSignal, dmSubscribeInbox, examBsGet, examBsSet, gcSubscribe, hydrateFromBackend, loadShared, saveShared, setCurrentUserRef, subscribeCallSignal, subscribeSharedDoc, subscribeUserNotifications, syncUserPrivateData } from "./services/backend";
import { sendResetEmail } from "./services/emailService";
import { showNotif } from "./utils/notifications";
import { ls, lsSet } from "./utils/storage";
import { Assignments, AttendanceView, Handouts, StudyGroups, Timetable } from "./components/academics";
import { AdminPanel } from "./components/admin";
import { PinSetupModal } from "./components/auth";
import { PaymentHistory, PerformanceAnalytics, StudyTimer, Toasts } from "./components/common";
import { CbtExamManager, CbtStudentView } from "./components/exams";
import { LecturerPanel } from "./components/lecturer";
import { Messages, Notifications } from "./components/messaging";
import { NursingCouncilSite, NursingExamsStandaloneView, SchoolOnlyPastQuestionsView } from "./components/nursing-council";
import { DrugGuideView, GPACalc, LabReferenceView, MedCalc, SkillsView } from "./components/reference";
import { ResearchClub, ResearchRequestPage } from "./components/research";
import { Dashboard, FlashcardSystem, LeaderboardStreaks, ProgressDashboard, Results, StudentIDCard, StudentProfile } from "./components/student";
import { DmCallModal, IncomingCallBanner } from "./components/video-call";
import { _gvcSigDoc } from "./shared/groupVideoCall";
import { PHN_FORUM_ID, phnGetLecturers } from "./shared/phnForum";
import { getSavedPin, hasBiometric } from "./shared/pinAuth";

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
    // ── Real-time shared-data listener (fires within ~1s of any write on any device)
    // Replaces the old 60-second polling interval.
    const unsubShared = subscribeSharedDoc();
    // Fallback: also sync on tab focus in case the listener missed something while hidden
    const onFocus = () => hydrateFromBackend();
    window.addEventListener("focus", onFocus);
    return () => { unsubShared(); window.removeEventListener("focus", onFocus); };
  }, []);

  // ── Request notification permission as soon as app loads ──────────
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
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
    // ── PWA: register service worker (with push notification support) ──
    if ("serviceWorker" in navigator) {
      const swCode = `

const CACHE_NAME = 'nursing-hub-v5';

const STATIC_ASSETS = ['/', '/?offline=1'];

// Install: cache static assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Network-first for API/Firestore, Cache-first for assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Skip non-GET and cross-origin Firebase/API calls
  if (e.request.method !== 'GET') return;
  if (url.hostname.includes('firestore') || url.hostname.includes('googleapis')) {
    // For Firebase — network only, no caching
    return;
  }
  // For same-origin HTML/JS/CSS — stale-while-revalidate
  e.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(e.request);
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok && res.type !== 'opaque') cache.put(e.request, res.clone());
        return res;
      }).catch(() => null);
      return cached || await networkFetch || new Response('Offline — content not cached', {status: 503});
    })
  );
});

// Push notifications
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'Nursing Hub', body: 'You have a new notification' };
  const isCall = d.type === 'call';
  e.waitUntil(
    self.registration.showNotification(d.title || 'Nursing Hub', {
      body: d.body || '',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: d.tag || 'notif',
      renotify: true,
      vibrate: isCall ? [300,100,300,100,300,100,300] : [200, 100, 200],
      requireInteraction: isCall,
      data: { url: d.url || '/', type: d.type || 'general', payload: d.payload || {} },
      actions: isCall
        ? [{ action: 'answer', title: '✅ Answer' }, { action: 'decline', title: '❌ Decline' }]
        : (d.actions || []),
    })
  );
});

// Notification click → open or focus app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const type    = e.notification.data?.type || 'general';
  const action  = e.action;
  const payload = e.notification.data?.payload || {};
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      let msg = 'OPEN_APP';
      if (type === 'dm' || type === 'call')          msg = 'OPEN_MESSAGES';
      if (type === 'group_chat')                      msg = 'OPEN_MESSAGES';
      if (type === 'assignment')                      msg = 'OPEN_ASSIGNMENTS';
      if (type === 'call' && action === 'answer')    msg = 'ANSWER_CALL';
      if (type === 'call' && action === 'decline')   msg = 'DECLINE_CALL';
      for (const c of cs) {
        if ('focus' in c) { c.postMessage({ type: msg, payload }); return c.focus(); }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
      `;
      navigator.serviceWorker.register('/firebase-messaging-sw.js').then(reg=>{
        window._swReg = reg;
        // Listen for SW messages (e.g. user clicked notification → open Messages)
        navigator.serviceWorker.addEventListener('message', ev => {
          if (ev.data?.type === 'OPEN_MESSAGES') {
            window.dispatchEvent(new CustomEvent('nv-open-messages'));
          }
          if (ev.data?.type === 'ANSWER_CALL') {
            window.dispatchEvent(new CustomEvent('nv-answer-call', { detail: ev.data.payload }));
          }
          if (ev.data?.type === 'DECLINE_CALL') {
            window.dispatchEvent(new CustomEvent('nv-decline-call', { detail: ev.data.payload }));
          }
        });
      }).catch(()=>{});
    }
    // ── PWA: meta tags ──
    // ── Viewport meta: critical for correct scaling on iPhone ──
    // "viewport-fit=cover" lets content extend behind the notch so we can
    // use env(safe-area-inset-*) to pad away from it manually.
    if (!document.querySelector('meta[name="viewport"]')) {
      const vp = document.createElement("meta");
      vp.name = "viewport";
      vp.content = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover";
      document.head.insertBefore(vp, document.head.firstChild);
    } else {
      // Update existing viewport to include viewport-fit=cover if missing
      const vp = document.querySelector('meta[name="viewport"]');
      if (!vp.content.includes("viewport-fit")) {
        vp.content = vp.content + ", viewport-fit=cover";
      }
      if (!vp.content.includes("maximum-scale")) {
        vp.content = vp.content + ", maximum-scale=1";
      }
    }
    const metas = [
      ["mobile-web-app-capable","yes"],["apple-mobile-web-app-capable","yes"],
      // "black-translucent" lets the status bar overlay our content so the
      // topbar colour shows through — much more polished on iPhone
      ["apple-mobile-web-app-status-bar-style","black-translucent"],
      ["apple-mobile-web-app-title","NursingHub"],["theme-color","#0077b6"],
      // Prevent iOS from detecting phone numbers and making them links
      ["format-detection","telephone=no"],
    ];
    metas.forEach(([name,content])=>{
      if(!document.querySelector(`meta[name="${name}"]`)){
        const m=document.createElement("meta");m.name=name;m.content=content;document.head.appendChild(m);
      } else {
        // update existing
        document.querySelector(`meta[name="${name}"]`).content = content;
      }
    });
  }, []);

  const [page, setPage] = useState(() => ls("nv-session-page", "auth"));
  const [siteMode, setSiteMode] = useState(() => ls("nv-site-mode","school")); // "school" | "nursing"
  const switchToNursing = () => { setSiteMode("nursing"); lsSet("nv-site-mode","nursing"); };
  const switchToSchool  = () => { setSiteMode("school");  lsSet("nv-site-mode","school"); };
  const [authTab, setAuthTab] = useState("signin");
  const [loginType, setLoginType] = useState("student"); // "student" | "admin"
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [showPw, setShowPw] = useState(false);
  const [regUser, setRegUser] = useState(""); const [regPw, setRegPw] = useState(""); const [regClass, setRegClass] = useState(""); const [regName, setRegName] = useState(""); const [regMatric, setRegMatric] = useState(""); const [regStudentType, setRegStudentType] = useState("class"); // "class" | "phn"
  const [activeNav, setActiveNav] = useState("dashboard"); const [activeTool, setActiveTool] = useState(null);
  const [themeMode, setThemeMode] = useState("light"); const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState([]); const [currentUser, setCurrentUser] = useState(() => ls("nv-session-user", "")); const [isAdmin, setIsAdmin] = useState(() => ls("nv-session-admin", false));
  const [selectedClass, setSelectedClass] = useState(null);
  const [navHistory, setNavHistory] = useState([]);
  const [isLecturer, setIsLecturer] = useState(() => ls("nv-session-lecturer", false));
  React.useEffect(() => { const u = ls("nv-session-user",""); if (u) setCurrentUserRef(u); }, []);
  const [openGroup, setOpenGroup] = useState(null);
  const [unreadNotifs, setUnreadNotifs] = useState(()=>{
    const notifs = ls("nv-notifications", []);
    return notifs.filter(n => !n.read).length;
  });

  // ── Real-time notification listener — updates badge within ~1s across devices
  useEffect(() => {
    if (!currentUser) return;
    const unsub = subscribeUserNotifications(currentUser, (notifs) => {
      setUnreadNotifs(notifs.filter(n => !n.read).length);
    });
    return unsub;
  }, [currentUser]);
  const [unreadDM, setUnreadDM] = useState(0);
  const [unreadPHNForum, setUnreadPHNForum] = useState(0);  // show setup modal after first login
  const [pinLocked,     setPinLocked]     = useState(false);  // show unlock screen
  const [bypassPin,     setBypassPin]     = useState(false);  // user chose "use password"
  const [showPinSetup,  setShowPinSetup]  = useState(false); // show PIN setup modal after login/register
  // Offline indicator
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
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

  // ── Offline / online detection ────────────────────────────────
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline  = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online",  goOnline);
    return () => { window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); };
  }, []);

  // ── PIN lock when app comes back from background ──────────────
  useEffect(() => {
    if (!currentUser || page !== "app") return;
    let hiddenAt = 0;
    const onVisibility = () => {
      // Don't trigger PIN lock while a CBT exam is actively being taken
      // (visibilitychange fires during exam and would lock the screen mid-exam)
      if (typeof window !== "undefined" && window._cbtExamInProgress) return;
      if (document.hidden) {
        hiddenAt = Date.now();
      } else {
        // Lock if away for more than 3 minutes and PIN is set
        const away = Date.now() - hiddenAt;
        if (away > 3 * 60 * 1000 && (getSavedPin(currentUser) || hasBiometric(currentUser)) && !bypassPin) {
          setPinLocked(true);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [currentUser, page, bypassPin]);

  // ── Subscribe to push notifications via FCM ──────────────────
  useEffect(() => {
    if (!currentUser || page !== "app" || FCM_VAPID_KEY === "YOUR_VAPID_KEY_HERE") return;
    const setupFCM = async () => {
      try {
        const reg = window._swReg;
        if (!reg || !window.PushManager) return;
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: FCM_VAPID_KEY,
        });
        // Store subscription in Firestore so backend can send pushes
        const ready = await _loadFirebase();
        if (ready && _db) {
          await _db.collection("push_subs").doc(currentUser.replace(/[^a-z0-9]/gi,"_")).set({
            user: currentUser, sub: JSON.stringify(sub), updatedAt: Date.now(),
          }, { merge: true });
        }
      } catch(e) { /* FCM optional — silent fail */ }
    };
    setTimeout(setupFCM, 3000);
  }, [currentUser, page]);

  // Open Messages tab when user clicks a DM notification (from service worker)
  useEffect(() => {
    const handler = () => { setActiveNav("messages"); setSidebarOpen(false); };
    window.addEventListener("nv-open-messages", handler);
    return () => window.removeEventListener("nv-open-messages", handler);
  }, []);

  // ── Global DM inbox listener — fires popup notifications even when not on Messages page
  useEffect(() => {
    if (!currentUser || page !== "app") return;
    let knownMsgIds = new Set();
    let initialized = false;
    const unsub = dmSubscribeInbox(currentUser, convs => {
      // Update unread badge count
      const unread = convs.filter(c => c["unread_" + _safeKey(currentUser)]).length;
      setUnreadDM(unread);
      // For each conv with unread flag, check for new messages to show popup
      convs.forEach(conv => {
        if (!conv["unread_" + _safeKey(currentUser)]) return;
        if (!conv.lastMsg || knownMsgIds.has(conv.lastAt)) return;
        if (!initialized) return; // skip first snapshot (old messages)
        knownMsgIds.add(conv.lastAt);
        const sender = (conv.participants || []).find(p => p !== currentUser);
        if (!sender) return;
        const allUsers = ls("nv-users", []);
        const senderName = allUsers.find(u => u.username === sender)?.displayName || sender.split("@")[0];
        // Browser notification (works even when tab is in background)
        showNotif("💬 New message from " + senderName, { body: conv.lastMsg, tag: "dm_" + sender });
        // In-app toast popup
        if (activeNav !== "messages") {
          toast("💬 " + senderName + ": " + conv.lastMsg.slice(0, 60), "info");
        }
      });
      initialized = true;
    });
    return () => unsub();
  }, [currentUser, page]);

  // ── Incoming call state ────────────────────────────────────────────────────
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall,   setActiveCall]   = useState(null);

  // Subscribe to incoming call signals
  useEffect(() => {
    if (!currentUser || page !== "app") return;
    const ringRef = { current: null };
    const unsub = subscribeCallSignal(currentUser, (signal) => {
      if (!signal || signal.toUser !== currentUser) return;
      if (signal.status === "ended") {
        setIncomingCall(null);
        if (ringRef.current) { ringRef.current(); ringRef.current = null; }
        return;
      }
      if (signal.status === "ringing" && signal.fromUser && signal.fromUser !== currentUser) {
        const age = Date.now() - (signal.ts || 0);
        if (age > 60000) return;
        setIncomingCall({
          fromUser:    signal.fromUser,
          callType:    signal.callType || "voice",
          callerName:  signal.callerName  || signal.fromUser.split("@")[0],
          callerAvatar: signal.callerAvatar || (signal.fromUser[0]||"?").toUpperCase(),
          roomId: signal.roomId,
        });
        // Notification for background / out-of-tab
        showNotif(
          (signal.callType === "video" ? "\uD83D\uDCF9" : "\uD83D\uDCDE") + " Incoming " + (signal.callType === "video" ? "video" : "voice") + " call",
          {
            body: "from " + (signal.callerName || signal.fromUser.split("@")[0]),
            tag: "call_" + signal.roomId,
            requireInteraction: true,
            vibrate: [300,100,300,100,300,100,300],
            data: { type:"call", payload:{ fromUser:signal.fromUser, toUser:currentUser, callType:signal.callType, roomId:signal.roomId } }
          }
        );
        // Ringtone via Web Audio
        try {
          if (!ringRef.current) {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            let ringCount = 0;
            const playRing = () => {
              const osc = ctx.createOscillator(); const gain = ctx.createGain();
              osc.type = "sine";
              osc.frequency.setValueAtTime(880, ctx.currentTime);
              osc.frequency.setValueAtTime(660, ctx.currentTime + 0.25);
              gain.gain.setValueAtTime(0.15, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
              osc.connect(gain); gain.connect(ctx.destination);
              osc.start(); osc.stop(ctx.currentTime + 0.6);
            };
            const iv = setInterval(() => { if (ringCount++ > 15) clearInterval(iv); else playRing(); }, 1400);
            ringRef.current = () => clearInterval(iv);
          }
        } catch(_) {}
      }
    });
    const answerHandler = (ev) => {
      const { fromUser: fu, toUser: tu, callType: ct } = ev.detail || {};
      if (tu !== currentUser) return;
      setIncomingCall(null);
      if (ringRef.current) { ringRef.current(); ringRef.current = null; }
      const allUsers = ls("nv-users", []);
      const remoteUser = allUsers.find(u => u.username === fu);
      setActiveCall({ type: ct, toUser: fu, toName: remoteUser?.displayName || fu.split("@")[0], toAvatar: remoteUser?.avatar || (fu[0]||"?").toUpperCase() });
      setActiveNav("messages");
    };
    const declineHandler = (ev) => {
      const { toUser: tu } = ev.detail || {};
      if (tu !== currentUser) return;
      setIncomingCall(null);
      if (ringRef.current) { ringRef.current(); ringRef.current = null; }
      clearCallSignal(currentUser);
    };
    window.addEventListener("nv-answer-call", answerHandler);
    window.addEventListener("nv-decline-call", declineHandler);
    return () => {
      unsub();
      if (ringRef.current) { ringRef.current(); ringRef.current = null; }
      window.removeEventListener("nv-answer-call", answerHandler);
      window.removeEventListener("nv-decline-call", declineHandler);
    };
  }, [currentUser, page]);


  // ── Global PHN Forum listener — notifies PHN students even when browsing other pages
  useEffect(() => {
    if (!currentUser || page !== "app") return;
    const allUsers = ls("nv-users", []);
    const me = allUsers.find(u => u.username === currentUser) || {};
    const myRole = me.role || "student";
    const isPHN = me.class && (me.class.toLowerCase().includes("phn") || me.class.toLowerCase().includes("public"));
    if (!isPHN && myRole !== "admin") return;
    let active = true;
    phnGetLecturers().then(lecturers => {
      if (!active) return;
      const allowed = isPHN || myRole === "admin" || (lecturers || []).includes(currentUser);
      if (!allowed) return;
      let initialized = false;
      let prevCount = 0;
      const unsub = gcSubscribe(PHN_FORUM_ID, incoming => {
        if (!initialized) { prevCount = incoming.length; initialized = true; return; }
        if (incoming.length > prevCount) {
          const newOthers = incoming.slice(prevCount).filter(m => m.from !== currentUser);
          if (newOthers.length > 0) {
            setUnreadPHNForum(n => n + newOthers.length);
            newOthers.forEach(msg => {
              const allU = ls("nv-users", []);
              const su = allU.find(u => u.username === msg.from);
              const sname = su?.displayName || (msg.from || "").split("@")[0];
              const body = msg.type === "voice" ? "🎤 Sent a voice note"
                         : msg.type === "file"  ? `📎 ${msg.fileName || "File"}`
                         : (msg.text || "").slice(0, 80);
              if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                showNotif(`🌍 PHN Forum — ${sname}`, { body, tag: "phn_school_" + msg.id });
              }
              toast(`🌍 PHN Forum — ${sname}: ${body}`, "info");
            });
          }
        }
        prevCount = incoming.length;
      });
      return () => { active = false; unsub(); };
    });
  }, [currentUser, page]);
  // Same user → store email + password. Different user → store email only, no password.
  const saveCredential = (email, pw) => {
    try {
      const raw = localStorage.getItem("nv-saved-cred");
      const existing = raw ? JSON.parse(raw) : null;
      if (!existing || existing.email === email) {
        try { localStorage.setItem("nv-saved-cred", JSON.stringify({ email, password: pw, savedAt: Date.now() })); } catch {}
      } else {
        // New user on same device — save email but not their password
        try { localStorage.setItem("nv-saved-cred", JSON.stringify({ email, password: "", savedAt: Date.now() })); } catch {}
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
    const email = forgotEmail.trim();
    setForgotLoading(true);

    // ── Try real Firebase Auth reset first (works on free Spark plan —
    // no Cloud Function needed. Firebase sends the email and hosts the
    // reset page itself). Only accounts already migrated to real Auth
    // will succeed here. ──
    try {
      await sendPasswordResetEmail(auth, email);
      setForgotLoading(false);
      setForgotMode("sent");
      toast("📧 Reset link sent! Check your inbox (and spam folder).", "success");
      return;
    } catch (e) {
      if (e.code !== "auth/user-not-found") {
        setForgotLoading(false);
        return toast("Couldn't send reset email — check your connection and try again", "error");
      }
      // auth/user-not-found → this account hasn't been migrated yet.
      // Fall through to the legacy code-based flow below, which still
      // works against the old nv-users array.
    }

    const users = ls("nv-users",[]);
    const user = users.find(u=>u.username===email);
    if (!user) { setForgotLoading(false); return toast("No account found with that email","error"); }
    // Generate 6-digit code and store in backend (10-min expiry)
    const code = String(Math.floor(100000+Math.random()*900000));
    _setResetCode(code);
    await examBsSet(`reset:${email}`, {code, expires: Date.now()+600000});

    // ── Send real email via EmailJS ──
    const emailConfigured =
      EMAILJS_PUBLIC_KEY  !== "YOUR_PUBLIC_KEY"  &&
      EMAILJS_SERVICE_ID  !== "YOUR_SERVICE_ID"  &&
      EMAILJS_TEMPLATE_ID !== "YOUR_TEMPLATE_ID";

    if (emailConfigured) {
      try {
        await sendResetEmail(email, code);
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

    // ── Step 0: verify identity with real Firebase Auth ──────────────
    // Replaces the old plaintext password comparison. If this account
    // hasn't been through the migration script yet, fall back to the
    // legacy check once, then lazily create the real Auth account
    // using the password they just proved they know — so every
    // subsequent login goes through the fast, secure path above.
    try {
      await signInWithEmailAndPassword(auth, username, password);
    } catch (e) {
      if (e.code === "auth/user-not-found") {
        const localUsers = ls("nv-users", []);
        let legacyUser = localUsers.find(u => u.username === username && u.password === password);
        if (!legacyUser) {
          try {
            const fresh = await Promise.race([
              loadShared("users", [{username:"admin@gmail.com",password:"admin123",role:"admin",class:"",joined:"System"}]),
              new Promise((_,reject) => setTimeout(()=>reject(new Error("timeout")), 4000))
            ]);
            legacyUser = (fresh||[]).find(u => u.username === username && u.password === password);
          } catch {}
        }
        if (!legacyUser) return toast("Invalid email or password", "error");
        try {
          const created = await createUserWithEmailAndPassword(auth, username, password);
          // Security rules key admin/lecturer checks off users/{uid}.role —
          // without this doc, a lazily-migrated user would pass auth but
          // fail every role-gated rule.
          await setDoc(doc(db, "users", created.user.uid), {
            username: legacyUser.username,
            displayName: legacyUser.displayName || legacyUser.username,
            role: legacyUser.role || "student",
            class: legacyUser.class || "",
            isPublicHealth: !!legacyUser.isPublicHealth,
            matricNumber: legacyUser.matricNumber || "",
            joined: legacyUser.joined || null,
            migratedAt: Date.now(),
          }, { merge: true });
        } catch (createErr) {
          console.warn("[Auth] Lazy account creation failed:", createErr.message);
        }
      } else if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
        return toast("Invalid email or password", "error");
      } else {
        return toast("Login failed — check your connection and try again", "error");
      }
    }

    // ── Step 1: check localStorage instantly for profile/role (sub 100ms) ──
    const localUsers = ls("nv-users", []);
    const localUser = localUsers.find(u => u.username === username);
    if (localUser) {
      // Instant login from cache
      if (loginType === "admin" && localUser.role !== "admin" && localUser.role !== "sub-admin") return toast("Not an admin account", "error");
    window.__currentUser = localUser.username;
      setCurrentUserRef(username); setCurrentUser(username);
      setIsAdmin(localUser.role === "admin" || localUser.role === "sub-admin"); setIsLecturer(localUser.role === "lecturer");
      setPage("app");
      lsSet("nv-session-user",username); lsSet("nv-session-page","app"); lsSet("nv-session-admin",localUser.role==="admin"||localUser.role==="sub-admin"); lsSet("nv-session-lecturer",localUser.role==="lecturer");
      toast(`Welcome back! 👋`, "success");
      // Auto-mark admin/lecturer as research club member in localStorage for badge display
      if (localUser.role === "admin" || localUser.role === "lecturer") {
        try { localStorage.setItem("rc-member-"+username.replace(/[^a-z0-9]/gi,"_"), "1"); } catch{}
      }
      saveCredential(username, password);
      // Show PIN setup if not yet configured and not skipped
      if (!getSavedPin(username) && !hasBiometric(username) && !ls("nv-pin-skipped-" + username.replace(/[^a-z0-9]/gi,"_"))) {
        setTimeout(() => setShowPinSetup(true), 1200);
      }
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
      const remoteUser = (fresh||[]).find(u => u.username === username);
      if (!remoteUser) return toast("Invalid email or password", "error");
      if (loginType === "admin" && remoteUser.role !== "admin" && remoteUser.role !== "sub-admin") return toast("Not an admin account", "error");
      setCurrentUserRef(username); setCurrentUser(username);
      setIsAdmin(remoteUser.role === "admin" || remoteUser.role === "sub-admin"); setIsLecturer(remoteUser.role === "lecturer");
      setPage("app");
      lsSet("nv-session-user",username); lsSet("nv-session-page","app"); lsSet("nv-session-admin",remoteUser.role==="admin"||remoteUser.role==="sub-admin"); lsSet("nv-session-lecturer",remoteUser.role==="lecturer");
      toast(`Welcome back! 👋`, "success");
      if (remoteUser.role === "admin" || remoteUser.role === "lecturer") {
        try { localStorage.setItem("rc-member-"+username.replace(/[^a-z0-9]/gi,"_"), "1"); } catch{}
      }
      if (!getSavedPin(username) && !hasBiometric(username) && !ls("nv-pin-skipped-" + username.replace(/[^a-z0-9]/gi,"_"))) {
        setTimeout(() => setShowPinSetup(true), 1200);
      }
      syncUserPrivateData(username).then(()=>{
        const notifs = ls("nv-notifications", []);
        setUnreadNotifs(notifs.filter(n => !n.read).length);
      });
    } catch (e) {
      toast("Login failed — check your connection and try again", "error");
    }
  };

  const register = async () => {
    if (!regName.trim()) return toast("Enter your full name", "error");
    if (!regUser || !regPw) return toast("Fill in all fields", "error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regUser)) return toast("Enter a valid email address", "error");
    if (regPw.length < 6) return toast("Password must be at least 6 characters", "error");
    if (!regMatric.trim()) return toast("Enter your matric number", "error");
    if (regStudentType !== "phn" && !regClass) return toast("Please select your class", "error");
    const users = ls("nv-users", []);
    if (users.find(u => u.username === regUser)) return toast("Email already registered", "error");
    if (users.find(u => u.matricNumber && u.matricNumber.toLowerCase() === regMatric.trim().toLowerCase())) return toast("Matric number already registered", "error");
    let newUid = null;
    try {
      const created = await createUserWithEmailAndPassword(auth, regUser, regPw);
      newUid = created.user.uid;
    } catch (e) {
      if (e.code === "auth/email-already-in-use") return toast("Email already registered", "error");
      if (e.code === "auth/weak-password") return toast("Password must be at least 6 characters", "error");
      return toast("Registration failed — check your connection and try again", "error");
    }
    const isPHN = regStudentType === "phn";
    const assignedClass = isPHN ? "publichealth" : regClass;
    const profile = { username: regUser, role: "student", class: assignedClass, isPublicHealth: isPHN, displayName: regName.trim(), matricNumber: regMatric.trim().toUpperCase(), joined: new Date().toLocaleDateString() };
    try {
      await setDoc(doc(db, "users", newUid), profile, { merge: true });
    } catch (e) {
      console.warn("[Auth] users/{uid} profile write failed:", e.message);
    }
    const newUsers = [...users, profile];
    saveShared("users", newUsers);
    setCurrentUserRef(regUser); setCurrentUser(regUser);
    setIsAdmin(false); setIsLecturer(false);
    setPage("app");
    lsSet("nv-session-user",regUser); lsSet("nv-session-page","app"); lsSet("nv-session-admin",false); lsSet("nv-session-lecturer",false);
    toast(`Welcome, ${regName.trim().split(" ")[0]}! 🎉`, "success");
    saveCredential(regUser, regPw);
    setTimeout(() => setShowPinSetup(true), 1500);
  };

  const [selectedExamType, setSelectedExamType] = useState(null);

  const navigate = (section, cls = null, examType = null) => {
    setNavHistory(h => [...h, { nav: activeNav, tool: activeTool, cls: selectedClass }]);
    setActiveNav(section); setActiveTool(null); if (cls) setSelectedClass(cls);
    if (examType) setSelectedExamType(examType); else setSelectedExamType(null);
    setSidebarOpen(false);
    window.history.pushState({ nvApp: true }, "");
  };
  // Listen for rc-open-dm events from ResearchClub component
  useEffect(() => {
    const handler = () => navigate("messages");
    window.addEventListener("rc-open-dm", handler);
    return () => window.removeEventListener("rc-open-dm", handler);
  }, []);
  const navTool = (tool) => {
    setNavHistory(h => [...h, { nav: activeNav, tool: activeTool, cls: selectedClass }]);
    setActiveTool(tool); setActiveNav(null); setSidebarOpen(false);
    window.history.pushState({ nvApp: true }, "");
  };
  const _exitRef = React.useRef(false);
  const goBack = () => {
    if (navHistory.length > 0) {
      const prev = navHistory[navHistory.length - 1];
      setNavHistory(h => h.slice(0, -1));
      setActiveNav(prev.nav); setActiveTool(prev.tool); if (prev.cls) setSelectedClass(prev.cls);
      return;
    }
    // Already on home — double-press to exit
    if (_exitRef.current) { window.history.go(-999); return; }
    _exitRef.current = true;
    toast("Press back again to exit", "info");
    setTimeout(() => { _exitRef.current = false; }, 2000);
  };
  // Phone/browser back button — intercept popstate and mirror goBack
  useEffect(() => {
    window.history.replaceState({ nvApp: true }, "");
    const onPopState = () => {
      window.history.pushState({ nvApp: true }, "");
      goBack();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navHistory]);

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
      case "cbt": return isAdmin
        ? <div style={{textAlign:"center",padding:60,color:"var(--text3)"}}><div style={{fontSize:48,marginBottom:12}}>🔒</div><div style={{fontWeight:700}}>CBT Exams are managed by Lecturers</div><div style={{fontSize:13,marginTop:6}}>Admins do not have access to CBT exams.</div></div>
        : isLecturer
          ? <CbtExamManager toast={toast} currentUser={currentUser} />
          : <CbtStudentView toast={toast} currentUser={currentUser} />;
      case "questions": return <SchoolOnlyPastQuestionsView toast={toast} currentUser={currentUser} />;
      case "nursingexams": return <NursingExamsStandaloneView toast={toast} currentUser={currentUser} initialExam={selectedExamType} />;
      case "messages": return <Messages user={currentUser} toast={toast} onUnreadChange={setUnreadDM} />;
      case "research-club": return <ResearchClub currentUser={currentUser} toast={toast} isLecturer={isLecturer} isAdmin={isAdmin} />;
      case "research-request": return <ResearchRequestPage currentUser={currentUser} toast={toast} />;
      case "notifications": return <Notifications currentUser={currentUser} onRead={()=>setUnreadNotifs(0)} onNavigate={navigate} />;
      case "profile": return <StudentProfile currentUser={currentUser} toast={toast} />;
      case "student-id": return <StudentIDCard currentUser={currentUser} toast={toast} />;
      case "payment-history": return <PaymentHistory currentUser={currentUser} />;
      case "study-timer": return <StudyTimer />;
      case "analytics": return <PerformanceAnalytics currentUser={currentUser} />;
      case "flashcards": return <FlashcardSystem currentUser={currentUser} />;
      case "study-groups": return <StudyGroups currentUser={currentUser} toast={toast} />;
      case "timetable": return <Timetable currentUser={currentUser} toast={toast} isLecturer={isLecturer||isAdmin} />;
      case "assignments": return <Assignments currentUser={currentUser} toast={toast} isLecturer={isLecturer||isAdmin} />;
      case "attendance": return <AttendanceView currentUser={currentUser} toast={toast} isLecturer={isLecturer||isAdmin} />;
      case "leaderboard": return <LeaderboardStreaks currentUser={currentUser} />;
      case "progress": return <ProgressDashboard currentUser={currentUser} />;
      default: return <Dashboard user={currentUser} onNavigate={navigate} />;
    }
  };

  const NAV = [
    { icon:"⊞", label:"Dashboard", key:"dashboard" },
    { icon:"📄", label:"All Handouts", key:"handouts" },
    { icon:"📊", label:"Results", key:"results" },
    ...(!isAdmin ? [{ icon:"🧪", label:"CBT Exams", key:"cbt" }] : []),
    { icon:"🏫", label:"School Past Questions", key:"questions" },
    { icon:"🔔", label:"Notifications", key:"notifications" },
    { icon:"💬", label:"Messages", key:"messages" },
    { icon:"🔬", label:"Research Club", key:"research-club" },
    { icon:"📜", label:"Research Request", key:"research-request" },
    { icon:"👥", label:"Study Groups", key:"study-groups" },
    { icon:"📅", label:"Timetable", key:"timetable" },
    { icon:"📝", label:"Assignments", key:"assignments" },
    { icon:"📋", label:"Attendance", key:"attendance" },
    { icon:"👤", label:"My Profile", key:"profile" },
    { icon:"🪪", label:"My ID Card", key:"student-id" },
  ];
  const STUDY_TOOLS = [
    { icon:"⏱️", label:"Study Timer", key:"study-timer" },
    { icon:"📈", label:"My Progress", key:"progress" },
    { icon:"📊", label:"My Analytics", key:"analytics" },
    { icon:"🏆", label:"Leaderboard", key:"leaderboard" },
    { icon:"🃏", label:"Flashcards", key:"flashcards" },
    { icon:"💳", label:"Payment History", key:"payment-history" },
  ];
  const TOOLS = [
    { icon:"🧪", label:"Lab Reference", key:"lab-ref" },
    { icon:"💊", label:"Drug Guide", key:"drug-guide" },
    { icon:"🧮", label:"Med Calculator", key:"med-calc" },
    { icon:"✅", label:"OSCE Clinical Checklist for RN", key:"skills" },
    { icon:"🎓", label:"GPA Calculator", key:"gpa" },
  ];

  if (page === "auth") return (
    <>
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
                  <div style={{fontSize:32,marginBottom:6}}>{forgotMode==="code"?"🔑":forgotMode==="sent"?"✅":"📧"}</div>
                  <div style={{fontWeight:800,fontSize:16,marginBottom:4}}>{forgotMode==="code"?"Enter Reset Code":forgotMode==="sent"?"Check Your Email":"Reset Password"}</div>
                  <div style={{fontSize:12,color:"var(--text3)"}}>
                    {forgotMode==="code"?`We sent a 6-digit code to ${forgotEmail}`:forgotMode==="sent"?`We sent a password reset link to ${forgotEmail}. Click the link in that email to set a new password, then come back here to sign in.`:"Enter your registered email address"}
                  </div>
                </div>
                {forgotMode==="email"&&(
                  <>
                    <label className="lbl">Email Address</label>
                    <input className="inp" type="email" placeholder="your@email.com" value={forgotEmail}
                      onChange={e=>setForgotEmail(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&sendResetCode()} />
                    <button className="btn-primary" onClick={sendResetCode} disabled={forgotLoading}>
                      {forgotLoading?"📤 Sending...":"📧 Send Reset Link"}
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
                    <label className="lbl">Full Name</label>
                    <input className="inp" type="text" placeholder="e.g. Adaeze Okonkwo" value={regName} onChange={e=>setRegName(e.target.value)} />
                    <label className="lbl">Matric Number</label>
                    <input className="inp" type="text" placeholder="e.g. NRS/2021/001" value={regMatric} onChange={e=>setRegMatric(e.target.value.toUpperCase())} />
                    <label className="lbl">Email</label>
                    <input className="inp" type="email" placeholder="Enter your email" value={regUser} onChange={e=>setRegUser(e.target.value)} />
                    <label className="lbl">Password</label>
                    <input className="inp" type="password" placeholder="Choose password" value={regPw} onChange={e=>setRegPw(e.target.value)} />
                    <label className="lbl">Your Class</label>
                    {/* ── Student type toggle ── */}
                    <div style={{display:"flex",borderRadius:12,overflow:"hidden",border:"2px solid var(--accent)",marginBottom:10}}>
                      <button
                        type="button"
                        onClick={()=>setRegStudentType("class")}
                        style={{
                          flex:1,padding:"10px 6px",fontWeight:700,fontSize:13,border:"none",cursor:"pointer",transition:"all .2s",
                          background:(!regStudentType||regStudentType==="class")?"var(--accent)":"transparent",
                          color:(!regStudentType||regStudentType==="class")?"white":"var(--accent)",
                        }}>
                        🏫 Class Student
                      </button>
                      <button
                        type="button"
                        onClick={()=>setRegStudentType("phn")}
                        style={{
                          flex:1,padding:"10px 6px",fontWeight:700,fontSize:13,border:"none",cursor:"pointer",transition:"all .2s",
                          background:regStudentType==="phn"?"#2e7d32":"transparent",
                          color:regStudentType==="phn"?"white":"#2e7d32",
                        }}>
                        🌍 Public Health Student
                      </button>
                    </div>
                    {regStudentType==="phn" ? (
                      <div style={{background:"rgba(46,125,50,.08)",border:"1.5px solid #2e7d32",borderRadius:10,padding:"10px 12px",marginBottom:4,fontSize:12,color:"#2e7d32",fontWeight:600}}>
                        ✅ You will be registered as a <strong>Public Health Nursing student</strong>. You'll automatically appear in the PHN Forum once you log in.
                      </div>
                    ) : (
                      <select className="inp" value={regClass} onChange={e=>setRegClass(e.target.value)}>
                        <option value="">Select class...</option>
                        {classes.map(c=><option key={c.id} value={c.id}>{c.label} — {c.desc}</option>)}
                      </select>
                    )}
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

  // ── LECTURER gets their own dedicated panel ──
  if (page === "app" && isLecturer && !isAdmin) {
    return (
      <LecturerPanel
        currentUser={currentUser}
        toast={toast}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        runSync={runSync}
        syncing={syncing}
        syncError={syncError}
        onSignOut={()=>{signOut(auth).catch(()=>{});setPage("auth");setCurrentUser("");setIsAdmin(false);setIsLecturer(false);lsSet("nv-session-user","");lsSet("nv-session-page","auth");lsSet("nv-session-admin",false);lsSet("nv-session-lecturer",false);}}
      />
    );
  }

  return (
    <>
      <div className="app-shell">
        <div className={`sidebar-overlay${sidebarOpen?" open":""}`} onClick={()=>setSidebarOpen(false)} />
        <div className={`sidebar${sidebarOpen?" open":""}`}>
          <div className="sidebar-head">
            <div className="sidebar-logo-icon">🏥</div>
            <div className="sidebar-logo-name">Nursing Academic Hub</div>
            {isAdmin&&<span className="admin-badge-side">🛡️ Admin</span>}
          {isLecturer&&!isAdmin&&<span className="admin-badge-side" style={{background:"rgba(217,119,6,.25)",border:"1px solid rgba(217,119,6,.5)",color:"#fbbf24"}}>👨🏫 Lecturer</span>}
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
              {item.key==="messages"&&unreadDM>0&&<span style={{marginLeft:"auto",background:"var(--accent)",color:"white",borderRadius:"50%",width:18,height:18,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontWeight:700,flexShrink:0}}>{unreadDM>9?"9+":unreadDM}</span>}
            </div>
          ))}

          <div className="nav-sec" style={{marginTop:6}}>Clinical Tools</div>
          {TOOLS.map(item=>(
            <div key={item.key} className={`nav-item${activeTool===item.key?" active":""}`} onClick={()=>navTool(item.key)}>
              <span className="nav-icon">{item.icon}</span>{item.label}
            </div>
          ))}

          <div className="nav-sec" style={{marginTop:6}}>Study Tools</div>
          {STUDY_TOOLS.map(item=>(
            <div key={item.key} className={`nav-item${activeNav===item.key?" active":""}`} onClick={()=>{navigate(item.key);setSidebarOpen(false);}}>
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
            <div className="nav-item" style={{color:"var(--danger)",marginBottom:12}} onClick={()=>{signOut(auth).catch(()=>{});setPage("auth");setCurrentUser("");setIsAdmin(false);setIsLecturer(false);setNavHistory([]);lsSet("nv-session-user","");lsSet("nv-session-page","auth");lsSet("nv-session-admin",false);lsSet("nv-session-lecturer",false);}}>
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
                    {(()=>{const me=ls("nv-users",[]).find(u=>u.username===currentUser);const cls=ls("nv-classes",DEFAULT_CLASSES).find(c=>c.id===me?.class);return isAdmin?"🛡️ Admin":isLecturer?"👨🏫 Lecturer — All Classes":cls?`🏫 ${cls.label}`:"🎓 Student";})()}
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
              {isLecturer&&!isAdmin&&<span className="tag" style={{fontSize:10,borderColor:"var(--accent2)",color:"var(--accent2)"}}>👨🏫 Lecturer</span>}
              {(()=>{ try{ return localStorage.getItem("rc-member-"+currentUser.replace(/[^a-z0-9]/gi,"_"))==="1"; }catch{return false;} })()&&(
                <div title="Research Club Member — Prestigious Achievement!" onClick={()=>navigate("research-club")} style={{
                  background:"linear-gradient(135deg,#78350f,#b45309,#f59e0b)",
                  borderRadius:20,padding:"3px 11px",fontSize:10,fontWeight:900,color:"#fde68a",
                  boxShadow:"0 2px 10px rgba(245,158,11,.55),inset 0 1px 1px rgba(255,255,255,.18)",
                  display:"flex",alignItems:"center",gap:4,border:"1px solid #fbbf24",cursor:"pointer",flexShrink:0
                }}>🔬 RESEARCHER</div>
              )}
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
              {/* PHN Forum notification bell — only visible for PHN students */}
              {(()=>{const me=ls("nv-users",[]).find(u=>u.username===currentUser);const isPHN=me?.class&&(me.class.toLowerCase().includes("phn")||me.class.toLowerCase().includes("public"));return isPHN||me?.role==="admin";})()&&(
                <div className="icon-btn" title="PHN Class Forum" style={{position:"relative"}}
                  onClick={()=>{ setUnreadPHNForum(0); switchToNursing(); }}>
                  🌍
                  {unreadPHNForum > 0 && <span style={{position:"absolute",top:-4,right:-4,background:"#22c55e",color:"white",borderRadius:"50%",width:16,height:16,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontWeight:900,animation:"pulse 1.2s infinite"}}>{unreadPHNForum>9?"9+":unreadPHNForum}</span>}
                </div>
              )}
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
      {/* ── Incoming call banner ── */}
      {incomingCall && (
        <IncomingCallBanner
          call={incomingCall}
          onAnswer={() => {
            const c = incomingCall;
            setIncomingCall(null);
            setActiveCall({ type: c.callType, toUser: c.fromUser, toName: c.callerName, toAvatar: c.callerAvatar });
            setActiveNav("messages");
            clearCallSignal(currentUser, c.roomId);
          }}
          onDecline={() => {
            const c = incomingCall;
            setIncomingCall(null);
            clearCallSignal(currentUser, c.roomId);
            // Tell the caller's snapshot watcher that the call was declined
            _loadFirebase().then(ok => {
              if (!ok) return;
              try {
                _gvcSigDoc(c.roomId, c.fromUser, currentUser)
                  .set({ declined: true }, { merge: true });
              } catch(_) {}
            });
          }}
        />
      )}
      {/* ── Active DM call (answered from banner / notification) ── */}
      {activeCall && (
        <DmCallModal
          callType={activeCall.type}
          fromUser={currentUser}
          toUser={activeCall.toUser}
          toName={activeCall.toName}
          toAvatar={activeCall.toAvatar}
          isInitiator={false}
          onClose={() => setActiveCall(null)}
        />
      )}
      {showPinSetup && (
        <PinSetupModal
          email={currentUser}
          toast={toast}
          onDone={() => setShowPinSetup(false)}
          onSkip={() => {
            try { localStorage.setItem("nv-pin-skipped-" + currentUser.replace(/[^a-z0-9]/gi,"_"), "1"); } catch{}
            setShowPinSetup(false);
          }}
        />
      )}
    </>
  );
}
