// Knowledge table: dependency name -> technology. Used by L0 stack detection
// and (with the trade-off notes) by the Decisions view.
import type { TechHit } from '../types';

export interface TechDef {
  id: string;
  name: string;
  category: TechHit['category'];
  /** Exact dependency names, or regexes, in any ecosystem. */
  match: (string | RegExp)[];
  /** Plausible trade-offs of choosing this technology (generic knowledge, not project facts). */
  tradeoffs?: string[];
}

export const TECH: TechDef[] = [
  // --- backend frameworks ---
  { id: 'express', name: 'Express', category: 'framework', match: ['express'], tradeoffs: ['Minimal and unopinionated: fast to start, but structure (layers, validation, DI) is left to the team.', 'Huge middleware ecosystem; callback-style middleware makes async error handling easy to get wrong.'] },
  { id: 'nestjs', name: 'NestJS', category: 'framework', match: ['@nestjs/core', '@nestjs/common'], tradeoffs: ['Opinionated modules/controllers/providers give consistent structure at the cost of boilerplate and decorator magic.', 'Dependency injection eases testing but hides wiring at runtime (harder to trace statically).'] },
  { id: 'nextjs', name: 'Next.js', category: 'framework', match: ['next'], tradeoffs: ['File-system routing and SSR/SSG out of the box; couples the app to Next conventions and hosting model.', 'Server and client code live together: convenient, but boundaries need discipline.'] },
  { id: 'fastify', name: 'Fastify', category: 'framework', match: ['fastify'], tradeoffs: ['Schema-first and faster than Express; plugin encapsulation has a learning curve.', 'Smaller ecosystem than Express.'] },
  { id: 'koa', name: 'Koa', category: 'framework', match: ['koa'] },
  { id: 'hapi', name: 'hapi', category: 'framework', match: ['@hapi/hapi', 'hapi'] },
  { id: 'django', name: 'Django', category: 'framework', match: [/^django$/i], tradeoffs: ['Batteries included (ORM, admin, auth, migrations): very productive, but the ORM and app layout shape the whole design.', 'Synchronous by default; heavy for small services.'] },
  { id: 'drf', name: 'Django REST Framework', category: 'api', match: [/^djangorestframework$/i] },
  { id: 'flask', name: 'Flask', category: 'framework', match: [/^flask$/i], tradeoffs: ['Micro-framework: flexible and small, but project structure and extensions are your responsibility.', 'Global request context is convenient yet makes testing and async harder.'] },
  { id: 'fastapi', name: 'FastAPI', category: 'framework', match: [/^fastapi$/i], tradeoffs: ['Type-hint driven validation and OpenAPI docs for free; relies on Pydantic and async discipline.', 'Younger ecosystem than Django for admin/ORM needs.'] },
  { id: 'spring-boot', name: 'Spring Boot', category: 'framework', match: [/^spring-boot/, /org\.springframework\.boot/], tradeoffs: ['Convention-over-configuration with a vast ecosystem; annotation-driven wiring is powerful but opaque.', 'Higher memory/startup footprint than lighter frameworks.'] },
  { id: 'laravel', name: 'Laravel', category: 'framework', match: ['laravel/framework'], tradeoffs: ['Expressive full-stack framework with Eloquent ORM; facades and magic methods hinder static analysis.', 'Tightly couples the app to Laravel conventions.'] },
  { id: 'symfony', name: 'Symfony', category: 'framework', match: [/^symfony\/framework-bundle$/] },
  { id: 'rails', name: 'Ruby on Rails', category: 'framework', match: ['rails'], tradeoffs: ['Convention over configuration: very fast feature delivery; implicit autoloading and metaprogramming obscure the call graph.', 'ActiveRecord couples domain objects to the database schema.'] },
  { id: 'sinatra', name: 'Sinatra', category: 'framework', match: ['sinatra'] },
  { id: 'gin', name: 'Gin', category: 'framework', match: ['github.com/gin-gonic/gin'], tradeoffs: ['Fast router with middleware; thin by design, so layering is up to the team.'] },
  { id: 'echo', name: 'Echo', category: 'framework', match: [/^github\.com\/labstack\/echo/] },
  { id: 'chi', name: 'chi', category: 'framework', match: [/^github\.com\/go-chi\/chi/] },
  { id: 'gorilla-mux', name: 'gorilla/mux', category: 'framework', match: ['github.com/gorilla/mux'] },
  { id: 'aspnet', name: 'ASP.NET Core', category: 'framework', match: [/^Microsoft\.AspNetCore/, 'Microsoft.NET.Sdk.Web'], tradeoffs: ['Integrated DI, middleware pipeline and tooling; strongly tied to the .NET ecosystem.', 'Attribute routing and DI resolve at runtime, which hides flow from static tools.'] },
  { id: 'actix', name: 'Actix Web', category: 'framework', match: ['actix-web'] },
  { id: 'axum', name: 'Axum', category: 'framework', match: ['axum'] },
  { id: 'rocket', name: 'Rocket', category: 'framework', match: ['rocket'] },
  { id: 'ktor', name: 'Ktor', category: 'framework', match: [/^io\.ktor/, /ktor-server/] },
  // --- frontend ---
  { id: 'react', name: 'React', category: 'ui', match: ['react'], tradeoffs: ['Component model with a huge ecosystem; routing, data fetching and state are separate choices.', 'Client-side rendering by default unless paired with a meta-framework.'] },
  { id: 'vue', name: 'Vue', category: 'ui', match: ['vue'] },
  { id: 'angular', name: 'Angular', category: 'ui', match: ['@angular/core'] },
  { id: 'svelte', name: 'Svelte', category: 'ui', match: ['svelte'] },
  { id: 'tailwind', name: 'Tailwind CSS', category: 'ui', match: ['tailwindcss'] },
  { id: 'mui', name: 'Material UI', category: 'ui', match: ['@mui/material'] },
  { id: 'redux', name: 'Redux', category: 'state', match: ['redux', '@reduxjs/toolkit'], tradeoffs: ['Predictable single store and great tooling; more ceremony than local state or lighter stores.'] },
  { id: 'zustand', name: 'Zustand', category: 'state', match: ['zustand'] },
  { id: 'mobx', name: 'MobX', category: 'state', match: ['mobx'] },
  // --- ORMs / data ---
  { id: 'mongoose', name: 'Mongoose', category: 'orm', match: ['mongoose'], tradeoffs: ['Schemas and validation on top of MongoDB; relations are by reference (no joins), so consistency is enforced in code.'] },
  { id: 'prisma', name: 'Prisma', category: 'orm', match: ['@prisma/client', 'prisma'], tradeoffs: ['Single schema file and a type-safe generated client; generated code and a query engine binary add build steps.', 'Less control over complex SQL than a query builder.'] },
  { id: 'typeorm', name: 'TypeORM', category: 'orm', match: ['typeorm'], tradeoffs: ['Decorator-based entities, familiar to Java/C# developers; runtime metadata and lazy relations can surprise.'] },
  { id: 'sequelize', name: 'Sequelize', category: 'orm', match: ['sequelize'] },
  { id: 'drizzle', name: 'Drizzle ORM', category: 'orm', match: ['drizzle-orm'] },
  { id: 'knex', name: 'Knex', category: 'orm', match: ['knex'] },
  { id: 'sqlalchemy', name: 'SQLAlchemy', category: 'orm', match: [/^sqlalchemy$/i, /^flask-sqlalchemy$/i], tradeoffs: ['Powerful, explicit ORM and SQL toolkit; session management has a learning curve.'] },
  { id: 'jpa', name: 'JPA / Hibernate', category: 'orm', match: ['spring-boot-starter-data-jpa', /hibernate-core/, 'jakarta.persistence-api'], tradeoffs: ['Repository interfaces remove boilerplate; lazy loading and generated queries can hide N+1 problems.'] },
  { id: 'gorm', name: 'GORM', category: 'orm', match: [/^gorm\.io\/gorm/] },
  { id: 'efcore', name: 'Entity Framework Core', category: 'orm', match: [/^Microsoft\.EntityFrameworkCore/] },
  { id: 'doctrine', name: 'Doctrine ORM', category: 'orm', match: ['doctrine/orm'] },
  { id: 'activerecord', name: 'ActiveRecord', category: 'orm', match: ['activerecord'] },
  { id: 'postgres', name: 'PostgreSQL', category: 'database', match: ['pg', /^psycopg2?(-binary)?$/i, 'postgresql', 'org.postgresql', 'github.com/lib/pq', /^github\.com\/jackc\/pgx/, 'Npgsql', 'asyncpg', 'postgres'], tradeoffs: ['Relational integrity and rich SQL; needs schema migrations and operational care.'] },
  { id: 'mysql', name: 'MySQL', category: 'database', match: ['mysql', 'mysql2', /^pymysql$/i, 'mysqlclient', 'mysql-connector-java', 'github.com/go-sql-driver/mysql', 'mysql-connector-j'] },
  { id: 'sqlite', name: 'SQLite', category: 'database', match: ['sqlite3', 'better-sqlite3', 'github.com/mattn/go-sqlite3', 'rusqlite'] },
  { id: 'mongodb', name: 'MongoDB', category: 'database', match: ['mongodb', 'mongoose', /^pymongo$/i, 'spring-boot-starter-data-mongodb', 'go.mongodb.org/mongo-driver'], tradeoffs: ['Flexible documents and easy horizontal scaling; no joins or multi-document integrity by default.'] },
  { id: 'redis', name: 'Redis', category: 'cache', match: ['redis', 'ioredis', /^github\.com\/(go-redis|redis)\/(redis|go-redis)/, 'spring-boot-starter-data-redis', 'StackExchange.Redis', 'predis/predis'], tradeoffs: ['Very fast cache / pub-sub; data is memory-bound and durability is configurable, not default.'] },
  { id: 'elasticsearch', name: 'Elasticsearch', category: 'database', match: ['@elastic/elasticsearch', 'elasticsearch'] },
  // --- messaging / jobs ---
  { id: 'kafka', name: 'Kafka', category: 'queue', match: ['kafkajs', 'spring-kafka', 'confluent-kafka', 'kafka-python', 'github.com/segmentio/kafka-go', 'Confluent.Kafka', 'node-rdkafka'], tradeoffs: ['Durable, replayable event log that decouples services; operational complexity and eventual consistency.'] },
  { id: 'rabbitmq', name: 'RabbitMQ', category: 'queue', match: ['amqplib', 'pika', 'spring-boot-starter-amqp', 'RabbitMQ.Client', 'bunny', 'github.com/streadway/amqp', 'github.com/rabbitmq/amqp091-go'], tradeoffs: ['Flexible routing and acknowledgements; a broker to operate and reason about delivery semantics.'] },
  { id: 'mqtt', name: 'MQTT', category: 'queue', match: ['mqtt', 'paho-mqtt', 'github.com/eclipse/paho.mqtt.golang', 'MQTTnet'] },
  { id: 'bull', name: 'Bull / BullMQ', category: 'queue', match: ['bull', 'bullmq'] },
  { id: 'celery', name: 'Celery', category: 'queue', match: [/^celery$/i], tradeoffs: ['Mature background job runner; needs a broker and workers, and task failures are out-of-band.'] },
  { id: 'sidekiq', name: 'Sidekiq', category: 'queue', match: ['sidekiq'] },
  { id: 'cron', name: 'Scheduled jobs (cron)', category: 'queue', match: ['node-cron', 'cron', 'node-schedule', 'apscheduler', 'whenever'] },
  // --- API styles ---
  { id: 'graphql', name: 'GraphQL', category: 'api', match: ['graphql', '@apollo/server', 'apollo-server', 'graphene', 'strawberry-graphql', '@nestjs/graphql'], tradeoffs: ['Clients fetch exactly what they need; caching, authorization and N+1 queries need deliberate design.'] },
  { id: 'grpc', name: 'gRPC', category: 'api', match: ['@grpc/grpc-js', 'grpcio', 'google.golang.org/grpc', 'Grpc.AspNetCore', 'tonic'] },
  { id: 'trpc', name: 'tRPC', category: 'api', match: ['@trpc/server'] },
  { id: 'openapi', name: 'OpenAPI / Swagger', category: 'api', match: ['swagger-ui-express', '@nestjs/swagger', 'drf-spectacular', 'springdoc-openapi-starter-webmvc-ui', 'Swashbuckle.AspNetCore'] },
  // --- auth ---
  { id: 'jwt', name: 'JWT auth', category: 'auth', match: ['jsonwebtoken', /^pyjwt$/i, 'jjwt', 'io.jsonwebtoken', 'firebase/php-jwt', 'jwt', '@nestjs/jwt', 'github.com/golang-jwt/jwt'], tradeoffs: ['Stateless tokens scale horizontally; revocation and key rotation need extra machinery.'] },
  { id: 'passport', name: 'Passport', category: 'auth', match: ['passport'] },
  { id: 'spring-security', name: 'Spring Security', category: 'auth', match: ['spring-boot-starter-security'] },
  { id: 'devise', name: 'Devise', category: 'auth', match: ['devise'] },
  { id: 'next-auth', name: 'NextAuth', category: 'auth', match: ['next-auth'] },
  // --- http clients ---
  { id: 'axios', name: 'axios', category: 'http', match: ['axios'] },
  { id: 'requests', name: 'requests', category: 'http', match: [/^requests$/i, /^httpx$/i] },
  // --- testing ---
  { id: 'jest', name: 'Jest', category: 'testing', match: ['jest'] },
  { id: 'vitest', name: 'Vitest', category: 'testing', match: ['vitest'] },
  { id: 'mocha', name: 'Mocha', category: 'testing', match: ['mocha'] },
  { id: 'pytest', name: 'pytest', category: 'testing', match: [/^pytest$/i] },
  { id: 'junit', name: 'JUnit', category: 'testing', match: [/junit/, 'spring-boot-starter-test'] },
  { id: 'rspec', name: 'RSpec', category: 'testing', match: ['rspec', 'rspec-rails'] },
  { id: 'phpunit', name: 'PHPUnit', category: 'testing', match: ['phpunit/phpunit'] },
  { id: 'playwright', name: 'Playwright', category: 'testing', match: ['@playwright/test', 'playwright'] },
  { id: 'cypress', name: 'Cypress', category: 'testing', match: ['cypress'] },
  // --- build / language ---
  { id: 'typescript', name: 'TypeScript', category: 'language', match: ['typescript'], tradeoffs: ['Static types catch contract drift early and document intent; adds a build step and type maintenance.'] },
  { id: 'vite', name: 'Vite', category: 'build', match: ['vite'] },
  { id: 'webpack', name: 'webpack', category: 'build', match: ['webpack'] },
  { id: 'turbo', name: 'Turborepo', category: 'build', match: ['turbo'] },
  { id: 'nx', name: 'Nx', category: 'build', match: ['nx'] },
  { id: 'lerna', name: 'Lerna', category: 'build', match: ['lerna'] },
];

const exact = new Map<string, TechDef[]>();
const regexes: [RegExp, TechDef][] = [];
for (const t of TECH) {
  for (const m of t.match) {
    if (typeof m === 'string') {
      const arr = exact.get(m) ?? [];
      arr.push(t);
      exact.set(m, arr);
    } else regexes.push([m, t]);
  }
}

export function techForDep(dep: string): TechDef[] {
  const out = [...(exact.get(dep) ?? [])];
  for (const [re, t] of regexes) if (re.test(dep) && !out.includes(t)) out.push(t);
  return out;
}

export function techById(id: string): TechDef | undefined {
  return TECH.find((t) => t.id === id);
}
