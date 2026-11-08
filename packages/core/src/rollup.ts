import type { Sample } from "./types.js";

export interface Rollup {
  bucketT: number;
  target: Sample["target"];
  count: number;
  lost: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  p95: number | null;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Groups samples into fixed buckets (default one minute) with min, average, max and 95th percentile. */
export function rollup(samples: Sample[], bucketMs = 60_000): Rollup[] {
  const groups = new Map<string, Sample[]>();
  for (const s of samples) {
    const key = `${Math.floor(s.t / bucketMs) * bucketMs}|${s.target}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const out: Rollup[] = [];
  for (const [key, g] of groups) {
    const [bucket, target] = key.split("|");
    const vals = g.filter((s) => s.pingMs !== null).map((s) => s.pingMs as number).sort((a, b) => a - b);
    out.push({
      bucketT: Number(bucket),
      target: target as Sample["target"],
      count: g.length,
      lost: g.length - vals.length,
      min: vals.length ? vals[0] : null,
      avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      max: vals.length ? vals[vals.length - 1] : null,
      p95: vals.length ? percentile(vals, 0.95) : null,
    });
  }
  return out.sort((a, b) => a.bucketT - b.bucketT || a.target.localeCompare(b.target));
}
