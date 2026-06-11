import { describe, it, expect } from "vitest";
import { getModeColor } from "../mode-utils";
import { Mode } from "@nightcode/shared";

describe("getModeColor", () => {
    const colors = {
        primary: "#56D6C2",
        planMode: "#CF8EF4",
        selection: "#89B4FA",
        thinking: "#CF8EF4",
        success: "#82E0AA",
        error: "#E74C5E",
        info: "#56D6C2",
        background: "#0D0D12",
        surface: "#1A1A24",
        dialogSurface: "#0A0A10",
        thinkingBorder: "#34344A",
        dimSeparator: "#4E4E66",
        text: "#C0C8D8",
    };

    it("returns planMode color for PLAN mode", () => {
        expect(getModeColor("PLAN", colors)).toBe("#CF8EF4");
    });

    it("returns primary color for BUILD mode", () => {
        expect(getModeColor("BUILD", colors)).toBe("#56D6C2");
    });

    it("returns primary color for undefined mode", () => {
        expect(getModeColor(undefined, colors)).toBe("#56D6C2");
    });
});
