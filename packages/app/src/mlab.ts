/**
 * M-Lab NDT7 speed test. Opt-in only, and run by the user's click, never on a timer.
 * M-Lab's acceptable-use policy limits automated clients to a few tests a day and publishes the test's IP address,
 * so the caller enforces a daily limit and shows the user that before they agree.
 */
export interface WsLike {
  binaryType: string; bufferedAmount: number;
  onopen: ((e?: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e?: unknown) => void) | null; onerror: ((e?: unknown) => void) | null;
  send(d: unknown): void; close(): void;
}
export type WsFactory = (url: string, protocol: string) => WsLike;

export interface MlabOptions {
  fetchImpl?: typeof fetch;
  wsFactory?: WsFactory;
  maxMs?: number;          // stop each direction after this long (default 6 s, M-Lab's own test runs 10 s)
  maxBytes?: number;       // and after this many bytes (default 80 MB), so fast lines do not burn data
  now?: () => number;
}

const PROTO = "net.measurementlab.ndt.v7";
const defaultWs: WsFactory = (url, proto) => new (globalThis as any).WebSocket(url, proto) as WsLike;

const asUrl = (u: unknown, why: string) => {
  const s = String(u ?? "");
  let p: URL;
  try { p = new URL(s); } catch { throw new Error(`M-Lab returned a bad ${why} address.`); }
  if (p.protocol !== "wss:" || !/(^|\.)measurementlab\.net$/.test(p.hostname)) throw new Error(`M-Lab returned an unexpected ${why} address.`);
  return s;
};

export async function locateServer(f: typeof fetch) {
  const r = await f("https://locate.measurementlab.net/v2/nearest/ndt/ndt7?client_name=lagwatch&client_version=0.1");
  if (!r.ok) throw new Error("Could not reach M-Lab to find a test server.");
  const j: any = await r.json();
  const t = j?.results?.[0];
  if (!t?.urls) throw new Error("M-Lab did not offer a test server right now.");
  return { machine: String(t.machine ?? ""), down: asUrl(t.urls["wss:///ndt/v7/download"], "download"), up: asUrl(t.urls["wss:///ndt/v7/upload"], "upload") };
}

function download(ws: WsLike, maxMs: number, maxBytes: number, now: () => number) {
  return new Promise<{ mbps: number; bytes: number }>((resolve, reject) => {
    let bytes = 0, t0 = 0, done = false;
    const end = (err?: Error) => {
      if (done) return; done = true; clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      const ms = Math.max(1, now() - t0);
      if (err && bytes === 0) return reject(err);
      resolve({ mbps: (bytes * 8) / 1e6 / (ms / 1000), bytes });
    };
    const timer = setTimeout(() => end(), maxMs + 4000); // safety net if the server never answers
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { t0 = now(); };
    ws.onmessage = (e) => {
      const d: any = e.data;
      bytes += typeof d === "string" ? d.length : d.byteLength ?? 0;
      if (now() - t0 >= maxMs || bytes >= maxBytes) end();
    };
    ws.onclose = () => end();
    ws.onerror = () => end(new Error("The M-Lab download test failed."));
  });
}

function upload(ws: WsLike, maxMs: number, maxBytes: number, now: () => number) {
  return new Promise<{ mbps: number; bytes: number }>((resolve, reject) => {
    const chunk = new Uint8Array(65536);
    let sent = 0, t0 = 0, done = false;
    const end = (err?: Error) => {
      if (done) return; done = true; clearTimeout(timer); clearInterval(pump);
      const acked = Math.max(0, sent - ws.bufferedAmount); // only count what actually left this computer
      const ms = Math.max(1, now() - t0);
      try { ws.close(); } catch { /* already closed */ }
      if (err && acked === 0) return reject(err);
      resolve({ mbps: (acked * 8) / 1e6 / (ms / 1000), bytes: acked });
    };
    const timer = setTimeout(() => end(), maxMs + 4000);
    let pump: ReturnType<typeof setInterval>;
    ws.onopen = () => {
      t0 = now();
      pump = setInterval(() => {
        while (ws.bufferedAmount < 1_048_576 && sent < maxBytes && now() - t0 < maxMs) { ws.send(chunk); sent += chunk.length; }
        if (now() - t0 >= maxMs || sent >= maxBytes) end();
      }, 5);
    };
    ws.onclose = () => end();
    ws.onerror = () => end(new Error("The M-Lab upload test failed."));
  });
}

export async function runMlabTest(o: MlabOptions = {}) {
  const f = o.fetchImpl ?? fetch, mk = o.wsFactory ?? defaultWs, now = o.now ?? (() => performance.now());
  const maxMs = o.maxMs ?? 6000, maxBytes = o.maxBytes ?? 80_000_000;
  const s = await locateServer(f);
  const d = await download(mk(s.down, PROTO), maxMs, maxBytes, now);
  const u = await upload(mk(s.up, PROTO), maxMs, maxBytes, now);
  return { downMbps: d.mbps, upMbps: u.mbps, bytesUsed: d.bytes + u.bytes, machine: s.machine };
}
