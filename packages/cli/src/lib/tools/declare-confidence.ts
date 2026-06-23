/**
 * Pre-flight Confidence Declaration
 *
 * Allows the model to signal its confidence level before acting.
 * The harness uses this to adjust behavior:
 * - High confidence: proceed normally
 * - Medium confidence: require validation before declaring done
 * - Low confidence: inject extra verification steps
 *
 * Solves: "I have no way to express uncertainty"
 */

import { toolInputSchemas } from '@nightcode/shared';

export interface ConfidenceDeclaration {
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
    suggestedApproach?: string;
}

/**
 * Confidence thresholds that the harness uses to adjust behavior.
 * Not exposed to the model directly — applied server-side.
 */
export const CONFIDENCE_LEVELS = {
    high: {
        label: 'High confidence',
        requiresValidation: false,
        maxStepsBeforeCheck: 10,
    },
    medium: {
        label: 'Medium confidence',
        requiresValidation: true,
        maxStepsBeforeCheck: 5,
    },
    low: {
        label: 'Low confidence',
        requiresValidation: true,
        maxStepsBeforeCheck: 2,
        injectVerificationPrompt: true,
    },
} as const;

export async function declareConfidenceTool(input: unknown): Promise<{
    status: string;
    confidence: string;
    harnessResponse: string;
    verificationRequired: boolean;
}> {
    const { confidence, reasoning, suggestedApproach } =
        toolInputSchemas.declareConfidence.parse(input);

    const level = CONFIDENCE_LEVELS[confidence];

    const harnessResponse =
        confidence === 'high'
            ? 'Noted. Proceeding with standard execution.'
            : confidence === 'medium'
              ? 'Noted. Will run validation checks before finalizing. Focus on getting the implementation right first.'
              : 'Understood. Extra verification will be injected before completion. Consider using validateCode after each change to catch issues early.';

    // Build a structured response so the harness can adjust behavior
    return {
        status: 'declared',
        confidence,
        harnessResponse,
        verificationRequired: level.requiresValidation,
    };
}
