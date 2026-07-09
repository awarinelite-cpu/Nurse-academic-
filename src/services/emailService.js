import { EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID } from "../config/keys";

// Lazy-loads the EmailJS SDK from CDN (only once)
let _emailjsReady = false;
const loadEmailJS = () => new Promise((resolve, reject) => {
  if (_emailjsReady) { resolve(window.emailjs); return; }
  if (document.getElementById("emailjs-sdk")) {
    // Script already injected — wait for it
    const wait = setInterval(() => {
      if (window.emailjs) { _emailjsReady = true; clearInterval(wait); resolve(window.emailjs); }
    }, 50);
    return;
  }
  const s = document.createElement("script");
  s.id  = "emailjs-sdk";
  s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
  s.onload = () => {
    window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    _emailjsReady = true;
    resolve(window.emailjs);
  };
  s.onerror = reject;
  document.head.appendChild(s);
});

// Sends the password-reset email via EmailJS.
// Your template must have these variables: {{to_email}}, {{reset_code}}, {{app_name}}
export const sendResetEmail = async (toEmail, code) => {
  const ejs = await loadEmailJS();
  await ejs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    to_email:   toEmail,
    reset_code: code,
    app_name:   "Nursing Academic Hub",
  });
};

// Sends the access code email after payment
export const sendAccessCodeEmail = async (toEmail, code, name) => {
  try {
    const ejs = await loadEmailJS();
    await ejs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email:   toEmail,
      reset_code: code,
      app_name:   "Nursing Academic Hub — NC Exam Access Code",
      to_name:    name || toEmail.split("@")[0],
    });
  } catch(e) { console.warn("Email send failed:", e); }
};
