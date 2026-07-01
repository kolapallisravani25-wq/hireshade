import React, { useEffect, useRef } from 'react';
import { TablePage } from '@kottster/react';

export default function UsersPage() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  useEffect(() => {
    const searchParam = new URLSearchParams(window.location.search).get('search');
    if (searchParam) {
      let attempts = 0;
      intervalRef.current = setInterval(() => {
        const searchInput = (document.querySelector('input[type="search"]') as HTMLInputElement)
                         || (document.querySelector('input[placeholder*="Search" i]') as HTMLInputElement);
        if (searchInput) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (!searchInput.value) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            nativeInputValueSetter?.call(searchInput, searchParam);
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        if (attempts > 30 && intervalRef.current) clearInterval(intervalRef.current);
        attempts++;
      }, 100);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return <TablePage />;
}
