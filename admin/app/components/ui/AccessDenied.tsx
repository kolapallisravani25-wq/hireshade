import React from 'react';
import { Page, useTheme } from '@kottster/react';

export function AccessDenied() {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    return (
        <Page title="Access Denied">
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
                <div className={`p-6 rounded-full mb-6 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={isDark ? '#f87171' : '#ef4444'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </div>
                <h1 className={`text-3xl font-bold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>Access Restricted</h1>
                <p className={`max-w-md text-lg mb-8 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    You don't have the required permissions to view this module.
                </p>
                <button onClick={() => (window.location.href = '/')} className="px-6 py-3 rounded-xl font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-lg">
                    Return to Dashboard
                </button>
            </div>
        </Page>
    );
}
