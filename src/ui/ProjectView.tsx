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
import { HistoryView } from './HistoryView';

export interface TabDef {
  id: string;
  label: string;
  view: ComponentType;
  /** Hidden in File Mode (architecture views need more than one file). */
  projectOnly?: boolean;
  badge?: (a: Analysis) => string | number | null;
  /** Tooltip explaining what the badge number counts. */
  badgeTitle?: string;
  group: 'Understand' | 'Assess' | 'Explore' | 'Share';
}

export const TABS: TabDef[] = [
  { id: 'orientation', label: 'Orientation', view: Orientation, group: 'Understand' },
  { id: 'map', label: 'System map', view: SystemMap, projectOnly: true, group: 'Understand' },
  { id: 'flows', label: 'Flows', view: FlowView, projectOnly: true, group: 'Understand', badge: (a) => a.entries.length, badgeTitle: 'entry points' },
  { id: 'data', label: 'Data', view: DataView, projectOnly: true, group: 'Understand', badge: (a) => a.schema.entities.length, badgeTitle: 'data entities' },
  { id: 'deps', label: 'Dependencies', view: DepsView, projectOnly: true, group: 'Assess', badge: (a) => a.deps.cycles.length + a.deps.violations.length, badgeTitle: 'cycles + layering violations' },
  { id: 'health', label: 'Health', view: HealthView, group: 'Assess', badge: (a) => a.findings.filter((f) => f.sev === 'high' || f.sev === 'medium').length, badgeTitle: 'high/medium findings' },
  { id: 'impact', label: 'Impact', view: ImpactView, projectOnly: true, group: 'Assess' },
  { id: 'history', label: 'History', view: HistoryView, projectOnly: true, group: 'Assess', badge: (a) => a.git?.cochange.filter((c) => c.linked === false).length ?? null, badgeTitle: 'hidden-coupling pairs (change together, no import)' },
  { id: 'symbols', label: 'Symbols', view: SymbolsView, group: 'Explore' },
  { id: 'search', label: 'Search', view: SearchView, group: 'Explore' },
  { id: 'export', label: 'Export', view: ExportView, group: 'Share' },
];
const GROUPS: TabDef['group'][] = ['Understand', 'Assess', 'Explore', 'Share'];

export function ProjectView() {
  const { analysis, tab, setTab, status } = useStore();
  if (!analysis) return null;
  const tabs = TABS.filter((t) => !(t.projectOnly && analysis.mode === 'file'));
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const View = current.view;
  return (
    <div className="flex h-full">
      <nav className="no-print flex w-48 shrink-0 flex-col overflow-auto border-r border-[var(--line)] bg-[var(--bg2)] px-2 py-3" aria-label="Views">
        {GROUPS.map((g) => {
          const items = tabs.filter((t) => t.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g} className="mb-3">
              <div className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider faint">{g}</div>
              <div className="flex flex-col gap-0.5">
                {items.map((t) => {
                  const b = t.badge?.(analysis);
                  const sel = t.id === current.id;
                  return (
                    <button
                      key={t.id}
                      data-testid={`tab-${t.id}`}
                      aria-current={sel ? 'page' : undefined}
                      onClick={() => setTab(t.id)}
                      className={`nav-item flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] ${sel ? 'is-selected' : 'hover:bg-[var(--bg3)]'}`}
                    >
                      {t.id === 'symbols' && analysis.mode === 'file' ? 'File' : t.label}
                      {b !== null && b !== undefined && b !== 0 && (
                        <span title={`${b} ${t.badgeTitle ?? ''}`.trim()} className="tnum rounded-full bg-[var(--bg3)] px-1.5 text-[11px] font-medium leading-[17px] text-[var(--fg2)]">{b}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
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
