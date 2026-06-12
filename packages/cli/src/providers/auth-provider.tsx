import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { setOnAuthExpired } from '@/lib/api-client';
import { useToast } from '@/providers/toast';

type AuthProviderProps = {
    children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
    const toast = useToast();

    useEffect(() => {
        setOnAuthExpired(() => {
            toast.show({
                message: 'Session expired. Run /login to continue.',
                variant: 'error',
                duration: 5000,
            });
        });

        return () => {
            setOnAuthExpired(null);
        };
    }, [toast]);

    return <>{children}</>;
}
