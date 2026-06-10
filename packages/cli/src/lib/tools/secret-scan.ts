import { readFile } from "fs/promises";
import { join, relative } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { resolveInsideCwd } from "./utils";

interface SecretMatch {
    file: string;
    line: number;
    type: string;
    snippet: string;
    severity: "high" | "medium" | "low";
}

const SECRET_PATTERNS: Array<{ pattern: RegExp; type: string; severity: "high" | "medium" | "low" }> = [
    // API Keys
    { pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]([^'"]+)['"]/gi, type: "API Key", severity: "high" },
    { pattern: /(?:secret|token)\s*[=:]\s*['"]([^'"]+)['"]/gi, type: "Secret/Token", severity: "high" },

    // AWS
    { pattern: /AKIA[0-9A-Z]{16}/g, type: "AWS Access Key", severity: "high" },
    { pattern: /(?:aws[_-]?secret)[\s=:]+['"]?([A-Za-z0-9/+=]{40})['"]?/gi, type: "AWS Secret Key", severity: "high" },

    // GitHub
    { pattern: /ghp_[A-Za-z0-9]{36}/g, type: "GitHub Token", severity: "high" },
    { pattern: /github[_-]?token\s*[=:]\s*['"]([^'"]+)['"]/gi, type: "GitHub Token", severity: "high" },

    // Database URLs
    { pattern: /(?:mysql|postgres|mongodb|redis):\/\/[^'"]+/gi, type: "Database URL", severity: "medium" },

    // Private keys
    { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, type: "Private Key", severity: "high" },

    // Passwords
    { pattern: /password\s*[=:]\s*['"]([^'"]+)['"]/gi, type: "Password", severity: "medium" },

    // JWT
    { pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g, type: "JWT Token", severity: "high" },

    // Slack
    { pattern: /xox[bpsar]-[A-Za-z0-9-]+/g, type: "Slack Token", severity: "high" },

    // Stripe
    { pattern: /(?:sk|pk)_(?:test|live)_[A-Za-z0-9]+/g, type: "Stripe Key", severity: "high" },

    // Twilio
    { pattern: /AC[A-Za-z0-9]{32}/g, type: "Twilio Account SID", severity: "medium" },

    // Generic
    { pattern: /(?:key|secret|token|password|credential)\s*[=:]\s*['"]([A-Za-z0-9-_]{20,})['"]/gi, type: "Generic Secret", severity: "low" },
];

async function scanFile(filePath: string, cwd: string): Promise<SecretMatch[]> {
    const matches: SecretMatch[] = [];

    try {
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");

        lines.forEach((line, lineNum) => {
            for (const { pattern, type, severity } of SECRET_PATTERNS) {
                // Reset lastIndex for global regexes and reuse the original pattern
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

export async function secretScanTool(input: unknown) {
    const { path: targetPath, recursive } = toolInputSchemas.secretScan.parse(input);
    const { cwd, resolved } = resolveInsideCwd(targetPath);
    const matches: SecretMatch[] = [];

    if (recursive) {
        const { readdir, stat } = await import("fs/promises");

        const scanDir = async (dir: string) => {
            let entries: string[];
            try {
                entries = await readdir(dir);
            } catch {
                return;
            }

            for (const entry of entries) {
                if (entry.startsWith(".") || entry === "node_modules") continue;

                const fullPath = join(dir, entry);
                try {
                    const stats = await stat(fullPath);
                    if (stats.isDirectory()) {
                        await scanDir(fullPath);
                    } else if (/\.(ts|tsx|js|jsx|json|env|yaml|yml|toml|ini|cfg|conf|py|rb|go|rs|java|sh|zsh)$/i.test(entry)) {
                        matches.push(...await scanFile(fullPath, cwd));
                    }
                } catch {
                    // Skip inaccessible entries
                }
            }
        };

        await scanDir(resolved);
    } else {
        matches.push(...await scanFile(resolved, cwd));
    }

    if (matches.length === 0) {
        return { secrets: [], count: 0, message: "No secrets found." };
    }

    // Group by severity
    const high = matches.filter(m => m.severity === "high");
    const medium = matches.filter(m => m.severity === "medium");
    const low = matches.filter(m => m.severity === "low");

    const summary: string[] = [];
    if (high.length > 0) summary.push(`HIGH: ${high.length}`);
    if (medium.length > 0) summary.push(`MEDIUM: ${medium.length}`);
    if (low.length > 0) summary.push(`LOW: ${low.length}`);

    return {
        secrets: matches,
        count: matches.length,
        summary: summary.join(", "),
        warning: "False positives are possible. Review each finding before acting.",
    };
}
