import { toolInputSchemas } from '@nightcode/shared';
import { truncate, MAX_OUTPUT } from './utils';

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

interface ProcessInfo {
    pid: number;
    cpu: string;
    memory: string;
    command: string;
}

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
    /^bluetoothd$/i,
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
    /^fseventsd$/i,
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
    /^securityd$/i,
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
    // Get the base name from the command path
    const parts = command.split('/');
    const base = parts[parts.length - 1] ?? '';
    // Strip common wrappers
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
            // Sanitize: only allow alphanumeric, dots, hyphens, underscores
            const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '');
            if (!safeName) {
                return 'Invalid process name filter.';
            }
            cmd += ` | grep -i "${safeName}" | grep -v grep`;
        } else {
            // Filter for common dev servers and user processes
            cmd +=
                ' | grep -E "(node|bun|deno|python|go|cargo|ruby|java|webpack|vite|next|nuxt|remix|astro|bunx|tsx|ts-node|esbuild|tailwind)" | grep -v grep | head -30';
        }

        const { stdout, exitCode } = await execAsync(cmd);

        if (exitCode !== 0 || !stdout.trim()) {
            return 'No matching processes found.';
        }

        const lines = stdout.trim().split('\n');
        const processes: ProcessInfo[] = lines.map((line) => {
            const parts = line.trim().split(/\s+/);
            return {
                pid: parseInt(parts[1] ?? '0'),
                cpu: parts[2] ?? '0',
                memory: parts[3] ?? '0',
                command: parts.slice(10).join(' '),
            };
        });

        const output = processes
            .map((p) => {
                const name = extractProcessName(p.command);
                const protected_ = isProtectedProcess(name);
                return `PID: ${p.pid} | CPU: ${p.cpu}% | MEM: ${p.memory}% | ${name}${protected_ ? ' [PROTECTED]' : ''}\n  CMD: ${p.command}`;
            })
            .join('\n');

        return output;
    } catch (error: any) {
        return `Error listing processes: ${error.message}`;
    }
}

async function killProcess(
    pid: number,
    force: boolean = false,
): Promise<string> {
    if (!pid || pid <= 0) {
        return 'A valid PID is required for kill action.';
    }

    // Check if process exists and get its name
    try {
        const { stdout } = await execAsync(`ps -p ${pid} -o comm=`);
        const name = stdout.trim();
        if (isProtectedProcess(name)) {
            return `Cannot kill protected system process: ${name} (PID: ${pid})`;
        }
    } catch {
        return `Process ${pid} not found.`;
    }

    try {
        if (force) {
            await execAsync(`kill -9 ${pid}`);
            return `Force killed process ${pid}`;
        }

        // Try SIGTERM first
        await execAsync(`kill ${pid}`);

        // Wait briefly
        await new Promise((r) => setTimeout(r, 500));

        // Check if still running
        try {
            await execAsync(`kill -0 ${pid}`);
            // Still running, escalate to SIGKILL
            await execAsync(`kill -9 ${pid}`);
            return `Process ${pid} did not stop with SIGTERM, force killed with SIGKILL`;
        } catch {
            // Process is gone
            return `Killed process ${pid}`;
        }
    } catch (error: any) {
        return `Error killing process ${pid}: ${error.message}`;
    }
}

async function listPorts(port?: number): Promise<string> {
    try {
        let cmd: string;

        if (port) {
            cmd = `lsof -i :${port} -P -n 2>/dev/null`;
        } else {
            cmd = 'lsof -i -P -n 2>/dev/null | grep LISTEN | head -30';
        }

        const { stdout, exitCode } = await execAsync(cmd);

        if (exitCode !== 0 || !stdout.trim()) {
            return port
                ? `No process listening on port ${port}`
                : 'No listening ports found.';
        }

        const lines = stdout.trim().split('\n');
        const firstLine = lines[0];

        if (port && firstLine) {
            const parts = firstLine.trim().split(/\s+/);
            const name = parts[0] ?? 'unknown';
            const pid = parts[1] ?? '?';
            const user = parts[2] ?? '?';
            const device = parts[7] ?? '?';
            const listening = parts[8] ?? '?';
            return `Port ${port} is in use:\n  Process: ${name} (PID: ${pid}, User: ${user})\n  Address: ${listening}`;
        }

        // List all listening ports
        const output = lines
            .map((line) => {
                const parts = line.trim().split(/\s+/);
                const name = parts[0] ?? 'unknown';
                const pid = parts[1] ?? '?';
                const addr = parts[8] ?? '?';
                return `${name} (PID: ${pid}) → ${addr}`;
            })
            .join('\n');

        return output;
    } catch (error: any) {
        return `Error listing ports: ${error.message}`;
    }
}

export async function processManageTool(input: unknown) {
    const { action, port, pid, name, force } =
        toolInputSchemas.processManage.parse(input);

    let result: string;

    switch (action) {
        case 'list':
            result = await listProcesses(name);
            break;
        case 'kill':
            if (!pid) {
                result = 'A valid PID is required for the kill action.';
                break;
            }
            result = await killProcess(pid, force);
            break;
        case 'list-ports':
            result = await listPorts(port);
            break;
        default:
            result = `Unknown action: ${action}`;
    }

    return {
        stdout: truncate(result, MAX_OUTPUT),
        stderr: '',
        exitCode: 0,
        timedOut: false,
    };
}
