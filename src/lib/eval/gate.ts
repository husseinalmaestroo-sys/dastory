/**
 * One evaluation gate (scripts/eval.ts). A gate passes only on a measured
 * value inside its threshold; a missing value fails — unless `notMeasured`
 * says why this mode has nothing to measure for it, and then the gate is
 * reported as NOT MEASURED and binds nothing.
 *
 * Until 2026-10-06 the live suite's two retrieval gates failed every live run
 * on a null: live mode runs no retrieval case (their gold is in the synthetic
 * corpus); the real-corpus benchmark and the probes measure retrieval there.
 */
export type GateRow = {
  gate: string;
  value: number | null;
  threshold: string;
  pass: boolean;
  binding: boolean;
  notMeasured?: string;
};

export function gateRow(gate: string, value: number | null, t: { max?: number; min?: number }, binding: boolean, notMeasured?: string): GateRow {
  const threshold = t.max !== undefined ? `≤ ${t.max}` : `≥ ${t.min}`;
  if (value === null && notMeasured) return { gate, value, threshold, pass: false, binding: false, notMeasured };
  const pass = value !== null && (t.max === undefined || value <= t.max) && (t.min === undefined || value >= t.min);
  return { gate, value, threshold, pass, binding };
}
