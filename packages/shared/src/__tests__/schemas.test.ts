import { describe, it, expect } from 'vitest';
import {
    toolInputSchemas,
    getToolContracts,
    getSubagentToolContracts,
    modeSchema,
} from '../schemas';

describe('modeSchema', () => {
    it('accepts BUILD', () => {
        expect(modeSchema.parse('BUILD')).toBe('BUILD');
    });

    it('accepts PLAN', () => {
        expect(modeSchema.parse('PLAN')).toBe('PLAN');
    });

    it('rejects invalid mode', () => {
        expect(() => modeSchema.parse('INVALID')).toThrow();
    });
});

describe('toolInputSchemas', () => {
    describe('read_file', () => {
        it('parses valid input', () => {
            const result = toolInputSchemas.read_file.parse({
                path: 'src/index.ts',
            });
            expect(result.path).toBe('src/index.ts');
        });

        it('parses with optional fields', () => {
            const result = toolInputSchemas.read_file.parse({
                path: 'file.ts',
                offset: 5,
                limit: 20,
            });
            expect(result.offset).toBe(5);
            expect(result.limit).toBe(20);
        });

        it('rejects missing path', () => {
            expect(() => toolInputSchemas.read_file.parse({})).toThrow();
        });
    });

    describe('edit_file', () => {
        it('parses valid edit', () => {
            const result = toolInputSchemas.edit_file.parse({
                action: 'edit',
                path: 'file.ts',
                oldString: 'old code',
                newString: 'new code',
            });
            expect(result.path).toBe('file.ts');
            expect(result.oldString).toBe('old code');
        });
    });

    describe('write_file', () => {
        it('parses valid write', () => {
            const result = toolInputSchemas.write_file.parse({
                path: 'file.ts',
                content: "console.log('hi');",
            });
            expect(result.content).toBe("console.log('hi');");
        });
    });

    describe('spawn_agent', () => {
        it('parses with required fields', () => {
            const result = toolInputSchemas.spawn_agent.parse({
                task: 'Do something',
                mode: 'BUILD',
            });
            expect(result.task).toBe('Do something');
            expect(result.mode).toBe('BUILD');
        });
    });
});

describe('getToolContracts', () => {
    it('returns read-only tools for PLAN mode', () => {
        const tools = getToolContracts('PLAN');
        expect(tools.read_file).toBeDefined();
        expect(tools.list_dir).toBeDefined();
        expect((tools as Record<string, unknown>).write_file).toBeUndefined();
        expect((tools as Record<string, unknown>).run_command).toBeUndefined();
    });

    it('returns all tools for BUILD mode', () => {
        const tools = getToolContracts('BUILD');
        expect(tools.read_file).toBeDefined();
        expect((tools as Record<string, unknown>).write_file).toBeDefined();
        expect((tools as Record<string, unknown>).run_command).toBeDefined();
        expect((tools as Record<string, unknown>).edit_file).toBeDefined();
    });

    it('includes spawn_agent in both modes', () => {
        const planTools = getToolContracts('PLAN');
        const buildTools = getToolContracts('BUILD');
        expect(planTools.spawn_agent).toBeDefined();
        expect(buildTools.spawn_agent).toBeDefined();
    });
});

describe('getSubagentToolContracts', () => {
    it('includes spawn_agent for subagents', () => {
        const planTools = getSubagentToolContracts('PLAN');
        expect(
            (planTools as Record<string, unknown>).spawn_agent,
        ).toBeDefined();
    });

    it('excludes orchestrate_task for subagents', () => {
        const buildTools = getSubagentToolContracts('BUILD');
        expect(
            (buildTools as Record<string, unknown>).orchestrate_task,
        ).toBeUndefined();
    });

    it('still includes read tools for subagents', () => {
        const planTools = getSubagentToolContracts('PLAN');
        expect(planTools.read_file).toBeDefined();
        expect(planTools.code_search).toBeDefined();
    });
});
