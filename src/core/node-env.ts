// Pipeline environment for Node (tests, benchmarks, scripts). The browser
// equivalent lives in src/workers/.
import type { PipelineEnv } from './pipeline';
import { defaultStages } from './stages';

export function nodeEnv(): PipelineEnv {
  return { stages: defaultStages() };
}
