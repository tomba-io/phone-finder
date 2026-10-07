// Shared test harness for the Tomba Apify Actors.
// Keep this file identical across all Actors.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MockRequest {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: IncomingMessage['headers'];
    body: unknown;
}

export interface MockResponse {
    status?: number;
    body?: unknown;
    /** Raw (non-JSON) body. */
    raw?: string;
    headers?: Record<string, string>;
}

export type MockHandler = (req: MockRequest) => MockResponse | Promise<MockResponse>;

export interface MockServer {
    url: string;
    requests: MockRequest[];
    close: () => Promise<void>;
}

/** Start a local HTTP server that impersonates the Tomba API. */
export async function startMockTomba(handler: MockHandler): Promise<MockServer> {
    const requests: MockRequest[] = [];
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const text = Buffer.concat(chunks).toString();
            let body: unknown = text;
            try {
                body = text ? JSON.parse(text) : undefined;
            } catch {
                // keep raw text
            }
            const request: MockRequest = {
                method: req.method ?? 'GET',
                path: url.pathname,
                query: Object.fromEntries(url.searchParams),
                headers: req.headers,
                body,
            };
            requests.push(request);
            try {
                const out = await handler(request);
                const status = out.status ?? 200;
                if (out.raw !== undefined) {
                    res.writeHead(status, { 'content-type': 'text/html', ...out.headers });
                    res.end(out.raw);
                } else {
                    res.writeHead(status, { 'content-type': 'application/json', ...out.headers });
                    res.end(JSON.stringify(out.body ?? {}));
                }
            } catch (err) {
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ errors: { message: (err as Error).message } }));
            }
        });
    });
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}`,
        requests,
        close: async () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
            }),
    };
}

export interface RunOptions {
    input: Record<string, unknown>;
    /** Mock server URL; omit to run without an endpoint override. */
    endpoint?: string;
    /** Reuse a storage directory (to test cache and resume). */
    storageDir?: string;
    /** Keep the default storages from the previous run in `storageDir`. */
    keepStorage?: boolean;
    /** Max total charge in USD (locally every event costs $1). */
    maxTotalChargeUsd?: number;
    /** Set to false to run without Tomba credentials. */
    withCredentials?: boolean;
    timeoutMs?: number;
}

export interface ChargeLogEntry {
    eventName: string;
    chargedCount?: number;
    [key: string]: unknown;
}

export interface RunResult {
    code: number | null;
    output: string;
    items: Record<string, unknown>[];
    charges: ChargeLogEntry[];
    storageDir: string;
    /** Number of charged events per event name. */
    chargeCounts: Record<string, number>;
}

/** Run the Actor (`src/main.ts`) in a child process against local storage. */
export async function runActor(options: RunOptions): Promise<RunResult> {
    const storageDir = options.storageDir ?? (await mkdtemp(join(tmpdir(), 'tomba-actor-test-')));
    const inputDir = join(storageDir, 'key_value_stores', 'default');
    await mkdir(inputDir, { recursive: true });
    await writeFile(join(inputDir, 'INPUT.json'), JSON.stringify(options.input));

    const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CRAWLEE_STORAGE_DIR: storageDir,
        CRAWLEE_PURGE_ON_START: options.keepStorage ? '0' : '1',
        APIFY_LOG_LEVEL: 'INFO',
        ACTOR_TEST_PAY_PER_EVENT: 'true',
        ACTOR_USE_CHARGING_LOG_DATASET: 'true',
    };
    if (options.withCredentials !== false) {
        env.TOMBA_API_KEY = 'ta_test_key';
        env.TOMBA_API_SECRET = 'ts_test_secret';
    }
    if (options.endpoint) env.TOMBA_API_ENDPOINT = options.endpoint;
    if (options.maxTotalChargeUsd !== undefined) env.ACTOR_MAX_TOTAL_CHARGE_USD = String(options.maxTotalChargeUsd);

    const { code, output } = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { env, cwd: process.cwd() });
        let out = '';
        child.stdout.on('data', (d: Buffer) => {
            out += d.toString();
        });
        child.stderr.on('data', (d: Buffer) => {
            out += d.toString();
        });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`Actor run timed out\n${out}`));
        }, options.timeoutMs ?? 60_000);
        child.on('close', (c) => {
            clearTimeout(timer);
            resolve({ code: c, output: out });
        });
    });

    const items = await readDataset(storageDir, 'default');
    const charges = (await readDataset(storageDir, 'charging_log')) as ChargeLogEntry[];
    const chargeCounts: Record<string, number> = {};
    for (const c of charges) chargeCounts[c.eventName] = (chargeCounts[c.eventName] ?? 0) + (c.chargedCount ?? 1);

    return { code, output, items, charges, storageDir, chargeCounts };
}

export async function readDataset(storageDir: string, name: string): Promise<Record<string, unknown>[]> {
    const dir = join(storageDir, 'datasets', name);
    let files: string[];
    try {
        files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    } catch {
        return [];
    }
    return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'))));
}

export async function removeStorage(storageDir: string): Promise<void> {
    await rm(storageDir, { recursive: true, force: true });
}

/** Total number of charged events across all event names. */
export function totalCharges(result: RunResult): number {
    return Object.values(result.chargeCounts).reduce((a, b) => a + b, 0);
}
