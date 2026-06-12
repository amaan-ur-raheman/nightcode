import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Settings } from '../settings';

const TEST_SETTINGS_PATH = join(homedir(), '.nightcode', 'settings.json');

describe('Settings Module', () => {
    beforeEach(async () => {
        try {
            unlinkSync(TEST_SETTINGS_PATH);
        } catch {}
    });

    afterEach(() => {
        try {
            unlinkSync(TEST_SETTINGS_PATH);
        } catch {}
    });

    it('returns empty object when no settings file exists', async () => {
        const { loadSettings } = await import('../settings');
        const settings = loadSettings();
        expect(settings).toEqual({});
    });

    it('saves and loads settings', async () => {
        const { loadSettings, saveSettings } = await import('../settings');
        const testSettings: Settings = {
            confirmations: { enabled: true },
            debug: { enabled: true, verbose: false, retentionDays: 7 },
        };
        saveSettings(testSettings);
        const loaded = loadSettings();
        expect(loaded.confirmations?.enabled).toBe(true);
        expect(loaded.debug?.enabled).toBe(true);
    });

    it('loadMcpServers returns empty array when no MCP config', async () => {
        const { loadMcpServers, saveSettings } = await import('../settings');
        saveSettings({});
        const servers = loadMcpServers();
        expect(servers).toEqual([]);
    });

    it('loadMcpServers returns configured servers', async () => {
        const { loadMcpServers, saveSettings } = await import('../settings');
        saveSettings({
            mcp: {
                servers: {
                    'my-server': {
                        command: 'npx',
                        args: ['-y', 'some-server'],
                    },
                },
            },
        });
        const servers = loadMcpServers();
        expect(servers).toHaveLength(1);
        expect(servers[0]!.name).toBe('my-server');
    });

    it('isConfirmationEnabled defaults to true', async () => {
        const { isConfirmationEnabled, saveSettings } =
            await import('../settings');
        saveSettings({});
        expect(isConfirmationEnabled()).toBe(true);
    });

    it('toggleConfirmations toggles the value', async () => {
        const { toggleConfirmations, isConfirmationEnabled, saveSettings } =
            await import('../settings');
        saveSettings({});
        const before = isConfirmationEnabled();
        const after = toggleConfirmations();
        expect(after).toBe(!before);
    });

    it('isReasoningEnabled defaults to false', async () => {
        const { isReasoningEnabled, saveSettings } =
            await import('../settings');
        saveSettings({});
        expect(isReasoningEnabled()).toBe(false);
    });

    it('toggleReasoning toggles the value', async () => {
        const { toggleReasoning, isReasoningEnabled, saveSettings } =
            await import('../settings');
        saveSettings({});
        const before = isReasoningEnabled();
        const after = toggleReasoning();
        expect(after).toBe(!before);
    });
});
