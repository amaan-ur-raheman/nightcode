import { useCallback, useState, useEffect } from 'react';
import { type ConversationBranch } from '@nightcode/shared';
import { apiClient } from '@/lib/api-client';
import { timelineManager } from '@/lib/timeline-manager';
import type { Message } from './types';

export interface BranchManagerState {
    branches: ConversationBranch[];
    activeBranchId: string;
    branchMessages: Record<string, Message[]>;
}

export interface BranchManagerActions {
    createBranch: (messageIndex?: number) => Promise<void>;
    switchBranch: (branchId: string) => Promise<void>;
    deleteBranch: (branchId: string) => Promise<void>;
    setBranches: React.Dispatch<React.SetStateAction<ConversationBranch[]>>;
    setActiveBranchId: React.Dispatch<React.SetStateAction<string>>;
    setBranchMessages: React.Dispatch<
        React.SetStateAction<Record<string, Message[]>>
    >;
}

/**
 * Manages conversation branches: creation, switching, deletion.
 * Encapsulates branch-related state and API calls.
 */
export function useBranchManager(
    sessionId: string,
    getMessages: () => Message[],
): BranchManagerState & BranchManagerActions {
    const [branches, setBranches] = useState<ConversationBranch[]>([]);
    const [activeBranchId, setActiveBranchId] = useState<string>('main');
    const [branchMessages, setBranchMessages] = useState<
        Record<string, Message[]>
    >({});

    // Load branches from server on mount
    useEffect(() => {
        let ignore = false;
        (async () => {
            try {
                const res = await apiClient.sessions[':id'].branches.$get({
                    param: { id: sessionId },
                });
                if (ignore || !res.ok) return;
                const data = await res.json();
                if (!ignore) {
                    setBranches(data.branches);
                    setActiveBranchId(data.activeBranchId);
                }
            } catch {
                // Branches may not exist yet, that's fine
            }
        })();
        return () => {
            ignore = true;
        };
    }, [sessionId]);

    const createBranch = useCallback(
        async (messageIndex?: number) => {
            const idx = messageIndex ?? Math.max(0, getMessages().length - 1);
            try {
                const res = await apiClient.sessions[':id'].branches.$post({
                    param: { id: sessionId },
                    json: { parentMessageIndex: idx },
                });
                if (!res.ok) throw new Error('Failed to create branch');
                const newBranch: ConversationBranch = await res.json();
                setBranches((prev) => [...prev, newBranch]);
                setActiveBranchId(newBranch.id);

                // Snapshot messages up to the branch point
                const snapshot = getMessages().slice(0, idx);
                setBranchMessages((prev) => ({
                    ...prev,
                    [newBranch.id]: [...snapshot],
                }));

                const parentMsg = getMessages()[idx];
                if (parentMsg) {
                    void timelineManager.takeSnapshot(
                        sessionId,
                        newBranch.id,
                        parentMsg.id,
                    );
                }
            } catch (err) {
                console.error('Failed to create branch:', err);
            }
        },
        [getMessages, sessionId],
    );

    const switchBranch = useCallback(
        async (branchId: string) => {
            try {
                const res = await apiClient.sessions[':id'][
                    'active-branch'
                ].$put({
                    param: { id: sessionId },
                    json: { branchId },
                });
                if (!res.ok) throw new Error('Failed to switch branch');
                setActiveBranchId(branchId);
            } catch (err) {
                console.error('Failed to switch branch:', err);
            }
        },
        [sessionId],
    );

    const deleteBranch = useCallback(
        async (branchId: string) => {
            if (branchId === 'main') return;
            try {
                const res = await apiClient.sessions[':id'].branches[
                    ':branchId'
                ].$delete({
                    param: { id: sessionId, branchId },
                });
                if (!res.ok) throw new Error('Failed to delete branch');
                setBranches((prev) => prev.filter((b) => b.id !== branchId));
                setBranchMessages((prev) => {
                    const next = { ...prev };
                    delete next[branchId];
                    return next;
                });
                if (activeBranchId === branchId) {
                    setActiveBranchId('main');
                }
            } catch (err) {
                console.error('Failed to delete branch:', err);
            }
        },
        [activeBranchId, sessionId],
    );

    return {
        branches,
        activeBranchId,
        branchMessages,
        createBranch,
        switchBranch,
        deleteBranch,
        setBranches,
        setActiveBranchId,
        setBranchMessages,
    };
}
