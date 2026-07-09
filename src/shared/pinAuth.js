export const _hashPin = async (pin) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nvpin:" + pin));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
};

export const _pinKey = (email) => "nv-pin-" + email.replace(/[^a-z0-9]/gi,"_");

export const _bioKey  = (email) => "nv-bio-" + email.replace(/[^a-z0-9]/gi,"_");

export const getSavedPin  = (email) => { try { return localStorage.getItem(_pinKey(email)); } catch { return null; } };

export const hasBiometric = (email) => { try { return localStorage.getItem(_bioKey(email)) === "enabled"; } catch { return false; } };
