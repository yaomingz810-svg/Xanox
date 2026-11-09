/* FOMO Desk STEP 8 — plan B poller. FOMO URLs only from published JSON. */
(function () {
  const CFG = window.DESK_CONFIG || {};
  const LS_T = "desk_t", LS_P = "desk_p";
  const state = {
    t: "", p: "",
    status: null, home: null, chart: null, activity: null, account: null, settings: null, stream: null,
    agentsDecisions: {},
    coinsIndex: [],
    lastOkAt: null, offline: false, retryIn: 15, unread: false,
    tab: "home", originTab: "home", range: "LIVE",
    selectedMint: null, auditorMint: null,
  };

  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function loadCreds() {
    const raw = (location.hash || "").replace(/^#/, "");
    const params = new URLSearchParams(raw);
    let t = params.get("t") || localStorage.getItem(LS_T) || "";
    let p = params.get("p") || localStorage.getItem(LS_P) || "";
    if (params.get("t")) localStorage.setItem(LS_T, params.get("t"));
    if (params.get("p")) localStorage.setItem(LS_P, params.get("p"));
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    state.t = t; state.p = p;
  }

  async function deskGet(name) {
    if (!state.p) throw new Error("missing DATA_PATH");
    const res = await fetch(CFG.supabaseUrl + "/rest/v1/rpc/desk_get", {
      method: "POST",
      headers: {
        apikey: CFG.supabaseKey,
        Authorization: "Bearer " + CFG.supabaseKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data_path: state.p, name }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function fmtUsd(n) {
    if (n == null || isNaN(n)) return "—";
    return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(n, signed=true) {
    if (n == null || isNaN(n)) return "—";
    const s = (signed && n > 0 ? "+" : "") + Number(n).toFixed(2) + "%";
    return s;
  }
  function shortMint(m) { return m ? m.slice(0, 4) + "…" + m.slice(-4) : ""; }

  function setError(msg) {
    const bar = $("#error-bar");
    if (!msg) { bar.classList.add("hidden"); bar.textContent = ""; return; }
    bar.classList.remove("hidden");
    bar.textContent = msg;
  }

  function showLoading(on) {
    $("#loading").classList.toggle("hidden", !on);
  }

  /* ---------- render helpers ---------- */
  function renderHome() {
    const s = state.home || {};
    const mode = s.mode || "PAPER";
    const acct = state.account || {};
    const handle = acct.fomo_handle || ((state.settings && state.settings.settings) || {})["desk.fomo_handle"] || "an_sinpru";
    const profile = acct.profile_url || "#";
    const hp = $("#home-profile");
    if (hp) {
      hp.innerHTML = `${escapeHtml(handle)} <span class="chev">›</span>`;
      if (profile && profile.startsWith("https://")) { hp.href = profile; hp.target = "_blank"; hp.rel = "noopener"; }
      else { hp.removeAttribute("href"); }
    }
    $("#paper-badge").classList.toggle("hidden", mode !== "PAPER");
    const lb = $("#live-badge");
    if (lb) lb.classList.toggle("hidden", mode !== "LIVE");
    const bal = s.balance != null ? s.balance : 0;
    $("#odometer").textContent = fmtUsd(bal);
    const tp = s.today_pct != null ? s.today_pct : 0;
    const el = $("#today-pct");
    el.textContent = fmtPct(tp);
    el.style.color = tp >= 0 ? "var(--green)" : "var(--red)";
    $("#mult-pill").textContent = (s.multiplier != null ? Number(s.multiplier).toFixed(2) : "1.00") + "×";

    const pts = (state.chart && state.chart.points) || [];
    const marks = (state.chart && state.chart.marks) || [];
    const ok = DeskCharts.drawHomeLine($("#home-chart"), pts, marks);
    $("#home-chart-empty").classList.toggle("hidden", ok);

    const agents = s.agents || [];
    const running = agents.filter(a => a.status === "running").length;
    $("#agents-running").textContent = running + " running";
    renderCarousel(agents);
    renderActivityList($("#home-activity"), ((state.activity && state.activity.rows) || []).slice(0, 5), true);
  }

  function agentColor(name) {
    return ({ scanner: "#64d2ff", auditor: "#fff", analyst: "#ffd60a", executor: "#00d35a", risk: "#ff6b9a" })[name] || "#fff";
  }

  function renderCarousel(agents) {
    const host = $("#agent-carousel");
    const order = ["scanner", "auditor", "analyst", "executor", "risk"];
    const by = Object.fromEntries((agents || []).map(a => [a.name, a]));
    host.innerHTML = order.map(name => {
      const a = by[name] || { name, status: "running" };
      const dec = (state.agentsDecisions[name] && state.agentsDecisions[name].decisions) || [];
      const count = dec.length;
      let body = "";
      if (name === "scanner") {
        const rows = dec.slice(0, 6).map(d => {
          const kill = d.verdict === "kill";
          return `<div class="row ${kill ? "strike" : ""}"><span>${shortMint(d.mint)}</span><span class="reason">${kill ? (d.reason || "kill") : "→ auditor"}</span></div>`;
        }).join("") || `<div class="empty">Listening for graduations</div>`;
        body = `<div class="meta" style="color:#64d2ff">${count} pools</div><div class="agent-feed">${rows}</div>`;
      } else if (name === "auditor") {
        body = `<div class="meta">${count} taken apart</div><div class="agent-feed">${dec.slice(0,5).map(d=>`<div class="row"><span>${shortMint(d.mint)}</span><span>${d.reason||d.verdict||""}</span></div>`).join("")||'<div class="empty">No coin taken apart yet</div>'}</div>`;
      } else if (name === "analyst") {
        const last = dec[0];
        const score = last && last.detail && last.detail.score;
        body = `<div class="meta">Scoring</div><canvas class="score-ring" id="ring-${name}" width="88" height="88"></canvas>`;
        setTimeout(() => { const c = document.getElementById("ring-"+name); if (c) DeskCharts.drawScoreRing(c, score); }, 0);
      } else if (name === "executor") {
        const st = (state.settings && state.settings.settings) || {};
        body = `<div class="meta">${count} trades · ${st["executor.stack_pct"]||8}% of stack</div><div class="bar"><i style="width:${Math.min(100, count*10)}%"></i></div>`;
      } else {
        const st = (state.settings && state.settings.settings) || {};
        body = `<div class="meta">Guarding</div><div style="display:flex;gap:8px;margin-top:8px"><span class="pill red">stop -${st["risk.stop_pct"]||6}%</span><span class="pill green">trail ${st["risk.trail_pct"]||12}%</span></div>`;
      }
      return `<article class="agent-card" data-agent="${name}"><h3 style="color:${agentColor(name)}">${name[0].toUpperCase()+name.slice(1)}</h3>${body}</article>`;
    }).join("");
  }

  function renderActivityList(host, rows, compact) {
    if (!rows || !rows.length) {
      host.innerHTML = `<div class="empty">Nothing yet tonight</div>`;
      return;
    }
    host.innerHTML = rows.map(r => {
      const kind = (r.kind || "").toLowerCase();
      const open = (kind === "bought" || kind === "sold" || kind === "stopped") ? "coin" : (kind === "rejected" ? "auditor" : "");
      return `<div class="item tap" data-open="${open}" data-mint="${r.mint||""}" data-url="${r.coin_url||""}">
        <div class="t">${escapeHtml(r.title||kind)}</div>
        <div class="s">${escapeHtml(r.subtitle||"")}</div>
        <div class="v tabular">${escapeHtml(r.value||"")}</div>
      </div>`;
    }).join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }

  function renderAgentsTab() {
    const host = $("#agents-list");
    const agents = (state.home && state.home.agents) || [];
    const by = Object.fromEntries(agents.map(a => [a.name, a]));
    const order = ["scanner","auditor","analyst","executor","risk"];
    const st = (state.settings && state.settings.settings) || {};
    const openPos = false; // Risk lock when open — from stream/positions later
    host.innerHTML = order.map(name => {
      const a = by[name] || { name, status: "running" };
      const dec = (state.agentsDecisions[name] && state.agentsDecisions[name].decisions) || [];
      const paused = a.status === "paused";
      const lockRisk = name === "risk" && openPos;
      const rows = dec.slice(0, 20).map(d => {
        const href = d.coin_url || "";
        const coin = href ? `<a href="${href}" target="_blank" rel="noopener">${shortMint(d.mint)}</a>` : shortMint(d.mint);
        return `<div class="row-between" style="padding:6px 0;border-bottom:1px solid var(--sep)"><span class="secondary">${(d.ts||"").slice(11,16)} · ${coin}</span><span>${escapeHtml(d.verdict||"")} ${escapeHtml(d.reason||"")}</span></div>`;
      }).join("") || `<div class="empty">No decisions yet</div>`;
      return `<div class="card" data-agent="${name}">
        <h3><span class="dot ${paused?"paused":""}"></span>${name[0].toUpperCase()+name.slice(1)}</h3>
        <div class="row-between">
          <span class="secondary">${dec.length} today · ${paused?"paused":"running"}</span>
          <button type="button" class="switch ${paused?"":"on"} tap" data-pause="${name}" ${lockRisk?"disabled":""} aria-label="pause" title="Change via Lumi"></button>
        </div>
        <div class="decisions">${rows}</div>
        <button type="button" class="btn ghost tap" data-goto-settings="${name}">Settings</button>
      </div>`;
    }).join("");
  }

  function renderAccount() {
    const host = $("#account-body");
    const acct = state.account || {};
    const sett = (state.settings && state.settings.settings) || {};
    const mode = acct.mode || sett["desk.mode"] || "PAPER";
    const groups = {
      scanner: Object.keys(sett).filter(k => k.startsWith("scanner.")),
      auditor: Object.keys(sett).filter(k => k.startsWith("auditor.")),
      analyst: Object.keys(sett).filter(k => k.startsWith("analyst.")),
      executor: Object.keys(sett).filter(k => k.startsWith("executor.")),
      risk: Object.keys(sett).filter(k => k.startsWith("risk.")),
      desk: Object.keys(sett).filter(k => k.startsWith("desk.")),
    };
    let settingsHtml = "";
    for (const [g, keys] of Object.entries(groups)) {
      if (!keys.length) continue;
      settingsHtml += `<div class="settings-group" id="settings-${g}"><h4>${g}</h4>` +
        keys.map(k => `<div class="setting"><span>${k.split(".").slice(1).join(".")}</span><span class="val">${escapeHtml(sett[k])}</span></div>`).join("") +
        `</div>`;
    }
    host.innerHTML = `
      <div class="card">
        <div class="row-between"><span>Mode</span><span class="pill ${mode==="PAPER"?"orange":"green"}">${mode}</span></div>
        <div class="row-between" style="margin-top:10px"><span>Stack</span><span class="tabular">${fmtUsd(acct.stack)}</span></div>
        <div class="row-between" style="margin-top:10px"><span>Balance</span><span class="tabular">${fmtUsd(acct.balance)}</span></div>
      </div>
      <div class="note">Settings, pause and mode are read-only here. Message <b>Lumi</b> in chat to change them (plan B).</div>
      <a class="card row-between tap" href="${acct.profile_url||"#"}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <span>Your FOMO profile</span><span class="secondary">↗</span>
      </a>
      <button type="button" class="card row-between tap" id="btn-invite" style="width:100%;text-align:left">
        <span>Invite a friend</span><span class="secondary">Share</span>
      </button>
      <div class="note">Notifications: Discord only on this desk. Web push is not available on plan B hosting.</div>
      ${settingsHtml}
    `;
    const invite = $("#btn-invite");
    if (invite) invite.onclick = async () => {
      const url = acct.SIGNUP_URL;
      if (!url) return;
      if (navigator.share) {
        try { await navigator.share({ title: "FOMO", url }); return; } catch(e) {}
      }
      try { await navigator.clipboard.writeText(url); invite.querySelector(".secondary").textContent = "Link copied"; } catch(e) {}
    };
  }

  async function openCoin(mint) {
    if (!mint) return;
    state.selectedMint = mint;
    state.originTab = state.tab || "home";
    // Keep tabbar on the tab we came from (do not highlight Account)
    $$("#tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === state.originTab));
    $("#screen-coin").classList.remove("hidden");
    $("#coin-body").innerHTML = `<div class="skel"></div>`;
    try {
      const data = await deskGet("coin_" + mint + ".json");
      if (!data) { $("#coin-body").innerHTML = `<div class="empty">No data for this coin</div>`; return; }
      const name = (data.coin && (data.coin.name || data.coin.symbol)) || shortMint(mint);
      $("#coin-title").textContent = name;
      const mode = (state.home && state.home.mode) || "PAPER";
      $("#coin-paper").classList.toggle("hidden", mode !== "PAPER");
      const cl = $("#coin-live");
      if (cl) cl.classList.toggle("hidden", mode !== "LIVE");
      const pos = data.position;
      const open = pos && !pos.closed_at;
      const btnLabel = open ? "Sell on FOMO" : "Buy on FOMO";
      const fomo = data.coin_url; // from links.py via publisher — never rebuild
      $("#coin-body").innerHTML = `
        <div class="secondary" style="margin-bottom:8px">${escapeHtml(name)} · Solana · ${shortMint(mint)}</div>
        <div class="odometer" style="font-size:40px">${data.price != null ? Number(data.price).toPrecision(4) : "—"}</div>
        <div class="chart-wrap" style="height:180px"><canvas id="coin-chart" height="180"></canvas></div>
        <div class="card">
          <div class="row-between"><span class="secondary">Holders</span><span>${(data.stats&&data.stats.holders)!=null?data.stats.holders:"n/a"}</span></div>
          <div class="row-between" style="margin-top:8px"><span class="secondary">Prices</span><span>${data.stats&&data.stats.n_prices||0}</span></div>
        </div>
        ${open ? `<div class="card"><div class="row-between"><span>Your position</span><span>${fmtUsd(pos.size_usd)}</span></div>
          <div class="secondary" style="margin-top:8px">stop ${pos.stop_price!=null?Number(pos.stop_price).toPrecision(4):"—"} · trail ${pos.trail_active?"on":"off"}</div></div>` : ""}
        ${fomo ? `<a class="btn tap" href="${fomo}" target="_blank" rel="noopener">${btnLabel}</a>` : `<div class="note">No FOMO link in published data.</div>`}
      `;
      DeskCharts.drawCandles($("#coin-chart"), data.candles || []);
    } catch (e) {
      $("#coin-body").innerHTML = `<div class="empty">Failed to load coin</div>`;
    }
  }

  async function openAuditor(mint) {
    if (!mint) return;
    state.auditorMint = mint;
    state.originTab = state.tab || "home";
    $$("#tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === state.originTab));
    $("#screen-auditor").classList.remove("hidden");
    $("#auditor-body").innerHTML = `<div class="skel"></div>`;
    try {
      const data = await deskGet("audit_" + mint + ".json");
      if (!data || !data.layers || !data.layers.length) {
        $("#auditor-body").innerHTML = `<div class="empty">No coin taken apart yet</div>`;
        return;
      }
      const layers = data.layers.slice().sort((a,b)=>(a.n||a.layer)-(b.n||b.layer));
      const failed = layers.find(L => L.pass === false);
      const cleared = layers.every(L => L.pass === true);
      const fomo = data.coin_url;
      const discs = layers.map(L => {
        const cls = L.pass === true ? "pass" : (L.pass === false ? "fail" : "");
        const mark = L.pass === true ? "✓" : (L.pass === false ? "✕" : "·");
        return `<div class="disc ${cls}" data-layer="${L.n||L.layer}"><span>${mark} ${(L.name||"")}</span></div>`;
      }).join("");
      const rows = layers.map(L => {
        const cls = L.pass === true ? "ok" : (L.pass === false ? "bad" : "muted");
        return `<div class="layer"><span>${escapeHtml(L.name||"")}</span><span class="val ${cls}">${escapeHtml(L.value||L.value_text||"not checked")}</span></div>`;
      }).join("");
      $("#auditor-body").innerHTML = `
        <div class="discs" id="discs">${discs}</div>
        <div class="card">${failed ? `<b class="bad">Rejected · ${escapeHtml(failed.value||failed.value_text||"")}</b><div class="secondary">Grok Bot won't buy ${shortMint(mint)}</div>` : (cleared ? `<b class="ok">Cleared · 8/8 parts</b><div class="secondary">Sent to Executor</div>` : `<b>In progress</b>`)}</div>
        <div class="layers">${rows}</div>
        <div class="note">“Take apart before buying” is controlled via Lumi (settings.auditor.enabled).</div>
        ${fomo ? `<a class="btn tap" href="${fomo}" target="_blank" rel="noopener">Open on FOMO</a>` : ""}
      `;
      // beam animation
      if (!reduce) {
        const nodes = $$("#discs .disc");
        nodes.forEach((n,i) => {
          setTimeout(() => {
            const beam = document.createElement("div");
            beam.className = "beam";
            n.appendChild(beam);
            setTimeout(() => beam.remove(), 400);
          }, i * 350);
        });
      }
    } catch (e) {
      $("#auditor-body").innerHTML = `<div class="empty">Failed to load audit</div>`;
    }
  }

  function gotoTab(name) {
    state.tab = name;
    $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    $$("#tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    $("#screen-coin").classList.add("hidden");
    $("#screen-auditor").classList.add("hidden");
    if (name === "agents") renderAgentsTab();
    if (name === "activity") renderActivityList($("#activity-list"), (state.activity && state.activity.rows) || []);
    if (name === "account") renderAccount();
    if (name === "home") renderHome();
  }

  async function refresh() {
    if (!state.p) {
      showLoading(false);
      setError("Open your private link once (#t=…&p=…) to unlock the desk.");
      return;
    }
    try {
      const names = ["status.json","state.json","chart_"+state.range+".json","activity.json","account.json","settings.json","stream.json",
        "agents_scanner_decisions.json","agents_auditor_decisions.json","agents_analyst_decisions.json","agents_executor_decisions.json","agents_risk_decisions.json"];
      // chart fallback
      const results = {};
      await Promise.all(names.map(async n => {
        try { results[n] = await deskGet(n); } catch(e) { results[n] = null; }
      }));
      if (!results["chart_"+state.range+".json"]) {
        try { results["chart.json"] = await deskGet("chart.json"); } catch(e) {}
      }
      state.status = results["status.json"];
      state.home = results["state.json"];
      state.chart = results["chart_"+state.range+".json"] || results["chart.json"];
      state.activity = results["activity.json"];
      state.account = results["account.json"];
      state.settings = results["settings.json"];
      state.stream = results["stream.json"];
      ["scanner","auditor","analyst","executor","risk"].forEach(a => {
        state.agentsDecisions[a] = results["agents_"+a+"_decisions.json"] || { decisions: [] };
      });
      state.lastOkAt = new Date();
      state.offline = false;
      setError("");
      showLoading(false);
      if (state.tab === "home") renderHome();
      if (state.tab === "agents") renderAgentsTab();
      if (state.tab === "activity") renderActivityList($("#activity-list"), (state.activity && state.activity.rows) || []);
      if (state.tab === "account") renderAccount();
      // unread bell if stream has fresh signal/fill
      const ev = (state.stream && state.stream.events) || [];
      state.unread = ev.some(e => e.type === "signal" || e.type === "fill");
      $(".bell-dot", $("#btn-bell")).classList.toggle("hidden", !state.unread);
    } catch (e) {
      state.offline = true;
      const last = state.lastOkAt ? state.lastOkAt.toLocaleTimeString() : "never";
      setError(`Desk offline · retrying in ${state.retryIn}s · last update ${last}`);
      showLoading(false);
    }
  }

  function bind() {
    $$("#tabbar button").forEach(b => b.addEventListener("click", () => gotoTab(b.dataset.tab)));
    $("#btn-avatar").addEventListener("click", () => gotoTab("account"));
    document.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-goto]");
      if (t) gotoTab(t.dataset.goto);
      const back = ev.target.closest("[data-back]");
      if (back) {
        $("#screen-coin").classList.add("hidden");
        $("#screen-auditor").classList.add("hidden");
        const t = state.originTab || state.tab || "home";
        $$("#tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
      }
      const item = ev.target.closest("[data-open]");
      if (item) {
        const mint = item.dataset.mint;
        if (item.dataset.open === "coin") openCoin(mint);
        if (item.dataset.open === "auditor") openAuditor(mint);
      }
      const gs = ev.target.closest("[data-goto-settings]");
      if (gs) { gotoTab("account"); setTimeout(() => { const el = $("#settings-"+gs.dataset.gotoSettings); if (el) el.scrollIntoView({behavior:"smooth"}); }, 50); }
      const pause = ev.target.closest("[data-pause]");
      if (pause) {
        alert("Pause/resume is controlled by messaging Lumi (plan B).");
      }
    });
    $$("#range-switch button").forEach(b => b.addEventListener("click", async () => {
      $$("#range-switch button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      state.range = b.dataset.range;
      try { state.chart = await deskGet("chart_"+state.range+".json") || await deskGet("chart.json"); } catch(e) {}
      renderHome();
    }));
    $("#btn-search").addEventListener("click", () => {
      const q = prompt("Search name, symbol or mint");
      if (!q) return;
      const rows = (state.activity && state.activity.rows) || [];
      const hit = rows.find(r => (r.mint||"").includes(q) || (r.title||"").toLowerCase().includes(q.toLowerCase()));
      if (hit && hit.mint) openCoin(hit.mint);
      else alert("No match in tonight's activity. Paste a mint from Agents decisions.");
    });
    $("#btn-bell").addEventListener("click", () => { state.unread = false; $(".bell-dot", $("#btn-bell")).classList.add("hidden"); gotoTab("activity"); });
  }

  async function main() {
    loadCreds();
    bind();
    // expose for screenshot harness
    window.__DESK__ = state;
    window.__DESK_API__ = { gotoTab, openCoin, openAuditor, refresh, deskGet };
    if (!state.p) {
      showLoading(false);
      setError("Open your private link once (#t=…&p=…) to unlock the desk.");
      document.body.dataset.ready = "1";
      return;
    }
    await refresh();
    document.body.dataset.ready = "1";
    setInterval(refresh, CFG.pollMs || 15000);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
  main();
})();
