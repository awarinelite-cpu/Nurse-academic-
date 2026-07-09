import { useState, useEffect } from "react";
import { useSharedData } from "../services/backend";
import { buildDeviceIdentity, compareDeviceIdentity, loadDeviceRegistration } from "../shared/deviceFingerprint";

export function useNcAccess(currentUser) {
  const [users] = useSharedData("nv-users", []);
  const [identity, setIdentity] = useState(null);
  const [fbReg, setFbReg] = useState(undefined);
  useEffect(() => { buildDeviceIdentity().then(setIdentity); }, []);
  useEffect(() => { if (currentUser) loadDeviceRegistration(currentUser).then(setFbReg); }, [currentUser]);
  const me = users.find(u => u.username === currentUser);
  if (!me?.ncUnlocked) return false;
  if (!identity) return false;
  if (fbReg === undefined) return false;
  if (!fbReg && !me.ncDeviceId) return true;
  const stored = fbReg || (() => { try { return JSON.parse(me.ncDeviceId); } catch { return me.ncDeviceId||null; } })();
  if (!stored) return true;
  if (typeof stored === "string") return stored === identity.fingerprint;
  const { match } = compareDeviceIdentity(stored, identity);
  return match;
}

// ── Admin: Production Code Manager ───────────────────────────────────
