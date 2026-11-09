/* FOMO Desk placeholder — plan B (GitHub Pages + Supabase RPC) */
(function () {
  const SUPABASE_URL = 'https://ckxuvimhcjholdzzmutb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_p17UHqW2_d0lq1dK7ZqvxQ_s3sL_iGL';
  const POLL_MS = 15000;
  const LS_T = "desk_t";
  const LS_P = "desk_p";

  const el = (id) => document.getElementById(id);
  const setPill = (id, text, cls) => {
    const n = el(id);
    n.textContent = text;
    n.className = "pill " + (cls || "muted");
  };
  const setMsg = (t) => { el("msg").textContent = t || ""; };

  function parseFragment() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return {};
    const params = new URLSearchParams(raw);
    // also support & separated without URLSearchParams quirks for bare keys
    const out = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
  }

  function loadCreds() {
    const frag = parseFragment();
    let t = frag.t || localStorage.getItem(LS_T) || "";
    let p = frag.p || localStorage.getItem(LS_P) || "";
    if (frag.t) localStorage.setItem(LS_T, frag.t);
    if (frag.p) localStorage.setItem(LS_P, frag.p);
    if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    return { t, p };
  }

  async function deskGet(dataPath, name) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/desk_get", {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data_path: dataPath, name: name }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function tick(creds) {
    setPill("poll-state", "polling", "muted");
    try {
      const body = await deskGet(creds.p, "status.json");
      if (!body) {
        setPill("poll-state", "empty", "bad");
        el("status-ts").textContent = "—";
        el("status-ok").textContent = "—";
        setMsg("No status.json for this path yet.");
        return;
      }
      el("status-ts").textContent = body.ts != null ? String(body.ts) : "—";
      el("status-ok").textContent = body.ok === true ? "true" : String(body.ok);
      setPill("poll-state", "connected", "ok");
      setMsg("Last poll ok.");
    } catch (err) {
      setPill("poll-state", "error", "bad");
      setMsg(String(err && err.message ? err.message : err));
    }
  }

  function main() {
    const creds = loadCreds();
    if (!creds.p) {
      setPill("link-state", "missing path", "bad");
      setMsg("Open the private link (#t=…&p=…) once to unlock.");
      return;
    }
    // t accepted for spec; DATA_PATH is the real gate in plan B
    setPill("link-state", creds.t ? "ready" : "path only", "ok");
    tick(creds);
    setInterval(function () { tick(creds); }, POLL_MS);
  }

  main();
})();
