// Minimal ambient shims so the fixture type-checks without installing dependencies.
declare module 'fastify' {
  export interface FastifyRequest { params: any; body: any; headers: Record<string, string | undefined>; }
  export interface FastifyReply { code(status: number): FastifyReply; send(payload?: unknown): FastifyReply; }
  export interface FastifyInstance {
    get(path: string, ...handlers: any[]): void;
    post(path: string, ...handlers: any[]): void;
    put(path: string, ...handlers: any[]): void;
    delete(path: string, ...handlers: any[]): void;
    register(plugin: (app: FastifyInstance) => Promise<void>, opts?: { prefix?: string }): void;
    addHook(name: string, handler: (...args: any[]) => any): void;
    listen(opts: { port: number }): Promise<string>;
  }
  export default function fastify(opts?: unknown): FastifyInstance;
}
declare module 'typeorm' {
  export const Entity: any;
  export const PrimaryGeneratedColumn: any;
  export const Column: any;
  export const ManyToOne: any;
  export const OneToMany: any;
  export const Index: any;
  export class Repository<T> {
    find(opts?: unknown): Promise<T[]>;
    findOneBy(where: unknown): Promise<T | null>;
    save(entity: Partial<T>): Promise<T>;
    count(opts?: unknown): Promise<number>;
  }
  export class DataSource {
    constructor(opts: unknown);
    initialize(): Promise<DataSource>;
    getRepository<T>(entity: new () => T): Repository<T>;
    query(sql: string): Promise<any[]>;
  }
}
declare module 'ioredis' {
  export default class Redis {
    constructor(url?: string);
    publish(channel: string, message: string): Promise<number>;
    subscribe(channel: string): Promise<void>;
    on(event: string, handler: (...args: any[]) => void): void;
  }
}
declare module 'react' {
  export function useState<T>(initial: T): [T, (value: T) => void];
  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
}
declare module 'react-dom/client' {
  export function createRoot(el: unknown): { render(node: unknown): void };
}
declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}
declare namespace JSX {
  interface IntrinsicElements { [name: string]: any; }
  interface Element {}
}
declare const process: { env: Record<string, string | undefined> };
declare const document: { getElementById(id: string): unknown };
declare function fetch(url: string, init?: unknown): Promise<{ json(): Promise<any>; ok: boolean }>;
