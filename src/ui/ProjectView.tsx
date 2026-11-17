import type { ComponentType } from 'react';
import type { Analysis } from '../core/types';
import { useStore } from '../store/store';
import { Orientation } from './Orientation';
import { ProgressPanel } from './ProgressPanel';
import { SourcePanel } from './SourcePanel';
import { SystemMap } from './SystemMap';
import { SearchView } from './SearchView';
import { SymbolsView } from './SymbolsView';
import { FlowView } from './FlowView';
import { DepsView } from './DepsView';
import { HealthView } from './HealthView';
import { ImpactView } from './ImpactView';
import { DataView } from './DataView';
import { ExportView } from './ExportView';

export interface TabDef {
  id: string;
  label: string;
  view: ComponentType;
  /** Hidden in File Mode (architecture views need more than one file). */
  projectOnly?: boolean;
  badge?: (a: Analysis) => string | number | null;
}

export const TABS: TabDef[] = [
  { id: 'orientation', label: 'Orientation', view: Orientation },
  { id: 'map', label: 'System map', view: SystemMap, projectOnly: true },
  { id: 'flows', label: 'Flows', view: FlowView, projectOnly: true, badge: (a) => a.entries.length },
  { id: 'data', label: 'Data', view: DataView, projectOnly: true, badge: (a) => a.schema.entities.length },
  { id: 'deps', label: 'Dependencies', view: DepsView, projectOnly: true, badge: (a) => a.deps.cycles.length + a.deps.violations.length },
  { id: 'health', label: 'Health', view: HealthView, badge: (a) => a.findings.filter((f) => f.sev === 'high' || f.sev === 'medium').length },
  { id: 'impact', label: 'Impact', view: ImpactView, projectOnly: true },
  { id: 'symbols', label: 'Symbols', view: SymbolsView },
  { id: 'search', label: 'Search', view: SearchView },
  { id: 'export', label: 'Export', view: ExportView },
];

export function ProjectView() {
  const { analysis, tab, setTab, status } = useStore();
  if (!analysis) return null;
  const tabs = TABS.filter((t) => !(t.projectOnly && analysis.mode === 'file'));
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const View = current.view;
  return (
    <div className="flex h-full">
      <nav className="no-print flex w-44 shrink-0 flex-col gap-0.5 overflow-auto border-r border-[var(--line)] bg-[var(--bg2)] p-2" aria-label="Views">
        {tabs.map((t) => {
          const b = t.badge?.(analysis);
          return (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`flex items-center justify-between rounded px-2.5 py-1.5 text-left text-[13px] ${t.id === current.id ? 'bg-[var(--accent)] font-semibold text-[var(--accent-fg)]' : 'hover:bg-[var(--bg3)]'}`}
            >
              {t.id === 'symbols' && analysis.mode === 'file' ? 'File' : t.label}
              {b !== null && b !== undefined && b !== 0 && <span className={`text-[11px] ${t.id === current.id ? '' : 'faint'}`}>{b}</span>}
            </button>
          );
        })}
        {analysis.mode === 'file' && (
          <p className="mt-3 px-2 text-xs muted" data-testid="file-mode-note">File Mode: architecture views (map, flows, data, dependencies…) need more than one file.</p>
        )}
      </nav>
      <div className="print-root min-w-0 flex-1 overflow-auto">
        {status === 'analyzing' && (
          <div className="no-print flex justify-center border-b border-[var(--line)] bg-[var(--bg2)] p-3"><ProgressPanel /></div>
        )}
        <View />
      </div>
      <SourcePanel />
    </div>
  );
}
