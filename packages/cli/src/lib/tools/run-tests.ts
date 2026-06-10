import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { toolInputSchemas } from "@nightcode/shared";
import { MAX_TEST_OUTPUT } from "./utils";
import { snapshotManager } from "../snapshot-manager";

export interface TestRunnerOptions {
    snapshots?: boolean;
    updateSnapshots?: boolean;
}

async function detectRunner(cwd: string): Promise<string> {
    if (existsSync(resolve(cwd, "bun.lockb")) || existsSync(resolve(cwd, "bun.lock"))) {
        return "bun test";
    }

    if (existsSync(resolve(cwd, "package.json"))) {
        try {
            const pkg = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf-8"));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if ("vitest" in deps) return "npx vitest run";
            if ("jest" in deps) return "npx jest";
        } catch { /* ignore malformed package.json */ }
    }

    if (existsSync(resolve(cwd, "pytest.ini")) || existsSync(resolve(cwd, "pyproject.toml"))) {
        return "pytest";
    }

    if (existsSync(resolve(cwd, "Cargo.toml"))) return "cargo test";
    if (existsSync(resolve(cwd, "go.mod"))) return "go test ./...";

    return "bun test";
}

function parseTestOutput(raw: string): { passed: number; failed: number } {
    const clean = raw.replace(/\u001b\[[0-9;]*m/g, "");

    // bun test: "X pass(Y)" or "X fail(Y)"
    const bunPass = clean.match(/(\d+)\s+pass/);
    const bunFail = clean.match(/(\d+)\s+fail/);
    if (bunPass || bunFail) {
        return {
            passed: bunPass ? Number(bunPass[1]) : 0,
            failed: bunFail ? Number(bunFail[1]) : 0,
        };
    }

    // jest/vitest: "Tests: X passed, Y total" or "X passed, Y failed, Z total"
    const jestPassed = clean.match(/(\d+)\s+passed/);
    const jestFailed = clean.match(/(\d+)\s+failed/);
    if (jestPassed || jestFailed) {
        return {
            passed: jestPassed ? Number(jestPassed[1]) : 0,
            failed: jestFailed ? Number(jestFailed[1]) : 0,
        };
    }

    // pytest: "X passed" / "Y failed"
    const pytestPassed = clean.match(/(\d+)\s+passed/);
    const pytestFailed = clean.match(/(\d+)\s+failed/);
    if (pytestPassed || pytestFailed) {
        return {
            passed: pytestPassed ? Number(pytestPassed[1]) : 0,
            failed: pytestFailed ? Number(pytestFailed[1]) : 0,
        };
    }

    // cargo test: "test result: ok. X passed; Y failed"
    const cargoPassed = clean.match(/(\d+)\s+passed/);
    const cargoFailed = clean.match(/(\d+)\s+failed/);
    if (cargoPassed || cargoFailed) {
        return {
            passed: cargoPassed ? Number(cargoPassed[1]) : 0,
            failed: cargoFailed ? Number(cargoFailed[1]) : 0,
        };
    }

    // go test: "PASS" / "FAIL" — count from "ok" / "FAIL" lines
    const goPassCount = (clean.match(/^ok\s+/gm) || []).length;
    const goFailCount = (clean.match(/^FAIL\s+/gm) || []).length;
    if (goPassCount || goFailCount) {
        return { passed: goPassCount, failed: goFailCount };
    }

    return { passed: 0, failed: 0 };
}

export interface TestResult {
    success: boolean;
    runner: string;
    passed: number;
    failed: number;
    output: string;
    snapshotMatch?: boolean;
    snapshotDiff?: string;
    snapshotUpdated?: boolean;
}

function generateDiff(expected: string, actual: string): string {
    const expectedLines = expected.split("\n");
    const actualLines = actual.split("\n");
    const diff: string[] = [];

    const maxLen = Math.max(expectedLines.length, actualLines.length);
    for (let i = 0; i < maxLen; i++) {
        const exp = expectedLines[i];
        const act = actualLines[i];

        if (exp === act) {
            diff.push(`  ${exp}`);
        } else {
            if (exp !== undefined) diff.push(`- ${exp}`);
            if (act !== undefined) diff.push(`+ ${act}`);
        }
    }

    return diff.join("\n");
}

export async function runTestsTool(input: unknown, _parentMode?: string, _parentModel?: string, signal?: AbortSignal) {
    const { filter, runner: userRunner, timeout } = toolInputSchemas.runTests.parse(input);
    const cwd = process.cwd();

    const runner = userRunner || await detectRunner(cwd);
    const parts = runner.split(/\s+/);
    const cmd = parts[0] ?? "bun";
    const baseArgs = parts.slice(1);
    if (filter) baseArgs.push(filter);

    const proc = Bun.spawn([cmd, ...baseArgs], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, FORCE_COLOR: "0", TERM: "dumb" },
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeout);

    const onAbort = () => proc.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort);

    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);

    const output = (stdout + stderr).slice(0, MAX_TEST_OUTPUT);
    const { passed, failed } = parseTestOutput(output);

    return {
        success: exitCode === 0,
        runner,
        passed,
        failed,
        output,
    } satisfies TestResult;
}

export async function runTestsWithSnapshots(
    input: unknown,
    options: { updateSnapshots?: boolean },
    _parentMode?: string,
    _parentModel?: string,
    signal?: AbortSignal,
): Promise<TestResult> {
    const result = await runTestsTool(input, _parentMode, _parentModel, signal);

    const parsed = toolInputSchemas.runTests.parse(input);
    const snapshotName = `${parsed.runner || "default"}:${parsed.filter || "all"}:output`;

    if (options.updateSnapshots) {
        await snapshotManager.set(snapshotName, result.output);
        return { ...result, snapshotUpdated: true };
    }

    const { match, stored } = await snapshotManager.match(snapshotName, result.output);

    if (match && !stored) {
        return { ...result, snapshotMatch: true };
    }

    if (!match) {
        return {
            ...result,
            snapshotMatch: false,
            snapshotDiff: generateDiff(stored || "", result.output),
        };
    }

    return { ...result, snapshotMatch: true };
}
