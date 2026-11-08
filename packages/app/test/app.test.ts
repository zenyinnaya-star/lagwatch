import { describe, it, expect } from "vitest";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "@lagwatch/monitor";
import { AppService } from "../src/service.js";
import { createServer } from "../src/server.js";
import { runSpeedTest } from "../src/speed.js";
import { seedDemo } from "../src/seed.js";

const tmp = () => join(mkdtempSync(join(tmpdir(), "lwa-")), "t.db");
const demo = () => { const s = new Storage(tmp()); seedDemo(s); return new AppService(s); };

describe("service with a bad-ISP day", () => {
  it("says the problem is beyond the router and counts dropouts", () => {
    const d = demo().dashboard();
    expect(d.sample).toBe(true);
    expect(d.verdict.where).toBe("beyond-router");
    expect(d.stats.dropouts.value).toBeGreaterThan(0);
    expect(d.stats.upload.series.some((v) => v === 0)).toBe(true);
    expect(d.timeline.some((b) => b.kind === "asleep")).toBe(true);
    expect(d.timeline.some((b) => b.kind === "vpn")).toBe(true);
    expect(d.timeline.some((b) => b.zone === "bad")).toBe(true);
    expect(d.alerts.length).toBeGreaterThan(0);
    expect(d.integrity.ok).toBe(true);
    expect(d.live.length).toBeGreaterThan(30);
  });
  it("changing the preset changes the rules and is audited", () => {
    const svc = demo();
    svc.setPreset("Streaming");
    expect(svc.dashboard().rules.find((r) => r.metric === "ping")!.bad).toBe(300);
    expect(svc.storage.chain().some((e) => e.kind === "audit:setting-changed" && (e.payload as any).key === "preset")).toBe(true);
    expect(() => svc.setPreset("Nope")).toThrow();
  });
  it("report lists rule changes and exports once into the audit log", () => {
    const svc = demo();
    svc.setPreset("Work calls");
    const r = svc.report(24);
    expect(r.text).toContain("preset changed");
    expect(r.text).toContain("do not guarantee an outcome");
    expect(r.chainOk).toBe(true);
    expect(svc.storage.chain().filter((e) => e.kind === "audit:report-exported")).toHaveLength(1);
  });
  it("rejects bad plan values", () => {
    const svc = demo();
    expect(() => svc.setPlan({ downMbps: -5, connection: "wired" })).toThrow();
    expect(() => svc.setPlan({ downMbps: 100, connection: "carrier-pigeon" as any })).toThrow();
  });
  it("shows a failed integrity check after tampering", () => {
    const svc = demo();
    svc.storage.raw().prepare("UPDATE samples SET ping_ms = 1 WHERE rowid = 50").run();
    expect(svc.dashboard().integrity.ok).toBe(false);
  });
});

describe("speed tests", () => {
  const fake = (async (url: string, init?: any) => {
    if (String(url).includes("__down")) return new Response(new Uint8Array(Number(new URL(String(url)).searchParams.get("bytes"))));
    return new Response("ok");
  }) as unknown as typeof fetch;
  it("measures with a small payload", async () => {
    const r = await runSpeedTest({ fetchImpl: fake, downBytes: 1_000_000, upBytes: 100_000 });
    expect(r.downMbps).toBeGreaterThan(0);
    expect(r.bytesUsed).toBe(1_100_000);
  });
  it("refuses until the user opts in, then respects the daily cap", async () => {
    const svc = new AppService(new Storage(tmp()));
    await expect(svc.speedTest(fake)).rejects.toThrow(/off/);
    svc.setSpeedTests(true);
    svc.storage.setSetting("dailyCapBytes", 10_000_000);
    await svc.speedTest(fake);
    await expect(svc.speedTest(fake)).rejects.toThrow(/cap/);
    expect(svc.dashboard().stats.download.value).not.toBeNull();
  });
});

describe("local server", () => {
  const start = async () => {
    const svc = demo();
    const srv = createServer(svc, join(process.cwd(), "packages/app/ui")).listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    const port = (srv.address() as any).port;
    const call = (path: string, opts: http.RequestOptions & { body?: string } = {}) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: opts.headers }, (res) => {
          let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode!, body: b }));
        });
        req.on("error", reject); req.end(opts.body);
      });
    return { srv, call };
  };
  it("serves the dashboard and the API", async () => {
    const { srv, call } = await start();
    expect((await call("/")).body).toContain("Lagwatch");
    const d = JSON.parse((await call("/api/dashboard")).body);
    expect(d.verdict.where).toBe("beyond-router");
    srv.close();
  });
  it("blocks foreign Host headers, non-JSON posts, path tricks and huge bodies", async () => {
    const { srv, call } = await start();
    expect((await call("/api/dashboard", { headers: { host: "evil.example.com" } })).status).toBe(403);
    expect((await call("/api/preset", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })).status).toBe(415);
    expect((await call("/../../etc/passwd")).status).toBe(404);
    expect((await call("/api/preset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x".repeat(20000) }) })).status).toBe(400);
    expect((await call("/api/preset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Streaming" }) })).status).toBe(200);
    srv.close();
  });
});

describe("rules and notifications", () => {
  it("custom rules are validated, saved, and switch the preset to Custom", () => {
    const svc = demo();
    const rules = svc.rules.map((r) => (r.metric === "ping" ? { ...r, good: 40, bad: 90 } : r));
    svc.setCustomRules(rules);
    expect(svc.preset).toBe("Custom");
    expect(svc.dashboard().rules.find((r) => r.metric === "ping")).toMatchObject({ good: 40, bad: 90 });
    expect(() => svc.setCustomRules(rules.map((r) => (r.metric === "ping" ? { ...r, good: 200, bad: 100 } : r)))).toThrow(/lower/);
    expect(() => svc.setCustomRules(rules.slice(0, 3))).toThrow(/four/);
  });
  it("notification settings are validated", () => {
    const svc = demo();
    svc.setNotify({ ...svc.notify, volume: 70, popup: "banner" });
    expect(svc.notify).toMatchObject({ volume: 70, popup: "banner" });
    expect(() => svc.setNotify({ ...svc.notify, volume: 500 })).toThrow(/Volume/);
    expect(() => svc.setNotify({ ...svc.notify, popup: "flashbang" as any })).toThrow(/pop-up/);
  });
  const mk = () => {
    const s = new Storage(tmp());
    const svc = new AppService(s);
    const put = (from: number, to: number, ms: number) => { for (let t = from; t <= to; t += 5000) s.addSample({ t, target: "outside", pingMs: ms }); };
    return { s, svc, put };
  };
  it("notifies once when a bad stretch starts and once when it clears", () => {
    const { s, svc, put } = mk();
    const t0 = new Date(2026, 5, 1, 15).getTime();
    put(t0, t0 + 60_000, 250);
    expect(svc.pendingNotifications(t0 + 60_000)).toHaveLength(1);
    expect(svc.pendingNotifications(t0 + 65_000)).toHaveLength(0);
    put(t0 + 65_000, t0 + 120_000, 20);
    const r = svc.pendingNotifications(t0 + 120_000);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("recovered");
    s.flush();
  });
  it("respects the repeat gap, quiet hours and game mode", () => {
    const { svc, put } = mk();
    const t0 = new Date(2026, 5, 1, 3).getTime();
    svc.setNotify({ ...svc.notify, quiet: { enabled: true, startHour: 22, endHour: 7, allowBad: false } });
    put(t0, t0 + 60_000, 250);
    expect(svc.pendingNotifications(t0 + 60_000)).toHaveLength(0);
    const m = mk();
    const t1 = new Date(2026, 5, 1, 15).getTime();
    m.put(t1, t1 + 60_000, 250);
    const g = m.svc.pendingNotifications(t1 + 60_000, true);
    expect(g[0].popup).toBe("off");
    expect(g[0].sound).toBe("chime");
    const h = mk();
    h.svc.setNotify({ ...h.svc.notify, gameMode: "hold-all" });
    h.put(t1, t1 + 60_000, 250);
    expect(h.svc.pendingNotifications(t1 + 60_000, true)).toHaveLength(0);
  });
});

import { gradeBufferbloat, gradeFor } from "@lagwatch/core";
import { measureLoadedLatency } from "../src/bloat.js";

describe("bufferbloat", () => {
  it("grades by added delay", () => {
    expect([2, 20, 45, 120, 400].map(gradeFor)).toEqual(["A", "B", "C", "D", "F"]);
  });
  it("needs enough readings and avoids blame wording", () => {
    expect(gradeBufferbloat([10, 10], [50, 50], 1)).toBeNull();
    const r = gradeBufferbloat([20, 21, 19, 20, 22], [300, 280, 320, 290, 310], 1)!;
    expect(r.grade).toBe("F");
    expect(r.detail).toMatch(/Tests show/);
    expect(r.detail).not.toMatch(/fault|blame/i);
    expect(gradeBufferbloat([20, 21, 19, 20, 22], [40, 42, 41, 44, 43], 1)!.grade).toBe("B");
  });
  const fakeFetch = (async () => {
    await new Promise((r) => setTimeout(r, 700));
    return new Response(new Uint8Array(500_000));
  }) as unknown as typeof fetch;
  it("measures idle and loaded pings around a download", async () => {
    let loadedPhase = false;
    const probe = async () => (loadedPhase ? 250 : 20);
    const p = measureLoadedLatency({ probe, fetchImpl: fakeFetch, downBytes: 500_000 });
    setTimeout(() => (loadedPhase = true), 900);
    const r = await p;
    expect(r.idle.length).toBe(8);
    expect(r.loaded.length).toBeGreaterThan(0);
    expect(r.bytesUsed).toBe(500_000);
  });
  it("is blocked until opted in and saved to the dashboard once run", async () => {
    const svc = new AppService(new Storage(tmp()));
    await expect(svc.bufferbloat()).rejects.toThrow(/off/);
    svc.setSpeedTests(true);
    let n = 0;
    const probe = async () => (++n <= 8 ? 20 : 220);
    const slow = (async () => { await new Promise((r) => setTimeout(r, 600)); return new Response(new Uint8Array(1000)); }) as unknown as typeof fetch;
    const r = await svc.bufferbloat({ probe, fetchImpl: slow, downBytes: 1000 });
    expect(r.grade).toBe("F");
    expect(svc.dashboard().bufferbloat?.grade).toBe("F");
    expect(svc.storage.chain().some((e) => e.kind === "audit:setting-changed" && (e.payload as any).key === "bufferbloat")).toBe(true);
  });
});

import { classifyIp, diagnoseNat } from "@lagwatch/core";
import { parseSsdp, parseDescription, parseExternalIp, getExternalIp } from "../src/upnp.js";

describe("nat check", () => {
  it("classifies addresses", () => {
    expect(["192.168.1.1", "10.0.0.5", "172.20.1.1", "100.64.3.9", "100.127.1.1", "8.8.8.8", "169.254.1.1", "127.0.0.1", "100.128.0.1", "999.1.1.1", "nope"].map(classifyIp))
      .toEqual(["private", "private", "private", "cgnat", "cgnat", "public", "linklocal", "loopback", "public", "invalid", "invalid"]);
  });
  it("finds carrier-grade NAT, double NAT, direct, and UPnP off", () => {
    expect(diagnoseNat({ upnpFound: true, externalIp: "100.72.1.9" }).status).toBe("double-nat");
    expect(diagnoseNat({ upnpFound: true, externalIp: "100.72.1.9" }).headline).toMatch(/share one public address/);
    expect(diagnoseNat({ upnpFound: true, externalIp: "192.168.0.2" }).detail).toMatch(/double NAT/);
    expect(diagnoseNat({ upnpFound: true, externalIp: "203.0.113.7", publicIp: "203.0.113.7" }).status).toBe("direct");
    expect(diagnoseNat({ upnpFound: true, externalIp: "203.0.113.7", publicIp: "198.51.100.2" }).status).toBe("double-nat");
    expect(diagnoseNat({ upnpFound: true, externalIp: "203.0.113.7" }).status).toBe("unclear");
    const off = diagnoseNat({ upnpFound: false });
    expect(off.status).toBe("upnp-off");
    expect(off.steps.length).toBeGreaterThan(1);
    for (const r of [off, diagnoseNat({ upnpFound: true, externalIp: "100.72.1.9" })]) expect(r.detail).not.toMatch(/fault|blame/i);
  });
  const xml = `<root><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></serviceList></device></root>`;
  it("parses router replies", () => {
    expect(parseSsdp("HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.1:5000/rootDesc.xml\r\n\r\n")).toBe("http://192.168.1.1:5000/rootDesc.xml");
    expect(parseDescription(xml, "http://192.168.1.1:5000/rootDesc.xml")).toEqual({ controlUrl: "http://192.168.1.1:5000/ctl/IPConn", serviceType: "urn:schemas-upnp-org:service:WANIPConnection:1" });
    expect(parseDescription("<root/>", "http://x/")).toBeNull();
    expect(parseExternalIp("<NewExternalIPAddress>100.72.1.9</NewExternalIPAddress>")).toBe("100.72.1.9");
  });
  it("reads the external address from a simulated router on the local machine", async () => {
    const igd = http.createServer((req, res) => {
      if (req.method === "POST") { res.end('<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress>100.72.1.9</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>'); return; }
      res.end(xml);
    }).listen(0, "127.0.0.1");
    await new Promise((r) => igd.once("listening", r));
    const port = (igd.address() as any).port;
    expect(await getExternalIp(`http://127.0.0.1:${port}/rootDesc.xml`)).toBe("100.72.1.9");
    igd.close();
  });
  it("refuses to contact devices outside the local network", async () => {
    await expect(getExternalIp("http://8.8.8.8/rootDesc.xml")).rejects.toThrow(/outside the local network/);
    await expect(getExternalIp("https://192.168.1.1/x")).rejects.toThrow();
  });
  it("service saves the result, only looks up the public address when opted in, and audits", async () => {
    const svc = new AppService(new Storage(tmp()));
    let looked = 0;
    const deps = { discover: async () => "http://192.168.1.1/d.xml", externalIp: async () => "203.0.113.7", publicIp: async () => { looked++; return "203.0.113.7"; } };
    expect((await svc.natCheck(deps)).status).toBe("unclear");
    expect(looked).toBe(0);
    svc.setSpeedTests(true);
    expect((await svc.natCheck(deps)).status).toBe("direct");
    expect(looked).toBe(1);
    expect(svc.dashboard().nat?.status).toBe("direct");
    expect(svc.storage.chain().some((e) => e.kind === "audit:setting-changed" && (e.payload as any).key === "nat")).toBe(true);
    expect((await svc.natCheck({ discover: async () => null })).status).toBe("upnp-off");
  });
});

import { buildComplaintPack, type ComplaintInput } from "@lagwatch/core";

describe("complaint pack", () => {
  const base: ComplaintInput = {
    isp: "Telus", accountHolder: "Dad", callerName: "Zach", hours: 24, connection: "wired", planDownMbps: 100,
    bestDownMbps: 25, latestUpMbps: 0, zeroUploads: 1, pingMedianMs: 247, routerPingMs: 2, pingGoodMs: 50, pingBadMs: 100,
    badPingHours: 7.5, lossPct: 3.1, dropouts: 3, nat: null, bloat: null,
  };
  it("lists short numbered problems and specific asks from the measurements", () => {
    const p = buildComplaintPack({ ...base, reportFingerprint: "abcdef0123456789ffff" });
    expect(p.hasProblems).toBe(true);
    expect(p.problems[0]).toMatch(/25 Mbps against a 100 Mbps plan \(25%\) on a wired connection/);
    expect(p.problems.some((x) => /Upload dropped to 0 Mbps once/.test(x))).toBe(true);
    expect(p.problems.some((x) => /7\.5 hours/.test(x))).toBe(true);
    expect(p.asks.some((x) => /line test/.test(x))).toBe(true);
    expect(p.asks.some((x) => /technician/.test(x))).toBe(true);
    expect(p.script).toContain("calling for Dad, who is the account holder");
    expect(p.script).toContain("my router answers in about 2 ms");
    expect(p.script).toContain("ticket number");
    expect(p.script).toContain("abcdef0123456789");
  });
  it("never promises a refund, assigns fault, or states a cause as fact", () => {
    const p = buildComplaintPack({ ...base, nat: { t: 1, status: "double-nat", headline: "", detail: "", steps: [], facts: [] }, bloat: { t: 1, idleMs: 20, loadedMs: 220, peakMs: 300, addedMs: 200, grade: "F", headline: "", detail: "" } });
    const text = p.script + p.escalation;
    expect(text).not.toMatch(/guarantee a refund|you must|your fault|you are lying/i);
    expect(p.script).toMatch(/whether a bill credit is possible/);
    expect(p.escalation).toMatch(/does not guarantee an outcome/);
    expect(p.problems.some((x) => /grade F/.test(x))).toBe(true);
    expect(p.asks.some((x) => /public IP/.test(x))).toBe(true);
  });
  it("speaks as the account holder when they are the caller, and says nothing to report on a good day", () => {
    const own = buildComplaintPack({ ...base, accountHolder: "Zach", callerName: "Zach" });
    expect(own.script).toContain("I'm the account holder");
    const good = buildComplaintPack({ ...base, bestDownMbps: 95, zeroUploads: 0, pingMedianMs: 20, badPingHours: 0, lossPct: 0, dropouts: 0 });
    expect(good.hasProblems).toBe(false);
    expect(good.asks).toHaveLength(0);
    expect(good.script).toMatch(/nothing to report/);
  });
  it("service builds the pack from the demo day, cleans input, saves names, and audits", () => {
    const svc = demo();
    const r = svc.complaintPack({ isp: "Telus\u0000\n", accountHolder: "Dad", callerName: "Zach" });
    expect(r.hasProblems).toBe(true);
    expect(r.escalation).toContain("If Telus does not fix it");
    expect(r.script + r.escalation).not.toContain("\u0000");
    expect(r.problems.length).toBeGreaterThanOrEqual(3);
    expect(r.report).toContain("Lagwatch connection report");
    expect(r.chainOk).toBe(true);
    expect(svc.settings().complaint).toMatchObject({ isp: "Telus", accountHolder: "Dad" });
    expect(svc.storage.chain().some((e) => e.kind === "audit:complaint-pack-created")).toBe(true);
    expect(svc.dashboard().integrity.ok).toBe(true);
  });
});

describe("plan and setup", () => {
  const good = { country: "Canada", region: "Alberta", provider: "Telus", tech: "cable", connection: "wired", downMbps: 100, upMbps: null, wifiName: "", done: false } as any;
  const mk = () => new AppService(new Storage(":memory:"));
  it("saves setup, keeps the plan in step, and shows it on the dashboard", () => {
    const s = mk();
    s.setSetup(good);
    expect(s.plan).toMatchObject({ downMbps: 100, connection: "wired" });
    const d = s.dashboard();
    expect(d.setup.done).toBe(true);
    expect(d.setup.summary).toContain("Telus");
  });
  it("rejects a region that is not in the country and odd plan speeds", () => {
    const s = mk();
    expect(() => s.setSetup({ ...good, region: "Texas" })).toThrow();
    expect(() => s.setSetup({ ...good, downMbps: 0 })).toThrow();
    expect(() => s.setSetup({ ...good, connection: "carrier-pigeon" })).toThrow();
  });
  it("welcome and background watching are off until the user allows them", () => {
    const s = mk();
    expect(s.welcome).toEqual({ seen: false, background: false, startAtLogin: false });
    expect(s.setWelcome({ seen: true, startAtLogin: true }).startAtLogin).toBe(false);
    expect(s.setWelcome({ background: true, startAtLogin: true })).toMatchObject({ background: true, startAtLogin: true });
  });
  it("uses the setup provider, country body and Wi-Fi warning in the complaint pack", () => {
    const s = mk();
    s.setSetup({ ...good, provider: "Rogers", connection: "wifi", wifiName: "Home" });
    const p = s.complaintPack({ isp: "", accountHolder: "A", callerName: "A" }, 24);
    expect(p.escalation).toContain("ccts-cprst.ca");
    expect(p.warnings.join(" ")).toContain("Wi-Fi");
  });
  it("wifi detection can be injected", async () => {
    expect(await mk().wifi(async () => ({ current: "Home", nearby: ["Home"], wired: false }))).toMatchObject({ current: "Home" });
  });
});

describe("M-Lab test", () => {
  const mk = () => new AppService(new Storage(":memory:"));
  const fakeFetch = (async () => ({ ok: true, json: async () => ({ results: [{ machine: "mlab1-xyz", urls: { "wss:///ndt/v7/download": "wss://x.measurementlab.net/ndt/v7/download", "wss:///ndt/v7/upload": "wss://x.measurementlab.net/ndt/v7/upload" } }] }) })) as any;
  const wsFactory = ((url: string) => {
    const ws: any = { binaryType: "", bufferedAmount: 0, onopen: null, onmessage: null, onclose: null, onerror: null, send() {}, close() { setTimeout(() => ws.onclose?.(), 0); } };
    setTimeout(() => { ws.onopen?.(); if (url.endsWith("download")) for (let i = 0; i < 50; i++) setTimeout(() => ws.onmessage?.({ data: new ArrayBuffer(100_000) }), i); if (url.endsWith("download")) setTimeout(() => ws.onclose?.(), 70); }, 0);
    return ws;
  }) as any;
  const opts = { fetchImpl: fakeFetch, wsFactory, maxMs: 120 };
  it("is blocked until the user opts in", async () => { await expect(mk().mlabTest(opts)).rejects.toThrow(/off/); });
  it("runs, saves the result as an mlab test and audits it", async () => {
    const s = mk(); s.setMlab(true);
    const r = await s.mlabTest(opts, 1_000_000);
    expect(r.downMbps).toBeGreaterThan(0);
    expect(s.storage.speedsSince(0).some((x) => x.source === "mlab")).toBe(true);
    expect(s.storage.chain().some((e) => e.kind === "audit:mlab-test")).toBe(true);
  });
  it("enforces 30 minutes apart and 4 a day", async () => {
    const s = mk(); s.setMlab(true);
    const t = new Date(2026, 5, 1, 8).getTime();
    await s.mlabTest(opts, t);
    await expect(s.mlabTest(opts, t + 60_000)).rejects.toThrow(/30 minutes/);
    for (let i = 1; i < 4; i++) await s.mlabTest(opts, t + i * 31 * 60_000);
    await expect(s.mlabTest(opts, t + 5 * 31 * 60_000)).rejects.toThrow(/4 tests a day/);
    expect(s.mlab.limit).toBe(4);
  });
  it("refuses a server address outside measurementlab.net", async () => {
    const s = mk(); s.setMlab(true);
    const bad = (async () => ({ ok: true, json: async () => ({ results: [{ urls: { "wss:///ndt/v7/download": "wss://evil.example.com/d", "wss:///ndt/v7/upload": "wss://evil.example.com/u" } }] }) })) as any;
    await expect(s.mlabTest({ ...opts, fetchImpl: bad })).rejects.toThrow(/unexpected/);
  });
});

describe("tools service", () => {
  const mk = () => new AppService(new Storage(":memory:"));
  it("holds game detection off in normal mode and finds a game otherwise", async () => {
    const s = mk();
    expect(await s.gameActive(async () => ["valorant.exe"])).toBe("valorant"); // default mode is sound-only
    s.setNotify({ ...s.notify, gameMode: "normal" });
    expect(await s.gameActive(async () => ["valorant.exe"])).toBeNull();
  });
  it("saves game servers, pings them with the injected pinger, and rate limits", async () => {
    const s = mk();
    await expect(s.gamePing()).rejects.toThrow(/Add a game server/);
    expect(() => s.setGameTargets([{ name: "Home", host: "10.0.0.2", port: 80 }])).toThrow();
    s.setGameTargets([{ name: "EU", host: "Example.com", port: 443 }]);
    const r = await s.gamePing((async () => 20) as any, 1000);
    expect(r[0]).toMatchObject({ name: "EU", medianMs: 20, lossPct: 0 });
    await expect(s.gamePing((async () => 20) as any, 2000)).rejects.toThrow(/Wait/);
  });
  it("wifi doctor uses injected detail and keeps the network name out", async () => {
    const r = await mk().wifiDoctor(async () => ({ ssid: "Secret", signalDbm: -80, channel: 1, frequencyMhz: 2412, linkMbps: 40, security: "WPA2", sameChannelNetworks: 0, strongerNeighbours: 0 }));
    expect(JSON.stringify(r)).not.toContain("Secret");
    expect(r.findings.some((f) => f.level === "bad")).toBe(true);
  });
  it("credit estimate and restart check work from saved samples", () => {
    const s = mk(); seedDemo(s.storage, Date.now());
    const c = s.creditEstimate(90);
    expect(c.amount).toBeGreaterThanOrEqual(0); expect(c.partial).toBe(true);
    expect(() => s.creditEstimate(NaN)).toThrow();
    expect(s.restartCheck()).toBeNull();
    s.markRestart(Date.now() - 5 * 60_000);
    expect((s.restartCheck() as any).ready).toBe(false);
    expect(s.heatmap().cells).toHaveLength(7);
  });
});
