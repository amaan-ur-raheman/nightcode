import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mcpScope } from '../mcp-scope';
import * as settings from '../settings';

vi.mock('../settings', () => ({
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
}));

describe('MCPScopeManager', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('automatically loads session scope and evaluates active servers', () => {
        vi.mocked(settings.loadSettings).mockReturnValue({
            session: {
                activeMcpServers: ['server-a', 'server-b'],
            },
        });

        // Trigger manual load session scope to simulate construction initialization
        mcpScope.loadSessionScope();

        expect(mcpScope.isServerActive('server-a')).toBe(true);
        expect(mcpScope.isServerActive('server-b')).toBe(true);
        expect(mcpScope.isServerActive('server-c')).toBe(false);
        expect(mcpScope.getActiveServers()).toEqual(['server-a', 'server-b']);
    });

    it('allows resetting the session scope', () => {
        vi.mocked(settings.loadSettings).mockReturnValue({});

        mcpScope.setSessionScope(['server-c']);

        expect(settings.saveSettings).toHaveBeenCalledWith(
            expect.objectContaining({
                session: {
                    activeMcpServers: ['server-c'],
                },
            }),
        );
        expect(mcpScope.isServerActive('server-c')).toBe(true);
        expect(mcpScope.isServerActive('server-a')).toBe(false);
    });
});
