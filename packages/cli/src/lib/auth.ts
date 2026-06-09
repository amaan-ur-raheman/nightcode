import { join } from "node:path";
import { homedir } from "node:os";
import {
    readFileSync,
    existsSync,
    mkdirSync,
    writeFileSync,
    unlinkSync,
    statSync,
} from "node:fs";

type AuthData = {
    token: string;
};

const AUTH_DIR = join(homedir(), ".nightcode");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

let _cachedAuth: AuthData | null = null;
let _cachedMtime: number = 0;

export function getAuth(): AuthData | null {
    try {
        const stat = statSync(AUTH_FILE);
        const mtimeMs = stat.mtimeMs;

        if (_cachedAuth && mtimeMs === _cachedMtime) {
            return _cachedAuth;
        }

        const data = readFileSync(AUTH_FILE, "utf-8");
        const parsed = JSON.parse(data) as Partial<AuthData>;

        _cachedAuth = typeof parsed.token === "string"
            ? { token: parsed.token }
            : null;
        _cachedMtime = mtimeMs;
        return _cachedAuth;
    } catch {
        _cachedAuth = null;
        _cachedMtime = 0;
        return null;
    }
}

export function saveAuth(data: AuthData): void {
    if (!existsSync(AUTH_DIR)) {
        // Owner only permission (rwx------) so other users on the machine cannot read tokens
        mkdirSync(AUTH_DIR, { mode: 0o700 });
    }

    writeFileSync(AUTH_FILE, JSON.stringify(data), { mode: 0o600 });
    _cachedAuth = data;
    try { _cachedMtime = statSync(AUTH_FILE).mtimeMs; } catch { /* ignore */ }
}

export function clearAuth() {
    try {
        unlinkSync(AUTH_FILE);
    } catch {
        // File may not exist, ignore error
    }
    _cachedAuth = null;
    _cachedMtime = 0;
}
