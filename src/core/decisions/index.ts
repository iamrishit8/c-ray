// decisionsStage (M10): fills `Analysis.decisions` from the team's ADRs (resolved) and from the catalogue
// detectors (inferred). A 'deep' stage listed after deps and health, because it cites their cycles, layering
// violations and secrets as "how it holds up" (graph-phase stages run before them).
import type { Stage } from '../pipeline';
import { CATEGORY_ORDER, type Decision } from '../types';
import { DETECTORS, type Ctx } from './catalogue';
import { parseAdr, type ParsedAdr } from './docs';

const MAX_ADRS = 60;

function adrDecision(p: ParsedAdr): Decision {
  const status = p.status?.toLowerCase() ?? '';
  const retired = /supersed|deprecat|reject|obsolete|withdrawn/.test(status);
  return {
    id: `adr:${p.file}`, title: p.title, category: 'Documented', source: 'adr', conf: 'resolved',
    decision: p.decision?.text ?? 'The ADR does not state its decision in a recognisable section; open it to read it.',
    evidence: [{ file: p.file, line: p.decision?.line ?? 1, note: `Decision record${p.number !== undefined ? ` ${p.number}` : ''}`, kind: 'doc' }],
    tradeoffs: p.consequences,
    why: p.context ? { text: p.context.text, conf: 'resolved', file: p.file, line: p.context.line } : undefined,
    observed: [
      ...(retired ? [{ text: `Status is "${p.status}": this decision may no longer apply.`, conf: 'resolved' as const, file: p.file, line: 1 }] : []),
      { text: 'This is the team\'s own record. imex has not checked that the code still follows it.', conf: 'unresolved' as const },
    ],
    adr: { status: p.status, date: p.date, number: p.number },
  };
}

export const decisionsStage: Stage = {
  name: 'Inferring decisions',
  phase: 'deep',
  run(ctx) {
    const { a } = ctx;
    const docs = a.l0.docs;
    const c: Ctx = {
      a, units: ctx.unitByPath,
      docFiles: docs.filter((d) => d.kind === 'readme' || d.kind === 'doc').map((d) => d.file).sort((x, y) => x.length - y.length || (x < y ? -1 : 1)),
    };
    const out: Decision[] = [];
    const adrs = docs.filter((d) => d.kind === 'adr').slice(0, MAX_ADRS);
    if (docs.filter((d) => d.kind === 'adr').length > MAX_ADRS) a.notices.push(`Only the first ${MAX_ADRS} decision records were read.`);
    for (const d of adrs) {
      const u = ctx.unitByPath.get(d.file);
      if (!u) continue;
      // a malformed record must not cost the others
      try {
        out.push(adrDecision(parseAdr(d.file, u.text)));
      } catch (e) {
        a.notices.push(`Could not read decision record ${d.file}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // ADRs keep their numeric order (the order the team made them in)
    out.sort((x, y) => (x.adr?.number ?? 1e9) - (y.adr?.number ?? 1e9) || (x.id < y.id ? -1 : 1));
    for (const detect of DETECTORS) {
      try {
        const d = detect(c);
        if (d) out.push(d);
      } catch (e) {
        a.notices.push(`A decision detector failed and was skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    a.decisions = out.sort((x, y) => CATEGORY_ORDER.indexOf(x.category) - CATEGORY_ORDER.indexOf(y.category));
  },
};
