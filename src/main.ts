import { Actor, log } from 'apify';
import { Phone } from 'tomba';

import type { RunOptions } from './tomba.js';
import {
    callTomba,
    EVENT_REQUEST,
    logSummary,
    normalizeDomain,
    normalizeEmail,
    PHONE_CREDITS,
    runPool,
    setupTomba,
    stop,
    unique,
    useRunState,
} from './tomba.js';

interface SearchQuery {
    email?: string;
    domain?: string;
    linkedin?: string;
}

interface PhoneFinderInput extends RunOptions {
    searches: SearchQuery[];
    maxResults?: number;
    full?: boolean;
    webhookUrl?: string;
}

interface PhoneFinderParams extends SearchQuery {
    full?: boolean;
    webhook_url?: string;
}

await Actor.init();

const input = await Actor.getInput<PhoneFinderInput>();
if (!input?.searches?.length) {
    await Actor.fail('Input must contain at least one search query in "searches".');
}

const { searches: rawSearches, maxResults = 50, full = false, webhookUrl, ...runOptions } = input!;
const webhook = typeof webhookUrl === 'string' && webhookUrl.trim() ? webhookUrl.trim() : undefined;
const client = await setupTomba(runOptions);
const phone = new Phone(client);
const state = await useRunState();

/** Normalize a search query, keeping only non-empty fields. */
function normalizeSearch(search: SearchQuery): SearchQuery {
    const result: SearchQuery = {};
    const email = typeof search?.email === 'string' ? normalizeEmail(search.email) : '';
    const domain = typeof search?.domain === 'string' ? normalizeDomain(search.domain) : '';
    const linkedin = typeof search?.linkedin === 'string' ? search.linkedin.trim() : '';
    if (email) result.email = email;
    if (domain) result.domain = domain;
    if (linkedin) result.linkedin = linkedin;
    return result;
}

function searchKey(search: SearchQuery): string {
    if (!search.email && !search.domain && !search.linkedin) return '';
    return JSON.stringify([search.email ?? '', search.domain ?? '', search.linkedin ?? '']);
}

function searchSource(search: SearchQuery): { search_type: string; search_value: string } {
    if (search.email) return { search_type: 'email', search_value: search.email };
    if (search.linkedin) return { search_type: 'linkedin', search_value: search.linkedin };
    return { search_type: 'domain', search_value: search.domain ?? '' };
}

/** Request parameters; the global options are only sent when set. */
function requestParams(search: SearchQuery): PhoneFinderParams {
    const params: PhoneFinderParams = { ...search };
    if (full) params.full = true;
    if (webhook) params.webhook_url = webhook;
    return params;
}

/** Phone Finder pricing: 1 credit when the request includes a domain, otherwise 5 (email or LinkedIn only). */
function searchCredits(search: SearchQuery): number {
    return search.domain ? 1 : PHONE_CREDITS;
}

const normalized = rawSearches.map(normalizeSearch);
const emptyCount = normalized.filter((search) => !searchKey(search)).length;
if (emptyCount > 0) {
    log.warning(`Skipping ${emptyCount} search queries without email, domain or linkedin.`);
}

const searches = unique(normalized, searchKey);
const pending = searches.filter((search) => !state.done[searchKey(search)]);
if (pending.length < searches.length) {
    log.info(`Resuming: ${searches.length - pending.length} search queries already processed.`);
}

let pushed = 0;
const startedAt = Date.now();
log.info(`Finding phone numbers for ${pending.length} search queries`, { full, webhook: Boolean(webhook) });

await runPool(pending, async (search) => {
    if (pushed >= maxResults) {
        stop();
        return;
    }

    const params = requestParams(search);
    const res = await callTomba(
        'phone-finder',
        { ...params },
        async () => phone.finder({ ...params }),
        EVENT_REQUEST,
        searchCredits(search),
    );
    if (res.skipped) return;

    const source = searchSource(search);
    const data =
        res.data && typeof res.data === 'object' && !Array.isArray(res.data) && Object.keys(res.data).length > 0
            ? (res.data as Record<string, unknown>)
            : undefined;
    const base = {
        email: search.email ?? null,
        domain: search.domain ?? null,
        linkedin: search.linkedin ?? null,
    };

    if (data) {
        const valid = data.valid === true;
        if (valid) pushed++;
        await Actor.pushData({
            ...base,
            ...data,
            source,
            chargedCredits: res.chargedCount ?? 0,
            charged: res.charged,
            cached: res.cached,
            ...(valid ? {} : { error: 'No valid phone number found' }),
        });
        const found = valid ? String(data.intl_format ?? data.local_format ?? 'phone found') : 'no valid phone number';
        log.info(`${source.search_value}: ${found}${res.cached ? ' (cached)' : ''}`);
    } else {
        await Actor.pushData({
            ...base,
            valid: null,
            source,
            chargedCredits: 0,
            charged: res.charged,
            cached: res.cached,
            error: res.error ?? 'No phone number found',
        });
        log.info(`${source.search_value}: ${res.error ?? 'no phone number found'}`);
    }

    state.done[searchKey(search)] = true;
});

logSummary('Phone Finder', searches.length, startedAt);

await Actor.exit();
