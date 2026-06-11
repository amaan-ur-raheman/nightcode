/**
 * Global concurrency limiter shared between direct subagents (spawn-agent.ts)
 * and orchestrator workers (worker-agent.ts).
 *
 * Features:
 * - Per-provider concurrency profiles
 * - Dynamic adjustment based on observed latency and success rate
 * - Shared slot pool across subagents and workers
 */

const DEFAULT_MAX_CONCURRENT = 5;

let activeCount = 0;
let maxConcurrent = DEFAULT_MAX_CONCURRENT;

/**
 * Per-provider concurrency profiles.
 * Free-tier models can handle more parallel requests; paid models are more expensive per call.
 */
const PROVIDER_CONCURRENCY: Record<string, number> = {
    opencode: 8,
    nvidia: 6,
    anthropic: 3,
    openai: 3,
    groq: 5,
};

let currentProvider: string | undefined;

// --- Enhanced dynamic concurrency tracking ---

interface ProviderMetrics {
    recentLatencies: number[];
    recentSuccesses: number;
    recentFailures: number;
    taskTypes: Record<string, number>; // Track task type distribution
    lastAdjustment: number;
}

const metrics: Record<string, ProviderMetrics> = {};

function getMetrics(provider: string): ProviderMetrics {
    if (!metrics[provider]) {
        metrics[provider] = { 
            recentLatencies: [], 
            recentSuccesses: 0, 
            recentFailures: 0,
            taskTypes: {},
            lastAdjustment: 0
        };
    }
    return metrics[provider];
}

const MAX_RECENT_SAMPLES = 20;
const ADJUSTMENT_INTERVAL_MS = 5000; // Reduced from 10 seconds for faster adaptation
let lastAdjustment = 0;

/**
 * Record the latency and success/failure of a completed operation.
 * Triggers dynamic adjustment after enough samples.
 */
export function recordProviderLatency(provider: string, latencyMs: number, success: boolean, taskType?: string): void {
    const m = getMetrics(provider);
    m.recentLatencies.push(latencyMs);
    if (m.recentLatencies.length > MAX_RECENT_SAMPLES) {
        m.recentLatencies.shift();
    }
    if (success) {
        m.recentSuccesses++;
    } else {
        m.recentFailures++;
    }
    
    // Track task type distribution for adaptive optimization
    if (taskType) {
        m.taskTypes[taskType] = (m.taskTypes[taskType] || 0) + 1;
    }

    // Periodically adjust concurrency with more frequent updates
    const now = Date.now();
    if (now - lastAdjustment > ADJUSTMENT_INTERVAL_MS) {
        lastAdjustment = now;
        adjustConcurrency(provider);
    }
}

function adjustConcurrency(provider: string): void {
    const m = getMetrics(provider);
    const total = m.recentSuccesses + m.recentFailures;
    if (total < 3) return; // Reduced from 5 for faster adaptation

    const successRate = m.recentSuccesses / total;
    const avgLatency = m.recentLatencies.length > 0
        ? m.recentLatencies.reduce((a, b) => a + b, 0) / m.recentLatencies.length
        : 0;

    const base = PROVIDER_CONCURRENCY[provider] ?? 5;
    
    // Adaptive concurrency based on task type distribution
    const taskDiversity = Object.keys(m.taskTypes).length;
    const diversityFactor = Math.min(taskDiversity / 3, 1); // Cap diversity impact

    // Enhanced decision logic with diversity consideration
    let newConcurrency = maxConcurrent;
    
    if (successRate > 0.95 && avgLatency < 5000) {
        // Excellent performance — increase concurrency more aggressively
        newConcurrency = Math.min(maxConcurrent + 2, Math.ceil(base * 1.8));
    } else if (successRate > 0.9 && avgLatency < 10_000) {
        // Good performance — moderate increase
        newConcurrency = Math.min(maxConcurrent + 1, Math.ceil(base * 1.5));
    } else if (successRate < 0.8 || avgLatency > 15_000) {
        // Poor performance — decrease concurrency more aggressively
        newConcurrency = Math.max(maxConcurrent - 2, 2);
    } else if (successRate < 0.85 || avgLatency > 12_000) {
        // Moderate performance — slight decrease
        newConcurrency = Math.max(maxConcurrent - 1, 2);
    }

    // Apply diversity-based adjustments
    if (taskDiversity > 2) {
        // High diversity — slightly reduce concurrency for better resource distribution
        newConcurrency = Math.max(newConcurrency - 1, 2);
    }

    maxConcurrent = newConcurrency;

    // Reset counters after adjustment
    m.recentSuccesses = 0;
    m.recentFailures = 0;
    m.lastAdjustment = Date.now();
}

/**
 * Set the current provider to apply provider-specific concurrency limits.
 */
export function setProviderConcurrency(provider: string): void {
    currentProvider = provider;
    const providerLimit = PROVIDER_CONCURRENCY[provider];
    if (providerLimit) {
        maxConcurrent = providerLimit;
    }
    // Reset metrics for new provider
    lastAdjustment = Date.now();
}

/**
 * Configure the global concurrency limit.
 */
export function setConcurrencyLimit(limit: number): void {
    maxConcurrent = Math.max(1, limit);
}

/**
 * Get the current number of active concurrent operations.
 */
export function getActiveConcurrency(): number {
    return activeCount;
}

/**
 * Check if we're at the concurrency limit.
 */
export function isAtConcurrencyLimit(): boolean {
    return activeCount >= maxConcurrent;
}

/**
 * Increment the active count. Call this before starting work.
 * Returns false if already at the limit (count NOT incremented).
 */
export function acquireSlot(): boolean {
    if (activeCount >= maxConcurrent) {
        return false;
    }
    activeCount++;
    return true;
}

/**
 * Release a slot. Call this in a finally block after work completes.
 */
export function releaseSlot(): void {
    if (activeCount > 0) {
        activeCount--;
    }
}

/**
 * Wait for a concurrency slot to become available, polling every 200ms.
 * Returns true if a slot was acquired, false if timed out.
 */
export async function waitForSlot(timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (acquireSlot()) return true;
        await new Promise(r => setTimeout(r, 200));
    }
    return false;
}
