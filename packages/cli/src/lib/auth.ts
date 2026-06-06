import { join } from "node:path";
import { homedir } from "node:os";
import {
    readFileSync,
    existsSync,
    mkdirSync,
    writeFileSync,
    unlinkSync,
} from "node:fs";

type AuthData = {
    token: string;
};

const AUTH_DIR = join(homedir(), ".nightcode");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

export function getAuth(): AuthData | null {
    try {
        const data = readFileSync(AUTH_FILE, "utf-8");
        const parsed = JSON.parse(data) as Partial<AuthData>;

        return typeof parsed.token === "string"
            ? { token: parsed.token }
            : null;
    } catch {
        return null;
    }
}

export function saveAuth(data: AuthData): void {
    if (!existsSync(AUTH_DIR)) {
        // Owner only permission (rwx------) so other users on the machine cannot read tokens
        mkdirSync(AUTH_DIR, { mode: 0o700 });
    }

    writeFileSync(AUTH_FILE, JSON.stringify(data), { mode: 0o600 });
}

export function clearAuth() {
    try {
        unlinkSync(AUTH_FILE);
    } catch {
        // File may not exist, ignore error
    }
}
