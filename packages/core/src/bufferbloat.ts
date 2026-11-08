import { percentile } from "./rollup.js";

export type BloatGrade = "A" | "B" | "C" | "D" | "F";

export interface BloatResult {
  t: number;
  idleMs: number;
  loadedMs: number;
  peakMs: number;
  addedMs: number;
  grade: BloatGrade;
  headline: string;
  detail: string;
}

const median = (v: number[]) => percentile([...v].sort((a, b) => a - b), 0.5);

/** A is under 5 ms added, B under 30, C under 60, D under 200, F beyond that. */
export function gradeFor(addedMs: number): BloatGrade {
  return addedMs < 5 ? "A" : addedMs < 30 ? "B" : addedMs < 60 ? "C" : addedMs < 200 ? "D" : "F";
}

/**
 * Compares ping while idle with ping while a download is running. Returns null when there are too
 * few readings to say anything. Wording stays at "tests show" and never assigns fault.
 */
export function gradeBufferbloat(idle: number[], loaded: number[], t: number, minReadings = 5): BloatResult | null {
  if (idle.length < minReadings || loaded.length < minReadings) return null;
  const idleMs = median(idle);
  const loadedMs = median(loaded);
  const peakMs = percentile([...loaded].sort((a, b) => a - b), 0.95);
  const addedMs = Math.max(0, loadedMs - idleMs);
  const grade = gradeFor(addedMs);
  const good = grade === "A" || grade === "B";
  return {
    t, idleMs, loadedMs, peakMs, addedMs, grade,
    headline: good ? "Lag stays low under load" : "Lag jumps when your connection is busy",
    detail: good
      ? `Tests show ping rose by about ${Math.round(addedMs)} ms while downloading, which is fine for games and calls.`
      : `Tests show ping rose by about ${Math.round(addedMs)} ms (from ${Math.round(idleMs)} to ${Math.round(loadedMs)} ms) while a download ran. That pattern is called bufferbloat. It can make games and calls lag whenever someone else is downloading, and some routers can reduce it with a setting called smart queue management.`,
  };
}
