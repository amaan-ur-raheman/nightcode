import {
    readFileSync,
    writeFileSync,
    readdirSync,
    mkdirSync,
    existsSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { apiClient } from '@/lib/api-client';

const EXPORTS_DIR = join(homedir(), '.nightcode', 'exports');

export interface ExportedSession {
    exportedAt: string;
    version: number;
    session: {
        id: string;
        title: string;
        messages: unknown;
        branches: unknown;
        activeBranchId: string;
        createdAt: string;
        updatedAt: string;
    };
}

export interface ExportedAllSessions {
    exportedAt: string;
    version: number;
    sessions: {
        id: string;
        title: string;
        messages: unknown;
        branches: unknown;
        activeBranchId: string;
        createdAt: string;
        updatedAt: string;
    }[];
}

export async function exportSession(
    sessionId: string,
): Promise<ExportedSession> {
    const res = await apiClient.export.session[':id'].$get({
        param: { id: sessionId },
    });

    if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Export failed (${res.status})`);
    }

    return res.json() as Promise<ExportedSession>;
}

export async function exportAllSessions(): Promise<ExportedAllSessions> {
    const res = await apiClient.export.all.$get();

    if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Export failed (${res.status})`);
    }

    return res.json() as Promise<ExportedAllSessions>;
}

export async function importSession(
    filePath: string,
): Promise<{ id: string; title: string }> {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as ExportedSession | ExportedAllSessions;

    if ('sessions' in data) {
        const allSessions = data as ExportedAllSessions;
        if (allSessions.sessions.length === 0) {
            throw new Error('No sessions to import');
        }

        const imported: { id: string; title: string }[] = [];
        for (const s of allSessions.sessions) {
            const res = await apiClient.export.import.$post({
                json: {
                    title: s.title,
                    messages: s.messages,
                    branches: s.branches,
                    activeBranchId: s.activeBranchId,
                },
            });

            if (!res.ok) {
                const body = (await res.json()) as { error?: string };
                throw new Error(
                    body.error ??
                        `Import failed for "${s.title}" (${res.status})`,
                );
            }

            imported.push((await res.json()) as { id: string; title: string });
        }

        return imported[imported.length - 1]!;
    }

    const single = data as ExportedSession;
    const res = await apiClient.export.import.$post({
        json: {
            title: single.session.title,
            messages: single.session.messages,
            branches: single.session.branches,
            activeBranchId: single.session.activeBranchId,
        },
    });

    if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Import failed (${res.status})`);
    }

    return res.json() as Promise<{ id: string; title: string }>;
}

export function exportToFile(
    filePath: string,
    data: ExportedSession | ExportedAllSessions,
): void {
    const dir = join(homedir(), '.nightcode', 'exports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export interface ExportFile {
    name: string;
    path: string;
    exportedAt: string;
    title: string;
}

export function listExportFiles(): ExportFile[] {
    if (!existsSync(EXPORTS_DIR)) return [];

    return readdirSync(EXPORTS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((name) => {
            const filePath = join(EXPORTS_DIR, name);
            try {
                const raw = readFileSync(filePath, 'utf-8');
                const data = JSON.parse(raw) as
                    | ExportedSession
                    | ExportedAllSessions;
                const exportedAt = data.exportedAt ?? '';
                let title = 'Unknown';
                if ('session' in data) {
                    title = data.session.title;
                } else if ('sessions' in data && data.sessions.length > 0) {
                    title = `${data.sessions.length} sessions`;
                }
                return { name, path: filePath, exportedAt, title };
            } catch {
                return { name, path: filePath, exportedAt: '', title: name };
            }
        })
        .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
}
