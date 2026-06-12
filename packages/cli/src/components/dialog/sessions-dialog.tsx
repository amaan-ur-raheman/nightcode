import { useNavigate } from 'react-router';
import type { InferResponseType } from 'hono/client';
import { useCallback, useState, useEffect } from 'react';

import { useToast } from '@/providers/toast';
import { apiClient } from '@/lib/api-client';
import { useDialog } from '@/providers/dialog';
import { TextAttributes } from '@opentui/core';
import { getErrorMessage } from '@/lib/http-errors';

import { DialogSearchList } from '@/components/dialog-search-list';

type Session = InferResponseType<
    (typeof apiClient.sessions)['$get'],
    200
>[number];

export function SessionDialogContent() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const { close } = useDialog();
    const navigate = useNavigate();
    const { show } = useToast();

    useEffect(() => {
        let ignore = false;

        const fetchSessions = async () => {
            try {
                const res = await apiClient.sessions.$get();
                if (!res.ok) {
                    throw new Error(await getErrorMessage(res));
                }

                const data = await res.json();

                if (!ignore) {
                    setSessions(data);
                    setLoading(false);
                }
            } catch (error) {
                if (!ignore) {
                    show({
                        variant: 'error',
                        message:
                            error instanceof Error
                                ? error.message
                                : 'Failed to fetch sessions',
                    });
                    close();
                }
            }
        };

        fetchSessions();

        return () => {
            ignore = true;
        };
    }, [close, show]);

    const handleSelect = useCallback(
        (session: Session) => {
            close();
            navigate(`/sessions/${session.id}`);
        },
        [close, navigate],
    );

    if (loading) {
        return (
            <box flexDirection="column">
                <text attributes={TextAttributes.DIM}>Loading sessions...</text>
            </box>
        );
    }

    return (
        <DialogSearchList
            items={sessions}
            onSelect={handleSelect}
            filterFn={(s, query) =>
                s.title.toLowerCase().includes(query.toLowerCase())
            }
            renderItem={(session, isSelected) => (
                <>
                    <text
                        selectable={false}
                        fg={isSelected ? 'black' : 'white'}
                    >
                        {session.title}
                    </text>
                    <box flexGrow={1} />
                    <text
                        selectable={false}
                        fg={isSelected ? 'black' : undefined}
                        attributes={TextAttributes.DIM}
                    >
                        {new Intl.DateTimeFormat('en', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                        }).format(new Date(session.createdAt))}
                    </text>
                </>
            )}
            getKey={(s) => s.id}
            placeholder="Search sessions"
            emptyText="No sessions found"
        />
    );
}
