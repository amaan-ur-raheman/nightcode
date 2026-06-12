import { describe, it, expect } from 'vitest';
import {
    isPrivateHost,
    truncate,
    PRIVATE_IPS,
    MAX_FILE_SIZE,
    MAX_OUTPUT,
} from '../utils';

describe('isPrivateHost', () => {
    it('detects localhost', () => {
        expect(isPrivateHost('localhost')).toBe(true);
    });

    it('detects 127.x.x.x addresses', () => {
        expect(isPrivateHost('127.0.0.1')).toBe(true);
        expect(isPrivateHost('127.0.0.2')).toBe(true);
    });

    it('detects 10.x.x.x addresses', () => {
        expect(isPrivateHost('10.0.0.1')).toBe(true);
    });

    it('detects 192.168.x.x addresses', () => {
        expect(isPrivateHost('192.168.1.1')).toBe(true);
    });

    it('detects 172.16-31.x.x addresses', () => {
        expect(isPrivateHost('172.16.0.1')).toBe(true);
        expect(isPrivateHost('172.31.0.1')).toBe(true);
    });

    it('detects .local domains', () => {
        expect(isPrivateHost('myhost.local')).toBe(true);
    });

    it('returns false for public hosts', () => {
        expect(isPrivateHost('google.com')).toBe(false);
        expect(isPrivateHost('8.8.8.8')).toBe(false);
        expect(isPrivateHost('api.example.com')).toBe(false);
    });
});

describe('truncate', () => {
    it('returns short strings unchanged', () => {
        expect(truncate('hello', 100)).toBe('hello');
    });

    it('truncates long strings with message', () => {
        const result = truncate('a'.repeat(1000), 100);
        expect(result.length).toBeLessThan(1000);
        expect(result).toContain('truncated');
        expect(result).toContain('1000');
    });

    it('includes total char count in truncation notice', () => {
        const result = truncate('hello world!', 5);
        expect(result).toContain('12 total chars');
    });
});

describe('Constants', () => {
    it('MAX_FILE_SIZE is 100000', () => {
        expect(MAX_FILE_SIZE).toBe(100_000);
    });

    it('MAX_OUTPUT is 50000', () => {
        expect(MAX_OUTPUT).toBe(50_000);
    });

    it('PRIVATE_IPS includes common private IP patterns', () => {
        expect(PRIVATE_IPS).toContain('localhost');
        expect(PRIVATE_IPS).toContain('10.');
        expect(PRIVATE_IPS).toContain('192.168.');
    });
});
