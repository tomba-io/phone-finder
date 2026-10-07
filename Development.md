# Development

Notes for maintainers of the Tomba Phone Finder Actor. The README is the end-user page shown on Apify Store.

## Requirements

- Node.js 20+
- [Apify CLI](https://docs.apify.com/cli) for deployment

## Scripts

```bash
npm install
npm run build     # compile TypeScript to dist/
npm run lint      # ESLint (src and test)
npm run format    # Prettier
npm test          # unit + end-to-end tests (node:test)
npm start         # run locally with tsx
```

## Credentials

The Actor uses our Tomba account. Users never enter an API key: credentials come from environment variables, never from the input:

| Variable             | Description                                        |
| -------------------- | -------------------------------------------------- |
| `TOMBA_API_KEY`      | Tomba API key (`ta_…`)                             |
| `TOMBA_API_SECRET`   | Tomba secret (`ts_…`)                              |
| `TOMBA_API_ENDPOINT` | Optional API base URL; only used by the test suite |

`.actor/actor.json` maps the variables to Apify secrets:

```bash
apify secrets add tombaApiKey ta_xxxxxxxxxxxxxxxxxxxx
apify secrets add tombaApiSecret ts_xxxxxxxxxxxxxxxxxxxx
apify push
```

Run locally:

```bash
TOMBA_API_KEY=ta_… TOMBA_API_SECRET=ts_… npm start
```

There is no client-side rate limit: requests run in parallel (`maxConcurrency`, 1–50) and 429/5xx responses are retried with exponential backoff, honoring `Retry-After`.

## Deploy

- **From Git**: on the [Actor creation page](https://console.apify.com/actors/new), click **Link Git Repository**
- **From your machine**: `apify login`, then `apify push`

## Pricing (pay per event)

In **Apify Console → Publication → Monetization**, choose **Pay per event** and add a single event:

| Event           | Price    | Charged when                                       |
| --------------- | -------- | -------------------------------------------------- |
| `tomba-request` | $0.00312 | Once per credit of a billable response (see below) |

Phone Finder costs credits (Tomba: "5 search credits, or 1 when the request includes domain"), charged as `tomba-request` events with `count`:

- 1 credit when the search includes a `domain` (alone or with `email`/`linkedin`)
- 5 credits (`PHONE_CREDITS`, $0.0156) for an `email` or `linkedin` search without a `domain`

`searchCredits()` in `src/main.ts` computes this and passes it to `callTomba()` as the charge count; the item's `chargedCredits` is `res.chargedCount`. The `full` option does not change the price. The former `phone-finder-request` event is no longer used and can be removed from the pricing configuration.

`isBillable()` in `src/tomba.ts` mirrors Tomba's billing:

| Tomba outcome                                                | Charged |
| ------------------------------------------------------------ | ------- |
| JSON with non-empty `data`, including `valid: false` numbers | Yes     |
| Error status (4xx, 5xx, including 422 and 429)               | No      |
| Success with empty or null `data` (no number on record)      | No      |
| Success with an `errors` object                              | No      |
| Non-JSON body (reported as 502)                              | No      |
| Cache hit                                                    | No      |

## Architecture

- `src/tomba.ts`: shared helper, identical in every Tomba Actor. It handles credentials, caching (`tomba-cache` key-value store), retries with exponential backoff, pay-per-event charging, budget reservation, the concurrency pool and resume state.
- `src/main.ts`: input normalization (emails lowercased, domains cleaned, LinkedIn URLs trimmed, empty searches skipped, duplicates removed), credit calculation and output mapping. The Tomba `data` object is spread into the row, followed by `source`, `chargedCredits`, `charged`, `cached` and `error`. `maxResults` counts valid numbers only.
- The SDK call is `Phone.finder({ email, domain, linkedin, full, webhook_url })` → `GET /phone-finder`. The global `full` and `webhookUrl` inputs are added to every search, but only when set (`full` true, `webhookUrl` non-blank); they are part of the cache key.
- The `tomba` SDK v1.1.1 resolves every call to `{ data, rateLimit }`, where `data` is the response body. Its `.d.ts` types still declare the old return type, so always go through `callTomba()`.

## Tests

- `test/tomba.test.ts`: unit tests for the shared helper (identical in every Actor)
- `test/main.test.ts`: end-to-end tests that run `src/main.ts` against a local mock Tomba API
- `test/helpers.ts`: mock server and Actor runner (identical in every Actor)

Locally, the Apify SDK prices every event at $1 when `ACTOR_TEST_PAY_PER_EVENT=true`, so the tests use `maxTotalChargeUsd` as an event count.
