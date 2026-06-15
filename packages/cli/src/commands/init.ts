import { mkdirSync, writeFileSync, existsSync } from 'fs';
import path, { join } from 'path';
import { execSync } from 'child_process';

interface InitOptions {
    name?: string;
    template?: 'basic' | 'fullstack' | 'api';
    git?: boolean;
}

const TEMPLATES = {
    basic: {
        description: 'Basic project with minimal config',
        files: {
            '.nightcode/settings.json': {
                mcp: { servers: {} },
            },
            '.nightcode/README.md':
                '# NightCode Project\n\nThis project is configured for NightCode.',
        },
    },
    fullstack: {
        description: 'Full-stack project with MCP servers',
        files: {
            '.nightcode/settings.json': {
                mcp: {
                    servers: {
                        filesystem: {
                            command: 'npx',
                            args: [
                                '-y',
                                '@modelcontextprotocol/server-filesystem',
                                '.',
                            ],
                        },
                    },
                },
            },
            '.nightcode/README.md':
                '# NightCode Full-Stack Project\n\nThis project includes MCP server configuration.',
        },
    },
    api: {
        description: 'API project with database tools',
        files: {
            '.nightcode/settings.json': {
                mcp: {
                    servers: {
                        postgres: {
                            command: 'npx',
                            args: [
                                '-y',
                                '@modelcontextprotocol/server-postgres',
                                'postgresql://localhost/mydb',
                            ],
                        },
                    },
                },
            },
            '.nightcode/README.md':
                '# NightCode API Project\n\nThis project includes database MCP server configuration.',
        },
    },
};

export function initCommand(options: InitOptions): void {
    const projectDir = process.cwd();
    const projectName =
        options.name || path.basename(projectDir) || 'nightcode-project';
    const templateKey = options.template || 'basic';
    const template = TEMPLATES[templateKey];

    console.log(`\nInitializing NightCode project: ${projectName}\n`);
    console.log(`Template: ${template.description}\n`);

    // Check for existing .nightcode directory
    const nightcodeDir = join(projectDir, '.nightcode');
    if (existsSync(nightcodeDir)) {
        console.log(
            '[WARNING] .nightcode directory already exists. Skipping initialization.',
        );
        console.log('   Remove it first if you want to re-initialize.\n');
        return;
    }

    // Create .nightcode directory
    mkdirSync(nightcodeDir, { recursive: true });

    // Write template files
    for (const [filePath, content] of Object.entries(template.files)) {
        const fullPath = join(projectDir, filePath);
        const dir = path.dirname(fullPath);
        mkdirSync(dir, { recursive: true });

        if (typeof content === 'object') {
            writeFileSync(fullPath, JSON.stringify(content, null, 2), 'utf-8');
        } else {
            writeFileSync(fullPath, content, 'utf-8');
        }
        console.log(`  [OK] Created ${filePath}`);
    }

    // Initialize git if requested
    if (options.git !== false) {
        try {
            let isInsideGit = false;
            try {
                const gitStatus = execSync(
                    'git rev-parse --is-inside-work-tree',
                    {
                        cwd: projectDir,
                        stdio: ['ignore', 'pipe', 'ignore'],
                    },
                )
                    .toString()
                    .trim();
                isInsideGit = gitStatus === 'true';
            } catch {
                // Not a git repository or git not installed
            }

            if (isInsideGit) {
                console.log(
                    '  [WARNING] Directory is already inside a Git repository. Skipping Git initialization.',
                );
            } else {
                execSync('git init', { cwd: projectDir, stdio: 'ignore' });
                execSync('git add .', { cwd: projectDir, stdio: 'ignore' });
                execSync('git commit -m "Initial NightCode setup"', {
                    cwd: projectDir,
                    stdio: 'ignore',
                });
                console.log('  [OK] Initialized git repository');
            }
        } catch (error) {
            const errorMsg =
                error instanceof Error ? error.message : String(error);
            console.log(
                `  [WARNING] Git initialization skipped/failed in ${projectDir}: ${errorMsg}`,
            );
        }
    }

    console.log('\nNightCode project initialized!\n');
    console.log('Next steps:');
    console.log('  1. Run `nightcode` to start the TUI');
    console.log('  2. Configure MCP servers in .nightcode/settings.json');
    console.log('  3. Start coding!\n');
}
