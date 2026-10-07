import { log } from 'apify';
import { Phone } from 'tomba';

import { InputError, queryBool, queryInt, queryString, runActor } from './standby.js';
import type { RunOptions } from './tomba.js';
import {
    callTomba,
    EVENT_REQUEST,
    getClient,
    normalizeDomain,
    normalizeEmail,
    PHONE_CREDITS,
    runPool,
    unique,
} from './tomba.js';

interface SearchQuery {
    email?: string;
    domain?: string;
    linkedin?: string;
}

interface PhoneFinderInput extends RunOptions {
    searches?: SearchQuery[];
    maxResults?: number;
    full?: boolean;
    webhookUrl?: string;
}

interface PhoneFinderParams extends SearchQuery {
    full?: boolean;
    webhook_url?: string;
}

const SOURCE_FIELDS = ['email', 'domain', 'linkedin'] as const;

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

/** Phone Finder pricing: 1 credit when the request includes a domain, otherwise 5 (email or LinkedIn only). */
function searchCredits(search: SearchQuery): number {
    return search.domain ? 1 : PHONE_CREDITS;
}

await runActor<PhoneFinderInput>({
    title: 'Phone Finder',
    count: (input) => input.searches?.length ?? 0,
    fromQuery: (query) => {
        // One search per GET request, built from the email, domain and linkedin parameters.
        const search: SearchQuery = {};
        for (const field of SOURCE_FIELDS) {
            const value = queryString(query, field);
            if (value) search[field] = value;
        }
        return {
            searches: Object.keys(search).length ? [search] : [],
            full: queryBool(query, 'full'),
            webhookUrl: queryString(query, 'webhookUrl'),
            maxResults: queryInt(query, 'maxResults'),
        };
    },
    run: async (input, { push, isDone, markDone, standby }) => {
        if (!input.searches?.length) {
            throw new InputError('Input must contain at least one search query in "searches".');
        }

        const { searches: rawSearches, maxResults = 50, full = false, webhookUrl } = input;
        const webhook = typeof webhookUrl === 'string' && webhookUrl.trim() ? webhookUrl.trim() : undefined;
        const phone = new Phone(getClient());

        /** Request parameters; the global options are only sent when set. */
        const requestParams = (search: SearchQuery): PhoneFinderParams => {
            const params: PhoneFinderParams = { ...search };
            if (full) params.full = true;
            if (webhook) params.webhook_url = webhook;
            return params;
        };

        const normalized = rawSearches.map(normalizeSearch);
        const emptyCount = normalized.filter((search) => !searchKey(search)).length;
        if (emptyCount > 0) {
            log.warning(`Skipping ${emptyCount} search queries without email, domain or linkedin.`);
        }

        const searches = unique(normalized, searchKey);
        const pending = searches.filter((search) => !isDone(searchKey(search)));
        if (pending.length < searches.length) {
            log.info(`Resuming: ${searches.length - pending.length} search queries already processed.`);
        }

        let pushed = 0;
        const limitReached = () => pushed >= maxResults;
        if (!standby) {
            log.info(`Finding phone numbers for ${pending.length} search queries`, { full, webhook: Boolean(webhook) });
        }

        await runPool(
            pending,
            async (search) => {
                if (limitReached()) return;
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
                    res.data &&
                    typeof res.data === 'object' &&
                    !Array.isArray(res.data) &&
                    Object.keys(res.data).length > 0
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
                    await push({
                        ...base,
                        ...data,
                        source,
                        chargedCredits: res.chargedCount ?? 0,
                        charged: res.charged,
                        cached: res.cached,
                        ...(valid ? {} : { error: 'No valid phone number found' }),
                    });
                    const found = valid
                        ? String(data.intl_format ?? data.local_format ?? 'phone found')
                        : 'no valid phone number';
                    log.info(`${source.search_value}: ${found}${res.cached ? ' (cached)' : ''}`);
                } else {
                    await push({
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

                markDone(searchKey(search));
            },
            undefined,
            limitReached,
        );
    },
});
