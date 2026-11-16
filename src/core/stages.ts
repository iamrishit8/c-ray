// The ordered list of analysis stages that run after ingestion + L0.
import type { Stage } from './pipeline';

export function defaultStages(): Stage[] {
  return [];
}
