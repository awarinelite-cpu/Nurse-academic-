// ─── FIRESTORE COMPAT SHIM ────────────────────────────────────────────
//
// backend.js was written against the old firebase-compat API style
// (`db.collection(x).doc(y).get()`, `.where()`, `.batch()`, etc).
// Rather than rewrite all ~65 call sites in backend.js (high risk of
// introducing subtle bugs in exam/results/chat logic), this shim
// reimplements that same calling convention on top of the real
// `firebase/firestore` modular SDK. The transport underneath is 100%
// the npm package — this is purely an API-shape adapter.
//
// If you're adding NEW code, prefer importing the modular SDK
// directly from "firebase/firestore" instead of using this shim.

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, getDocs,
  onSnapshot, writeBatch,
} from "firebase/firestore";
import { db as firestoreDb } from "./firebaseClient.js";

function wrapDocSnap(snap) {
  return {
    exists: snap.exists(),   // compat style: property, not method
    data: () => snap.data(),
    id: snap.id,
    ref: snap.ref,           // raw modular DocumentReference
  };
}

function wrapQuerySnap(snap) {
  return {
    empty: snap.empty,
    docs: snap.docs.map(wrapDocSnap),
  };
}

function unwrapRef(ref) {
  return ref instanceof CompatDocRef ? ref._ref : ref;
}

class CompatDocRef {
  constructor(ref) { this._ref = ref; }
  get id() { return this._ref.id; }
  async get() { return wrapDocSnap(await getDoc(this._ref)); }
  set(data, opts) { return setDoc(this._ref, data, opts?.merge ? { merge: true } : {}); }
  update(data) { return updateDoc(this._ref, data); }
  delete() { return deleteDoc(this._ref); }
  collection(sub) { return new CompatCollectionRef(collection(this._ref, sub)); }
  onSnapshot(cb, errCb) {
    return onSnapshot(this._ref, snap => cb(wrapDocSnap(snap)), errCb);
  }
}

class CompatQuery {
  constructor(collRef, constraints = []) {
    this._collRef = collRef;
    this._constraints = constraints;
  }
  where(field, op, val) {
    return new CompatQuery(this._collRef, [...this._constraints, where(field, op, val)]);
  }
  orderBy(field, dir) {
    return new CompatQuery(this._collRef, [...this._constraints, orderBy(field, dir || "asc")]);
  }
  _buildQuery() { return query(this._collRef, ...this._constraints); }
  async get() { return wrapQuerySnap(await getDocs(this._buildQuery())); }
  onSnapshot(cb, errCb) {
    return onSnapshot(this._buildQuery(), snap => cb(wrapQuerySnap(snap)), errCb);
  }
}

class CompatCollectionRef extends CompatQuery {
  constructor(collRef) { super(collRef); }
  doc(id) {
    return new CompatDocRef(id ? doc(this._collRef, id) : doc(this._collRef));
  }
}

class CompatBatch {
  constructor() { this._batch = writeBatch(firestoreDb); }
  set(ref, data, opts) { this._batch.set(unwrapRef(ref), data, opts?.merge ? { merge: true } : {}); return this; }
  update(ref, data) { this._batch.update(unwrapRef(ref), data); return this; }
  delete(ref) { this._batch.delete(unwrapRef(ref)); return this; }
  commit() { return this._batch.commit(); }
}

export const compatDb = {
  collection(name) { return new CompatCollectionRef(collection(firestoreDb, name)); },
  batch() { return new CompatBatch(); },
};
