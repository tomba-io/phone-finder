# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## 1.0.0 (2026-10-07)

### ⚠ BREAKING CHANGES

- `tombaApiKey` and `tombaApiSecret` inputs were removed. The Actor now uses built-in Tomba credentials from the `TOMBA_API_KEY` / `TOMBA_API_SECRET` environment variables, so users no longer need a Tomba account.

### Features

- Pay-per-event pricing in credits of $0.00312 (`tomba-request`), following Tomba's rule: 1 credit for any search that includes a `domain`, otherwise 5 credits ($0.0156) for an email or LinkedIn search; errors, empty results and cache hits are free. Only one event (`tomba-request`) needs to be configured
- New `full` and `webhookUrl` inputs, sent to Tomba on every search as `full` and `webhook_url`
- Each item includes `chargedCredits`
- No client-side rate limit; parallel processing with `maxConcurrency`
- Automatic retries with exponential backoff for network errors, 429 and 5xx (`maxRetries`)
- Cross-run result cache (`useCache`, `cacheTtlHours`)
- Resume after migration or restart
- Search queries are normalized and deduplicated
- Each dataset item now includes `charged` and `cached`
- Searches without a valid phone number, and failed searches, now produce a dataset item with `error` instead of being dropped

### Dependencies

- `tomba` upgraded to 1.1.1 (responses are now `{ data, rateLimit }`)
- `apify` upgraded to 3.7.2

### 0.0.2 (2025-10-20)
