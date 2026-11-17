// The ordered list of analysis stages that run after ingestion + L0.
import { accuracyStage, assembleStage, l1Stage, l2Stage, type RunL2 } from './graph';
import { depsStage } from './deps';
import { detectStage } from './detect';
import { healthStage } from './health';
import type { Stage } from './pipeline';
import { schemaStage } from './schema';

export interface StageDeps {
  runL2?: RunL2;
}

export function defaultStages(deps: StageDeps = {}): Stage[] {
  const stages: Stage[] = [l1Stage];
  if (deps.runL2) stages.push(l2Stage(deps.runL2), accuracyStage);
  stages.push(assembleStage, detectStage, schemaStage, depsStage, healthStage);
  return stages;
}
