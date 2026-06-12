import { useEffect, useRef, useState } from 'react';
import type { Message } from '@/hooks/use-chat';

/**
 * Coalesces streaming message updates so React re-renders at ~15 fps
 * instead of every token (~60+ fps) during fast streaming.
 *
 * - Non-streaming messages are returned immediately (no lag).
 * - The last message (which is typically the one being streamed) is
 *   updated on a 16 ms timer so the UI stays smooth but not overwhelming.
 */
export function useCoalescedMessages(
    messages: Message[],
    isStreaming: boolean,
): Message[] {
    const [display, setDisplay] = useState(messages);
    const pendingRef = useRef(messages);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Keep a ref to the latest raw messages so the timer callback always reads fresh data
    pendingRef.current = messages;

    useEffect(() => {
        if (!isStreaming) {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            setDisplay(messages);
            return;
        }

        if (timerRef.current === null) {
            timerRef.current = setInterval(() => {
                setDisplay([...pendingRef.current]);
            }, 16);
        }

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [isStreaming]);

    useEffect(() => {
        if (!isStreaming) {
            setDisplay(messages);
        }
    }, [messages, isStreaming]);

    return display;
}
