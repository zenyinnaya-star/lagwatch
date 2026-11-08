import { describe, it, expect } from "vitest";
import net from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage, Monitor, tcpPing } from "../src/index.js";

const tmp = () => join(mkdtempSync(join(tmpdir(), "lw-")), "t.db");

describe("tcpPing", () => {
  it("measures a listening port", async () => {
    const srv = net.createServer((s) => s.end()).listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    const port = (srv.address() as net.AddressInfo).port;
    const ms = await tcpPing({ host: "127.0.0.1", port });
    expect(ms).not.toBeNull();
    expect(ms!).toBeLessThan(500);
    srv.close();
  });
  it("counts a refused connection as reachable", async () => {
    const srv = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    const port = (srv.address() as net.AddressInfo).port;
    srv.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(await tcpPing({ host: "127.0.0.1", port })).not.toBeNull();
  });
  it("returns null when the host cannot be reached", async () => {
    expect(await tcpPing({ host: "no-such-host.invalid", port: 81 }, 500)).toBeNull();
  });
});

describe("storage", () => {
  it("batches samples, verifies, and detects a tampered sample", () => {
    const s = new Storage(tmp());
    for (let i = 0; i < 20; i++) s.addSample({ t: 1000 + i * 5000, target: "outside", pingMs: 20 + i });
    expect(s.flush()).toBe(20);
    s.audit("rule-changed", { metric: "ping", from: 100, to: 150 });
    expect(s.verify().ok).toBe(true);
    s.raw().prepare("UPDATE samples SET ping_ms = 5 WHERE rowid = 3").run();
    expect(s.verify()).toMatchObject({ ok: false, reason: "saved samples do not match their fingerprint" });
    s.close();
  });
  it("detects a deleted sample", () => {
    const s = new Storage(tmp());
    for (let i = 0; i < 10; i++) s.addSample({ t: i, target: "outside", pingMs: 10 });
    s.flush();
    s.raw().prepare("DELETE FROM samples WHERE rowid = 4").run();
    expect(s.verify().ok).toBe(false);
  });
  it("detects an edited audit entry", () => {
    const s = new Storage(tmp());
    s.audit("rule-changed", { to: 150 });
    s.audit("report-exported", {});
    s.raw().prepare("UPDATE chain SET payload = ? WHERE seq = 1").run(JSON.stringify({ to: 999 }));
    expect(s.verify().ok).toBe(false);
  });
  it("continues the chain after reopening", () => {
    const p = tmp();
    const a = new Storage(p); a.audit("one", {}); a.close();
    const b = new Storage(p); b.audit("two", {});
    expect(b.verify()).toMatchObject({ ok: true, checked: 2 });
  });
});

describe("monitor", () => {
  const mk = (probe: any, gateway = true) => {
    const storage = new Storage(tmp());
    const m = new Monitor({ storage, probe, gateway: gateway ? { host: "gw", port: 80 } : null, outside: [{ host: "a", port: 1 }, { host: "b", port: 1 }], now: () => 5000 });
    return { storage, m };
  };
  it("one outside host down is not an internet outage", async () => {
    const { m } = mk(async (t: any) => (t.host === "a" ? null : t.host === "b" ? 30 : 2));
    const s = await m.tick();
    expect(s.find((x) => x.target === "outside")!.pingMs).toBe(30);
  });
  it("all outside hosts down is lost, router still measured", async () => {
    const { m } = mk(async (t: any) => (t.host === "gw" ? 2 : null));
    const s = await m.tick();
    expect(s.find((x) => x.target === "outside")!.pingMs).toBeNull();
    expect(s.find((x) => x.target === "gateway")!.pingMs).toBe(2);
  });
  it("tags samples while a VPN is on", async () => {
    const storage = new Storage(tmp());
    const m = new Monitor({ storage, probe: async () => 10, vpnActive: () => true, outside: [{ host: "a", port: 1 }] });
    expect((await m.tick())[0].vpn).toBe(true);
  });
  it("a throwing probe does not stop the loop", async () => {
    const storage = new Storage(tmp());
    let calls = 0;
    const m = new Monitor({ storage, intervalMs: 20, flushMs: 20, outside: [{ host: "a", port: 1 }], probe: async () => { calls++; if (calls === 1) throw new Error("boom"); return 10; } });
    m.start();
    await new Promise((r) => setTimeout(r, 150));
    m.stop();
    expect(calls).toBeGreaterThan(2);
    expect(storage.verify().ok).toBe(true);
  });
});

describe("encryption", () => {
  const key = "a".repeat(64);
  it("encrypts the file, reopens with the key, refuses without it, and migrates a plain database", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const f = join(mkdtempSync(join(tmpdir(), "lw-enc-")), "x.db");
    const plain = new Storage(f);
    plain.setSetting("marker", "SECRET-MARKER-123");
    plain.close();
    expect(readFileSync(f).includes("SECRET-MARKER-123")).toBe(true); // plain file is readable
    const enc = new Storage(f, { key }); // migrates in place
    expect(enc.getSetting("marker", "")).toBe("SECRET-MARKER-123");
    expect(enc.verify().ok).toBe(true);
    enc.close();
    expect(readFileSync(f).includes("SECRET-MARKER-123")).toBe(false);
    expect(() => new Storage(f, { key: "b".repeat(64) })).toThrow(/unlock/);
    expect(() => new Storage(f)).toThrow();
    expect(new Storage(f, { key }).getSetting("marker", "")).toBe("SECRET-MARKER-123");
  });
});
