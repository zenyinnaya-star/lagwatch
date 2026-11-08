import type { BloatResult } from "./bufferbloat.js";
import type { NatResult } from "./nat.js";
import { lineCheckAsk, TECHS, type ComplaintBody } from "./setup.js";

export interface ComplaintInput {
  isp: string;
  accountHolder: string;
  callerName: string;
  hours: number;
  connection: "wired" | "wifi" | "unknown";
  planDownMbps: number;
  bestDownMbps: number | null;
  latestUpMbps: number | null;
  zeroUploads: number;
  pingMedianMs: number | null;
  routerPingMs: number | null;
  pingGoodMs: number;
  pingBadMs: number;
  badPingHours: number;
  lossPct: number;
  dropouts: number;
  bloat?: BloatResult | null;
  nat?: NatResult | null;
  tech?: string;
  body?: ComplaintBody;
  reportFingerprint?: string;
}

export interface ComplaintPack {
  hasProblems: boolean;
  problems: string[];
  asks: string[];
  script: string;
  escalation: string;
  warnings: string[];
}

const r0 = (n: number) => Math.round(n);

/**
 * Turns measurements into a short problem list and a phone script. Everything is phrased as what the
 * tests show. It asks for specific actions, never promises a refund, and never claims to know the cause.
 */
export function buildComplaintPack(i: ComplaintInput): ComplaintPack {
  const how = i.connection === "wired" ? " on a wired connection straight to the modem" : "";
  const warnings: string[] = [];
  if (i.connection === "wifi") warnings.push("These tests ran over Wi-Fi, so a provider can say the problem is your Wi-Fi. Plug a cable into the router or modem and run Lagwatch again for stronger evidence.");
  if (i.connection === "unknown") warnings.push("Lagwatch does not know whether this computer is on Wi-Fi or a cable. Set it on the Plan and setup screen so the report can say so.");
  const problems: string[] = [];

  if (i.bestDownMbps !== null && i.bestDownMbps < i.planDownMbps * 0.5) {
    problems.push(`Download is about ${r0(i.bestDownMbps)} Mbps against a ${i.planDownMbps} Mbps plan (${r0((i.bestDownMbps / i.planDownMbps) * 100)}%)${how}.`);
  }
  if (i.zeroUploads > 0) {
    problems.push(`Upload dropped to 0 Mbps ${i.zeroUploads === 1 ? "once" : `${i.zeroUploads} times`}${i.latestUpMbps !== null ? `, latest test ${i.latestUpMbps.toFixed(1)} Mbps` : ""}.`);
  }
  if (i.pingMedianMs !== null && (i.badPingHours >= 0.5 || i.pingMedianMs > i.pingBadMs)) {
    problems.push(`Ping goes above ${i.pingBadMs} ms for about ${i.badPingHours.toFixed(1)} hours in ${i.hours} hours. It should stay under ${i.pingGoodMs} ms.`);
  }
  if (i.lossPct > 2) problems.push(`${i.lossPct.toFixed(1)}% of tests got no answer.`);
  if (i.dropouts > 0) problems.push(`${i.dropouts} dropout${i.dropouts === 1 ? "" : "s"} (two or more lost tests in a row, or upload at zero).`);
  if (i.bloat && ["C", "D", "F"].includes(i.bloat.grade)) {
    problems.push(`Ping rises by about ${r0(i.bloat.addedMs)} ms while a download runs (grade ${i.bloat.grade}).`);
  }
  if (i.nat?.status === "double-nat") {
    problems.push("My router's outside address suggests carrier-grade NAT or another NAT in front of it, so game consoles report a strict NAT type.");
  }

  const hasProblems = problems.length > 0;
  const asks: string[] = [];
  if (hasProblems) {
    asks.push(lineCheckAsk(i.tech ?? "unknown"));
    asks.push("Tell me whether there is a fault or congestion in my area, and when it will be fixed.");
    if (i.bestDownMbps !== null && i.bestDownMbps < i.planDownMbps * 0.5) asks.push("Book a technician visit if the line test does not find the cause.");
    if (i.nat?.status === "double-nat") asks.push("Give me a public IP address, or take me off carrier-grade NAT.");
    asks.push("Tell me whether a bill credit is possible for the period when the service was well below my plan.");
  }

  const holder = i.accountHolder.trim();
  const caller = i.callerName.trim();
  const onBehalf = holder && caller && holder.toLowerCase() !== caller.toLowerCase();
  const who = onBehalf
    ? `Hi, my name is ${caller}. I'm calling for ${holder}, who is the account holder, about slow and unstable internet.`
    : `Hi, my name is ${caller || holder || "[your name]"}. I'm the account holder, calling about slow and unstable internet.`;

  const lines: string[] = [who];
  if (onBehalf) lines.push(`(${holder} may need to be on the call or give permission first. Providers often will not discuss an account with anyone else.)`);
  if (!hasProblems) {
    lines.push("", `Lagwatch did not find a significant problem in the last ${i.hours} hours, so there is nothing to report to ${i.isp} yet. Keep it running and build this again when it happens.`);
  } else {
    const plan = i.tech && i.tech !== "unknown" && TECHS[i.tech] ? ` on my ${TECHS[i.tech].toLowerCase()} plan` : "";
    lines.push("", `I have been testing my connection${plan} for the last ${i.hours} hours${how || (i.connection === "wifi" ? " over Wi-Fi" : "")}, with a monitoring app that records every few seconds. The results show:`);
    problems.forEach((p, n) => lines.push(`  ${n + 1}. ${p}`));
    if (i.connection === "wifi") lines.push("", "I know I tested over Wi-Fi, so I will also run the same tests with a cable if you need them.");
    if (i.connection === "wired" && i.routerPingMs !== null) lines.push("", `If you suggest it is my Wi-Fi or my devices: my router answers in about ${r0(i.routerPingMs)} ms, so the delay is beyond my home network.`);
    lines.push("", "What I'm asking you to do:");
    asks.forEach((a, n) => lines.push(`  ${n + 1}. ${a}`));
    lines.push("", "Before we finish, can I have a ticket number, the name of the person I'm speaking with, and a date for a follow-up?");
    if (i.reportFingerprint) lines.push(`I can send the full report. Its fingerprint is ${i.reportFingerprint.slice(0, 16)}.`);
  }

  const body = i.body ?? { name: "your country's telecom regulator or ombudsman", url: "" };
  const escalation =
    `If ${i.isp} does not fix it, keep every ticket number and date. You can then make a complaint to ${body.name}${body.url ? ` at ${body.url}` : ""}. Check their site for current steps. This report supports a complaint but does not guarantee an outcome.`;

  return { hasProblems, problems, asks, script: lines.join("\n"), escalation, warnings };
}
