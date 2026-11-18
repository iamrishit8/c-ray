import { useEffect, useRef, type ComponentType } from 'react';
import type { Analysis } from '../core/types';
import { useStore } from '../store/store';
import { TAB_ICON } from './icons';
import { PageGroup } from './kit';
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
  const contentRef = useRef<HTMLDivElement>(null);
  // "/" focuses the current view's search/filter field, or opens Search when the view has none.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      const field = contentRef.current?.querySelector<HTMLInputElement>('[data-search-focus]');
      if (field) field.focus();
      else setTab('search');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab]);
  if (!analysis) return null;
  const tabs = TABS.filter((t) => !(t.projectOnly && analysis.mode === 'file'));
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const View = current.view;
  return (
    <div className="relative flex h-full">
      <nav className="no-print flex w-[236px] shrink-0 flex-col overflow-auto border-r border-[var(--line)] px-3 py-4 max-[900px]:w-[60px] max-[900px]:px-2" aria-label="Views">
        {GROUPS.map((g, gi) => {
          const items = tabs.filter((t) => t.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g} className={gi === 0 ? '' : 'mt-5'}>
              <div className="label px-3 pb-1.5 max-[900px]:hidden">{g}</div>
              <div className="flex flex-col gap-0.5">
                {items.map((t) => {
                  const b = t.badge?.(analysis);
                  const sel = t.id === current.id;
                  const Icon = TAB_ICON[t.id];
                  const label = t.id === 'symbols' && analysis.mode === 'file' ? 'File' : t.label;
                  return (
                    <button
                      key={t.id}
                      data-testid={`tab-${t.id}`}
                      aria-current={sel ? 'page' : undefined}
                      aria-label={label}
                      title={label}
                      onClick={() => setTab(t.id)}
                      className={`nav-item flex items-center gap-2.5 rounded-[var(--r-sm)] px-3 py-[7px] text-left text-[13.5px] max-[900px]:justify-center max-[900px]:px-0 ${sel ? 'is-selected' : ''}`}
                    >
                      {Icon && <Icon aria-hidden="true" size={16} strokeWidth={1.8} className="shrink-0" />}
                      <span className="min-w-0 flex-1 truncate max-[900px]:hidden">{label}</span>
                      {b !== null && b !== undefined && b !== 0 && (
                        <span title={`${b} ${t.badgeTitle ?? ''}`.trim()} className={`tnum font-mono text-[11px] max-[900px]:hidden ${t.id === 'health' || t.id === 'deps' ? 'text-[var(--warn)]' : 'faint'}`}>{b}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {analysis.mode === 'file' && (
          <p className="mt-4 px-3 text-xs muted max-[900px]:hidden" data-testid="file-mode-note">File Mode: architecture views (map, flows, data, dependencies…) need more than one file.</p>
        )}
      </nav>
      <div ref={contentRef} className="print-root min-w-0 flex-1 overflow-auto">
        {status === 'analyzing' && (
          <div className="no-print flex justify-center border-b border-[var(--line)] p-3"><ProgressPanel /></div>
        )}
        <PageGroup.Provider value={current.group}>
          <View />
        </PageGroup.Provider>
      </div>
      <SourcePanel />
    </div>
  );
}
