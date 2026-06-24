/**
 * Unified entry point for all agent intelligence systems.
 *
 * Re-exports:
 * - CorrectionTracker: records and retrieves user corrections/positives
 * - ErrorPatternTracker: detects repeated error patterns and learns fixes
 * - SelfVerification: verifies file consistency and records outcomes
 * - ContextCompression: compresses conversation context to fit token limits
 *
 * Usage:
 *   import { agentIntelligence } from './agent-intelligence';
 *   // or import individual systems:
 *   import { correctionTracker } from './agent-intelligence';
 */

// ── Re-exports from individual systems ───────────────────────────────────
export { correctionTracker } from '../correction-tracker';
export {
    ErrorPatternTracker,
    errorPatternTracker,
} from '../error-pattern-tracker';
export {
    verifyFileConsistency,
    calculateConfidence,
    isCriticalOperation,
    generateVerificationPrompt,
    runVerification,
    recordVerificationOutcome,
    type ConfidenceScore,
    type FileConsistencyResult,
    type VerificationResult,
} from '../self-verification';
export {
    estimateTokens,
    compressContext,
    detectContextMode,
    ProgressiveContextLoader,
    type ContextMode,
    type CompressionStats,
    type CompressionResult,
} from '../context-compression';

// ── Unified intelligence facade ──────────────────────────────────────────
import { correctionTracker } from '../correction-tracker';
import { errorPatternTracker } from '../error-pattern-tracker';
import {
    recordVerificationOutcome,
    type VerificationResult,
} from '../self-verification';
import {
    compressContext,
    detectContextMode,
    estimateTokens,
} from '../context-compression';

export interface IntelligenceContext {
    sessionId: string;
    messages: any[];
    modifiedFiles?: string[];
}

/**
 * Unified facade over all agent intelligence subsystems.
 * Provides a single entry point for the agent loop to record outcomes,
 * compress context, and retrieve learning signals.
 */
export class AgentIntelligence {
    /** Record a tool error and return a suggestion if a repeated pattern is detected */
    recordError(error: unknown): string | null {
        return errorPatternTracker.record(error);
    }

    /** Record that an action was accepted (positive signal) */
    async recordAcceptance(
        tool: string,
        input: unknown,
        description: string,
    ): Promise<string | null> {
        return correctionTracker.onAccept(tool, input, description);
    }

    /** Record a user undo as a correction */
    async recordCorrection(): Promise<string | null> {
        return correctionTracker.onUndo();
    }

    /** Record a verification outcome back into the correction tracker */
    async recordVerification(
        result: VerificationResult,
        toolUsage: Map<string, number>,
    ): Promise<void> {
        await recordVerificationOutcome(result, toolUsage);
    }

    /** Get accumulated error suggestions for system prompt injection */
    getErrorSuggestions(): string[] {
        return errorPatternTracker.getSuggestions();
    }

    /** Get error suggestions formatted for system prompt */
    formatErrorSuggestions(): string {
        return errorPatternTracker.formatSuggestionsForPrompt();
    }

    /** Get session-scoped correction and positive patterns */
    async getPatterns(): Promise<{
        corrections: string[];
        positives: string[];
    }> {
        return correctionTracker.getPatterns();
    }

    /** Get corrections only (backward-compatible) */
    async getCorrections(): Promise<string[]> {
        return correctionTracker.getCorrections();
    }

    /** Set the active session for scoped tracking */
    setSession(sessionId: string): void {
        correctionTracker.setSession(sessionId);
        errorPatternTracker.clear();
    }

    /** Compress conversation context to fit within token limits */
    compressContext(
        messages: any[],
        opts?: { tier1Count?: number; tier2Count?: number; mode?: string },
    ) {
        const contextMode = opts?.mode
            ? detectContextMode(opts.mode)
            : undefined;
        return compressContext(messages, {
            tier1Count: opts?.tier1Count,
            tier2Count: opts?.tier2Count,
            contextMode,
        });
    }

    /** Estimate token count for a message */
    estimateTokens(msg: any): number {
        return estimateTokens(msg);
    }

    /** Clear all tracked state (for testing or session reset) */
    clear(): void {
        errorPatternTracker.clear();
    }

    /** Cancel all pending auto-accept timers */
    cancelTimers(): void {
        correctionTracker.cancelAllTimers();
    }
}

/** Singleton instance for convenient access */
export const agentIntelligence = new AgentIntelligence();
