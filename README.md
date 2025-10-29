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

## FAQ

### General Questions

**Q: How does phone finding work?**
A: Phone finding searches for phone numbers associated with email addresses, domains, or LinkedIn profiles using public sources and professional databases.

**Q: What information do I need to find a phone number?**
A: You can search using an email address, company domain, or LinkedIn profile URL. Different search methods have varying success rates.

**Q: How accurate are the found phone numbers?**
A: Accuracy varies by search method and data availability. Email-based searches typically yield the highest accuracy, followed by LinkedIn and domain searches.

### Search Methods

**Q: Which search method is most effective?**
A: Email-based searches are typically most accurate since they target specific individuals. LinkedIn searches are good for professional contacts, while domain searches cast a wider net.

**Q: Can I search for multiple phone numbers at once?**
A: Yes, you can provide multiple search queries in the `searches` array. The Actor processes them efficiently while respecting rate limits.

**Q: What if a phone number isn't found?**
A: Not all contacts have publicly discoverable phone numbers. The result will show no phone data, which is normal for privacy-conscious individuals or companies.

**Q: Do you find both mobile and landline numbers?**
A: Yes, when available, results include both mobile phones and office/landline numbers, along with the phone type identification.

### Technical Questions

**Q: What are the rate limits?**
A: The Actor automatically handles Tomba's rate limits. Phone finding typically allows for efficient batch processing of multiple searches.

**Q: How should I format LinkedIn URLs?**
A: Use standard LinkedIn profile URLs like "https://linkedin.com/in/username". Both full URLs and just the username part work.

**Q: Can I specify which type of phone numbers to find?**
A: The API returns all available phone numbers with type information (mobile, work, etc.). You can filter results based on your needs.

**Q: What happens with invalid search parameters?**
A: Invalid emails, domains, or LinkedIn URLs will return empty results. The Actor continues processing other valid searches in your batch.

### Data Quality & Privacy

**Q: Where do the phone numbers come from?**
A: Phone numbers are sourced from publicly available information including business websites, professional profiles, and legitimate contact databases.

**Q: Is phone finding GDPR compliant?**
A: Yes, the service only accesses publicly available information and follows privacy regulations. Always ensure you have permission to contact people using found numbers.

**Q: How current are the phone numbers?**
A: Data freshness varies, but results include timestamps when available. Some phone numbers may be outdated, so verification is recommended for critical use cases.

**Q: Can I verify the found phone numbers?**
A: While this Actor finds phone numbers, you can use the Phone Validator actor to verify their current validity and status.

### Business Use Cases

**Q: Can I use this for cold calling?**
A: Yes, but ensure compliance with local telemarketing laws (Do Not Call registries, TCPA, etc.). Always respect privacy preferences and include opt-out options.

**Q: Is this useful for customer support?**
A: Yes, you can use it to find alternative contact methods for customers when email isn't responsive or for urgent matters requiring phone contact.

**Q: How does this help with lead qualification?**
A: Phone contact often indicates higher-quality leads. Having multiple contact methods (email + phone) typically improves conversion rates.

**Q: Can I integrate this with my CRM?**
A: Yes, the JSON output can be easily integrated with CRM systems to enrich existing contact records with phone number data.

### Troubleshooting

**Q: Why am I getting few results?**
A: Phone number availability varies by region, company privacy policies, and individual preferences. Try different search methods for better coverage.

**Q: How do I handle different phone number formats?**
A: Results include phone numbers in various formats. Consider normalizing formats based on your needs (international vs. local format).

**Q: What if I need higher success rates?**
A: Combine multiple search methods, ensure accurate input data, and consider using the results alongside other data enrichment tools for comprehensive contact information.

## Keywords

phone finder, phone discovery, contact phone numbers, phone search, mobile finder, contact enrichment, phone lookup, business phone numbers, lead generation, sales outreach, contact validation, telecommunications

## Support

If you need any help, have questions, or encounter any issues while using Tomba.io, please don't hesitate to reach out to our support team. You can contact us via:

- **Email**: support@tomba.io
- **Live chat**: Available on the Tomba.io website during business hours

## Contributing

We welcome contributions to improve this actor. Please feel free to submit issues, feature requests, or pull requests to help make this tool even better for the community.

## About Tomba

Founded in 2020, Tomba prides itself on being the most reliable, accurate, and in-depth source of email address data available anywhere. We process terabytes of data to produce our Email finder API.

![Tomba Logo](https://tomba.io/logo.png)
