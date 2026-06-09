import { Polar } from "@polar-sh/sdk";

type PolarServer = "sandbox" | "production";

function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Required environment variable ${name} is not set`);
    }
    return value;
}

export function getPolarAccessToken(): string {
    return getRequiredEnv("POLAR_ACCESS_TOKEN");
}

export function getPolarProductId(): string {
    return getRequiredEnv("POLAR_PRODUCT_ID");
}

export function getPolarCreditsMeterId(): string {
    return getRequiredEnv("POLAR_CREDITS_METER_ID");
}

export function getPolarServer(): PolarServer {
    const server = process.env.POLAR_SERVER
    if (!server) {
        return "sandbox";
    }

    if (server !== "sandbox" && server !== "production") {
        throw new Error("POLAR_SERVER must be either 'sandbox' or 'production'");
    }

    return server;
}

let _polar: Polar | null = null;

function getPolar(): Polar {
    if (!_polar) {
        _polar = new Polar({
            accessToken: getPolarAccessToken(),
            server: getPolarServer(),
        });
    }
    return _polar;
}

function hasStatusCode(error: unknown): error is { statusCode: number } {
    return (
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        typeof error.statusCode === "number"
    );
}

type CreateCheckoutUrlParams = {
    customerExternalId: string;
    requestUrl?: string;
};

export async function createCheckoutUrl({
    customerExternalId,
    requestUrl,
}: CreateCheckoutUrlParams) {
    const result = await getPolar().checkouts.create({
        products: [getPolarProductId()],
        successUrl: new URL("/billing/success", requestUrl).toString(),
        externalCustomerId: customerExternalId,
        metadata: { source: "nightcode-cli" }
    });

    return result.url;
}

export async function createCustomerPortalUrl({
    customerExternalId,
    requestUrl,
}: CreateCheckoutUrlParams) {
    const result = await getPolar().customerSessions.create({
        externalCustomerId: customerExternalId,
        returnUrl: new URL("/billing/success", requestUrl).toString(),
    });

    return result.customerPortalUrl;
}

const creditsCache = new Map<string, { balance: number; expiry: number }>();
const CREDITS_CACHE_TTL_MS = 30_000;

export function getCachedCreditsBalance(customerExternalId: string): number | null {
    const cached = creditsCache.get(customerExternalId);
    if (cached && Date.now() < cached.expiry) return cached.balance;
    return null;
}

export async function getAvailableCreditsBalance(customerExternalId: string): Promise<number> {
    const cached = creditsCache.get(customerExternalId);
    if (cached && Date.now() < cached.expiry) return cached.balance;

    try {
        const customerState = await getPolar().customers.getStateExternal({
            externalId: customerExternalId
        });

        const matchingMeters = customerState.activeMeters.filter(
            (meter) => meter.meterId === getPolarCreditsMeterId()
        );

        if (matchingMeters.length > 1) {
            throw new Error("Expected exactly one matching Polar credits meter");
        }

        const creditsMeter = matchingMeters[0];
        const balance = creditsMeter?.balance ?? 0;
        creditsCache.set(customerExternalId, { balance, expiry: Date.now() + CREDITS_CACHE_TTL_MS });
        return balance;
    } catch (error) {
        if (hasStatusCode(error) && error.statusCode === 404) {
            return 0;
        }

        throw error;
    }
}

type IngestAIUsageParams = {
    externalCustomerId: string;
    eventId: string;
    credits: number;
}

export async function ingestAIUsage({
    externalCustomerId,
    eventId,
    credits,
}: IngestAIUsageParams) {
    if (credits <= 0) {
        return;
    }

    await getPolar().events.ingest({
        events: [
            {
                name: "nightcode_usage",
                externalId: eventId,
                externalCustomerId,
                metadata: { credits }
            }
        ]
    });
}
