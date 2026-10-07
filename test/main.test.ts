// End-to-end tests: run the Actor against a mock Tomba API.
import assert from 'node:assert/strict';
import { after, afterEach, describe, it } from 'node:test';

import type { MockHandler, MockServer } from './helpers.js';
import { removeStorage, runActor, startMockTomba, startStandbyActor, totalCharges } from './helpers.js';

const PHONE = {
    valid: true,
    local_format: '(415) 555-0132',
    intl_format: '+1 415-555-0132',
    e164_format: '+14155550132',
    rfc3966_format: 'tel:+1-415-555-0132',
    country_code: 'US',
    line_type: 'MOBILE',
    carrier: 'AT&T',
    region: { name: 'California', code: 'CA' },
    timezones: ['America/Los_Angeles'],
};

const LINKEDIN = 'https://www.linkedin.com/in/janedoe';

/** Default Tomba behaviour for GET /phone-finder. */
const tomba: MockHandler = (req) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.path, '/phone-finder');
    const { email, domain, linkedin } = req.query;
    if (email === 'nobody@stripe.com') return { body: { data: null } };
    if (email === 'empty@stripe.com') return { body: { data: {} } };
    if (email === 'landline@stripe.com') return { body: { data: { email, domain: 'stripe.com', valid: false } } };
    if (email === 'bad-email') return { status: 422, body: { errors: { message: 'Invalid email address' } } };
    if (email === 'html@stripe.com') return { raw: '<html>Bad gateway</html>' };
    if (domain === 'nophone.com') return { body: { data: null } };
    if (email) return { body: { data: { email, domain: email.split('@')[1], ...PHONE } } };
    if (linkedin) return { body: { data: { email: 'jane.doe@stripe.com', domain: 'stripe.com', linkedin, ...PHONE } } };
    return { body: { data: { domain, ...PHONE, line_type: 'FIXED_LINE' } } };
};

const servers: MockServer[] = [];
const dirs: string[] = [];

async function mock(handler: MockHandler = tomba): Promise<MockServer> {
    const server = await startMockTomba(handler);
    servers.push(server);
    return server;
}

async function run(...args: Parameters<typeof runActor>) {
    const result = await runActor(...args);
    dirs.push(result.storageDir);
    return result;
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map(async (s) => s.close()));
});

after(async () => {
    await Promise.all(dirs.map(removeStorage));
});

describe('phone-finder', () => {
    it('returns the phone number for an email search and charges 5 credits', async () => {
        const server = await mock();
        const result = await run({ input: { searches: [{ email: 'jane.doe@stripe.com' }] }, endpoint: server.url });

        assert.equal(result.code, 0, result.output);
        assert.equal(result.items.length, 1);
        assert.deepEqual(result.items[0], {
            email: 'jane.doe@stripe.com',
            domain: 'stripe.com',
            linkedin: null,
            ...PHONE,
            source: { search_type: 'email', search_value: 'jane.doe@stripe.com' },
            chargedCredits: 5,
            charged: true,
            cached: false,
        });
        assert.deepEqual(server.requests[0].query, { email: 'jane.doe@stripe.com' });
        assert.deepEqual(result.chargeCounts, { 'tomba-request': 5 });
    });

    it('charges LinkedIn searches 5 credits', async () => {
        const server = await mock();
        const result = await run({ input: { searches: [{ linkedin: LINKEDIN }] }, endpoint: server.url });

        assert.equal(result.code, 0, result.output);
        assert.deepEqual(server.requests[0].query, { linkedin: LINKEDIN });
        const item = result.items[0];
        assert.equal(item.linkedin, LINKEDIN);
        assert.equal(item.intl_format, '+1 415-555-0132');
        assert.deepEqual(item.source, { search_type: 'linkedin', search_value: LINKEDIN });
        assert.equal(item.charged, true);
        assert.equal(item.chargedCredits, 5);
        assert.deepEqual(result.chargeCounts, { 'tomba-request': 5 });
    });

    it('charges domain searches 1 credit', async () => {
        const server = await mock();
        const result = await run({ input: { searches: [{ domain: 'stripe.com' }] }, endpoint: server.url });

        assert.equal(result.code, 0, result.output);
        assert.deepEqual(server.requests[0].query, { domain: 'stripe.com' });
        const item = result.items[0];
        assert.equal(item.email, null);
        assert.equal(item.domain, 'stripe.com');
        assert.equal(item.line_type, 'FIXED_LINE');
        assert.deepEqual(item.source, { search_type: 'domain', search_value: 'stripe.com' });
        assert.equal(item.charged, true);
        assert.equal(item.chargedCredits, 1);
        assert.deepEqual(result.chargeCounts, { 'tomba-request': 1 });
    });

    it('charges 1 credit for an email search that includes a domain', async () => {
        const server = await mock();
        const result = await run({
            input: { searches: [{ email: 'john@shopify.com', domain: 'shopify.com' }] },
            endpoint: server.url,
        });

        assert.equal(result.code, 0, result.output);
        assert.deepEqual(server.requests[0].query, { email: 'john@shopify.com', domain: 'shopify.com' });
        assert.equal(result.items[0].chargedCredits, 1);
        assert.deepEqual(result.chargeCounts, { 'tomba-request': 1 });
    });

    it('charges a LinkedIn search that includes a domain 1 credit', async () => {
        const server = await mock();
        const result = await run({
            input: { searches: [{ linkedin: LINKEDIN, domain: 'stripe.com' }] },
            endpoint: server.url,
        });
        assert.equal(result.items[0].chargedCredits, 1);
        assert.deepEqual(result.chargeCounts, { 'tomba-request': 1 });
    });

    it('charges every search type with the right credits in a mixed run', async () => {
        const server = await mock();
        const result = await run({
            input: {
                searches: [
                    { email: 'jane.doe@stripe.com' },
                    { linkedin: LINKEDIN },
                    { domain: 'stripe.com' },
                    { domain: 'shopify.com' },
                    // Any search that includes a domain costs 1 credit.
                    { email: 'john@shopify.com', domain: 'shopify.com' },
                ],
            },
            endpoint: server.url,
        });

        assert.equal(result.code, 0, result.output);
        assert.equal(result.items.length, 5);
        assert.deepEqual(result.items.map((i) => i.chargedCredits).sort(), [1, 1, 1, 5, 5]);
        // 5 (email) + 5 (LinkedIn) + 1 + 1 (domains) + 1 (email with domain) = 13 credits.
        assert.deepEqual(result.chargeCounts, { 'tomba-request': 13 });
    });

    it('does not charge a search with no number on record', async () => {
        const server = await mock();
        const result = await run({
            input: {
                searches: [{ email: 'nobody@stripe.com' }, { email: 'empty@stripe.com' }, { domain: 'nophone.com' }],
            },
            endpoint: server.url,
        });

        assert.equal(result.code, 0, result.output);
        assert.equal(result.items.length, 3);
        for (const item of result.items) {
            assert.equal(item.charged, false);
            assert.equal(item.cached, false);
            assert.equal(item.valid, null);
            assert.equal(item.error, 'No phone number found');
        }
        const nobody = result.items.find((i) => i.email === 'nobody@stripe.com');
        assert.deepEqual(nobody, {
            email: 'nobody@stripe.com',
            domain: null,
            linkedin: null,
            valid: null,
            source: { search_type: 'email', search_value: 'nobody@stripe.com' },
            chargedCredits: 0,
            charged: false,
            cached: false,
            error: 'No phone number found',
        });
        assert.equal(totalCharges(result), 0);
    });

    it('reports an invalid number returned by Tomba as an answer', async () => {
        const server = await mock();
        const result = await run({ input: { searches: [{ email: 'landline@stripe.com' }] }, endpoint: server.url });

        assert.equal(result.items[0].valid, false);
        assert.equal(result.items[0].error, 'No valid phone number found');
        // A non-empty answer is billable, like any other Tomba negative answer.
        assert.equal(result.items[0].charged, true);
        assert.deepEqual(result.chargeCounts, { 'tomba-request': 5 });
    });

    it('sends the built-in credentials to Tomba', async () => {
        const server = await mock();
        await run({ input: { searches: [{ email: 'jane.doe@stripe.com' }] }, endpoint: server.url });
        assert.equal(server.requests[0].headers['x-tomba-key'], 'ta_test_key');
        assert.equal(server.requests[0].headers['x-tomba-secret'], 'ts_test_secret');
    });

    it('normalizes and deduplicates searches and skips empty ones', async () => {
        const server = await mock();
        const result = await run({
            input: {
                searches: [
                    { email: '  Jane.Doe@Stripe.COM ' },
                    { email: 'jane.doe@stripe.com' },
                    { domain: 'https://www.Stripe.com/contact' },
                    { domain: 'stripe.com' },
                    { linkedin: `  ${LINKEDIN}  ` },
                    { linkedin: LINKEDIN },
                    {},
                    { email: '   ', domain: '' },
                ],
            },
            endpoint: server.url,
        });

        assert.equal(result.code, 0, result.output);
        assert.deepEqual(
            server.requests.map((r) => r.query),
            [{ email: 'jane.doe@stripe.com' }, { domain: 'stripe.com' }, { linkedin: LINKEDIN }],
        );
        assert.equal(result.items.length, 3);
    });

    it('does not charge Tomba error statuses and does not retry them', async () => {
        const server = await mock();
        const result = await run({ input: { searches: [{ email: 'bad-email' }] }, endpoint: server.url });
        assert.equal(result.code, 0, result.output);
        assert.equal(server.requests.length, 1);
        assert.equal(result.items[0].charged, false);
        assert.match(String(result.items[0].error), /422: Invalid email address/);
        assert.equal(totalCharges(result), 0);
    });

    it('does not charge a non-JSON body', async () => {
        const server = await mock();
        const result = await run({ input: { searches: [{ email: 'html@stripe.com' }] }, endpoint: server.url });
        assert.equal(result.items[0].charged, false);
        assert.match(String(result.items[0].error), /Invalid response/);
        assert.equal(totalCharges(result), 0);
    });

    it('retries 429 and 5xx responses, then charges the success once', async () => {
        let calls = 0;
        const server = await mock(async (req) => {
            calls++;
            if (calls === 1)
                return {
                    status: 429,
                    body: { errors: { message: 'Too many requests' } },
                    headers: { 'retry-after': '1' },
                };
            if (calls === 2) return { status: 502, body: {} };
            return tomba(req);
        });
        const result = await run({
            input: { searches: [{ email: 'jane.doe@stripe.com' }], maxRetries: 3 },
            endpoint: server.url,
        });
        assert.equal(server.requests.length, 3);
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].charged, true);
        assert.deepEqual(result.chargeCounts, { 'tomba-request': 5 });
    });

    it('serves repeated runs from the cache for free', async () => {
        const server = await mock();
        const input = { searches: [{ email: 'jane.doe@stripe.com' }, { domain: 'stripe.com' }] };
        const first = await run({ input, endpoint: server.url });
        const second = await run({ input, endpoint: server.url, storageDir: first.storageDir });

        assert.deepEqual(first.chargeCounts, { 'tomba-request': 6 });
        assert.equal(server.requests.length, 2);
        assert.equal(second.items.length, 2);
        assert.ok(second.items.every((i) => i.cached === true && i.charged === false && i.chargedCredits === 0));
        assert.equal(second.items.find((i) => i.email)?.intl_format, '+1 415-555-0132');
        assert.equal(totalCharges(second), 0);
    });

    it('calls Tomba again when the cache is disabled', async () => {
        const server = await mock();
        const input = { searches: [{ email: 'jane.doe@stripe.com' }], useCache: false };
        const first = await run({ input, endpoint: server.url });
        const second = await run({ input, endpoint: server.url, storageDir: first.storageDir });
        assert.equal(server.requests.length, 2);
        assert.equal(second.items[0].cached, false);
        assert.deepEqual(second.chargeCounts, { 'tomba-request': 5 });
    });

    it('stops at the max charge limit and resumes without reprocessing', async () => {
        const server = await mock();
        const emails = ['a@acme.com', 'b@acme.com', 'c@acme.com', 'd@acme.com', 'e@acme.com'];
        const input = { searches: emails.map((email) => ({ email })), maxConcurrency: 1, useCache: false };

        // Locally every event costs $1 and an email search is 5 events, so a $10 budget allows two searches.
        const first = await run({ input, endpoint: server.url, maxTotalChargeUsd: 10 });
        assert.equal(first.code, 0, first.output);
        assert.deepEqual(first.chargeCounts, { 'tomba-request': 10 });
        assert.equal(server.requests.length, 2);
        assert.equal(first.items.length, 2);

        const second = await run({ input, endpoint: server.url, storageDir: first.storageDir, keepStorage: true });
        assert.equal(second.code, 0, second.output);
        assert.deepEqual(
            server.requests.map((r) => r.query.email),
            emails,
        );
        assert.equal(second.items.length, 5);
    });

    it('respects maxResults', async () => {
        const server = await mock();
        const result = await run({
            input: {
                searches: [{ email: 'a@acme.com' }, { email: 'b@acme.com' }, { email: 'c@acme.com' }],
                maxResults: 1,
                maxConcurrency: 1,
            },
            endpoint: server.url,
        });
        assert.equal(result.items.length, 1);
        assert.equal(server.requests.length, 1);
        assert.equal(totalCharges(result), 5);
    });

    it('sends full and webhook_url on every search only when they are set', async () => {
        const server = await mock();
        const searches = [{ email: 'jane.doe@stripe.com' }, { domain: 'stripe.com' }];
        await run({ input: { searches, full: false, webhookUrl: ' ', maxConcurrency: 1 }, endpoint: server.url });
        await run({
            input: { searches, full: true, webhookUrl: 'https://hooks.example.com/tomba', maxConcurrency: 1 },
            endpoint: server.url,
        });

        assert.deepEqual(
            server.requests.map((r) => r.query),
            [
                { email: 'jane.doe@stripe.com' },
                { domain: 'stripe.com' },
                { email: 'jane.doe@stripe.com', full: 'true', webhook_url: 'https://hooks.example.com/tomba' },
                { domain: 'stripe.com', full: 'true', webhook_url: 'https://hooks.example.com/tomba' },
            ],
        );
    });

    it('keeps the same credits when full is set', async () => {
        const server = await mock();
        const result = await run({
            input: { searches: [{ email: 'jane.doe@stripe.com' }, { domain: 'stripe.com' }], full: true },
            endpoint: server.url,
        });
        assert.deepEqual(result.chargeCounts, { 'tomba-request': 6 });
    });

    it('runs requests in parallel', async () => {
        let active = 0;
        let peak = 0;
        const server = await mock(async (req) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => {
                setTimeout(r, 100);
            });
            active--;
            return tomba(req);
        });
        const searches = Array.from({ length: 8 }, (_, i) => ({ email: `person${i}@acme.com` }));
        await run({ input: { searches, maxConcurrency: 4 }, endpoint: server.url });
        assert.equal(server.requests.length, 8);
        assert.ok(peak > 1 && peak <= 4, `peak concurrency ${peak}`);
    });

    it('fails without Tomba credentials and never calls the API', async () => {
        const server = await mock();
        const result = await run({
            input: { searches: [{ email: 'jane.doe@stripe.com' }] },
            endpoint: server.url,
            withCredentials: false,
        });
        assert.notEqual(result.code, 0);
        assert.match(result.output, /misconfigured/);
        assert.doesNotMatch(result.output, /ta_test_key|ts_test_secret/);
        assert.equal(server.requests.length, 0);
    });

    it('fails on empty input', async () => {
        const server = await mock();
        const result = await run({ input: { searches: [] }, endpoint: server.url });
        assert.notEqual(result.code, 0);
        assert.equal(server.requests.length, 0);
    });

    it('fails when searches is missing', async () => {
        const server = await mock();
        const result = await run({ input: {}, endpoint: server.url });
        assert.notEqual(result.code, 0);
        assert.equal(server.requests.length, 0);
    });
});

describe('phone-finder standby (real-time API)', () => {
    it('answers the readiness probe and a bare GET with usage info', async () => {
        const server = await mock();
        const actor = await startStandbyActor({ endpoint: server.url });
        try {
            const probe = await actor.call('/', { headers: { 'x-apify-container-server-readiness-probe': '1' } });
            assert.equal(probe.status, 200);
            const usage = await actor.call('/');
            assert.equal(usage.status, 200);
            assert.match(String(usage.body.usage), /GET/);
            assert.equal(server.requests.length, 0);
        } finally {
            await actor.stop();
        }
    });

    it('runs one search from GET query parameters and charges 1 credit with a domain', async () => {
        const server = await mock();
        const actor = await startStandbyActor({ endpoint: server.url });
        let stopped;
        try {
            const res = await actor.call('/?email=Jane.Doe@Stripe.com&domain=https://www.stripe.com/&full=true');
            assert.equal(res.status, 200);
            const items = res.body.items as Record<string, unknown>[];
            assert.equal(items.length, 1);
            assert.equal(items[0].e164_format, PHONE.e164_format);
            assert.equal(items[0].chargedCredits, 1);
            assert.deepEqual(server.requests[0].query, {
                email: 'jane.doe@stripe.com',
                domain: 'stripe.com',
                full: 'true',
            });
        } finally {
            stopped = await actor.stop();
        }
        assert.deepEqual(stopped.chargeCounts, { 'tomba-request': 1 });
    });

    it('charges 5 credits for a GET search by email or LinkedIn only', async () => {
        const server = await mock();
        const actor = await startStandbyActor({ endpoint: server.url });
        let stopped;
        try {
            const res = await actor.call(`/?linkedin=${encodeURIComponent(LINKEDIN)}`);
            assert.equal(res.status, 200);
            const items = res.body.items as Record<string, unknown>[];
            assert.equal(items[0].chargedCredits, 5);
            assert.deepEqual(items[0].source, { search_type: 'linkedin', search_value: LINKEDIN });
        } finally {
            stopped = await actor.stop();
        }
        assert.deepEqual(stopped.chargeCounts, { 'tomba-request': 5 });
    });

    it('accepts a POST with the same JSON input as a normal run', async () => {
        const server = await mock();
        const actor = await startStandbyActor({ endpoint: server.url });
        let stopped;
        try {
            const res = await actor.call('/', {
                body: { searches: [{ domain: 'stripe.com' }, { email: 'nobody@stripe.com' }] },
            });
            assert.equal(res.status, 200);
            const items = res.body.items as Record<string, unknown>[];
            assert.equal(items.length, 2);
            assert.equal(items.find((i) => i.email === 'nobody@stripe.com')?.error, 'No phone number found');
        } finally {
            stopped = await actor.stop();
        }
        assert.deepEqual(stopped.chargeCounts, { 'tomba-request': 1 });
    });

    it('serves repeated requests from the cache for free', async () => {
        const server = await mock();
        const actor = await startStandbyActor({ endpoint: server.url });
        let stopped;
        try {
            await actor.call('/?domain=stripe.com');
            const second = await actor.call('/?domain=stripe.com');
            assert.ok((second.body.items as Record<string, unknown>[]).every((i) => i.cached === true));
            assert.equal(server.requests.length, 1);
        } finally {
            stopped = await actor.stop();
        }
        assert.deepEqual(stopped.chargeCounts, { 'tomba-request': 1 });
    });

    it('keeps serving after a request hits maxResults', async () => {
        const server = await mock();
        const actor = await startStandbyActor({ endpoint: server.url });
        try {
            const first = await actor.call('/?domain=a.com&maxResults=1');
            assert.equal((first.body.items as unknown[]).length, 1);
            const second = await actor.call('/?domain=b.com&maxResults=1');
            assert.equal(second.status, 200);
            assert.equal((second.body.items as unknown[]).length, 1);
            const third = await actor.call('/', { body: { searches: [{ domain: 'c.com' }, { domain: 'd.com' }] } });
            assert.equal((third.body.items as unknown[]).length, 2);
            assert.equal(server.requests.length, 4);
        } finally {
            await actor.stop();
        }
    });

    it('rejects invalid input with 400 and unknown paths with 404', async () => {
        const server = await mock();
        const actor = await startStandbyActor({ endpoint: server.url });
        try {
            assert.equal((await actor.call('/', { body: {} })).status, 400);
            assert.equal((await actor.call('/', { body: 'not json' })).status, 400);
            assert.equal((await actor.call('/?full=true')).status, 400);
            assert.equal((await actor.call('/?domain=a.com&maxResults=abc')).status, 400);
            assert.equal((await actor.call('/?domain=a.com&full=maybe')).status, 400);
            assert.equal((await actor.call('/nope')).status, 404);
            assert.equal((await actor.call('/', { method: 'DELETE' })).status, 405);
            assert.equal(server.requests.length, 0);
        } finally {
            await actor.stop();
        }
    });

    it('returns 402 once the max charge limit is reached', async () => {
        const server = await mock();
        // An email search costs 5 events: a $5 budget allows exactly one.
        const actor = await startStandbyActor({ endpoint: server.url, maxTotalChargeUsd: 5 });
        let stopped;
        try {
            const first = await actor.call('/?email=a@acme.com');
            assert.equal(first.status, 200);
            assert.equal((first.body.items as Record<string, unknown>[])[0].chargedCredits, 5);
            const second = await actor.call('/?email=b@acme.com');
            assert.equal(second.status, 402);
            assert.equal(server.requests.length, 1);
        } finally {
            stopped = await actor.stop();
        }
        assert.deepEqual(stopped.chargeCounts, { 'tomba-request': 5 });
    });
});
