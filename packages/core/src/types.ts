/** One heartbeat measurement. pingMs null means the probe was lost or timed out. */
export interface Sample {
  t: number; // epoch ms
  target: "gateway" | "outside";
  pingMs: number | null;
  vpn?: boolean; // VPN was on, so this sample is left out of evidence
}

export interface SpeedResult {
  t: number;
  downMbps: number;
  upMbps: number;
  source: "cloudflare" | "mlab" | "other";
  vpn?: boolean;
}

export type Zone = "good" | "warning" | "bad";
export type Metric = "ping" | "download" | "upload" | "loss";

export interface Rule {
  metric: Metric;
  /** ping/loss: at or below this is good. download/upload: at or above this is good. */
  good: number;
  /** ping/loss: above this is bad. download/upload: below this is bad. */
  bad: number;
  /** How long the value must stay in the bad zone before an alert fires. */
  sustainSec: number;
}

export interface Plan {
  downMbps: number;
  upMbps?: number;
  connection: "wired" | "wifi" | "unknown";
}
