# Tomba Phone Finder

[![Price](https://img.shields.io/badge/Price-from%20%243.12%20per%201K%20searches-brightgreen)](#pricing)
[![No signup](https://img.shields.io/badge/Tomba%20account-not%20needed-blue)](#quick-start)
[![No rate limit](https://img.shields.io/badge/Rate%20limit-none-brightgreen)](#built-for-big-lists)

**Turn an email address, a LinkedIn profile or a company domain into a phone number.** Paste your list and get phone numbers in every format you need (local, international, E.164 and click-to-call), along with the line type, carrier, country and time zone.

No Tomba account. No API key. No subscription. **You pay $0.00312 per search that includes a company domain and $0.0156 per email or LinkedIn search without one, and only when we find a number.**

## Why teams choose this Actor

- **Start in 30 seconds**: Open the Actor, paste your contacts, click Start. Nothing to sign up for
- **Pay only for results**: Searches with no number on record, errors and invalid inputs are free
- **Three ways to search**: Find a number from an email address, a LinkedIn profile URL or a company domain
- **Add the domain, pay 5x less**: Any search that includes the company domain costs a single credit ($0.00312)
- **Ready to dial**: Every number comes in local, international, E.164 and `tel:` formats
- **Call at the right time**: Each number includes its country and time zone, plus the line type and carrier
- **Built for big lists**: No rate limit. Thousands of searches run in parallel
- **Never pay twice**: Searches you ran in the last 24 hours come back from cache for free
- **Export anywhere**: Download as CSV, Excel or JSON, or send results straight to your CRM with Apify integrations

## What you can do with it

| Goal                     | How phone numbers help                                            |
| ------------------------ | ----------------------------------------------------------------- |
| **Book more meetings**   | Call the prospects who never answer your emails                   |
| **Enrich your CRM**      | Add a direct phone number to every contact that only has an email |
| **Reach candidates**     | Go from a LinkedIn profile to a phone number in one step          |
| **Contact a company**    | Get the main phone line of any company from its domain            |
| **Prioritize your list** | Sort by line type and call each region during its business hours  |

## Quick start

1. Click **Try for free**
2. Add your searches to **Search Queries**, for example `{ "email": "john@stripe.com" }` or `{ "linkedin": "https://www.linkedin.com/in/johndoe" }`
3. Click **Start**, then download your results as CSV, Excel or JSON

That's it. No Tomba account or API key is needed.

## Input

| Field            | Required | Default | Description                                                                      |
| ---------------- | -------- | ------- | -------------------------------------------------------------------------------- |
| `searches`       | Yes      |         | Searches to run. Each one has an `email`, a `linkedin` profile URL or a `domain` |
| `maxResults`     | No       | `50`    | Stop after this many valid phone numbers have been found                         |
| `full`           | No       | `false` | Ask Tomba for the full phone record of every search (same price)                 |
| `webhookUrl`     | No       |         | Your own `http(s)://` URL that Tomba also sends each result to                   |
| `maxConcurrency` | No       | `10`    | How many searches to run at the same time (1–50)                                 |
| `maxRetries`     | No       | `3`     | How many times to retry a temporary failure (0–10)                               |
| `useCache`       | No       | `true`  | Reuse results from your previous runs for free                                   |
| `cacheTtlHours`  | No       | `24`    | How long cached results stay valid (`0` turns the cache off)                     |

Each search can use any of these fields:

| Search field | Example                               | What you get                         |
| ------------ | ------------------------------------- | ------------------------------------ |
| `email`      | `john@stripe.com`                     | The phone number of that person      |
| `linkedin`   | `https://www.linkedin.com/in/johndoe` | The phone number of that person      |
| `domain`     | `stripe.com`                          | The main phone number of the company |

Any search that includes a `domain` costs 1 credit ($0.00312), even with an `email` or `linkedin`. An `email` or `linkedin` search without a `domain` costs 5 credits ($0.0156).

```json
{
    "searches": [
        { "email": "john@stripe.com" },
        { "linkedin": "https://www.linkedin.com/in/johndoe" },
        { "email": "jane@shopify.com", "domain": "shopify.com" },
        { "domain": "shopify.com" }
    ],
    "maxResults": 500
}
```

## Output

You get one row per search:

```json
{
    "email": "jane.doe@stripe.com",
    "domain": "stripe.com",
    "linkedin": null,
    "valid": true,
    "local_format": "(415) 555-0132",
    "intl_format": "+1 415-555-0132",
    "e164_format": "+14155550132",
    "rfc3966_format": "tel:+1-415-555-0132",
    "country_code": "US",
    "line_type": "MOBILE",
    "carrier": "AT&T",
    "region": { "name": "California", "code": "CA" },
    "timezones": ["America/Los_Angeles"],
    "source": { "search_type": "email", "search_value": "jane.doe@stripe.com" },
    "chargedCredits": 5,
    "charged": true,
    "cached": false
}
```

| Field            | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `email`          | The email address searched, or the one linked to the number    |
| `domain`         | The company domain                                             |
| `linkedin`       | The LinkedIn profile searched                                  |
| `valid`          | `true` if the number is a valid phone number                   |
| `local_format`   | The number as dialed inside its country, e.g. `(415) 555-0132` |
| `intl_format`    | The number in international format, e.g. `+1 415-555-0132`     |
| `e164_format`    | The number in E.164 format, ideal for dialers and CRMs         |
| `rfc3966_format` | Click-to-call link, e.g. `tel:+1-415-555-0132`                 |
| `country_code`   | Country of the number, e.g. `US`                               |
| `line_type`      | Type of line, e.g. `MOBILE` or `FIXED_LINE`                    |
| `carrier`        | The phone carrier                                              |
| `region`         | Region of the number (name and code), when available           |
| `timezones`      | Time zones of the number                                       |
| `source`         | Which search found it: `search_type` and `search_value`        |
| `chargedCredits` | Credits billed for this search ($0.00312 each)                 |
| `charged`        | `true` if this search was billed                               |
| `cached`         | `true` if this result came from the cache (free)               |
| `error`          | Why no valid number was returned, if applicable                |

The dataset has two ready-made views: **Overview** and **Detailed View**.

## Pricing

**One credit costs $0.00312.** Tomba's credit rule: **5 credits per search, or 1 when the search includes a domain.**

| Search                                                                  | Credits | Price per search | Per 1,000 searches |
| ----------------------------------------------------------------------- | ------- | ---------------- | ------------------ |
| Any search with a `domain` (alone or with an email or LinkedIn profile) | 1       | $0.00312         | $3.12              |
| By email address, without a domain                                      | 5       | $0.0156          | $15.60             |
| By LinkedIn profile, without a domain                                   | 5       | $0.0156          | $15.60             |

Tip: if you already know the company domain of your contacts, add it to each search to pay 5 times less.

No subscription and no Tomba account needed. You are only charged when a phone record is found:

| What happens                                    | Charged |
| ----------------------------------------------- | ------- |
| A phone number is found                         | Yes     |
| A number is on record but flagged as not valid  | Yes     |
| No phone number on record for the search        | No      |
| Invalid search or any other error               | No      |
| Temporary failure (it is retried automatically) | No      |
| Result served from the cache                    | No      |

Every row shows `chargedCredits`, `charged` and `cached`, so you always know what you paid for. To cap your spend, set **Maximum cost per run** in the run options: the Actor stops cleanly when the limit is reached.

## Built for big lists

- **No rate limit**: up to 50 searches are processed at the same time
- **Automatic retries**: temporary failures are retried for you, and never billed
- **Resumable**: if a run is interrupted, it continues where it stopped without charging you again
- **Cache**: repeat searches within 24 hours are free
- **Clean input**: emails and domains in any format are cleaned up, and duplicate searches are removed

## Integrations

Run it on a schedule, call it from the Apify API, or connect it to Zapier, Make, Google Sheets, HubSpot, Slack and hundreds of other apps with [Apify integrations](https://docs.apify.com/platform/integrations). Webhooks let you trigger your own workflow as soon as a run finishes.

## FAQ

**Do I need a Tomba account or API key?**
No. Everything is built in. You only pay the per-search price on Apify.

**How much does it cost?**
$0.00312 per search that includes a company domain ($3.12 per 1,000) and $0.0156 per email or LinkedIn search without a domain ($15.60 per 1,000). You pay only when a phone record is found. Searches with no number, errors and cached lookups are free.

**Which search should I use?**
Use an email address or a LinkedIn profile to reach a specific person, and add the company `domain` when you know it: the search then costs 1 credit instead of 5. Use a domain on its own to get a company's main phone line.

**How many searches can I run at once?**
Paste your whole list: searches run in parallel and there is no rate limit. Use **Maximum results** to stop after a given number of phone numbers (up to 1,000 per run).

**What format should my input use?**
Emails and domains can be in any case, and domains can be full URLs like `https://www.stripe.com/contact`. LinkedIn searches take the profile URL. Duplicate searches are removed automatically.

**Why didn't I get a number for some contacts?**
Not everyone has a phone number on record. Those searches are free, and the row tells you no number was found.

**Do I get mobile numbers?**
Yes, when one is on record. Every result shows the line type, so you can tell mobile numbers from landlines.

**What does "Full phone record" do?**
It asks Tomba for everything it has stored about the number for each search. It applies to the whole run and does not change the price.

**What if my run is interrupted?**
It picks up where it stopped. Searches already processed are not charged again.

**How do I limit what I spend?**
Set **Maximum cost per run** before you start. The Actor stops as soon as the limit is reached.

**Can I call these numbers for sales?**
Yes, but follow the telemarketing rules of the countries you call (such as Do Not Call registries) and respect people's preferences.

## Support

Questions or feedback? We're happy to help:

- **Email**: support@tomba.io
- **Live chat**: on [tomba.io](https://tomba.io) during business hours
- **Issues**: use the **Issues** tab on this Actor's page

## About Tomba

Founded in 2020, [Tomba](https://tomba.io) is a B2B data platform for finding, verifying and enriching business contacts. Our Email Finder, Domain Search and Email Verifier help sales and marketing teams reach the right people.

![Tomba Logo](https://tomba.io/logo.png)
