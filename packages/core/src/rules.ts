import type { Metric, Rule, Zone } from "./types.js";

export const PRESETS: Record<string, Rule[]> = {
  Gaming: [
    { metric: "ping", good: 50, bad: 100, sustainSec: 30 },
    { metric: "loss", good: 0.5, bad: 2, sustainSec: 30 },
    { metric: "download", good: 25, bad: 10, sustainSec: 600 },
    { metric: "upload", good: 5, bad: 1, sustainSec: 10 },
  ],
  "Work calls": [
    { metric: "ping", good: 100, bad: 200, sustainSec: 60 },
    { metric: "loss", good: 1, bad: 3, sustainSec: 60 },
    { metric: "download", good: 10, bad: 3, sustainSec: 600 },
    { metric: "upload", good: 5, bad: 2, sustainSec: 30 },
  ],
  Streaming: [
    { metric: "ping", good: 150, bad: 300, sustainSec: 120 },
    { metric: "loss", good: 2, bad: 5, sustainSec: 120 },
    { metric: "download", good: 25, bad: 10, sustainSec: 300 },
    { metric: "upload", good: 2, bad: 0.5, sustainSec: 120 },
  ],
};

const LOWER_IS_BETTER: Metric[] = ["ping", "loss"];

/** Validate a user-made rule so a bad value cannot silently disable alerts. */
export function validateRule(r: Rule): string | null {
  if (![r.good, r.bad, r.sustainSec].every(Number.isFinite)) return "Values must be numbers.";
  if (r.good < 0 || r.bad < 0 || r.sustainSec < 0) return "Values cannot be negative.";
  if (LOWER_IS_BETTER.includes(r.metric)) {
    if (r.good >= r.bad) return "The good line must be lower than the bad line.";
  } else if (r.good <= r.bad) {
    return "The good line must be higher than the bad line.";
  }
  return null;
}

export function zoneFor(rule: Rule, value: number): Zone {
  if (LOWER_IS_BETTER.includes(rule.metric)) {
    if (value <= rule.good) return "good";
    if (value > rule.bad) return "bad";
    return "warning";
  }
  if (value >= rule.good) return "good";
  if (value < rule.bad) return "bad";
  return "warning";
}

export interface Reading {
  t: number;
  value: number;
}

export interface Incident {
  metric: Metric;
  startT: number;
  endT: number | null; // null while still ongoing
  worst: number;
}

/**
 * Turns a run of readings (oldest first) into incidents: bad stretches that lasted
 * at least rule.sustainSec. A good or warning reading ends the stretch.
 */
export function findIncidents(rule: Rule, readings: Reading[]): Incident[] {
  const out: Incident[] = [];
  let start: Reading | null = null;
  let worst = 0;
  let last: Reading | null = null;
  const worse = (a: number, b: number) =>
    LOWER_IS_BETTER.includes(rule.metric) ? Math.max(a, b) : Math.min(a, b);

  const close = (endT: number | null) => {
    if (start && last && last.t - start.t >= rule.sustainSec * 1000) {
      out.push({ metric: rule.metric, startT: start.t, endT, worst });
    }
    start = null;
  };

  for (const r of readings) {
    if (zoneFor(rule, r.value) === "bad") {
      if (!start) {
        start = r;
        worst = r.value;
      } else worst = worse(worst, r.value);
      last = r;
    } else if (start) {
      close(r.t);
    }
  }
  if (start) close(null);
  return out;
}

/**
 * Decides which incidents should notify now. One alert per incident, nothing inside
 * the repeat gap, and nothing during quiet hours unless the user allowed bad alerts.
 */
export interface NotifyOptions {
  repeatGapMs: number;
  quietHours?: { startHour: number; endHour: number; allowBad: boolean };
}

export function shouldNotify(
  incident: Incident,
  lastNotifiedAt: number | null,
  now: number,
  opts: NotifyOptions,
): boolean {
  if (lastNotifiedAt !== null && now - lastNotifiedAt < opts.repeatGapMs) return false;
  const q = opts.quietHours;
  if (q) {
    const h = new Date(now).getHours();
    const inQuiet =
      q.startHour <= q.endHour ? h >= q.startHour && h < q.endHour : h >= q.startHour || h < q.endHour;
    if (inQuiet && !q.allowBad) return false;
  }
  return true;
}
