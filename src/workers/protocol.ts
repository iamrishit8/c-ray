// Message protocol between the UI thread and the analysis worker.
import type { InputSource } from '../core/ingest/ingest';
import type { Analysis, AnalysisOptions, Progress } from '../core/types';
import type { ProjectMeta, Retention } from '../db/db';

export interface Requests {
  analyze: { req: { source: InputSource; name: string; options: Partial<AnalysisOptions>; retention: Retention; hasHandle?: boolean }; res: { meta: ProjectMeta | null; persisted: boolean } };
  reanalyze: { req: { projectId: string; options: Partial<AnalysisOptions>; retention: Retention }; res: { meta: ProjectMeta | null; persisted: boolean } };
  open: { req: { projectId: string }; res: { analysis: Analysis | null } };
  source: { req: { path: string }; res: { text: string | null } };
  close: { req: Record<string, never>; res: Record<string, never> };
}

export type WorkerEvent =
  | { type: 'progress'; progress: Progress }
  | { type: 'snapshot'; analysis: Analysis };

export interface RpcRequest {
  id: number;
  type: keyof Requests;
  payload: unknown;
}

export type RpcResponse =
  | { id: number; kind: 'event'; event: WorkerEvent }
  | { id: number; kind: 'result'; data: unknown }
  | { id: number; kind: 'error'; message: string; userFacing: boolean };
