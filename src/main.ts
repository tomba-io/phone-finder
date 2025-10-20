// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor } from 'apify';
// Tomba SDK for phone finding
import { Phone, TombaClient } from 'tomba';

interface ActorInput {
    tombaApiKey: string;
    tombaApiSecret: string;
    searches?: {
        email?: string;
        domain?: string;
        linkedin?: string;
    }[];
    maxResults?: number;
}

// Rate limiting: 150 requests per minute
const RATE_LIMIT = 150;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute in milliseconds
let requestCount = 0;
let windowStart = Date.now();

async function rateLimitedRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    const now = Date.now();

    // Reset counter if window has passed
    if (now - windowStart > RATE_LIMIT_WINDOW) {
        requestCount = 0;
        windowStart = now;
    }

    // Check if we've hit the rate limit
    if (requestCount >= RATE_LIMIT) {
        const waitTime = RATE_LIMIT_WINDOW - (now - windowStart);
        console.log(`Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)} seconds...`);
        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), waitTime);
        });

        // Reset after waiting
        requestCount = 0;
        windowStart = Date.now();
    }

    requestCount++;
    return await requestFn();
}

// The init() call configures the Actor for its environment
await Actor.init();

try {
    // Get input from the Actor
    const input = (await Actor.getInput()) as ActorInput;

    if (!input) {
        throw new Error('No input provided');
    }

    if (!input.tombaApiKey || !input.tombaApiSecret) {
        throw new Error('Tomba API key and secret are required');
    }

    console.log('Starting Tomba Phone Finder Actor...');
    console.log(`Processing ${input.searches?.length || 0} search queries`);

    // Initialize Tomba client
    const client = new TombaClient();
    const phone = new Phone(client);

    client.setKey(input.tombaApiKey).setSecret(input.tombaApiSecret);

    const results: unknown[] = [];
    const maxResults = input.maxResults || 50;

    // Process search queries
    if (input.searches && input.searches.length > 0) {
        console.log(`Processing ${input.searches.length} search queries...`);

        for (const searchQuery of input.searches) {
            if (results.length >= maxResults) break;

            try {
                console.log(`Finding phone for:`, searchQuery);

                // Use Tomba's phone finder method with rate limiting
                const tombaResult = await rateLimitedRequest(async () => phone.finder(searchQuery));

                if (tombaResult && tombaResult.data) {
                    // Handle the response structure - using any type since SDK types may not match
                    const phoneData = tombaResult.data;

                    if (phoneData.valid) {
                        results.push(phoneData);
                        console.log(`Found phone: ${phoneData.local_format}`);
                    }
                }
            } catch (error) {
                console.log(`Error processing search query:`, searchQuery, error);
            }
        }
    }

    // Save results to dataset
    if (results.length > 0) {
        await Actor.pushData(results);
        console.log(`Found ${results.length} unique phone numbers`);
    }

    // Log summary
    console.log('=== SUMMARY ===');
    console.log(`Total phone numbers found: ${results.length}`);
} catch (error) {
    console.error('Actor failed:', error);
    throw error;
}

// Gracefully exit the Actor process
await Actor.exit();
