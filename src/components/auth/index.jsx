import { useState } from "react";
import { _bioKey, _hashPin, _pinKey, getSavedPin, hasBiometric } from "../../shared/pinAuth";

export function PinSetupModal({ email, onDone, onSkip, toast }) {
  const [step, setStep] = useState("choose"); // "choose" | "pin" | "bio"
  const [pin, setPin]   = useState("");
  const [confirm, setConfirm] = useState("");
  const [bioLoading, setBioLoading] = useState(false);

  const savePin = async () => {
    if (pin.length !== 4) return toast("Enter a 4-digit PIN", "error");
    if (pin !== confirm)  return toast("PINs do not match", "error");
    const hash = await _hashPin(pin);
    try { localStorage.setItem(_pinKey(email), hash); } catch {}
    toast("✅ PIN set successfully!", "success");
    onDone("pin");
  };

  const setupBiometric = async () => {
    setBioLoading(true);
    try {
      if (!window.PublicKeyCredential) throw new Error("Biometrics not supported on this device");
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "Nursing Hub", id: window.location.hostname || "localhost" },
          user: { id: new TextEncoder().encode(email), name: email, displayName: email.split("@")[0] },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
          timeout: 60000,
        },
      });
      if (cred) {
        try { localStorage.setItem(_bioKey(email), "enabled"); } catch {}
        toast("✅ Biometric login enabled!", "success");
        onDone("bio");
      }
    } catch(e) {
      toast("Biometric setup failed: " + (e.message || "Unknown error"), "error");
    }
    setBioLoading(false);
  };

  const pinDots = (val, len=4) => Array.from({length:len}, (_,i) => (
    <div key={i} style={{
      width:14, height:14, borderRadius:"50%",
      background: i < val.length ? "var(--accent)" : "var(--border)",
      transition:"background .15s",
    }}/>
  ));

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,.65)", zIndex:9999,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20,
    }}>
      <div style={{background:"var(--card)", borderRadius:20, padding:32, maxWidth:360, width:"100%", boxShadow:"0 24px 80px rgba(0,0,0,.4)", textAlign:"center"}}>
        <div style={{fontSize:52, marginBottom:12}}>🔐</div>
        <div style={{fontWeight:800, fontSize:18, marginBottom:6}}>Secure Your Account</div>
        <div style={{fontSize:13, color:"var(--text3)", marginBottom:24}}>
          Set up quick login so you don't need to type your password every time.
        </div>

        {step === "choose" && (
          <>
            <button className="btn btn-accent" style={{width:"100%", marginBottom:10, padding:"12px 0", fontSize:14}}
              onClick={()=>setStep("pin")}>🔢 Set 4-Digit PIN</button>
            {window.PublicKeyCredential && (
              <button className="btn" style={{width:"100%", marginBottom:10, padding:"12px 0", fontSize:14}}
                onClick={setupBiometric} disabled={bioLoading}>
                {bioLoading ? "⏳ Setting up..." : "🫆 Use Fingerprint / Face ID"}
              </button>
            )}
            <button style={{background:"none", border:"none", color:"var(--text3)", fontSize:12, cursor:"pointer", marginTop:6}}
              onClick={onSkip}>Skip for now →</button>
          </>
        )}

        {step === "pin" && (
          <>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12, color:"var(--text3)", marginBottom:8}}>Enter 4-digit PIN</div>
              <div style={{display:"flex", justifyContent:"center", gap:8, marginBottom:12}}>{pinDots(pin)}</div>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,4))}
                style={{textAlign:"center", fontSize:24, letterSpacing:8, width:140, padding:"10px 0", borderRadius:10, border:"2px solid var(--accent)", outline:"none", background:"var(--bg4)", color:"var(--text)"}}
                autoFocus
              />
            </div>
            {pin.length === 4 && (
              <div style={{marginBottom:16}}>
                <div style={{fontSize:12, color:"var(--text3)", marginBottom:8}}>Confirm PIN</div>
                <div style={{display:"flex", justifyContent:"center", gap:8, marginBottom:12}}>{pinDots(confirm)}</div>
                <input
                  type="password" inputMode="numeric" maxLength={4}
                  value={confirm} onChange={e=>setConfirm(e.target.value.replace(/\D/g,"").slice(0,4))}
                  style={{textAlign:"center", fontSize:24, letterSpacing:8, width:140, padding:"10px 0", borderRadius:10, border:"2px solid var(--border)", outline:"none", background:"var(--bg4)", color:"var(--text)"}}
                />
              </div>
            )}
            <button className="btn btn-accent" style={{width:"100%", marginBottom:8}} onClick={savePin}
              disabled={pin.length < 4 || confirm.length < 4}>
              ✅ Confirm PIN
            </button>
            <button style={{background:"none", border:"none", color:"var(--text3)", fontSize:12, cursor:"pointer"}}
              onClick={()=>{setStep("choose"); setPin(""); setConfirm("");}}>← Back</button>
          </>
        )}
      </div>
    </div>
  );
}

export function PinUnlockScreen({ email, onUnlock, onUsePassword, toast }) {
  const [pin, setPin]   = useState("");
  const [error, setError] = useState("");
  const [bioLoading, setBioLoading] = useState(false);
  const [tries, setTries] = useState(0);

  const tryPin = async (value) => {
    if (value.length !== 4) return;
    const hash = await _hashPin(value);
    const saved = getSavedPin(email);
    if (hash === saved) {
      onUnlock();
    } else {
      setTries(t => t + 1);
      setError(tries >= 2 ? "Too many wrong attempts. Use password instead." : "Wrong PIN — try again");
      setPin("");
      setTimeout(() => setError(""), 2000);
    }
  };

  const tryBiometric = async () => {
    setBioLoading(true);
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          userVerification: "required",
          timeout: 60000,
          rpId: window.location.hostname || "localhost",
        },
      });
      if (assertion) { onUnlock(); return; }
      setError("Biometric not recognised");
    } catch(e) {
      setError("Biometric failed — use PIN or password");
    }
    setBioLoading(false);
  };

  const pinDots = (val) => Array.from({length:4}, (_,i) => (
    <div key={i} style={{
      width:18, height:18, borderRadius:"50%",
      background: i < val.length ? "var(--accent)" : "var(--bg4)",
      border: "2px solid " + (i < val.length ? "var(--accent)" : "var(--border)"),
      transition:"all .15s",
    }}/>
  ));

  return (
    <div style={{
      position:"fixed", inset:0, background:"var(--bg)", zIndex:9990,
      display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", padding:20,
    }}>
      <div style={{background:"var(--card)", borderRadius:24, padding:36, maxWidth:340, width:"100%", boxShadow:"0 24px 80px rgba(0,0,0,.2)", textAlign:"center"}}>
        <div style={{fontSize:56, marginBottom:8}}>🔒</div>
        <div style={{fontWeight:800, fontSize:18, marginBottom:4}}>Welcome back!</div>
        <div style={{fontSize:13, color:"var(--text3)", marginBottom:6}}>
          {email.split("@")[0]}
        </div>
        <div style={{fontSize:12, color:"var(--text3)", marginBottom:24}}>Enter your PIN to continue</div>

        <div style={{display:"flex", justifyContent:"center", gap:10, marginBottom:20}}>
          {pinDots(pin)}
        </div>

        {/* PIN numpad */}
        <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16, maxWidth:240, margin:"0 auto 16px"}}>
          {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k, i) => (
            k === "" ? <div key={i} /> :
            <button key={i} onClick={() => {
              if (k === "⌫") { setPin(p=>p.slice(0,-1)); setError(""); }
              else {
                const next = (pin + k).slice(0,4);
                setPin(next);
                if (next.length === 4) tryPin(next);
              }
            }} style={{
              height:52, borderRadius:14, border:"1.5px solid var(--border)",
              background: k === "⌫" ? "var(--bg4)" : "var(--card2)",
              fontSize: k === "⌫" ? 18 : 22, fontWeight:700, cursor:"pointer",
              color:"var(--text)", transition:"all .1s",
              boxShadow:"0 2px 8px rgba(0,0,0,.06)",
            }}>
              {k}
            </button>
          ))}
        </div>

        {error && <div style={{color:"var(--danger)", fontSize:12, marginBottom:12, fontWeight:600}}>{error}</div>}

        {hasBiometric(email) && (
          <button className="btn" style={{width:"100%", marginBottom:8, fontSize:13}} onClick={tryBiometric} disabled={bioLoading}>
            {bioLoading ? "⏳ Verifying..." : "🫆 Use Fingerprint / Face ID"}
          </button>
        )}
        <button style={{background:"none", border:"none", color:"var(--accent)", fontSize:12, cursor:"pointer", textDecoration:"underline"}}
          onClick={onUsePassword}>
          Use password instead →
        </button>
      </div>
    </div>
  );
}

// ─── ADMIN: School Past Questions ──────────────────────────────────────
