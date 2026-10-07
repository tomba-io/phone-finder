// Shared test harness for the Tomba Apify Actors.
// Keep this file identical across all Actors.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
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

export interface StandbyActor {
    /** Base URL of the Actor's HTTP server. */
    url: string;
    storageDir: string;
    /** GET or POST a request to the Actor and parse the JSON response. */
    call: (
        path: string,
        init?: { method?: string; body?: unknown; headers?: Record<string, string> },
    ) => Promise<{ status: number; body: Record<string, unknown> }>;
    /** Stop the Actor and return its log output and charges. */
    stop: () => Promise<{ output: string; chargeCounts: Record<string, number> }>;
}

async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => {
        server.close(() => resolve());
    });
    return port;
}

async function httpCall(
    url: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
    let payload: string | undefined;
    if (typeof init.body === 'string') payload = init.body;
    else if (init.body !== undefined) payload = JSON.stringify(init.body);
    return new Promise((resolve, reject) => {
        const req = httpRequest(
            url,
            {
                method: init.method ?? (payload ? 'POST' : 'GET'),
                headers: { 'content-type': 'application/json', ...init.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString();
                    let body: Record<string, unknown> = {};
                    try {
                        body = JSON.parse(text);
                    } catch {
                        body = { raw: text };
                    }
                    resolve({ status: res.statusCode ?? 0, body });
                });
            },
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

/** Start the Actor in Standby mode (real-time HTTP API) and wait until it is ready. */
export async function startStandbyActor(
    options: { endpoint?: string; maxTotalChargeUsd?: number; withCredentials?: boolean } = {},
): Promise<StandbyActor> {
    const storageDir = await mkdtemp(join(tmpdir(), 'tomba-standby-test-'));
    const port = await freePort();
    const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CRAWLEE_STORAGE_DIR: storageDir,
        APIFY_LOG_LEVEL: 'INFO',
        APIFY_META_ORIGIN: 'STANDBY',
        ACTOR_WEB_SERVER_PORT: String(port),
        ACTOR_TEST_PAY_PER_EVENT: 'true',
        ACTOR_USE_CHARGING_LOG_DATASET: 'true',
    };
    if (options.withCredentials !== false) {
        env.TOMBA_API_KEY = 'ta_test_key';
        env.TOMBA_API_SECRET = 'ts_test_secret';
    }
    if (options.endpoint) env.TOMBA_API_ENDPOINT = options.endpoint;
    if (options.maxTotalChargeUsd !== undefined) env.ACTOR_MAX_TOTAL_CHARGE_USD = String(options.maxTotalChargeUsd);

    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { env, cwd: process.cwd() });
    let output = '';
    child.stdout.on('data', (d: Buffer) => {
        output += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
        output += d.toString();
    });
    const exited = new Promise<void>((resolve) => {
        child.on('close', () => resolve());
    });

    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    for (;;) {
        if (child.exitCode !== null) throw new Error(`Standby Actor exited early\n${output}`);
        try {
            const res = await httpCall(`${url}/`, { headers: { 'x-apify-container-server-readiness-probe': '1' } });
            if (res.status === 200) break;
        } catch {
            // not listening yet
        }
        if (Date.now() > deadline) {
            child.kill('SIGKILL');
            throw new Error(`Standby Actor did not become ready\n${output}`);
        }
        await new Promise((r) => {
            setTimeout(r, 100);
        });
    }

    return {
        url,
        storageDir,
        call: async (path, init) => httpCall(`${url}${path}`, init),
        stop: async () => {
            child.kill('SIGTERM');
            await exited;
            const charges = (await readDataset(storageDir, 'charging_log')) as ChargeLogEntry[];
            const chargeCounts: Record<string, number> = {};
            for (const c of charges)
                chargeCounts[c.eventName] = (chargeCounts[c.eventName] ?? 0) + (c.chargedCount ?? 1);
            await removeStorage(storageDir);
            return { output, chargeCounts };
        },
    };
}
