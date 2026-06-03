import { createClerkClient } from "@clerk/backend";

const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY environment variable is required");
}

const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
if (!publishableKey) {
    throw new Error("CLERK_PUBLISHABLE_KEY environment variable is required");
}

const clerkClient = createClerkClient({
    secretKey,
    publishableKey,
});

export async function authenticateOAuthRequest(request: Request) {
    const requestState = await clerkClient.authenticateRequest(request, {
        acceptsToken: "oauth_token",
    });

    if (!requestState.isAuthenticated) {
        return null;
    }

    const auth = requestState.toAuth();
    if (auth.tokenType !== "oauth_token" || !auth.userId) {
        return null;
    }

    return { userId: auth.userId }
}
