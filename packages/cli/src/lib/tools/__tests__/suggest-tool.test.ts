import { describe, it, expect } from 'vitest';
import { suggestToolTool, listToolCategoriesTool } from '../suggest-tool';

describe('suggestToolTool', () => {
    it('suggests tools based on exact tool name mention', async () => {
        const result = await suggestToolTool({
            task: 'I want to read a file using readFile',
        });
        expect(result.suggestions).toBeDefined();
        expect(result.suggestions.length).toBeGreaterThan(0);
        expect(result.suggestions[0]?.name).toBe('readFile');
    });

    it('suggests tools based on keywords in description', async () => {
        const result = await suggestToolTool({
            task: 'search regex patterns in all the repository files',
        });
        const hasGrep = result.suggestions.some(
            (s) => s.name === 'grep' || s.name === 'searchReplace',
        );
        expect(hasGrep).toBe(true);
    });

    it('filters suggestions by category if provided', async () => {
        const result = await suggestToolTool({
            task: 'read a typescript file',
            category: 'read-explore',
        });
        expect(result.categories).toEqual(['read-explore']);
        expect(
            result.suggestions.every((s) => s.category === 'read-explore'),
        ).toBe(true);
    });
});

describe('listToolCategoriesTool', () => {
    it('lists all categories with descriptions and counts', async () => {
        const result = await listToolCategoriesTool({});
        expect(result.categories).toBeDefined();
        expect(result.categories.length).toBeGreaterThan(0);
        expect(result.categories[0]).toHaveProperty('name');
        expect(result.categories[0]).toHaveProperty('description');
        expect(result.categories[0]).toHaveProperty('toolCount');
    });
});
