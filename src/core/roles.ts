// Generic role inference from naming and directory conventions (always "heuristic").
import type { Role } from './types';
import { basename } from './util';
import { isTestPath } from './l0/languages';
import { isManifest } from './l0/l0';

const FILE_RULES: [RegExp, Role][] = [
  [/(^|[._-])controller\.[a-z]+$|controller\.(java|kt|cs|php|rb|py|ts|js)$/i, 'controller'],
  [/(^|[._-])(routes?|router|urls)\.[a-z]+$/i, 'route'],
  [/(^|[._-])(middleware|guard|interceptor|filter)\.[a-z]+$|(middleware|guard|interceptor|filter)\.(java|kt|cs|php|ts|js)$/i, 'middleware'],
  [/(^|[._-])(service|services|usecase)\.[a-z]+$|service(impl)?\.(java|kt|cs|php|rb|ts|js)$/i, 'service'],
  [/(^|[._-])(repository|repo|dao)\.[a-z]+$|(repository|dao)\.(java|kt|cs|php|ts|js)$/i, 'repository'],
  [/(^|[._-])(model|models|entity|schema)\.[a-z]+$|\.prisma$/i, 'model'],
  [/(^|[._-])(config|settings|configuration|constants|env)\.[a-z]+$|\.config\.[cm]?[jt]s$/i, 'config'],
  [/(^|[._-])(job|jobs|task|tasks|worker|cron)\.[a-z]+$/i, 'job'],
  [/(^|[._-])(client|gateway)\.[a-z]+$|client\.(java|kt|cs|php|ts|js)$/i, 'client'],
  [/(^|[._-])(listener|consumer|producer|publisher|subscriber)\.[a-z]+$|(listener|consumer|producer|publisher)\.(java|kt|cs|ts|js)$/i, 'messaging'],
  [/(^|[._-])(util|utils|helper|helpers)\.[a-z]+$/i, 'util'],
  [/^(main|server|app|index|bootstrap|program|manage|wsgi|asgi|application)\.[a-z]+$|application\.(java|kt)$/i, 'entry'],
];

const DIR_RULES: [RegExp, Role][] = [
  [/^(migrations?|migrate)$/, 'migration'],
  [/^(controllers?|handlers?|resources|endpoints)$/, 'controller'],
  [/^(routes?|routers?|routing)$/, 'route'],
  [/^(middlewares?|guards?|interceptors?|filters?)$/, 'middleware'],
  [/^(services?|usecases?|use_cases|application|business|domain_services)$/, 'service'],
  [/^(repositor(y|ies)|repos?|daos?|persistence|data_access|dal)$/, 'repository'],
  [/^(models?|entit(y|ies)|domain|schemas?)$/, 'model'],
  [/^(components?|widgets|ui)$/, 'component'],
  [/^(pages|screens)$/, 'page'],
  [/^(views?|templates?|layouts?|partials)$/, 'view'],
  [/^(config|configs|configuration|settings|conf)$/, 'config'],
  [/^(jobs?|tasks?|workers?|cron|schedulers?)$/, 'job'],
  [/^(cli|cmd|commands?|bin|scripts?)$/, 'cli'],
  [/^(clients?|gateways?|integrations?|adapters?|external)$/, 'client'],
  [/^(events?|messaging|queues?|consumers?|producers?|listeners?|subscribers?|publishers?)$/, 'messaging'],
  [/^(utils?|helpers?|lib|libs|common|shared|support|includes?)$/, 'util'],
  [/^(docs?|documentation)$/, 'doc'],
];

const BUILD_NAMES = /^(dockerfile.*|makefile|jenkinsfile|procfile|.*\.gradle(\.kts)?|.*\.ya?ml|.*\.toml|.*\.lock|.*\.cfg|.*\.ini)$/i;

export function inferRole(path: string, lang: string): Role {
  if (isTestPath(path)) return 'test';
  const base = basename(path);
  const segs = path.toLowerCase().split('/');
  segs.pop();
  if (lang === 'markdown' || lang === 'text') return 'doc';
  if (isManifest(path) || (BUILD_NAMES.test(base) && !/^(config|settings)/i.test(base)) || segs.includes('.github')) return 'build';
  if (lang === 'sql' || lang === 'prisma') return segs.some((s) => /^migrations?$/.test(s)) ? 'migration' : 'schema';
  if (segs.some((s) => /^migrations?$/.test(s))) return 'migration';
  for (const [re, role] of FILE_RULES) {
    if (role === 'entry') continue;
    if (re.test(base)) return role;
  }
  for (let i = segs.length - 1; i >= 0; i--) {
    for (const [re, role] of DIR_RULES) if (re.test(segs[i])) return role;
  }
  // entry-like names only count near the top of a package
  const entryRe = FILE_RULES[FILE_RULES.length - 1][0];
  if (entryRe.test(base)) return 'entry';
  if (lang === 'env' || lang === 'properties' || lang === 'ini' || lang === 'json' || lang === 'yaml' || lang === 'toml' || lang === 'xml') return 'config';
  return 'unknown';
}

export const ROLE_LABEL: Record<Role, string> = {
  entry: 'Entry point', route: 'Routing', controller: 'Controller / handler', middleware: 'Middleware',
  service: 'Service / business logic', repository: 'Repository / data access', model: 'Model / entity',
  view: 'View / template', component: 'UI component', page: 'Page', config: 'Configuration', util: 'Utility',
  test: 'Test', migration: 'Migration', job: 'Background job', cli: 'CLI / script', client: 'External client',
  messaging: 'Messaging', schema: 'Schema', doc: 'Documentation', build: 'Build / tooling', unknown: 'Unclassified',
};
