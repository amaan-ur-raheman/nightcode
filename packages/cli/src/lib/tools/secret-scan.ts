import { readFile } from 'fs/promises';
import { join, relative } from 'path';

export interface SecretMatch {
    file: string;
    line: number;
    type: string;
    snippet: string;
    severity: 'high' | 'medium' | 'low';
}

const SECRET_PATTERNS: Array<{
    pattern: RegExp;
    type: string;
    severity: 'high' | 'medium' | 'low';
}> = [
    {
        pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]([^'"]+)['"]/gi,
        type: 'API Key',
        severity: 'high',
    },
    {
        pattern: /(?:secret|token)\s*[=:]\s*['"]([^'"]+)['"]/gi,
        type: 'Secret/Token',
        severity: 'high',
    },
    { pattern: /AKIA[0-9A-Z]{16}/g, type: 'AWS Access Key', severity: 'high' },
    {
        pattern: /(?:aws[_-]?secret)[\s=:]+['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
        type: 'AWS Secret Key',
        severity: 'high',
    },
    { pattern: /ghp_[A-Za-z0-9]{36}/g, type: 'GitHub Token', severity: 'high' },
    {
        pattern: /github[_-]?token\s*[=:]\s*['"]([^'"]+)['"]/gi,
        type: 'GitHub Token',
        severity: 'high',
    },
    {
        pattern: /(?:mysql|postgres|mongodb|redis):\/\/[^'"]+/gi,
        type: 'Database URL',
        severity: 'medium',
    },
    {
        pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
        type: 'Private Key',
        severity: 'high',
    },
    {
        pattern: /password\s*[=:]\s*['"]([^'"]+)['"]/gi,
        type: 'Password',
        severity: 'medium',
    },
    {
        pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
        type: 'JWT Token',
        severity: 'high',
    },
    {
        pattern: /xox[bpsar]-[A-Za-z0-9-]+/g,
        type: 'Slack Token',
        severity: 'high',
    },
    {
        pattern: /(?:sk|pk)_(?:test|live)_[A-Za-z0-9]+/g,
        type: 'Stripe Key',
        severity: 'high',
    },
    {
        pattern: /AC[A-Za-z0-9]{32}/g,
        type: 'Twilio Account SID',
        severity: 'medium',
    },
    {
        pattern:
            /(?:key|secret|token|password|credential)\s*[=:]\s*['"]([A-Za-z0-9-_]{20,})['"]/gi,
        type: 'Generic Secret',
        severity: 'low',
    },
];

async function scanFile(filePath: string, cwd: string): Promise<SecretMatch[]> {
    const matches: SecretMatch[] = [];
    try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, lineNum) => {
            for (const { pattern, type, severity } of SECRET_PATTERNS) {
                pattern.lastIndex = 0;
                if (pattern.test(line)) {
                    matches.push({
                        file: relative(cwd, filePath),
                        line: lineNum + 1,
                        type,
                        snippet: line.trim().substring(0, 80),
                        severity,
                    });
                }
            }
        });
    } catch {
        // Skip unreadable files
    }
    return matches;
}

export async function scanFilesForSecrets(
    filePaths: string[],
    cwd: string,
): Promise<SecretMatch[]> {
    const matches: SecretMatch[] = [];
    for (const filePath of filePaths) {
        const resolved = join(cwd, filePath);
        matches.push(...(await scanFile(resolved, cwd)));
    }
    return matches;
}
