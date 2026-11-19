// The Home help manual as data (U4, D42): sections, one entry per page, the terminology, shortcuts and limits.
// Plain data on purpose: the renderer, the terms search, the confidence tooltips in kit.tsx and the tests
// (drift guards + worked examples checked against the real app) all read this one file. No React, no DOM.
import type { Confidence } from '../../core/types';

/** The one wording of each confidence level. `ConfBadge` tooltips and the glossary both use it. */
export const CONFIDENCE_HELP: Record<Confidence, string> = {
  resolved: 'Resolved: derived exactly (compiler API, manifest or explicit declaration).',
  heuristic: 'Heuristic: inferred from syntax, names or conventions. Likely, not certain.',
  unresolved: 'Unresolved: could not be determined statically.',
};

// ── Worked examples ────────────────────────────────────────────────────────────────────────────────
// Each example runs on the bundled sample project (or one tiny file) and is replayed by
// tests/e2e/u4-manual.spec.ts, so a claim like "you see six steps" cannot go stale unnoticed.

/** One thing a person does, in terms of stable `data-testid`s. */
export type Action =
  | { tab: string }
  | { click: string }
  | { clickText: string; within: string }
  | { fill: string; value: string };

export interface Example {
  /** `sample` = the bundled Express API; a file = dropped on its own (File Mode). */
  start: 'sample' | { file: string; text: string };
  steps: { say: string; do?: Action[] }[];
  /** What the person sees at the end, in words. */
  sees: string;
  /** The same thing as checks the test can make: the element is visible and, if given, contains the text. */
  checks: { testid: string; text?: string }[];
}

export type SchematicId = 'treemap' | 'graph' | 'flow' | 'er' | 'matrix' | 'hotspot' | 'blast' | 'calendar';

/** Title and caption of each drawn schematic. The pictures are illustrations of the idea, not data. */
export const SCHEMATICS: Record<SchematicId, { title: string; caption: string }> = {
  treemap: { title: 'A treemap', caption: 'Each box is a file, sized by its lines of code. The coloured outlines group files into folders, and the colour tells the role.' },
  graph: { title: 'A system map', caption: 'Nodes are files, arrows are imports. A solid arrow is resolved, a dashed one heuristic, a dotted one unresolved. Folders are boxes you can open.' },
  flow: { title: 'A request flow', caption: 'The steps that run for one route, in order: middleware, then the handler, then the code it calls, ending at the data.' },
  er: { title: 'An ER diagram', caption: 'Each card is an entity with its fields. The line between cards is a relation; the key marks the field that links them.' },
  matrix: { title: 'A dependency matrix', caption: 'A row imports a column. Filled cells below the diagonal follow the layers. A pair of cells mirrored across the diagonal is a cycle, outlined in red.' },
  hotspot: { title: 'A hotspot map', caption: 'Each dot is a file: churn across, complexity up, size by lines. The shaded top-right corner holds files that are both complex and often changed.' },
  blast: { title: 'A blast radius', caption: 'The file you change is the centre. Each ring is one more step of distance through the files that depend on it.' },
  calendar: { title: 'An activity calendar', caption: 'One square per day, darker where there were more commits. Gaps are quiet periods; stripes are steady work.' },
};

export interface PageEntry {
  /** The tab id from `TABS` (or `file-mode`). A test keeps this list in step with the app. */
  id: string;
  title: string;
  group: 'Understand' | 'Assess' | 'Explore' | 'Share' | 'Special';
  shows: string;
  question: string;
  use: string[];
  read: { good: string; worry: string };
  sure: string;
  limits: string;
  /** `data-testid`s of the controls and results the entry names; a test checks they still exist in the UI code. */
  controls: string[];
  schematic?: SchematicId;
  example: Example;
}

export interface Term {
  id: string;
  term: string;
  /** Other words people may type when looking for it. */
  aliases?: string[];
  /** Plain-English meaning. */
  def: string;
  where: string;
  why: string;
}

export interface Section {
  id: string;
  label: string;
  title: string;
  intro: string;
}

export const SECTIONS: Section[] = [
  { id: 'quick-start', label: 'Quick start', title: 'Quick start', intro: 'From a folder on your disk to your first answer in about a minute.' },
  { id: 'routes', label: 'Reading a codebase', title: 'Reading a codebase with imex', intro: 'Pick the goal that matches yours and follow the pages in that order.' },
  { id: 'pages', label: 'Pages', title: 'Page by page', intro: 'What each page shows, the question it answers, how to read it and how far to trust it. Every entry ends with a short example you can repeat on the sample project.' },
  { id: 'terms', label: 'Terms', title: 'Terminology', intro: 'Every word the app uses, in plain English. Type to filter.' },
  { id: 'shortcuts', label: 'Shortcuts', title: 'Controls and shortcuts', intro: 'Keys, mouse actions and settings.' },
  { id: 'limits', label: 'Privacy & limits', title: 'Privacy, storage and limits', intro: 'What stays on your machine, what is saved, and why a result can be wrong.' },
];

// ── Quick start ────────────────────────────────────────────────────────────────────────────────────
export const QUICK_START: { title: string; text: string }[] = [
  { title: 'Drop something in', text: 'Drag a project folder, a ZIP or a single file onto the drop zone, or use “Choose folder”, “Choose files or ZIP” or “Try a sample project”. A folder or ZIP gives you every page. A single file opens in File Mode: only the pages that make sense for one file are shown.' },
  { title: 'Include the .git folder if you can', text: 'History, ownership and “how did this get here” need the hidden .git folder. If it is inside what you drop, imex reads it in your browser. If it is not, everything else still works and the History page tells you so.' },
  { title: 'Watch the progress bar', text: 'Analysis runs in steps: Read files → Parse → Graph → Detect → Schema → Health → History → Decisions. The coloured tiles are your files, filling in as they are read. Pages appear as soon as their data is ready, so you can start reading before the last step finishes.' },
  { title: 'Start on Orientation, then Onboarding', text: 'Orientation says what the project is, how big it is, where it starts and which files to read first. Onboarding turns that into a first-week plan: reading order, how to run it, and the project’s own vocabulary.' },
  { title: 'Open the source from anywhere', text: 'Every file name and file:line you see is a link. Clicking it opens the code in a panel on the right, scrolled to the line. Nothing is hidden behind a summary: you can always check the original.' },
  { title: 'Check how sure it is', text: 'Each inferred fact carries a badge: resolved (exact), heuristic (a likely guess) or unresolved (could not be worked out). Treat heuristic items as “worth a look”, not as proof.' },
];

// ── Routes by goal ─────────────────────────────────────────────────────────────────────────────────
export const ROUTES: { goal: string; blurb: string; steps: { tab: string; why: string }[] }[] = [
  {
    goal: 'I just joined the team',
    blurb: 'Get a mental model in an afternoon, then follow one real request all the way through.',
    steps: [
      { tab: 'onboarding', why: 'the first-week plan, how to run it, and the vocabulary' },
      { tab: 'orientation', why: 'what it is, how big, where execution starts' },
      { tab: 'flows', why: 'pick a route and read what runs, in order' },
      { tab: 'data', why: 'the data the code is built around, and who touches it' },
      { tab: 'decisions', why: 'why it looks the way it does, in the team’s own words where they wrote them down' },
    ],
  },
  {
    goal: 'Can I change this safely?',
    blurb: 'Before you edit a file or rename a function, find out who depends on it.',
    steps: [
      { tab: 'impact', why: 'everything that depends on it, the entry points and tests that reach it, and a risk score' },
      { tab: 'deps', why: 'is it part of a circular dependency or a layering violation?' },
      { tab: 'history', why: 'does it change often, and with which other files, even without an import?' },
    ],
  },
  {
    goal: 'What is risky here?',
    blurb: 'Find the parts most likely to hurt, then check whether anyone else knows them.',
    steps: [
      { tab: 'health', why: 'findings by category, and the hotspot map of complexity against churn' },
      { tab: 'deps', why: 'cycles, god modules and the dependency matrix' },
      { tab: 'history', why: 'ownership: files that only one person has touched' },
    ],
  },
  {
    goal: 'Hand it over or write it up',
    blurb: 'Take the findings with you without sending anything anywhere.',
    steps: [
      { tab: 'export', why: 'Markdown, a Notion ZIP, PDF or raw JSON, in the sections you choose' },
    ],
  },
];

// ── Pages ──────────────────────────────────────────────────────────────────────────────────────────
const SAMPLE = 'sample' as const;

export const PAGES: PageEntry[] = [
  {
    id: 'orientation', title: 'Orientation', group: 'Understand',
    shows: 'A short summary of the project, a treemap of its folders and files, the languages and roles, the technology stack found in manifests, the inferred architecture style, entry points, the files to read first, and what was skipped.',
    question: 'What is this thing, and where do I begin?',
    use: [
      'Read the summary first, then the “Read these files first” list: those files are ranked by how central they are.',
      'In the treemap, a box is a file and its area is its size in lines. Click a folder to zoom in; the path above the picture takes you back. Double-click a file to open it.',
      'Change what the colour means (role, language, complexity, and churn when there is history) to look at the same map from a different angle.',
      'Use “table” on any picture to see the same numbers as a list.',
    ],
    read: {
      good: 'A few clear entry points, a stack that matches what you were told, and “read first” files that look like the heart of the project.',
      worry: 'Large coverage gaps (many skipped files), no entry points in something that should have them, or an architecture label that does not match how the team talks about it.',
    },
    sure: 'Counts and manifest facts are resolved. The architecture style, roles and reading order are heuristic: they come from names, folders and import patterns.',
    limits: 'The summary is generated from a template, not written by a person. Files over the size cap, binaries, minified and generated files are skipped and listed under “Coverage and skipped files”.',
    controls: ['summary', 'read-first', 'entries', 'treemap-card', 'treemap-switch', 'frameworks', 'stack', 'skipped'],
    schematic: 'treemap',
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open the sample project. Orientation is the first page.', do: [{ tab: 'orientation' }] },
        { say: 'Find “Read these files first”.' },
      ],
      sees: 'A summary of the sample as an Express API, a treemap of its src folders, and a short list of files to read first with src/server.js (where the program starts) among them.',
      checks: [{ testid: 'summary' }, { testid: 'treemap' }, { testid: 'read-first', text: 'src/server.js' }],
    },
  },
  {
    id: 'onboarding', title: 'Onboarding', group: 'Understand',
    shows: 'A first-week checklist, a reading path through the code, how to run the project (commands copied from the repo, with where each came from), and a glossary of the project’s own words.',
    question: 'If I started on this project on Monday, what should I do and read?',
    use: [
      'Tick checklist items as you go. Ticks are kept in this browser only. “Open in imex” on an item jumps to the page that helps.',
      'Follow the reading path from the top: it goes from the docs and the entry point through routes and data to the rough edges.',
      'In “How to run it”, a command copied from a file is resolved and links to that file. A command imex worked out from a manifest is marked heuristic, so check it. Use the copy button to take one.',
      'Filter the glossary to find what a term in the code means.',
    ],
    read: {
      good: 'Commands that come from the README or manifest, a short reading path, and glossary terms you recognise from the code.',
      worry: 'Run commands that are all heuristic, or an empty “how to run” section: the project may have no written setup, so ask someone.',
    },
    sure: 'Anything copied from a file is resolved. Conventional commands derived from a manifest, the ranking of the reading path and the pacing of the checklist are heuristic.',
    limits: 'imex never runs anything. Example environment values come only from template files such as .env.example; a real .env contributes names, never values. Projects analysed before this page existed need “Re-analyze”.',
    controls: ['onboarding-checklist', 'onboarding-path', 'onboarding-run', 'run-command', 'onboarding-glossary', 'glossary-term'],
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open Onboarding.', do: [{ tab: 'onboarding' }] },
        { say: 'Look at “How to run it”.' },
      ],
      sees: 'A first-week checklist, then the commands to run it, each with where it came from and a copy button. npm start is resolved (copied from package.json, line 5); npm install is heuristic (the usual command for a Node project, not written anywhere in the repo).',
      checks: [{ testid: 'onboarding-checklist' }, { testid: 'run-commands', text: 'npm start' }, { testid: 'run-command' }],
    },
  },
  {
    id: 'map', title: 'System map', group: 'Understand',
    shows: 'The folders and files as a graph, with an arrow for each import. Folders are boxes you can open.',
    question: 'How is the code wired together?',
    use: [
      'Click a node to focus it: its neighbours stay lit, the rest fades. Double-click a folder to open it.',
      'Use Role, Language and “hide tests” to cut the picture down. Use Colour and Size to ask a question of it, for example size by fan-in to see what everything leans on.',
      'Press “Path”, type two files and “Find path” to see the shortest chain of imports between them, one step at a time.',
      'Zoom with the + and − buttons, “Fit” to see everything, and the small map in the corner to move around. The export button saves a PNG or SVG.',
    ],
    read: {
      good: 'Clear groups, arrows mostly pointing one way (entry → logic → data), and a handful of central files.',
      worry: 'A tangle where everything points at everything, one node with arrows from the whole project, or arrows that go back up the layers.',
    },
    sure: 'Line style carries confidence: solid arrows are resolved, dashed are heuristic, dotted are unresolved. TypeScript and JavaScript imports are compiler-exact; other languages are heuristic.',
    limits: 'At most about 200 nodes are drawn at once; larger folders stay collapsed until you open them. Dynamic imports and framework magic cannot be followed and show up as unresolved.',
    controls: ['map-canvas', 'path-toggle', 'path-from', 'path-to', 'path-find', 'path-result', 'map-color-by', 'map-size-by', 'role-filter', 'lang-filter', 'hide-tests', 'graph-fit', 'graph-zoom-in', 'graph-zoom-out', 'graph-export', 'graph-legend', 'graph-minimap'],
    schematic: 'graph',
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open System map and press “Path”.', do: [{ tab: 'map' }, { click: 'path-toggle' }] },
        { say: 'Type src/server.js as the start and src/models/User.js as the end, then “Find path”.', do: [{ fill: 'path-from', value: 'src/server.js' }, { fill: 'path-to', value: 'src/models/User.js' }, { click: 'path-find' }] },
      ],
      sees: 'A path of 5 steps (server → app → routes → controller → service → model), with the matching edges lit on the map. Use the arrows to step through it.',
      checks: [{ testid: 'path-result', text: '5 steps' }],
    },
  },
  {
    id: 'flows', title: 'Flows', group: 'Understand',
    shows: 'For each entry point (HTTP route, page, program start, command, background job, event), the steps that run when it is hit: middleware, handler, calls and data access, in order.',
    question: 'What actually happens when this endpoint is called?',
    use: [
      'Pick an entry point on the left. Filter by typing; move with the arrow keys.',
      'Read the steps top to bottom. Indentation is call depth. Each step has a role, a confidence and a link to its code.',
      'Press Play to watch the trace step by step with the matching nodes lit on the graph. Use Previous, Next and Speed to control it.',
      'Raise “Depth” if the trace says it was cut off.',
    ],
    read: {
      good: 'A short chain that ends in data access or an external call, with middleware (for example authentication) in the expected place.',
      worry: 'A handler with no steps after it, a route with no authentication step where you expected one, or a business flow that jumps between many unrelated files.',
    },
    sure: 'A handler found through the TypeScript compiler is resolved. Handlers found by name through imports are heuristic. A route path that is not a plain string is shown as unresolved, never guessed.',
    limits: 'Only calls that can be seen in the code are followed. Calls through dynamic dispatch, dependency injection containers or events fired by name are not. A trace stops at the depth limit.',
    controls: ['entry-list', 'entry-filter', 'flow-title', 'flow-steps', 'flow-play', 'flow-step-next', 'flow-step-prev', 'flow-speed', 'flow-graph-toggle'],
    schematic: 'flow',
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open Flows and choose POST /api/orders in the list.', do: [{ tab: 'flows' }, { clickText: 'POST /api/orders', within: 'entry-list' }] },
        { say: 'Read the steps.' },
      ],
      sees: 'The authentication middleware, the order controller’s create handler, then the order service and the payment client that calls an external API.',
      checks: [{ testid: 'flow-title', text: 'POST /api/orders' }, { testid: 'flow-steps', text: 'paymentClient' }],
    },
  },
  {
    id: 'data', title: 'Data', group: 'Understand',
    shows: 'The data model rebuilt from ORM models, migrations and SQL: entities, fields, relations and indexes, drawn as an ER diagram, plus the code that reads and writes each entity.',
    question: 'What data does this system keep, and who touches it?',
    use: [
      'Click an entity in the diagram or the list to focus it and its relations. Its fields and the code that uses it appear below.',
      'Under “Code that touches …”, reads and writes are separate, so you can see which files change the data.',
      'Switch the diagram to “as exported” to see the Mermaid version that goes into exports.',
    ],
    read: {
      good: 'Entities with clear names, relations that match how the business talks, and writes confined to a few service files.',
      worry: 'Many files writing the same entity, entities with no relations, or database access listed under “Other database access points” that could not be tied to an entity.',
    },
    sure: 'Reconstruction reads the code’s syntax. Entities declared plainly are resolved; relations inferred from field names or conventions are heuristic and drawn dashed.',
    limits: 'The schema is what the code declares, not what the live database contains. Dynamic models and runtime-built queries are not seen. Supported: Prisma, Mongoose, TypeORM, Sequelize, SQLAlchemy, Django, JPA, ActiveRecord, Eloquent, EF Core, GORM, migrations and SQL.',
    controls: ['er-card', 'er-interactive-toggle', 'er-mermaid-toggle', 'entity-list', 'entity-detail', 'entity-access'],
    schematic: 'er',
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open Data and click Order in the entity list.', do: [{ tab: 'data' }, { clickText: 'Order', within: 'entity-list' }] },
      ],
      sees: 'Two entities, User and Order, with Order pointing at User. Order’s fields (user, items, total, status, createdAt) and the files that read and write it are listed below.',
      checks: [{ testid: 'er-card' }, { testid: 'entity-detail', text: 'total' }, { testid: 'entity-access' }],
    },
  },
  {
    id: 'decisions', title: 'Decisions', group: 'Understand',
    shows: 'The architectural choices the code appears to embody (framework, data access, authentication, tests, deployment…) plus any decision records the team wrote. Each has evidence, the reason if the project states one, counted observations, and typical trade-offs.',
    question: 'Why is it built this way, and how well does that hold up?',
    use: [
      'Filter by category (Documented, Architecture, Stack, Data, API, Security, Operations, Quality).',
      'Select a decision. “Evidence” links to the files behind it. “Why it appears built this way” quotes the project’s own docs; if there are none it says so.',
      '“How it holds up in this project” counts things like layering violations or routes without authentication. “Typical trade-offs” is general knowledge, labelled as such.',
    ],
    read: {
      good: 'Decisions with evidence and a stated reason, and few contradicting observations.',
      worry: 'Decisions marked unresolved (worth asking a teammate), observations that contradict the decision, or no stated reason for a big choice.',
    },
    sure: 'A decision record (ADR) the team wrote is resolved. An inferred decision takes the weakest confidence of what it claims. Reasons are never invented: they are quotes with a file and line.',
    limits: 'imex can say what the code shows, not what was in people’s heads. “No recognised authentication” means imex found none it knows, not that none exists.',
    controls: ['decision-filters', 'decision-list', 'decision-item', 'decision-detail', 'decision-evidence', 'decision-why', 'decision-observed', 'decision-tradeoffs'],
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open Decisions and pick the first one in the list.', do: [{ tab: 'decisions' }, { click: 'decision-item' }] },
      ],
      sees: 'A list of about a dozen decisions (architecture style, framework, datastores, authentication…). The detail shows its evidence with file links, what the repo says about why, and what was counted.',
      checks: [{ testid: 'decision-list' }, { testid: 'decision-evidence' }, { testid: 'decision-why' }],
    },
  },
  {
    id: 'deps', title: 'Dependencies', group: 'Assess',
    shows: 'Import counts, circular dependencies, layering violations, god modules, coupling metrics per file, a module-by-module dependency matrix, and the external packages in use.',
    question: 'Is the structure clean enough to change with confidence?',
    use: [
      'Start with the five tiles: internal imports, circular paths, layering violations, god modules, packages.',
      'In the dependency matrix, a row imports a column. Cycles are outlined in red, layering violations in amber. Click a cell to see the imports behind it.',
      'In “Coupling metrics”, sort by fan-in (who depends on it) or instability to find the files everything leans on.',
      'Under “External packages”, look for packages used but not declared.',
    ],
    read: {
      good: 'No cycles, cells mostly on one side of the diagonal, and a few high fan-in files that are stable on purpose (config, utilities).',
      worry: 'Cells on both sides of the diagonal (a cycle), controllers reaching straight into the database, or a single file with very high fan-in and fan-out.',
    },
    sure: 'Metrics for TypeScript and JavaScript are exact. For other languages the edges are heuristic and can produce false positives. Layering rules are always labelled heuristic.',
    limits: 'The matrix shows up to 40 modules; deeper folders are merged to fit. “Layer” comes from file roles, which are themselves inferred.',
    controls: ['metrics', 'cycles', 'violations', 'god-modules', 'packages', 'dsm-card', 'dsm-switch'],
    schematic: 'matrix',
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open Dependencies and look at “Circular dependencies”.', do: [{ tab: 'deps' }] },
      ],
      sees: 'One circular path between src/services/userService.js and src/services/orderService.js, and one layering violation where the order controller queries the database itself.',
      checks: [{ testid: 'cycles', text: 'userService' }, { testid: 'violations', text: 'orderController' }, { testid: 'dsm-card' }],
    },
  },
  {
    id: 'health', title: 'Health', group: 'Assess',
    shows: 'Signals worth reviewing, grouped: hotspots, possible hardcoded secrets, disabled TLS checks, SQL built by joining strings, dynamic code execution, complexity, deep nesting, long functions and files, duplicated code, unused exports and TODO comments. A hotspot map plots complexity against churn.',
    question: 'Where is the code most likely to hurt?',
    use: [
      'Use the category chips to look at one kind of finding at a time, or filter by file or text.',
      'Each row links to the exact line and shows a severity and a confidence badge.',
      'On the hotspot map, the top-right shaded corner is the risky one: complex files that also change a lot. Click a dot for details.',
    ],
    read: {
      good: 'Few high-severity findings and hotspots that are known, well-tested files.',
      worry: 'A hardcoded secret, or a dot in the shaded corner that nobody owns.',
    },
    sure: 'Counts such as complexity and file size are exact. Pattern-based findings (secrets, SQL, clones) are heuristic and can be false positives, so each shows its own badge.',
    limits: 'These are signals, not verdicts. Without a .git folder there is no churn, and the map plots complexity against fan-in instead and says so. The “risky” corner is relative to this project’s own spread.',
    controls: ['health-cats', 'hotspot-card', 'hotspot-switch', 'hotspot-map', 'hotspot-point'],
    schematic: 'hotspot',
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open Health and choose the “Possible hardcoded secrets” chip.', do: [{ tab: 'health' }, { click: 'cat-secret' }] },
      ],
      sees: 'A finding in src/config.js about a possible hardcoded secret (jwtSecret), marked heuristic with a link to the line. The hotspot map above uses fan-in because the sample has no git history.',
      checks: [{ testid: 'findings-secret', text: 'config.js' }, { testid: 'hotspot-card' }],
    },
  },
  {
    id: 'impact', title: 'Impact', group: 'Assess',
    shows: 'For a file or function you choose: everything that depends on it (directly and through other files), the entry points and tests that reach it, the functions affected, and a risk score with the factors behind it. A radial picture shows distance.',
    question: 'If I change this, what could break?',
    use: [
      'Type part of a file path or a function name and pick a suggestion. Other pages also have an “Impact” button next to files and functions.',
      'Read “Dependent files” grouped by distance: direct dependents first, then two steps away, and so on.',
      '“Affected entry points” are the routes and jobs a change could reach: open one to see its flow. “Affected tests” are the tests worth running.',
      'In the blast radius picture, each ring is one more step of distance; tests and entry points are marked.',
    ],
    read: {
      good: 'A low score, few direct dependents, and tests listed among the affected files.',
      worry: 'A high score with no affected tests, or many entry points behind one file.',
    },
    sure: 'Through the TypeScript compiler the dependents are exact. Through heuristic edges the real set may be larger or smaller, and the page says so. The score is a transparent rule of thumb (dependents, entry points, complexity, test coverage), not a prediction.',
    limits: 'Only static dependencies are followed. Things connected at runtime (configuration, events, database triggers) are invisible.',
    controls: ['impact-input', 'impact-suggestions', 'impact-risk', 'impact-files', 'impact-entries', 'impact-tests', 'blast-card'],
    schematic: 'blast',
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open Impact, type models/Order and choose the file.', do: [{ tab: 'impact' }, { fill: 'impact-input', value: 'models/Order' }, { clickText: 'src/models/Order.js', within: 'impact-suggestions' }] },
      ],
      sees: 'A risk score with its factors, the order controller, order service and cleanup job as dependents, and the order routes under “Affected entry points”.',
      checks: [{ testid: 'impact-risk', text: '/100' }, { testid: 'impact-files', text: 'orderService' }, { testid: 'impact-entries', text: '/api/orders' }],
    },
  },
  {
    id: 'history', title: 'History', group: 'Assess',
    shows: 'Read from the .git folder: commit counts, the most changed files, files that change together, who owns what, what the commits were about, renamed files, an activity calendar, and a time-travel view of the architecture at up to ten snapshots.',
    question: 'How did the code get here, and who knows it?',
    use: [
      '“Most changed files” ranks churn; “Impact” on a row jumps to its blast radius.',
      '“Files that change together” has a “hidden coupling” filter: pairs that change together with no import path between them. These are worth a look.',
      'In “Ownership”, files mostly written by one person are bus-factor risks.',
      'In “Architecture over time”, pick a start and an end snapshot to see what was added, removed or changed, or press play to watch the module graph morph.',
    ],
    read: {
      good: 'Changes spread across several authors, co-changing files that are also imported by each other, and growth that matches the story the team tells.',
      worry: 'Hidden coupling, files owned by one person, or complexity growing in the same few files.',
    },
    sure: 'Counts from the commits are exact. What they suggest (coupling, ownership risk) is heuristic and labelled so.',
    limits: 'Needs the .git folder. Only the most recent part of very long histories is read, and the page says when it is truncated. Renames are tracked by exact match or at least 50% line similarity.',
    controls: ['history-empty', 'history-stats', 'history-churn', 'history-cochange', 'cochange-hidden-only', 'bus-factor', 'history-timeline', 'snap-from', 'snap-to', 'snap-play', 'activity-card', 'commit-calendar'],
    schematic: 'calendar',
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open History on the sample.', do: [{ tab: 'history' }] },
      ],
      sees: 'An empty state: the sample was bundled without a .git folder, so there is no history to read. It explains how to include .git when you drop your own project.',
      checks: [{ testid: 'history-empty' }],
    },
  },
  {
    id: 'symbols', title: 'Symbols', group: 'Explore',
    shows: 'Every function and method with its location, cyclomatic complexity, nesting depth, length and number of parameters, and whether it is exported.',
    question: 'Which functions are the most complicated?',
    use: [
      'Sort by complexity, length or nesting.',
      'Click a location to open the code. “References” lists where the function is used. “Impact” opens it on the Impact page.',
    ],
    read: {
      good: 'Most functions under complexity 8, and the big ones deliberately placed.',
      worry: 'Complexity of 15 or more (red) or deep nesting in a function that is also called from many places.',
    },
    sure: 'Complexity and nesting are exact counts. The confidence badge says whether the file was analysed with the compiler (resolved) or with the syntax parser (heuristic).',
    limits: 'Shows the top 300 functions. Generated and minified files are skipped. In File Mode the page is called “File”.',
    controls: ['functions'],
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open Symbols.', do: [{ tab: 'symbols' }] },
      ],
      sees: 'A table of functions sorted by complexity, each with a file:line link, a References button and an Impact button.',
      checks: [{ testid: 'functions' }],
    },
  },
  {
    id: 'search', title: 'Search', group: 'Explore',
    shows: 'Search across symbol names, file paths and the full text of every analysed file.',
    question: 'Where is this defined, and where is it used?',
    use: [
      'Choose Everything, Symbols or Text, then type.',
      'Click a symbol name to open its definition. “References (n)” lists the places that use it.',
      'In text results, “show on map” opens the System map, expands its folders and pulses the file.',
    ],
    read: {
      good: 'The definition you expected, with a reference count that matches your sense of how used it is.',
      worry: 'A reference count of zero for something you know is used: it may be reached dynamically.',
    },
    sure: 'References to TypeScript and JavaScript symbols are exact. Elsewhere they are matched by name and are heuristic.',
    limits: 'Very large files are searchable by path and symbol only, and the page says how many. Search is plain text, not regular expressions.',
    controls: ['search-input', 'symbol-results', 'find-refs', 'text-results', 'locate-on-map'],
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open Search and type placeOrder.', do: [{ tab: 'search' }, { fill: 'search-input', value: 'placeOrder' }] },
      ],
      sees: 'The definition of placeOrder in the order service, with a “References” button showing how many places use it.',
      checks: [{ testid: 'symbol-results', text: 'placeOrder' }, { testid: 'find-refs' }],
    },
  },
  {
    id: 'export', title: 'Export', group: 'Share',
    shows: 'The analysis as a report you can keep: Markdown, a ZIP for Notion, a print-ready PDF, or the raw JSON. A live preview of the report sits below.',
    question: 'How do I take this with me or share it?',
    use: [
      'Tick the sections to include, then pick a format. Files are created in your browser and saved by your browser.',
      'Markdown embeds diagrams as Mermaid code blocks that GitHub, GitLab and Obsidian draw. Notion: Settings → Import → Text & Markdown, then choose the ZIP.',
      'PDF opens the print dialog with a print layout; choose “Save as PDF”. JSON always contains everything.',
    ],
    read: {
      good: 'A preview with the sections you need and confidence labels intact.',
      worry: 'A preview with the note that analysis is still running: wait until it finishes for a complete export.',
    },
    sure: 'The report keeps every fact’s confidence label, so a reader can tell exact from inferred.',
    limits: 'The export is a snapshot of what imex worked out, with the same limits as the pages it came from.',
    controls: ['export-sections', 'export-md', 'export-notion', 'export-pdf', 'export-json', 'report'],
    example: {
      start: SAMPLE,
      steps: [
        { say: 'Open Export and scroll to the report preview.', do: [{ tab: 'export' }] },
      ],
      sees: 'Four export cards (Markdown, Notion, PDF, JSON) and a report preview for sample-express-api whose title ends in “codebase report”.',
      checks: [{ testid: 'export-md' }, { testid: 'report', text: 'codebase report' }],
    },
  },
  {
    id: 'file-mode', title: 'File Mode (a single file)', group: 'Special',
    shows: 'When you drop one file, imex shows only the pages that make sense for it: Orientation, Health, File (symbols with an internal call graph and a template-written explanation), Search and Export.',
    question: 'What does this one file do?',
    use: [
      'Read the template-generated explanation, then the internal call graph to see which functions call which.',
      'Sort the function table by complexity to find the hard parts.',
    ],
    read: {
      good: 'A small call graph and functions under complexity 8.',
      worry: 'One function that calls most of the others, or very deep nesting.',
    },
    sure: 'Same labels as everywhere else. With only one file, imports to other files cannot be followed.',
    limits: 'No System map, Flows, Data, Dependencies, Impact, History, Onboarding or Decisions: they need more than one file. The navigation says so.',
    controls: ['file-mode-note', 'file-explanation', 'call-graph'],
    example: {
      start: { file: 'greet.js', text: 'function shout(s) {\n  return s.toUpperCase();\n}\nfunction greet(name) {\n  return shout("hello " + name);\n}\nmodule.exports = { greet };\n' },
      steps: [
        { say: 'Drop a single file (here: a small greet.js).' },
        { say: 'Open the File page.', do: [{ tab: 'symbols' }] },
      ],
      sees: 'A note that architecture pages need more than one file, a short explanation of the file, and a table of its functions.',
      checks: [{ testid: 'file-mode-note' }, { testid: 'file-explanation' }, { testid: 'functions', text: 'greet' }],
    },
  },
];

// ── Terminology ────────────────────────────────────────────────────────────────────────────────────
export const TERMS: Term[] = [
  { id: 'resolved', term: 'resolved', def: CONFIDENCE_HELP.resolved, where: 'Badges beside every inferred fact; solid arrows on graphs.', why: 'You can rely on it as much as you rely on the compiler or the file it was read from.' },
  { id: 'heuristic', term: 'heuristic', aliases: ['inferred', 'guess'], def: CONFIDENCE_HELP.heuristic, where: 'Badges; dashed arrows and dashed cards.', why: 'A good lead, not proof. Open the linked source before acting on it.' },
  { id: 'unresolved', term: 'unresolved', aliases: ['unknown', 'could not determine'], def: CONFIDENCE_HELP.unresolved, where: 'Badges; dotted arrows; the “Could not determine” count on Decisions.', why: 'imex would rather say “I could not tell” than guess. These are the places to ask a person.' },
  { id: 'confidence', term: 'confidence', def: 'How sure imex is about a fact: resolved, heuristic or unresolved. Every inferred fact also has a source location.', where: 'Everywhere.', why: 'It tells you how much to trust each statement.' },
  { id: 'l0', term: 'L0 analysis', aliases: ['level 0'], def: 'The first, fastest level: it lists files, sizes, languages and manifest facts (package.json and similar) without reading the code in depth.', where: 'Orientation, shown first while deeper analysis runs.', why: 'It lets you start reading within seconds.' },
  { id: 'l1', term: 'L1 analysis', aliases: ['level 1', 'tree-sitter'], def: 'Reads the code’s structure with a syntax parser (tree-sitter) for 13 languages and links files by names and conventions.', where: 'Everything for non-TypeScript/JavaScript code.', why: 'Good coverage across languages, but links are best guesses, so they are heuristic.' },
  { id: 'l2', term: 'L2 analysis', aliases: ['level 2', 'compiler'], def: 'For TypeScript and JavaScript, uses the real TypeScript compiler to resolve imports and references exactly.', where: 'TypeScript and JavaScript projects: solid arrows, exact References.', why: 'The most trustworthy level. It is also how imex measures how good L1 is.' },
  { id: 'file-mode', term: 'File Mode', aliases: ['single file'], def: 'What happens when you drop one file: only the pages that make sense for a single file are shown.', where: 'Top bar badge; navigation note.', why: 'Architecture needs more than one file, so those pages are hidden rather than empty.' },
  { id: 'coverage', term: 'coverage', aliases: ['skipped files'], def: 'How much of what you dropped was actually analysed. Skipped files (too large, binary, minified, generated, ignored) are listed with a reason.', where: 'Orientation → “Coverage and skipped files”.', why: 'A result can only be as complete as its coverage.' },
  { id: 'notice', term: 'notice', aliases: ['warning'], def: 'A message that a step hit a limit or failed and the analysis carried on without it.', where: 'Orientation, under the summary.', why: 'A missing section is explained instead of silently absent.' },
  { id: 'module', term: 'module', def: 'A group of files, usually a folder, treated as one unit when a picture would otherwise have too many boxes.', where: 'Dependency matrix; History snapshots.', why: 'Keeps pictures readable on big projects.' },
  { id: 'entry-point', term: 'entry point', def: 'Where execution can start: an HTTP route, a page, the program’s main, a command, a background job or an event handler.', where: 'Orientation, Flows, Impact.', why: 'To understand what the program does, start from what can trigger it.' },
  { id: 'route', term: 'route', aliases: ['endpoint', 'API'], def: 'A web address plus an HTTP method (for example GET /api/users) that the program answers.', where: 'Flows (“HTTP routes”).', why: 'Routes are the public surface of a server.' },
  { id: 'handler', term: 'handler', aliases: ['controller action'], def: 'The function that runs when a route is hit.', where: 'Flows steps.', why: 'It is where the behaviour of an endpoint starts.' },
  { id: 'middleware', term: 'middleware', def: 'Code that runs before the handler for many routes at once: authentication, logging, input checks.', where: 'Flows, above the handler.', why: 'A missing middleware, such as no authentication on a route, is easy to spot in a flow.' },
  { id: 'role', term: 'role', def: 'What kind of file this appears to be (route, controller, service, model, test, configuration…), inferred from names, folders and framework patterns. Colour shows it.', where: 'Badges; map and treemap colours.', why: 'Lets you read the structure at a glance. Always heuristic.' },
  { id: 'symbol', term: 'symbol', aliases: ['definition', 'function', 'class'], def: 'A named thing defined in code: a function, method, class and so on.', where: 'Symbols, Search.', why: 'Symbols are what you search for and what changes break.' },
  { id: 'import', term: 'import', aliases: ['require', 'dependency edge'], def: 'One file loading another. Each import is an arrow on the system map.', where: 'System map, Dependencies.', why: 'Imports are the clearest record of what depends on what.' },
  { id: 'external-package', term: 'external package', aliases: ['library', 'third-party'], def: 'A library from outside the project, such as express.', where: 'Dependencies → “External packages”.', why: 'Shows what the project relies on, and what is used but not declared.' },
  { id: 'fan-in', term: 'fan-in', def: 'How many files import this one.', where: 'Coupling metrics; map “size by”.', why: 'High fan-in means many files could break if this changes.' },
  { id: 'fan-out', term: 'fan-out', def: 'How many files this one imports.', where: 'Coupling metrics.', why: 'High fan-out means it knows about a lot, and a change elsewhere can reach it.' },
  { id: 'instability', term: 'instability', def: 'Fan-out divided by fan-in plus fan-out, from 0 to 1. Near 0 is depended on by others and rarely depends on anything; near 1 depends on others and nothing depends on it.', where: 'Coupling metrics.', why: 'Stable files should change rarely; unstable ones are fine to change often.' },
  { id: 'complexity', term: 'cyclomatic complexity', aliases: ['complexity', 'nesting'], def: 'A count of the independent paths through a function (each if, loop or case adds one). Nesting is how deep the blocks inside one another go.', where: 'Symbols, Health, treemap colour.', why: 'The higher the number, the harder a function is to read and test. 8 or more is amber, 15 or more is red.' },
  { id: 'circular', term: 'circular dependency', aliases: ['cycle', 'import loop'], def: 'Files that import each other in a loop: A uses B uses A.', where: 'Dependencies; red outlines in the matrix.', why: 'Loops make code hard to change or test one piece at a time.' },
  { id: 'god-module', term: 'god module', aliases: ['big file'], def: 'A file that is too big or too connected: at least two of over 1,000 lines, over 50 definitions, imports over 20 files, imported by over 30 files, or very high total complexity.', where: 'Dependencies.', why: 'Everything tends to end up in them, and they are risky to touch.' },
  { id: 'layering', term: 'layering violation', aliases: ['layer'], def: 'Code reaching across the layers it is expected to respect, for example a controller querying the database directly when the project has a service layer.', where: 'Dependencies; amber cells in the matrix.', why: 'Skipping layers makes logic duplicate and harder to move. Always labelled heuristic.' },
  { id: 'dead-export', term: 'dead export', aliases: ['unused export'], def: 'Something exported from a file that no other analysed file uses.', where: 'Health.', why: 'Candidates for deleting. Check that nothing outside the project uses it.' },
  { id: 'clone', term: 'clone', aliases: ['duplicate', 'duplicated code'], def: 'A block of code that appears again, almost unchanged, in another place.', where: 'Health.', why: 'A bug fixed in one copy may remain in the others.' },
  { id: 'hotspot', term: 'hotspot', def: 'A file that is both complicated and changed often (complexity × churn).', where: 'Health (hotspot map and list).', why: 'Bugs gather where complex code is under constant change.' },
  { id: 'churn', term: 'churn', def: 'How often a file has changed in the git history.', where: 'History; treemap and map colour.', why: 'Changing often is a sign of either active work or instability.' },
  { id: 'co-change', term: 'co-change', aliases: ['change together'], def: 'Two files that keep appearing in the same commits.', where: 'History → “Files that change together”.', why: 'Shows coupling that no import reveals.' },
  { id: 'hidden-coupling', term: 'hidden coupling', def: 'A co-changing pair with no import path between them within four steps (for a test and the code it exercises, any path counts).', where: 'History badge and filter.', why: 'These pairs are surprises: people must remember to change both. Heuristic.' },
  { id: 'bus-factor', term: 'bus factor', aliases: ['truck factor', 'ownership'], def: 'The fewest people who together wrote the main share of the files. Low means few people hold the knowledge.', where: 'History → Ownership.', why: 'If one of them leaves, who can maintain it?' },
  { id: 'snapshot', term: 'snapshot', aliases: ['time-travel'], def: 'A picture of the architecture at one point in history. imex takes up to ten (the first commit, recent tags, and the latest) and lets you compare any two.', where: 'History → “Architecture over time”.', why: 'See how the structure grew, and which modules were added or dropped.' },
  { id: 'blast-radius', term: 'blast radius', aliases: ['affected files'], def: 'Everything a change could reach: the files that depend on it, directly and through other files, and the entry points and tests among them.', where: 'Impact.', why: 'Tells you how careful to be, and which tests to run.' },
  { id: 'risk-score', term: 'risk score', def: 'A number from 0 to 100 on the Impact page, built from visible factors (dependents, entry points, complexity, tests). A rule of thumb, not a prediction.', where: 'Impact.', why: 'A quick way to compare changes. The factors are listed beside it.' },
  { id: 'treemap', term: 'treemap', def: 'A picture where every box is a file and its area is its size in lines; folders are groups of boxes.', where: 'Orientation.', why: 'Shows where the code lives and which parts are large.' },
  { id: 'dsm', term: 'dependency matrix', aliases: ['DSM', 'design structure matrix'], def: 'A grid where a row imports a column. Ordered so that layers read from top to bottom, so cells on the wrong side of the diagonal stand out.', where: 'Dependencies.', why: 'Cycles and layering problems show up as patterns, not as a tangle of arrows.' },
  { id: 'er', term: 'ER diagram', aliases: ['entity relationship', 'data model'], def: 'A drawing of data entities (tables, models), their fields and how they relate.', where: 'Data.', why: 'The shape of the data usually explains the shape of the code.' },
  { id: 'entity', term: 'entity', aliases: ['model', 'table'], def: 'One kind of record the system stores, such as User or Order.', where: 'Data.', why: 'The nouns of the system.' },
  { id: 'adr', term: 'decision record (ADR)', aliases: ['architecture decision record', 'ADR'], def: 'A short document in the repository where the team wrote down a decision, its context and its consequences.', where: 'Decisions, category “Documented”.', why: 'The only place where the reason comes straight from the team. Always resolved.' },
  { id: 'decision-category', term: 'decision category', def: 'The kind of choice: Documented (the team’s own records), Architecture, Stack, Data, API, Security, Operations or Quality.', where: 'Decisions filters.', why: 'Lets you read one area at a time.' },
  { id: 'glossary-term', term: 'glossary term', def: 'A word that matters in this project (an entity, a route noun or something used across several files), with where it appears.', where: 'Onboarding → Glossary.', why: 'The project’s own vocabulary, for newcomers.' },
  { id: 'reading-path', term: 'reading path', def: 'A suggested order for reading the code, from documentation and the entry point through routes and data to rough edges.', where: 'Onboarding.', why: 'Saves choosing where to start.' },
  { id: 'source-panel', term: 'source panel', def: 'The code preview that slides in from the right when you click a file or file:line.', where: 'Any page with a file link.', why: 'Lets you check any claim against the real code.' },
  { id: 'reanalyze', term: 'Re-analyze', def: 'Run the analysis again on a stored project. If the browser still has access to the folder it is re-read; otherwise the stored copy is used. Unchanged files are not re-parsed.', where: 'Home → Stored projects.', why: 'Picks up new files or new features of imex.' },
];

// ── Controls and shortcuts ─────────────────────────────────────────────────────────────────────────
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: '/', does: 'Jump to the filter box of the page you are on, or open Search if the page has none (not while you are typing in a box).' },
  { keys: '↑  ↓  Home  End', does: 'Move through the list in Flows, Data and Decisions when the list has focus. The detail follows the selection.' },
  { keys: 'Click a graph node', does: 'Focus it: its neighbours and arrows light up and the rest fades. Click empty canvas to clear.' },
  { keys: 'Double-click a folder', does: 'Open (or close) a folder on the System map.' },
  { keys: '+  −  Fit', does: 'Zoom in, zoom out, or fit the whole graph. Drag the small map in the corner to move around.' },
  { keys: 'Export button on a graph', does: 'Save the current view as a PNG, or as an SVG diagram.' },
  { keys: 'Any file or file:line', does: 'Open the source panel at that line. The ✕ in the panel closes it.' },
  { keys: 'Picture / table', does: 'Switch a picture to the plain table with the same numbers.' },
  { keys: 'Moon / sun button', does: 'Switch between light and dark themes. The choice is remembered in this browser.' },
  { keys: 'imex logo', does: 'Return to Home (this page) from an open project. Your stored projects are here.' },
  { keys: 'Reduced motion', does: 'If your system asks for reduced motion, imex turns animations off. Everything still works, only without movement.' },
  { keys: 'Analysis settings (Home)', does: 'Ignore list in .gitignore syntax, whether to respect .gitignore files, the per-file size cap and parse timeout. Changes apply to the next analysis.' },
  { keys: 'Keep for (Home)', does: 'How long stored projects are kept: 1, 7 or 30 days, or until cleared.' },
];

// ── Privacy and limits ─────────────────────────────────────────────────────────────────────────────
export const LIMITS: { title: string; items: string[] }[] = [
  {
    title: 'What stays on your machine',
    items: [
      'Everything. Files are read in this browser tab and analysed in background workers in the same tab. No code, file names or usage data are sent anywhere, and there is no telemetry.',
      'The fonts and all the code of imex are bundled with the page, so after the first load it also works offline.',
      'If a future feature sends anything off your machine (for example optional AI help), it will be off by default, clearly labelled, and the “100% local” indicator at the top will change.',
    ],
  },
  {
    title: 'What is stored, and how to remove it',
    items: [
      'The analysis, and the source text for previews, are kept in your browser’s IndexedDB so projects survive a refresh. Your theme choice and checklist ticks are in local storage.',
      'Stored projects appear under “Stored projects” on this page, with their size and when they expire. “Keep for” sets the retention.',
      'Delete removes one project. “Clear all data” removes everything. Clearing site data in your browser does the same.',
      'If the browser’s storage is full, imex keeps the analysis but not the source text, and tells you that previews are missing.',
    ],
  },
  {
    title: 'Why a result can be wrong',
    items: [
      'imex reads code without running it. It cannot see what only happens at runtime: dynamic imports, reflection, dependency injection, generated code, configuration that changes behaviour.',
      'Anything inferred from names, folders or patterns is heuristic and says so. Heuristic edges in languages other than TypeScript and JavaScript can be false positives.',
      'Counts (lines, commits, complexity) are exact. What they suggest (hotspot, hidden coupling, risk) is a signal to check.',
      'Doubt a result when: it has a heuristic or unresolved badge and matters to a decision, it contradicts what you know, or the page shows a notice or truncation message.',
    ],
  },
  {
    title: 'When something is missing',
    items: [
      'Nothing was found: check Orientation → “Coverage and skipped files”. The ignore list, the size cap or a wrong folder may have excluded your code.',
      'Everything is heuristic: the project is probably not TypeScript or JavaScript. That is expected; open the linked source for anything that matters.',
      'No History page content: the .git folder was not included. Drop the project folder with .git, or a ZIP that contains it.',
      'No entry points, data model or decisions: the framework or ORM may not be one imex recognises. The pages say what they looked for.',
      'Big projects: very large folders stay collapsed on the map, and long lists show the top rows with a “show more”. Analysis of tens of thousands of files can take a while; the progress bar shows where it is.',
      'A project analysed with an older version of imex: use “Re-analyze” under Stored projects to get newer pages.',
    ],
  },
];
