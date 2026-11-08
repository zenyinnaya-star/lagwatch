import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  PRESETS, validateRule, zoneFor, findIncidents, shouldNotify, buildSegments,
  makeEntry, verifyChain, rollup, diagnose, buildReport, type Rule, type Sample, type ChainEntry,
} from "../src/index.js";

const ping: Rule = { metric: "ping", good: 50, bad: 100, sustainSec: 30 };
const down: Rule = { metric: "download", good: 25, bad: 10, sustainSec: 60 };

describe("rules", () => {
  it("classifies ping zones", () => {
    expect(zoneFor(ping, 20)).toBe("good");
    expect(zoneFor(ping, 80)).toBe("warning");
    expect(zoneFor(ping, 247)).toBe("bad");
  });
  it("classifies download zones (higher is better)", () => {
    expect(zoneFor(down, 40)).toBe("good");
    expect(zoneFor(down, 15)).toBe("warning");
    expect(zoneFor(down, 5)).toBe("bad");
  });
  it("rejects rules that could never fire", () => {
    expect(validateRule({ ...ping, good: 200, bad: 100 })).not.toBeNull();
    expect(validateRule({ ...down, good: 5, bad: 10 })).not.toBeNull();
    expect(validateRule({ ...ping, good: NaN })).not.toBeNull();
    expect(validateRule(ping)).toBeNull();
  });
  it("every preset is valid", () => {
    for (const rules of Object.values(PRESETS)) for (const r of rules) expect(validateRule(r)).toBeNull();
  });
  it("only reports incidents that last long enough", () => {
    const mk = (secs: number[], v: number) => secs.map((s) => ({ t: s * 1000, value: v }));
    const short = [...mk([0, 5, 10], 200), { t: 15000, value: 20 }];
    expect(findIncidents(ping, short)).toHaveLength(0);
    const long = [...mk([0, 10, 20, 30, 40], 200), { t: 45000, value: 20 }];
    const inc = findIncidents(ping, long);
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ startT: 0, endT: 45000, worst: 200 });
  });
  it("keeps an ongoing incident open", () => {
    const r = [0, 20, 40].map((s) => ({ t: s * 1000, value: 300 }));
    expect(findIncidents(ping, r)[0].endT).toBeNull();
  });
  it("respects repeat gap and quiet hours", () => {
    const inc = { metric: "ping" as const, startT: 0, endT: null, worst: 300 };
    const opts = { repeatGapMs: 300_000 };
    expect(shouldNotify(inc, null, 1000, opts)).toBe(true);
    expect(shouldNotify(inc, 1000, 100_000, opts)).toBe(false);
    expect(shouldNotify(inc, 1000, 400_000, opts)).toBe(true);
    const at3am = new Date(2026, 0, 1, 3).getTime();
    const quiet = { repeatGapMs: 0, quietHours: { startHour: 22, endHour: 7, allowBad: false } };
    expect(shouldNotify(inc, null, at3am, quiet)).toBe(false);
    expect(shouldNotify(inc, null, at3am, { ...quiet, quietHours: { ...quiet.quietHours, allowBad: true } })).toBe(true);
  });
});

describe("segments", () => {
  it("marks a long gap as asleep, not an outage", () => {
    const s: Sample[] = [0, 5000, 10000, 3_600_000, 3_605_000].map((t) => ({ t, target: "outside", pingMs: 20 }));
    const segs = buildSegments(s, 5000);
    expect(segs.map((x) => x.kind)).toEqual(["measured", "asleep", "measured"]);
  });
  it("separates vpn stretches", () => {
    const s: Sample[] = [0, 5000, 10000].map((t, i) => ({ t, target: "outside", pingMs: 20, vpn: i === 1 }));
    expect(buildSegments(s, 5000).map((x) => x.kind)).toEqual(["measured", "vpn", "measured"]);
  });
});

describe("hash chain", () => {
  const build = (n: number) => {
    const out: ChainEntry[] = [];
    let prev: ChainEntry | null = null;
    for (let i = 0; i < n; i++) { prev = makeEntry(prev, 1000 + i, "sample", { ms: i }); out.push(prev); }
    return out;
  };
  it("verifies an untouched chain", () => expect(verifyChain(build(50)).ok).toBe(true));
  it("detects a changed entry", () => {
    const c = build(10);
    c[4] = { ...c[4], payload: { ms: 9999 } };
    expect(verifyChain(c)).toMatchObject({ ok: false, firstBrokenSeq: 5, reason: "entry was changed" });
  });
  it("detects a deleted entry", () => {
    const c = build(10);
    c.splice(3, 1);
    expect(verifyChain(c).ok).toBe(false);
  });
  it("detects a rewritten entry with a recomputed hash", () => {
    const c = build(10);
    const fake = makeEntry(c[2], 1003, "sample", { ms: 777 });
    c[3] = fake;
    expect(verifyChain(c).ok).toBe(false);
  });
  it("any single-field tamper breaks the chain (property)", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 19 }), fc.integer(), (idx, v) => {
      const c = build(20);
      if ((c[idx].payload as { ms: number }).ms === v) return true;
      c[idx] = { ...c[idx], payload: { ms: v } };
      return !verifyChain(c).ok;
    }));
  });
});

describe("rollup", () => {
  it("computes min, avg, max, p95 and loss per minute", () => {
    const s: Sample[] = [10, 20, 30, 40].map((ms, i) => ({ t: i * 1000, target: "outside", pingMs: ms }));
    s.push({ t: 5000, target: "outside", pingMs: null });
    const [r] = rollup(s);
    expect(r).toMatchObject({ count: 5, lost: 1, min: 10, max: 40, avg: 25, p95: 40 });
  });
  it("keeps targets separate", () => {
    const s: Sample[] = [{ t: 0, target: "gateway", pingMs: 1 }, { t: 0, target: "outside", pingMs: 9 }];
    expect(rollup(s)).toHaveLength(2);
  });
});

const mkSamples = (n: number, gw: number, out: number | null): Sample[] => {
  const arr: Sample[] = [];
  for (let i = 0; i < n; i++) {
    arr.push({ t: i * 5000, target: "gateway", pingMs: gw });
    arr.push({ t: i * 5000, target: "outside", pingMs: out });
  }
  return arr;
};

describe("verdict", () => {
  const plan = { downMbps: 100, connection: "wired" as const };
  const speeds = [1, 2, 3].map((i) => ({ t: i, downMbps: 25, upMbps: 5, source: "cloudflare" as const }));
  it("waits for enough data", () => {
    expect(diagnose({ samples: mkSamples(3, 2, 20), speeds: [], pingRule: ping }).where).toBe("unclear");
  });
  it("healthy when inside the lines", () => {
    const v = diagnose({ samples: mkSamples(100, 2, 20), speeds: [{ ...speeds[0], downMbps: 95 }], plan, pingRule: ping });
    expect(v.where).toBe("healthy");
  });
  it("beyond the router when the router is fine but outside is slow (the Telus case)", () => {
    const v = diagnose({ samples: mkSamples(150, 2, 247), speeds, plan, pingRule: ping });
    expect(v.where).toBe("beyond-router");
    expect(v.detail).toMatch(/consistent with/);
    expect(v.detail).not.toMatch(/fault|blame|guilty/i);
  });
  it("local when the router itself is slow", () => {
    expect(diagnose({ samples: mkSamples(100, 180, 250), speeds, plan, pingRule: ping }).where).toBe("local");
  });
  it("ignores vpn samples", () => {
    const vpn = mkSamples(100, 2, 400).map((s) => ({ ...s, vpn: true }));
    expect(diagnose({ samples: vpn, speeds: [], pingRule: ping }).where).toBe("unclear");
  });
  it("low confidence on little data, higher with more", () => {
    const small = diagnose({ samples: mkSamples(25, 2, 247), speeds, plan, pingRule: ping });
    const big = diagnose({ samples: mkSamples(300, 2, 247), speeds, plan, pingRule: ping });
    expect(small.confidence).toBe("low");
    expect(big.confidence).toBe("high");
  });
});

describe("report", () => {
  const verdict = diagnose({ samples: mkSamples(150, 2, 247), speeds: [], pingRule: ping });
  const base = { generatedAt: 5, rangeStart: 0, rangeEnd: 1000, verdict, rules: [ping], ruleChanges: [], excluded: { vpnMinutes: 12, asleepMinutes: 480 } };
  it("includes disclaimers, exclusions and a stable fingerprint", () => {
    let prev: ChainEntry | null = null; const chain: ChainEntry[] = [];
    for (let i = 0; i < 5; i++) { prev = makeEntry(prev, i, "s", i); chain.push(prev); }
    const a = buildReport({ ...base, chain });
    const b = buildReport({ ...base, chain });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.text).toContain("do not guarantee an outcome");
    expect(a.text).toContain("12 minutes with a VPN on");
    expect(a.chainOk).toBe(true);
  });
  it("flags a broken chain in the report", () => {
    const c = [makeEntry(null, 1, "s", 1), makeEntry(null, 2, "s", 2)];
    const r = buildReport({ ...base, chain: c });
    expect(r.chainOk).toBe(false);
    expect(r.text).toContain("FAILED");
  });
});

import { detectGame, buildHeatmap, validateGameTargets, summarizeGamePings, diagnoseWifi, estimateCredit, badAndOutageHours, compareAround } from "../src/index.js";
describe("tools", () => {
  const rule = { metric: "ping", good: 50, bad: 100, sustainSec: 30 } as const;
  const S = (t: number, pingMs: number | null) => ({ t, target: "outside" as const, pingMs });
  it("detects games by whole process name only", () => {
    expect(detectGame(["chrome.exe", "VALORANT.exe"])).toBe("valorant");
    expect(detectGame(["codec-helper", "notepad"])).toBeNull();
  });
  it("heatmap finds the worst weekday hour", () => {
    const base = Date.UTC(2026, 5, 1, 20); // a Monday, 20:00 UTC
    const samples = Array.from({ length: 40 }, (_, i) => S(base + i * 60_000, 300)).concat(Array.from({ length: 40 }, (_, i) => S(base + 3_600_000 * 3 + i * 60_000, 20)));
    const h = buildHeatmap(samples, rule as any);
    expect(h.worst).toEqual({ day: 1, hour: 20 });
    expect(h.cells[1][23].badPct).toBe(0);
  });
  it("rejects private or malformed game servers", () => {
    expect(validateGameTargets([{ name: "x", host: "192.168.1.5", port: 80 }])).toMatch(/public/);
    expect(validateGameTargets([{ name: "x", host: "a b", port: 80 }])).toMatch(/valid/);
    expect(validateGameTargets([{ name: "x", host: "example.com", port: 70000 }])).toMatch(/Port/);
    expect(validateGameTargets([{ name: "ok", host: "example.com", port: 443 }])).toBeNull();
  });
  it("summarizes game pings", () => {
    const r = summarizeGamePings("EU", [20, 30, null, 25, 22]);
    expect(r.lossPct).toBe(20); expect(r.medianMs).toBe(25); expect(r.bestMs).toBe(20);
  });
  it("wifi doctor flags weak 2.4 GHz and crowded channels", () => {
    const f = diagnoseWifi({ ssid: "a", signalDbm: -80, channel: 6, frequencyMhz: 2437, linkMbps: 50, security: "WPA2", sameChannelNetworks: 4, strongerNeighbours: 0 }, 100);
    expect(f.filter((x) => x.level !== "ok").length).toBeGreaterThanOrEqual(4);
    expect(diagnoseWifi({ ssid: null } as any, 100)[0].text).toMatch(/not look like/);
  });
  it("credit estimate is prorated, capped, and rejects bad input", () => {
    const e = estimateCredit({ monthlyPrice: 100, outageHours: 36, badHours: 72, periodHours: 720 })!;
    expect(e.amount).toBe(10); expect(e.note).toMatch(/decide/);
    expect(estimateCredit({ monthlyPrice: 100, outageHours: 9999, badHours: 0, periodHours: 720 })!.amount).toBe(100);
    expect(estimateCredit({ monthlyPrice: -1, outageHours: 0, badHours: 0, periodHours: 720 })).toBeNull();
  });
  it("counts outage and slow blocks", () => {
    const t0 = 1_000_000_000_000;
    const out = Array.from({ length: 6 }, (_, i) => S(t0 + i * 60_000, null));
    const slow = Array.from({ length: 6 }, (_, i) => S(t0 + 900_000 + i * 60_000, 400));
    const r = badAndOutageHours([...out, ...slow], rule as any);
    expect(r.outageHours).toBe(0.25); expect(r.badHours).toBe(0.25);
  });
  it("restart check compares before and after, and waits when too soon", () => {
    const t = 2_000_000_000_000;
    const mk = (a: number, b: number, v: number) => Array.from({ length: 28 }, (_, i) => S(a + i * 60_000, v));
    const samples = [...mk(t - 30 * 60_000, t, 300), ...mk(t + 2 * 60_000, t + 30 * 60_000, 30)];
    const r: any = compareAround(samples, t, 30 * 60_000, t + 40 * 60_000);
    expect(r.verdict).toBe("helped");
    expect((compareAround(samples, t, 30 * 60_000, t + 10 * 60_000) as any).ready).toBe(false);
  });
});
