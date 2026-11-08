import {
  PRESETS, buildComplaintPack, gradeBufferbloat, diagnoseNat, type BloatResult, type NatResult, DEFAULT_NOTIFY, validateNotify, validateRule, shouldNotify, type NotifySettings, findIncidents, zoneFor, diagnose, buildSegments, buildReport, evidenceSamples,
  COUNTRIES, describeSetup, TECHS, CONNECTIONS, SPEED_TIERS, DEFAULT_SETUP, validateSetup, cleanText, type SetupSettings,
  detectGame, buildHeatmap, validateGameTargets, summarizeGamePings, diagnoseWifi, estimateCredit, badAndOutageHours, compareAround, type GameTarget, type WifiDetail,
  type Plan, type Rule, type Sample, type Zone, type Verdict,
} from "@lagwatch/core";
import { Storage, Monitor, tcpPing } from "@lagwatch/monitor";
import { runSpeedTest } from "./speed.js";
import { runMlabTest, type MlabOptions } from "./mlab.js";
import { ssdpDiscover, getExternalIp, lookupPublicIp } from "./upnp.js";
import { detectWifi, detectWifiDetail, runningProcessNames, type WifiInfo } from "./wifi.js";
import { measureLoadedLatency, type LoadedLatencyOptions } from "./bloat.js";

const MIN = 60_000;
const HOUR = 3_600_000;

export interface Dashboard {
  now: number;
  sample: boolean;
  preset: string;
  plan: Plan;
  setup: { done: boolean; summary: string };
  welcomeSeen: boolean;
  verdict: Verdict;
  live: { t: number; ms: number | null }[];
  stats: {
    download: { value: number | null; zone: Zone | null; pctOfPlan: number | null; series: number[] };
    upload: { value: number | null; zone: Zone | null; series: number[] };
    ping: { value: number | null; zone: Zone | null; series: number[] };
    dropouts: { value: number };
  };
  timeline: { t: number; avg: number | null; max: number | null; zone: Zone | null; kind: "measured" | "asleep" | "vpn" }[];
  hourly: { t: number; down: number | null }[];
  alerts: { t: number; severity: Zone; title: string; detail: string }[];
  integrity: { ok: boolean; checked: number; reason?: string };
  bufferbloat: BloatResult | null;
  nat: NatResult | null;
  speedTests: { enabled: boolean; bytesToday: number; dailyCapBytes: number };
  rules: Rule[];
  presets: string[];
}

export class AppService {
  readonly monitor: Monitor;
  constructor(readonly storage: Storage, monitor?: Monitor) {
    this.monitor = monitor ?? new Monitor({ storage });
  }

  get preset() { return this.storage.getSetting<string>("preset", "Gaming"); }
  get plan(): Plan { return this.storage.getSetting<Plan>("plan", { downMbps: 100, connection: "unknown" }); }
  /** First-run welcome and the user's permission for watching while the window is closed. Both default to off. */
  get welcome(): { seen: boolean; background: boolean; startAtLogin: boolean } {
    return { seen: false, background: false, startAtLogin: false, ...this.storage.getSetting<object>("welcome", {}) };
  }
  setWelcome(w: { seen?: boolean; background?: boolean; startAtLogin?: boolean }, now = Date.now()) {
    const cur = this.welcome;
    const b = (v: unknown, d: boolean) => (v === undefined ? d : v === true);
    const next = { seen: b(w?.seen, cur.seen), background: b(w?.background, cur.background), startAtLogin: b(w?.startAtLogin, cur.startAtLogin) };
    if (next.startAtLogin && !next.background) next.startAtLogin = false; // starting at login only makes sense if watching in the background is allowed
    this.storage.setSetting("welcome", next, now);
    return next;
  }
  get setup(): SetupSettings { return { ...DEFAULT_SETUP, ...this.storage.getSetting<Partial<SetupSettings>>("setup", {}) }; }
  get rules(): Rule[] {
    if (this.preset === "Custom") return this.storage.getSetting<Rule[]>("customRules", PRESETS.Gaming);
    return PRESETS[this.preset] ?? PRESETS.Gaming;
  }
  get notify(): NotifySettings { return this.storage.getSetting<NotifySettings>("notify", DEFAULT_NOTIFY); }
  get presetNames() { return [...Object.keys(PRESETS), "Custom"]; }
  private alertState = { active: false, lastNotified: null as number | null };
  rule(metric: Rule["metric"]) { return this.rules.find((r) => r.metric === metric)!; }

  setPreset(name: string) {
    if (name !== "Custom" && !PRESETS[name]) throw new Error("Unknown preset");
    if (name === "Custom" && !this.storage.getSetting<Rule[] | null>("customRules", null)) {
      this.storage.setSetting("customRules", this.rules);
    }
    this.storage.setSetting("preset", name);
  }

  /** Saves the user's own good and bad lines. Every metric is required and checked so no rule can silently never fire. */
  setCustomRules(rules: Rule[]) {
    const metrics = ["ping", "loss", "download", "upload"];
    if (rules.length !== 4 || !metrics.every((m) => rules.some((r) => r.metric === m))) throw new Error("All four rules are needed.");
    for (const r of rules) {
      const e = validateRule(r);
      if (e) throw new Error(`${r.metric}: ${e}`);
    }
    this.storage.setSetting("customRules", metrics.map((m) => rules.find((r) => r.metric === m)));
    if (this.preset !== "Custom") this.storage.setSetting("preset", "Custom");
  }

  setNotify(n: NotifySettings) {
    const e = validateNotify(n);
    if (e) throw new Error(e);
    this.storage.setSetting("notify", n);
  }

  settings() {
    return { preset: this.preset, presets: this.presetNames, rules: this.rules, notify: this.notify, plan: this.plan, setup: this.setup, welcome: this.welcome, mlab: this.mlab, gameTargets: this.gameTargets, catalog: { countries: COUNTRIES, techs: TECHS, connections: CONNECTIONS, speedTiers: SPEED_TIERS },
      complaint: this.storage.getSetting("complaint", { isp: "", accountHolder: "", callerName: "" }) };
  }

  /** Saves the full plan and setup. Also keeps the older plan setting in step so the verdict and report use it. */
  setSetup(input: SetupSettings, now = Date.now()) {
    const s: SetupSettings = {
      country: String(input?.country), region: cleanText(input?.region, 60), provider: cleanText(input?.provider, 60),
      tech: input?.tech, connection: input?.connection, downMbps: Number(input?.downMbps),
      upMbps: input?.upMbps === null || input?.upMbps === undefined || (input.upMbps as unknown) === "" ? null : Number(input.upMbps),
      wifiName: cleanText(input?.wifiName, 64), done: true,
    };
    const e = validateSetup(s);
    if (e) throw new Error(e);
    this.storage.setSetting("setup", s, now);
    this.setPlan({ downMbps: s.downMbps, upMbps: s.upMbps ?? undefined, connection: s.connection } as Plan);
    return s;
  }

  wifi(detect: () => Promise<WifiInfo> = detectWifi) { return detect(); }

  /**
   * What to tell the user right now. One notice when a bad stretch starts, one when it clears, nothing
   * inside the repeat gap or quiet hours. The desktop shell calls this every few seconds.
   */
  pendingNotifications(now = Date.now(), gameActive = false) {
    this.storage.flush(now);
    const n = this.notify;
    const rule = this.rule("ping");
    const readings = this.storage.samplesSince(now - 30 * MIN)
      .filter((s) => s.target === "outside" && !s.vpn && s.pingMs !== null)
      .map((s) => ({ t: s.t, value: s.pingMs as number }));
    const ongoing = findIncidents(rule, readings).find((i) => i.endT === null);
    const out: { kind: "bad" | "recovered"; title: string; detail: string; popup: NotifySettings["popup"]; sound: string; volume: number }[] = [];
    const quiet = n.quiet.enabled ? n.quiet : undefined;
    const hold = gameActive && n.gameMode === "hold-all";
    const popup = gameActive && n.gameMode === "sound-only" ? "off" : n.popup;
    if (ongoing && !this.alertState.active) {
      this.alertState.active = true;
      const ok = shouldNotify(ongoing, this.alertState.lastNotified, now, { repeatGapMs: n.repeatGapMin * MIN, quietHours: quiet });
      if (ok && !hold) {
        this.alertState.lastNotified = now;
        out.push({ kind: "bad", title: `Ping above ${rule.bad} ms`, detail: `Worst ${Math.round(ongoing.worst)} ms. Tests show your connection is struggling.`, popup, sound: n.sounds.bad, volume: n.volume });
      }
    } else if (!ongoing && this.alertState.active) {
      this.alertState.active = false;
      const inQuiet = quiet && !shouldNotify({ metric: "ping", startT: 0, endT: null, worst: 0 }, null, now, { repeatGapMs: 0, quietHours: { ...quiet, allowBad: false } });
      if (!inQuiet && !hold && this.alertState.lastNotified !== null) {
        out.push({ kind: "recovered", title: "Back to normal", detail: "Ping is inside your good line again.", popup, sound: n.sounds.recovered, volume: n.volume });
      }
    }
    return out;
  }

  setPlan(p: Plan) {
    if (!(p.downMbps > 0 && p.downMbps < 100_000)) throw new Error("Plan speed must be a positive number");
    if (!["wired", "wifi", "unknown"].includes(p.connection)) throw new Error("Bad connection type");
    this.storage.setSetting("plan", p);
  }

  static readonly MLAB_DAILY_LIMIT = 4;
  static readonly MLAB_MIN_GAP_MS = 30 * MIN;
  get mlab() {
    const on = this.storage.getSetting("mlab", false);
    const day = (n: number) => new Date(n).toDateString();
    const r = this.storage.getSetting<{ day: string; count: number; last: number }>("mlabRuns", { day: "", count: 0, last: 0 });
    return { enabled: on, used: r.day === day(Date.now()) ? r.count : 0, limit: AppService.MLAB_DAILY_LIMIT };
  }
  /** Separate consent for M-Lab: it publishes the tester's IP address and uses more data than the small built-in test. */
  setMlab(enabled: boolean) { this.storage.setSetting("mlab", Boolean(enabled)); }

  /** One M-Lab test on the user's click. Needs the M-Lab opt-in, at most 4 a day, at least 30 minutes apart. */
  async mlabTest(o: MlabOptions = {}, now = Date.now()) {
    if (!this.storage.getSetting("mlab", false)) throw new Error("M-Lab tests are off. Turn them on first.");
    const day = new Date(now).toDateString();
    const r = this.storage.getSetting<{ day: string; count: number; last: number }>("mlabRuns", { day, count: 0, last: 0 });
    const count = r.day === day ? r.count : 0;
    if (count >= AppService.MLAB_DAILY_LIMIT) throw new Error(`M-Lab allows ${AppService.MLAB_DAILY_LIMIT} tests a day from one program. Try again tomorrow.`);
    if (r.last && now - r.last < AppService.MLAB_MIN_GAP_MS) throw new Error("Wait at least 30 minutes between M-Lab tests.");
    this.storage.setSetting("mlabRuns", { day, count: count + 1, last: now }, now); // counted before the run, so a failed run cannot be retried in a loop
    const res = await runMlabTest(o);
    this.storage.addSpeed({ t: now, downMbps: res.downMbps, upMbps: res.upMbps, source: "mlab" });
    this.storage.audit("mlab-test", { bytes: res.bytesUsed, machine: res.machine }, now);
    return res;
  }

  /* ---- Tools: game mode, heatmap, game server ping, Wi-Fi doctor, credit estimate, restart check ---- */

  /** The name of a game that is running now, or null. Only looked for when game mode is not "normal". Names only. */
  async gameActive(list: () => Promise<string[]> = runningProcessNames): Promise<string | null> {
    if (this.notify.gameMode === "normal") return null;
    try { return detectGame(await list()); } catch { return null; }
  }

  heatmap(days = 14, tzOffsetMin = 0, now = Date.now()) {
    this.storage.flush(now);
    const d = Math.min(30, Math.max(1, Math.floor(days)));
    return buildHeatmap(evidenceSamples(this.storage.samplesSince(now - d * 24 * HOUR)), this.rule("ping"), tzOffsetMin);
  }

  get gameTargets(): GameTarget[] { return this.storage.getSetting<GameTarget[]>("gameTargets", []); }
  setGameTargets(list: GameTarget[]) {
    const clean = (Array.isArray(list) ? list : []).map((t) => ({ name: cleanText(t?.name, 40), host: cleanText(t?.host, 253).toLowerCase(), port: Number(t?.port) }));
    const e = validateGameTargets(clean);
    if (e) throw new Error(e);
    this.storage.setSetting("gameTargets", clean);
    return clean;
  }
  /** Five quick connection tests to each saved game server. One run at a time, at least 10 seconds apart. */
  private gamePingAt = 0;
  async gamePing(ping: typeof tcpPing = tcpPing, now = Date.now()) {
    const targets = this.gameTargets;
    if (!targets.length) throw new Error("Add a game server first.");
    if (now - this.gamePingAt < 10_000 && this.gamePingAt) throw new Error("Wait a few seconds before testing again.");
    this.gamePingAt = now;
    const out = [];
    for (const t of targets) {
      const readings: (number | null)[] = [];
      for (let i = 0; i < 5; i++) readings.push(await ping({ host: t.host, port: t.port }, 2000));
      out.push(summarizeGamePings(t.name, readings));
    }
    return out;
  }

  async wifiDoctor(detect: () => Promise<WifiDetail> = detectWifiDetail) {
    const d = await detect();
    return { detail: { ...d, ssid: undefined, signalDbm: d.signalDbm, connected: d.ssid !== null }, findings: diagnoseWifi(d, this.plan.downMbps) };
  }

  /** A figure to ask the provider about, from the last 30 days of this computer's tests. */
  creditEstimate(monthlyPrice: number, days = 30, now = Date.now()) {
    const d = Math.min(31, Math.max(1, Math.floor(days)));
    this.storage.flush(now);
    const samples = evidenceSamples(this.storage.samplesSince(now - d * 24 * HOUR));
    const hrs = badAndOutageHours(samples, this.rule("ping"));
    const est = estimateCredit({ monthlyPrice: Number(monthlyPrice), outageHours: hrs.outageHours, badHours: hrs.badHours, periodHours: d * 24 });
    if (!est) throw new Error("Enter your monthly price as a number.");
    const covered = samples.length ? Math.min(d * 24, (samples[samples.length - 1].t - samples[0].t) / HOUR) : 0;
    return { ...hrs, ...est, days: d, coveredHours: Math.round(covered), partial: covered < d * 24 * 0.8 };
  }

  markRestart(now = Date.now()) {
    this.storage.setSetting("lastRestart", { t: now }, now);
    this.storage.audit("restart-marked", {}, now);
    return { t: now };
  }
  restartCheck(now = Date.now()) {
    const r = this.storage.getSetting<{ t: number } | null>("lastRestart", null);
    if (!r) return null;
    this.storage.flush(now);
    const samples = evidenceSamples(this.storage.samplesSince(r.t - 35 * MIN));
    return { t: r.t, ...compareAround(samples, r.t, 30 * MIN, now) };
  }

  setSpeedTests(enabled: boolean) { this.storage.setSetting("speedtests", enabled); }

  /** User-approved, size-capped speed test. Refuses when not opted in or the daily data cap is used up. */
  async speedTest(fetchImpl?: typeof fetch, now = Date.now()) {
    if (!this.storage.getSetting("speedtests", false)) throw new Error("Speed tests are off. Turn them on first.");
    const cap = this.storage.getSetting("dailyCapBytes", 100_000_000);
    const day = new Date(now).toDateString();
    const used = this.storage.getSetting<{ day: string; bytes: number }>("bytesToday", { day, bytes: 0 });
    const bytes = used.day === day ? used.bytes : 0;
    if (bytes >= cap) throw new Error("Daily speed test data cap reached.");
    const r = await runSpeedTest({ fetchImpl });
    this.storage.raw().prepare("INSERT INTO kv VALUES ('bytesToday', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify({ day, bytes: bytes + r.bytesUsed }));
    this.storage.addSpeed({ t: now, downMbps: r.downMbps, upMbps: r.upMbps, source: "cloudflare" });
    return r;
  }

  /** Same opt-in and daily data cap as the speed test. Saves the grade and records the run in the audit log. */
  async bufferbloat(opts: LoadedLatencyOptions = {}, now = Date.now()): Promise<BloatResult> {
    if (!this.storage.getSetting("speedtests", false)) throw new Error("Speed tests are off. Turn them on first.");
    const cap = this.storage.getSetting("dailyCapBytes", 100_000_000);
    const day = new Date(now).toDateString();
    const used = this.storage.getSetting<{ day: string; bytes: number }>("bytesToday", { day, bytes: 0 });
    const bytes = used.day === day ? used.bytes : 0;
    if (bytes >= cap) throw new Error("Daily speed test data cap reached.");
    const r = await measureLoadedLatency(opts);
    this.storage.raw().prepare("INSERT INTO kv VALUES ('bytesToday', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(JSON.stringify({ day, bytes: bytes + r.bytesUsed }));
    const res = gradeBufferbloat(r.idle, r.loaded, now);
    if (!res) throw new Error("Not enough replies to grade this. Check your connection and try again.");
    this.storage.setSetting("bufferbloat", res, now);
    return res;
  }

  /**
   * Looks for a UPnP router on the home network and, only if the user allowed network tests, compares its
   * outside address with the public one. No router login is used. The result is saved and audited.
   */
  async natCheck(deps: { discover?: () => Promise<string | null>; externalIp?: (loc: string) => Promise<string | null>; publicIp?: () => Promise<string | null> } = {}, now = Date.now()): Promise<NatResult> {
    const loc = await (deps.discover ?? ssdpDiscover)();
    let externalIp: string | null = null;
    if (loc) {
      try { externalIp = await (deps.externalIp ?? getExternalIp)(loc); } catch { externalIp = null; }
    }
    let publicIp: string | null = null;
    if (this.storage.getSetting("speedtests", false)) {
      try { publicIp = await (deps.publicIp ?? lookupPublicIp)(); } catch { publicIp = null; }
    }
    const res = diagnoseNat({ upnpFound: loc !== null, externalIp, publicIp }, now);
    this.storage.setSetting("nat", res, now);
    return res;
  }

  /** Builds the problem list and call script from this device's measurements, plus the full report. */
  complaintPack(info: { isp: string; accountHolder: string; callerName: string }, hours = 24, now = Date.now()) {
    const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
    const person = { isp: clean(info.isp, 60) || this.setup.provider || "your provider", accountHolder: clean(info.accountHolder, 80), callerName: clean(info.callerName, 80) };
    this.storage.setSetting("complaint", person, now);
    const since = now - hours * HOUR;
    this.storage.flush(now);
    const all = evidenceSamples(this.storage.samplesSince(since));
    const speeds = this.storage.speedsSince(since).filter((x) => !x.vpn);
    const out = all.filter((x) => x.target === "outside");
    const gw = all.filter((x) => x.target === "gateway" && x.pingMs !== null).map((x) => x.pingMs as number).sort((a, b) => a - b);
    const okPings = out.filter((x) => x.pingMs !== null).map((x) => x.pingMs as number).sort((a, b) => a - b);
    const med = (v: number[]) => (v.length ? v[Math.floor(v.length / 2)] : null);
    const dash = this.dashboard(now);
    const pingRule = this.rule("ping");
    const badBuckets = dash.timeline.filter((b) => b.zone === "bad" && b.kind === "measured").length;
    const rep = this.report(hours, now);
    const pack = buildComplaintPack({
      ...person, hours, connection: this.plan.connection, tech: this.setup.tech, body: COUNTRIES[this.setup.country]?.body, planDownMbps: this.plan.downMbps,
      bestDownMbps: speeds.length ? Math.max(...speeds.map((x) => x.downMbps)) : null,
      latestUpMbps: speeds.length ? speeds[speeds.length - 1].upMbps : null,
      zeroUploads: speeds.filter((x) => x.upMbps < 0.1).length,
      pingMedianMs: med(okPings), routerPingMs: med(gw), pingGoodMs: pingRule.good, pingBadMs: pingRule.bad,
      badPingHours: (badBuckets * 15) / 60,
      lossPct: out.length ? ((out.length - okPings.length) / out.length) * 100 : 0,
      dropouts: dash.stats.dropouts.value, bloat: dash.bufferbloat, nat: dash.nat, reportFingerprint: rep.fingerprint,
    });
    this.storage.audit("complaint-pack-created", { hours, problems: pack.problems.length, fingerprint: rep.fingerprint }, now);
    return { ...pack, report: rep.text, fingerprint: rep.fingerprint, chainOk: rep.chainOk };
  }

  dashboard(now = Date.now()): Dashboard {
    this.storage.flush(now);
    const since = now - 24 * HOUR;
    const all = this.storage.samplesSince(since);
    const speeds = this.storage.speedsSince(since);
    const ev = evidenceSamples(all);
    const out = ev.filter((s) => s.target === "outside");
    const pingRule = this.rule("ping");
    const downRule = this.rule("download");
    const upRule = this.rule("upload");

    const verdict = diagnose({ samples: all, speeds, plan: this.plan, pingRule });
    const live = all.filter((s) => s.target === "outside" && s.t >= now - 5 * MIN).map((s) => ({ t: s.t, ms: s.pingMs }));

    const lastOut = out[out.length - 1];
    const lastSpeed = [...speeds].reverse().find((s) => !s.vpn);
    const series = (vals: number[]) => vals.slice(-24);

    // timeline: 15-minute buckets, with sleep and VPN marked from segments
    const BUCKET = 15 * MIN;
    const timeline: Dashboard["timeline"] = [];
    for (let t = Math.floor(since / BUCKET) * BUCKET; t < now; t += BUCKET) {
      const b = all.filter((s) => s.target === "outside" && s.t >= t && s.t < t + BUCKET);
      const vals = b.filter((s) => s.pingMs !== null).map((s) => s.pingMs as number);
      const kind = b.length === 0 ? "asleep" : b.every((s) => s.vpn) ? "vpn" : "measured";
      const avg = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null;
      timeline.push({ t, avg, max: vals.length ? Math.max(...vals) : null, zone: avg === null ? null : zoneFor(pingRule, avg), kind: kind as any });
    }

    const hourly: Dashboard["hourly"] = [];
    for (let h = 23; h >= 0; h--) {
      const start = Math.floor((now - h * HOUR) / HOUR) * HOUR;
      const v = speeds.filter((s) => !s.vpn && s.t >= start && s.t < start + HOUR).map((s) => s.downMbps);
      hourly.push({ t: start, down: v.length ? Math.max(...v) : null });
    }

    // dropouts: runs of 2 or more lost outside samples, plus speed tests where upload hit zero
    let dropouts = 0;
    let run = 0;
    for (const s of out) {
      if (s.pingMs === null) { run++; if (run === 2) dropouts++; } else run = 0;
    }
    dropouts += speeds.filter((s) => !s.vpn && s.upMbps < 0.1).length;

    const alerts: Dashboard["alerts"] = [];
    const readings = out.filter((s) => s.pingMs !== null).map((s) => ({ t: s.t, value: s.pingMs as number }));
    for (const i of findIncidents(pingRule, readings)) {
      alerts.push({ t: i.startT, severity: "bad", title: `Ping above ${pingRule.bad} ms`, detail: `Worst ${Math.round(i.worst)} ms. Rule: over ${pingRule.bad} ms for ${pingRule.sustainSec} seconds.` });
    }
    for (const s of speeds) {
      if (s.vpn) continue;
      if (s.upMbps < 0.1) alerts.push({ t: s.t, severity: "bad", title: "Upload dropped to zero", detail: "A speed test could not send data." });
      else if (zoneFor(upRule, s.upMbps) === "bad") alerts.push({ t: s.t, severity: "bad", title: "Upload very low", detail: `${s.upMbps.toFixed(1)} Mbps, under your ${upRule.bad} Mbps line.` });
      if (zoneFor(downRule, s.downMbps) === "bad") alerts.push({ t: s.t, severity: "warning", title: "Download under your bad line", detail: `${s.downMbps.toFixed(0)} Mbps, under ${downRule.bad} Mbps.` });
    }
    alerts.sort((a, b) => b.t - a.t);

    const integrity = this.storage.verify();
    const usedRow = this.storage.getSetting<{ day: string; bytes: number }>("bytesToday", { day: "", bytes: 0 });
    return {
      now,
      sample: this.storage.getSetting("sample", false),
      preset: this.preset,
      plan: this.plan,
      setup: { done: this.setup.done, summary: describeSetup(this.setup) },
      welcomeSeen: this.welcome.seen,
      verdict,
      live,
      stats: {
        download: {
          value: lastSpeed?.downMbps ?? null,
          zone: lastSpeed ? zoneFor(downRule, lastSpeed.downMbps) : null,
          pctOfPlan: lastSpeed ? Math.round((lastSpeed.downMbps / this.plan.downMbps) * 100) : null,
          series: series(speeds.map((s) => s.downMbps)),
        },
        upload: { value: lastSpeed?.upMbps ?? null, zone: lastSpeed ? zoneFor(upRule, lastSpeed.upMbps) : null, series: series(speeds.map((s) => s.upMbps)) },
        ping: { value: lastOut?.pingMs ?? null, zone: lastOut?.pingMs != null ? zoneFor(pingRule, lastOut.pingMs) : null, series: series(readings.map((r) => r.value)) },
        dropouts: { value: dropouts },
      },
      timeline, hourly, alerts: alerts.slice(0, 6),
      integrity: { ok: integrity.ok, checked: integrity.checked, reason: integrity.reason },
      bufferbloat: this.storage.getSetting<BloatResult | null>("bufferbloat", null),
      nat: this.storage.getSetting<NatResult | null>("nat", null),
      speedTests: {
        enabled: this.storage.getSetting("speedtests", false),
        bytesToday: usedRow.day === new Date(now).toDateString() ? usedRow.bytes : 0,
        dailyCapBytes: this.storage.getSetting("dailyCapBytes", 100_000_000),
      },
      rules: this.rules,
      presets: this.presetNames,
    };
  }

  report(hours = 24, now = Date.now()) {
    const since = now - hours * HOUR;
    const all = this.storage.samplesSince(since);
    const speeds = this.storage.speedsSince(since);
    const verdict = diagnose({ samples: all, speeds, plan: this.plan, pingRule: this.rule("ping") });
    const segs = buildSegments(all, 5000);
    const mins = (k: string) => Math.round(segs.filter((s) => s.kind === k).reduce((a, s) => a + (s.endT - s.startT), 0) / MIN);
    const changes = this.storage.chain()
      .filter((e) => e.kind === "audit:setting-changed" && e.t >= since && ["preset", "plan"].includes((e.payload as any).key))
      .map((e) => ({ t: e.t, description: `${(e.payload as any).key} changed to ${JSON.stringify((e.payload as any).to)}` }));
    const r = buildReport({
      generatedAt: now, rangeStart: since, rangeEnd: now, verdict, rules: this.rules, ruleChanges: changes,
      excluded: { vpnMinutes: mins("vpn"), asleepMinutes: mins("asleep") }, chain: this.storage.chain(),
    });
    this.storage.audit("report-exported", { fingerprint: r.fingerprint, hours }, now);
    return r;
  }
}
