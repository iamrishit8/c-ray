// Icon set (lucide, bundled; tree-shaken per import). One place maps views to icons.
import { Activity, Boxes, Braces, Clock, Compass, Database, Download, Network, Radar, Search, Workflow, type LucideIcon } from 'lucide-react';

export const TAB_ICON: Record<string, LucideIcon> = {
  orientation: Compass, map: Network, flows: Workflow, data: Database, deps: Boxes, health: Activity,
  impact: Radar, history: Clock, symbols: Braces, search: Search, export: Download,
};
