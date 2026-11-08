import type { Storage } from "@lagwatch/monitor";

/** Fills a database with 24 hours of realistic sample data (a bad ISP day) and marks it as sample data. */
export function seedDemo(storage: Storage, now = Date.now()) {
  const start = now - 24 * 3600_000;
  const STEP = 15_000;
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pct = (t: number) => ((t - start) / (now - start)) * 100;
  const phase = (p: number) =>
    p < 22 ? "good" : p < 30 ? "bad" : p < 44 ? "good" : p < 50 ? "asleep" : p < 62 ? "warn" : p < 66 ? "vpn" : p < 86 ? "bad" : "good";
  let lastHour = -1;
  for (let t = start; t < now - 5 * 60_000 - STEP; t += STEP) {
    const ph = phase(pct(t));
    if (ph === "asleep") continue;
    const base = ph === "bad" ? 200 + rnd() * 80 : ph === "warn" ? 70 + rnd() * 25 : 18 + rnd() * 14;
    const lost = rnd() < (ph === "bad" ? 0.04 : 0.003);
    const vpn = ph === "vpn";
    storage.addSample({ t, target: "outside", pingMs: lost ? null : base, vpn });
    storage.addSample({ t, target: "gateway", pingMs: 1 + rnd() * 2, vpn });
    const h = Math.floor(t / 3600_000);
    if (h !== lastHour) { storage.flush(t); lastHour = h; }
  }
  // the last five minutes, so the live graph has data and shows the climb into the bad zone
  for (let i = 5 * 12; i >= 0; i--) {
    const t = now - i * 5000;
    const frac = 1 - i / 60;
    storage.addSample({ t, target: "outside", pingMs: 60 + frac * 190 + rnd() * 25, vpn: false });
    storage.addSample({ t, target: "gateway", pingMs: 1 + rnd() * 2, vpn: false });
  }
  storage.flush(now);
  for (let k = 0; k < 24; k++) {
    const t = start + k * 3600_000 + 1_000_000;
    if (t > now) break;
    const p = pct(t);
    if (phase(p) === "asleep" || phase(p) === "vpn") continue;
    storage.addSpeed({ t, downMbps: 20 + rnd() * 5, upMbps: k === 5 ? 0 : 4.5 + rnd(), source: "cloudflare" });
  }
  storage.setSetting("sample", true, now);
  storage.setSetting("nat", { t: now, status: "double-nat", headline: "Your internet provider appears to share one public address between homes", detail: "Sample result. Tests show your router's outside address (100.72.14.9) is in the range providers use for carrier-grade NAT. UPnP on your own router cannot open ports to the internet from there, which is consistent with a strict NAT type.", steps: ["Ask your provider for a public IP address or to take you off carrier-grade NAT. Say the address your router shows and that it is in the 100.64.0.0/10 range.", "Until then, an Xbox on this connection will often stay Moderate or Strict whatever the router settings are."], facts: ["Your router answered a UPnP request", "Router says its outside address is 100.72.14.9"] }, now);
  storage.setSetting("bufferbloat", { t: now, idleMs: 24, loadedMs: 238, peakMs: 301, addedMs: 214, grade: "F", headline: "Lag jumps when your connection is busy", detail: "Sample result." }, now);
  storage.setSetting("plan", { downMbps: 100, connection: "wired" }, now);
  storage.setSetting("welcome", { seen: true, background: false, startAtLogin: false }, now);
  storage.setSetting("setup", { country: "Canada", region: "British Columbia", provider: "Telus", tech: "cable", connection: "wired", downMbps: 100, upMbps: null, wifiName: "", done: true }, now);
}
