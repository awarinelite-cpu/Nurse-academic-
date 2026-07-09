// Generates a unique NC access code like NC-XXXX-XXXX-XXXX
export const generateAccessCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const seg = () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  return `NC-${seg()}-${seg()}-${seg()}`;
};

// Loads Paystack inline script once
let _paystackReady = false;
export const loadPaystack = () => new Promise((resolve, reject) => {
  if (_paystackReady) { resolve(); return; }
  if (document.getElementById("paystack-sdk")) {
    const wait = setInterval(() => { if (window.PaystackPop) { _paystackReady = true; clearInterval(wait); resolve(); } }, 50);
    return;
  }
  const s = document.createElement("script");
  s.id = "paystack-sdk";
  s.src = "https://js.paystack.co/v1/inline.js";
  s.onload = () => { _paystackReady = true; resolve(); };
  s.onerror = reject;
  document.head.appendChild(s);
});
