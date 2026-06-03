import { readFileSync, readdirSync } from "fs";
import { join, resolve, sep } from "path";
import { homedir } from "os";

export type Skill = {
    name: string;
    description: string;
    dirName: string;
};

const SKILLS_DIR = join(homedir(), ".agents", "skills");

function parseFrontmatter(content: string): Record<string, string> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const result: Record<string, string> = {};
    // Handle both single-line and multi-line (block scalar) values
    const lines = match[1]!.split("\n");
    let currentKey = "";
    let inBlock = false;
    const blockLines: string[] = [];

    for (const line of lines) {
        const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
        if (keyMatch) {
            if (inBlock && currentKey) {
                result[currentKey] = blockLines.join(" ").trim();
                blockLines.length = 0;
                inBlock = false;
            }
            currentKey = keyMatch[1]!;
            const val = keyMatch[2]!.trim();
            if (val === "" || val === "|" || val === ">") {
                inBlock = true;
            } else {
                result[currentKey] = val.replace(/^["']|["']$/g, "");
            }
        } else if (inBlock && line.startsWith("  ")) {
            blockLines.push(line.trim());
        }
    }

    if (inBlock && currentKey) {
        result[currentKey] = blockLines.join(" ").trim();
    }

    return result;
}

export function loadSkillContent(name: string): string | null {
    try {
        const resolved = resolve(join(SKILLS_DIR, name, "SKILL.md"));
        if (!resolved.startsWith(resolve(SKILLS_DIR) + sep)) return null;
        const raw = readFileSync(resolved, "utf8");
        return raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    } catch {
        return null;
    }
}

export function loadSkills(): Skill[] {
    try {
        const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

        const skills: Skill[] = [];

        for (const dir of dirs) {
            const skillFile = join(SKILLS_DIR, dir, "SKILL.md");
            try {
                const content = readFileSync(skillFile, "utf8");
                const fm = parseFrontmatter(content);
                if (fm.name) {
                    skills.push({
                        name: fm.name,
                        description: fm.description ?? "",
                        dirName: dir,
                    });
                }
            } catch {
                // Skip skills with missing or unreadable SKILL.md
            }
        }

        return skills.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        return [];
    }
}
