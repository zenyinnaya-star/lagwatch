import net from "node:net";
import { readFileSync } from "node:fs";

export interface Target {
  host: string;
  port: number;
}

/**
 * TCP connect time in ms, or null if nothing answered. A refused connection still proves the
 * host is reachable (it replied), so it counts with its round-trip time.
 */
export function tcpPing(t: Target, timeoutMs = 2000): Promise<number | null> {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const sock = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok ? Number(process.hrtime.bigint() - start) / 1e6 : null);
    };
    sock.setTimeout(timeoutMs, () => finish(false));
    sock.once("connect", () => finish(true));
    sock.once("error", (err: NodeJS.ErrnoException) => finish(err.code === "ECONNREFUSED"));
    sock.connect(t.port, t.host);
  });
}

/** Default gateway address on Linux. Other systems are handled by the desktop shell. */
export function defaultGateway(): string | null {
  try {
    const lines = readFileSync("/proc/net/route", "utf8").split("\n").slice(1);
    for (const l of lines) {
      const f = l.trim().split(/\s+/);
      if (f[1] === "00000000" && f[2] && f[2] !== "00000000") {
        const n = parseInt(f[2], 16);
        return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255].join(".");
      }
    }
  } catch {
    /* not Linux */
  }
  return null;
}
