import { readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { useRef, useCallback, useEffect, useState, type RefObject } from "react";

import { useKeyboard } from "@opentui/react";
import type { TextareaRenderable, ScrollBoxRenderable } from "@opentui/core";

import { useKeyboardLayer } from "@/providers/keyboard-layer";

const CURRENT_DIRECTORY = process.cwd();
const MAX_FALLBACK_MENTIONS_CANDIDATES = 32;
const MENTION_QUERY_CHARACTER = /[A-Za-z0-9._/-]/;
const RECURSIVE_MENTION_IGNORED_DIRECTORIES = new Set(["node_modules"]);

export type MentionMatch = {
    start: number;
    end: number;
    query: string;
};

export type MentionCandidate = {
    path: string;
    kind: "file" | "directory";
};

function isWithinCurrentDirectory(targetPath: string): boolean {
    const relativePath = relative(CURRENT_DIRECTORY, targetPath);
    return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isMentionQueryCharacter(character: string): boolean {
    return MENTION_QUERY_CHARACTER.test(character);
}

export function findActiveMention(text: string, cursorOffset: number): MentionMatch | null {
    const safeOffset = Math.max(0, Math.min(cursorOffset, text.length));

    let start = safeOffset;
    while (start > 0 && !/\s/.test(text[start - 1]!)) start -= 1;

    let end = safeOffset;
    while (end < text.length && !/\s/.test(text[end]!)) end += 1;

    const token = text.slice(start, end);
    const relativeCursor = safeOffset - start;
    const mentionStart = token.lastIndexOf("@", relativeCursor);

    if (mentionStart === -1) return null;

    const previousCharacter = token[mentionStart - 1];
    if (previousCharacter && isMentionQueryCharacter(previousCharacter)) return null;

    let mentionEnd = mentionStart + 1;
    while (mentionEnd < token.length && isMentionQueryCharacter(token[mentionEnd]!)) {
        mentionEnd += 1;
    }

    if (relativeCursor < mentionStart || relativeCursor > mentionEnd) return null;

    return {
        start: start + mentionStart,
        end: start + mentionEnd,
        query: token.slice(mentionStart + 1, mentionEnd),
    };
}

export function findMentionTokenBefore(text: string, cursorOffset: number): { start: number; end: number } | null {
    const end = cursorOffset > 0 && text[cursorOffset - 1] === " "
        ? cursorOffset - 1
        : cursorOffset;

    let start = end;
    while (start > 0 && !/ |\n/.test(text[start - 1]!)) start -= 1;

    const token = text.slice(start, end);
    if (!token.startsWith("@") || token.length < 2) return null;
    return { start, end: cursorOffset };
}

export async function getMentionCandidates(query: string): Promise<MentionCandidate[]> {
    const normalizedQuery = query.startsWith("./") ? query.slice(2) : query;
    if (normalizedQuery.startsWith("/")) return [];

    const hasTrailingSlash = normalizedQuery.endsWith("/");
    const lastSlashIndex = hasTrailingSlash
        ? normalizedQuery.length - 1
        : normalizedQuery.lastIndexOf("/");

    const directoryPart = hasTrailingSlash
        ? normalizedQuery.slice(0, -1)
        : lastSlashIndex === -1
            ? ""
            : normalizedQuery.slice(0, lastSlashIndex);

    const namePrefix = hasTrailingSlash
        ? ""
        : lastSlashIndex === -1
            ? normalizedQuery
            : normalizedQuery.slice(lastSlashIndex + 1);

    const absoluteDirectory = resolve(CURRENT_DIRECTORY, directoryPart || ".");
    if (!isWithinCurrentDirectory(absoluteDirectory)) return [];

    try {
        const entries = await readdir(absoluteDirectory, { withFileTypes: true });
        const lowercasePrefix = namePrefix.toLowerCase();
        const showHiddenEntries = namePrefix.startsWith(".");

        const directMatches = entries
            .filter((entry) => showHiddenEntries || !entry.name.startsWith("."))
            .filter((entry) => lowercasePrefix === "" || entry.name.toLowerCase().startsWith(lowercasePrefix))
            .sort((left, right) => {
                if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
                return left.name.localeCompare(right.name);
            })
            .map((entry) => {
                const path = directoryPart ? `${directoryPart}/${entry.name}` : entry.name;
                const kind: MentionCandidate["kind"] = entry.isDirectory() ? "directory" : "file";
                return { path: kind === "directory" ? `${path}/` : path, kind };
            });

        if (directMatches.length > 0 || namePrefix === "") return directMatches;

        const fallbackMatches: MentionCandidate[] = [];
        const searchRoot = resolve(CURRENT_DIRECTORY, directoryPart || ".");
        const searchPrefix = directoryPart || "";

        const visit = async (absoluteDirectory: string, directoryPart: string): Promise<void> => {
            const entries = await readdir(absoluteDirectory, { withFileTypes: true });
            for (const entry of entries) {
                if (!showHiddenEntries && entry.name.startsWith(".")) continue;
                if (entry.isDirectory() && RECURSIVE_MENTION_IGNORED_DIRECTORIES.has(entry.name)) continue;

                const path = directoryPart ? `${directoryPart}/${entry.name}` : entry.name;
                const kind: MentionCandidate["kind"] = entry.isDirectory() ? "directory" : "file";

                if (entry.name.toLowerCase().startsWith(lowercasePrefix)) {
                    fallbackMatches.push({ path: kind === "directory" ? `${path}/` : path, kind });
                    if (fallbackMatches.length > MAX_FALLBACK_MENTIONS_CANDIDATES) return;
                }

                if (entry.isDirectory()) {
                    await visit(resolve(absoluteDirectory, entry.name), path);
                    if (fallbackMatches.length > MAX_FALLBACK_MENTIONS_CANDIDATES) return;
                }
            }
        };

        await visit(searchRoot, searchPrefix);
        return fallbackMatches.sort((left, right) => left.path.localeCompare(right.path));
    } catch {
        return [];
    }
}

type UseFileMentionReturn = {
    showMentionMenu: boolean;
    candidates: MentionCandidate[];
    selectedIndex: number;
    scrollRef: RefObject<ScrollBoxRenderable | null>;
    setSelectedIndex: (index: number) => void;
    sync: (text: string, cursorOffset: number) => void;
    execute: (index: number) => void;
    handleBackspace: () => boolean;
    close: () => void;
};

export function useFileMention(textareaRef: RefObject<TextareaRenderable | null>): UseFileMentionReturn {
    const activeMentionRef = useRef<MentionMatch | null>(null);
    const scrollRef = useRef<ScrollBoxRenderable>(null);

    const [activeMention, setActiveMention] = useState<MentionMatch | null>(null);
    const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);

    const candidatesRef = useRef(candidates);
    candidatesRef.current = candidates;
    const selectedIndexRef = useRef(selectedIndex);
    selectedIndexRef.current = selectedIndex;
    const showMentionMenuRef = useRef(false);

    const { push, pop, isTopLayer } = useKeyboardLayer();

    const showMentionMenu = activeMention !== null;
    showMentionMenuRef.current = showMentionMenu;

    const close = useCallback(() => {
        activeMentionRef.current = null;
        setActiveMention(null);
        setCandidates([]);
        pop("mention");
    }, [pop]);

    const sync = useCallback((text: string, cursorOffset: number) => {
        const nextMention = findActiveMention(text, cursorOffset);
        const previousMention = activeMentionRef.current;
        const mentionChanged =
            previousMention?.start !== nextMention?.start ||
            previousMention?.end !== nextMention?.end ||
            previousMention?.query !== nextMention?.query;

        if (!nextMention) {
            if (previousMention) close();
            return;
        }

        activeMentionRef.current = nextMention;
        setActiveMention(nextMention);

        if (!previousMention) {
            push("mention", () => { close(); return true; });
        }

        if (mentionChanged) {
            setSelectedIndex(0);
            scrollRef.current?.scrollTo(0);
        }
    }, [close, push]);

    const execute = useCallback((index: number) => {
        const textarea = textareaRef.current;
        const mention = activeMentionRef.current;
        const candidate = candidatesRef.current[index];
        if (!textarea || !mention || !candidate) return;

        if (candidate.kind === "directory") {
            const newText = `${textarea.plainText.slice(0, mention.start)}@${candidate.path}${textarea.plainText.slice(mention.end)}`;
            textarea.replaceText(newText);
            textarea.cursorOffset = mention.start + candidate.path.length + 1;
            sync(newText, textarea.cursorOffset);
        } else {
            const newText = `${textarea.plainText.slice(0, mention.start)}@${candidate.path} ${textarea.plainText.slice(mention.end)}`;
            textarea.replaceText(newText);
            textarea.cursorOffset = mention.start + candidate.path.length + 2;
            close();
        }
    }, [sync, close]);

    const handleBackspace = useCallback((): boolean => {
        const textarea = textareaRef.current;
        if (!textarea) return false;
        const token = findMentionTokenBefore(textarea.plainText, textarea.cursorOffset);
        if (!token) return false;
        const newText = textarea.plainText.slice(0, token.start) + textarea.plainText.slice(token.end);
        textarea.replaceText(newText);
        textarea.cursorOffset = token.start;
        sync(newText, token.start);
        return true;
    }, [sync]);

    // Load candidates when query changes
    const activeMentionQuery = activeMention?.query ?? null;
    useEffect(() => {
        if (activeMentionQuery === null) {
            setCandidates([]);
            return;
        }

        let ignore = false;
        const load = async () => {
            const next = await getMentionCandidates(activeMentionQuery);
            if (ignore) return;
            setCandidates(next);
            setSelectedIndex((i) => next.length === 0 ? 0 : Math.min(i, next.length - 1));
        };

        void load();
        return () => { ignore = true; };
    }, [activeMentionQuery]);

    // Arrow key navigation + tab to drill into directory
    useKeyboard((key) => {
        if (!showMentionMenuRef.current || !isTopLayer("mention")) return;

        if (key.name === "escape") {
            key.preventDefault();
            close();
        } else if (key.name === "tab") {
            const candidate = candidatesRef.current[selectedIndexRef.current];
            if (candidate?.kind === "directory") {
                key.preventDefault();
                execute(selectedIndexRef.current);
            }
        } else if (key.name === "up") {
            key.preventDefault();
            setSelectedIndex((i) => {
                const next = Math.max(0, i - 1);
                const sb = scrollRef.current;
                if (sb && next < sb.scrollTop) sb.scrollTo(next);
                return next;
            });
        } else if (key.name === "down") {
            key.preventDefault();
            setSelectedIndex((i) => {
                if (candidatesRef.current.length === 0) return 0;
                const next = Math.min(candidatesRef.current.length - 1, i + 1);
                const sb = scrollRef.current;
                if (sb) {
                    const visibleEnd = sb.scrollTop + sb.viewport.height - 1;
                    if (next > visibleEnd) sb.scrollTo(next - sb.viewport.height + 1);
                }
                return next;
            });
        }
    });

    return { showMentionMenu, candidates, selectedIndex, scrollRef, setSelectedIndex, sync, execute, handleBackspace, close };
}
