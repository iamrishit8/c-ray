// Framework-independent facts: external HTTP calls, message queues, background
// jobs, CLI entry points and database access points. Pattern-based → heuristic.
import type { EntryPoint, Fact, FileUnit } from '../types';
import { CODE_LANGS } from '../l0/languages';
import { callArgs, DetectContext, type Detector, type RoleHint } from './types';

interface Pat {
  langs: string[];
  /** cheap substring prefilter */
  hint: string[];
  re: RegExp;
  kind: Fact['kind'];
  tech: string;
  /** capture group index holding the target (URL, topic, …), if any */
  target?: number;
  detail: string;
}

const JS = ['javascript', 'typescript'];
const URL_ARG = `\\s*(?:<[^>]*>)?\\(\\s*(?:(["'\`])([^"'\`]*)\\1)?`;

const PATTERNS: Pat[] = [
  // ---- external HTTP calls ----
  { langs: JS, hint: ['axios'], re: new RegExp(`\\baxios(?:\\.(?:get|post|put|patch|delete|head|request))?${URL_ARG}`, 'g'), kind: 'http-call', tech: 'axios', target: 2, detail: 'HTTP call via axios' },
  { langs: JS, hint: ['fetch('], re: new RegExp(`(?<![\\w$.])fetch${URL_ARG}`, 'g'), kind: 'http-call', tech: 'fetch', target: 2, detail: 'HTTP call via fetch' },
  { langs: JS, hint: ['got', 'superagent', 'needle', 'undici'], re: new RegExp(`\\b(?:got|superagent|needle|request)(?:\\.(?:get|post|put|patch|delete))${URL_ARG}`, 'g'), kind: 'http-call', tech: 'http-client', target: 2, detail: 'HTTP call via client library' },
  { langs: JS, hint: ['http.request', 'https.request', 'https.get', 'http.get'], re: /\bhttps?\.(?:request|get)\s*\(/g, kind: 'http-call', tech: 'node:http', detail: 'HTTP call via node http(s)' },
  { langs: JS, hint: ['HttpService', 'httpService'], re: /\b(?:this\.)?httpService\.(?:get|post|put|patch|delete|request)\s*[<(]/g, kind: 'http-call', tech: 'nestjs-http', detail: 'HTTP call via HttpService' },
  { langs: ['python'], hint: ['requests', 'httpx', 'urlopen', 'aiohttp'], re: new RegExp(`\\b(?:requests|httpx|session|client)\\.(?:get|post|put|patch|delete|head|request)${URL_ARG}|\\burlopen\\s*\\(|\\baiohttp\\.ClientSession\\s*\\(`, 'g'), kind: 'http-call', tech: 'requests', target: 2, detail: 'HTTP call via requests/httpx' },
  { langs: ['java', 'kotlin'], hint: ['RestTemplate', 'restTemplate', 'WebClient', 'webClient', 'HttpClient', 'FeignClient', 'OkHttp'], re: /\b(?:restTemplate|RestTemplate)\s*\.\s*(?:getForObject|getForEntity|postForObject|postForEntity|exchange|put|delete|patchForObject)\s*\(|\bwebClient\s*\.\s*(?:get|post|put|delete|patch|method)\s*\(|\bHttpClient\.newHttpClient\s*\(|@FeignClient\b|\bnew\s+OkHttpClient\b|\bhttpClient\.send\s*\(/g, kind: 'http-call', tech: 'http-client', detail: 'outbound HTTP call' },
  { langs: ['go'], hint: ['http.'], re: new RegExp(`\\bhttp\\.(?:Get|Post|PostForm|Head|NewRequest|NewRequestWithContext)${URL_ARG}`, 'g'), kind: 'http-call', tech: 'net/http', target: 2, detail: 'outbound HTTP call (net/http)' },
  { langs: ['php'], hint: ['curl_init', 'file_get_contents', 'Http::', 'Guzzle', '->request('], re: new RegExp(`\\bcurl_init${URL_ARG}|\\bfile_get_contents\\s*\\(\\s*(["'])(https?:[^"']*)\\3|\\bHttp::(?:get|post|put|patch|delete)${URL_ARG}|\\bnew\\s+(?:\\\\?GuzzleHttp\\\\)?Client\\s*\\(`, 'g'), kind: 'http-call', tech: 'curl', target: 2, detail: 'outbound HTTP call' },
  { langs: ['ruby'], hint: ['Net::HTTP', 'HTTParty', 'Faraday', 'RestClient'], re: /\bNet::HTTP\.(?:get|post|start|new|get_response)\b|\bHTTParty\.(?:get|post|put|delete)\b|\bFaraday\.(?:get|post|new)\b|\bRestClient\.(?:get|post|put|delete)\b/g, kind: 'http-call', tech: 'http-client', detail: 'outbound HTTP call' },
  { langs: ['csharp'], hint: ['HttpClient', 'Async('], re: /\b_?(?:http|httpClient|client)\w*\.(?:GetAsync|PostAsync|PutAsync|DeleteAsync|SendAsync|GetStringAsync|GetFromJsonAsync|PostAsJsonAsync)\s*[<(]/gi, kind: 'http-call', tech: 'HttpClient', detail: 'outbound HTTP call (HttpClient)' },
  { langs: ['rust'], hint: ['reqwest'], re: /\breqwest::(?:get|Client|blocking)\b/g, kind: 'http-call', tech: 'reqwest', detail: 'outbound HTTP call (reqwest)' },

  // ---- message queues / pub-sub ----
  { langs: JS, hint: ['kafka', 'Kafka', 'producer', 'consumer'], re: /\bproducer\.send\s*\(\s*\{[^}]*?topic\s*:\s*(["'`])([^"'`]+)\1/gs, kind: 'queue-pub', tech: 'kafka', target: 2, detail: 'Kafka produce' },
  { langs: JS, hint: ['consumer.subscribe'], re: /\bconsumer\.subscribe\s*\(\s*\{[^}]*?topics?\s*:\s*\[?\s*(["'`])([^"'`]+)\1/gs, kind: 'queue-sub', tech: 'kafka', target: 2, detail: 'Kafka subscribe' },
  { langs: JS, hint: ['sendToQueue', 'channel.publish', 'channel.consume', 'assertQueue'], re: /\b(?:channel|ch)\.(sendToQueue|publish)\s*\(\s*(["'`])([^"'`]*)\2/g, kind: 'queue-pub', tech: 'rabbitmq', target: 3, detail: 'RabbitMQ publish' },
  { langs: JS, hint: ['channel.consume', 'ch.consume'], re: /\b(?:channel|ch)\.consume\s*\(\s*(["'`])([^"'`]*)\1/g, kind: 'queue-sub', tech: 'rabbitmq', target: 2, detail: 'RabbitMQ consume' },
  { langs: JS, hint: ['.publish('], re: /\b(\w*(?:redis|Redis|pub|publisher|client|mqtt|mqttClient|broker|nats)\w*)\.publish\s*\(\s*(["'`])([^"'`]+)\2/g, kind: 'queue-pub', tech: 'pubsub', target: 3, detail: 'publish' },
  { langs: JS, hint: ['.subscribe('], re: /\b(\w*(?:redis|Redis|sub|subscriber|client|mqtt|mqttClient|broker|nats)\w*)\.p?subscribe\s*\(\s*(["'`])([^"'`]+)\2/g, kind: 'queue-sub', tech: 'pubsub', target: 3, detail: 'subscribe' },
  { langs: JS, hint: ['Queue(', 'queue.add', 'Queue.add', 'Worker('], re: /\b(\w*[qQ]ueue\w*)\.add\s*\(\s*(["'`])([^"'`]+)\2/g, kind: 'queue-pub', tech: 'bull', target: 3, detail: 'job enqueued (Bull/BullMQ)' },
  { langs: JS, hint: ['new Worker(', '.process('], re: /\bnew\s+Worker\s*\(\s*(["'`])([^"'`]+)\1|\b\w*[qQ]ueue\w*\.process\s*\(\s*(?:(["'`])([^"'`]+)\3)?/g, kind: 'queue-sub', tech: 'bull', target: 2, detail: 'queue worker (Bull/BullMQ)' },
  { langs: ['python'], hint: ['.delay(', 'apply_async', 'basic_publish', 'basic_consume', 'publish(', 'subscribe(', 'send('], re: /\b(\w+)\.(?:delay|apply_async)\s*\(/g, kind: 'queue-pub', tech: 'celery', target: 1, detail: 'Celery task enqueued' },
  { langs: ['python'], hint: ['basic_publish', 'producer.send', '.publish('], re: /\bbasic_publish\s*\([^)]*?routing_key\s*=\s*(["'])([^"']*)\1|\bproducer\.send\s*\(\s*(["'])([^"']+)\3|\b\w*(?:client|mqtt|redis|r)\w*\.publish\s*\(\s*(["'])([^"']+)\5/gs, kind: 'queue-pub', tech: 'queue', target: 2, detail: 'message published' },
  { langs: ['python'], hint: ['basic_consume', 'KafkaConsumer', '.subscribe('], re: /\bbasic_consume\s*\([^)]*?queue\s*=\s*(["'])([^"']*)\1|\bKafkaConsumer\s*\(\s*(["'])([^"']+)\3|\b\w*(?:client|mqtt|pubsub|consumer)\w*\.subscribe\s*\(\s*\[?\s*(["'])([^"']+)\5/gs, kind: 'queue-sub', tech: 'queue', target: 2, detail: 'message consumer' },
  { langs: ['java', 'kotlin'], hint: ['kafkaTemplate', 'KafkaTemplate', 'rabbitTemplate', 'jmsTemplate', 'convertAndSend'], re: /\b(?:kafkaTemplate|rabbitTemplate|jmsTemplate|amqpTemplate|streamBridge)\s*\.\s*(?:send|convertAndSend|sendDefault)\s*\(\s*(?:"([^"]*)")?/gi, kind: 'queue-pub', tech: 'messaging', target: 1, detail: 'message published' },
  { langs: ['go'], hint: ['Publish(', 'Subscribe(', 'WriteMessages', 'ReadMessage'], re: /\b\w+\.(?:Publish|WriteMessages)\s*\(\s*(?:\w+\s*,\s*)?(?:"([^"]*)")?/g, kind: 'queue-pub', tech: 'queue', target: 1, detail: 'message published' },
  { langs: ['go'], hint: ['Subscribe(', 'ReadMessage', 'Consume('], re: /\b\w+\.(?:Subscribe|QueueSubscribe|Consume)\s*\(\s*(?:"([^"]*)")?/g, kind: 'queue-sub', tech: 'queue', target: 1, detail: 'message consumer' },
  { langs: ['ruby'], hint: ['perform_async', 'perform_later', 'deliver_later'], re: /\b([A-Z]\w+)\.(?:perform_async|perform_later|perform_in|set\([^)]*\)\.perform_later)\b/g, kind: 'queue-pub', tech: 'activejob', target: 1, detail: 'background job enqueued' },
  { langs: ['php'], hint: ['dispatch(', '::dispatch', 'basic_publish'], re: /\b([A-Z]\w+)::dispatch\s*\(|\bdispatch\s*\(\s*new\s+([A-Z]\w+)/g, kind: 'queue-pub', tech: 'laravel-queue', target: 1, detail: 'job dispatched' },
  { langs: ['csharp'], hint: ['PublishAsync', 'ProduceAsync', 'BasicPublish', 'SendMessageAsync'], re: /\b\w+\.(?:PublishAsync|Publish|ProduceAsync|BasicPublish|SendMessageAsync)\s*[<(]\s*(?:"([^"]*)")?/g, kind: 'queue-pub', tech: 'messaging', target: 1, detail: 'message published' },

  // ---- background jobs ----
  { langs: JS, hint: ['schedule(', 'scheduleJob', 'CronJob'], re: /\b(?:cron|nodeCron|schedule)\.(?:schedule|scheduleJob)\s*\(\s*(["'`])([^"'`]+)\1|\bnew\s+CronJob\s*\(\s*(["'`])([^"'`]+)\3/g, kind: 'job', tech: 'cron', target: 2, detail: 'scheduled job' },
  { langs: ['python'], hint: ['@shared_task', '.task', 'periodic_task', 'add_job', '@scheduler'], re: /^[ \t]*@(?:shared_task|\w+\.task|periodic_task|\w+\.periodic_task|celery\.task)\b|\b\w+\.add_job\s*\(|^[ \t]*@\w*scheduler\w*\.scheduled_job\b/gm, kind: 'job', tech: 'celery', detail: 'background task' },
  { langs: ['go'], hint: ['AddFunc', 'cron.New', 'time.NewTicker'], re: /\b\w+\.AddFunc\s*\(\s*"([^"]+)"/g, kind: 'job', tech: 'cron', target: 1, detail: 'scheduled job' },
  { langs: ['csharp'], hint: ['RecurringJob', 'BackgroundJob'], re: /\b(?:RecurringJob\.AddOrUpdate|BackgroundJob\.Enqueue|BackgroundJob\.Schedule)\s*[<(]/g, kind: 'job', tech: 'hangfire', detail: 'Hangfire job' },
  { langs: ['php'], hint: ['$schedule->'], re: /\$schedule->(?:command|job|call|exec)\s*\(\s*(?:(["'])([^"']+)\1)?/g, kind: 'job', tech: 'laravel-scheduler', target: 2, detail: 'scheduled task' },
  { langs: ['ruby'], hint: ['every '], re: /^\s*every\s+[\w.:'" ,]+\s+do\b/gm, kind: 'job', tech: 'whenever', detail: 'scheduled task (whenever)' },

  // ---- CLI entry points ----
  { langs: JS, hint: ['.command(', 'yargs', 'commander'], re: /\.command\s*\(\s*(["'`])([^"'`]+)\1/g, kind: 'cli', tech: 'cli', target: 2, detail: 'CLI command' },
  { langs: ['python'], hint: ['ArgumentParser', '@click', 'typer', '.command('], re: /\bargparse\.ArgumentParser\s*\(|\bArgumentParser\s*\(|^[ \t]*@click\.(?:command|group)\b|^[ \t]*@\w+\.command\s*\(/gm, kind: 'cli', tech: 'cli', detail: 'CLI entry point' },
  { langs: ['go'], hint: ['cobra.Command', 'flag.Parse', 'cli.App', 'cli.Command'], re: /&cobra\.Command\s*\{\s*(?:Use:\s*"([^"]+)")?|\bflag\.Parse\s*\(\s*\)|&cli\.(?:App|Command)\s*\{/g, kind: 'cli', tech: 'cli', target: 1, detail: 'CLI command' },
  { langs: ['rust'], hint: ['clap', 'StructOpt', 'Parser'], re: /#\[derive\([^)]*\b(?:Parser|StructOpt|Subcommand)\b[^)]*\)\]/g, kind: 'cli', tech: 'clap', detail: 'CLI definition (clap)' },
  { langs: ['java', 'kotlin'], hint: ['@Command', 'CommandLineRunner'], re: /@(?:CommandLine\.)?Command\s*\(\s*name\s*=\s*"([^"]+)"|\bimplements\s+[\w, ]*\b(?:CommandLineRunner|ApplicationRunner)\b/g, kind: 'cli', tech: 'cli', target: 1, detail: 'CLI entry point' },
  { langs: ['ruby'], hint: ['< Thor', 'OptionParser'], re: /<\s*Thor\b|\bOptionParser\.new\b/g, kind: 'cli', tech: 'cli', detail: 'CLI entry point' },
  { langs: ['csharp'], hint: ['System.CommandLine', 'RootCommand'], re: /\bnew\s+RootCommand\s*\(/g, kind: 'cli', tech: 'cli', detail: 'CLI entry point' },
];

// ------------------------------------------------------------------ database access
const NOT_MODEL = /^(Object|Array|Promise|JSON|Math|Date|Number|String|Reflect|Symbol|Map|Set|Buffer|Error|Rails|Time|File|Dir|Integer|Float|Hash|Kernel|Process|ENV|Thread|Logger|I18n|Struct|Class|Module|Regexp|Exception|Boolean|RegExp|Intl|Proxy|React|Vue|Router|Auth|Log|Cache|Config|Storage|Route|Http|Str|Arr|Carbon|Validator|Session|View|Response|Request|Redirect|Hash|Event|Mail|Queue|Schema|Artisan|App|URL|Lang|Gate|Bus|Notification|Password|Crypt|Cookie|Blade|Broadcast|File|Self|Console|Path|Optional|Objects|Arrays|Collections|List|Stream|System|Thread|Integer|Long|Double|Collectors|Files|Paths|Enumerable|Task|Convert|Guid|DateTime|TimeSpan|Environment|Activator|Type|Assert|Mockito|Mock)$/;
const READ = 'find|findOne|findById|findByPk|findAll|findMany|findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findOneBy|findBy|findAndCount|findAndCountAll|findOneOrFail|countDocuments|estimatedDocumentCount|count|aggregate|groupBy|exists|distinct|populate';
const WRITE = 'create|createMany|insertMany|insert|bulkCreate|update|updateOne|updateMany|upsert|findByIdAndUpdate|findOneAndUpdate|findOneAndDelete|findOneAndRemove|findByIdAndDelete|findByIdAndRemove|deleteOne|deleteMany|delete|destroy|remove|replaceOne|bulkWrite|save|softDelete|softRemove|increment|decrement|truncate';
const JS_MODEL_CALL = new RegExp(`(?<![\\w$.])([A-Z][A-Za-z0-9]*)\\.(${READ}|${WRITE})\\s*\\(`, 'g');
const JS_WRITES = new Set(WRITE.split('|'));
const SQL_STMT = /\b(SELECT\b[^;]*?\bFROM|INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+[`"\[]?([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)[`"\]]?/i;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function singular(s: string): string {
  return s.endsWith('ies') ? s.slice(0, -3) + 'y' : /(ses|xes|ches|shes)$/.test(s) ? s.slice(0, -2) : s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s;
}

function dbFacts(ctx: DetectContext, u: FileUnit, out: Fact[]) {
  const t = u.text;
  const lang = u.lang;
  const add = (index: number, target: string | undefined, op: 'read' | 'write', detail: string, tech: string) => {
    out.push({ kind: 'db', file: u.path, line: ctx.lineAt(u, index), detail, target, op, tech, conf: 'heuristic', detector: 'facts' });
  };
  const isJs = lang === 'javascript' || lang === 'typescript';

  // raw SQL in string literals (any language)
  if (lang !== 'sql' && /SELECT|INSERT|UPDATE|DELETE|REPLACE/i.test(t)) {
    const lines = t.split('\n');
    let offset = 0;
    for (const line of lines) {
      if (line.length < 2000 && /["'`]/.test(line)) {
        const q = /["'`]([^"'`]*\b(?:SELECT|INSERT|UPDATE|DELETE|REPLACE)\b.*)$/i.exec(line);
        const m = q ? SQL_STMT.exec(q[1]) : null;
        if (m && !/^(set|the|a|an|to|is|your|this|that|it)$/i.test(m[2]) && (/^SELECT/i.test(m[1]) || /^INSERT|^DELETE|^REPLACE/i.test(m[1]) || /\bSET\b/i.test(q![1]))) {
          const verb = m[1].split(/\s+/)[0].toUpperCase();
          add(offset + (q!.index ?? 0), m[2].split('.').pop(), verb === 'SELECT' ? 'read' : 'write', `raw SQL ${verb} on ${m[2]}`, 'sql');
        }
      }
      offset += line.length + 1;
    }
  }

  if (isJs) {
    // Model.verb(...)  — Mongoose / Sequelize / TypeORM active record
    if (ctx.hasTech('mongoose', 'sequelize', 'typeorm', 'mongodb') || /mongoose|sequelize|typeorm/i.test(t)) {
      for (const m of t.matchAll(JS_MODEL_CALL)) {
        if (NOT_MODEL.test(m[1])) continue;
        add(m.index!, m[1], JS_WRITES.has(m[2]) ? 'write' : 'read', `${m[1]}.${m[2]}()`, 'orm');
      }
      const vars = new Map<string, string>();
      for (const m of t.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:new\s+([A-Z]\w*)\s*\(|([A-Z]\w*)\.(?:findOne|findById|findByPk|findOneBy|findUnique)\s*\()/g)) {
        const model = m[2] ?? m[3];
        if (!NOT_MODEL.test(model)) vars.set(m[1], model);
      }
      for (const m of t.matchAll(/(?<![\w$.])(\w+)\.(save|remove|destroy|deleteOne|updateOne|update)\s*\(/g)) {
        const model = vars.get(m[1]);
        if (model) add(m.index!, model, 'write', `${m[1]}.${m[2]}() on a ${model}`, 'orm');
      }
    }
    // Prisma: prisma.user.findMany()
    for (const m of t.matchAll(/\b(?:this\.)?(\w*[pP]risma\w*|db|tx)\.(\w+)\.(\w+)\s*\(/g)) {
      if (m[1] === 'db' && !ctx.hasTech('prisma')) continue;
      if (m[2].startsWith('$')) continue;
      const read = /^(find|count|aggregate|groupBy)/.test(m[3]);
      const write = /^(create|update|upsert|delete)/.test(m[3]);
      if (read || write) add(m.index!, cap(m[2]), write ? 'write' : 'read', `prisma.${m[2]}.${m[3]}()`, 'prisma');
    }
    for (const m of t.matchAll(/\.\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\b/g)) add(m.index!, undefined, m[1].startsWith('query') ? 'read' : 'write', `prisma.$${m[1]} (raw SQL)`, 'prisma');
    // TypeORM repositories
    const repoVars = new Map<string, string>();
    for (const m of t.matchAll(/(\w+)\s*:\s*(?:Repository|MongoRepository|TreeRepository)<\s*(\w+)\s*>/g)) repoVars.set(m[1], m[2]);
    for (const m of t.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*[\w.]+\.getRepository\s*\(\s*(\w+)\s*\)/g)) repoVars.set(m[1], m[2]);
    for (const m of t.matchAll(/\.getRepository\s*\(\s*(\w+)\s*\)\s*\.\s*(\w+)\s*\(/g)) {
      add(m.index!, m[1], JS_WRITES.has(m[2]) ? 'write' : 'read', `getRepository(${m[1]}).${m[2]}()`, 'typeorm');
    }
    if (repoVars.size) {
      for (const m of t.matchAll(/\b(?:this\.)?(\w+)\.(\w+)\s*\(/g)) {
        const ent = repoVars.get(m[1]);
        if (!ent) continue;
        if (JS_WRITES.has(m[2]) || new RegExp(`^(${READ}|createQueryBuilder|query)$`).test(m[2])) add(m.index!, ent, JS_WRITES.has(m[2]) ? 'write' : 'read', `${m[1]}.${m[2]}() on ${ent}`, 'typeorm');
      }
    }
    for (const m of t.matchAll(/\b(?:pool|client|connection|conn|db|knex|sql|database)\.(query|execute|raw)\s*\(/g)) {
      const line = ctx.lineAt(u, m.index!);
      if (!out.some((f) => f.file === u.path && f.line === line && f.kind === 'db')) add(m.index!, undefined, 'read', `${m[0].replace(/\s*\($/, '')}() database call`, 'sql');
    }
    for (const m of t.matchAll(/\bknex\s*\(\s*(["'`])(\w+)\1\s*\)/g)) add(m.index!, m[2], /\.(insert|update|del|delete)\s*\(/.test(t.slice(m.index!, m.index! + 300).split(';')[0]) ? 'write' : 'read', `knex('${m[2]}')`, 'knex');
  }

  if (lang === 'python') {
    for (const m of t.matchAll(/\b([A-Z]\w*)\.objects\b([^\n]*)/g)) {
      const chain = m[2];
      const write = /\.(create|update|delete|bulk_create|bulk_update|get_or_create|update_or_create)\s*\(/.test(chain);
      add(m.index!, m[1], write ? 'write' : 'read', `${m[1]}.objects${(/^(\.\w+)/.exec(chain)?.[1] ?? '')}${write && !/^\.(create|update|delete|bulk|get_or|update_or)/.test(chain) ? ' … write' : ''}`, 'django-orm');
    }
    const vars = new Map<string, string>();
    for (const m of t.matchAll(/^[ \t]*(\w+)\s*=\s*(?:([A-Z]\w*)\.objects\.(?:get|create|first|get_or_create|filter)\b|([A-Z]\w*)\s*\()/gm)) vars.set(m[1], m[2] ?? m[3]);
    for (const m of t.matchAll(/^[ \t]*(\w+)\.(save|delete)\s*\(/gm)) {
      const model = vars.get(m[1]);
      if (model && !NOT_MODEL.test(model)) add(m.index!, model, 'write', `${m[1]}.${m[2]}() on a ${model}`, 'django-orm');
    }
    for (const m of t.matchAll(/\b(?:db\.)?session\.(query|add|add_all|delete|merge|get)\s*\(\s*([A-Z]\w*)?/g)) add(m.index!, m[2], m[1] === 'query' || m[1] === 'get' ? 'read' : 'write', `session.${m[1]}(${m[2] ?? '…'})`, 'sqlalchemy');
    for (const m of t.matchAll(/\b([A-Z]\w*)\.query\.(\w+)/g)) if (!NOT_MODEL.test(m[1])) add(m.index!, m[1], /delete|update/.test(m[2]) ? 'write' : 'read', `${m[1]}.query.${m[2]}`, 'sqlalchemy');
    for (const m of t.matchAll(/\b(?:select|insert|update|delete)\s*\(\s*([A-Z]\w*)\s*[,)]/g)) if (/sqlalchemy/.test(t) && !NOT_MODEL.test(m[1])) add(m.index!, m[1], m[0].startsWith('select') ? 'read' : 'write', `${m[0].split('(')[0].trim()}(${m[1]})`, 'sqlalchemy');
    for (const m of t.matchAll(/\bconnection\.cursor\s*\(/g)) add(m.index!, undefined, 'read', 'raw database cursor', 'sql');
  }

  if (lang === 'java' || lang === 'kotlin') {
    for (const m of t.matchAll(/\b(\w*(?:Repository|Repo|Dao|DAO))\s*\.\s*(\w+)\s*\(/g)) {
      if (/^[A-Z]/.test(m[1])) continue; // static/class reference, not a field
      const write = /^(save|delete|remove|insert|update|persist|merge|flush)/.test(m[2]);
      const read = /^(find|get|count|exists|read|query|search|list|fetch|stream)/.test(m[2]);
      if (!read && !write) continue;
      const cls = cap(m[1]);
      const repo = ctx.resolveClass(cls, u.path);
      let entity: string | undefined;
      if (repo) {
        const ru = ctx.unit(repo.file);
        entity = ru ? /\bextends\s+\w+Repository\s*<\s*(\w+)\s*,/.exec(ru.text)?.[1] : undefined;
      }
      add(m.index!, entity ?? cls.replace(/(Repository|Repo|Dao|DAO)$/, ''), write ? 'write' : 'read', `${m[1]}.${m[2]}()`, 'jpa');
    }
    for (const m of t.matchAll(/\b(?:entityManager|em)\s*\.\s*(find|persist|merge|remove|createQuery|createNativeQuery)\s*\(\s*(?:(\w+)\.class)?/g)) add(m.index!, m[2], /persist|merge|remove/.test(m[1]) ? 'write' : 'read', `entityManager.${m[1]}()`, 'jpa');
    for (const m of t.matchAll(/\bjdbcTemplate\s*\.\s*(query\w*|update|execute|batchUpdate)\s*\(/g)) {
      const line = ctx.lineAt(u, m.index!);
      if (!out.some((f) => f.file === u.path && f.line === line)) add(m.index!, undefined, m[1].startsWith('query') ? 'read' : 'write', `jdbcTemplate.${m[1]}()`, 'jdbc');
    }
  }

  if (lang === 'ruby') {
    for (const m of t.matchAll(/(?<![\w:.])([A-Z]\w*)\.(find_by|find_or_create_by|find_each|find|where|all|first|last|count|pluck|exists\?|create!?|update_all|destroy_all|delete_all|insert_all|upsert_all|joins|includes|order)\b/g)) {
      if (NOT_MODEL.test(m[1])) continue;
      add(m.index!, m[1], /create|update_all|destroy_all|delete_all|insert_all|upsert_all|find_or_create/.test(m[2]) ? 'write' : 'read', `${m[1]}.${m[2]}`, 'activerecord');
    }
    for (const m of t.matchAll(/(?<![\w:.])(@?\w+)\.(save!?|update!?|destroy!?|delete)\b(?!\s*=)/g)) {
      const mm = new RegExp(`${m[1].replace('@', '@?')}\\s*=\\s*([A-Z]\\w*)\\.(?:new|find|find_by|create|first|where)`).exec(t);
      if (mm && !NOT_MODEL.test(mm[1])) add(m.index!, mm[1], 'write', `${m[1]}.${m[2]} on a ${mm[1]}`, 'activerecord');
    }
  }

  if (lang === 'php') {
    for (const m of t.matchAll(/(?<![\w\\])([A-Z]\w*)::(find|findOrFail|where|all|first|get|count|with|paginate|query|create|insert|update|destroy|updateOrCreate|firstOrCreate|firstOrNew|truncate)\s*\(/g)) {
      if (NOT_MODEL.test(m[1]) || m[1] === 'DB') continue;
      add(m.index!, m[1], /create|insert|update|destroy|updateOrCreate|firstOrCreate|truncate/.test(m[2]) ? 'write' : 'read', `${m[1]}::${m[2]}()`, 'eloquent');
    }
    for (const m of t.matchAll(/\bDB::table\s*\(\s*(['"])(\w+)\1\s*\)([^;]*)/g)) add(m.index!, m[2], /->(insert|update|delete|truncate|increment|decrement)\s*\(/.test(m[3]) ? 'write' : 'read', `DB::table('${m[2]}')`, 'query-builder');
    for (const m of t.matchAll(/\b(mysqli_query|mysql_query|pg_query|sqlsrv_query)\s*\(|->(?:query|exec|prepare)\s*\(/g)) {
      const line = ctx.lineAt(u, m.index!);
      if (!out.some((f) => f.file === u.path && f.line === line && f.kind === 'db')) add(m.index!, undefined, 'read', `${m[1] ?? 'PDO/mysqli query'} database call`, 'sql');
    }
  }

  if (lang === 'csharp') {
    for (const m of t.matchAll(/\b_?(?:context|db|dbContext|ctx)\w*\.(\w+)\.(Where|Find|FindAsync|First\w*|Single\w*|ToList\w*|Any\w*|Count\w*|Include|AsNoTracking|Select|OrderBy\w*|Add|AddAsync|AddRange|Remove|RemoveRange|Update|UpdateRange|Attach)\b/gi)) {
      add(m.index!, singular(m[1]), /^(Add|Remove|Update|Attach)/.test(m[2]) ? 'write' : 'read', `DbSet ${m[1]}.${m[2]}`, 'efcore');
    }
    for (const m of t.matchAll(/\b\w+\.(Query|QueryAsync|QueryFirst\w*|QuerySingle\w*|Execute|ExecuteAsync|ExecuteScalar\w*)\s*[<(]/g)) {
      const line = ctx.lineAt(u, m.index!);
      if (!out.some((f) => f.file === u.path && f.line === line)) add(m.index!, undefined, m[1].startsWith('Query') ? 'read' : 'write', `Dapper/ADO ${m[1]}`, 'sql');
    }
  }

  if (lang === 'go') {
    for (const m of t.matchAll(/\b(?:db|tx|conn|pool|s\.db|r\.db|\w+\.DB|\w+DB)\.(Query|QueryRow|QueryContext|QueryRowContext|Exec|ExecContext|Get|Select|NamedExec|Find|First|Take|Create|Save|Delete|Updates?|Where|Preload|Model)\s*\(([^)\n]{0,80})/g)) {
      const line = ctx.lineAt(u, m.index!);
      if (out.some((f) => f.file === u.path && f.line === line && f.kind === 'db')) continue;
      const target = /&(?:\w+\.)?([A-Z]\w*)\{/.exec(m[2])?.[1];
      add(m.index!, target, /^(Exec|NamedExec|Create|Save|Delete|Update)/.test(m[1]) ? 'write' : 'read', `db.${m[1]}()`, 'sql');
    }
  }
}

export const facts: Detector = {
  id: 'facts',
  name: 'Cross-cutting facts',
  detect() {
    return null; // always analysed; not a framework
  },
  analyze(ctx) {
    const out: Fact[] = [];
    const entries: EntryPoint[] = [];
    const roles: RoleHint[] = [];
    for (const u of ctx.units) {
      if (!CODE_LANGS.has(u.lang) || ctx.m.file(u.path)?.test) continue;
      const lang = u.lang;
      for (const p of PATTERNS) {
        if (!p.langs.includes(lang) || !p.hint.some((h) => u.text.includes(h))) continue;
        p.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        let n = 0;
        while ((m = p.re.exec(u.text)) && n++ < 500) {
          if (m[0].length === 0) {
            p.re.lastIndex++;
            continue;
          }
          const line = ctx.lineAt(u, m.index);
          const target = p.target ? m[p.target] ?? m[p.target + 2] ?? m[p.target + 4] : undefined;
          if (p.kind === 'http-call' && lang !== 'php' && /^\s*(\/\/|#|\*)/.test(u.text.split('\n')[line - 1] ?? '')) continue;
          const f: Fact = { kind: p.kind, file: u.path, line, detail: `${p.detail}${target ? ` → ${target}` : ''}`, target: target || undefined, tech: p.tech, conf: 'heuristic', detector: 'facts' };
          out.push(f);
          if (p.kind === 'job') {
            const open = u.text.indexOf('(', m.index);
            const call = open >= 0 && open < m.index + m[0].length + 2 ? callArgs(u.text, open) : null;
            const def = lang === 'python' ? ctx.defAfter(u.path, line, 4) : -1;
            entries.push({
              id: `job:${u.path}:${line}`, kind: 'job', label: `${p.detail}${target ? ` (${target})` : def >= 0 ? ` ${ctx.a.symbols[def].name}` : ''}`, file: u.path,
              line: def >= 0 ? ctx.a.symbols[def].line : line, sym: def >= 0 ? def : undefined, endLine: def >= 0 ? undefined : call ? ctx.lineAt(u, call.end) : line, conf: 'heuristic',
            });
          } else if (p.kind === 'queue-sub') {
            const open = u.text.indexOf('(', m.index);
            const call = open >= 0 ? callArgs(u.text, open) : null;
            entries.push({ id: `event:${u.path}:${line}`, kind: 'event', label: `${p.detail}${target ? ` "${target}"` : ''}`, file: u.path, line, endLine: call ? ctx.lineAt(u, call.end) : line, conf: 'heuristic' });
          } else if (p.kind === 'cli') {
            const def = lang === 'python' && m[0].trim().startsWith('@') ? ctx.defAfter(u.path, line, 4) : ctx.m.symbolAt(ctx.m.fileIdx.get(u.path)!, line);
            entries.push({ id: `cli:${u.path}:${line}`, kind: 'cli', label: `${p.detail}${target ? ` "${target}"` : ''}`, file: u.path, line: def >= 0 ? ctx.a.symbols[def].line : line, sym: def >= 0 ? def : undefined, conf: 'heuristic' });
          }
        }
      }
      try {
        dbFacts(ctx, u, out);
      } catch {
        /* a pathological file must not break fact detection */
      }
    }
    // generic role hints from what a file does
    const perFile = new Map<string, Fact[]>();
    for (const f of out) {
      const arr = perFile.get(f.file);
      if (arr) arr.push(f);
      else perFile.set(f.file, [f]);
    }
    for (const [file, fs] of perFile) {
      const info = ctx.m.file(file);
      if (!info || info.role !== 'unknown') continue;
      if (fs.filter((f) => f.kind === 'db').length >= 2) roles.push({ file, role: 'repository', conf: 'heuristic' });
      else if (fs.some((f) => f.kind === 'http-call')) roles.push({ file, role: 'client', conf: 'heuristic' });
      else if (fs.some((f) => f.kind === 'queue-pub' || f.kind === 'queue-sub')) roles.push({ file, role: 'messaging', conf: 'heuristic' });
      else if (fs.some((f) => f.kind === 'job')) roles.push({ file, role: 'job', conf: 'heuristic' });
    }
    // de-duplicate (several patterns can hit the same call)
    const seen = new Set<string>();
    const uniq = out.filter((f) => {
      const k = `${f.kind}|${f.file}|${f.line}|${f.target ?? ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { facts: uniq, entries, roles };
  },
};
