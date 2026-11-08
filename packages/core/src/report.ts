import type { Rule } from "./types.js";
import type { Verdict } from "./verdict.js";
import type { ChainEntry } from "./hashchain.js";
import { verifyChain } from "./hashchain.js";
import { createHash } from "node:crypto";

export interface ReportInput {
  generatedAt: number;
  rangeStart: number;
  rangeEnd: number;
  verdict: Verdict;
  rules: Rule[];
  ruleChanges: { t: number; description: string }[];
  excluded: { vpnMinutes: number; asleepMinutes: number };
  chain: ChainEntry[];
}

export interface Report {
  text: string;
  fingerprint: string;
  chainOk: boolean;
}

const iso = (t: number) => new Date(t).toISOString();

/** Builds the plain-text evidence report. The fingerprint covers the whole text, so any later edit is visible. */
export function buildReport(i: ReportInput): Report {
  const v = verifyChain(i.chain);
  const lines = [
    "Lagwatch connection report",
    `Period: ${iso(i.rangeStart)} to ${iso(i.rangeEnd)}`,
    "",
    "Summary",
    `${i.verdict.headline}. ${i.verdict.detail}`,
    `Confidence: ${i.verdict.confidence}.`,
    ...i.verdict.facts.map((f) => `- ${f}`),
    "",
    "Rules used",
    ...i.rules.map((r) => `- ${r.metric}: good ${r.good}, bad ${r.bad}, sustained ${r.sustainSec}s`),
    ...(i.ruleChanges.length ? ["", "Rule changes", ...i.ruleChanges.map((c) => `- ${iso(c.t)}: ${c.description}`)] : []),
    "",
    "Left out of this report",
    `- ${i.excluded.vpnMinutes} minutes with a VPN on`,
    `- ${i.excluded.asleepMinutes} minutes when the computer was asleep`,
    "",
    "Integrity",
    v.ok ? `Log chain verified: ${v.checked} entries, none changed.` : `Log chain FAILED at entry ${v.firstBrokenSeq}: ${v.reason}.`,
    "",
    "About this report",
    "These are measurements taken from one device. They support a complaint but do not guarantee an outcome or prove the cause.",
  ];
  const text = lines.join("\n");
  return { text, fingerprint: createHash("sha256").update(text).digest("hex"), chainOk: v.ok };
}
