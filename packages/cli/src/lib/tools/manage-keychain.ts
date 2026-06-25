import { toolInputSchemas } from '@nightcode/shared';
import { keychain } from '@nightcode/shared';

export async function manageKeychainTool(input: unknown) {
    const parsed = toolInputSchemas.manage_keychain.parse(input);
    const { action, name, value } = parsed;

    if (!keychain.isAvailable()) {
        return { output: 'OS keychain not available on this system' };
    }

    if (action === 'set') {
        if (value === undefined)
            throw new Error('value is required for set action');
        const success = await keychain.setKey(name, value);
        if (success) {
            return { output: `Stored "${name}" in OS keychain` };
        }
        return { output: `Failed to store "${name}" in keychain` };
    }

    if (action === 'get') {
        const secret = await keychain.getKey(name);
        if (secret) {
            return { output: `${name}: ${secret}` };
        }
        return { output: `No secret found for "${name}"` };
    }

    if (action === 'delete') {
        const success = await keychain.deleteKey(name);
        if (success) {
            return { output: `Deleted "${name}" from keychain` };
        }
        return { output: `Failed to delete "${name}" from keychain` };
    }

    throw new Error(`Unknown action: ${action}`);
}
