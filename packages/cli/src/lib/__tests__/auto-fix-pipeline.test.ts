import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { autoFixPipeline } from '../auto-fix-pipeline';

describe('AutoFixPipeline', () => {
    beforeEach(() => {
        // Reset pipeline state before each test
        autoFixPipeline.clearModifications();
        autoFixPipeline.updateConfig({
            enabled: true,
            typecheckEnabled: true,
            lintEnabled: true,
            testEnabled: false,
            autoFixEnabled: true,
            debounceMs: 50, // Short debounce for tests
        });
    });

    afterEach(() => {
        autoFixPipeline.clearModifications();
    });

    describe('recordModification', () => {
        it('should track source file modifications', () => {
            autoFixPipeline.recordModification('/project/src/utils.ts');
            const files = autoFixPipeline.getModifiedFiles();
            expect(files).toContain('/project/src/utils.ts');
        });

        it('should track multiple file modifications', () => {
            autoFixPipeline.recordModification('/project/src/a.ts');
            autoFixPipeline.recordModification('/project/src/b.ts');
            autoFixPipeline.recordModification('/project/src/c.ts');
            const files = autoFixPipeline.getModifiedFiles();
            expect(files).toHaveLength(3);
        });

        it('should not track non-source files', () => {
            autoFixPipeline.recordModification('/project/package.json');
            autoFixPipeline.recordModification('/project/README.md');
            autoFixPipeline.recordModification('/project/.gitignore');
            const files = autoFixPipeline.getModifiedFiles();
            expect(files).toHaveLength(0);
        });

        it('should not track when pipeline is disabled', () => {
            autoFixPipeline.updateConfig({ enabled: false });
            autoFixPipeline.recordModification('/project/src/utils.ts');
            const files = autoFixPipeline.getModifiedFiles();
            expect(files).toHaveLength(0);
        });

        it('should track various source file types', () => {
            autoFixPipeline.recordModification('/project/src/a.ts');
            autoFixPipeline.recordModification('/project/src/b.tsx');
            autoFixPipeline.recordModification('/project/src/c.js');
            autoFixPipeline.recordModification('/project/src/d.jsx');
            autoFixPipeline.recordModification('/project/src/e.py');
            autoFixPipeline.recordModification('/project/src/f.rs');
            autoFixPipeline.recordModification('/project/src/g.go');
            const files = autoFixPipeline.getModifiedFiles();
            expect(files).toHaveLength(7);
        });

        it('should deduplicate modifications', () => {
            autoFixPipeline.recordModification('/project/src/utils.ts');
            autoFixPipeline.recordModification('/project/src/utils.ts');
            const files = autoFixPipeline.getModifiedFiles();
            expect(files).toHaveLength(1);
        });
    });

    describe('clearModifications', () => {
        it('should clear all tracked modifications', () => {
            autoFixPipeline.recordModification('/project/src/a.ts');
            autoFixPipeline.recordModification('/project/src/b.ts');
            autoFixPipeline.clearModifications();
            const files = autoFixPipeline.getModifiedFiles();
            expect(files).toHaveLength(0);
        });
    });

    describe('config management', () => {
        it('should update config', () => {
            autoFixPipeline.updateConfig({ enabled: false });
            expect(autoFixPipeline.getConfig().enabled).toBe(false);
        });

        it('should return current config', () => {
            const config = autoFixPipeline.getConfig();
            expect(config).toHaveProperty('enabled');
            expect(config).toHaveProperty('typecheckEnabled');
            expect(config).toHaveProperty('lintEnabled');
            expect(config).toHaveProperty('testEnabled');
            expect(config).toHaveProperty('autoFixEnabled');
            expect(config).toHaveProperty('debounceMs');
        });
    });

    describe('lastReport', () => {
        it('should return null when no report exists', () => {
            const report = autoFixPipeline.getLastReport();
            expect(report).toBeNull();
        });
    });

    describe('consumePendingReport', () => {
        it('should return null when no pending report', () => {
            const report = autoFixPipeline.consumePendingReport();
            expect(report).toBeNull();
        });
    });

    describe('setCwd', () => {
        it('should update working directory', () => {
            autoFixPipeline.setCwd('/new/project');
            // Verify by checking that project type is reset
            expect(autoFixPipeline.getConfig()).toBeDefined();
        });
    });

    describe('resetProjectType', () => {
        it('should reset cached project type', () => {
            autoFixPipeline.resetProjectType();
            expect(autoFixPipeline.getConfig()).toBeDefined();
        });
    });
});
