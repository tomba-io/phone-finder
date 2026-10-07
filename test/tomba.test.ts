// Unit tests for src/tomba.ts. Keep this file identical across all Actors.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

process.env.CRAWLEE_STORAGE_DIR = await mkdtemp(join(tmpdir(), 'tomba-unit-'));
process.env.ACTOR_TEST_PAY_PER_EVENT = 'true';
process.env.TOMBA_API_KEY = 'ta_unit';
process.env.TOMBA_API_SECRET = 'ts_unit';

const { Actor } = await import('apify');
const { TombaException } = await import('tomba');
const T = await import('../src/tomba.js');

const ok = (body: unknown) => async () => ({ data: body, rateLimit: {} });
const httpError = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    new TombaException('error', { status, headers }, body);
const charged = (event = T.EVENT_REQUEST) => Actor.getChargingManager().getChargedEventCount(event);

let seq = 0;
const params = () => ({ n: ++seq });

before(async () => {
    await Actor.init();
    await T.setupTomba({ maxRetries: 1, useCache: true, cacheTtlHours: 1, maxConcurrency: 4 });
});

after(async () => {
    await Actor.exit({ exit: false });
});

describe('isBillable', () => {
    const cases: [string, unknown, boolean][] = [
        ['data array', { data: [{ a: 1 }] }, true],
        ['data object', { data: { email: 'a@b.co' } }, true],
        ['negative answer (object with empty list)', { data: { organization: {}, emails: [] } }, true],
        ['negative answer (undeliverable)', { data: { email: { status: 'invalid' } } }, true],
        ['empty array', { data: [] }, false],
        ['empty object', { data: {} }, false],
        ['object with only null values', { data: { person: null, company: null } }, false],
        ['negative answer (email null, other fields set)', { data: { email: null, first_name: 'John' } }, true],
        ['null data', { data: null }, false],
        ['missing data', { meta: {} }, false],
        ['errors object', { data: { a: 1 }, errors: { message: 'x' } }, false],
        ['string body', '<html>', false],
        ['null body', null, false],
        ['array body', [1, 2], false],
    ];
    for (const [name, body, expected] of cases) {
        it(name, () => assert.equal(T.isBillable(body), expected));
    }
});

describe('normalizers', () => {
    it('normalizeDomain strips protocol, www, path and case', () => {
        assert.equal(T.normalizeDomain(' https://www.Stripe.com/about?x=1 '), 'stripe.com');
        assert.equal(T.normalizeDomain('http://tomba.io'), 'tomba.io');
        assert.equal(T.normalizeDomain('sub.example.org'), 'sub.example.org');
    });

    it('normalizeEmail trims and lowercases', () => {
        assert.equal(T.normalizeEmail('  John@Stripe.COM '), 'john@stripe.com');
    });

    it('unique keeps first occurrence and drops empty keys', () => {
        assert.deepEqual(T.unique(['a', 'b', 'a', '', 'c']), ['a', 'b', 'c']);
        assert.deepEqual(
            T.unique([{ id: 1 }, { id: 2 }, { id: 1 }], (x) => String(x.id)),
            [{ id: 1 }, { id: 2 }],
        );
    });
});

describe('phone data', () => {
    it('counts phone numbers in phone_data', () => {
        assert.equal(T.phoneDataCount({ phone_data: [{ number: '+1' }, { number: '+2' }] }), 2);
        assert.equal(T.phoneDataCount({ phone_data: [] }), 0);
        assert.equal(T.phoneDataCount({ phone_number: true }), 0);
        assert.equal(T.phoneDataCount(null), 0);
        assert.equal(T.phoneDataCount('x'), 0);
    });

    it('detects records with phone data', () => {
        assert.equal(T.hasPhoneData({ phone_data: [{ number: '+1' }] }), true);
        assert.equal(T.hasPhoneData({ phone_data: [] }), false);
        assert.equal(T.hasPhoneData({}), false);
    });

    it('prices phone data at 5 credits', () => {
        assert.equal(T.PHONE_CREDITS, 5);
    });
});

describe('runPool', () => {
    it('processes every item with bounded concurrency', async () => {
        let active = 0;
        let peak = 0;
        const seen: number[] = [];
        await T.runPool(
            Array.from({ length: 20 }, (_, i) => i),
            async (item) => {
                active++;
                peak = Math.max(peak, active);
                await new Promise((r) => {
                    setTimeout(r, 5);
                });
                seen.push(item);
                active--;
            },
            3,
        );
        assert.equal(seen.length, 20);
        assert.deepEqual(
            [...seen].sort((a, b) => a - b),
            Array.from({ length: 20 }, (_, i) => i),
        );
        assert.ok(peak <= 3, `peak concurrency ${peak}`);
    });

    it('handles an empty list', async () => {
        await T.runPool([], async () => assert.fail('should not run'));
    });
});

describe('callTomba', () => {
    it('charges a response with data and unwraps the SDK { data, rateLimit } shape', async () => {
        const start = charged();
        const res = await T.callTomba('test', params(), ok({ data: [{ name: 'React' }] }));
        assert.equal(res.status, 200);
        assert.equal(res.charged, true);
        assert.equal(res.cached, false);
        assert.deepEqual(res.data, [{ name: 'React' }]);
        assert.equal(charged(), start + 1);
    });

    it('accepts an SDK that returns the body directly', async () => {
        const res = await T.callTomba('test', params(), async () => ({ data: { x: 1 } }));
        assert.equal(res.charged, true);
        assert.deepEqual(res.data, { x: 1 });
    });

    it('charges a negative answer', async () => {
        const res = await T.callTomba('test', params(), ok({ data: { organization: {}, emails: [] } }));
        assert.equal(res.charged, true);
    });

    it('serves a repeated request from cache without charging', async () => {
        const p = params();
        let calls = 0;
        const fn = async () => {
            calls++;
            return { data: { data: { v: 1 } }, rateLimit: {} };
        };
        await T.callTomba('test', p, fn);
        const start = charged();
        const res = await T.callTomba('test', { ...p }, fn);
        assert.equal(res.cached, true);
        assert.equal(res.charged, false);
        assert.deepEqual(res.data, { v: 1 });
        assert.equal(calls, 1);
        assert.equal(charged(), start);
    });

    it('uses a different cache entry for different params or endpoints', async () => {
        const p = params();
        await T.callTomba('a', p, ok({ data: [1] }));
        const other = await T.callTomba('b', p, ok({ data: [2] }));
        assert.equal(other.cached, false);
        assert.deepEqual(other.data, [2]);
    });

    it('does not charge or cache empty data', async () => {
        const p = params();
        const start = charged();
        const res = await T.callTomba('test', p, ok({ data: [] }));
        assert.equal(res.charged, false);
        assert.equal(res.status, 200);
        const again = await T.callTomba('test', p, ok({ data: [] }));
        assert.equal(again.cached, false);
        assert.equal(charged(), start);
    });

    it('does not charge a success with an errors object', async () => {
        const res = await T.callTomba('test', params(), ok({ data: { a: 1 }, errors: { message: 'Bad thing' } }));
        assert.equal(res.charged, false);
        assert.equal(res.error, 'Bad thing');
    });

    it('reports a non-JSON body as 502 without charging', async () => {
        const res = await T.callTomba('test', params(), ok('<html>oops</html>'));
        assert.equal(res.status, 502);
        assert.equal(res.charged, false);
    });

    it('does not retry or charge a 422', async () => {
        let calls = 0;
        const res = await T.callTomba('test', params(), async () => {
            calls++;
            throw httpError(422, { errors: { message: 'Invalid domain' } });
        });
        assert.equal(calls, 1);
        assert.equal(res.status, 422);
        assert.equal(res.charged, false);
        assert.match(res.error ?? '', /Invalid domain/);
    });

    it('does not retry SDK input validation errors', async () => {
        let calls = 0;
        const res = await T.callTomba('test', params(), async () => {
            calls++;
            throw new TombaException('Domain is required.');
        });
        assert.equal(calls, 1);
        assert.equal(res.status, 400);
        assert.equal(res.charged, false);
    });

    it('retries a 429 honoring Retry-After, then charges the success', async () => {
        let calls = 0;
        const res = await T.callTomba('test', params(), async () => {
            calls++;
            if (calls === 1) throw httpError(429, {}, { 'retry-after': '1' });
            return { data: { data: { ok: true } }, rateLimit: {} };
        });
        assert.equal(calls, 2);
        assert.equal(res.charged, true);
    });

    it('retries network errors', async () => {
        let calls = 0;
        const res = await T.callTomba('test', params(), async () => {
            calls++;
            if (calls === 1) throw new TombaException('connect ECONNREFUSED 127.0.0.1:9');
            return { data: { data: [1] }, rateLimit: {} };
        });
        assert.equal(calls, 2);
        assert.equal(res.charged, true);
    });

    it('gives up after maxRetries on 5xx without charging', async () => {
        let calls = 0;
        const res = await T.callTomba('test', params(), async () => {
            calls++;
            throw httpError(503);
        });
        assert.equal(calls, 2); // 1 attempt + maxRetries (1)
        assert.equal(res.status, 503);
        assert.equal(res.charged, false);
    });

    it('charges the given event name', async () => {
        const start = charged(T.EVENT_PHONE_FINDER);
        await T.callTomba('phone', params(), ok({ data: { phone: '+1' } }), T.EVENT_PHONE_FINDER);
        assert.equal(charged(T.EVENT_PHONE_FINDER), start + 1);
    });

    it('charges a fixed count of events', async () => {
        const start = charged();
        const res = await T.callTomba('test', params(), ok({ data: [1] }), T.EVENT_REQUEST, 3);
        assert.equal(res.chargedCount, 3);
        assert.equal(charged(), start + 3);
    });

    it('charges a count computed from the response body', async () => {
        const start = charged();
        const res = await T.callTomba(
            'test',
            params(),
            ok({ data: { items: [1, 2, 3, 4] } }),
            T.EVENT_REQUEST,
            (body) => (body.data as { items: unknown[] }).items.length,
        );
        assert.equal(res.chargedCount, 4);
        assert.equal(charged(), start + 4);
    });

    it('does not charge a count for a non-billable response', async () => {
        const start = charged();
        const res = await T.callTomba('test', params(), ok({ data: [] }), T.EVENT_REQUEST, 5);
        assert.equal(res.charged, false);
        assert.equal(charged(), start);
    });

    it('tracks stats', () => {
        assert.ok(T.stats.requests > 0);
        assert.ok(T.stats.charged > 0);
        assert.ok(T.stats.cached > 0);
        assert.ok(T.stats.retries > 0);
        assert.ok(T.stats.failed > 0);
    });
});
