/**
 * Observability Dashboard
 *
 * Collects metrics from intelligence systems and worker agents.
 * Provides real-time snapshots of agent system health and performance.
 */

import { correctionTracker } from './correction-tracker';
import { errorPatternTracker } from './error-pattern-tracker';

// ── Metric Types ──

export interface WorkerMetrics {
    activeWorkers: number;
    completedTasks: number;
    failedTasks: number;
    avgDurationMs: number;
    successRate: number;
}

export interface IntelligenceMetrics {
    correctionsStored: number;
    patternsLearned: number;
    errorsTracked: number;
    recentErrorRate: number;
}

export interface ContextMetrics {
    messagesPruned: number;
    compressionRatio: number;
    estimatedTokens: number;
}

export interface SystemSnapshot {
    timestamp: number;
    workers: WorkerMetrics;
    intelligence: IntelligenceMetrics;
    context: ContextMetrics;
    healthScore: number; // 0-100
    recommendations: string[];
}

// ── Metrics Collector ──

class ObservabilityCollector {
    private workerHistory: {
        completed: number;
        failed: number;
        durations: number[];
    } = { completed: 0, failed: 0, durations: [] };

    private contextHistory: {
        pruned: number;
        originalTokens: number;
        compressedTokens: number;
    } = { pruned: 0, originalTokens: 0, compressedTokens: 0 };

    /** Record a task completion. */
    recordTaskCompletion(durationMs: number, success: boolean): void {
        if (success) {
            this.workerHistory.completed++;
        } else {
            this.workerHistory.failed++;
        }
        this.workerHistory.durations.push(durationMs);
        // Keep only recent 100 entries
        if (this.workerHistory.durations.length > 100) {
            this.workerHistory.durations.shift();
        }
    }

    /** Record context compression. */
    recordCompression(
        originalTokens: number,
        compressedTokens: number,
        messagesPruned: number,
    ): void {
        this.contextHistory.pruned += messagesPruned;
        this.contextHistory.originalTokens += originalTokens;
        this.contextHistory.compressedTokens += compressedTokens;
    }

    /** Get current system snapshot. */
    async getSnapshot(activeWorkers = 0): Promise<SystemSnapshot> {
        const workers = this.getWorkerMetrics(activeWorkers);
        const intelligence = await this.getIntelligenceMetrics();
        const context = this.getContextMetrics();
        const healthScore = this.calculateHealthScore(
            workers,
            intelligence,
            context,
        );
        const recommendations = this.generateRecommendations(
            workers,
            intelligence,
            context,
        );

        return {
            timestamp: Date.now(),
            workers,
            intelligence,
            context,
            healthScore,
            recommendations,
        };
    }

    private getWorkerMetrics(activeWorkers: number): WorkerMetrics {
        const total = this.workerHistory.completed + this.workerHistory.failed;
        const durations = this.workerHistory.durations;
        const avgDurationMs =
            durations.length > 0
                ? durations.reduce((a, b) => a + b, 0) / durations.length
                : 0;

        return {
            activeWorkers,
            completedTasks: this.workerHistory.completed,
            failedTasks: this.workerHistory.failed,
            avgDurationMs: Math.round(avgDurationMs),
            successRate: total > 0 ? this.workerHistory.completed / total : 1,
        };
    }

    private async getIntelligenceMetrics(): Promise<IntelligenceMetrics> {
        const corrections = await correctionTracker.getCorrections();
        const patterns = await correctionTracker.getPatterns();
        const errorSuggestions = errorPatternTracker.getSuggestions();

        return {
            correctionsStored: corrections.length,
            patternsLearned:
                patterns.positives.length + patterns.corrections.length,
            errorsTracked: errorSuggestions.length,
            recentErrorRate: this.calculateErrorRate(),
        };
    }

    private getContextMetrics(): ContextMetrics {
        const { pruned, originalTokens, compressedTokens } =
            this.contextHistory;
        const compressionRatio =
            originalTokens > 0 ? compressedTokens / originalTokens : 1;

        return {
            messagesPruned: pruned,
            compressionRatio: Math.round(compressionRatio * 100) / 100,
            estimatedTokens: compressedTokens,
        };
    }

    private calculateErrorRate(): number {
        const total = this.workerHistory.completed + this.workerHistory.failed;
        return total > 0 ? this.workerHistory.failed / total : 0;
    }

    private calculateHealthScore(
        workers: WorkerMetrics,
        intelligence: IntelligenceMetrics,
        context: ContextMetrics,
    ): number {
        let score = 100;

        // Deduct for high failure rate
        if (workers.successRate < 0.9) {
            score -= (1 - workers.successRate) * 30;
        }

        // Deduct for many unlearned errors
        if (intelligence.errorsTracked > 5) {
            score -= 10;
        }

        // Deduct for high compression ratio (context getting too large)
        if (context.compressionRatio > 0.8) {
            score -= 5;
        }

        // Deduct for too many corrections (agent is struggling)
        if (intelligence.correctionsStored > 20) {
            score -= 10;
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    private generateRecommendations(
        workers: WorkerMetrics,
        intelligence: IntelligenceMetrics,
        context: ContextMetrics,
    ): string[] {
        const recs: string[] = [];

        if (
            workers.successRate < 0.8 &&
            workers.completedTasks + workers.failedTasks > 5
        ) {
            recs.push('High failure rate — consider reviewing error patterns');
        }

        if (intelligence.errorsTracked > 10) {
            recs.push(
                'Many error patterns tracked — run error pattern analysis',
            );
        }

        if (intelligence.correctionsStored > 15) {
            recs.push(
                'Many corrections accumulated — agent may benefit from re-learning',
            );
        }

        if (context.compressionRatio > 0.7) {
            recs.push(
                'Context heavily compressed — consider clearing old messages',
            );
        }

        if (workers.avgDurationMs > 60000) {
            recs.push('Slow task execution — check for bottlenecks');
        }

        return recs;
    }

    /** Reset all metrics. */
    clear(): void {
        this.workerHistory = { completed: 0, failed: 0, durations: [] };
        this.contextHistory = {
            pruned: 0,
            originalTokens: 0,
            compressedTokens: 0,
        };
    }
}

export const observability = new ObservabilityCollector();

/**
 * Format a system snapshot as a human-readable string for the TUI.
 */
export function formatSnapshot(snapshot: SystemSnapshot): string {
    const lines: string[] = [
        '═══ Agent System Health ═══',
        '',
        `Health Score: ${snapshot.healthScore}/100`,
        '',
        '── Workers ──',
        `  Active: ${snapshot.workers.activeWorkers}`,
        `  Completed: ${snapshot.workers.completedTasks}`,
        `  Failed: ${snapshot.workers.failedTasks}`,
        `  Success Rate: ${(snapshot.workers.successRate * 100).toFixed(1)}%`,
        `  Avg Duration: ${(snapshot.workers.avgDurationMs / 1000).toFixed(1)}s`,
        '',
        '── Intelligence ──',
        `  Corrections Stored: ${snapshot.intelligence.correctionsStored}`,
        `  Patterns Learned: ${snapshot.intelligence.patternsLearned}`,
        `  Errors Tracked: ${snapshot.intelligence.errorsTracked}`,
        '',
        '── Context ──',
        `  Messages Pruned: ${snapshot.context.messagesPruned}`,
        `  Compression Ratio: ${(snapshot.context.compressionRatio * 100).toFixed(0)}%`,
        `  Est. Tokens: ~${snapshot.context.estimatedTokens.toLocaleString()}`,
    ];

    if (snapshot.recommendations.length > 0) {
        lines.push('', '── Recommendations ──');
        for (const rec of snapshot.recommendations) {
            lines.push(`  • ${rec}`);
        }
    }

    return lines.join('\n');
}
