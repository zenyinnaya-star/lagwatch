// Lagwatch dashboard. Talks to the app service through window.lagwatch (Electron) or the local HTTP API (browser/dev).
const COLORS = { good: "#53C7B8", warning: "#F5B544", bad: "#FF7A59" };
const ACCENT = "#5AA9FF";

const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Request failed");
    return j;
  });
const api = window.lagwatch ?? {
  dashboard: () => fetch("/api/dashboard").then((r) => r.json()),
  setPreset: (name) => post("/api/preset", { name }),
  setSpeedTests: (enabled) => post("/api/speedtests", { enabled }),
  speedTest: () => post("/api/speedtest"),
  report: () => fetch("/api/report?hours=24").then((r) => r.json()),
  settings: () => fetch("/api/settings").then((r) => r.json()),
  setRules: (rules) => post("/api/rules", { rules }),
  setNotify: (n) => post("/api/notify", n),
  bufferbloat: () => post("/api/bufferbloat"),
  natCheck: () => post("/api/nat"),
  complaint: (b) => post("/api/complaint", b),
  setup: (v) => post("/api/setup", v),
  wifi: () => fetch("/api/wifi").then((r) => r.json()),
  welcome: (v) => post("/api/welcome", v),
  heatmap: (tz) => fetch("/api/heatmap?tz=" + tz).then((r) => r.json()),
  setGameTargets: (targets) => post("/api/gametargets", { targets }),
  gamePing: () => post("/api/gameping"),
  wifiDoctor: () => fetch("/api/wifidoctor").then((r) => r.json()),
  credit: (price) => post("/api/credit", { price }),
  markRestart: () => post("/api/restart"),
  restartCheck: () => fetch("/api/restartcheck").then((r) => r.json()),
  setMlab: (enabled) => post("/api/mlab", { enabled }),
  mlabTest: () => post("/api/mlabtest"),
};
window.lagwatch?.onAlertSound?.((d) => playSound(d.sound, d.volume));

/** Short synthesized sounds, no audio files needed. */
let audio;
function playSound(kind, volume = 40) {
  if (kind === "off") return;
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  const g = audio.createGain();
  g.gain.value = Math.max(0, Math.min(1, volume / 100)) * 0.3;
  g.connect(audio.destination);
  const notes = kind === "alarm" ? [880, 660, 880, 660] : [660, 880];
  notes.forEach((f, i) => {
    const o = audio.createOscillator();
    o.type = kind === "alarm" ? "square" : "sine";
    o.frequency.value = f;
    const env = audio.createGain();
    const t = audio.currentTime + i * (kind === "alarm" ? 0.22 : 0.18);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, t + (kind === "alarm" ? 0.2 : 0.3));
    o.connect(env).connect(g);
    o.start(t);
    o.stop(t + 0.35);
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f1 = (n) => (Math.round(n * 10) / 10).toString();

/** Smooth cubic path through points using midpoint control points. */
function smooth(pts) {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2;
    d += ` C${mx.toFixed(1)},${pts[i - 1][1].toFixed(1)} ${mx.toFixed(1)},${pts[i][1].toFixed(1)} ${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
  }
  return d;
}
const gid = (() => { let n = 0; return () => `g${++n}`; })();

function areaGrad(id, color, op = 0.35) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`;
}

function liveGraph(d) {
  const ping = d.rules.find((r) => r.metric === "ping");
  const yOf = (ms) => 150 - Math.min(ms, 300) * 0.45;
  const t0 = d.now - 5 * 60000;
  const pts = d.live.filter((p) => p.ms !== null).map((p) => [40 + ((p.t - t0) / 300000) * 370, yOf(p.ms)]);
  const yBad = yOf(ping.bad), yGood = yOf(ping.good);
  const id = gid();
  const line = smooth(pts);
  const last = pts[pts.length - 1];
  const nowMs = d.stats.ping.value;
  return `<svg viewBox="0 0 420 170" width="100%" role="img" aria-label="Live ping, last 5 minutes. Now ${nowMs === null ? "lost" : Math.round(nowMs) + " milliseconds"}.">
  <defs>${areaGrad(id, ACCENT, 0.38)}</defs>
  <rect x="40" y="15" width="370" height="${yBad - 15}" rx="4" fill="${COLORS.bad}" opacity=".1"/>
  <rect x="40" y="${yBad}" width="370" height="${yGood - yBad}" fill="${COLORS.warning}" opacity=".1"/>
  <rect x="40" y="${yGood}" width="370" height="${150 - yGood}" rx="4" fill="${COLORS.good}" opacity=".12"/>
  <line x1="40" y1="150" x2="410" y2="150" stroke="#fff" stroke-opacity=".14"/>
  <line x1="40" y1="${yBad}" x2="410" y2="${yBad}" stroke="${COLORS.bad}" stroke-dasharray="5 4" opacity=".8"/>
  <line x1="40" y1="${yGood}" x2="410" y2="${yGood}" stroke="${COLORS.good}" stroke-dasharray="5 4" opacity=".7"/>
  <text x="32" y="${yBad + 4}" text-anchor="end" font-size="11" fill="#C9B0A8">${ping.bad}</text>
  <text x="32" y="154" text-anchor="end" font-size="11" fill="#C9B0A8">0 ms</text>
  <text x="48" y="30" font-size="11" fill="#FFB4A2">Bad over ${ping.bad} ms</text>
  <text x="48" y="144" font-size="11" fill="#8EE0D3">Good under ${ping.good} ms</text>
  ${pts.length > 1 ? `<path class="area" d="${line} L${last[0].toFixed(1)},150 L${pts[0][0].toFixed(1)},150 Z" fill="url(#${id})"/>
  <path class="line" pathLength="1" d="${line}" fill="none" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px ${ACCENT})"/>
  <circle class="pulse" cx="${last[0]}" cy="${last[1]}" r="5" fill="${ACCENT}"/><circle cx="${last[0]}" cy="${last[1]}" r="5" fill="${ACCENT}" stroke="#221613" stroke-width="2"/>` : ""}
  ${nowMs !== null && last ? `<rect x="322" y="${Math.min(120, last[1] + 18)}" width="88" height="26" rx="7" fill="#33201A" stroke="${COLORS.bad}"/><text x="366" y="${Math.min(120, last[1] + 18) + 17.5}" text-anchor="middle" font-size="13" font-weight="600" fill="#FFE0D6">${Math.round(nowMs)} ms now</text>` : ""}
  <text x="40" y="168" font-size="11" fill="#C9B0A8">5 min ago</text><text x="410" y="168" text-anchor="end" font-size="11" fill="#C9B0A8">Now</text></svg>`;
}

function spark(series, color) {
  if (series.length < 2) return `<svg viewBox="0 0 120 36" width="100%" aria-hidden="true"></svg>`;
  const max = Math.max(...series, 1);
  const pts = series.map((v, i) => [3 + (i / (series.length - 1)) * 114, 33 - (v / max) * 25]);
  const id = gid();
  const line = smooth(pts);
  return `<svg viewBox="0 0 120 36" width="100%" aria-hidden="true"><defs>${areaGrad(id, color)}</defs>
  <path class="area" d="${line} L117,36 L3,36 Z" fill="url(#${id})"/>
  <path class="line" pathLength="1" d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="2.6" fill="${color}"/></svg>`;
}

const BLOAT_ZONE = { A: "good", B: "good", C: "warning", D: "bad", F: "bad" };
const TAG = { good: "Good", warning: "Warning", bad: "Bad" };
const tag = (z) => (z ? `<span class="tag ${z}">${TAG[z]}</span>` : `<span class="tag" style="color:var(--muted)">No data</span>`);

function statCards(d) {
  const s = d.stats;
  const col = (z) => COLORS[z] ?? "#9BA6B5";
  const ring = s.download.pctOfPlan === null ? "" : `<svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="${s.download.pctOfPlan} percent of plan" style="flex:none">
    <circle cx="32" cy="32" r="26" fill="none" stroke="#232A34" stroke-width="7"/>
    <circle class="ring" cx="32" cy="32" r="26" fill="none" stroke="${col(s.download.zone)}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(Math.min(100, s.download.pctOfPlan) / 100 * 163.4).toFixed(1)} 163.4" transform="rotate(-90 32 32)"/>
    <text x="32" y="37" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${s.download.pctOfPlan}%</text></svg>`;
  const num = (v, unit, dp = 0) => (v === null ? `<span class="muted">—</span>` : `${dp ? f1(v) : Math.round(v)} <small>${unit}</small>`);
  return `<section class="stats" aria-label="Current numbers">
  <div class="stat"><div class="top">Download ${tag(s.download.zone)}</div><div class="row" style="flex-wrap:nowrap;align-items:center;gap:14px;min-height:64px">${ring}<div class="big">${num(s.download.value, "Mbps")}</div></div>${spark(s.download.series, col(s.download.zone))}<div class="muted small">${s.download.pctOfPlan === null ? "Run a speed test to see this" : `of the ${d.plan.downMbps} Mbps plan`}</div></div>
  <div class="stat"><div class="top">Upload ${tag(s.upload.zone)}</div><div style="min-height:64px;display:flex;align-items:center"><div class="big">${num(s.upload.value, "Mbps", 1)}</div></div>${spark(s.upload.series, col(s.upload.zone))}<div class="muted small">Latest speed test</div></div>
  <div class="stat"><div class="top">Ping ${tag(s.ping.zone)}</div><div style="min-height:64px;display:flex;align-items:center"><div class="big">${s.ping.value === null ? "Lost" : num(s.ping.value, "ms")}</div></div>${spark(s.ping.series, col(s.ping.zone))}<div class="muted small">Good under ${d.rules.find((r) => r.metric === "ping").good} ms</div></div>
  <div class="stat"><div class="top">Dropouts ${tag(s.dropouts.value === 0 ? "good" : s.dropouts.value < 3 ? "warning" : "bad")}</div><div style="min-height:64px;display:flex;align-items:center"><div class="big">${s.dropouts.value} <small>in 24 h</small></div></div><div class="muted small">Two or more lost tests in a row, or upload at zero</div></div>
  <div class="stat"><div class="top">Lag under load ${d.bufferbloat ? tag(BLOAT_ZONE[d.bufferbloat.grade]) : tag(null)}</div>
    <div style="min-height:64px;display:flex;align-items:center;gap:14px">${d.bufferbloat ? `<div class="grade" style="color:${COLORS[BLOAT_ZONE[d.bufferbloat.grade]]};border-color:${COLORS[BLOAT_ZONE[d.bufferbloat.grade]]}">${d.bufferbloat.grade}</div><div class="big">+${Math.round(d.bufferbloat.addedMs)} <small>ms</small></div>` : `<div class="muted">Not tested yet</div>`}</div>
    <div class="muted small">${d.bufferbloat ? esc(d.bufferbloat.headline) + ". Ping " + Math.round(d.bufferbloat.idleMs) + " ms idle, " + Math.round(d.bufferbloat.loadedMs) + " ms while downloading." : "Measures ping while a download runs. Uses about 10 MB."}</div>
    <button class="btn" id="bloat" ${d.speedTests.enabled ? "" : "disabled"} title="${d.speedTests.enabled ? "" : "Turn on speed tests first"}">${d.bufferbloat ? "Run again" : "Run the test"}</button></div></section>`;
}

const NAT_COLOR = { direct: COLORS.good, "double-nat": COLORS.bad, "upnp-off": COLORS.warning, unclear: COLORS.warning };
function natPanel(d) {
  const n = d.nat;
  const c = n ? NAT_COLOR[n.status] : "#9BA6B5";
  return `<section class="panel" aria-label="Game NAT check" style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
  <div style="flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:10px">
    <h2 style="font-size:18px">Game console NAT check</h2>
    ${n ? `<div style="display:flex;gap:10px;align-items:center"><span aria-hidden="true" style="width:10px;height:10px;border-radius:50%;background:${c};flex:none"></span><b style="font-size:16px">${esc(n.headline)}</b></div>
    <p style="margin:0;color:#C5CDD8">${esc(n.detail)}</p>
    <ul class="muted small" style="margin:0;padding-left:18px">${n.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0">Checks why an Xbox or PlayStation reports a strict NAT or failed UPnP. It asks your router, on your home network only, no login needed.</p>`}
    <div><button class="btn" id="nat">${n ? "Check again" : "Check my NAT"}</button></div></div>
  ${n ? `<div style="flex:1 1 300px;min-width:0"><b>What to try</b><ol style="margin:8px 0 0;padding-left:20px;color:#C5CDD8;display:flex;flex-direction:column;gap:6px">${n.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>` : ""}
  </section>`;
}

function timelineChart(d) {
  const ping = d.rules.find((r) => r.metric === "ping");
  const n = d.timeline.length;
  const W = 896, x0 = 52, bw = W / n;
  const yOf = (ms) => 232 - Math.min(ms, 300) * (160 / 300);
  const fill = (b) => (b.kind === "asleep" ? "url(#gapH)" : b.kind === "vpn" ? "url(#vpnH)" : b.zone ? COLORS[b.zone] : "#2B3340");
  let strip = "", bands = "", runs = [], cur = [];
  d.timeline.forEach((b, i) => {
    const x = x0 + i * bw;
    strip += `<rect x="${x.toFixed(1)}" y="34" width="${(bw + 0.6).toFixed(1)}" height="22" fill="${fill(b)}"/>`;
    const tint = b.kind === "measured" && b.zone ? `<rect x="${x.toFixed(1)}" y="72" width="${(bw + 0.6).toFixed(1)}" height="160" fill="${COLORS[b.zone]}" opacity="${b.zone === "bad" ? 0.1 : 0.05}"/>` : b.kind !== "measured" ? `<rect x="${x.toFixed(1)}" y="72" width="${(bw + 0.6).toFixed(1)}" height="160" fill="url(#${b.kind === "vpn" ? "vpnH" : "gapH"})" opacity=".25"/>` : "";
    bands += tint;
    if (b.kind === "measured" && b.avg !== null) cur.push([x + bw / 2, yOf(b.avg)]);
    else if (cur.length) { runs.push(cur); cur = []; }
  });
  if (cur.length) runs.push(cur);
  // flags at the start of each bad run of 2+ buckets (max 3)
  const flags = [];
  for (let i = 0; i < n && flags.length < 3; i++) {
    if (d.timeline[i].zone === "bad" && d.timeline[i].kind === "measured" && (i === 0 || d.timeline[i - 1].zone !== "bad")) {
      let j = i; while (j < n && d.timeline[j].zone === "bad") j++;
      if (j - i >= 2) flags.push(x0 + ((i + j) / 2) * bw);
    }
  }
  const id = gid();
  const lines = runs.filter((r) => r.length > 1).map((r) => {
    const p = smooth(r);
    return `<path class="area" d="${p} L${r.at(-1)[0].toFixed(1)},232 L${r[0][0].toFixed(1)},232 Z" fill="url(#${id})"/><path class="line" pathLength="1" d="${p}" fill="none" stroke="${ACCENT}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  const yBad = yOf(ping.bad), yGood = yOf(ping.good);
  const labels = ["24 h ago", "18 h", "12 h", "6 h", "Now"].map((t, i) => `<text x="${52 + i * 224}" y="256" font-size="12" fill="#9BA6B5" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${t}</text>`).join("");
  return `<svg viewBox="0 0 960 270" width="100%" role="img" aria-label="Ping over the last 24 hours with bad stretches, sleep time and VPN time marked.">
  <defs>${areaGrad(id, ACCENT, 0.34)}
  <pattern id="gapH" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill="#6B7686" opacity=".5"/></pattern>
  <pattern id="vpnH" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill="#A58BFF" opacity=".65"/></pattern></defs>
  ${flags.map((x) => `<text x="${x.toFixed(1)}" y="14" text-anchor="middle" font-size="12.5" font-weight="600" fill="#FFB4A2">Ping over ${ping.bad} ms</text><line x1="${x.toFixed(1)}" y1="19" x2="${x.toFixed(1)}" y2="34" stroke="${COLORS.bad}" stroke-width="1.5"/>`).join("")}
  ${strip}${bands}
  <line x1="52" y1="72" x2="948" y2="72" stroke="#fff" stroke-opacity=".07"/><line x1="52" y1="232" x2="948" y2="232" stroke="#fff" stroke-opacity=".16"/>
  <line x1="52" y1="${yBad}" x2="948" y2="${yBad}" stroke="${COLORS.bad}" stroke-dasharray="6 5" opacity=".85"/><line x1="52" y1="${yGood}" x2="948" y2="${yGood}" stroke="${COLORS.good}" stroke-dasharray="6 5" opacity=".6"/>
  <text x="44" y="76" text-anchor="end" font-size="11.5" fill="#9BA6B5">300</text><text x="44" y="${yBad + 4}" text-anchor="end" font-size="11.5" fill="#9BA6B5">${ping.bad}</text><text x="44" y="236" text-anchor="end" font-size="11.5" fill="#9BA6B5">0 ms</text>
  ${lines}${labels}</svg>`;
}

function barChart(d) {
  const plan = d.plan.downMbps;
  const sc = 126 / plan;
  const bw = 896 / 24;
  const have = d.hourly.some((h) => h.down !== null);
  const bars = d.hourly.map((h, i) => {
    const x = 52 + i * bw + (bw - 24) / 2;
    if (h.down === null) return `<rect x="${x.toFixed(1)}" y="147" width="24" height="3" rx="1.5" fill="#2B3340"/>`;
    const ht = Math.max(2, h.down * sc);
    return `<rect class="bar" x="${x.toFixed(1)}" y="${(150 - ht).toFixed(1)}" width="24" height="${ht.toFixed(1)}" rx="4" fill="url(#barfill)" style="animation-delay:${(0.45 + i * 0.035).toFixed(2)}s"/>`;
  }).join("");
  const best = Math.max(0, ...d.hourly.map((h) => h.down ?? 0));
  return `<svg viewBox="0 0 960 190" width="100%" role="img" aria-label="Best download speed each hour against the ${plan} Mbps plan.">
  <defs><linearGradient id="barfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9A7C"/><stop offset="1" stop-color="#D9532F"/></linearGradient></defs>
  <line x1="52" y1="24" x2="948" y2="24" stroke="${COLORS.good}" stroke-width="1.3" stroke-dasharray="6 5"/><line x1="52" y1="150" x2="948" y2="150" stroke="#fff" stroke-opacity=".16"/>
  <text x="44" y="28" text-anchor="end" font-size="11.5" fill="#9BA6B5">${plan}</text><text x="44" y="154" text-anchor="end" font-size="11.5" fill="#9BA6B5">0</text>
  <text x="948" y="17" text-anchor="end" font-size="12" font-weight="600" fill="#8EE0D3">Your plan: ${plan} Mbps</text>
  ${have ? `<text x="500" y="60" text-anchor="middle" font-size="13" font-weight="600" fill="#E8ECF2">Best hour reached ${Math.round(best)} Mbps, ${Math.round((best / plan) * 100)}% of the plan</text>` : `<text x="500" y="90" text-anchor="middle" font-size="13" fill="#9BA6B5">No speed tests yet. Turn them on and run one.</text>`}
  ${bars}<text x="52" y="174" font-size="12" fill="#9BA6B5">24 h ago</text><text x="948" y="174" text-anchor="end" font-size="12" fill="#9BA6B5">Now</text></svg>`;
}

const when = (t, now) => {
  const m = Math.round((now - t) / 60000);
  return m < 60 ? `${Math.max(m, 0)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : "Over a day ago";
};

function render(d, ui) {
  const v = d.verdict;
  const cls = v.where === "healthy" ? "good" : v.where === "unclear" ? "unclear" : "bad";
  const pillColor = cls === "good" ? COLORS.good : cls === "unclear" ? COLORS.warning : COLORS.bad;
  document.getElementById("monText").textContent = d.sample ? "Showing sample data" : "Monitoring";
  document.getElementById("root").innerHTML = `
  <header><div><h1>Connection</h1><div class="muted">${d.setup.done ? esc(d.setup.summary) + ". " : ""}Last 24 hours.</div></div>
  <div class="row" style="align-items:center">${d.sample ? '<span class="chip">Sample data</span>' : ""}<button class="btn primary" id="export">Export evidence report</button></div></header>
  <section class="verdict ${cls}" aria-label="Verdict"><div><h2>${esc(v.headline)}</h2><p style="margin:0;font-size:16px;color:#F1D9D2">${esc(v.detail)}</p>
    <span class="pill" style="border-color:${pillColor};color:${pillColor}">Confidence: ${esc(v.confidence)}</span>
    <ul class="muted small" style="margin:0;padding-left:18px">${v.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
    <div><div class="row" style="justify-content:space-between;align-items:baseline"><span class="muted small">Ping, live, last 5 minutes</span><b style="font:600 20px 'Space Grotesk',sans-serif">${d.stats.ping.value === null ? "Lost" : Math.round(d.stats.ping.value) + " ms"}</b></div>${liveGraph(d)}</div></section>
  ${d.setup.done ? "" : '<section class="panel" style="border-color:#5AA9FF"><b>Tell Lagwatch about your plan.</b> <span class="muted">Your provider, plan speed and how you connect make the verdict and the complaint pack accurate.</span> <a class="btn primary" href="#setup" style="margin-left:8px;text-decoration:none">Set up now</a></section>'}
  ${statCards(d)}
  ${natPanel(d)}
  <section class="panel" aria-label="Timeline" style="display:flex;flex-direction:column;gap:16px">
    <div class="row" style="justify-content:space-between"><h2 style="font-size:18px">Ping across the last 24 hours</h2><span class="muted small">Zones follow your alert rules</span></div>${timelineChart(d)}
    <ul class="legend"><li><i style="background:${COLORS.good}"></i>Good</li><li><i style="background:${COLORS.warning}"></i>Warning</li><li><i style="background:${COLORS.bad}"></i>Bad</li><li><i style="background:repeating-linear-gradient(135deg,#6B7686 0 3px,#2B3340 3px 6px)"></i>Computer asleep, not an outage</li><li><i style="background:repeating-linear-gradient(135deg,#A58BFF 0 3px,#2B2546 3px 6px)"></i>VPN on, left out of evidence</li></ul>
    <hr><div class="row" style="justify-content:space-between"><h2 style="font-size:18px">Download by hour, against your plan</h2><span class="muted small">Mbps</span></div>${barChart(d)}</section>
  <div class="two">
    <section class="panel" aria-label="Recent alerts"><h2 style="font-size:18px">Recent alerts</h2>
      ${d.alerts.length ? `<ul class="alerts">${d.alerts.map((a) => `<li><span style="color:${COLORS[a.severity]};font-size:18px" aria-hidden="true">●</span><div style="flex:1"><b>${esc(a.title)}</b><span class="muted small">${esc(a.detail)}</span></div><span class="muted small" style="white-space:nowrap">${when(a.t, d.now)}</span></li>`).join("")}</ul>` : '<p class="muted">No alerts in the last 24 hours.</p>'}</section>
    <section class="panel" aria-label="Evidence and settings" style="display:flex;flex-direction:column;gap:6px">
      <h2 style="font-size:18px">Evidence and settings</h2>
      <p style="margin:6px 0;color:${d.integrity.ok ? "#8EE0D3" : "#FFB4A2"}">${d.integrity.ok ? `✓ Log chain verified: ${d.integrity.checked} entries, none changed` : `✗ Log chain failed: ${esc(d.integrity.reason ?? "")}`}</p>
      <div class="field"><label for="preset">Alert preset</label><select id="preset">${d.presets.map((p) => `<option ${p === d.preset ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></div>
      <label class="check" style="margin-top:14px"><input type="checkbox" id="st" ${d.speedTests.enabled ? "checked" : ""}> Allow speed tests (about 12 MB each, sent to Cloudflare along with your IP address)</label>
      <button class="btn" id="runst" ${d.speedTests.enabled ? "" : "disabled"} style="margin-top:8px">Run a speed test now</button>
      <div class="muted small">Used today: ${(d.speedTests.bytesToday / 1e6).toFixed(0)} of ${(d.speedTests.dailyCapBytes / 1e6).toFixed(0)} MB</div>
      <div class="err" id="err" role="alert"></div></section></div>`;

  const err = (m) => { const e = document.getElementById("err"); if (e) e.textContent = m; };
  document.getElementById("preset").onchange = async (e) => { try { await api.setPreset(e.target.value); await tick(); } catch (x) { err(x.message); } };
  document.getElementById("st").onchange = async (e) => { try { await api.setSpeedTests(e.target.checked); await tick(); } catch (x) { err(x.message); } };
  document.getElementById("runst").onclick = async (e) => { e.target.disabled = true; e.target.textContent = "Testing…"; try { await api.speedTest(); await tick(); } catch (x) { err(x.message); e.target.disabled = false; e.target.textContent = "Run a speed test now"; } };
  document.getElementById("bloat").onclick = async (e) => { e.target.disabled = true; e.target.textContent = "Testing… about 15 seconds"; try { await api.bufferbloat(); await tick(); } catch (x) { err(x.message); e.target.disabled = false; e.target.textContent = "Run the test"; } };
  document.getElementById("nat").onclick = async (e) => { e.target.disabled = true; e.target.textContent = "Checking… a few seconds"; try { await api.natCheck(); await tick(); } catch (x) { err(x.message); e.target.disabled = false; e.target.textContent = "Check my NAT"; } };
  document.getElementById("export").onclick = async () => {
    const r = await api.report();
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([r.text + `\n\nFingerprint: ${r.fingerprint}\n`], { type: "text/plain" })), download: `lagwatch-report-${new Date().toISOString().slice(0, 10)}.txt` });
    a.click(); URL.revokeObjectURL(a.href);
  };
}

const ui = { busy: false };
let firstDone = false;
const route = () => (location.hash === "#tools" ? "tools" : location.hash === "#setup" ? "setup" : location.hash === "#rules" ? "rules" : location.hash === "#reports" ? "reports" : "dashboard");
function markNav() {
  document.querySelectorAll("nav a[data-route]").forEach((a) => (a.dataset.route === route() ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
}
window.addEventListener("hashchange", () => { markNav(); const r = document.getElementById("root"); r.classList.add("first"); tick(); });

const METRICS = {
  ping: { label: "Ping", unit: "ms", low: true, hint: "Delay to the internet. Lower is better." },
  loss: { label: "Lost tests", unit: "%", low: true, hint: "Share of tests that got no answer." },
  download: { label: "Download", unit: "Mbps", low: false, hint: "Speed from a speed test. Higher is better." },
  upload: { label: "Upload", unit: "Mbps", low: false, hint: "Speed sending data. Higher is better." },
};
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;

function zoneBar(rule, low) {
  const max = low ? rule.bad * 2 : rule.good * 1.6;
  const pct = (v) => Math.max(0, Math.min(100, (v / max) * 100));
  const a = pct(low ? rule.good : rule.bad), b = pct(low ? rule.bad : rule.good);
  const seg = (w, c) => `<span style="flex:0 0 ${w}%;background:${c}"></span>`;
  const parts = low ? [seg(a, COLORS.good), seg(b - a, COLORS.warning), seg(100 - b, COLORS.bad)] : [seg(a, COLORS.bad), seg(b - a, COLORS.warning), seg(100 - b, COLORS.good)];
  return `<div class="zonebar" aria-hidden="true">${parts.join("")}</div>`;
}

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
  }
  const old = btn.textContent; btn.textContent = "Copied"; setTimeout(() => (btn.textContent = old), 1500);
}

let lastPack = null;
async function renderReports() {
  const st = await api.settings();
  const c = st.complaint;
  const block = (id, title, hint, text) => `<section class="panel" aria-label="${title}"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2 style="font-size:18px">${title}</h2><div class="muted small">${hint}</div></div><button class="btn copy" data-for="${id}">Copy</button></div><pre class="pack" id="${id}">${esc(text)}</pre></section>`;
  document.getElementById("root").innerHTML = `
  <header><div><h1>Evidence reports</h1><div class="muted">Turn your tests into a problem list, a call script and a full report for your provider.</div></div></header>
  <section class="panel" aria-label="Complaint details"><h2 style="font-size:18px">Who is calling</h2>
    <div class="grid" style="margin-top:14px">
      <div class="field"><label for="isp">Internet provider</label><input id="isp" class="txt" maxlength="60" placeholder="For example, Telus" value="${esc(c.isp || st.setup.provider)}"></div>
      <div class="field"><label for="holder">Account holder</label><input id="holder" class="txt" maxlength="80" placeholder="Whose name the account is under" value="${esc(c.accountHolder)}"></div>
      <div class="field"><label for="caller">Person making the call</label><input id="caller" class="txt" maxlength="80" placeholder="Your name" value="${esc(c.callerName)}"></div>
      <div class="field"><label for="hrs">Period to include</label><select id="hrs"><option value="24">Last 24 hours</option><option value="72">Last 3 days</option><option value="168">Last 7 days</option></select></div></div>
    <div class="row" style="margin-top:16px;align-items:center"><button class="btn primary" id="build">Build my complaint pack</button><span class="muted small">Uses only data stored on this computer.</span></div>
    <div class="err" id="perr" role="alert"></div></section>
  <div id="pack">${lastPack ? packHtml(lastPack, block) : ""}</div>`;
  const wire = () => {
    document.querySelectorAll(".copy").forEach((b) => (b.onclick = () => copyText(document.getElementById(b.dataset.for).textContent, b)));
    const dl = document.getElementById("dlall");
    if (dl) dl.onclick = () => {
      const txt = `PROBLEM LIST\n${lastPack.problems.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nCALL SCRIPT\n${lastPack.script}\n\nIF IT IS NOT FIXED\n${lastPack.escalation}\n\n----\n${lastPack.report}\n\nFingerprint: ${lastPack.fingerprint}\n`;
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([txt], { type: "text/plain" })), download: `lagwatch-complaint-pack-${new Date().toISOString().slice(0, 10)}.txt` });
      a.click(); URL.revokeObjectURL(a.href);
    };
  };
  wire();
  document.getElementById("build").onclick = async (e) => {
    e.target.disabled = true;
    try {
      lastPack = await api.complaint({ isp: document.getElementById("isp").value, accountHolder: document.getElementById("holder").value, callerName: document.getElementById("caller").value, hours: Number(document.getElementById("hrs").value) });
      document.getElementById("perr").textContent = "";
      document.getElementById("pack").innerHTML = packHtml(lastPack, block);
      wire();
      document.getElementById("pack").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (x) { document.getElementById("perr").textContent = x.message; }
    e.target.disabled = false;
  };
}

function packHtml(p, block) {
  const warn = (p.warnings ?? []).map((w) => `<section class="panel" role="note" style="border-color:#F5B544">${esc(w)}</section>`).join("");
  return `${warn}${p.hasProblems ? block("t_problems", "Problem list", "Read these out, one by one. Short on purpose.", p.problems.map((x, i) => `Problem ${i + 1}: ${x}`).join("\n")) : ""}
  ${block("t_script", "Call script", "Say it in your own words. Nothing here guarantees an outcome.", p.script)}
  ${block("t_esc", "If it is not fixed", "The next step after the call.", p.escalation)}
  ${block("t_report", "Full report", `Fingerprint ${p.fingerprint.slice(0, 16)}. ${p.chainOk ? "Log chain verified." : "Log chain FAILED."}`, p.report)}
  <div><button class="btn" id="dlall">Download everything as a text file</button></div>`;
}

async function renderRules(first) {
  const st = await api.settings();
  const n = st.notify;
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const sound = [["off", "Off"], ["chime", "Soft chime"], ["alarm", "Alarm"]];
  document.getElementById("root").innerHTML = `
  <header><div><h1>Alert rules</h1><div class="muted">You decide what counts as good and bad. Changes save as you make them.</div></div><div class="ok" id="saved" role="status"></div></header>
  <section class="panel" aria-label="Presets"><h2 style="font-size:18px">Start from a preset</h2><div class="presets">
    ${st.presets.map((p) => `<button class="preset ${p === st.preset ? "on" : ""}" data-p="${esc(p)}" aria-pressed="${p === st.preset}"><b>${esc(p)}</b><span class="muted small">${{ Gaming: "Tight lines for online games", "Work calls": "Steady enough for video calls", Streaming: "Relaxed lines for video", Custom: "Your own numbers" }[p] ?? ""}</span></button>`).join("")}</div></section>
  <section class="panel" aria-label="Rules"><h2 style="font-size:18px">Good and bad lines</h2><p class="muted" style="margin:4px 0 0">Alerts fire only when a value stays bad for the time you set. Editing a preset makes your own copy.</p>
    ${st.rules.map((r) => { const m = METRICS[r.metric]; return `<div class="rule" data-m="${r.metric}"><div class="rhead"><b>${m.label}</b><span class="muted small">${m.hint}</span></div>${zoneBar(r, m.low)}
      <div class="inputs"><label>Good ${m.low ? "at or below" : "at or above"} (${m.unit})<input type="number" step="any" min="0" data-k="good" value="${r.good}"></label>
      <label>Bad ${m.low ? "above" : "below"} (${m.unit})<input type="number" step="any" min="0" data-k="bad" value="${r.bad}"></label>
      <label>Bad for at least (seconds)<input type="number" step="1" min="0" data-k="sustainSec" value="${r.sustainSec}"></label></div></div>`; }).join("")}
    <div class="err" id="rerr" role="alert"></div></section>
  <section class="panel" aria-label="Pop-ups and sounds"><h2 style="font-size:18px">Pop-ups and sounds</h2>
    <div class="grid">
      <div class="field"><label for="popup">Pop-up style</label>${sel("popup", [["off", "Off"], ["corner", "Small corner notice"], ["banner", "Full banner"]], n.popup)}</div>
      <div class="field"><label for="s_warning">Warning sound</label>${sel("s_warning", sound, n.sounds.warning)}</div>
      <div class="field"><label for="s_bad">Bad sound</label>${sel("s_bad", sound, n.sounds.bad)}</div>
      <div class="field"><label for="s_recovered">Back to normal sound</label>${sel("s_recovered", sound, n.sounds.recovered)}</div>
      <div class="field"><label for="volume">Volume: <span id="vol">${n.volume}</span>%</label><input type="range" id="volume" min="0" max="100" value="${n.volume}"></div>
      <div class="field"><label for="gap">Wait before the same alert again</label>${sel("gap", [[1, "1 minute"], [5, "5 minutes"], [15, "15 minutes"], [30, "30 minutes"]], n.repeatGapMin)}</div>
      <div class="field"><label for="game">When a full-screen game is running</label>${sel("game", [["normal", "Normal"], ["sound-only", "Sound only, no pop-up"], ["hold-all", "Hold everything"]], n.gameMode)}</div></div>
    <label class="check" style="margin-top:16px"><input type="checkbox" id="qon" ${n.quiet.enabled ? "checked" : ""}> Quiet hours</label>
    <div class="grid" style="margin-top:8px"><div class="field"><label for="qs">From</label>${sel("qs", HOURS.map((h) => [h, hourLabel(h)]), n.quiet.startHour)}</div>
      <div class="field"><label for="qe">Until</label>${sel("qe", HOURS.map((h) => [h, hourLabel(h)]), n.quiet.endHour)}</div>
      <label class="check" style="align-self:end;min-height:44px"><input type="checkbox" id="qb" ${n.quiet.allowBad ? "checked" : ""}> Still allow bad alerts</label></div>
    <div class="row" style="margin-top:18px;align-items:center"><button class="btn" id="test">Test the alert</button><span class="muted small">Plays the bad sound and shows a pop-up so you can check them.</span></div>
    <div class="err" id="nerr" role="alert"></div></section>
  <div class="toast" id="toast" hidden></div>`;

  const saved = (m = "Saved") => { const e = document.getElementById("saved"); e.textContent = "✓ " + m; setTimeout(() => (e.textContent = ""), 2000); };
  document.querySelectorAll(".preset").forEach((b) => (b.onclick = async () => { try { await api.setPreset(b.dataset.p); saved(); await renderRules(false); } catch (x) { document.getElementById("rerr").textContent = x.message; } }));

  const readRules = () => st.rules.map((r) => {
    const row = document.querySelector(`.rule[data-m="${r.metric}"]`);
    const v = (k) => Number(row.querySelector(`[data-k="${k}"]`).value);
    return { metric: r.metric, good: v("good"), bad: v("bad"), sustainSec: v("sustainSec") };
  });
  document.querySelectorAll(".rule input").forEach((i) => (i.onchange = async () => {
    const err = document.getElementById("rerr");
    try { await api.setRules(readRules()); err.textContent = ""; saved(); await renderRules(false); } catch (x) { err.textContent = x.message; }
  }));

  const readNotify = () => ({
    popup: document.getElementById("popup").value,
    sounds: { warning: document.getElementById("s_warning").value, bad: document.getElementById("s_bad").value, recovered: document.getElementById("s_recovered").value },
    volume: Number(document.getElementById("volume").value),
    repeatGapMin: Number(document.getElementById("gap").value),
    quiet: { enabled: document.getElementById("qon").checked, startHour: Number(document.getElementById("qs").value), endHour: Number(document.getElementById("qe").value), allowBad: document.getElementById("qb").checked },
    gameMode: document.getElementById("game").value,
  });
  const saveNotify = async () => { try { await api.setNotify(readNotify()); document.getElementById("nerr").textContent = ""; saved(); } catch (x) { document.getElementById("nerr").textContent = x.message; } };
  ["popup", "s_warning", "s_bad", "s_recovered", "gap", "game", "qon", "qs", "qe", "qb"].forEach((id) => (document.getElementById(id).onchange = saveNotify));
  const vol = document.getElementById("volume");
  vol.oninput = () => (document.getElementById("vol").textContent = vol.value);
  vol.onchange = saveNotify;
  document.getElementById("test").onclick = () => {
    const nn = readNotify();
    playSound(nn.sounds.bad, nn.volume);
    const t = document.getElementById("toast");
    if (nn.popup === "off") return;
    t.className = "toast " + nn.popup;
    t.innerHTML = `<b>Ping above ${st.rules.find((r) => r.metric === "ping").bad} ms</b><span>This is a test. Tests show your connection is struggling.</span>`;
    t.hidden = false;
    setTimeout(() => (t.hidden = true), 4000);
  };
}

async function tick() {
  if (ui.busy) return;
  ui.busy = true;
  try {
    if (route() === "tools") { await renderTools(); return; }
    if (route() === "setup") { await renderSetup(); return; }
    if (route() === "reports") { await renderReports(); document.getElementById("monText").textContent = "Monitoring"; return; }
    if (route() === "rules") { await renderRules(); document.getElementById("monText").textContent = "Monitoring"; return; }
    const active = document.activeElement?.id;
    const d = await api.dashboard();
    if (!d.welcomeSeen) { if (!welcomeOpen) renderWelcome(); return; }
    render(d, ui);
    if (active) document.getElementById(active)?.focus();
    if (!firstDone) { firstDone = true; setTimeout(() => document.getElementById("root")?.classList.remove("first"), 3000); }
    else document.getElementById("root").classList.remove("first");
  } catch (e) {
    document.getElementById("root").innerHTML = `<p class="err" role="alert">Could not reach the Lagwatch monitor: ${esc(e.message)}</p>`;
  } finally { ui.busy = false; }
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function heatmapHtml(h) {
  const col = (c) => (c.badPct === null ? "#161C25" : c.badPct < 5 ? "#1F6F66" : c.badPct < 20 ? "#7A6A2E" : c.badPct < 50 ? "#B8643F" : "#E2492B");
  const rows = h.cells.map((row, d) => `<tr><th scope="row" style="font:12px Inter;color:#9BA6B5;text-align:right;padding-right:6px">${DAYS[d]}</th>${row.map((c, hr) => `<td title="${DAYS[d]} ${hourLabel(hr)}: ${c.badPct === null ? "not enough tests" : Math.round(c.badPct) + "% of tests bad, middle ping " + (c.medianMs === null ? "none" : Math.round(c.medianMs) + " ms")}" style="background:${col(c)};width:26px;height:22px;border-radius:3px"></td>`).join("")}</tr>`).join("");
  const worst = h.worst ? `Worst time so far: ${DAYS[h.worst.day]} around ${hourLabel(h.worst.hour)}.` : "No clear worst time yet. Keep Lagwatch running for a few days.";
  return `<div style="overflow-x:auto"><table style="border-spacing:3px" aria-label="Share of bad tests by weekday and hour"><thead><tr><td></td>${Array.from({ length: 24 }, (_, i) => `<th scope="col" style="font:10px Inter;color:#9BA6B5;font-weight:400">${i % 3 === 0 ? hourLabel(i) : ""}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
  <p class="muted small" style="margin:8px 0 0">${worst} Based on ${h.days} day${h.days === 1 ? "" : "s"} of tests. Darker orange and red mean more bad tests. Grey means too few tests.</p>`;
}
async function renderTools() {
  const st = await api.settings();
  let targets = [...st.gameTargets];
  const root = document.getElementById("root");
  const hm = await api.heatmap(new Date().getTimezoneOffset());
  const rs = await api.restartCheck();
  const drawTargets = () => {
    document.getElementById("g_list").innerHTML = targets.map((t, i) => `<div class="row" style="align-items:center;margin-top:8px"><span style="min-width:140px"><b>${esc(t.name)}</b></span><span class="muted">${esc(t.host)}:${t.port}</span><button class="btn" data-rm="${i}">Remove</button></div>`).join("") || '<p class="muted small">No servers yet.</p>';
    document.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { targets.splice(Number(b.dataset.rm), 1); drawTargets(); }));
  };
  const rsText = !rs ? "" : rs.ready ? `Restart ${new Date(rs.t).toLocaleString()}: ${esc(rs.text)} (middle ping ${rs.before.medianMs === null ? "none" : Math.round(rs.before.medianMs) + " ms"} before, ${rs.after.medianMs === null ? "none" : Math.round(rs.after.medianMs) + " ms"} after)` : `Comparing after the restart. Check again in about ${rs.waitMin} minute${rs.waitMin === 1 ? "" : "s"}.`;
  root.innerHTML = `<header><div><h1>Tools</h1><div class="muted">Extra checks. Everything here runs on this computer.</div></div></header>
  <section class="panel" aria-label="When it goes bad"><h2 style="font-size:18px">When it goes bad</h2><div class="muted small" style="margin-bottom:10px">Last 14 days, by weekday and hour.</div>${heatmapHtml(hm)}</section>
  <section class="panel" aria-label="Game servers"><h2 style="font-size:18px">Game server ping</h2><div class="muted small">Add the game server address you play on (up to 5). Lagwatch makes five quick connection tests to each. Your home network addresses are not allowed.</div>
    <div id="g_list"></div>
    <div class="grid" style="margin-top:10px"><div class="field"><label for="g_name">Name</label><input id="g_name" class="txt" maxlength="40" placeholder="EU West"></div><div class="field"><label for="g_host">Server address</label><input id="g_host" class="txt" maxlength="253" placeholder="game.example.com"></div><div class="field"><label for="g_port">Port</label><input id="g_port" class="txt" type="number" min="1" max="65535" value="443"></div></div>
    <div class="row" style="margin-top:12px;align-items:center"><button class="btn" id="g_add">Add server</button><button class="btn primary" id="g_test">Test now</button><span class="muted small" id="g_msg"></span></div><div id="g_res"></div></section>
  <section class="panel" aria-label="Wi-Fi doctor"><h2 style="font-size:18px">Wi-Fi doctor</h2><div class="muted small">Checks signal strength, band and crowding on the network this computer is using. The network name is not saved or shown.</div>
    <div class="row" style="margin-top:12px;align-items:center"><button class="btn primary" id="w_run">Check my Wi-Fi</button></div><ul id="w_res" style="line-height:1.7;padding-left:20px"></ul></section>
  <section class="panel" aria-label="Restart check"><h2 style="font-size:18px">Did restarting help?</h2><div class="muted small">Restart your modem or router, then press the button as it goes off. Lagwatch compares the 30 minutes before and after.</div>
    <div class="row" style="margin-top:12px;align-items:center"><button class="btn primary" id="r_mark">I just restarted it</button></div><p id="r_res" style="margin:10px 0 0">${rsText}</p></section>
  <section class="panel" aria-label="Bill credit estimate"><h2 style="font-size:18px">Bill credit to ask about</h2><div class="muted small">A figure to raise with your provider, worked out from outage time and slow time in the last 30 days. Providers set their own credit rules.</div>
    <div class="grid"><div class="field"><label for="c_price">Your monthly price</label><input id="c_price" class="txt" type="number" min="0" step="0.01" placeholder="e.g. 90"></div></div>
    <div class="row" style="margin-top:12px;align-items:center"><button class="btn primary" id="c_run">Work it out</button></div><div id="c_res" style="margin-top:10px"></div></section>`;
  drawTargets();
  const run = (id, fn) => { const b = document.getElementById(id); b.onclick = async () => { b.disabled = true; try { await fn(); } catch (x) { alert_(x.message); } b.disabled = false; }; };
  const alert_ = (m) => { const e = document.getElementById("g_msg"); if (e) e.textContent = m; };
  run("g_add", async () => {
    const t = { name: document.getElementById("g_name").value.trim(), host: document.getElementById("g_host").value.trim(), port: Number(document.getElementById("g_port").value) };
    targets = await api.setGameTargets([...targets, t]); drawTargets(); document.getElementById("g_msg").textContent = "Saved.";
  });
  run("g_test", async () => {
    document.getElementById("g_msg").textContent = "Testing…";
    const r = await api.gamePing(); document.getElementById("g_msg").textContent = "";
    document.getElementById("g_res").innerHTML = `<table style="width:100%;margin-top:10px;border-collapse:collapse"><thead><tr style="text-align:left;color:#9BA6B5;font-size:12px"><th>Server</th><th>Middle</th><th>Best</th><th>Worst</th><th>Steadiness</th><th>Lost</th></tr></thead><tbody>${r.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.medianMs === null ? "no answer" : Math.round(x.medianMs) + " ms"}</td><td>${x.bestMs === null ? "-" : Math.round(x.bestMs) + " ms"}</td><td>${x.worstMs === null ? "-" : Math.round(x.worstMs) + " ms"}</td><td>${x.jitterMs === null ? "-" : "±" + Math.round(x.jitterMs) + " ms"}</td><td>${Math.round(x.lossPct)}%</td></tr>`).join("")}</tbody></table>`;
  });
  run("w_run", async () => {
    const r = await api.wifiDoctor();
    document.getElementById("w_res").innerHTML = r.findings.map((f) => `<li style="color:${f.level === "bad" ? "#FF7A59" : f.level === "warn" ? "#F5B544" : "#53C7B8"}"><span style="color:#E8ECF2">${esc(f.text)}</span></li>`).join("");
  });
  run("r_mark", async () => { await api.markRestart(); document.getElementById("r_res").textContent = "Marked. Check back in about 30 minutes."; });
  run("c_run", async () => {
    const r = await api.credit(Number(document.getElementById("c_price").value));
    document.getElementById("c_res").innerHTML = `<b style="font:600 24px 'Space Grotesk',sans-serif">About $${r.amount.toFixed(2)}</b><p class="muted small" style="margin:6px 0">${esc(r.working)}</p><p class="small" style="margin:6px 0">${esc(r.note)}</p>${r.partial ? `<p class="small" style="color:#F5B544;margin:6px 0">Lagwatch has only about ${r.coveredHours} hours of tests in this period, so this may be low.</p>` : ""}`;
  });
}

let welcomeOpen = false;
function renderWelcome(step = 1) {
  welcomeOpen = true;
  const root = document.getElementById("root");
  const finish = async (v, to) => { await api.welcome({ seen: true, ...v }); welcomeOpen = false; location.hash = to; if (to === "#dashboard") tick(); };
  if (step === 1) {
    root.innerHTML = `<section class="panel" style="max-width:720px;margin:6vh auto"><h1>Welcome to Lagwatch</h1>
    <p style="font-size:17px">Lagwatch quietly checks your internet all day and tells you, in plain English, whether the problem is your home or your provider.</p>
    <ul style="line-height:1.8;padding-left:20px"><li>Checks your connection every few seconds and keeps a log</li><li>Warns you when it gets bad, using lines you choose</li><li>Builds a report and a call script for your provider, backed by a log that shows if it was changed</li></ul>
    <p class="muted">Everything stays on this computer. No account, nothing uploaded.</p>
    <div class="row" style="margin-top:20px;align-items:center"><button class="btn primary" id="w_next">Get started</button><button class="btn" id="w_skip">Skip for now</button></div></section>`;
    document.getElementById("w_next").onclick = () => renderWelcome(2);
    document.getElementById("w_skip").onclick = () => finish({}, "#dashboard");
    document.getElementById("w_next").focus();
    return;
  }
  root.innerHTML = `<section class="panel" style="max-width:720px;margin:6vh auto"><h1>Keep watching when the window is closed?</h1>
    <p>A slow evening is easy to miss if Lagwatch only records while it is open. You choose. Both are off unless you turn them on, and you can change them later.</p>
    <label class="row" style="align-items:flex-start;gap:12px;margin:16px 0;flex-wrap:nowrap"><input type="checkbox" id="w_bg" style="margin-top:4px;flex:none"><span><b>Keep recording in the background</b><br><span class="muted">Closing the window hides Lagwatch in the tray and it keeps logging. Quit from the tray menu to stop it completely.</span></span></label>
    <label class="row" style="align-items:flex-start;gap:12px;margin:16px 0;flex-wrap:nowrap"><input type="checkbox" id="w_login" style="margin-top:4px;flex:none" disabled><span><b>Start when I sign in to this computer</b><br><span class="muted">Needs background recording. Lagwatch starts hidden so it does not get in the way.</span></span></label>
    <p class="muted small">Without background recording, nothing is logged while Lagwatch is closed, and the report will show those gaps instead of guessing.</p>
    <div class="row" style="margin-top:20px;align-items:center"><button class="btn primary" id="w_go">Continue to plan setup</button><button class="btn" id="w_skip2">Skip, use defaults</button></div></section>`;
  const bg = document.getElementById("w_bg"), lg = document.getElementById("w_login");
  bg.onchange = () => { lg.disabled = !bg.checked; if (!bg.checked) lg.checked = false; };
  const vals = () => ({ background: bg.checked, startAtLogin: lg.checked });
  document.getElementById("w_go").onclick = () => finish(vals(), "#setup");
  document.getElementById("w_skip2").onclick = () => finish({}, "#dashboard");
}

async function renderSetup() {
  const st = await api.settings();
  const cat = st.catalog;
  const S = { ...st.setup };
  const opt = (list, cur, ph) => (ph ? `<option value="">${ph}</option>` : "") + list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`).join("");
  const root = document.getElementById("root");
  const draw = () => {
    const c = cat.countries[S.country] ?? cat.countries.Other;
    const tiers = [...new Set([...cat.speedTiers, S.downMbps])].sort((a, b) => a - b);
    const known = c.providers.includes(S.provider);
    root.innerHTML = `<header><div><h1>Plan and setup</h1><div class="muted">Tell Lagwatch what you pay for and how you connect. Stays on this computer.</div></div></header>
    <section class="panel" aria-label="Your provider"><h2 style="font-size:18px">Where you are and who your provider is</h2><div class="grid">
      <div class="field"><label for="s_country">Country</label><select id="s_country">${opt(Object.keys(cat.countries).map((k) => [k, k]), S.country)}</select></div>
      ${c.regions.length ? `<div class="field"><label for="s_region">${esc(c.regionLabel)}</label><select id="s_region">${opt(c.regions.map((r) => [r, r]), S.region, "Choose…")}</select></div>` : ""}
      ${c.providers.length ? `<div class="field"><label for="s_prov">Internet provider</label><select id="s_prov">${opt([...c.providers.map((p) => [p, p]), ["__other", "Other"]], known ? S.provider : S.provider ? "__other" : "", "Choose…")}</select></div>` : ""}
      ${!c.providers.length || (S.provider && !known) || S._other ? `<div class="field"><label for="s_provtxt">${c.providers.length ? "Provider name" : "Internet provider"}</label><input id="s_provtxt" class="txt" maxlength="60" value="${esc(known ? "" : S.provider)}"></div>` : ""}
    </div></section>
    <section class="panel" aria-label="Your plan"><h2 style="font-size:18px">Your plan</h2><div class="grid">
      <div class="field"><label for="s_down">Download speed you pay for (Mbps)</label><select id="s_down">${opt(tiers.map((t) => [t, t + " Mbps"]), S.downMbps)}</select></div>
      <div class="field"><label for="s_downc">Or type your own</label><input id="s_downc" class="txt" type="number" min="1" max="100000" placeholder="e.g. 250"></div>
      <div class="field"><label for="s_up">Upload speed (optional)</label><input id="s_up" class="txt" type="number" min="0" max="100000" value="${S.upMbps ?? ""}" placeholder="Leave blank if unsure"></div>
      <div class="field"><label for="s_tech">Connection type</label><select id="s_tech">${opt(Object.entries(cat.techs), S.tech)}</select></div></div></section>
    <section class="panel" aria-label="This computer"><h2 style="font-size:18px">How this computer connects</h2><div class="grid">
      <div class="field"><label for="s_conn">Connection</label><select id="s_conn">${opt(Object.entries(cat.connections), S.connection)}</select></div>
      ${S.connection === "wifi" ? `<div class="field"><label for="s_wifi">Wi-Fi network</label><input id="s_wifi" class="txt" maxlength="64" list="s_wifilist" value="${esc(S.wifiName)}"><datalist id="s_wifilist">${(S._nearby ?? []).map((n) => `<option value="${esc(n)}">`).join("")}</datalist></div>
      <div class="field"><label>&nbsp;</label><button class="btn" id="s_detect">Find my Wi-Fi</button></div>` : ""}
    </div>
    ${S.connection === "wifi" ? '<p class="muted small">Over Wi-Fi, a provider can blame your Wi-Fi. A cable gives the strongest evidence. The network name stays on this computer and is never put in a report.</p>' : ""}</section>
    <section class="panel" aria-label="M-Lab speed test"><h2 style="font-size:18px">M-Lab speed test (optional)</h2>
      <p class="muted small" style="margin:6px 0 0">M-Lab is a public research project that runs a trusted speed test. If you turn this on, your internet address is published with the result, and one test can use up to about 160 MB of data. Lagwatch only runs it when you press the button, at most ${st.mlab.limit} a day.</p>
      <label class="row" style="align-items:center;gap:12px;flex-wrap:nowrap;margin-top:12px"><input type="checkbox" id="s_mlab" style="flex:none" ${st.mlab.enabled ? "checked" : ""}><span>Allow M-Lab tests</span></label>
      <div class="row" style="align-items:center;margin-top:12px"><button class="btn" id="s_mlabrun" ${st.mlab.enabled ? "" : "disabled"}>Run an M-Lab test</button><span class="muted small" id="s_mlabmsg">${st.mlab.used} of ${st.mlab.limit} used today</span></div></section>
    <section class="panel" aria-label="Background watching"><h2 style="font-size:18px">Watching when the window is closed</h2>
      <label class="row" style="align-items:center;gap:12px;flex-wrap:nowrap;margin-top:12px"><input type="checkbox" id="s_bg" style="flex:none" ${st.welcome.background ? "checked" : ""}><span>Keep recording in the background (tray)</span></label>
      <label class="row" style="align-items:center;gap:12px;flex-wrap:nowrap;margin-top:12px"><input type="checkbox" id="s_login" style="flex:none" ${st.welcome.startAtLogin ? "checked" : ""} ${st.welcome.background ? "" : "disabled"}><span>Start when I sign in to this computer</span></label></section>
    <div class="row" style="align-items:center"><button class="btn primary" id="s_save">Save</button><span class="muted small" id="s_msg"></span></div><div class="err" id="s_err" role="alert"></div>`;
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onchange = () => { fn(el.value); }; };
    on("s_country", (v) => { S.country = v; S.region = ""; S.provider = ""; draw(); document.getElementById("s_country").focus(); });
    on("s_region", (v) => (S.region = v));
    on("s_prov", (v) => { if (v === "__other") { S.provider = ""; S._other = true; draw(); document.getElementById("s_provtxt").focus(); } else { S.provider = v; S._other = false; draw(); document.getElementById("s_prov").focus(); } });
    on("s_down", (v) => (S.downMbps = Number(v)));
    on("s_tech", (v) => (S.tech = v));
    on("s_conn", (v) => { S.connection = v; draw(); document.getElementById("s_conn").focus(); });
    const t = document.getElementById("s_provtxt"); if (t) t.oninput = () => (S.provider = t.value);
    const dc = document.getElementById("s_downc"); if (dc) dc.oninput = () => { if (Number(dc.value) > 0) S.downMbps = Number(dc.value); };
    const w = document.getElementById("s_wifi"); if (w) w.oninput = () => (S.wifiName = w.value);
    const det = document.getElementById("s_detect");
    if (det) det.onclick = async () => {
      det.disabled = true; det.textContent = "Looking…";
      const r = await api.wifi();
      S._nearby = r.nearby; if (r.current) S.wifiName = r.current;
      draw();
      document.getElementById("s_msg").textContent = r.current ? `You are on ${r.current}.` : "Could not read the Wi-Fi name. Type it or pick from the list.";
    };
    const ml = document.getElementById("s_mlab"), mr = document.getElementById("s_mlabrun");
    ml.onchange = async () => { await api.setMlab(ml.checked); mr.disabled = !ml.checked; };
    mr.onclick = async () => {
      mr.disabled = true; const m = document.getElementById("s_mlabmsg"); m.textContent = "Testing, about 15 seconds…";
      try { const r = await api.mlabTest(); m.textContent = `Done: ${r.downMbps.toFixed(0)} Mbps down, ${r.upMbps.toFixed(0)} Mbps up. It is saved with your other speed tests.`; }
      catch (x) { m.textContent = x.message; }
      mr.disabled = !ml.checked;
    };
    const sb = document.getElementById("s_bg"), sl = document.getElementById("s_login");
    sb.onchange = () => { sl.disabled = !sb.checked; if (!sb.checked) sl.checked = false; };
    document.getElementById("s_save").onclick = async () => {
      const up = document.getElementById("s_up").value;
      const body = { country: S.country, region: S.region, provider: S.provider, tech: S.tech, connection: S.connection, downMbps: S.downMbps, upMbps: up === "" ? null : Number(up), wifiName: S.connection === "wifi" ? S.wifiName : "", done: true };
      try { await api.setup(body); await api.welcome({ seen: true, background: sb.checked, startAtLogin: sl.checked }); document.getElementById("s_err").textContent = ""; location.hash = "#dashboard"; }
      catch (x) { document.getElementById("s_err").textContent = x.message; }
    };
  };
  if (document.getElementById("s_save")) return; // already open, keep what the user typed
  draw();
}

markNav();
tick();
setInterval(() => { if (route() === "dashboard" && !document.hidden && !document.activeElement?.matches("select")) tick(); }, 3000);
