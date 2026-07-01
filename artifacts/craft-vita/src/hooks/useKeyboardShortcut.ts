import { useEffect } from 'react';

/**
 * Custom hook to handle keyboard shortcuts.
 * Supports both Ctrl+Key and Cmd+Key (Mac).
 * 
 * @param key The key to listen for (e.g., 'k', 'g').
 * @param callback The function to call when the shortcut is triggered.
 * @param options Configuration for the shortcut.
 */
export const useKeyboardShortcut = (
  key: string,
  callback: (e: KeyboardEvent) => void,
  options?: { 
    ctrl?: boolean; 
    meta?: boolean; 
    preventDefault?: boolean;
    disabled?: boolean;
  }
) => {
  useEffect(() => {
    if (options?.disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if Ctrl or Meta (Cmd) is pressed
      const isModifierPressed = event.ctrlKey || event.metaKey;
      const matchesKey = event.key.toLowerCase() === key.toLowerCase();

      if (isModifierPressed && matchesKey) {
        if (options?.preventDefault !== false) {
          event.preventDefault();
        }
        callback(event);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [key, callback, options?.ctrl, options?.meta, options?.preventDefault, options?.disabled]);
};
