// The steps shown by the analysis progress stepper, and which step a pipeline phase belongs to.
// Phase strings come from pipeline.ts (ingest, parse) and each Stage's `name`.

export const PIPELINE_STEPS = ['Read files', 'Parse', 'Graph', 'Detect', 'Schema', 'Health', 'History'] as const;

/** Index into PIPELINE_STEPS; `PIPELINE_STEPS.length` once done; -1 for an unknown phase. */
export function stepOf(phase: string): number {
  const p = phase.toLowerCase();
  if (p === 'done') return PIPELINE_STEPS.length;
  if (/^(starting|reading files|reading zip|scanning|loading)/.test(p)) return 0;
  if (/^pars/.test(p)) return 1;
  if (/resolving|measuring|building the graph/.test(p)) return 2;
  if (/detecting/.test(p)) return 3;
  if (/data model/.test(p)) return 4;
  if (/dependencies|health/.test(p)) return 5;
  if (/git history/.test(p)) return 6;
  return -1;
}
