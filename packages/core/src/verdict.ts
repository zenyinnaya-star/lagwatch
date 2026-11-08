import type { Plan, Rule, Sample, SpeedResult } from "./types.js";
import { zoneFor } from "./rules.js";
import { percentile } from "./rollup.js";
import { evidenceSamples } from "./segments.js";

export type Where = "healthy" | "local" | "beyond-router" | "unclear";
export type Confidence = "low" | "medium" | "high";

export interface Verdict {
  where: Where;
  headline: string;
  detail: string;
  confidence: Confidence;
  facts: string[];
}

function pingStats(samples: Sample[]) {
  const vals = samples.filter((s) => s.pingMs !== null).map((s) => s.pingMs as number).sort((a, b) => a - b);
  const lossPct = samples.length ? ((samples.length - vals.length) / samples.length) * 100 : 0;
  return { n: samples.length, median: vals.length ? percentile(vals, 0.5) : NaN, lossPct };
}

/**
 * Plain-English finding built from this device's own tests. Wording is deliberately
 * "tests show" and never states intent or guarantees who is at fault.
 */
export function diagnose(args: {
  samples: Sample[];
  speeds: SpeedResult[];
  plan?: Plan;
  pingRule: Rule;
  minSamples?: number;
}): Verdict {
  const { plan, pingRule } = args;
  const min = args.minSamples ?? 20;
  const ev = evidenceSamples(args.samples);
  const gw = pingStats(ev.filter((s) => s.target === "gateway"));
  const out = pingStats(ev.filter((s) => s.target === "outside"));
  const speeds = args.speeds.filter((s) => !s.vpn);
  const bestDown = speeds.length ? Math.max(...speeds.map((s) => s.downMbps)) : null;

  if (out.n < min) {
    return { where: "unclear", headline: "Still collecting data", detail: "Lagwatch needs a few more minutes of tests before it can say anything.", confidence: "low", facts: [`${out.n} outside tests so far`] };
  }

  const outBad = zoneFor(pingRule, out.median) === "bad" || out.lossPct > 2;
  const gwBad = gw.n >= min && (zoneFor(pingRule, gw.median) === "bad" || gw.lossPct > 2);
  const slowPlan = plan && bestDown !== null ? bestDown < plan.downMbps * 0.5 : false;
  const facts: string[] = [`Outside ping median ${Math.round(out.median)} ms, ${out.lossPct.toFixed(1)}% lost`];
  if (gw.n) facts.push(`Router ping median ${Math.round(gw.median)} ms`);
  if (bestDown !== null) facts.push(`Best download ${bestDown.toFixed(0)} Mbps${plan ? ` of a ${plan.downMbps} Mbps plan` : ""}`);

  const confidence: Confidence = out.n >= 200 && (speeds.length >= 3 || !plan) ? "high" : out.n >= 60 ? "medium" : "low";

  if (!outBad && !slowPlan) {
    return { where: "healthy", headline: "Your connection looks healthy", detail: "Tests from this device are inside your good lines.", confidence, facts };
  }
  if (gwBad) {
    return { where: "local", headline: "The problem looks like it is inside your home network", detail: "Tests show delay or loss even to your own router, which points to Wi-Fi, cabling or the router itself.", confidence, facts };
  }
  const wired = plan?.connection === "wired" ? " on a wired connection" : "";
  return {
    where: "beyond-router",
    headline: "Your connection is unstable",
    detail: `Tests show your router responds well but traffic beyond it is slow or lossy${wired}. That pattern is consistent with a problem at your internet provider or further out.`,
    confidence,
    facts,
  };
}
