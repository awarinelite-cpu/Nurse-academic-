// ─────────────────────────────────────────────────────────────────────
// BACKEND / FIRESTORE SYNC LAYER
// All Firebase Firestore reads/writes, chunked storage, real-time
// listeners (class chat, DMs, study groups, research club, research
// requests, timetable, assignments, attendance, CBT exams/results/
// violations), per-user private data sync, and the shared-doc hydration
// + real-time listener that powers useSharedData().
// ─────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { FIREBASE_CONFIG } from "../config/firebase";
import { compatDb } from "../config/firestoreCompatShim";
import { ls, lsSet } from "../utils/storage";
import { DEFAULT_CLASSES, DEFAULT_DRUGS, DEFAULT_LABS, DEFAULT_PQ, DEFAULT_SKILLS, DEFAULT_ANNOUNCEMENTS } from "../data/defaults";

// ── Firebase SDK loader ──────────────────────────────────────────────
// Previously loaded firebase-compat from a CDN at runtime. Now the
// real npm `firebase` package is initialised once in firebaseClient.js
// at import time, and this just exposes the compat-shaped `_db` that
// the rest of this file's ~65 call sites already expect.
export let _db = null;           // Firestore instance (compat-shaped shim)
export let _fbReady = false;     // true once db is available
export let _fbReadyPromise = null;

export const _loadFirebase = () => {
  if (_fbReadyPromise) return _fbReadyPromise;
  _fbReadyPromise = new Promise((resolve) => {
    const cfg = FIREBASE_CONFIG;
    if (!cfg.apiKey || !cfg.projectId) {
      console.warn("[Firebase] Not configured — fill in FIREBASE_CONFIG in config/firebase.js");
      resolve(false); return;
    }
    try {
      _db = compatDb;
      _fbReady = true;
      console.log("[Firebase] Connected ✅ (npm modular SDK)");
      resolve(true);
    } catch (e) {
      console.error("[Firebase] Init failed:", e.message);
      resolve(false);
    }
  });
  return _fbReadyPromise;
};

// ── Core read/write using a single "shared" document ─────────────────
// All shared app data lives in:   collection("nv") / doc("shared")
// All exam results live in:       collection("nv") / doc("exams")
// All essay subs live in:         collection("nv") / doc("essays")
// Password resets:                collection("nv") / doc("resets")
//
// LARGE QUESTION STORES (up to 250 Qs) use CHUNKED MULTI-DOC storage:
//   dailyMock    → nv/mock_meta  + nv/mock_chunk_0 … mock_chunk_N
//   nursingExams → nv/nex_meta   + nv/nex_chunk_0  … nex_chunk_N
//   ncArchive    → nv/arc_meta   + nv/arc_chunk_0  … arc_chunk_N
// Each chunk holds ≤60 items so every doc stays well under Firestore's 1 MB limit.

export const _DOC_SHARED = "shared";
export const _DOC_EXAMS  = "exams";
export const _DOC_ESSAYS = "essays";
export const _DOC_RESETS = "resets";

// ── Chunked array save/load ───────────────────────────────────────────
// Stores a JS array across multiple Firestore docs to bypass the 1 MB limit.
export const _CHUNK = 60; // items per chunk doc

export const _chunkSave = async (prefix, items, extraMeta) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    const chunks = [];
    for (let i = 0; i < items.length; i += _CHUNK) chunks.push(items.slice(i, i + _CHUNK));
    // Write all chunk docs in parallel
    await Promise.all(chunks.map((ch, ci) =>
      _db.collection("nv").doc(`${prefix}_chunk_${ci}`).set({ items: ch })
    ));
    // Delete stale chunks from a previous larger upload
    const metaSnap = await _db.collection("nv").doc(`${prefix}_meta`).get().catch(()=>null);
    const prevCount = metaSnap?.exists ? (metaSnap.data().chunks || 0) : 0;
    if (prevCount > chunks.length) {
      await Promise.all(
        Array.from({length: prevCount - chunks.length}, (_, i) =>
          _db.collection("nv").doc(`${prefix}_chunk_${chunks.length + i}`).delete()
        )
      );
    }
    await _db.collection("nv").doc(`${prefix}_meta`).set({
      chunks: chunks.length, total: items.length, updatedAt: Date.now(), ...(extraMeta||{})
    });
    return true;
  } catch(e) { console.error("[Firebase] chunkSave failed:", prefix, e.message); return false; }
};

export const _chunkLoad = async (prefix) => {
  const ready = await _loadFirebase(); if (!ready) return null;
  try {
    const metaSnap = await _db.collection("nv").doc(`${prefix}_meta`).get();
    if (!metaSnap.exists) return null;
    const { chunks = 0, ...meta } = metaSnap.data();
    if (chunks === 0) return { items: [], meta };
    const snaps = await Promise.all(
      Array.from({length: chunks}, (_, ci) =>
        _db.collection("nv").doc(`${prefix}_chunk_${ci}`).get()
      )
    );
    const items = snaps.flatMap(s => s.exists ? (s.data().items || []) : []);
    return { items, meta };
  } catch(e) { console.error("[Firebase] chunkLoad failed:", prefix, e.message); return null; }
};

// ── JSON-string chunked save/load (for complex nested objects) ────────
export const _PIECE = 800000; // 800 KB per Firestore doc (well under 1 MB limit)
export const _jsonChunkSave = async (prefix, obj) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    const json = JSON.stringify(obj);
    const pieces = [];
    for (let i = 0; i < json.length; i += _PIECE) pieces.push(json.slice(i, i + _PIECE));
    await Promise.all(pieces.map((p, pi) =>
      _db.collection("nv").doc(`${prefix}_chunk_${pi}`).set({ part: p })
    ));
    const metaSnap = await _db.collection("nv").doc(`${prefix}_meta`).get().catch(()=>null);
    const prev = metaSnap?.exists ? (metaSnap.data().pieces || 0) : 0;
    if (prev > pieces.length) {
      await Promise.all(
        Array.from({length: prev - pieces.length}, (_,i) =>
          _db.collection("nv").doc(`${prefix}_chunk_${pieces.length+i}`).delete()
        )
      );
    }
    await _db.collection("nv").doc(`${prefix}_meta`).set({ pieces: pieces.length, updatedAt: Date.now() });
    return true;
  } catch(e) { console.error("[Firebase] jsonChunkSave failed:", prefix, e.message); return false; }
};
export const _jsonChunkLoad = async (prefix) => {
  const ready = await _loadFirebase(); if (!ready) return null;
  try {
    const metaSnap = await _db.collection("nv").doc(`${prefix}_meta`).get();
    if (!metaSnap.exists) return null;
    const { pieces = 0 } = metaSnap.data();
    if (pieces === 0) return {};
    const snaps = await Promise.all(
      Array.from({length: pieces}, (_, pi) =>
        _db.collection("nv").doc(`${prefix}_chunk_${pi}`).get()
      )
    );
    return JSON.parse(snaps.map(s => s.exists ? (s.data().part||"") : "").join(""));
  } catch(e) { console.error("[Firebase] jsonChunkLoad failed:", prefix, e.message); return null; }
};

// Named helpers used throughout the app
export const mockChunkSave    = (pool, meta) => _chunkSave("mock", pool, meta);
export const mockChunkLoad    = ()           => _chunkLoad("mock");
export const archiveChunkSave = (entries)    => _chunkSave("arc", entries);
export const archiveChunkLoad = ()           => _chunkLoad("arc");
export const nursingChunkSave = (data)       => _jsonChunkSave("nex", data);
export const nursingChunkLoad = ()           => _jsonChunkLoad("nex");

// In-memory cache to reduce Firestore reads
export const _cache = {};
export const _cacheTime = {};
export const CACHE_TTL = 15000; // 15 seconds

export const _getDoc = async (docId) => {
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

export const _setDocField = async (docId, field, val) => {
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

export const _setDocFields = async (docId, fields) => {
  const ready = await _loadFirebase();
  if (!ready) return false;
  try {
    await _db.collection("nv").doc(docId).set(fields, { merge: true });
    _cache[docId] = { ...(_cache[docId] || {}), ...fields };
    _cacheTime[docId] = Date.now();
    return true;
  } catch (e) { console.error("[Firebase] setDocFields failed:", docId, e.message); return false; }
};

// ── Direct folder overwrite (bypasses merge — ensures deleted keys are gone) ─
// Uses Firestore .update() so only the "folders" field is touched, and the
// exact JS object (with removed keys) becomes the new Firestore value.
export const saveFoldersToBackend = async (foldersObj) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    // .update() replaces the field value exactly — no merge, no phantom keys.
    await _db.collection("nv").doc(_DOC_SHARED).update({ folders: foldersObj });
    // Keep cache in sync
    if (!_cache[_DOC_SHARED]) _cache[_DOC_SHARED] = {};
    _cache[_DOC_SHARED].folders = foldersObj;
    _cacheTime[_DOC_SHARED] = Date.now();
    return true;
  } catch (e) {
    console.error("[saveFoldersToBackend] failed:", e.message);
    return false;
  }
};

// ── Shared data read/write ────────────────────────────────────────────
export const bsGet = async (key) => {
  const doc = await _getDoc(_DOC_SHARED);
  return doc ? (doc[key] ?? null) : null;
};
export const bsSet = async (key, val) => _setDocField(_DOC_SHARED, key, val);

// ── Exam/essay/reset helpers ──────────────────────────────────────────
export const examBsGet = async (key) => {
  // Try exams doc first, fallback to shared
  const doc = await _getDoc(_DOC_EXAMS);
  if (doc && doc[key] !== undefined) return doc[key];
  return null;
};
export const examBsSet = async (key, val) => _setDocField(_DOC_EXAMS, key, val);

// ── CLASS GROUP CHAT HELPERS (Firestore real-time) ────────────────────
// Structure:
//   Firestore collection "class_chats/{classId}"           – room metadata
//   Firestore collection "class_chats/{classId}/msgs/{id}" – messages
// Msg doc fields: { id, from, text, sentAt, type, fileData?, fileName?, fileType?, fileSize?, duration? }

export const gcSend = async (classId, fromUser, payload) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    const msgId = "gc_" + Date.now() + "_" + Math.random().toString(36).slice(2,7);
    const msg = {
      id: msgId, from: fromUser, sentAt: Date.now(),
      type: payload.type || "text",
      text: payload.text || "",
      ...(payload.fileData && { fileData: payload.fileData }),
      ...(payload.fileName && { fileName: payload.fileName }),
      ...(payload.fileType && { fileType: payload.fileType }),
      ...(payload.fileSize && { fileSize: payload.fileSize }),
      ...(payload.duration && { duration: payload.duration }),
    };
    await _db.collection("class_chats").doc(classId).collection("msgs").doc(msgId).set(msg);
    const preview = payload.type === "file" ? ("📎 " + (payload.fileName||"File"))
                  : payload.type === "voice" ? "🎤 Voice note"
                  : (payload.text||"").slice(0,100);
    await _db.collection("class_chats").doc(classId).set({
      classId, lastMsg: preview, lastFrom: fromUser, lastAt: Date.now(),
    }, { merge: true });
    // ── Push notification to all class members (fire-and-forget) ──
    try {
      const allUsers = (() => { try { return JSON.parse(localStorage.getItem("nv-users")||"[]"); } catch{return [];} })();
      const members  = allUsers.filter(u => u.class === classId && u.username !== fromUser);
      const senderName = fromUser.split("@")[0];
      const notifPromises = members.map(u => pushUserNotif(u.username, {
        id: "gc_" + Date.now() + "_" + Math.random().toString(36).slice(2,5),
        type: "group_chat",
        title: "🏫 Class chat — " + senderName,
        body: preview,
        from: fromUser,
        classId,
        ts: Date.now(),
        read: false,
      }));
      await Promise.allSettled(notifPromises);
    } catch(_) {}
    return true;
  } catch(e) { console.error("[GC] send failed:", e.message); throw e; }
};

// _mkSub: waits for Firebase then attaches a real-time listener.
// Fixes the race condition where _db is null at component mount time.
export const _mkSub = (attachFn) => {
  let unsub = () => {};
  let cancelled = false;
  _loadFirebase().then(ready => {
    if (!ready || cancelled || !_db) return;
    unsub = attachFn(_db) || (() => {});
  });
  return () => { cancelled = true; unsub(); };
};

export const gcSubscribe = (classId, onMsgs) =>
  _mkSub(db => db.collection("class_chats").doc(classId).collection("msgs")
    .orderBy("sentAt", "asc")
    .onSnapshot(snap => onMsgs(snap.docs.map(d => d.data())), () => {}));

export const gcSubscribeRooms = (classIds, onRooms) => {
  if (!classIds.length) { onRooms([]); return () => {}; }
  return _mkSub(db => {
    const results = {};
    const unsubs = classIds.map(cid =>
      db.collection("class_chats").doc(cid).onSnapshot(snap => {
        results[cid] = snap.exists ? { id: snap.id, ...snap.data() } : { id: cid, classId: cid, lastAt: 0 };
        onRooms(Object.values(results));
      }, () => {})
    );
    return () => unsubs.forEach(u => u());
  });
};

// ── DIRECT-MESSAGE HELPERS (Firestore real-time) ──────────────────────
// Structure:
//   Firestore collection "dm_convs/{convId}"           – conversation metadata
//   Firestore collection "dm_convs/{convId}/msgs/{id}" – messages
// convId  = sorted emails joined with "||"  e.g. "alice@x.com||bob@x.com"
// Conv doc fields: { participants[], lastMsg, lastFrom, lastAt, unread_{safeEmail}: bool }
// Msg  doc fields: { id, from, to, text, sentAt, read }

export const _safeKey = (email) => email.replace(/[^a-zA-Z0-9]/g, "_");
export const _convId  = (a, b) => [a, b].sort().join("||");

export const dmSend = async (fromUser, toUser, payload) => {
  // payload: { text?, type?, fileData?, fileName?, fileType?, fileSize?, duration? }
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    const cid   = _convId(fromUser, toUser);
    const msgId = "m_" + Date.now() + "_" + Math.random().toString(36).slice(2,7);
    const msg   = {
      id: msgId, from: fromUser, to: toUser, sentAt: Date.now(), read: false,
      type: payload.type || "text",
      text: payload.text || "",
      ...(payload.fileData  && { fileData:  payload.fileData }),
      ...(payload.fileName  && { fileName:  payload.fileName }),
      ...(payload.fileType  && { fileType:  payload.fileType }),
      ...(payload.fileSize  && { fileSize:  payload.fileSize }),
      ...(payload.duration  && { duration:  payload.duration }),
    };
    await _db.collection("dm_convs").doc(cid).collection("msgs").doc(msgId).set(msg);
    const preview = payload.type === "file" ? ("📎 " + (payload.fileName||"File"))
                  : payload.type === "voice" ? "🎤 Voice note"
                  : (payload.text||"").slice(0,100);
    await _db.collection("dm_convs").doc(cid).set({
      participants: [fromUser, toUser],
      lastMsg:  preview,
      lastFrom: fromUser,
      lastAt:   Date.now(),
      ["unread_" + _safeKey(toUser)]: true,
    }, { merge: true });
    // ── Push real-time notification to recipient ──
    const senderName = fromUser.split("@")[0];
    await pushUserNotif(toUser, {
      id: "dm_" + Date.now(),
      type: "dm",
      title: "💬 Message from " + senderName,
      body: preview,
      from: fromUser,
      ts: Date.now(),
      read: false,
    });
    return true;
  } catch(e) { console.error("[DM] send failed:", e.message); return false; }
};

export const gcTestWrite = async (classId) => {
  const ready = await _loadFirebase(); if (!ready) return "Firebase not connected";
  try {
    const testRef = _db.collection("class_chats").doc(classId).collection("msgs").doc("_test_ping_");
    await testRef.set({ _test: true, ts: Date.now() });
    await testRef.delete();
    return null; // success
  } catch(e) {
    return e.message; // return the error message
  }
};

// ── INCOMING CALL SIGNAL ─────────────────────────────────────────────────
// Stores a pending call signal for the callee in Firestore.
// call_signals/{safeToUser}  — one doc per user, overwritten on each new call.
// Fields: { fromUser, toUser, callType, callerName, callerAvatar, convId, ts, status }
export const writeCallSignal = async (fromUser, toUser, callType, callerName, callerAvatar, roomId) => {
  const ready = await _loadFirebase(); if (!ready) return;
  try {
    const key = _safeKey(toUser);
    await _db.collection("call_signals").doc(key).set({
      fromUser, toUser, callType, callerName, callerAvatar, roomId,
      ts: Date.now(), status: "ringing",
    });
  } catch(e) { console.warn("[callSignal] write failed:", e.message); }
};

export const clearCallSignal = async (toUser, roomId) => {
  const ready = await _loadFirebase(); if (!ready) return;
  try {
    const key = _safeKey(toUser);
    const payload = { status: "ended", ts: Date.now() };
    if (roomId) payload.roomId = roomId;
    await _db.collection("call_signals").doc(key).set(payload, { merge: true });
  } catch(e) {}
};
export const subscribeCallSignal = (username, onSignal) => {
  if (!username) return () => {};
  return _mkSub(db =>
    db.collection("call_signals").doc(_safeKey(username)).onSnapshot(snap => {
      if (!snap.exists) return;
      const d = snap.data();
      onSignal(d);
    }, () => {})
  );
};

export const dmMarkRead = async (me, other) => {
  const ready = await _loadFirebase(); if (!ready) return;
  try {
    const cid = _convId(me, other);
    await _db.collection("dm_convs").doc(cid).set(
      { ["unread_" + _safeKey(me)]: false }, { merge: true }
    );
    const snap = await _db.collection("dm_convs").doc(cid).collection("msgs")
      .where("to","==",me).where("read","==",false).get().catch(()=>null);
    if (snap && !snap.empty) {
      const batch = _db.batch();
      snap.docs.forEach(d => batch.update(d.ref, { read:true }));
      await batch.commit();
    }
  } catch(e) {}
};

export const dmSubscribeConv = (me, other, onMsgs) =>
  _mkSub(db => { const cid = _convId(me, other); return db.collection("dm_convs").doc(cid).collection("msgs").orderBy("sentAt","asc").onSnapshot(snap => onMsgs(snap.docs.map(d => d.data())), () => {}); });

export const dmSubscribeInbox = (me, onConvs) =>
  _mkSub(db => db.collection("dm_convs").where("participants","array-contains",me).orderBy("lastAt","desc").onSnapshot(snap => onConvs(snap.docs.map(d => ({id:d.id,...d.data()}))), () => {}));

// ── VOICE CALL SIGNALING (WebRTC via Firestore) ───────────────────────

// ── STUDY GROUP HELPERS ────────────────────────────────────────────────
export const sgSend = async (groupId, from, text, type="text", extra={}) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    const msgId = "sg_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
    const msg = { id:msgId, from, text, type, sentAt:Date.now(), ...extra };
    await _db.collection("study_groups").doc(groupId).collection("msgs").doc(msgId).set(msg);
    await _db.collection("study_groups").doc(groupId).set({ lastMsg:text.slice(0,80), lastFrom:from, lastAt:Date.now() }, { merge:true });
    return true;
  } catch(e) { return false; }
};
export const sgSubscribe = (groupId, onMsgs) =>
  _mkSub(db => db.collection("study_groups").doc(groupId).collection("msgs").orderBy("sentAt","asc").onSnapshot(snap => onMsgs(snap.docs.map(d=>d.data())), () => {}));
export const sgCreateGroup = async (group) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try { await _db.collection("study_groups").doc(group.id).set(group, { merge:true }); return true; }
  catch(e) { return false; }
};
export const sgSubscribeGroups = (classId, onGroups) =>
  _mkSub(db => db.collection("study_groups").where("classId","==",classId).orderBy("lastAt","desc").onSnapshot(snap => onGroups(snap.docs.map(d=>({id:d.id,...d.data()}))), () => {}));

// ── RESEARCH CLUB HELPERS ─────────────────────────────────────────────
// Members stored in Firestore: nv/shared researchMembers: [username,...]
// Chat: collection "research_club/main/msgs/{id}"
export const rcSend = async (from, payload) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    const msgId = "rc_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
    const msg = { id:msgId, from, sentAt:Date.now(), ...payload };
    await _db.collection("research_club").doc("main").collection("msgs").doc(msgId).set(msg);
    await _db.collection("research_club").doc("main").set({ lastMsg: (payload.text||"📎 File").slice(0,80), lastFrom: from, lastAt: Date.now() }, { merge:true });
    return true;
  } catch(e) { return false; }
};
export const rcSubscribe = (onMsgs) =>
  _mkSub(db => db.collection("research_club").doc("main").collection("msgs").orderBy("sentAt","asc").onSnapshot(snap => onMsgs(snap.docs.map(d=>d.data())), () => {}));
export const rcGetMembers = async () => {
  const doc = await _getDoc(_DOC_SHARED);
  return doc ? (doc.researchMembers || []) : [];
};
export const rcSaveMembers = async (list) => _setDocField(_DOC_SHARED, "researchMembers", list);

// ── RESEARCH REQUEST HELPERS ──────────────────────────────────────────
// Requests stored in Firestore: collection("research_requests")/{requestId}
export const rrSave = async (req) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    await _db.collection("research_requests").doc(req.id).set(req, { merge:true });
    return true;
  } catch(e) { console.error("[RR] save failed:", e.message); return false; }
};
export const rrGetAll = async () => {
  const ready = await _loadFirebase(); if (!ready) return [];
  try {
    const snap = await _db.collection("research_requests").orderBy("createdAt","desc").get();
    return snap.docs.map(d => d.data());
  } catch(e) { return []; }
};
export const rrGetMine = async (username) => {
  const ready = await _loadFirebase(); if (!ready) return [];
  try {
    const snap = await _db.collection("research_requests").where("student","==",username).orderBy("createdAt","desc").get();
    return snap.docs.map(d => d.data());
  } catch(e) { return []; }
};
export const rrSubscribeAll = (onData) =>
  _mkSub(db => db.collection("research_requests").onSnapshot(
    snap => onData(snap.docs.map(d=>d.data()).sort((a,b)=>b.createdAt-a.createdAt)),
    err => { console.warn("[RR]",err.message); rrGetAll().then(onData); }
  ));
export const rrSubscribeMine = (username, onData) =>
  _mkSub(db => db.collection("research_requests").where("student","==",username).onSnapshot(
    snap => onData(snap.docs.map(d=>d.data()).sort((a,b)=>b.createdAt-a.createdAt)),
    err => { console.warn("[RR]",err.message); rrGetMine(username).then(onData); }
  ));

// ── TIMETABLE HELPERS ──────────────────────────────────────────────────
export const ttSave = async (classId, slots) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try { await _db.collection("timetables").doc(classId).set({ slots, updatedAt:Date.now() }); return true; }
  catch(e) { return false; }
};
export const ttLoad = async (classId) => {
  const ready = await _loadFirebase(); if (!ready) return [];
  try { const s = await _db.collection("timetables").doc(classId).get(); return s.exists ? (s.data().slots||[]) : []; }
  catch(e) { return []; }
};

// ── ASSIGNMENT HELPERS ─────────────────────────────────────────────────
export const asgSave = async (asgn) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try { await _db.collection("assignments").doc(asgn.id).set(asgn, { merge:true }); return true; }
  catch(e) { return false; }
};
export const asgSubscribe = (classId, onData) =>
  _mkSub(db => db.collection("assignments").where("classId","==",classId).orderBy("dueAt","asc").onSnapshot(snap => onData(snap.docs.map(d=>({id:d.id,...d.data()}))), () => {}));
// Course-scoped variant — same collection, filtered by courseId instead
// of classId. Assignment docs can carry either field (or both, though
// in practice a given assignment is one or the other).
export const asgSubscribeByCourse = (courseId, onData) =>
  _mkSub(db => db.collection("assignments").where("courseId","==",courseId).orderBy("dueAt","asc").onSnapshot(snap => onData(snap.docs.map(d=>({id:d.id,...d.data()}))), () => {}));
export const asgSubmit = async (asgnId, student, fileData, fileName) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    await _db.collection("assignments").doc(asgnId).collection("submissions").doc(_safeKey(student)).set({
      student, fileData, fileName, submittedAt:Date.now(), grade:null, feedback:""
    }, { merge:true });
    return true;
  } catch(e) { return false; }
};
export const asgLoadSubmissions = async (asgnId) => {
  const ready = await _loadFirebase(); if (!ready) return [];
  try {
    const snap = await _db.collection("assignments").doc(asgnId).collection("submissions").get();
    return snap.docs.map(d=>d.data());
  } catch(e) { return []; }
};
export const asgGrade = async (asgnId, student, grade, feedback) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    await _db.collection("assignments").doc(asgnId).collection("submissions").doc(_safeKey(student)).set({ grade, feedback, gradedAt:Date.now() }, { merge:true });
    return true;
  } catch(e) { return false; }
};
export const asgLoadMySubmission = async (asgnId, student) => {
  const ready = await _loadFirebase(); if (!ready) return null;
  try {
    const d = await _db.collection("assignments").doc(asgnId).collection("submissions").doc(_safeKey(student)).get();
    return d.exists ? d.data() : null;
  } catch(e) { return null; }
};

// ── ATTENDANCE HELPERS ─────────────────────────────────────────────────
export const attMark = async (classId, date, student, status) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    const docId = classId + "_" + date;
    await _db.collection("attendance").doc(docId).set({ [_safeKey(student)]: status }, { merge:true });
    return true;
  } catch(e) { return false; }
};
export const attLoad = async (classId, date) => {
  const ready = await _loadFirebase(); if (!ready) return {};
  try {
    const d = await _db.collection("attendance").doc(classId + "_" + date).get();
    return d.exists ? d.data() : {};
  } catch(e) { return {}; }
};
export const attLoadRange = async (classId, dates) => {
  const ready = await _loadFirebase(); if (!ready) return {};
  try {
    const results = {};
    await Promise.all(dates.map(async date => {
      const d = await _db.collection("attendance").doc(classId + "_" + date).get();
      results[date] = d.exists ? d.data() : {};
    }));
    return results;
  } catch(e) { return {}; }
};

// ── REACTIVE SYNC ─────────────────────────────────────────────────────
export const NV_SYNC_EVENT = "nv-sync";
export const dispatchSync = () => window.dispatchEvent(new CustomEvent(NV_SYNC_EVENT));

// Tracks the last time THIS device wrote handouts/folders to Firestore.
// Used to suppress the immediate local echo from onSnapshot without blocking
// genuine remote updates arriving from other devices.
export let _lastLocalHandoutWrite = 0;
export const LOCAL_ECHO_WINDOW_MS = 5000; // 5 s — ignore pending echoes within this window

export function useSharedData(lsKey, fallback) {
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
export const dbSet = async (lsKey, bsKey, val) => {
  lsSet(lsKey, val);
  dispatchSync();
  if (bsKey === "handouts" || bsKey === "folders") _lastLocalHandoutWrite = Date.now();
  const ok = await bsSet(bsKey, val);
  if (!ok) console.error("[dbSet] Firestore write failed for", bsKey);
  return ok;
};

export const dbLoad = async (lsKey, bsKey, fallback) => {
  try {
    const remote = await bsGet(bsKey);
    if (remote !== null && remote !== undefined) { lsSet(lsKey, remote); return remote; }
  } catch (e) { console.warn("[dbLoad] failed for", bsKey, e.message); }
  return ls(lsKey, fallback);
};

// ── Shared storage key map ────────────────────────────────────────────
export const SK = {
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
  ncCodes:       ["nv-nc-codes",      "ncCodes"],
  schoolPQ:      ["nv-school-pq",     "schoolPQ"],
  folders:       ["nv-folders",       "folders"],
  cbtExams:      ["nv-cbt-exams",     "cbtExams"],
  cbtResults:    ["nv-cbt-results",   "cbtResults"],
  pushNotifs:    ["nv-push-notifs",   "pushNotifs"],
};

export const saveShared = async (key, val, extraMeta) => {
  const [lk, bk] = SK[key];
  if (key === "dailyMock")    { lsSet(lk,val); dispatchSync(); return mockChunkSave(val, extraMeta||{}); }
  if (key === "nursingExams") { lsSet(lk,val); dispatchSync(); return nursingChunkSave(val); }
  if (key === "ncArchive")    { lsSet(lk,val); dispatchSync(); return archiveChunkSave(val); }
  return await dbSet(lk, bk, val);
};
export const loadShared = async (key, fallback) => {
  const [lk, bk] = SK[key];
  if (key === "dailyMock")    { try { const r=await mockChunkLoad();    if(r){lsSet(lk,r.items);return r.items;} } catch{} return ls(lk,fallback); }
  if (key === "nursingExams") { try { const r=await nursingChunkLoad(); if(r){lsSet(lk,r);return r;} }           catch{} return ls(lk,fallback); }
  if (key === "ncArchive")    { try { const r=await archiveChunkLoad(); if(r){lsSet(lk,r.items);return r.items;} } catch{} return ls(lk,fallback); }
  return dbLoad(lk, bk, fallback);
};

// ── Per-user private data (localStorage only) ─────────────────────────
export const uKey = (user, suffix) => `u:${user}:${suffix}`;
export let _currentUser = "";
export const setCurrentUserRef = (u) => { _currentUser = u; };
// ── Per-user private data key helper ─────────────────────────
export const _userPrivateKey = (username) => `upriv_${username.replace(/[^a-z0-9]/gi,"_")}`;

export const saveMyData = (suffix, lsKey, val) => {
  lsSet(lsKey, val);
  if (!_currentUser) return;
  // Notifications go to their own real-time doc
  if (suffix === "notifications") {
    const key = _notifKey(_currentUser);
    _loadFirebase().then(ready => {
      if (!ready) return;
      _db.collection("nv").doc("user_notifs")
        .set({ [key]: val }, { merge: true })
        .catch(e => console.warn("[saveMyData] notif sync failed:", e.message));
    });
    return;
  }
  // All other per-user data → nv/user_private (keyed by username+suffix)
  const docKey = _userPrivateKey(_currentUser);
  _loadFirebase().then(ready => {
    if (!ready) return;
    _db.collection("nv").doc("user_private")
      .set({ [`${docKey}_${suffix}`]: val }, { merge: true })
      .catch(e => console.warn("[saveMyData] private sync failed:", suffix, e.message));
  });
};

// Load all per-user private data from Firestore on login/device switch
export const syncUserPrivateDataFull = async (username) => {
  const ready = await _loadFirebase(); if (!ready) return;
  try {
    const docKey = _userPrivateKey(username);
    const snap = await _db.collection("nv").doc("user_private").get();
    if (snap.exists) {
      const data = snap.data();
      const suffixMap = {
        "results":       "nv-results",
        "gpa-courses":   "nv-gpa-courses",
        "gpa-semesters": "nv-gpa-semesters",
        "skills-done":   "nv-skills-done",
        "mcq-att":       `nv-exam-attempts-${username}`,
        "essay-att":     `nv-essay-att-${username}`,
        "flashcards":    "nv-flashcard-decks",
        "id-photo":      `nv-id-photo-${username}`,
      };
      Object.entries(suffixMap).forEach(([suffix, lsKey]) => {
        const remote = data[`${docKey}_${suffix}`];
        if (remote !== undefined && remote !== null) lsSet(lsKey, remote);
      });
    }
    // Hydrate rc-member badge from Firestore researchMembers list
    const sharedSnap = await _db.collection("nv").doc("shared").get().catch(() => null);
    if (sharedSnap?.exists) {
      const members = sharedSnap.data().researchMembers || [];
      if (members.includes(username)) {
        try { localStorage.setItem("rc-member-" + username.replace(/[^a-z0-9]/gi,"_"), "1"); } catch {}
      }
    }
    dispatchSync();
  } catch(e) { console.warn("[syncUserPrivateDataFull] failed:", e.message); }
};

export const syncUserPrivateData = async (username) => {
  // Pull latest notifications from Firestore on login
  const ready = await _loadFirebase(); if (!ready) return;
  try {
    const snap = await _db.collection("nv").doc("user_notifs").get();
    if (!snap.exists) return;
    const key = _notifKey(username);
    const remote = snap.data()[key] || [];
    if (remote.length > 0) {
      const local = ls("nv-notifications", []);
      const remoteIds = new Set(remote.map(n => n.id));
      const localOnly = local.filter(n => !remoteIds.has(n.id));
      const merged = [...remote, ...localOnly].sort((a,b) => (b.ts||0) - (a.ts||0));
      lsSet("nv-notifications", merged);
      dispatchSync();
    }
  } catch(e) { console.warn("[syncUserPrivateData] failed:", e.message); }
  // Sync all other per-user private data (results, GPA, skills, flashcards, photo, rc-member)
  await syncUserPrivateDataFull(username);
};

// ── Essay submissions ─────────────────────────────────────────────────
export const saveEssaySubmissionToBackend = async (studentEmail, bankId, data) => {
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

export const saveManualGradeToBackend = async (studentEmail, bankId, gradeData) => {
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
    // Mirror grade into student local storage and Firestore user_private
    const attKey = `nv-essay-att-${studentEmail}`;
    const att    = ls(attKey, {});
    att[String(bankId)] = { ...att[String(bankId)], manualGrade: gradeData, gradedDate: new Date().toLocaleDateString() };
    lsSet(attKey, att);
    // Push to student's user_private doc so their other devices see the grade immediately
    const _studentDocKey = _userPrivateKey(studentEmail);
    _db.collection("nv").doc("user_private")
      .set({ [`${_studentDocKey}_essay-att`]: att }, { merge: true })
      .catch(e => console.warn("[grade mirror sync] failed:", e.message));
    return updated;
  } catch (e) { console.warn("[saveManualGrade] failed:", e.message); return null; }
};

// ── CBT Exam Firestore helpers ─────────────────────────────────────────
// CBT exams live in: collection("nv") / doc("cbtExams")
// CBT results live in: collection("nv") / doc("cbtResults")
export const _DOC_CBT_EXAMS   = "cbtExams";
export const _DOC_CBT_RESULTS = "cbtResults";

export const cbtExamsGet = async () => {
  const doc = await _getDoc(_DOC_CBT_EXAMS);
  return doc ? (doc.list || []) : [];
};
export const cbtExamsSave = async (list) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    await _db.collection("nv").doc(_DOC_CBT_EXAMS).set({ list }, { merge: false });
    if (!_cache[_DOC_CBT_EXAMS]) _cache[_DOC_CBT_EXAMS] = {};
    _cache[_DOC_CBT_EXAMS].list = list;
    _cacheTime[_DOC_CBT_EXAMS] = Date.now();
    return true;
  } catch(e){ console.error("[CBT] save exams failed:", e.message); return false; }
};

export const cbtResultsGet = async () => {
  const doc = await _getDoc(_DOC_CBT_RESULTS);
  return doc ? (doc.list || []) : [];
};
export const cbtResultsSave = async (list) => {
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
export const subscribeCbtExams = (cb) => {
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

export const subscribeCbtResults = (cb) => {
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
export const _DOC_CBT_VIOLATIONS = "cbtViolations";
export const _DOC_CBT_DEVICES    = "cbtDevices";   // { examId_student: { ip, fingerprint, ua, student, examId, ts } }

export const cbtViolationsSave = async (list) => {
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
export const cbtDevicesGet = async () => {
  const doc = await _getDoc(_DOC_CBT_DEVICES);
  return doc ? (doc.map || {}) : {};
};
export const cbtDevicesSave = async (map) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    await _db.collection("nv").doc(_DOC_CBT_DEVICES).set({ map }, { merge: false });
    return true;
  } catch(e){ return false; }
};

export const cbtViolationsGet = async () => {
  const doc = await _getDoc(_DOC_CBT_VIOLATIONS);
  return doc ? (doc.list || []) : [];
};

export const subscribeCbtViolations = (cb) => {
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

export let _storageHealthy = null;
export const checkStorageHealth = async () => {
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
export const hydrateFromBackend = async () => {
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
      if (["dailyMock","nursingExams","ncArchive"].includes(key)) return; // loaded from chunked docs below
      const remote = doc[bk];
      if (remote !== undefined && remote !== null) lsSet(lsKey, remote);
      else if (!ls(lsKey, null)) lsSet(lsKey, defaults[key] || []);
    });
    // Load large NC datasets from their own chunked documents
    try { const r=await mockChunkLoad();    if(r){ lsSet("nv-daily-mock",r.items); if(r.meta?.mockTitle) lsSet("nv-daily-mock-title",r.meta.mockTitle); } } catch(e){ console.warn("[Sync] mock chunk load:",e.message); }
    try { const r=await nursingChunkLoad(); if(r){ lsSet("nv-nursing-exams",r); } }           catch(e){ console.warn("[Sync] nursing chunk load:",e.message); }
    try { const r=await archiveChunkLoad(); if(r){ lsSet("nv-nc-archive",r.items); } }         catch(e){ console.warn("[Sync] archive chunk load:",e.message); }
    dispatchSync();
    console.log("[Sync] Hydrated from Firestore ✅");
  } catch (e) { console.warn("[Sync] Hydration failed:", e.message); }
};

// ── REAL-TIME SHARED DOC LISTENER ────────────────────────────────────
// Replaces the 60-second polling interval.
// onSnapshot fires within ~1s of any write from any device.
export const subscribeSharedDoc = (onUpdate) =>
  _mkSub(db =>
    db.collection("nv").doc(_DOC_SHARED).onSnapshot(snap => {
      if (!snap.exists) return;
      const doc = snap.data();
      // Suppress the immediate local echo for handouts/folders: Firestore fires
      // onSnapshot on the writing device before the server confirms the write
      // (hasPendingWrites: true). We only skip the update if this device wrote
      // handouts/folders very recently (within LOCAL_ECHO_WINDOW_MS) AND the
      // snapshot still has pending writes.  Snapshots arriving from OTHER devices
      // always have hasPendingWrites: false, so they are never skipped.
      const isPending = snap.metadata && snap.metadata.hasPendingWrites;
      const isLocalEcho = isPending && (Date.now() - _lastLocalHandoutWrite < LOCAL_ECHO_WINDOW_MS);
      const defaults = {
        users:         [{username:"admin@gmail.com",password:"admin123",role:"admin",class:"",joined:"System"}],
        classes:       DEFAULT_CLASSES, drugs: DEFAULT_DRUGS, labs: DEFAULT_LABS,
        pq:            DEFAULT_PQ,      skills: DEFAULT_SKILLS, announcements: DEFAULT_ANNOUNCEMENTS,
        handouts:      [],  essayBanks: [], nursingExams: {general:[],midwifery:[],publichealth:[]},
        schoolPQ:      {},  folders:    {}, schoolExams:  [],
      };
      Object.entries(SK).forEach(([key, [lsKey, bk]]) => {
        if (["dailyMock","nursingExams","ncArchive"].includes(key)) return;
        // Skip folders & handouts only when this is a local pending-write echo
        // (i.e. this device just wrote them). Remote updates from other devices
        // always arrive with hasPendingWrites: false and are never skipped.
        if (isLocalEcho && (key === "folders" || key === "handouts")) return;
        const remote = doc[bk];
        if (remote !== undefined && remote !== null) lsSet(lsKey, remote);
        else if (!ls(lsKey, null)) lsSet(lsKey, defaults[key] || []);
      });
      // Update in-memory cache so next _getDoc call is instant
      _cache[_DOC_SHARED] = doc;
      _cacheTime[_DOC_SHARED] = Date.now();
      dispatchSync();
      if (onUpdate) onUpdate();
    }, err => console.warn("[RT-Shared] snapshot error:", err.message))
  );

// ── REAL-TIME PER-USER NOTIFICATIONS LISTENER ─────────────────────
// Stores user notifications in Firestore: nv/user_notifs (field per user)
// Written on handout-publish / announcement / any server push.
// Fires within ~1s on all devices that user is signed in on.
export const _notifKey = (username) => `notifs_${username.replace(/[^a-z0-9]/gi,"_")}`;

export const pushUserNotif = async (username, notif) => {
  const ready = await _loadFirebase(); if (!ready) return;
  try {
    const key = _notifKey(username);
    const snap = await _db.collection("nv").doc("user_notifs").get().catch(() => null);
    const existing = snap?.exists ? (snap.data()[key] || []) : [];
    const updated = [notif, ...existing].slice(0, 200); // keep latest 200
    await _db.collection("nv").doc("user_notifs").set({ [key]: updated }, { merge: true });
  } catch(e) { console.warn("[pushUserNotif] failed:", e.message); }
};

export const subscribeUserNotifications = (username, onNotifs) => {
  if (!username) return () => {};
  return _mkSub(db =>
    db.collection("nv").doc("user_notifs").onSnapshot(snap => {
      if (!snap.exists) return;
      const key = _notifKey(username);
      const notifs = snap.data()[key] || [];
      // Merge with any local-only notifs not yet in Firestore
      const localNotifs = ls("nv-notifications", []);
      const remoteIds = new Set(notifs.map(n => n.id));
      const localOnly = localNotifs.filter(n => !remoteIds.has(n.id));
      const merged = [...notifs, ...localOnly].sort((a,b) => (b.ts||0) - (a.ts||0));
      lsSet("nv-notifications", merged);
      dispatchSync();
      if (onNotifs) onNotifs(merged);
    }, err => console.warn("[RT-Notifs] snapshot error:", err.message))
  );
};
