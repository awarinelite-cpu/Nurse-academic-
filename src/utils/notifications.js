// ── Reliable notification helper ────────────────────────────────────────
// Uses ServiceWorker registration.showNotification() when available (works
// in background/locked screen on Android). Falls back to new Notification().
export const showNotif = (title, options = {}) => {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const opts = { icon: "/favicon.ico", badge: "/favicon.ico", renotify: true, ...options };
    if (window._swReg && window._swReg.showNotification) {
      window._swReg.showNotification(title, opts).catch(() => {
        try { new Notification(title, opts); } catch(e) {}
      });
    } else {
      new Notification(title, opts);
    }
  } catch(e) {}
};
