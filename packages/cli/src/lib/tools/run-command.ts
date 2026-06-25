import { toolInputSchemas } from '@nightcode/shared';
import { checkCommandSafety } from './dangerous-ops';
import {
    MAX_OUTPUT,
    truncate,
    MAX_FILE_SIZE,
    resolveInsideCwd,
    isPrivateHost,
} from './utils';
import { ptySessionManager } from '../pty-session';
import { getProjectCwd } from '../workspace-context';
import { loadSettings } from '../settings';
import { replRunner } from '../repl-runner';
import { runCommand } from '../command-runner';
import { existsSync } from 'fs';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { undoManager } from '../undo-manager';
import { autoFixPipeline } from '../auto-fix-pipeline';
import { runProfiler } from '@/lib/performance-profiler';

const MAX_STREAM_BUFFER = 50_000;
const TRIM_STREAM_BUFFER = 30_000;

function wrapCommandWithDocker(
    command: string,
    cwd: string,
    env: Record<string, string> = {},
): string[] {
    const settings = loadSettings();
    const sandboxImage = settings.sandbox?.image ?? 'node:18-alpine';

    const args = [
        'run',
        '--rm',
        '-i',
        '-v',
        `${cwd}:/workspace`,
        '-w',
        '/workspace',
    ];

    for (const [key, val] of Object.entries(env)) {
        if (['PATH', 'HOME', 'USER', 'SHELL', 'EDITOR', 'TERM'].includes(key))
            continue;
        args.push('-e', `${key}=${val}`);
    }

    args.push(sandboxImage, 'sh', '-c', command);
    return args;
}

function spawnCommand(command: string, options: Record<string, any>) {
    const settings = loadSettings();
    if (settings.sandbox?.enabled) {
        const cwd = options.cwd ?? getProjectCwd();
        const env = options.env ?? {};
        const dockerArgs = wrapCommandWithDocker(command, cwd, env);
        return Bun.spawn(['docker', ...dockerArgs], {
            ...options,
            cwd: undefined,
        });
    }
    return Bun.spawn(['bash', '-c', command], options);
}

function killProcessGroup(proc: {
    pid?: number | null;
    kill: (signal?: any) => void;
}) {
    try {
        if (proc.pid) {
            Bun.spawnSync(['pkill', '-9', '-P', String(proc.pid)]);
        }
    } catch {}

    try {
        if (proc.pid) {
            process.kill(-proc.pid, 'SIGKILL');
            return;
        }
    } catch {}

    try {
        proc.kill('SIGKILL');
    } catch {}
}

async function readStreamToBuffer(
    stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
    if (!stream) return '';
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value);
            if (buffer.length > MAX_STREAM_BUFFER) {
                buffer = buffer.slice(-TRIM_STREAM_BUFFER);
            }
        }
    } catch {}
    return buffer;
}

// Env helpers
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

// Process helpers
const execAsync = async (
    cmd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const proc = Bun.spawn(['bash', '-c', cmd], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: await proc.exited,
    };
};

const PROTECTED_PATTERNS = [
    /^kernel_task$/i,
    /^launchd$/i,
    /^systemd$/i,
    /^init$/i,
    /^ssh$/i,
    /^sshd$/i,
    /^sudo$/i,
    /^login$/i,
    /^WindowServer$/i,
    /^mds$/i,
    /^mdworker$/i,
    /^securityd$/i,
    /^taskgated$/i,
    /^taskgatedd$/i,
    /^diskarbitrationd$/i,
    /^fseventsd$/i,
    /^coreaudiod$/i,
    /^bluetoothd$/i,
    /^configd$/i,
    /^distnoted$/i,
    /^notifyd$/i,
    /^DirectoryService$/i,
    /^lookupd$/i,
    /^cloudd$/i,
    /^bird$/i,
    /^aggregated$/i,
    /^ambientd$/i,
    /^analyticsd$/i,
    /^APFSArbitrator$/i,
    /^askpermissiond$/i,
    /^AudioVisualServicesd$/i,
    /^avconferenced$/i,
    /^Aurora$/i,
    /^backupd$/i,
    /^biomesyncd$/i,
    /^biometrickitd$/i,
    /^bootpd$/i,
    /^cfd$/i,
    /^cfprefsd$/i,
    /^commcenter$/i,
    /^ContainerManagerService$/i,
    /^containersubsd$/i,
    /^CoreLocationAgent$/i,
    /^coremlserviced$/i,
    /^csh$/i,
    /^DashboardClient$/i,
    /^dataaccessd$/i,
    /^dbfseventsd$/i,
    /^DuetHeuristic-BM$/i,
    /^EIMAgent$/i,
    /^eventmonitor$/i,
    /^familycontrolsd$/i,
    /^familynotificationd$/i,
    /^gamed$/i,
    /^gpuserved$/i,
    /^gpsd$/i,
    /^hidd$/i,
    /^IMTransferAgent$/i,
    /^installd$/i,
    /^InterestingDeviceReader$/i,
    /^karl$/i,
    /^kbd$/i,
    /^keybagd$/i,
    /^keychainaccess$/i,
    /^kididded$/i,
    /^knowledged$/i,
    /^launchctl$/i,
    /^locationd$/i,
    /^logd$/i,
    /^loginwindow$/i,
    /^MailTimeMachineAgent$/i,
    /^mDNSResponder$/i,
    /^mediaanalysisd$/i,
    /^MetricsCollector$/i,
    /^miccd$/i,
    /^midiclockserviced$/i,
    /^misd$/i,
    /^mobileassetd$/i,
    /^mobilewalletd$/i,
    /^mount_triggers$/i,
    /^neagent$/i,
    /^NEHelper$/i,
    /^nesessionmanager$/i,
    /^netbiosd$/i,
    /^NetworkBrowserAgent$/i,
    /^nsurlsessiond$/i,
    /^ntpd$/i,
    /^pairviewd$/i,
    /^parsinghelperd$/i,
    /^photoanalysisd$/i,
    /^photolibraryd$/i,
    /^pkd$/i,
    /^PowerUIAgent$/i,
    /^reportcrash$/i,
    /^ReportCrash$/i,
    /^routined$/i,
    /^SCHelper$/i,
    /^siriknowledged$/i,
    /^SiriNCXPCService$/i,
    /^slptimed$/i,
    /^SMBXPCService$/i,
    /^softwareupdateagentd$/i,
    /^spind$/i,
    /^spotlightknowledged$/i,
    /^SpotlightNetAgent$/i,
    /^StorageKitHelper$/i,
    /^symptomsd$/i,
    /^sysdiagnose$/i,
    /^SystemStatusBus$/i,
    /^TailspinAgent$/i,
    /^Talkd$/i,
    /^thermalmonitord$/i,
    /^tiad$/i,
    /^TranslationSubServices$/i,
    /^trustd$/i,
    /^trustevaluationagent$/i,
    /^Ubiquity$/i,
    /^universalaccessd$/i,
    /^unmountall$/i,
    /^update_triggers$/i,
    /^USBAgent$/i,
    /^vfsd$/i,
    /^warmd$/i,
    /^webinspectord$/i,
    /^WiFiAgent$/i,
    /^wifivelocityd$/i,
    /^wlanfexcd$/i,
    /^XprotectService$/i,
    /^zrok$/i,
];

function isProtectedProcess(name: string): boolean {
    return PROTECTED_PATTERNS.some((p) => p.test(name));
}

function extractProcessName(command: string): string {
    const parts = command.split('/');
    const base = parts[parts.length - 1] ?? '';
    return base
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .replace(/\.js$/, '')
        .replace(/\.ts$/, '');
}

async function listProcesses(name?: string): Promise<string> {
    try {
        let cmd = 'ps aux';
        if (name) {
            const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '');
            if (!safeName) return 'Invalid process name filter.';
            cmd += ` | grep -i "${safeName}" | grep -v grep`;
        } else {
            cmd +=
                ' | grep -E "(node|bun|deno|python|go|cargo|ruby|java|webpack|vite|next|nuxt|remix|astro|bunx|tsx|ts-node|esbuild|tailwind)" | grep -v grep | head -30';
        }
        const { stdout, exitCode } = await execAsync(cmd);
        if (exitCode !== 0 || !stdout.trim())
            return 'No matching processes found.';
        const lines = stdout.trim().split('\n');
        const output = lines
            .map((line) => {
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[1] ?? '0');
                const cpu = parts[2] ?? '0';
                const memory = parts[3] ?? '0';
                const command = parts.slice(10).join(' ');
                const pName = extractProcessName(command);
                const protected_ = isProtectedProcess(pName);
                return `PID: ${pid} | CPU: ${cpu}% | MEM: ${memory}% | ${pName}${protected_ ? ' [PROTECTED]' : ''}\n  CMD: ${command}`;
            })
            .join('\n');
        return output;
    } catch (error: any) {
        return `Error listing processes: ${error.message}`;
    }
}

async function killProcess(pid: number, force = false): Promise<string> {
    if (!pid || pid <= 0) return 'A valid PID is required for kill action.';
    try {
        const { stdout } = await execAsync(`ps -p ${pid} -o comm=`);
        const name = stdout.trim();
        if (isProtectedProcess(name))
            return `Cannot kill protected system process: ${name} (PID: ${pid})`;
    } catch {
        return `Process ${pid} not found.`;
    }
    try {
        if (force) {
            await execAsync(`kill -9 ${pid}`);
            return `Force killed process ${pid}`;
        }
        await execAsync(`kill ${pid}`);
        await new Promise((r) => setTimeout(r, 500));
        try {
            await execAsync(`kill -0 ${pid}`);
            await execAsync(`kill -9 ${pid}`);
            return `Process ${pid} did not stop with SIGTERM, force killed with SIGKILL`;
        } catch {
            return `Killed process ${pid}`;
        }
    } catch (error: any) {
        return `Error killing process ${pid}: ${error.message}`;
    }
}

async function listPorts(port?: number): Promise<string> {
    try {
        const cmd = port
            ? `lsof -i :${port} -P -n 2>/dev/null`
            : 'lsof -i -P -n 2>/dev/null | grep LISTEN | head -30';
        const { stdout, exitCode } = await execAsync(cmd);
        if (exitCode !== 0 || !stdout.trim())
            return port
                ? `No process listening on port ${port}`
                : 'No listening ports found.';
        const lines = stdout.trim().split('\n');
        if (port && lines[0]) {
            const parts = lines[0].trim().split(/\s+/);
            return `Port ${port} is in use:\n  Process: ${parts[0]} (PID: ${parts[1]}, User: ${parts[2]})\n  Address: ${parts[8]}`;
        }
        return lines
            .map((line) => {
                const parts = line.trim().split(/\s+/);
                return `${parts[0]} (PID: ${parts[1]}) → ${parts[8]}`;
            })
            .join('\n');
    } catch (error: any) {
        return `Error listing ports: ${error.message}`;
    }
}

// Package manager helpers
type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';
function detectPackageManager(cwd: string): PackageManager {
    if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock')))
        return 'bun';
    if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
    return 'npm';
}
async function runPackageManager(
    cwd: string,
    pm: PackageManager,
    args: string[],
) {
    const result = await runCommand(pm, args, cwd);
    if (result.exitCode !== 0) {
        return {
            success: false,
            output: result.stderr || result.stdout || `${pm} command failed`,
        };
    }
    return { success: true, output: result.stdout };
}

// Token count helpers
const COST_PER_1K_INPUT_TOKENS = 0.0003;
const COST_PER_1K_OUTPUT_TOKENS = 0.0006;
function isLikelyCode(text: string): boolean {
    const codeIndicators = [
        /[{}\[\]();]/,
        /=>|===|!==|&&|\|\||\n\s{2,}/,
        /\b(const|let|var|function|return|import|export|class|if|else|for|while)\b/,
    ];
    let matches = 0;
    for (const re of codeIndicators) {
        if (re.test(text)) matches++;
    }
    return matches >= 2;
}
function estimateTokens(text: string): number {
    const words = text.split(/\s+/).filter(Boolean).length;
    const ratio = isLikelyCode(text) ? 1.5 : 1.3;
    return Math.ceil(words * ratio);
}

export async function runCommandTool(
    input: unknown,
    _parentMode?: string,
    _parentModel?: string,
    signal?: AbortSignal,
) {
    const parsed = toolInputSchemas.run_command.parse(input);
    const { action } = parsed;

    if (action === 'bash') {
        if (signal?.aborted)
            return {
                stdout: '',
                stderr: 'Command aborted',
                exitCode: 1,
                timedOut: false,
            };
        const { command, timeout } = parsed;
        if (!command) throw new Error('command is required for bash action');
        const safety = checkCommandSafety(command);
        if (safety.blocked) {
            return {
                stdout: '',
                stderr: safety.warning ?? 'Command blocked by safety policy',
                exitCode: 1,
                timedOut: false,
                warning: safety.warning,
            };
        }
        let timedOut = false;
        const proc = spawnCommand(command, {
            cwd: getProjectCwd(),
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, TERM: 'dumb' },
            detached: true,
        });

        const [stdout1, stdout2] = proc.stdout
            ? (proc.stdout as any).tee()
            : [null, null];
        const [stderr1, stderr2] = proc.stderr
            ? (proc.stderr as any).tee()
            : [null, null];
        const stdoutPromise = readStreamToBuffer(stdout1);
        const stderrPromise = readStreamToBuffer(stderr1);

        const managerProc = {
            stdout: stdout2,
            stderr: stderr2,
            stdin: proc.stdin,
            exited: proc.exited,
            pid: proc.pid,
            kill: (sig?: any) => proc.kill(sig),
        };
        ptySessionManager.registerProcess(managerProc, command);

        const attachTimer = setTimeout(() => {
            if (proc.pid) ptySessionManager.attach();
        }, 1500);

        const timer = setTimeout(() => {
            timedOut = true;
            killProcessGroup(proc);
        }, timeout);

        const onAbort = () => killProcessGroup(proc);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort);

        let exitCode = 1;
        try {
            exitCode = await proc.exited;
        } finally {
            clearTimeout(attachTimer);
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }

        let stdout = '';
        let stderr = '';
        if (!signal?.aborted && !timedOut) {
            let checkAbort: (() => void) | undefined;
            try {
                const [out, err] = await Promise.race([
                    Promise.all([stdoutPromise, stderrPromise]),
                    new Promise<[string, string]>((_, reject) => {
                        checkAbort = () => reject(new Error('Aborted'));
                        signal?.addEventListener('abort', checkAbort);
                    }),
                ]);
                stdout = out;
                stderr = err;
            } catch {
            } finally {
                if (checkAbort)
                    signal?.removeEventListener('abort', checkAbort);
            }
        }

        const result: any = {
            stdout: truncate(stdout, MAX_OUTPUT),
            stderr: truncate(stderr, MAX_OUTPUT),
            exitCode,
            timedOut,
        };
        if (safety.warning) result.warning = safety.warning;
        return result;
    }

    if (action === 'repl') {
        const { command } = parsed;
        if (!command) throw new Error('command is required for repl action');
        const output = await replRunner.execute(command);
        return { output };
    }

    if (action === 'package_manager') {
        const {
            pmAction,
            pmPackages,
            pmIsDev,
            packageManager: pmInput,
        } = parsed;
        if (!pmAction)
            throw new Error('pmAction is required for package_manager action');
        const cwd = getProjectCwd();
        const pm = pmInput === 'auto' ? detectPackageManager(cwd) : pmInput;
        try {
            switch (pmAction) {
                case 'install': {
                    const result = await runPackageManager(cwd, pm, [
                        'install',
                    ]);
                    return {
                        success: result.success,
                        output: result.output,
                        packageManager: pm,
                    };
                }
                case 'add': {
                    if (!pmPackages || pmPackages.length === 0)
                        return {
                            success: false,
                            output: 'pmPackages is required for add',
                        };
                    const sub = pm === 'npm' ? 'install' : 'add';
                    const args = [sub];
                    if (pmIsDev) args.push('--save-dev');
                    args.push(...pmPackages);
                    const result = await runPackageManager(cwd, pm, args);
                    return {
                        success: result.success,
                        output: result.output,
                        packageManager: pm,
                        packagesAdded: pmPackages,
                    };
                }
                case 'remove': {
                    if (!pmPackages || pmPackages.length === 0)
                        return {
                            success: false,
                            output: 'pmPackages is required for remove',
                        };
                    const sub = pm === 'npm' ? 'uninstall' : 'remove';
                    const result = await runPackageManager(cwd, pm, [
                        sub,
                        ...pmPackages,
                    ]);
                    return {
                        success: result.success,
                        output: result.output,
                        packageManager: pm,
                        packagesRemoved: pmPackages,
                    };
                }
                case 'update': {
                    const args =
                        pmPackages && pmPackages.length > 0
                            ? ['update', ...pmPackages]
                            : ['update'];
                    const result = await runPackageManager(cwd, pm, args);
                    return {
                        success: result.success,
                        output: result.output,
                        packageManager: pm,
                    };
                }
                case 'list': {
                    const result = await runPackageManager(cwd, pm, [
                        'list',
                        '--depth=0',
                    ]);
                    return {
                        success: result.success,
                        output: result.output,
                        packageManager: pm,
                    };
                }
                case 'outdated': {
                    const result = await runPackageManager(cwd, pm, [
                        'outdated',
                    ]);
                    return {
                        success: result.success,
                        output: result.output,
                        packageManager: pm,
                    };
                }
            }
        } catch (err: any) {
            return { success: false, output: err.message };
        }
    }

    if (action === 'env') {
        const {
            envAction,
            envKey: key,
            envValue: value,
            envFile: file,
        } = parsed;
        if (!envAction) throw new Error('envAction is required for env action');
        const envFilePath = file || '.env';
        const { resolved } = resolveInsideCwd(envFilePath);
        switch (envAction) {
            case 'read': {
                if (!existsSync(resolved))
                    return { error: `File not found: ${envFilePath}` };
                const content = await readFile(resolved, 'utf-8');
                return {
                    content,
                    path: envFilePath,
                    lines: content.split('\n').length,
                };
            }
            case 'list': {
                if (!existsSync(resolved))
                    return { error: `File not found: ${envFilePath}` };
                const content = await readFile(resolved, 'utf-8');
                const vars = parseEnvFile(content);
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
                if (!key) return { error: 'envKey is required for add action' };
                if (value === undefined)
                    return { error: 'envValue is required for add action' };
                let content = '';
                if (existsSync(resolved))
                    content = await readFile(resolved, 'utf-8');
                const vars = parseEnvFile(content);
                if (vars.some((v) => v.key === key))
                    return { error: `Variable ${key} already exists.` };
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
                if (!key)
                    return { error: 'envKey is required for update action' };
                if (value === undefined)
                    return { error: 'envValue is required for update action' };
                if (!existsSync(resolved))
                    return { error: `File not found: ${envFilePath}` };
                const content = await readFile(resolved, 'utf-8');
                const lines = content.split('\n');
                let found = false;
                for (let i = 0; i < lines.length; i++) {
                    const rawLine = lines[i];
                    if (rawLine === undefined) continue;
                    if (
                        rawLine.trim().startsWith('#') ||
                        !rawLine.trim().includes('=')
                    )
                        continue;
                    const eqIndex = rawLine.trim().indexOf('=');
                    const lineKey = rawLine.trim().substring(0, eqIndex).trim();
                    if (lineKey === key) {
                        const leadingWhitespace =
                            rawLine.match(/^\s*/)?.[0] ?? '';
                        lines[i] = `${leadingWhitespace}${key}=${value}`;
                        found = true;
                        break;
                    }
                }
                if (!found) return { error: `Variable ${key} not found.` };
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
                if (!key)
                    return { error: 'envKey is required for delete action' };
                if (!existsSync(resolved))
                    return { error: `File not found: ${envFilePath}` };
                const content = await readFile(resolved, 'utf-8');
                const lines = content.split('\n');
                const newLines = lines.filter((line) => {
                    if (
                        line.trim().startsWith('#') ||
                        !line.trim().includes('=')
                    )
                        return true;
                    const eqIndex = line.trim().indexOf('=');
                    return line.trim().substring(0, eqIndex).trim() !== key;
                });
                if (newLines.length === lines.length)
                    return { error: `Variable ${key} not found.` };
                await undoManager.backup(
                    resolved,
                    'envManage',
                    `Delete ${key} from ${envFilePath}`,
                );
                await writeFile(resolved, newLines.join('\n'), 'utf-8');
                return {
                    success: true,
                    action: 'delete',
                    key,
                    path: envFilePath,
                };
            }
        }
    }

    if (action === 'process') {
        const { procAction, procPort, procPid, procName, procForce } = parsed;
        if (!procAction)
            throw new Error('procAction is required for process action');
        let result = '';
        if (procAction === 'list') result = await listProcesses(procName);
        else if (procAction === 'kill')
            result = await killProcess(procPid ?? 0, procForce);
        else if (procAction === 'list-ports')
            result = await listPorts(procPort);
        return {
            stdout: truncate(result, MAX_OUTPUT),
            stderr: '',
            exitCode: 0,
            timedOut: false,
        };
    }

    if (action === 'validate_code') {
        const {
            valFiles: files,
            valTypecheck: typecheck,
            valLint: lint,
            valTest: test,
            valAutoFix: autoFix,
        } = parsed;
        const resolvedFiles = (files ?? []).map((f) => {
            try {
                return resolveInsideCwd(f).resolved;
            } catch {
                return f;
            }
        });
        const filesToCheck =
            resolvedFiles.length > 0
                ? resolvedFiles
                : autoFixPipeline.getModifiedFiles();
        if (filesToCheck.length === 0) {
            return {
                success: true,
                message:
                    'No modified files to validate. Make some code changes first, or specify files to check.',
                report: null,
            };
        }
        const report = await autoFixPipeline.runChecks(filesToCheck, {
            typecheck,
            lint,
            test,
            autoFix,
        });
        const output = formatValidationReport(report);
        return {
            success: report.success,
            output,
            report: {
                filesChecked: report.filesChecked,
                success: report.success,
                summary: report.summary,
                errors: report.results.flatMap((r) =>
                    r.errors.map((e) => ({
                        check: r.checkType,
                        file: e.file,
                        line: e.line,
                        message: e.message,
                        rule: e.rule,
                        severity: e.severity,
                    })),
                ),
                autoFixAttempted: report.autoFixAttempted,
                autoFixResult: report.autoFixResult,
            },
        };
    }

    if (action === 'profile_code') {
        const { profFilter: filter, profCommand: command } = parsed;
        const report = await runProfiler({
            filter: filter ?? undefined,
            command: command ?? undefined,
        });
        return {
            success: report.success,
            benchmarkTool: report.benchmarkTool,
            command: report.command,
            durationMs: report.durationMs,
            totalBenchmarks: report.benchmarks.length,
            summary: report.summary,
            hotspots: report.hotspots.map((h) => ({
                name: h.name,
                opsPerSec: h.opsPerSec,
                avgTimeNs: h.avgTimeNs,
                margin: h.margin,
                rank: h.rank,
            })),
            error: report.error,
        };
    }

    if (action === 'token_count') {
        const { tcText: text } = parsed;
        if (text === undefined)
            throw new Error('tcText is required for token_count action');
        const tokenCount = estimateTokens(text);
        return {
            tokenCount,
            wordCount: text.split(/\s+/).filter(Boolean).length,
            estimatedCost: {
                input: Number(
                    ((tokenCount / 1000) * COST_PER_1K_INPUT_TOKENS).toFixed(6),
                ),
                output: Number(
                    ((tokenCount / 1000) * COST_PER_1K_OUTPUT_TOKENS).toFixed(
                        6,
                    ),
                ),
            },
        };
    }

    if (action === 'web_fetch') {
        const {
            wfUrl: url,
            wfMethod: method,
            wfHeaders: headers,
            wfBody: body,
        } = parsed;
        if (!url) throw new Error('wfUrl is required for web_fetch action');
        try {
            const host = new URL(url).hostname.toLowerCase();
            if (isPrivateHost(host))
                return {
                    error: 'Requests to internal/private addresses are blocked.',
                };
        } catch {
            return { error: 'Invalid URL.' };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(url, {
                method,
                headers,
                body,
                signal: controller.signal,
            });
            clearTimeout(timer);
            const text = await response.text();
            const tooLong = text.length > MAX_OUTPUT;
            return {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body: tooLong
                    ? text.slice(0, MAX_OUTPUT) + '\n...(truncated)'
                    : text,
                ...(tooLong ? { truncated: true } : {}),
            };
        } catch (err: any) {
            clearTimeout(timer);
            return {
                error: err.message.includes('aborted')
                    ? 'Request timed out'
                    : `Request failed: ${err.message}`,
            };
        }
    }

    throw new Error(`Unknown action: ${action}`);
}

function formatValidationReport(report: any): string {
    const lines = [
        `## Validation Report`,
        '',
        `**Status:** ${report.success ? '[PASS]' : '[FAIL]'}`,
        `**Files checked:** ${report.filesChecked.length}`,
        '',
    ];
    for (const result of report.results) {
        lines.push(
            `### ${result.success ? '[PASS]' : '[FAIL]'} ${result.checkType} (${(result.durationMs / 1000).toFixed(1)}s)`,
        );
        if (result.errors.length > 0) {
            lines.push('');
            for (const error of result.errors.slice(0, 20)) {
                lines.push(
                    `- ${error.severity === 'error' ? '[ERROR]' : '[WARN]'} ${error.file || ''}${error.line ? `:${error.line}` : ''}: ${error.message}`,
                );
            }
            if (result.errors.length > 20)
                lines.push(
                    `- ... and ${result.errors.length - 20} more issues`,
                );
        } else {
            lines.push('', 'No issues found.');
        }
        lines.push('');
    }
    return lines.join('\n');
}
