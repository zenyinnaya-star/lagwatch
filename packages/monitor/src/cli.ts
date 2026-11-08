import { PRESETS, buildReport, diagnose, buildSegments } from "@lagwatch/core";
import { Storage } from "./storage.js";
import { Monitor } from "./monitor.js";
import { defaultGateway } from "./ping.js";

const [cmd = "run", ...rest] = process.argv.slice(2);
const arg = (name: string, d: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : d;
};
const dbPath = arg("db", "lagwatch.db");
const storage = new Storage(dbPath);

if (cmd === "run") {
  const seconds = Number(arg("seconds", "0"));
  const interval = Number(arg("interval", "5")) * 1000;
  const gw = defaultGateway();
  const m = new Monitor({ storage, intervalMs: interval, gateway: gw ? { host: gw, port: 80 } : null });
  console.log(`Lagwatch monitor started. Database: ${dbPath}. Router: ${gw ?? "not found"}.`);
  const orig = m.tick.bind(m);
  m.tick = async () => {
    const s = await orig();
    console.log(s.map((x) => `${x.target} ${x.pingMs === null ? "lost" : x.pingMs.toFixed(1) + " ms"}`).join("  "));
    return s;
  };
  m.start();
  const quit = () => { m.stop(); storage.close(); process.exit(0); };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  if (seconds > 0) setTimeout(quit, seconds * 1000);
} else if (cmd === "verify") {
  console.log(JSON.stringify(storage.verify(), null, 2));
} else if (cmd === "report") {
  const since = Date.now() - Number(arg("hours", "24")) * 3600_000;
  const samples = storage.samplesSince(since);
  const rule = PRESETS.Gaming[0];
  const verdict = diagnose({ samples, speeds: storage.speedsSince(since), pingRule: rule });
  const segs = buildSegments(samples, 5000);
  const mins = (k: string) => Math.round(segs.filter((s) => s.kind === k).reduce((a, s) => a + (s.endT - s.startT), 0) / 60000);
  const r = buildReport({
    generatedAt: Date.now(), rangeStart: since, rangeEnd: Date.now(), verdict, rules: PRESETS.Gaming,
    ruleChanges: [], excluded: { vpnMinutes: mins("vpn"), asleepMinutes: mins("asleep") }, chain: storage.chain(),
  });
  storage.audit("report-exported", { fingerprint: r.fingerprint, hours: arg("hours", "24") });
  console.log(r.text + `\n\nFingerprint: ${r.fingerprint}`);
}
storage.flush();
