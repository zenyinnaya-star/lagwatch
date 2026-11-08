import type { Sample, Rule } from "./types.js";

/* ---------- Game mode: which running programs count as a game ---------- */
export const DEFAULT_GAMES = [
  "fortniteclient", "valorant", "cs2", "csgo", "dota2", "leagueclient", "league of legends", "rocketleague", "overwatch",
  "apexlegends", "r5apex", "eldenring", "destiny2", "rainbowsix", "cod", "modernwarfare", "warzone", "minecraft", "gta5", "rdr2", "fifa", "eafc", "pubg", "tslgame", "marvelrivals", "helldivers2",
];
/** Returns the matching game name from a list of running process names, or null. Matches whole names, ignoring case and ".exe". */
export function detectGame(running: string[], games: string[] = DEFAULT_GAMES): string | null {
  const set = new Set(games.map((g) => g.toLowerCase()));
  for (const r of running) {
    const n = String(r).toLowerCase().replace(/\.exe$/, "").trim();
    if (set.has(n)) return n;
  }
  return null;
}

/* ---------- Heatmap: when does it go bad, by weekday and hour ---------- */
export interface HeatCell { n: number; medianMs: number | null; badPct: number | null }
export function buildHeatmap(samples: Sample[], rule: Rule, tzOffsetMin = 0): { cells: HeatCell[][]; days: number; worst: { day: number; hour: number } | null } {
  const buckets: { ok: number[]; lost: number; bad: number; n: number }[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ ok: [], lost: 0, bad: 0, n: 0 })));
  const dayKeys = new Set<number>();
  for (const s of samples) {
    if (s.target !== "outside" || s.vpn) continue;
    const d = new Date(s.t - tzOffsetMin * 60_000);
    const b = buckets[d.getUTCDay()][d.getUTCHours()];
    dayKeys.add(Math.floor((s.t - tzOffsetMin * 60_000) / 86_400_000));
    b.n++;
    if (s.pingMs === null) { b.lost++; b.bad++; } else { b.ok.push(s.pingMs); if (s.pingMs > rule.bad) b.bad++; }
  }
  let worst: { day: number; hour: number } | null = null, worstPct = 0;
  const cells = buckets.map((row, day) => row.map((b, hour) => {
    if (b.n < 5) return { n: b.n, medianMs: null, badPct: null };
    const sorted = [...b.ok].sort((a, c) => a - c);
    const pct = (b.bad / b.n) * 100;
    if (b.n >= 20 && pct > worstPct) { worstPct = pct; worst = { day, hour }; }
    return { n: b.n, medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null, badPct: pct };
  }));
  return { cells, days: dayKeys.size, worst };
}

/* ---------- Game server ping: user-chosen servers ---------- */
export interface GameTarget { name: string; host: string; port: number }
const PRIVATE = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|localhost$|.*\.local$|.*\.internal$)/i;
export function validateGameTargets(list: GameTarget[]): string | null {
  if (!Array.isArray(list) || list.length > 5) return "Add up to 5 servers.";
  for (const t of list) {
    if (!t || typeof t.name !== "string" || !t.name.trim() || t.name.length > 40) return "Each server needs a short name.";
    if (typeof t.host !== "string" || !/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i.test(t.host)) return `"${String(t.host).slice(0, 40)}" is not a valid server address.`;
    if (PRIVATE.test(t.host)) return "Use a public game server address, not one on your own network.";
    if (!Number.isInteger(t.port) || t.port < 1 || t.port > 65535) return "Port must be between 1 and 65535.";
  }
  return null;
}
export function summarizeGamePings(name: string, readings: (number | null)[]) {
  const ok = readings.filter((x): x is number => x !== null).sort((a, b) => a - b);
  const jitter = ok.length > 1 ? ok.slice(1).reduce((s, v, i) => s + Math.abs(v - ok[i]), 0) / (ok.length - 1) : null; // spread between neighbours when sorted: a rough steadiness number
  const sent = readings.length;
  return { name, sent, lossPct: sent ? ((sent - ok.length) / sent) * 100 : 0, medianMs: ok.length ? ok[Math.floor(ok.length / 2)] : null, bestMs: ok[0] ?? null, worstMs: ok[ok.length - 1] ?? null, jitterMs: jitter };
}

/* ---------- Wi-Fi doctor ---------- */
export interface WifiDetail { ssid: string | null; signalDbm: number | null; channel: number | null; frequencyMhz: number | null; linkMbps: number | null; security: string | null; sameChannelNetworks: number; strongerNeighbours: number }
export interface WifiFinding { level: "ok" | "warn" | "bad"; text: string }
export function diagnoseWifi(w: WifiDetail, planDownMbps: number): WifiFinding[] {
  const out: WifiFinding[] = [];
  if (w.ssid === null) return [{ level: "warn", text: "This computer does not look like it is on Wi-Fi, or Lagwatch could not read it." }];
  if (w.signalDbm !== null) {
    if (w.signalDbm <= -75) out.push({ level: "bad", text: `Signal is weak (${w.signalDbm} dBm). Move closer to the router, or the problem may be distance and walls, not your provider.` });
    else if (w.signalDbm <= -67) out.push({ level: "warn", text: `Signal is fair (${w.signalDbm} dBm). Video calls and games can stutter at this level.` });
    else out.push({ level: "ok", text: `Signal is strong (${w.signalDbm} dBm).` });
  }
  if (w.frequencyMhz !== null) {
    if (w.frequencyMhz < 3000) out.push({ level: "warn", text: "You are on the 2.4 GHz band. It reaches far but is slower and busier. Use the 5 GHz name if your router has one." });
    else out.push({ level: "ok", text: `You are on a faster band (${(w.frequencyMhz / 1000).toFixed(1)} GHz).` });
  }
  if (w.linkMbps !== null && w.linkMbps < planDownMbps) out.push({ level: "warn", text: `Your Wi-Fi link runs at ${Math.round(w.linkMbps)} Mbps, below your ${planDownMbps} Mbps plan, so Wi-Fi alone can cap your speed.` });
  if (w.sameChannelNetworks >= 3) out.push({ level: "warn", text: `${w.sameChannelNetworks} other networks share your channel, which can slow everyone. Try another channel in the router settings.` });
  if (w.security && /open|none|wep/i.test(w.security)) out.push({ level: "bad", text: "This network has weak or no security. Switch the router to WPA2 or WPA3." });
  if (!out.some((f) => f.level !== "ok")) out.push({ level: "ok", text: "Nothing wrong found with your Wi-Fi link. If it is still slow, run Lagwatch on a cable to rule Wi-Fi out." });
  return out;
}

/* ---------- Bill credit estimate ---------- */
export interface CreditInput { monthlyPrice: number; outageHours: number; badHours: number; periodHours: number }
/**
 * An amount to ASK about, never a promise. Outage time counts in full. Hours that were only slow count half.
 * Providers set their own credit rules, so the result is labelled an estimate and the working is shown.
 */
export function estimateCredit(i: CreditInput) {
  const valid = [i.monthlyPrice, i.outageHours, i.badHours, i.periodHours].every((v) => Number.isFinite(v) && v >= 0) && i.periodHours > 0;
  if (!valid) return null;
  const weighted = Math.min(i.periodHours, i.outageHours + i.badHours * 0.5);
  const amount = Math.round((i.monthlyPrice * weighted) / i.periodHours * 100) / 100;
  return { amount, weightedHours: weighted, working: `${i.monthlyPrice.toFixed(2)} x (${i.outageHours.toFixed(1)} outage hours + half of ${i.badHours.toFixed(1)} slow hours) / ${Math.round(i.periodHours)} hours in the period`, note: "This is a figure to ask your provider about. Providers decide their own credit rules, so it may be more, less or nothing." };
}
/** Counts hours (in 15-minute blocks) with no answers at all, and hours that were slow past the bad line. */
export function badAndOutageHours(samples: Sample[], rule: Rule, blockMs = 15 * 60_000) {
  const blocks = new Map<number, { n: number; lost: number; bad: number }>();
  for (const s of samples) {
    if (s.target !== "outside" || s.vpn) continue;
    const k = Math.floor(s.t / blockMs);
    const b = blocks.get(k) ?? { n: 0, lost: 0, bad: 0 };
    b.n++; if (s.pingMs === null) b.lost++; else if (s.pingMs > rule.bad) b.bad++;
    blocks.set(k, b);
  }
  let out = 0, bad = 0;
  for (const b of blocks.values()) {
    if (b.n < 3) continue;
    if (b.lost / b.n >= 0.9) out++; else if ((b.bad + b.lost) / b.n >= 0.5) bad++;
  }
  const h = blockMs / 3_600_000;
  return { outageHours: out * h, badHours: bad * h };
}

/* ---------- Restart check: did restarting the modem help? ---------- */
export function compareAround(samples: Sample[], t: number, windowMs = 30 * 60_000, now = Date.now()) {
  if (now - t < windowMs) return { ready: false as const, waitMin: Math.ceil((windowMs - (now - t)) / 60_000) };
  const part = (a: number, b: number) => {
    const s = samples.filter((x) => x.target === "outside" && !x.vpn && x.t >= a && x.t < b);
    const ok = s.filter((x) => x.pingMs !== null).map((x) => x.pingMs as number).sort((p, q) => p - q);
    return { n: s.length, medianMs: ok.length ? ok[Math.floor(ok.length / 2)] : null, lossPct: s.length ? ((s.length - ok.length) / s.length) * 100 : 0 };
  };
  const before = part(t - windowMs, t), after = part(t + 2 * 60_000, t + windowMs); // skip the 2 minutes the modem takes to come back
  if (before.n < 10 || after.n < 10) return { ready: true as const, before, after, verdict: "unclear" as const, text: "Not enough tests on one side of the restart to compare. Keep Lagwatch running." };
  const b = before.medianMs ?? Infinity, a = after.medianMs ?? Infinity;
  let verdict: "helped" | "no-change" | "worse";
  if (a < b * 0.7 || (before.lossPct - after.lossPct > 3)) verdict = "helped";
  else if (a > b * 1.3 || (after.lossPct - before.lossPct > 3)) verdict = "worse";
  else verdict = "no-change";
  const text = verdict === "helped" ? "Tests show it was better after the restart. If it slows again within hours, that pattern is worth telling your provider."
    : verdict === "worse" ? "Tests show it was worse after the restart. Give it a little time, then check again."
    : "Tests show no real change after the restart. That is consistent with the cause being somewhere a restart does not reach.";
  return { ready: true as const, before, after, verdict, text };
}
