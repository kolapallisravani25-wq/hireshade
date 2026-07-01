import { ThemeCallback, ThemeColors } from '../types';

const debounce = (func: ThemeCallback, wait: number): ((isDark: boolean) => void) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function executedFunction(isDark: boolean): void {
    const later = (): void => {
      if (timeout) clearTimeout(timeout);
      func(isDark);
    };
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

const isDarkMode = (): boolean => {
  if (typeof window !== 'undefined') {
    const body = document.body;
    const html = document.documentElement;

    const hasDarkClass = body.classList.contains('dark') ||
                         html.classList.contains('dark') ||
                         body.classList.contains('kottster-dark') ||
                         html.classList.contains('kottster-dark') ||
                         body.getAttribute('data-theme') === 'dark' ||
                         html.getAttribute('data-theme') === 'dark' ||
                         body.getAttribute('data-color-mode') === 'dark' ||
                         html.getAttribute('data-mantine-color-scheme') === 'dark';

    if (hasDarkClass) {
      return true;
    }

    const hasLightClass = body.classList.contains('light') ||
                          html.classList.contains('light') ||
                          body.classList.contains('kottster-light') ||
                          html.classList.contains('kottster-light') ||
                          body.getAttribute('data-theme') === 'light' ||
                          body.getAttribute('data-color-mode') === 'light' ||
                          html.getAttribute('data-mantine-color-scheme') === 'light';

    if (hasLightClass) {
      return false;
    }

    const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"], .ant-layout-sider, [class*="sider"]');
    if (sidebar) {
      const computedStyle = window.getComputedStyle(sidebar);
      const bgColor = computedStyle.backgroundColor;

      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
        const rgb = bgColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
          const r = parseInt(rgb[0], 10);
          const g = parseInt(rgb[1], 10);
          const b = parseInt(rgb[2], 10);
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          return luminance < 0.5;
        }
      }
    }

    const kottsterBg = getComputedStyle(html).getPropertyValue('--kottster-bg').trim();
    if (kottsterBg) {
      return kottsterBg.includes('dark') || kottsterBg.includes('0f172a') || kottsterBg.includes('1e293b');
    }

    const bodyBg = window.getComputedStyle(body).backgroundColor;
    if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') {
      const rgb = bodyBg.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        const luminance = (0.299 * parseInt(rgb[0], 10) + 0.587 * parseInt(rgb[1], 10) + 0.114 * parseInt(rgb[2], 10)) / 255;
        return luminance < 0.5;
      }
    }

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark;
  }
  return false;
};

export const getThemeColors = (): ThemeColors => {
  const dark = isDarkMode();
  return {
    background: dark ? '#0f172a' : '#ffffff',
    cardBackground: dark ? '#1e293b' : '#ffffff',
    textPrimary: dark ? '#f1f5f9' : '#0f172a',
    textSecondary: dark ? '#a6adc8' : '#6b7280',
    textMuted: dark ? '#6c7086' : '#9ca3af',
    borderColor: dark ? '#334155' : '#e2e8f0',
    success: dark ? '#a6e3a1' : '#10b981',
    error: dark ? '#f38ba8' : '#ef4444',
    warning: dark ? '#fab387' : '#f59e0b',
    info: dark ? '#89b4fa' : '#3b82f6',
    shadow: dark ? '0 2px 8px rgba(0,0,0,0.4)' : '0 2px 4px rgba(0,0,0,0.1)',
    inputBackground: dark ? '#313244' : '#f9fafb',
    inputBorder: dark ? '#45475a' : '#d1d5db',
    inputFocus: dark ? '#89b4fa' : '#3b82f6',
    buttonPrimary: dark ? '#89b4fa' : '#3b82f6',
    buttonPrimaryHover: dark ? '#74c7ec' : '#2563eb',
    buttonSecondary: dark ? '#45475a' : '#6b7280',
    buttonDanger: dark ? '#f38ba8' : '#ef4444',
    buttonDangerHover: dark ? '#eba0ac' : '#dc2626',
  };
};

export function useThemeListener(callback: ThemeCallback): () => void {
  const debouncedCallback = debounce(callback, 100);

  let currentTheme = isDarkMode();

  const checkThemeChange = (): void => {
    const newTheme = isDarkMode();
    if (newTheme !== currentTheme) {
      currentTheme = newTheme;
      debouncedCallback(newTheme);
    }
  };

  setTimeout(() => callback(currentTheme), 0);

  const observer = new MutationObserver((mutations) => {
    const hasThemeChange = mutations.some(mutation => {
      if (mutation.type !== 'attributes') return false;

      const attributeName = mutation.attributeName;
      return attributeName === 'class' || attributeName === 'data-theme' || attributeName === 'data-mantine-color-scheme';
    });

    if (hasThemeChange) {
      checkThemeChange();
    }
  });

  const observerConfig: MutationObserverInit = {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-mantine-color-scheme'],
    subtree: false
  };

  observer.observe(document.body, observerConfig);
  observer.observe(document.documentElement, observerConfig);

  const handleThemeToggle = (event: MouseEvent | Event): void => {
    const target = event.target as HTMLElement;
    if ((event as CustomEvent).detail?.theme !== undefined ||
        target?.closest?.('[data-theme-toggle]') ||
        target?.closest?.('.theme-toggle')) {
      setTimeout(checkThemeChange, 50);
    }
  };

  document.addEventListener('click', handleThemeToggle, { passive: true });
  document.addEventListener('themeChanged', handleThemeToggle, { passive: true });

  return (): void => {
    observer.disconnect();
    document.removeEventListener('click', handleThemeToggle);
    document.removeEventListener('themeChanged', handleThemeToggle);
  };
}
