import { _db, _loadFirebase, _safeKey } from "../services/backend";
import { GroupVideoCallModal } from "../components/video-call";

export const _ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  {
    urls: "turn:global.relay.metered.ca:80",
    username: "1d2573fad62044e937cee0ab",
    credential: "vj0Ysdvdi7F/W+qA",
  },
  {
    urls: "turn:global.relay.metered.ca:80?transport=tcp",
    username: "1d2573fad62044e937cee0ab",
    credential: "vj0Ysdvdi7F/W+qA",
  },
  {
    urls: "turn:global.relay.metered.ca:443",
    username: "1d2573fad62044e937cee0ab",
    credential: "vj0Ysdvdi7F/W+qA",
  },
  {
    urls: "turns:global.relay.metered.ca:443?transport=tcp",
    username: "1d2573fad62044e937cee0ab",
    credential: "vj0Ysdvdi7F/W+qA",
  },
];

export const GVC_ICE = {
  iceServers: _ICE_SERVERS,
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",       // bundle all tracks into one transport
  rtcpMuxPolicy: "require",         // mux RTCP — cuts round trips in half
  iceTransportPolicy: "all",        // try direct first, TURN as fallback
};
// Pair id — always smaller_larger so both sides reference the same doc

export const _gvcPairId  = (a, b) => { const [x,y] = a < b ? [a,b] : [b,a]; return _safeKey(x)+"_"+_safeKey(y); };

export const _gvcPeersCol = (roomId) => _db.collection("group_calls").doc(roomId).collection("peers");

export const _gvcSigsCol  = (roomId) => _db.collection("group_calls").doc(roomId).collection("signals");

export const _gvcSigDoc   = (roomId, a, b) => _gvcSigsCol(roomId).doc(_gvcPairId(a, b));

export const gvcJoin  = async (roomId, uid) => {
  const ok = await _loadFirebase(); if (!ok) return;
  await _gvcPeersCol(roomId).doc(_safeKey(uid)).set({ uid, ts: Date.now() }, { merge: true });
};

export const gvcLeave = async (roomId, uid) => {
  const ok = await _loadFirebase(); if (!ok) return;
  try { await _gvcPeersCol(roomId).doc(_safeKey(uid)).delete(); } catch(_) {}
};

// Write offer — always keyed caller→callee (caller is alphabetically smaller)

export const gvcWriteOffer = async (roomId, callerUid, calleeUid, offer) => {
  // Ensure caller < callee alphabetically
  const [a, b] = callerUid < calleeUid ? [callerUid, calleeUid] : [calleeUid, callerUid];
  await _gvcSigDoc(roomId, a, b).set(
    { from: a, to: b, offer, callerIce: [], calleeIce: [], updatedAt: Date.now() },
    { merge: false }
  );
};
// Write answer — callee patches in answer field

export const gvcWriteAnswer = async (roomId, callerUid, calleeUid, answer) => {
  const [a, b] = callerUid < calleeUid ? [callerUid, calleeUid] : [calleeUid, callerUid];
  await _gvcSigDoc(roomId, a, b).set({ answer, updatedAt: Date.now() }, { merge: true });
};
// Append ICE candidate — role is "caller" or "callee"

export const gvcAddIce = async (roomId, uid, remoteUid, candidate, role) => {
  const ok = await _loadFirebase(); if (!ok) return;
  try {
    const field = role === "caller" ? "callerIce" : "calleeIce";
    // Prefer arrayUnion so concurrent writes don't clobber each other.
    // Fall back to a read-modify-write if FieldValue is unavailable.
    const FieldValue = window.firebase?.firestore?.FieldValue;
    if (FieldValue?.arrayUnion) {
      await _gvcSigDoc(roomId, uid, remoteUid).set(
        { [field]: FieldValue.arrayUnion(candidate), updatedAt: Date.now() },
        { merge: true }
      );
    } else {
      // Safe fallback: read current array then append
      const snap = await _gvcSigDoc(roomId, uid, remoteUid).get().catch(() => null);
      const existing = snap?.exists ? (snap.data()[field] || []) : [];
      await _gvcSigDoc(roomId, uid, remoteUid).set(
        { [field]: [...existing, candidate], updatedAt: Date.now() },
        { merge: true }
      );
    }
  } catch(e) { console.warn("[GVC] addIce failed:", e.message); }
};

// ── GroupVideoCallModal ───────────────────────────────────────────────────
