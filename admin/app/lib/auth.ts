import { PageConfig } from '../types/auth';

export function getAuthContext(user: any | null | undefined, permissions: string[] = []) {
    if (!user) return { isAdministrative: false, userRoles: [] };

    const userAsAny = user as any;
    const email = (userAsAny.email || '').toLowerCase();
    const username = (userAsAny.username || '').toLowerCase();
    const rolesRaw = userAsAny.roles || [];

    const userRoles = rolesRaw
        .map((r: any) => {
            if (typeof r === 'string') return r.trim().toLowerCase();
            if (r && typeof r === 'object') return (r.name || r.id || '').toString().trim().toLowerCase();
            return '';
        })
        .filter(Boolean);

    
    if (typeof userAsAny.role === 'string') userRoles.push(userAsAny.role.toLowerCase());
    else if (userAsAny.role?.name) userRoles.push(userAsAny.role.name.toLowerCase());
    
    
    const isAdministrative =
        Boolean(userAsAny.isAdmin) === true ||
        Boolean(userAsAny.is_admin) === true ||
        username === 'admin' ||
        email.includes('admin@') ||
        userRoles.includes('superadmin') ||
        userRoles.includes('admin');

    return {
        isAdministrative,
        userRoles: Array.from(new Set(userRoles))
    };
}

export function hasAccessToPage(
    config: PageConfig | undefined,
    user: any | null | undefined,
    hasRole: (role: string) => boolean,
    permissions: string[] = []
): boolean {
    if (!user) return false;
    const { isAdministrative, userRoles } = getAuthContext(user, permissions);
    if (isAdministrative) return true;

    const allowedRoles: string[] = config?.allowedRoles || [];
    if (allowedRoles.length === 0) return true; 

    return allowedRoles.some((role) => {
        if (typeof role !== 'string') return false;
        const normalized = role.trim().toLowerCase();
        
        return userRoles.includes(normalized) || hasRole(role) || hasRole(normalized);
    });
}
