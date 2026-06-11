import { describe, it, expect } from "vitest";
import {
    toolInputSchemas,
    getToolContracts,
    getSubagentToolContracts,
    Mode,
    modeSchema,
} from "../schemas";

describe("modeSchema", () => {
    it("accepts BUILD", () => {
        expect(modeSchema.parse("BUILD")).toBe("BUILD");
    });

    it("accepts PLAN", () => {
        expect(modeSchema.parse("PLAN")).toBe("PLAN");
    });

    it("rejects invalid mode", () => {
        expect(() => modeSchema.parse("INVALID")).toThrow();
    });
});

describe("toolInputSchemas", () => {
    describe("readFile", () => {
        it("parses valid input", () => {
            const result = toolInputSchemas.readFile.parse({ path: "src/index.ts" });
            expect(result.path).toBe("src/index.ts");
        });

        it("parses with optional fields", () => {
            const result = toolInputSchemas.readFile.parse({ path: "file.ts", offset: 5, limit: 20 });
            expect(result.offset).toBe(5);
            expect(result.limit).toBe(20);
        });

        it("rejects missing path", () => {
            expect(() => toolInputSchemas.readFile.parse({})).toThrow();
        });
    });

    describe("bash", () => {
        it("parses valid command", () => {
            const result = toolInputSchemas.bash.parse({ command: "ls -la" });
            expect(result.command).toBe("ls -la");
            expect(result.timeout).toBe(30_000); // default
        });

        it("allows custom timeout", () => {
            const result = toolInputSchemas.bash.parse({ command: "sleep 1", timeout: 5000 });
            expect(result.timeout).toBe(5000);
        });
    });

    describe("editFile", () => {
        it("parses valid edit", () => {
            const result = toolInputSchemas.editFile.parse({
                path: "file.ts",
                oldString: "old code",
                newString: "new code",
            });
            expect(result.path).toBe("file.ts");
            expect(result.oldString).toBe("old code");
        });
    });

    describe("writeFile", () => {
        it("parses valid write", () => {
            const result = toolInputSchemas.writeFile.parse({
                path: "file.ts",
                content: "console.log('hi');",
            });
            expect(result.content).toBe("console.log('hi');");
        });
    });

    describe("spawnAgent", () => {
        it("parses with required fields", () => {
            const result = toolInputSchemas.spawnAgent.parse({
                task: "Do something",
                mode: "BUILD",
            });
            expect(result.task).toBe("Do something");
            expect(result.mode).toBe("BUILD");
        });

        it("parses with optional model", () => {
            const result = toolInputSchemas.spawnAgent.parse({
                task: "Analyze this",
                mode: "PLAN",
                model: "deepseek-ai/deepseek-v4-flash",
            });
            expect(result.model).toBe("deepseek-ai/deepseek-v4-flash");
        });
    });

    describe("gitCommit", () => {
        it("parses with optional files", () => {
            const result = toolInputSchemas.gitCommit.parse({
                message: "fix: bug",
                files: ["src/index.ts"],
            });
            expect(result.files).toEqual(["src/index.ts"]);
        });
    });

    describe("gitBranch", () => {
        it("validates action enum", () => {
            const result = toolInputSchemas.gitBranch.parse({
                action: "create",
                name: "feature-x",
            });
            expect(result.action).toBe("create");
        });

        it("rejects invalid action", () => {
            expect(() =>
                toolInputSchemas.gitBranch.parse({ action: "invalid" })
            ).toThrow();
        });
    });

    describe("envManage", () => {
        it("parses valid env action", () => {
            const result = toolInputSchemas.envManage.parse({
                action: "add",
                key: "API_KEY",
                value: "secret",
            });
            expect(result.action).toBe("add");
            expect(result.key).toBe("API_KEY");
        });
    });

    describe("secretScan", () => {
        it("parses with defaults", () => {
            const result = toolInputSchemas.secretScan.parse({
                path: ".",
            });
            expect(result.recursive).toBe(false);
        });
    });

    describe("memory operations", () => {
        it("parses memorySet", () => {
            const result = toolInputSchemas.memorySet.parse({
                key: "prefs",
                value: "dark mode",
                tags: ["user"],
            });
            expect(result.tags).toEqual(["user"]);
        });

        it("parses memorySearch", () => {
            const result = toolInputSchemas.memorySearch.parse({
                query: "find this",
            });
            expect(result.query).toBe("find this");
        });
    });
});

describe("getToolContracts", () => {
    it("returns read-only tools for PLAN mode", () => {
        const tools = getToolContracts("PLAN");
        expect(tools.readFile).toBeDefined();
        expect(tools.grep).toBeDefined();
        expect((tools as any).writeFile).toBeUndefined();
        expect((tools as any).bash).toBeUndefined();
    });

    it("returns all tools for BUILD mode", () => {
        const tools = getToolContracts("BUILD");
        expect(tools.readFile).toBeDefined();
        expect((tools as any).writeFile).toBeDefined();
        expect((tools as any).bash).toBeDefined();
        expect((tools as any).editFile).toBeDefined();
    });

    it("includes spawnAgent in both modes", () => {
        const planTools = getToolContracts("PLAN");
        const buildTools = getToolContracts("BUILD");
        expect(planTools.spawnAgent).toBeDefined();
        expect(buildTools.spawnAgent).toBeDefined();
    });

    it("includes memory tools in both modes", () => {
        const planTools = getToolContracts("PLAN");
        expect(planTools.memorySet).toBeDefined();
        expect(planTools.memoryGet).toBeDefined();
    });
});

describe("getSubagentToolContracts", () => {
    it("excludes spawnAgent for subagents", () => {
        const planTools = getSubagentToolContracts("PLAN");
        expect((planTools as any).spawnAgent).toBeUndefined();
    });

    it("excludes orchestrator for subagents", () => {
        const buildTools = getSubagentToolContracts("BUILD");
        expect((buildTools as any).orchestrator).toBeUndefined();
    });

    it("still includes read tools for subagents", () => {
        const planTools = getSubagentToolContracts("PLAN");
        expect(planTools.readFile).toBeDefined();
        expect(planTools.grep).toBeDefined();
    });
});
