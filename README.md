# Tomba Phone Finder Actor

[![Actor](https://img.shields.io/badge/Apify-Actor-blue)](https://apify.com/actors)
[![Tomba API](https://img.shields.io/badge/Tomba-API-green)](https://tomba.io)
[![Rate Limit](https://img.shields.io/badge/Rate%20Limit-150%2Fmin-orange)](https://tomba.io/api)

A powerful Apify Actor that discovers phone numbers using the **Tomba Phone Finder API**. Perfect for sales teams, recruiters, and researchers who need to find phone numbers associated with email addresses, domains, or LinkedIn profiles.

## Key Features

- **Phone Discovery**: Find phone numbers using email addresses, domains, or LinkedIn profiles
- **Multiple Search Methods**: Support for email, domain, and LinkedIn-based searches
- **Phone Validation**: Get validation status for discovered phone numbers
- **Carrier Information**: Identify phone carriers and line types
- **International Support**: Handle phone numbers from multiple countries
- **Rate Limited**: Respects Tomba's 150 requests per minute limit
- **Bulk Processing**: Process multiple search queries efficiently
- **Detailed Formatting**: Get phone numbers in both national and international formats

## How it works

The Actor leverages Tomba's powerful Phone Finder API to discover phone numbers:

### What You Get

For each discovered phone number, you'll receive:

- **Phone Number**: The actual phone number discovered
- **Validation**: Whether the number is valid
- **Formatting**: National and international formats
- **Carrier Info**: Phone carrier and line type
- **Location**: Country and country code
- **Source Tracking**: Which search query led to this discovery

## Quick Start

### Prerequisites

1. **Tomba Account**: Sign up at [Tomba.io](https://app.tomba.io/api) to get your API credentials

### Getting Your API Keys

1. Visit [Tomba API Dashboard](https://app.tomba.io/api)
2. Copy your **API Key** (starts with `ta_`)
3. Copy your **Secret Key** (starts with `ts_`)

## Input Configuration

### Required Parameters

| Parameter        | Type     | Description                     |
| ---------------- | -------- | ------------------------------- |
| `tombaApiKey`    | `string` | Your Tomba API key (ta_xxxx)    |
| `tombaApiSecret` | `string` | Your Tomba secret key (ts_xxxx) |
| `searches`       | `array`  | Array of search queries         |

### Optional Parameters

| Parameter    | Type     | Default | Description                         |
| ------------ | -------- | ------- | ----------------------------------- |
| `maxResults` | `number` | `50`    | Maximum number of results to return |

### Search Query Structure

Each search query can contain one or more of:

```json
{
    "email": "john@example.com", // Find phone for this email
    "domain": "example.com", // Find phones for this domain
    "linkedin": "https://linkedin.com/in/johndoe" // Find phone for LinkedIn profile
}
```

### Example Input

```json
{
    "tombaApiKey": "ta_xxxxxxxxxxxxxxxxxxxx",
    "tombaApiSecret": "ts_xxxxxxxxxxxxxxxxxxxx",
    "searches": [
        {
            "email": "john@example.com"
        },
        {
            "domain": "shopify.com"
        },
        {
            "linkedin": "https://linkedin.com/in/johndoe"
        }
    ],
    "maxResults": 100
}
```

### Best Practices

- **Search Variety**: Use different search methods (email, domain, LinkedIn) for better coverage
- **Rate Limits**: The Actor automatically handles Tomba's 150 requests/minute limit
- **Batch Size**: Process 10-50 queries at a time for optimal performance

## Output Data Structure

The Actor returns detailed phone number information for each successful search:

### Example Output

```json
{
    "email": "john@example.com",
    "domain": "example.com",
    "linkedin": "https://linkedin.com/in/johndoe",
    "valid": true,
    "local_format": "(555) 123-4567",
    "intl_format": "+1 555 123 4567",
    "e164_format": "+15551234567",
    "rfc3966_format": "tel:+1-555-123-4567",
    "country_code": "US",
    "line_type": "mobile",
    "carrier": "Verizon Wireless",
    "timezones": ["America/New_York"],
    "source": {
        "search_type": "email",
        "search_value": "john@example.com"
    }
}
```

### Data Fields Explained

- **Email/Domain/LinkedIn**: Associated identifiers for the phone number
- **Valid**: Boolean indicating if the phone number is valid
- **Formatting Options**: Phone number in various standard formats
    - `local_format`: Local/national format (e.g., "(555) 123-4567")
    - `intl_format`: International format (e.g., "+1 555 123 4567")
    - `e164_format`: E.164 standard format (e.g., "+15551234567")
    - `rfc3966_format`: RFC3966 URI format (e.g., "tel:+1-555-123-4567")
- **Location Info**: Country code and timezone information
- **Carrier Details**: Phone carrier and line type (mobile, landline, etc.)
- **Source Tracking**: Which search method and value led to this discovery

## Use Cases

- **Sales Outreach**: Find phone numbers for email contacts in your CRM
- **Recruitment**: Contact candidates via phone using their LinkedIn profiles
- **Lead Generation**: Discover phone numbers for domain-based prospecting
- **Contact Enrichment**: Add phone numbers to existing contact databases
- **Verification**: Validate phone numbers associated with email addresses

## Support

If you need any help, have questions, or encounter any issues while using Tomba.io, please don't hesitate to reach out to our support team. You can contact us via:

- **Email**: support@tomba.io
- **Live chat**: Available on the Tomba.io website during business hours

## Contributing

We welcome contributions to improve this actor. Please feel free to submit issues, feature requests, or pull requests to help make this tool even better for the community.

## About Tomba

Founded in 2020, Tomba prides itself on being the most reliable, accurate, and in-depth source of email address data available anywhere. We process terabytes of data to produce our Email finder API.

![Tomba Logo](https://tomba.io/logo.png)
