// The ordered list of analysis stages that run after ingestion + L0.
import { assembleStage, l2Stage, type RunL2 } from './graph';
import type { Stage } from './pipeline';

export interface StageDeps {
  runL2?: RunL2;
}

export function defaultStages(deps: StageDeps = {}): Stage[] {
  const stages: Stage[] = [];
  if (deps.runL2) stages.push(l2Stage(deps.runL2));
  stages.push(assembleStage);
  return stages;
}
