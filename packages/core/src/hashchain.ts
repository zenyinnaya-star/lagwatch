import { createHash } from "node:crypto";

export interface ChainEntry {
  seq: number;
  t: number;
  kind: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

export const GENESIS = "0".repeat(64);

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}

export function hashEntry(e: Omit<ChainEntry, "hash">): string {
  return createHash("sha256")
    .update(`${e.seq}|${e.t}|${e.kind}|${canonical(e.payload)}|${e.prevHash}`)
    .digest("hex");
}

export function makeEntry(prev: ChainEntry | null, t: number, kind: string, payload: unknown): ChainEntry {
  const base = { seq: prev ? prev.seq + 1 : 1, t, kind, payload, prevHash: prev ? prev.hash : GENESIS };
  return { ...base, hash: hashEntry(base) };
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  firstBrokenSeq?: number;
  reason?: string;
}

/** Walks the chain from the start and reports the first entry that was changed, removed or reordered. */
export function verifyChain(entries: ChainEntry[]): VerifyResult {
  let prev: ChainEntry | null = null;
  for (const e of entries) {
    const expectSeq = prev ? prev.seq + 1 : 1;
    if (e.seq !== expectSeq) return { ok: false, checked: expectSeq - 1, firstBrokenSeq: e.seq, reason: "missing or reordered entry" };
    if (e.prevHash !== (prev ? prev.hash : GENESIS)) return { ok: false, checked: e.seq - 1, firstBrokenSeq: e.seq, reason: "chain link broken" };
    const { hash, ...rest } = e;
    if (hashEntry(rest) !== hash) return { ok: false, checked: e.seq - 1, firstBrokenSeq: e.seq, reason: "entry was changed" };
    prev = e;
  }
  return { ok: true, checked: entries.length };
}
