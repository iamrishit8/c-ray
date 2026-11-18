// The ordered list of analysis stages that run after ingestion + L0.
import { accuracyStage, assembleStage, l1Stage, l2Stage, type RunL2 } from './graph';
import { depsStage } from './deps';
import { detectStage } from './detect';
import { healthStage } from './health';
import { runPipeline, type PipelineEnv, type Stage } from './pipeline';
import { schemaStage } from './schema';

export interface StageDeps {
  runL2?: RunL2;
  /** Scan + parse implementation, reused for historical snapshots. */
  processFiles?: PipelineEnv['processFiles'];
}

/** History features; only does anything when a .git directory was uploaded. */
export function gitStage(deps: StageDeps): Stage {
  return {
    name: 'Reading git history',
    phase: 'deep',
    async run(ctx) {
      if (!ctx.gitFiles || !ctx.opts.enableGit) return;
      const { analyzeGit } = await import('./git/analyze');
      // parse results are shared across snapshots (most blobs are unchanged between commits)
      const cache = new Map<string, Awaited<ReturnType<NonNullable<PipelineEnv['processFiles']>>>[number]>();
      const processFiles: PipelineEnv['processFiles'] = async (units, opts, onFile) => {
        const todo = units.filter((u) => !cache.has(u.hash));
        const fresh = deps.processFiles ? await deps.processFiles(todo, opts, onFile) : [];
        todo.forEach((u, i) => fresh[i] && cache.set(u.hash, fresh[i]));
        return units.map((u) => cache.get(u.hash) ?? { scan: { loc: u.text.split('\n').length, sloc: 0, todos: [], smells: [], unresolved: [], lineHashes: [] }, parse: null });
      };
      try {
        const { git, findings } = await analyzeGit(ctx.gitFiles, ctx.a, {
          progress: (d) => ctx.progress('Reading git history', d),
          analyzeSnapshot: async (files, name) =>
            (await runPipeline({ kind: 'memory', files, keepPaths: true }, name, { ...ctx.opts, enableGit: false, respectGitignore: false }, { stages: [l1Stage, assembleStage], processFiles })).analysis,
        });
        ctx.a.git = git;
        ctx.a.gitMessage = undefined;
        ctx.a.findings = [...findings, ...ctx.a.findings];
      } catch (e) {
        ctx.a.git = null;
        ctx.a.gitMessage = `The .git folder could not be read (${e instanceof Error ? e.message : String(e)}). History features are disabled.`;
      }
    },
  };
}

export function defaultStages(deps: StageDeps = {}): Stage[] {
  const stages: Stage[] = [l1Stage];
  if (deps.runL2) stages.push(l2Stage(deps.runL2), accuracyStage);
  stages.push(assembleStage, detectStage, schemaStage, depsStage, healthStage, gitStage(deps));
  return stages;
}
