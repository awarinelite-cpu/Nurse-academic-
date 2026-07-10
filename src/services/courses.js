// ─── COURSES SERVICE ───────────────────────────────────────────────────
//
// Unlike the legacy nv/* shared-blob pattern, courses/modules/lessons
// use real per-record Firestore documents — this is what the
// firestore.rules course-model section was written against. Uses the
// modular SDK directly (not the compat shim) since this is new code.

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp,
} from "firebase/firestore";
import { db } from "../config/firebaseClient";

// ── Lecturers (for instructor-assignment dropdowns) ─────────────────
export async function listLecturers() {
  const q = query(collection(db, "users"), where("role", "==", "lecturer"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// ── Courses ──────────────────────────────────────────────────────────
export async function createCourse({ title, description, instructorId, instructorName, price, status }) {
  const ref = await addDoc(collection(db, "courses"), {
    title: title.trim(),
    description: description || "",
    instructorId: instructorId || null,
    instructorName: instructorName || "",
    price: Number(price) || 0,
    status: status || "draft", // draft | published | archived
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateCourse(courseId, patch) {
  await updateDoc(doc(db, "courses", courseId), { ...patch, updatedAt: serverTimestamp() });
}

export async function deleteCourse(courseId) {
  await deleteDoc(doc(db, "courses", courseId));
}

export async function getCourse(courseId) {
  const snap = await getDoc(doc(db, "courses", courseId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// One-off fetch — use for admin lists where a live subscription isn't needed.
export async function listCourses() {
  const snap = await getDocs(collection(db, "courses"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Live subscription — use for the student-facing catalog.
export function subscribeCourses(onData, { publishedOnly = false } = {}) {
  const q = publishedOnly
    ? query(collection(db, "courses"), where("status", "==", "published"))
    : collection(db, "courses");
  return onSnapshot(q, snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ── Modules ──────────────────────────────────────────────────────────
export async function createModule(courseId, { title, order }) {
  const ref = await addDoc(collection(db, "courses", courseId, "modules"), {
    title: title.trim(),
    order: Number(order) || 0,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateModule(courseId, moduleId, patch) {
  await updateDoc(doc(db, "courses", courseId, "modules", moduleId), patch);
}

export async function deleteModule(courseId, moduleId) {
  await deleteDoc(doc(db, "courses", courseId, "modules", moduleId));
}

export async function listModules(courseId) {
  const q = query(collection(db, "courses", courseId, "modules"), orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function subscribeModules(courseId, onData) {
  const q = query(collection(db, "courses", courseId, "modules"), orderBy("order", "asc"));
  return onSnapshot(q, snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ── Lessons ──────────────────────────────────────────────────────────
// type: "video" | "reading" | "live"
// content shape varies by type:
//   video  -> { videoUrl }
//   reading-> { textBody }
//   live   -> { liveLink, scheduledAt }
export async function createLesson(courseId, moduleId, { title, order, type, content }) {
  const ref = await addDoc(collection(db, "courses", courseId, "modules", moduleId, "lessons"), {
    title: title.trim(),
    order: Number(order) || 0,
    type: type || "reading",
    content: content || {},
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateLesson(courseId, moduleId, lessonId, patch) {
  await updateDoc(doc(db, "courses", courseId, "modules", moduleId, "lessons", lessonId), patch);
}

export async function deleteLesson(courseId, moduleId, lessonId) {
  await deleteDoc(doc(db, "courses", courseId, "modules", moduleId, "lessons", lessonId));
}

export async function listLessons(courseId, moduleId) {
  const q = query(collection(db, "courses", courseId, "modules", moduleId, "lessons"), orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function subscribeLessons(courseId, moduleId, onData) {
  const q = query(collection(db, "courses", courseId, "modules", moduleId, "lessons"), orderBy("order", "asc"));
  return onSnapshot(q, snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
