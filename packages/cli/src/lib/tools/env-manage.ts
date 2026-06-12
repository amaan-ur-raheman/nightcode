import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { toolInputSchemas } from '@nightcode/shared';
import { resolveInsideCwd } from './utils';
import { undoManager } from '../undo-manager';

interface EnvVar {
    key: string;
    value: string;
    line: number;
}

function parseEnvFile(content: string): EnvVar[] {
    const vars: EnvVar[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
        const trimmed = line.trim();

        if (trimmed.startsWith('#') || !trimmed.includes('=')) {
            return;
        }

        const eqIndex = trimmed.indexOf('=');
        const key = trimmed.substring(0, eqIndex).trim();
        const rawValue = trimmed.substring(eqIndex + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, '');

        vars.push({ key, value, line: index + 1 });
    });

    return vars;
}

export async function envManageTool(input: unknown) {
    const { action, key, value, file } =
        toolInputSchemas.envManage.parse(input);
    const envFilePath = file || '.env';
    const { cwd, resolved } = resolveInsideCwd(envFilePath);

    switch (action) {
        case 'read': {
            if (!existsSync(resolved)) {
                return { error: `File not found: ${envFilePath}` };
            }
            const content = await readFile(resolved, 'utf-8');
            return {
                content,
                path: envFilePath,
                lines: content.split('\n').length,
            };
        }

        case 'list': {
            if (!existsSync(resolved)) {
                return { error: `File not found: ${envFilePath}` };
            }
            const content = await readFile(resolved, 'utf-8');
            const vars = parseEnvFile(content);

            if (vars.length === 0) {
                return { variables: [], path: envFilePath, count: 0 };
            }

            return {
                variables: vars.map((v) => ({
                    key: v.key,
                    value: v.value,
                    line: v.line,
                })),
                path: envFilePath,
                count: vars.length,
            };
        }

        case 'add': {
            if (!key) return { error: 'key is required for add action' };
            if (value === undefined)
                return { error: 'value is required for add action' };

            let content = '';
            if (existsSync(resolved)) {
                content = await readFile(resolved, 'utf-8');
            }

            const vars = parseEnvFile(content);
            if (vars.some((v) => v.key === key)) {
                return {
                    error: `Variable ${key} already exists. Use 'update' action instead.`,
                };
            }

            const newLine =
                content.length > 0 && !content.endsWith('\n') ? '\n' : '';
            const updated = `${content}${newLine}${key}=${value}\n`;

            await undoManager.backup(
                resolved,
                'envManage',
                `Add ${key} to ${envFilePath}`,
            );
            await writeFile(resolved, updated, 'utf-8');

            return {
                success: true,
                action: 'add',
                key,
                value,
                path: envFilePath,
            };
        }

        case 'update': {
            if (!key) return { error: 'key is required for update action' };
            if (value === undefined)
                return { error: 'value is required for update action' };

            if (!existsSync(resolved)) {
                return { error: `File not found: ${envFilePath}` };
            }

            const content = await readFile(resolved, 'utf-8');
            const lines = content.split('\n');
            let found = false;

            for (let i = 0; i < lines.length; i++) {
                const rawLine = lines[i];
                if (rawLine === undefined) continue;
                const line = rawLine.trim();

                if (line.startsWith('#') || !line.includes('=')) {
                    continue;
                }

                const eqIndex = line.indexOf('=');
                const lineKey = line.substring(0, eqIndex).trim();

                if (lineKey === key) {
                    // Preserve leading whitespace from the original line
                    const leadingWhitespace = rawLine.match(/^\s*/)?.[0] ?? '';
                    lines[i] = `${leadingWhitespace}${key}=${value}`;
                    found = true;
                    break;
                }
            }

            if (!found) {
                return {
                    error: `Variable ${key} not found. Use 'add' action instead.`,
                };
            }

            await undoManager.backup(
                resolved,
                'envManage',
                `Update ${key} in ${envFilePath}`,
            );
            await writeFile(resolved, lines.join('\n'), 'utf-8');

            return {
                success: true,
                action: 'update',
                key,
                value,
                path: envFilePath,
            };
        }

        case 'delete': {
            if (!key) return { error: 'key is required for delete action' };

            if (!existsSync(resolved)) {
                return { error: `File not found: ${envFilePath}` };
            }

            const content = await readFile(resolved, 'utf-8');
            const lines = content.split('\n');

            const newLines = lines.filter((line) => {
                const trimmed = line.trim();

                if (trimmed.startsWith('#') || !trimmed.includes('=')) {
                    return true;
                }

                const eqIndex = trimmed.indexOf('=');
                const lineKey = trimmed.substring(0, eqIndex).trim();

                return lineKey !== key;
            });

            if (newLines.length === lines.length) {
                return { error: `Variable ${key} not found in ${envFilePath}` };
            }

            await undoManager.backup(
                resolved,
                'envManage',
                `Delete ${key} from ${envFilePath}`,
            );
            await writeFile(resolved, newLines.join('\n'), 'utf-8');

            return { success: true, action: 'delete', key, path: envFilePath };
        }

        default:
            return { error: `Unknown action: ${action}` };
    }
}
