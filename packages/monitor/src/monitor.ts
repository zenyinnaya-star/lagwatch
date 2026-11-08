import type { Sample } from "@lagwatch/core";
import { tcpPing, type Target } from "./ping.js";
import type { Storage } from "./storage.js";

export type Probe = (t: Target) => Promise<number | null>;

export interface MonitorOptions {
  storage: Storage;
  intervalMs?: number;
  flushMs?: number;
  gateway?: Target | null;
  /** Several outside hosts so one provider being down is never reported as the internet being down. */
  outside?: Target[];
  probe?: Probe;
  vpnActive?: () => boolean;
  now?: () => number;
}

export const DEFAULT_OUTSIDE: Target[] = [
  { host: "1.1.1.1", port: 443 },
  { host: "8.8.8.8", port: 443 },
  { host: "9.9.9.9", port: 443 },
];

export class Monitor {
  private timer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private running = false;
  private o: Required<Omit<MonitorOptions, "gateway">> & { gateway: Target | null };

  constructor(opts: MonitorOptions) {
    this.o = {
      intervalMs: 5000, flushMs: 5000, gateway: null, outside: DEFAULT_OUTSIDE,
      probe: tcpPing, vpnActive: () => false, now: Date.now, ...opts,
    } as any;
  }

  /** One heartbeat. Outside is lost only when every outside host fails (circuit breaker). */
  async tick(): Promise<Sample[]> {
    const t = this.o.now();
    const vpn = this.o.vpnActive();
    const out: Sample[] = [];
    const results = await Promise.all(this.o.outside.map((h) => this.o.probe(h)));
    const ok = results.filter((r): r is number => r !== null);
    out.push({ t, target: "outside", pingMs: ok.length ? Math.min(...ok) : null, vpn });
    if (this.o.gateway) {
      out.push({ t, target: "gateway", pingMs: await this.o.probe(this.o.gateway), vpn });
    }
    for (const s of out) this.o.storage.addSample(s);
    return out;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.o.storage.audit("monitor-start", { intervalMs: this.o.intervalMs });
    const loop = async () => {
      if (!this.running) return;
      const began = Date.now();
      try { await this.tick(); } catch { /* a failed tick must never stop monitoring */ }
      this.timer = setTimeout(loop, Math.max(0, this.o.intervalMs - (Date.now() - began)));
    };
    void loop();
    this.flushTimer = setInterval(() => this.o.storage.flush(), this.o.flushMs);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.o.storage.audit("monitor-stop", {});
  }
}
