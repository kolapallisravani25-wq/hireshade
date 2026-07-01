import React, { useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useUser, Page } from '@kottster/react';
import sidebar from '../../schemas/sidebar.json';
import { hasAccessToPage } from '../../lib/auth';


const pageConfigs = import.meta.glob([
    '../**/page.json',
    '../*/page.json'
], {
    eager: true
}) as Record<string, any>;

export default function HomeRedirect() {
    const { hasRole, user, permissions } = useUser();

    const targetPath = useMemo(() => {
        if (!user) return null;

        const configs: Record<string, any> = {};
        for (const [filePath, module] of Object.entries(pageConfigs)) {
            
            
            
            const parts = filePath.split('/');
            
            const pageId = parts[parts.length - 2]; 
            
            if (pageId && pageId !== '..' && pageId !== 'pages') {
                configs[pageId] = module?.default || module || {};
            }
        }

        
        const sidebarOrder = sidebar.menuPageOrder || [];
        for (const pageId of sidebarOrder) {
            if (pageId === 'home') continue;
            const config = configs[pageId];
            if (config && hasAccessToPage(config, user, hasRole, permissions)) {
                return `/${pageId}`;
            }
        }

        
        for (const [pageId, config] of Object.entries(configs)) {
            if (pageId === 'home' || sidebarOrder.includes(pageId)) continue;
            if (hasAccessToPage(config, user, hasRole, permissions)) {
                return `/${pageId}`;
            }
        }

        return null;
    }, [user, hasRole, permissions]);

    
    if (!targetPath) {
        return (
            <Page>
                <div className="flex flex-col items-center justify-center h-[70vh] p-8 text-center">
                    <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mb-6">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                    </div>
                    <h1 className="text-3xl font-bold mb-3">Welcome to HireShade</h1>
                    <p className="text-gray-500 max-w-md mx-auto text-lg">
                        You have successfully logged in. Please select a module from the sidebar to start managing your data.
                    </p>
                </div>
            </Page>
        );
    }

    return <Navigate to={targetPath} replace />;
}
