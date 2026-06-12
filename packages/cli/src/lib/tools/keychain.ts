import { toolInputSchemas } from '@nightcode/shared';
import { keychain } from '@nightcode/shared';

export async function keychainSetTool(input: unknown) {
    const { name, value } = toolInputSchemas.keychainSet.parse(input);
    if (!keychain.isAvailable()) {
        return { output: 'OS keychain not available on this system' };
    }
    const success = await keychain.setKey(name, value);
    if (success) {
        return { output: `Stored "${name}" in OS keychain` };
    }
    return { output: `Failed to store "${name}" in keychain` };
}

export async function keychainGetTool(input: unknown) {
    const { name } = toolInputSchemas.keychainGet.parse(input);
    if (!keychain.isAvailable()) {
        return { output: 'OS keychain not available on this system' };
    }
    const value = await keychain.getKey(name);
    if (value) {
        return { output: `${name}: ${value}` };
    }
    return { output: `No secret found for "${name}"` };
}

export async function keychainDeleteTool(input: unknown) {
    const { name } = toolInputSchemas.keychainDelete.parse(input);
    if (!keychain.isAvailable()) {
        return { output: 'OS keychain not available on this system' };
    }
    const success = await keychain.deleteKey(name);
    if (success) {
        return { output: `Deleted "${name}" from keychain` };
    }
    return { output: `Failed to delete "${name}" from keychain` };
}
