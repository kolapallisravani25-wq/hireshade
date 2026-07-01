import { ReactNode } from 'react';

export interface PageConfig {
    allowedRoles?: string[];
    title?: string;
    version?: string;
    type?: string;
    hideInSidebar?: boolean;
}

export interface RBACGuardProps {
    config?: PageConfig;
    children: ReactNode;
}
