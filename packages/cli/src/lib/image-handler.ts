import { readFile } from 'fs/promises';
import { basename } from 'path';

const MIME_MAP: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(MIME_MAP));

const IMAGE_PATH_RE = /\b\S+\.(?:png|jpe?g|gif|webp|svg|bmp)\b/i;

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

class ImageHandler {
    /** Convert a file path to a base64 data URL */
    async fileToDataUrl(
        filePath: string,
    ): Promise<{ dataUrl: string; mimeType: string }> {
        const buffer = await readFile(filePath);
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        const mimeType = MIME_MAP[ext] || 'image/png';
        const base64 = buffer.toString('base64');
        return {
            dataUrl: `data:${mimeType};base64,${base64}`,
            mimeType,
        };
    }

    /** Check if a file path is a supported image */
    isSupportedImage(filePath: string): boolean {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        return SUPPORTED_EXTENSIONS.has(ext);
    }

    /** Get display name for an image path */
    getDisplayName(filePath: string): string {
        return basename(filePath);
    }

    /** Check if a string looks like an image file path */
    isImagePath(text: string): boolean {
        return IMAGE_PATH_RE.test(text.trim());
    }

    /** Validate data URL size (max 10MB) */
    validateSize(dataUrl: string): boolean {
        // Rough estimate: base64 expands ~33%, so dataUrl length * 3/4 is approximate byte size
        const sizeInBytes = Math.ceil((dataUrl.length * 3) / 4);
        return sizeInBytes <= MAX_SIZE_BYTES;
    }
}

export const imageHandler = new ImageHandler();
