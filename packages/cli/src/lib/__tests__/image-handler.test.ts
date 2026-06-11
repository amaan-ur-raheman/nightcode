import { describe, it, expect } from "vitest";
import { imageHandler } from "../image-handler";

describe("ImageHandler", () => {
    describe("isSupportedImage", () => {
        it("returns true for PNG files", () => {
            expect(imageHandler.isSupportedImage("photo.png")).toBe(true);
            expect(imageHandler.isSupportedImage("/path/to/image.PNG")).toBe(true);
        });

        it("returns true for JPEG files", () => {
            expect(imageHandler.isSupportedImage("photo.jpg")).toBe(true);
            expect(imageHandler.isSupportedImage("photo.jpeg")).toBe(true);
        });

        it("returns true for GIF, WebP, SVG, BMP", () => {
            expect(imageHandler.isSupportedImage("anim.gif")).toBe(true);
            expect(imageHandler.isSupportedImage("img.webp")).toBe(true);
            expect(imageHandler.isSupportedImage("icon.svg")).toBe(true);
            expect(imageHandler.isSupportedImage("bitmap.bmp")).toBe(true);
        });

        it("returns false for unsupported formats", () => {
            expect(imageHandler.isSupportedImage("doc.pdf")).toBe(false);
            expect(imageHandler.isSupportedImage("script.ts")).toBe(false);
            expect(imageHandler.isSupportedImage("image")).toBe(false);
        });
    });

    describe("isImagePath", () => {
        it("detects image paths in text", () => {
            expect(imageHandler.isImagePath("/path/to/image.png")).toBe(true);
            expect(imageHandler.isImagePath("screenshot.jpg")).toBe(true);
        });

        it("returns false for non-image text", () => {
            expect(imageHandler.isImagePath("hello world")).toBe(false);
            expect(imageHandler.isImagePath("")).toBe(false);
        });
    });

    describe("getDisplayName", () => {
        it("extracts basename from path", () => {
            expect(imageHandler.getDisplayName("/path/to/photo.png")).toBe("photo.png");
            expect(imageHandler.getDisplayName("image.jpg")).toBe("image.jpg");
        });
    });

    describe("validateSize", () => {
        it("accepts small data URLs", () => {
            const smallDataUrl = "data:image/png;base64," + "a".repeat(100);
            expect(imageHandler.validateSize(smallDataUrl)).toBe(true);
        });

        it("rejects data URLs over 10MB", () => {
            // ~12MB base64 string
            const largeDataUrl = "data:image/png;base64," + "a".repeat(16_000_000);
            expect(imageHandler.validateSize(largeDataUrl)).toBe(false);
        });
    });
});
