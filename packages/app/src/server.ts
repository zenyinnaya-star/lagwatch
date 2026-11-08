import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { AppService } from "./service.js";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

/**
 * Local-only API for the dashboard (also used for browser previews and tests).
 * Binds to 127.0.0.1, rejects any other Host header (stops DNS rebinding), and caps request size.
 */
export function createServer(svc: AppService, uiDir: string) {
  const send = (res: http.ServerResponse, code: number, body: string | Buffer, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(body);
  };
  const json = async (req: http.IncomingMessage) => {
    let n = 0; const chunks: Buffer[] = [];
    for await (const c of req) { n += c.length; if (n > 10_000) throw new Error("Request too large"); chunks.push(c as Buffer); }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  };

  return http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? "").split(":")[0];
      if (host !== "127.0.0.1" && host !== "localhost") return send(res, 403, '{"error":"forbidden host"}');
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (url.pathname.startsWith("/api/")) {
        if (req.method === "POST" && req.headers["content-type"] !== "application/json") return send(res, 415, '{"error":"json only"}');
        if (url.pathname === "/api/dashboard" && req.method === "GET") return send(res, 200, JSON.stringify(svc.dashboard()));
        if (url.pathname === "/api/preset" && req.method === "POST") { svc.setPreset(String((await json(req)).name)); return send(res, 200, "{}"); }
        if (url.pathname === "/api/settings" && req.method === "GET") return send(res, 200, JSON.stringify(svc.settings()));
        if (url.pathname === "/api/rules" && req.method === "POST") { svc.setCustomRules((await json(req)).rules); return send(res, 200, "{}"); }
        if (url.pathname === "/api/notify" && req.method === "POST") { svc.setNotify(await json(req)); return send(res, 200, "{}"); }
        if (url.pathname === "/api/plan" && req.method === "POST") { svc.setPlan(await json(req)); return send(res, 200, "{}"); }
        if (url.pathname === "/api/setup" && req.method === "POST") { svc.setSetup(await json(req)); return send(res, 200, "{}"); }
        if (url.pathname === "/api/welcome" && req.method === "POST") return send(res, 200, JSON.stringify(svc.setWelcome(await json(req))));
        if (url.pathname === "/api/mlab" && req.method === "POST") { svc.setMlab(Boolean((await json(req)).enabled)); return send(res, 200, "{}"); }
        if (url.pathname === "/api/mlabtest" && req.method === "POST") return send(res, 200, JSON.stringify(await svc.mlabTest()));
        if (url.pathname === "/api/heatmap" && req.method === "GET") return send(res, 200, JSON.stringify(svc.heatmap(Number(url.searchParams.get("days")) || 14, Number(url.searchParams.get("tz")) || 0)));
        if (url.pathname === "/api/gametargets" && req.method === "POST") return send(res, 200, JSON.stringify(svc.setGameTargets((await json(req)).targets)));
        if (url.pathname === "/api/gameping" && req.method === "POST") return send(res, 200, JSON.stringify(await svc.gamePing()));
        if (url.pathname === "/api/wifidoctor" && req.method === "GET") return send(res, 200, JSON.stringify(await svc.wifiDoctor()));
        if (url.pathname === "/api/credit" && req.method === "POST") return send(res, 200, JSON.stringify(svc.creditEstimate(Number((await json(req)).price))));
        if (url.pathname === "/api/restart" && req.method === "POST") return send(res, 200, JSON.stringify(svc.markRestart()));
        if (url.pathname === "/api/restartcheck" && req.method === "GET") return send(res, 200, JSON.stringify(svc.restartCheck()));
        if (url.pathname === "/api/wifi" && req.method === "GET") return send(res, 200, JSON.stringify(await svc.wifi()));
        if (url.pathname === "/api/speedtests" && req.method === "POST") { svc.setSpeedTests(Boolean((await json(req)).enabled)); return send(res, 200, "{}"); }
        if (url.pathname === "/api/speedtest" && req.method === "POST") return send(res, 200, JSON.stringify(await svc.speedTest()));
        if (url.pathname === "/api/bufferbloat" && req.method === "POST") return send(res, 200, JSON.stringify(await svc.bufferbloat()));
        if (url.pathname === "/api/nat" && req.method === "POST") return send(res, 200, JSON.stringify(await svc.natCheck()));
        if (url.pathname === "/api/complaint" && req.method === "POST") { const b = await json(req); return send(res, 200, JSON.stringify(svc.complaintPack(b, [24, 72, 168].includes(Number(b.hours)) ? Number(b.hours) : 24))); }
        if (url.pathname === "/api/report" && req.method === "GET") {
          const r = svc.report(Math.min(168, Math.max(1, Number(url.searchParams.get("hours") ?? 24))));
          return send(res, 200, JSON.stringify({ text: r.text, fingerprint: r.fingerprint, chainOk: r.chainOk }));
        }
        return send(res, 404, '{"error":"not found"}');
      }

      const rel = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
      const file = join(uiDir, rel);
      if (!file.startsWith(uiDir) || !existsSync(file)) return send(res, 404, "Not found", "text/plain");
      send(res, 200, readFileSync(file), TYPES[extname(file)] ?? "application/octet-stream");
    } catch (e) {
      send(res, 400, JSON.stringify({ error: (e as Error).message }));
    }
  });
}
