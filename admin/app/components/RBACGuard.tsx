import React, { useMemo } from 'react';
import { useUser } from '@kottster/react';
import { Navigate } from 'react-router-dom';
import { hasAccessToPage } from '../lib/auth';
import { RBACGuardProps } from '../types/auth';

export function RBACGuard({ config, children }: RBACGuardProps) {
    const { hasRole, user, permissions } = useUser();

    const isAuthorized = useMemo(() => {
        return hasAccessToPage(config, user, hasRole, permissions);
    }, [config, user, hasRole, permissions]);

    if (!user) return null;

    if (!isAuthorized) {
        return <Navigate to="/home" replace />;
    }

    return <>{children}</>;
}
