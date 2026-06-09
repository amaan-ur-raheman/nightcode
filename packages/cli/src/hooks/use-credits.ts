import { useState, useEffect, useCallback, useRef } from "react";
import { apiClient } from "@/lib/api-client";

export type CreditBalance = {
    balance: number | null;
    loading: boolean;
    refresh: () => void;
};

const REFRESH_INTERVAL_MS = 60_000;

export function useCredits(): CreditBalance {
    const [balance, setBalance] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);

    const fetchBalance = useCallback(async () => {
        try {
            const res = await apiClient.billing.credits.$get();
            if (!res.ok) return;
            const data = await res.json();
            if (mountedRef.current) {
                setBalance(data.balance);
                setLoading(false);
            }
        } catch {
            if (mountedRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void fetchBalance();
        const id = setInterval(fetchBalance, REFRESH_INTERVAL_MS);
        return () => {
            mountedRef.current = false;
            clearInterval(id);
        };
    }, [fetchBalance]);

    return { balance, loading, refresh: fetchBalance };
}
