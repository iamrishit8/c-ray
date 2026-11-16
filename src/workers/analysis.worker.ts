/// <reference lib="webworker" />
// Coordinator worker: owns ingestion, the pipeline, persistence and the
// in-memory copy of the active project's sources.
import { IngestError, type InputSource } from '../core/ingest/ingest';
import { projectIdFor, runPipeline, type PipelineEnv } from '../core/pipeline';
import { defaultStages } from '../core/stages';
import type { Analysis, AnalysisOptions, FileUnit } from '../core/types';
import * as store from '../db/db';
import { ParsePool } from './pool';
import type { Requests, RpcRequest, RpcResponse, WorkerEvent } from './protocol';

const post = (m: RpcResponse) => (self as unknown as Worker).postMessage(m);

interface Active {
  analysis: Analysis;
  sources: Map<string, string> | null;
}
let active: Active | null = null;
const pool = new ParsePool();

class UserError extends Error {}

async function analyze(source: InputSource, name: string, options: Partial<AnalysisOptions>, retention: store.Retention, hasHandle: boolean, emit: (e: WorkerEvent) => void, carrySkipped?: Analysis) {
  const projectId = projectIdFor(name);
  const env: PipelineEnv = {
    stages: defaultStages(),
    processFiles: (units, opts, onFile) => pool.run(units, opts, onFile),
    loadCache: () => store.loadCache(projectId),
    saveCache: (entries) => store.saveCache(projectId, entries),
  };
  const { analysis, units } = await runPipeline(source, name, options, env, (e) => {
    if (e.type === 'snapshot' && carrySkipped) mergeSkipped(e.analysis, carrySkipped);
    emit(e);
  });
  if (carrySkipped) mergeSkipped(analysis, carrySkipped);
  active = { analysis, sources: new Map(units.map((u) => [u.path, u.text])) };
  if (analysis.files.length === 0) return { meta: null, persisted: false };
  try {
    const meta = await store.saveProject(analysis, units as FileUnit[], retention, hasHandle);
    if (meta.sourcesDropped) emit({ type: 'snapshot', analysis });
    return { meta, persisted: true };
  } catch (e) {
    analysis.notices.push(`Results could not be saved to browser storage (${e instanceof Error ? e.message : e}). They are available until you close this tab.`);
    emit({ type: 'snapshot', analysis });
    return { meta: null, persisted: false };
  }
}

/** Re-analysis from stored sources has no access to the originally skipped files; keep that record. */
function mergeSkipped(a: Analysis, prev: Analysis) {
  if (a.skipped.length === 0 && prev.skipped.length) {
    a.skipped = prev.skipped;
    a.coverage.discovered = a.coverage.analyzed + prev.coverage.skipped;
    a.coverage.skipped = prev.coverage.skipped;
    a.coverage.pctFiles = prev.coverage.pctFiles;
    a.coverage.pctBytes = prev.coverage.pctBytes;
    a.coverage.limited = prev.coverage.limited;
  }
}

const handlers: { [K in keyof Requests]: (req: Requests[K]['req'], emit: (e: WorkerEvent) => void) => Promise<Requests[K]['res']> } = {
  async analyze(req, emit) {
    return analyze(req.source, req.name, req.options, req.retention, !!req.hasHandle, emit);
  },
  async reanalyze(req, emit) {
    const prev = await store.loadAnalysis(req.projectId);
    if (!prev) throw new UserError('This project is no longer stored. Drop it again to analyse it.');
    const sources = await store.loadAllSources(req.projectId);
    if (sources.length === 0) throw new UserError('Source text for this project is not stored (storage was full or it expired). Drop the project again to re-analyse it.');
    return analyze({ kind: 'memory', files: sources }, prev.name, req.options, req.retention, false, emit, prev);
  },
  async open(req) {
    const analysis = (await store.loadAnalysis(req.projectId)) ?? null;
    active = analysis ? { analysis, sources: null } : null;
    return { analysis };
  },
  async source(req) {
    if (!active) return { text: null };
    const mem = active.sources?.get(req.path);
    if (mem !== undefined) return { text: mem };
    return { text: (await store.getSource(active.analysis.projectId, req.path).catch(() => undefined)) ?? null };
  },
  async close() {
    active = null;
    return {};
  },
};

self.onmessage = async (e: MessageEvent<RpcRequest>) => {
  const { id, type, payload } = e.data;
  try {
    const data = await (handlers[type] as (r: unknown, emit: (ev: WorkerEvent) => void) => Promise<unknown>)(payload, (event) => post({ id, kind: 'event', event }));
    post({ id, kind: 'result', data });
  } catch (err) {
    const userFacing = err instanceof IngestError || err instanceof UserError;
    post({ id, kind: 'error', message: err instanceof Error ? err.message : String(err), userFacing });
  }
};
