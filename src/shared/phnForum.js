import { _DOC_SHARED, _db, _getDoc, _loadFirebase, _mkSub, _setDocField } from "../services/backend";

export const PHN_FORUM_ID = "phn_class_forum";

// Helper: load/save the approved-lecturers list for the PHN forum

export const phnGetLecturers = async () => {
  const doc = await _getDoc(_DOC_SHARED);
  return doc ? (doc.phnForumLecturers || []) : [];
};

export const phnSaveLecturers = async (list) => _setDocField(_DOC_SHARED, "phnForumLecturers", list);

// ── PHN Folder Helpers (Firestore collection "phn_folder") ────────────
// Each doc: { id, fileName, fileType, fileSize, fileData, uploadedBy, uploadedAt, source }
// source: "forum" (auto-saved from chat) | "direct" (manually uploaded)

export const phnFolderAdd = async (entry) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try {
    await _db.collection("phn_folder").doc(entry.id).set(entry);
    return true;
  } catch(e) { console.error("[PHNFolder] add failed:", e.message); return false; }
};

export const phnFolderDelete = async (id) => {
  const ready = await _loadFirebase(); if (!ready) return false;
  try { await _db.collection("phn_folder").doc(id).delete(); return true; }
  catch(e) { return false; }
};

export const phnFolderSubscribe = (onFiles) =>
  _mkSub(db => db.collection("phn_folder").orderBy("uploadedAt","desc").onSnapshot(snap => onFiles(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => {}));

// ── PHN Folder Modal ──────────────────────────────────────────────────
