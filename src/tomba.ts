// Shared Tomba helper for the Tomba Apify Actors.
// Keep this file identical across all Actors.
import { createHash } from 'node:crypto';

import type { KeyValueStore } from 'apify';
import { Actor, log } from 'apify';
import { TombaClient, TombaException } from 'tomba';

/** Pay-per-event event names (configured in Apify Console → Monetization). */
export const EVENT_REQUEST = 'tomba-request';
export const EVENT_PHONE_FINDER = 'phone-finder-request';

/**
 * Tomba credits added per phone number (or per address with phone data, depending on the endpoint)
 * returned when `enrich_mobile=true`. Every credit is charged as one `tomba-request` event.
 */
export const PHONE_CREDITS = 5;

/** Number of phone numbers in a record's `phone_data` array (0 when missing or empty). */
export function phoneDataCount(record: unknown): number {
    if (!isObject(record)) return 0;
    return Array.isArray(record.phone_data) ? record.phone_data.length : 0;
}

/** True when a record has at least one phone number in `phone_data`. */
export function hasPhoneData(record: unknown): boolean {
    return phoneDataCount(record) > 0;
}

export interface RunOptions {
    maxConcurrency?: number;
    maxRetries?: number;
    useCache?: boolean;
    cacheTtlHours?: number;
}

export interface TombaCallResult {
    /** Raw JSON body returned by Tomba (`{ data, meta, ... }`). */
    body?: Record<string, unknown>;
    /** Shortcut to `body.data`. */
    data?: unknown;
    /** HTTP status (0 for network errors, 502 for a non-JSON body). */
    status: number;
    charged: boolean;
    /** Number of events charged for this call (0 when not charged). */
    chargedCount?: number;
    cached: boolean;
    /** True when the call was not made because the user's max charge limit was reached. */
    skipped?: boolean;
    error?: string;
}

export const stats = {
    requests: 0,
    charged: 0,
    cached: 0,
    failed: 0,
    retries: 0,
};

const CACHE_STORE_PREFIX = 'tomba-cache';
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const NETWORK_ERROR = /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|timeout|network/i;

let client: TombaClient | undefined;
let options: Required<RunOptions> = { maxConcurrency: 10, maxRetries: 3, useCache: true, cacheTtlHours: 24 };
let cacheStore: KeyValueStore | undefined;
const memoryCache = new Map<string, Record<string, unknown>>();
const inFlight = new Map<string, number>();
let stopped = false;

/** Initialise the Tomba client from the Actor's environment variables and apply the run options. */
export async function setupTomba(runOptions: RunOptions = {}): Promise<TombaClient> {
    const key = process.env.TOMBA_API_KEY;
    const secret = process.env.TOMBA_API_SECRET;
    if (!key || !secret) {
        await Actor.fail('Actor is misconfigured: Tomba credentials are missing. Please contact the Actor developer.');
        throw new Error('unreachable');
    }

    options = {
        maxConcurrency: clamp(runOptions.maxConcurrency ?? 10, 1, 50),
        maxRetries: clamp(runOptions.maxRetries ?? 3, 0, 10),
        useCache: runOptions.useCache ?? true,
        cacheTtlHours: Math.max(0, runOptions.cacheTtlHours ?? 24),
    };

    client = new TombaClient();
    // Verification and enrichment can take over a minute, so keep the SDK's 120 s timeout.
    client.setKey(key).setSecret(secret).setTimeout(120_000);
    // Only used by the test suite to point the client at a local mock server.
    if (process.env.TOMBA_API_ENDPOINT) client.setEndpoint(process.env.TOMBA_API_ENDPOINT);

    if (options.useCache && options.cacheTtlHours > 0) {
        try {
            cacheStore = await Actor.openKeyValueStore(cacheStoreName());
        } catch (err) {
            // E.g. "Insufficient permissions" under limited permissions: never fail the run because of the cache.
            log.warning('Cross-run cache is unavailable; results are cached for this run only.', {
                error: (err as Error).message,
            });
            cacheStore = undefined;
        }
    }

    return client;
}

/**
 * Name of the cross-run cache store. It is per Actor: with limited permissions an Actor can only open
 * named storages it created itself, so the Tomba Actors must not share one store.
 */
export function cacheStoreName(): string {
    const actorId = Actor.getEnv().actorId ?? process.env.ACTOR_ID;
    return actorId ? `${CACHE_STORE_PREFIX}-${actorId}` : CACHE_STORE_PREFIX;
}

/** The Tomba client created by setupTomba(). */
export function getClient(): TombaClient {
    if (!client) throw new Error('setupTomba() must be called first');
    return client;
}

export function getOptions(): Required<RunOptions> {
    return options;
}

/** True once the user's max-charge budget is exhausted; workers should stop picking up new items. */
export function isStopped(): boolean {
    return stopped;
}

export function stop(): void {
    stopped = true;
}

/**
 * Tomba billing rules: charge only when Tomba returns a JSON body without an `errors` object
 * and with a non-empty `data` (a negative answer such as an undeliverable verification
 * or a domain search with no emails is still a non-empty `data` object).
 */
export function isBillable(body: unknown): boolean {
    if (!isObject(body)) return false;
    if (body.errors !== undefined && body.errors !== null) return false;
    const { data } = body;
    if (data === null || data === undefined) return false;
    if (Array.isArray(data)) return data.length > 0;
    // An object whose values are all null (e.g. `{ person: null, company: null }`) is an empty result.
    if (isObject(data)) return Object.values(data).some((v) => v !== null && v !== undefined);
    return data !== '' && data !== false;
}

/**
 * Perform one Tomba API call with caching, retry and pay-per-event charging.
 *
 * @param endpoint short endpoint name used for the cache key (e.g. 'technology')
 * @param params   request parameters used for the cache key
 * @param fn       the SDK call
 * @param eventName pay-per-event name to charge when the response is billable
 * @param count    events to charge for a billable response: a number, or a function of the response body
 */
export async function callTomba(
    endpoint: string,
    params: Record<string, unknown>,
    fn: (tomba: TombaClient) => Promise<unknown>,
    eventName: string = EVENT_REQUEST,
    count: number | ((body: Record<string, unknown>) => number) = 1,
): Promise<TombaCallResult> {
    if (!client) throw new Error('setupTomba() must be called first');

    const cacheKey = hashKey(endpoint, params);
    const cachedBody = await readCache(cacheKey);
    if (cachedBody) {
        stats.cached++;
        return { body: cachedBody, data: cachedBody.data, status: 200, charged: false, cached: true };
    }

    // Reserve budget before calling Tomba so concurrent workers never exceed the user's max charge.
    if (!reserve(eventName)) {
        stop();
        return { status: 0, charged: false, cached: false, skipped: true, error: 'Max charge limit reached' };
    }

    try {
        for (let attempt = 0; ; attempt++) {
            try {
                stats.requests++;
                const body = unwrap(await fn(client));

                if (!isObject(body)) {
                    stats.failed++;
                    return { status: 502, charged: false, cached: false, error: 'Invalid response from Tomba' };
                }

                if (!isBillable(body)) {
                    const error = errorMessage(body) ?? undefined;
                    return { body, data: body.data, status: 200, charged: false, cached: false, error };
                }

                const units = Math.max(1, Math.ceil(typeof count === 'function' ? count(body) : count));
                const chargedCount = await charge(eventName, units);
                const charged = chargedCount > 0;
                await writeCache(cacheKey, body);
                return { body, data: body.data, status: 200, charged, chargedCount, cached: false };
            } catch (err) {
                const { status, message, retryAfter } = parseError(err);
                const retryable = status === 0 || status === 429 || status >= 500;
                if (retryable && attempt < options.maxRetries) {
                    stats.retries++;
                    const delay = retryAfter ?? Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
                    const jitter = Math.random() * 250;
                    log.warning(`Tomba ${endpoint} returned ${status || 'network error'}, retrying in ${delay}ms`, {
                        attempt: attempt + 1,
                    });
                    await sleep(delay + jitter);
                    continue;
                }
                stats.failed++;
                return { status, charged: false, cached: false, error: message };
            }
        }
    } finally {
        release(eventName);
    }
}

/**
 * Run `worker` over `items` with bounded concurrency. Stops picking new items once the charge limit
 * is reached (`isStopped()`) or `shouldStop()` returns true (e.g. maxResults reached for this run).
 */
export async function runPool<T>(
    items: T[],
    worker: (item: T, index: number) => Promise<void>,
    concurrency = options.maxConcurrency,
    shouldStop: () => boolean = () => false,
): Promise<void> {
    let next = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (!stopped && !shouldStop() && next < items.length) {
            const index = next++;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
}

/** Persisted run state used to resume after a migration, restart or resurrection. */
export async function useRunState(): Promise<{ done: Record<string, true> }> {
    return Actor.useState<{ done: Record<string, true> }>('TOMBA_STATE', { done: {} });
}

export function logSummary(title: string, total: number, startedAt: number): void {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    log.info(`${title} finished`, {
        inputs: total,
        tombaRequests: stats.requests,
        charged: stats.charged,
        cacheHits: stats.cached,
        failed: stats.failed,
        retries: stats.retries,
        seconds,
        stoppedByChargeLimit: stopped,
    });
}

export function normalizeDomain(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
}

export function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

export function unique<T>(items: T[], key: (item: T) => string = String): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        const k = key(item);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

// ---------------------------------------------------------------------------

async function charge(eventName: string, count: number): Promise<number> {
    const result = await Actor.charge({ eventName, count });
    if (result.chargedCount > 0) stats.charged += result.chargedCount;
    if (result.eventChargeLimitReached) {
        log.info('Max charge limit reached, finishing current items and stopping.');
        stop();
    }
    return result.chargedCount;
}

function reserve(eventName: string): boolean {
    if (stopped) return false;
    const manager = Actor.getChargingManager();
    const remaining = manager.calculateMaxEventChargeCountWithinLimit(eventName);
    const current = inFlight.get(eventName) ?? 0;
    if (remaining - current < 1) return false;
    inFlight.set(eventName, current + 1);
    return true;
}

function release(eventName: string): void {
    inFlight.set(eventName, Math.max(0, (inFlight.get(eventName) ?? 1) - 1));
}

async function readCache(key: string): Promise<Record<string, unknown> | undefined> {
    if (!options.useCache) return undefined;
    const hit = memoryCache.get(key);
    if (hit) return hit;
    if (!cacheStore) return undefined;
    const entry = await cacheStore.getValue<{ savedAt: number; body: Record<string, unknown> }>(key);
    if (!entry) return undefined;
    if (Date.now() - entry.savedAt > options.cacheTtlHours * 3600_000) return undefined;
    memoryCache.set(key, entry.body);
    return entry.body;
}

async function writeCache(key: string, body: Record<string, unknown>): Promise<void> {
    if (!options.useCache) return;
    memoryCache.set(key, body);
    if (cacheStore) {
        try {
            await cacheStore.setValue(key, { savedAt: Date.now(), body });
        } catch (err) {
            log.debug('Failed to write cache entry', { error: (err as Error).message });
        }
    }
}

function hashKey(endpoint: string, params: Record<string, unknown>): string {
    const sorted = Object.keys(params)
        .sort()
        .map((k) => [k, params[k]]);
    return `${endpoint}-${createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 40)}`;
}

/** tomba >= 1.1.0 resolves to `{ data: body, rateLimit }`; older versions resolve to the body itself. */
function unwrap(response: unknown): unknown {
    if (isObject(response) && 'rateLimit' in response && 'data' in response) return response.data;
    return response;
}

function parseError(err: unknown): { status: number; message: string; retryAfter?: number } {
    if (err instanceof TombaException) {
        const response = err.code as { status?: number; headers?: Record<string, string> } | undefined;
        // Without an HTTP response it is either a network error (retryable, status 0)
        // or the SDK's own input validation (not retryable, treated as 400).
        const networkError = NETWORK_ERROR.test(err.message ?? '');
        let status = networkError ? 0 : 400;
        if (typeof response?.status === 'number') status = response.status;
        const retryAfterHeader = Number(response?.headers?.['retry-after']);
        const retryAfter =
            Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : undefined;
        const message = errorMessage(err.response) ?? err.message ?? 'Tomba request failed';
        return { status, message: status ? `${status}: ${message}` : message, retryAfter };
    }
    return { status: 0, message: err instanceof Error ? err.message : String(err) };
}

function errorMessage(body: unknown): string | undefined {
    if (!isObject(body)) return typeof body === 'string' && body.length < 300 ? body : undefined;
    const errors = body.errors as Record<string, unknown> | undefined;
    if (isObject(errors) && typeof errors.message === 'string') return errors.message;
    return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.floor(value)));
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
