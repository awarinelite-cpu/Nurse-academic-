import { _DOC_SHARED, _getDoc, _setDocField } from "../services/backend";

export const _h = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i); return (h >>> 0).toString(16).padStart(8,"0"); };

export const _getPersistentUUID = () => new Promise(resolve => {
  try {
    const req = indexedDB.open("nv_device_db_v2", 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore("kv");
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction("kv","readwrite");
      const store = tx.objectStore("kv");
      const get = store.get("device_uuid");
      get.onsuccess = () => {
        if (get.result) { resolve(get.result); return; }
        const uuid = (crypto.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
          const r = Math.random()*16|0; return (c==="x"?r:(r&0x3|0x8)).toString(16);
        }));
        store.put(uuid,"device_uuid"); resolve(uuid);
      };
      get.onerror = () => resolve("idb_err");
    };
    req.onerror = () => resolve("idb_blocked");
  } catch { resolve("idb_na"); }
});

export const _canvasFP = () => {
  try {
    const c = document.createElement("canvas"); c.width=300; c.height=80;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0,0,300,80);
    g.addColorStop(0,"#ff6b6b"); g.addColorStop(1,"#4ecdc4");
    ctx.fillStyle=g; ctx.fillRect(0,0,300,80);
    ctx.shadowBlur=8; ctx.shadowColor="rgba(0,0,0,.4)";
    ctx.font="bold 18px Arial,sans-serif"; ctx.fillStyle="white";
    ctx.fillText("NursingHub\u{1F3E5}2025\u{1F512}",4,32);
    ctx.font="13px Verdana,Geneva,sans-serif"; ctx.fillStyle="rgba(255,255,200,.95)";
    ctx.fillText("DeviceLock\u00b7Secure",8,58);
    ctx.shadowBlur=0; ctx.beginPath(); ctx.arc(260,20,14,0,Math.PI*2);
    ctx.fillStyle="rgba(255,220,0,.85)"; ctx.fill();
    return _h(c.toDataURL("image/png"));
  } catch { return "cv_na"; }
};

export const _webglFP = () => {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2")||c.getContext("webgl")||c.getContext("experimental-webgl");
    if (!gl) return "wgl_na";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const vendor   = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)   : gl.getParameter(gl.VENDOR);
    const params   = [gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
      gl.getParameter(gl.MAX_VARYING_VECTORS),gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)].join("|");
    return _h(`${renderer}||${vendor}||${params}`);
  } catch { return "wgl_na"; }
};

export const _webglRendererRaw = () => {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2")||c.getContext("webgl")||c.getContext("experimental-webgl");
    if (!gl) return "Unknown GPU";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { return "Unknown GPU"; }
};

export const _audioFP = () => new Promise(resolve => {
  try {
    const AC = window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if (!AC) { resolve("aud_na"); return; }
    const ctx = new AC(1,44100,44100);
    const osc = ctx.createOscillator(); osc.type="triangle"; osc.frequency.value=10000;
    const cmp = ctx.createDynamicsCompressor();
    [["threshold",-50],["knee",40],["ratio",12],["attack",0],["release",.25]]
      .forEach(([k,v]) => { try { cmp[k].value=v; } catch {} });
    const gain = ctx.createGain(); gain.gain.value=.5;
    osc.connect(cmp); cmp.connect(gain); gain.connect(ctx.destination);
    osc.start(0); ctx.startRendering();
    ctx.oncomplete = e => {
      const ch = e.renderedBuffer.getChannelData(0);
      let sig = 0; for (let i=4000;i<5000;i++) sig+=Math.abs(ch[i]);
      resolve(_h(sig.toFixed(15)));
    };
    ctx.onerror = () => resolve("aud_err");
    setTimeout(()=>resolve("aud_to"),3000);
  } catch { resolve("aud_na"); }
});

export const _fontFP = () => {
  try {
    const fonts=["Arial","Verdana","Helvetica","Times New Roman","Courier New","Georgia",
      "Calibri","Cambria","Consolas","Segoe UI","Roboto","Ubuntu","Open Sans","Noto Sans",
      "Comic Sans MS","Trebuchet MS","Impact","Lucida Console","Tahoma","Century Gothic"];
    const cvs=document.createElement("canvas"); const ctx2=cvs.getContext("2d");
    const measure=f=>{ctx2.font=`16px '${f}',monospace`; return ctx2.measureText("mmmmmmmmmmlli").width;};
    const base=measure("monospace_impossible_xyz");
    const present=fonts.filter(f=>measure(f)!==base);
    return _h(present.join(",")+"|"+present.length);
  } catch { return "fnt_na"; }
};

export const _batteryFP = () => new Promise(resolve => {
  try {
    if (!navigator.getBattery){resolve("bat_na");return;}
    navigator.getBattery()
      .then(b=>resolve(_h(`${b.charging}|${(b.level*100).toFixed(0)}|${b.chargingTime}|${b.dischargingTime}`)))
      .catch(()=>resolve("bat_err"));
    setTimeout(()=>resolve("bat_to"),1500);
  } catch { resolve("bat_na"); }
});

export const _getPublicIP = () => new Promise(resolve => {
  try {
    fetch("https://api.ipify.org?format=json",{signal:AbortSignal.timeout?AbortSignal.timeout(4000):undefined})
      .then(r=>r.json()).then(d=>resolve(d.ip||"ip_na")).catch(()=>resolve("ip_err"));
  } catch { resolve("ip_na"); }
});

export const buildDeviceIdentity = (() => {
  let _cached = null;
  return async () => {
    if (_cached) return _cached;
    const lsRaw = (() => { try { return localStorage.getItem("nv-did-v3"); } catch { return null; } })();
    const idbUUID = await _getPersistentUUID();
    if (lsRaw) {
      try {
        const p = JSON.parse(lsRaw);
        if (p.uuid === idbUUID.replace(/-/g,"").slice(0,16)) { _cached=p; return _cached; }
      } catch {}
    }
    const [audioH, batH, publicIP] = await Promise.all([_audioFP(), _batteryFP(), _getPublicIP()]);
    const canvasH    = _canvasFP();
    const webglH     = _webglFP();
    const gpuRaw     = _webglRendererRaw();
    const fontH      = _fontFP();
    const screenSig  = `${screen.width}x${screen.height}x${screen.colorDepth}x${window.devicePixelRatio||1}x${screen.availWidth}x${screen.availHeight}`;
    const hwSig      = `cpu${navigator.hardwareConcurrency||0}_mem${navigator.deviceMemory||0}_touch${navigator.maxTouchPoints||0}`;
    const localeSig  = `${Intl.DateTimeFormat().resolvedOptions().timeZone}|${navigator.language}|${(navigator.languages||[]).slice(0,4).join(",")}`;
    const platformSig= `${navigator.platform}|${navigator.vendor}|${navigator.userAgent.slice(0,120)}`;
    const uuidClean  = idbUUID.replace(/-/g,"");
    const hwSignals  = [canvasH,webglH,audioH,fontH,batH];
    const realCount  = hwSignals.filter(s=>!["na","err","to","blocked"].some(e=>s.includes(e))).length;
    const fingerprint = [
      uuidClean.slice(0,16), canvasH, webglH, audioH, fontH,
      _h(screenSig), _h(hwSig), _h(localeSig), _h(platformSig), batH
    ].join("_");
    const identity = {
      fingerprint, uuid: uuidClean.slice(0,16),
      canvasH, webglH, audioH, fontH,
      screen: _h(screenSig), hardware: _h(hwSig),
      locale: _h(localeSig), platform: _h(platformSig),
      publicIP, gpuRaw,
      userAgent: navigator.userAgent.slice(0,150),
      screenRaw: `${screen.width}x${screen.height}`,
      hwRaw: hwSig,
      realSignalCount: realCount,
      registeredAt: Date.now(),
    };
    _cached = identity;
    try { localStorage.setItem("nv-did-v3",JSON.stringify(identity)); } catch {}
    return identity;
  };
})();

export const getDeviceFingerprint = async () => (await buildDeviceIdentity()).fingerprint;

export const compareDeviceIdentity = (stored, current) => {
  if (!stored||!current) return {match:false};
  const core = ["uuid","canvasH","webglH","screen","hardware"];
  const soft = ["audioH","fontH","locale","platform"];
  const coreM = core.filter(k=>stored[k]&&current[k]&&stored[k]===current[k]).length;
  const softM = soft.filter(k=>stored[k]&&current[k]&&stored[k]===current[k]).length;
  return { match: coreM>=5 && softM>=2, coreMatches:coreM, softMatches:softM };
};

export const registerDeviceInFirebase = async (username, identity) => {
  try {
    const rec = { username, fingerprint:identity.fingerprint, uuid:identity.uuid,
      canvasH:identity.canvasH, webglH:identity.webglH, audioH:identity.audioH, fontH:identity.fontH,
      screen:identity.screen, hardware:identity.hardware, locale:identity.locale, platform:identity.platform,
      publicIP:identity.publicIP, gpuRaw:identity.gpuRaw, userAgent:identity.userAgent,
      screenRaw:identity.screenRaw, hwRaw:identity.hwRaw,
      realSignalCount:identity.realSignalCount, registeredAt:identity.registeredAt };
    await _setDocField(_DOC_SHARED, `deviceReg_${_h(username)}`, rec);
    return true;
  } catch { return false; }
};

export const loadDeviceRegistration = async (username) => {
  try { const d = await _getDoc(_DOC_SHARED); return d?.[`deviceReg_${_h(username)}`]||null; }
  catch { return null; }
};
