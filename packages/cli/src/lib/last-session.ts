import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

/** XDG_STATE_HOME → ~/.local/state → /tmp fallback */
export const LAST_SESSION_PATH = (() => {
	const xdg = process.env.XDG_STATE_HOME;
	if (xdg) return join(xdg, "nightcode", "last-session.json");
	const home = homedir();
	if (home && home !== tmpdir()) {
		return join(home, ".local", "state", "nightcode", "last-session.json");
	}
	return join(tmpdir(), "nightcode-last-session.json");
})();

export interface LastSession {
	id: string | null;
	title: string | null;
	_v?: number;
}

export const LAST_SESSION_DEFAULT = Object.freeze({
	id: null,
	title: null,
} as const satisfies LastSession);

const PERSIST_VERSION = 1;

/** Read the persisted last-session file. NEVER throws — returns default on any error. */
export function readLastSession(): LastSession {
	try {
		const raw = readFileSync(LAST_SESSION_PATH, "utf8");
		const parsed = JSON.parse(raw) as LastSession;
		return parsed;
	} catch {
		return { ...LAST_SESSION_DEFAULT };
	}
}

/** Write last-session to disk with a version stamp (used in the payload). */
export function persistLastSession(session: LastSession): void {
	if (!session.id) return;
	const payload: LastSession & { _v: number } = {
		...session,
		_v: PERSIST_VERSION,
	};
	writeFileSync(LAST_SESSION_PATH, JSON.stringify(payload));
}

/** Remove the last-session file. Only re-throws real errors (ENOENT is swallowed). */
export function clearLastSession(): void {
	try {
		unlinkSync(LAST_SESSION_PATH);
	} catch (e) {
		const code = (e as NodeJS.ErrnoException | undefined)?.code;
		if (code !== "ENOENT") throw e;
	}
}

export type MutableLastSession = {
	id: string | null;
	title: string | null;
};

export function createMutableLastSession(): MutableLastSession {
	return { id: null, title: null };
}
