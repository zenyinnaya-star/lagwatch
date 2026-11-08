import type { Sample } from "./types.js";

export type SegmentKind = "measured" | "asleep" | "vpn";
export interface Segment {
  kind: SegmentKind;
  startT: number;
  endT: number;
}

/**
 * Splits time into measured, asleep (a gap much longer than the heartbeat, such as a
 * closed laptop) and VPN stretches. Only "measured" counts as evidence, so a sleeping
 * laptop is never reported as an outage.
 */
export function buildSegments(samples: Sample[], intervalMs: number): Segment[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const segs: Segment[] = [];
  const push = (kind: SegmentKind, startT: number, endT: number) => {
    const prev = segs[segs.length - 1];
    if (prev && prev.kind === kind && startT - prev.endT <= intervalMs * 3) prev.endT = endT;
    else segs.push({ kind, startT, endT });
  };
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (i > 0) {
      const gap = s.t - sorted[i - 1].t;
      if (gap > intervalMs * 3) push("asleep", sorted[i - 1].t, s.t);
    }
    push(s.vpn ? "vpn" : "measured", s.t, s.t);
  }
  return segs;
}

export function evidenceSamples(samples: Sample[]): Sample[] {
  return samples.filter((s) => !s.vpn);
}
