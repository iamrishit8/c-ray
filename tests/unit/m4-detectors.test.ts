import { describe, expect, it } from 'vitest';
import { traceFlow } from '../../src/core/flow';
import type { Analysis, FileUnit } from '../../src/core/types';
import { analyzeFixture, analyzeMem, FIXTURE_NAMES, groundTruth } from '../helpers';

const routeKey = (a: Analysis) => a.routes.map((r) => `${r.method} ${r.path}`);
function lineHas(units: FileUnit[], file: string, line: number, needle: string): boolean {
  return (units.find((u) => u.path === file)?.text.split('\n')[line - 1] ?? '').includes(needle);
}
function refExists(a: Analysis, file: string, line: number): boolean {
  const f = a.files.find((x) => x.path === file);
  return !!f && line >= 1 && line <= Math.max(1, f.loc + 1);
}

describe('framework detectors on fixtures', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: frameworks, every planted route with handler and middleware`, async () => {
      const gt = groundTruth(name);
      const { analysis: a } = await analyzeFixture(name);
      const fw = a.frameworks.map((f) => f.id);
      for (const f of gt.frameworks) expect(fw, f).toContain(f);
      for (const f of a.frameworks) expect(f.evidence.length).toBeGreaterThan(0);
      for (const g of gt.routes) {
        const r = a.routes.find((x) => x.method === g.method && x.path === g.path);
        expect(r, `${g.method} ${g.path} in [${routeKey(a).join(', ')}]`).toBeTruthy();
        if (g.handlerFile) {
          expect(r!.hFile, `${g.method} ${g.path} handler file`).toBe(g.handlerFile);
          expect(r!.handlerSym, `${g.method} ${g.path} handler symbol`).toBeDefined();
          expect(a.symbols[r!.handlerSym!].name).toBe(g.handler);
        }
        if (g.file) expect(r!.file).toBe(g.file);
        for (const mw of g.middleware ?? []) expect(r!.middleware.map((x) => x.name), `${g.method} ${g.path} middleware`).toContain(mw);
        expect(refExists(a, r!.file, r!.line)).toBe(true);
        if (r!.hFile) expect(refExists(a, r!.hFile, r!.hLine!)).toBe(true);
      }
      // no invented HTTP routes beyond the ground truth (page/query-style routes excluded)
      const extra = a.routes.filter((r) => r.kind === 'http' && !r.path.includes('?') && !gt.routes.some((g: any) => g.method === r.method && g.path === r.path));
      expect(extra.map((r) => `${r.method} ${r.path}`)).toEqual([]);
      for (const e of gt.entryFiles) expect(a.entries.map((x) => x.file), e).toContain(e);
    });

    it(`${name}: facts (external calls, queues, jobs) and flows cite real file:line`, async () => {
      const gt = groundTruth(name);
      const { analysis: a, units } = await analyzeFixture(name);
      for (const c of gt.externalCalls ?? []) {
        expect(a.facts.some((f) => f.kind === 'http-call' && f.file === c.file && lineHas(units, f.file, f.line, c.contains)), `http-call ${c.file}`).toBe(true);
      }
      for (const q of gt.queues ?? []) {
        expect(a.facts.some((f) => f.kind === q.kind && f.file === q.file && f.target === q.target), `${q.kind} ${q.target}`).toBe(true);
      }
      for (const j of gt.jobs ?? []) expect(a.entries.some((e) => e.kind === 'job' && e.file === j.file), `job ${j.file}`).toBe(true);
      for (const c of gt.components ?? []) expect(a.facts.some((f) => f.kind === 'component' && f.target === c), `component ${c}`).toBe(true);
      for (const f of a.facts) expect(refExists(a, f.file, f.line), `${f.kind} ${f.file}:${f.line}`).toBe(true);
      for (const g of gt.flows ?? []) {
        const [method, ...rest] = g.route.split(' ');
        const route = a.routes.find((r) => r.method === method && r.path === rest.join(' '));
        expect(route, g.route).toBeTruthy();
        const flow = traceFlow(a, route!.id)!;
        expect(flow.steps.length).toBeGreaterThan(1);
        for (const v of g.visits) expect(flow.files, `${g.route} should visit ${v}`).toContain(v);
      }
      // every step of every flow points at an existing file:line
      for (const e of a.entries) {
        const flow = traceFlow(a, e.id)!;
        expect(flow).toBeTruthy();
        for (const s of flow.steps) {
          expect(refExists(a, s.file, s.line), `${e.label}: step "${s.label}" → ${s.file}:${s.line}`).toBe(true);
          if (s.via) expect(refExists(a, s.via.file, s.via.line)).toBe(true);
        }
      }
    });
  }

  it('express flow is ordered: middleware → handler → service → data access → external call', async () => {
    const { analysis: a } = await analyzeFixture('express-mongoose');
    const route = a.routes.find((r) => r.method === 'POST' && r.path === '/api/orders')!;
    const flow = traceFlow(a, route.id)!;
    const kinds = flow.steps.map((s) => `${s.kind}:${s.label.split(' ')[0]}`);
    const idx = (prefix: string) => kinds.findIndex((k) => k.startsWith(prefix));
    expect(idx('middleware:logger')).toBeGreaterThan(0);
    expect(idx('middleware:auth')).toBeGreaterThan(idx('middleware:logger'));
    expect(idx('handler:create')).toBeGreaterThan(idx('middleware:auth'));
    expect(idx('call:placeOrder')).toBeGreaterThan(idx('handler:create'));
    expect(flow.steps.some((s) => s.kind === 'db' && s.label.includes('Order'))).toBe(true);
    expect(flow.steps.some((s) => s.kind === 'http')).toBe(true);
    expect(flow.steps.find((s) => s.label === 'placeOrder')!.conf).toBe('resolved');
  });

  it('roles come from detectors where declared, generic naming otherwise', async () => {
    const { analysis: a } = await analyzeFixture('spring-boot');
    const role = (suffix: string) => a.files.find((f) => f.path.endsWith(suffix))!;
    expect(role('OrderController.java').role).toBe('controller');
    expect(role('OrderController.java').roleSource).toBe('spring-boot');
    expect(role('OrderService.java').role).toBe('service');
    expect(role('OrderRepository.java').role).toBe('repository');
    expect(role('Order.java').role).toBe('model');
    const { analysis: p } = await analyzeFixture('legacy-php');
    expect(p.files.find((f) => f.path === 'includes/functions.php')!.roleSource).toBe('generic');
    expect(p.files.find((f) => f.path === 'includes/functions.php')!.roleConf).toBe('heuristic');
  });
});

describe('framework detectors on mini-projects', () => {
  it('Next.js: pages router, app router, API routes', async () => {
    const { analysis: a } = await analyzeMem({
      'package.json': '{"dependencies":{"next":"14.0.0","react":"18.0.0"}}',
      'pages/index.tsx': 'export default function Home() { return <main>hi</main>; }\n',
      'pages/posts/[id].tsx': 'export default function Post() { return <article/>; }\n',
      'pages/api/users/[id].ts': 'export default async function handler(req, res) { res.json({}); }\n',
      'app/dashboard/page.tsx': 'export default function Page() { return <div/>; }\n',
      'app/(shop)/cart/page.tsx': 'export default function Cart() { return <div/>; }\n',
      'app/api/orders/route.ts': 'export async function GET() { return Response.json([]); }\nexport async function POST(req: Request) { return Response.json({}); }\n',
      'middleware.ts': 'export function middleware() {}\n',
    });
    expect(a.frameworks.map((f) => f.id)).toContain('nextjs');
    const keys = a.routes.map((r) => `${r.kind} ${r.method} ${r.path}`);
    for (const k of ['page GET /', 'page GET /posts/:id', 'http ANY /api/users/:id', 'page GET /dashboard', 'page GET /cart', 'http GET /api/orders', 'http POST /api/orders']) expect(keys, k).toContain(k);
    expect(a.files.find((f) => f.path === 'middleware.ts')!.role).toBe('middleware');
  });

  it('Flask and FastAPI: decorators, blueprints/routers with prefixes, dependencies', async () => {
    const { analysis: a } = await analyzeMem({
      'requirements.txt': 'flask\nfastapi\n',
      'web/app.py': "from flask import Flask\nfrom web.users import bp\napp = Flask(__name__)\napp.register_blueprint(bp, url_prefix='/api/users')\n\n@app.route('/health')\ndef health():\n    return 'ok'\n",
      'web/users.py': "from flask import Blueprint\nbp = Blueprint('users', __name__)\n\n@bp.route('/<int:user_id>', methods=['GET', 'DELETE'])\ndef user(user_id):\n    return {}\n",
      'svc/main.py': "from fastapi import FastAPI\nfrom svc.routers import items\napp = FastAPI()\napp.include_router(items.router, prefix='/v1')\n\n@app.get('/ping')\ndef ping():\n    return 'pong'\n",
      'svc/routers/items.py': "from fastapi import APIRouter, Depends\nfrom svc.auth import current_user\nrouter = APIRouter(prefix='/items')\n\n@router.post('/')\ndef create_item(user=Depends(current_user)):\n    return {}\n\n@router.get('/{item_id}')\ndef get_item(item_id: int):\n    return {}\n",
      'svc/auth.py': 'def current_user():\n    return None\n',
    });
    const keys = a.routes.map((r) => `${r.framework} ${r.method} ${r.path}`);
    for (const k of ['flask GET /health', 'flask GET /api/users/<int:user_id>', 'flask DELETE /api/users/<int:user_id>', 'fastapi GET /ping', 'fastapi POST /v1/items/', 'fastapi GET /v1/items/{item_id}']) expect(keys, k).toContain(k);
    const create = a.routes.find((r) => r.path === '/v1/items/')!;
    expect(a.symbols[create.handlerSym!].name).toBe('create_item');
    expect(create.middleware.map((m) => m.name)).toEqual(['current_user']);
    expect(create.middleware[0].file).toBe('svc/auth.py');
    expect(create.params).toEqual([]);
    expect(a.routes.find((r) => r.path === '/v1/items/{item_id}')!.params).toEqual(['item_id']);
  });

  it('Laravel: verbs, controller actions, resources, groups with prefix + middleware', async () => {
    const { analysis: a } = await analyzeMem({
      'composer.json': '{"require":{"laravel/framework":"^11.0"}}',
      'routes/api.php': "<?php\nuse App\\Http\\Controllers\\PostController;\nRoute::get('/ping', function () { return 'pong'; });\nRoute::middleware(['auth:sanctum'])->prefix('admin')->group(function () {\n    Route::get('/posts', [PostController::class, 'index']);\n    Route::post('/posts', 'PostController@store')->middleware('throttle');\n});\nRoute::apiResource('tags', TagController::class);\n",
      'app/Http/Controllers/PostController.php': "<?php\nnamespace App\\Http\\Controllers;\nuse App\\Models\\Post;\nclass PostController extends Controller {\n    public function index() { return Post::all(); }\n    public function store() { return Post::create([]); }\n}\n",
      'app/Models/Post.php': "<?php\nnamespace App\\Models;\nuse Illuminate\\Database\\Eloquent\\Model;\nclass Post extends Model {}\n",
    });
    const keys = a.routes.map((r) => `${r.method} ${r.path}`);
    for (const k of ['GET /api/ping', 'GET /api/admin/posts', 'POST /api/admin/posts', 'GET /api/tags', 'POST /api/tags', 'GET /api/tags/{id}', 'PUT /api/tags/{id}', 'DELETE /api/tags/{id}']) expect(keys, k).toContain(k);
    expect(keys).not.toContain('GET /api/tags/create');
    const idx = a.routes.find((r) => r.path === '/api/admin/posts' && r.method === 'GET')!;
    expect(idx.hFile).toBe('app/Http/Controllers/PostController.php');
    expect(a.symbols[idx.handlerSym!].name).toBe('index');
    expect(idx.middleware.map((m) => m.name)).toEqual(['auth:sanctum']);
    expect(a.routes.find((r) => r.path === '/api/admin/posts' && r.method === 'POST')!.middleware.map((m) => m.name)).toEqual(['auth:sanctum', 'throttle']);
    expect(a.files.find((f) => f.path === 'app/Models/Post.php')!.role).toBe('model');
    expect(a.facts.some((f) => f.kind === 'db' && f.target === 'Post' && f.op === 'write')).toBe(true);
  });

  it('Rails: verbs, resources (only/nested), namespaces, before_action', async () => {
    const { analysis: a } = await analyzeMem({
      'Gemfile': "gem 'rails'\n",
      'config/routes.rb': "Rails.application.routes.draw do\n  root 'home#index'\n  get '/about', to: 'home#about'\n  resources :posts, only: [:index, :show] do\n    resources :comments, only: [:create]\n  end\n  namespace :admin do\n    resources :users\n  end\nend\n",
      'app/controllers/home_controller.rb': "class HomeController < ApplicationController\n  def index\n  end\n  def about\n  end\nend\n",
      'app/controllers/posts_controller.rb': "class PostsController < ApplicationController\n  before_action :authenticate, only: [:show]\n  def index\n    Post.all\n  end\n  def show\n    Post.find(params[:id])\n  end\n  private\n  def authenticate\n  end\nend\n",
      'app/models/post.rb': 'class Post < ApplicationRecord\nend\n',
    });
    const keys = a.routes.map((r) => `${r.method} ${r.path}`);
    for (const k of ['GET /', 'GET /about', 'GET /posts', 'GET /posts/:id', 'POST /posts/:post_id/comments', 'GET /admin/users', 'DELETE /admin/users/:id']) expect(keys, k).toContain(k);
    expect(keys).not.toContain('POST /posts');
    const show = a.routes.find((r) => r.path === '/posts/:id')!;
    expect(show.hFile).toBe('app/controllers/posts_controller.rb');
    expect(show.middleware.map((m) => m.name)).toEqual(['authenticate']);
    expect(a.routes.find((r) => r.path === '/posts' && r.method === 'GET')!.middleware).toEqual([]);
    expect(a.facts.some((f) => f.kind === 'db' && f.target === 'Post' && f.op === 'read')).toBe(true);
  });

  it('Go: net/http patterns and Gin groups with middleware', async () => {
    const { analysis: a } = await analyzeMem({
      'go.mod': 'module example.com/api\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
      'main.go': 'package main\n\nimport (\n\t"net/http"\n\t"github.com/gin-gonic/gin"\n)\n\nfunc main() {\n\tr := gin.Default()\n\tv1 := r.Group("/v1")\n\tv1.Use(AuthRequired)\n\tv1.GET("/users/:id", GetUser)\n\tv1.POST("/users", CreateUser)\n\tr.GET("/health", func(c *gin.Context) { c.String(200, "ok") })\n\tr.Run(":8080")\n}\n\nfunc legacy() {\n\tmux := http.NewServeMux()\n\tmux.HandleFunc("GET /old/{id}", OldHandler)\n\tmux.HandleFunc("/any", OldHandler)\n}\n',
      'handlers.go': 'package main\n\nimport "github.com/gin-gonic/gin"\n\nfunc GetUser(c *gin.Context) {}\nfunc CreateUser(c *gin.Context) {}\nfunc AuthRequired(c *gin.Context) {}\nfunc OldHandler() {}\n',
    });
    const keys = a.routes.map((r) => `${r.method} ${r.path}`);
    for (const k of ['GET /v1/users/:id', 'POST /v1/users', 'GET /health', 'GET /old/{id}', 'ANY /any']) expect(keys, k).toContain(k);
    const get = a.routes.find((r) => r.path === '/v1/users/:id')!;
    expect(get.hFile).toBe('handlers.go');
    expect(get.middleware.map((m) => m.name)).toEqual(['AuthRequired']);
    expect(a.routes.find((r) => r.path === '/health')!.handler).toBe('(inline)');
  });

  it('ASP.NET: attribute-routed controllers and minimal APIs', async () => {
    const { analysis: a } = await analyzeMem({
      'Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
      'Api/Controllers/OrdersController.cs': 'using Microsoft.AspNetCore.Mvc;\nnamespace Api.Controllers {\n  [ApiController]\n  [Route("api/[controller]")]\n  [Authorize]\n  public class OrdersController : ControllerBase {\n    [HttpGet]\n    public IActionResult List() { return Ok(); }\n\n    [HttpGet("{id}")]\n    public IActionResult Get(int id) { return Ok(); }\n\n    [HttpPost]\n    public IActionResult Create() { return Ok(); }\n  }\n}\n',
      'Api/Program.cs': 'var builder = WebApplication.CreateBuilder(args);\nbuilder.Services.AddScoped<IOrderService, OrderService>();\nvar app = builder.Build();\napp.UseAuthentication();\nvar api = app.MapGroup("/v2");\napi.MapGet("/ping", () => "pong");\napp.MapPost("/echo", (string body) => body).RequireAuthorization();\napp.Run();\n',
    });
    const keys = a.routes.map((r) => `${r.method} ${r.path}`);
    for (const k of ['GET /api/orders', 'GET /api/orders/{id}', 'POST /api/orders', 'GET /v2/ping', 'POST /echo']) expect(keys, k).toContain(k);
    const get = a.routes.find((r) => r.path === '/api/orders/{id}')!;
    expect(a.symbols[get.handlerSym!].name).toBe('Get');
    expect(get.middleware.map((m) => m.name)).toContain('[Authorize]');
    expect(a.facts.some((f) => f.kind === 'di' && f.target === 'OrderService')).toBe(true);
    expect(a.facts.some((f) => f.kind === 'middleware' && f.target === 'UseAuthentication')).toBe(true);
  });

  it('records string-built routes and DI/reflection as unresolved instead of guessing', async () => {
    const { analysis: a } = await analyzeMem({
      'package.json': '{"dependencies":{"express":"4"}}',
      'app.js': "const express = require('express');\nconst app = express();\nconst base = '/v' + process.env.V;\napp.get(`${base}/users`, (req, res) => res.end());\napp.get(base + '/x', (req, res) => res.end());\nconst mod = require(process.env.PLUGIN);\nconst svc = container.resolve('userService');\nhandlers[req.action](req);\n",
      'b.js': 'module.exports = 1;\n',
    });
    const kinds = a.unresolved.map((u) => `${u.kind}:${u.line}`);
    expect(kinds).toContain('dynamic-route:4');
    expect(kinds).toContain('dynamic-import:6');
    expect(kinds).toContain('di:7');
    expect(kinds).toContain('dynamic-call:8');
    expect(a.routes).toHaveLength(0);
  });

  it('message queue and job facts across ecosystems', async () => {
    const { analysis: a } = await analyzeMem({
      'package.json': '{"dependencies":{"mqtt":"5","kafkajs":"2","bullmq":"5","amqplib":"0.10"}}',
      'bus.js': "const client = mqtt.connect('mqtt://x');\nclient.subscribe('sensors/temp');\nclient.publish('alerts/high', 'x');\nawait producer.send({ topic: 'orders', messages: [] });\nawait consumer.subscribe({ topic: 'payments' });\nchannel.sendToQueue('emails', buf);\nchannel.consume('emails', onMsg);\nawait emailQueue.add('welcome', {});\n",
      'tasks.py': "from celery import shared_task\n\n@shared_task\ndef send_report():\n    pass\n\ndef kick():\n    send_report.delay()\n",
      'x.py': 'pass\n',
    });
    const has = (kind: string, target: string) => a.facts.some((f) => f.kind === kind && f.target === target);
    expect(has('queue-sub', 'sensors/temp')).toBe(true);
    expect(has('queue-pub', 'alerts/high')).toBe(true);
    expect(has('queue-pub', 'orders')).toBe(true);
    expect(has('queue-sub', 'payments')).toBe(true);
    expect(has('queue-pub', 'emails')).toBe(true);
    expect(has('queue-sub', 'emails')).toBe(true);
    expect(has('queue-pub', 'welcome')).toBe(true);
    expect(has('queue-pub', 'send_report')).toBe(true);
    expect(a.entries.some((e) => e.kind === 'job' && e.file === 'tasks.py' && a.symbols[e.sym!]?.name === 'send_report')).toBe(true);
  });
});
