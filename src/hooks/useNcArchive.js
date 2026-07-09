import { useSharedData } from "../services/backend";

export function useNcArchive() {
  return useSharedData("nv-nc-archive", []);
}

// ── Admin: Archive Manager ─────────────────────────────────────────────────
