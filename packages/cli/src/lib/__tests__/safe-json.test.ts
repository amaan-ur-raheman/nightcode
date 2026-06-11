import { describe, expect, it } from "vitest";
import { safeStringify, safeTruncatedString } from "../safe-json";

describe("safe json helpers", () => {
    it("serializes circular objects", () => {
        const value: Record<string, unknown> = { name: "tool-result" };
        value.self = value;

        expect(safeStringify(value)).toBe('{"name":"tool-result","self":"[Circular]"}');
    });

    it("serializes bigint values", () => {
        expect(safeStringify({ count: 10n })).toBe('{"count":"10"}');
    });

    it("truncates serialized output", () => {
        expect(safeTruncatedString({ text: "abcdef" }, 8)).toContain("truncated");
    });
});
