// Shared runner for the Tomba Apify Actors: batch runs and Standby (real-time HTTP API) mode.
// Keep this file identical across all Actors.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

import { Actor, log } from 'apify';

import type { RunOptions } from './tomba.js';
import { isStopped, logSummary, setupTomba, useRunState } from './tomba.js';

/** Invalid input: a failed batch run, or `400 Bad Request` in Standby mode. */
export class InputError extends Error {}

export type Item = Record<string, unknown>;

export interface RunContext {
    /** Save result items (dataset in batch runs, HTTP response in Standby mode). */
    push: (items: Item | Item[]) => Promise<void>;
    /** True when this input was already processed (batch runs resume after a migration or restart). */
    isDone: (key: string) => boolean;
    /** Record a processed input so a resumed run skips it. */
    markDone: (key: string) => void;
    standby: boolean;
}

/** Processes one Actor input. Throws InputError for invalid input. */
export type ActorRun<I> = (input: I, ctx: RunContext) => Promise<void>;

export interface ActorDefinition<I> {
    /** Name used in logs. */
    title: string;
    run: ActorRun<I>;
    /** Builds the Actor input from `GET /?…` query parameters in Standby mode. */
    fromQuery: (query: URLSearchParams) => I;
    /** Number of inputs, for the batch summary log. */
    count?: (input: I) => number;
}

const MAX_BODY_BYTES = 1_000_000;

export function isStandby(): boolean {
    return Actor.config.get('metaOrigin') === 'STANDBY';
}

/** Entry point: runs the Actor as a batch job, or as an HTTP server in Standby mode. */
export async function runActor<I extends RunOptions>(definition: ActorDefinition<I>): Promise<void> {
    await Actor.init();

    if (isStandby()) {
        await setupTomba();
        await startStandbyServer(definition);
        return;
    }

    const input = ((await Actor.getInput<I>()) ?? {}) as I;
    await setupTomba(input);
    const state = await useRunState();
    const startedAt = Date.now();
    try {
        await definition.run(input, {
            push: async (items) => Actor.pushData(items),
            isDone: (key) => Boolean(state.done[key]),
            markDone: (key) => {
                state.done[key] = true;
            },
            standby: false,
        });
    } catch (err) {
        if (err instanceof InputError) {
            await Actor.fail(err.message);
            return;
        }
        throw err;
    }
    logSummary(definition.title, definition.count?.(input) ?? 0, startedAt);
    await Actor.exit();
}

async function startStandbyServer<I>(definition: ActorDefinition<I>): Promise<void> {
    const server = createServer((req, res) => {
        handleRequest(definition, req, res).catch((err: Error) => {
            log.exception(err, 'Standby request failed');
            send(res, 500, { error: 'Internal error' });
        });
    });
    const port = Actor.config.get('containerPort');
    await new Promise<void>((resolve) => {
        server.listen(port, resolve);
    });
    log.info(`${definition.title} is ready for real-time requests`, { port });
}

async function handleRequest<I>(definition: ActorDefinition<I>, req: IncomingMessage, res: ServerResponse) {
    if (req.headers['x-apify-container-server-readiness-probe']) {
        send(res, 200, { status: 'ready' });
        return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/') {
        send(res, 404, { error: 'Not found. Use GET / with query parameters or POST / with a JSON input.' });
        return;
    }

    let input: I;
    try {
        if (req.method === 'GET') {
            if ([...url.searchParams.keys()].length === 0) {
                send(res, 200, {
                    status: 'ready',
                    usage: 'GET /?<parameters> or POST / with the same JSON input as a normal run.',
                });
                return;
            }
            input = definition.fromQuery(url.searchParams);
        } else if (req.method === 'POST') {
            input = (await readJson(req)) as I;
        } else {
            send(res, 405, { error: 'Method not allowed. Use GET or POST.' });
            return;
        }
    } catch (err) {
        send(res, 400, { error: (err as Error).message });
        return;
    }

    if (isStopped()) {
        send(res, 402, { error: 'Max charge limit reached for this Actor run.' });
        return;
    }

    const items: Item[] = [];
    try {
        await definition.run(input, {
            push: async (pushed) => {
                items.push(...(Array.isArray(pushed) ? pushed : [pushed]));
            },
            isDone: () => false,
            markDone: () => undefined,
            standby: true,
        });
    } catch (err) {
        if (err instanceof InputError) {
            send(res, 400, { error: err.message });
            return;
        }
        throw err;
    }
    send(res, 200, { items });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY_BYTES) throw new InputError('Request body is too large (max 1 MB).');
        chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) return {};
    try {
        const body = JSON.parse(text);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            throw new InputError('Request body must be a JSON object.');
        }
        return body;
    } catch (err) {
        if (err instanceof InputError) throw err;
        throw new InputError('Request body must be valid JSON.');
    }
}

function send(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

// --- Query string helpers for `fromQuery` ---------------------------------------------------

/** Values of a list parameter: repeated (`?domain=a&domain=b`) and/or comma-separated (`?domains=a,b`). */
export function queryList(query: URLSearchParams, ...names: string[]): string[] {
    return names
        .flatMap((name) => query.getAll(name))
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean);
}

export function queryString(query: URLSearchParams, name: string): string | undefined {
    const value = query.get(name)?.trim();
    return value || undefined;
}

export function queryBool(query: URLSearchParams, name: string): boolean | undefined {
    const value = query.get(name)?.trim().toLowerCase();
    if (value === undefined || value === '') return undefined;
    if (['1', 'true', 'yes'].includes(value)) return true;
    if (['0', 'false', 'no'].includes(value)) return false;
    throw new InputError(`Query parameter "${name}" must be true or false.`);
}

export function queryInt(query: URLSearchParams, name: string): number | undefined {
    const value = query.get(name)?.trim();
    if (value === undefined || value === '') return undefined;
    const number = Number(value);
    if (!Number.isInteger(number)) throw new InputError(`Query parameter "${name}" must be an integer.`);
    return number;
}
