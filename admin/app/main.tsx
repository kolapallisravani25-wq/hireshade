import React from 'react';
import ReactDOM from 'react-dom/client';
import { KottsterApp } from '@kottster/react';
import '@kottster/react/dist/style.css';
import './index.css';
import { RBACGuard } from './components/RBACGuard';


const rawPageEntries = import.meta.glob(['./pages/**/index.{jsx,tsx}', './pages/**/page.json'], {
  eager: true,
}) as Record<string, any>;


const pageEntries = Object.keys(rawPageEntries).reduce((acc: Record<string, any>, path) => {
  const module = rawPageEntries[path];
  const normalizedPath = path.startsWith('./') ? path : `./${path}`;
  const denormalizedPath = path.startsWith('./') ? path.substring(2) : path;

  acc[path] = module;
  acc[normalizedPath] = module;
  acc[denormalizedPath] = module;

  const isCode = path.endsWith('.tsx') || path.endsWith('.jsx');
  const pageDir = path.substring(0, path.lastIndexOf('/'));
  const pathParts = pageDir.split('/');
  const pageName = pathParts[pathParts.length - 1];

  if (pageName && pageName !== 'pages' && pageName !== '.') {
    if (isCode) {
      const PageComponent = module.default;
      if (PageComponent && (typeof PageComponent === 'function' || typeof PageComponent === 'object')) {
        
        const configPath = `${pageDir}/page.json`;
        const configPaths = [
          configPath,
          `./${configPath}`,
          configPath.startsWith('./') ? configPath.substring(2) : `pages/${configPath}`,
        ];

        let configModule;
        for (const p of configPaths) {
          if (rawPageEntries[p]) {
            configModule = rawPageEntries[p];
            break;
          }
        }

        const config = configModule?.default || configModule || {};

        
        const WrappedComponent = (props: any) => (
          <RBACGuard config={config}>
            <PageComponent {...props} />
          </RBACGuard>
        );
        WrappedComponent.displayName = `RBACProtected(${PageComponent.displayName || PageComponent.name || 'Page'})`;

        const wrappedModule = {
          ...module,
          default: WrappedComponent,
          config,
        };

        acc[path] = wrappedModule;
        acc[normalizedPath] = wrappedModule;
        acc[denormalizedPath] = wrappedModule;
        acc[pageName] = wrappedModule;
      }
    } else if (!acc[pageName]) {
      acc[pageName] = module;
    }
  }

  return acc;
}, {});

function hideUpgradeBadge() {
    const elements = document.querySelectorAll('button, a');
    elements.forEach((el) => {
        if (el.textContent?.trim() === 'Upgrade to Professional plan') {
            (el as HTMLElement).classList.add('!hidden');
        }
    });
}

window.addEventListener(
  'scroll',
  () => {
    document.documentElement.style.setProperty('--scroll-y', String(window.scrollY));
  },
  { passive: true },
);

const observer = new MutationObserver(() => {
  const body = document.body;
  if (!body) return;

  const isLocked = body.classList.contains('overflow-hidden') || body.style.overflow === 'hidden' || body.style.position === 'fixed';

  if (!isLocked) {
    const scrollY = parseInt(
      document.documentElement.style.getPropertyValue('--scroll-y') || '0',
      10,
    );
    window.scrollTo(0, scrollY);
  }
});

if (document.body) {
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['style'],
  });
}

function initResponsiveSidebar() {
  document.getElementById('vy-hamburger')?.remove();
  document.getElementById('vy-overlay')?.remove();
  if (document.body) document.body.classList.remove('overflow-hidden');

  const SIDEBAR = 'sidebar-module__sidebar___9YcM6';
  const ITEMS = 'sidebar-module__sidebarItems___RqtmT';
  const OPEN = 'vy-sidebar-open';

  const btn = document.createElement('button');
  btn.id = 'vy-hamburger';
  btn.setAttribute('aria-label', 'Toggle navigation');
  btn.setAttribute('aria-expanded', 'false');
  btn.className = 'hidden fixed top-3 left-3 z-[1000] w-10 h-10 rounded-lg border border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-[#1a1f2e] dark:text-[#e2e8f0] cursor-pointer items-center justify-center flex-col gap-[5px] p-2.5 transition-all duration-200 hover:bg-slate-50 dark:hover:bg-white/10 lg:!hidden max-[1023px]:flex [&>span]:block [&>span]:w-[18px] [&>span]:h-[0.5px] [&>span]:bg-current [&>span]:rounded-[2px] [&>span]:transition-all [&>span]:duration-250 [&>span]:ease-in-out [&>span]:origin-center';
  btn.innerHTML = '<span></span><span></span><span></span>';

  const overlay = document.createElement('div');
  overlay.id = 'vy-overlay';
  overlay.className = 'hidden fixed inset-0 z-[998] bg-black/55 backdrop-blur-[2px] opacity-0 transition-opacity duration-300 pointer-events-none max-[1023px]:block';

  document.body.appendChild(btn);
  document.body.appendChild(overlay);

  const sidebar = () => document.querySelector<HTMLElement>(`.${SIDEBAR}`);

  function open() {
    sidebar()?.classList.add(OPEN);
    overlay.classList.add('is-visible');
    btn.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('overflow-hidden');
  }

  function close() {
    sidebar()?.classList.remove(OPEN);
    overlay.classList.remove('is-visible');
    btn.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('overflow-hidden');
  }

  btn.addEventListener('click', () => (sidebar()?.classList.contains(OPEN) ? close() : open()));

  overlay.addEventListener('click', close);

  document.addEventListener('click', (e) => {
    if (window.innerWidth >= 1024) return;
    if ((e.target as Element).closest?.(`.${ITEMS} a, .${ITEMS} button`)) {
      setTimeout(close, 150);
    }
  });

  window.addEventListener(
    'resize',
    () => {
      if (window.innerWidth >= 1024) close();
    },
    { passive: true },
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function refreshSidebarLabels() {
  const container = document.querySelector('[class*="sidebar-module__sidebarItems"]');
  if (!container) return;

  container.querySelectorAll('.sidebar-label').forEach((el) => el.remove());

  const links = Array.from(container.querySelectorAll('a'));
  const isAnalyticsLink = (a: HTMLAnchorElement) => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    const text = (a.textContent || '').trim().toLowerCase();
    const knownAnalytics = [
      'usersanalytics',
      'atsanalytics',
      'sessionanalytics',
      'apimanagement'
    ];
    return knownAnalytics.some((p) => href.includes(p)) || text.includes('analytics');
  };

  const firstAnalytics = links.find(isAnalyticsLink);
  if (firstAnalytics) {
    const label = document.createElement('div');
    label.className = 'block text-[11px] font-semibold tracking-[0.08em] uppercase px-3 pt-4 pb-1.5 pointer-events-none cursor-default mt-1 first:pt-2 first:mt-0 sidebar-label';
    label.innerText = 'Analytics';
    firstAnalytics.parentNode?.insertBefore(label, firstAnalytics);
  }

    const billingPageIds = [
      'grantcredits',
      'creditledger',
      'creditusage',
      'creditpurchase',
      'usercreditbalance',
      'featurecost',
      'creditconfig',
      'creditpack',
    ];

    const isBillingLink = (a: HTMLAnchorElement) => {
      const href = (a.getAttribute('href') || '').toLowerCase();
      const text = (a.textContent || '').trim().toLowerCase();
      return billingPageIds.some((id) => href.includes(id)) || billingPageIds.some((id) => text.includes(id));
    };

    const firstBilling = links.find(isBillingLink);
    if (firstBilling) {
      const label = document.createElement('div');
      label.className = 'block text-[11px] font-semibold tracking-[0.08em] uppercase px-3 pt-4 pb-1.5 pointer-events-none cursor-default mt-1 first:pt-2 first:mt-0 sidebar-label';
      label.innerText = 'Billing';
      firstBilling.parentNode?.insertBefore(label, firstBilling);
    }

  const firstData = links.find((a) => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    const text = (a.textContent || '').trim().toLowerCase();
    if (
      href === '/' ||
      href === '/home' ||
      href.endsWith('/home') ||
      text === 'home' ||
      text === 'dashboard'
    ) {
      return false;
    }
    if (isAnalyticsLink(a)) return false;
      if (isBillingLink(a)) return false;
    return true;
  });

  if (firstData) {
    const label = document.createElement('div');
    label.className = 'block text-[11px] font-semibold tracking-[0.08em] uppercase px-3 pt-4 pb-1.5 pointer-events-none cursor-default mt-1 first:pt-2 first:mt-0 sidebar-label';
    label.innerText = 'Data Management';
    firstData.parentNode?.insertBefore(label, firstData);
  }
}

function waitAndInit() {
  const SIDEBAR = 'sidebar-module__sidebar___9YcM6';
  const ITEMS = 'sidebar-module__sidebarItems___RqtmT';

  const tryInit = () => {
    const sidebar = document.querySelector(`.${SIDEBAR}`);
    const items = document.querySelector(`.${ITEMS}`);

    if (sidebar && items) {
      initResponsiveSidebar();
      refreshSidebarLabels();

      const itemsObserver = new MutationObserver(() => {
        itemsObserver.disconnect();
        refreshSidebarLabels();
        itemsObserver.observe(items, { childList: true });
      });
      itemsObserver.observe(items, { childList: true });

      const badgeObserver = new MutationObserver(hideUpgradeBadge);
      badgeObserver.observe(document.body, {
          childList: true,
          subtree: true
      });
      
      hideUpgradeBadge();

      return true;
    }
    return false;
  };

  if (tryInit()) return;

  const obs = new MutationObserver(() => {
    if (tryInit()) obs.disconnect();
  });

  if (document.body) {
    obs.observe(document.body, { childList: true, subtree: true });
  }
}

function initMobileBlocker() {
  document.getElementById('vy-mobile-blocker')?.remove();
  const blocker = document.createElement('div');
  blocker.id = 'vy-mobile-blocker';
  blocker.innerHTML = `
    <div class="max-w-[320px] flex flex-col items-center gap-5 animate-[fadeInBlocker_0.4s_ease-out]">
      <div class="w-16 h-16 bg-blue-500/10 border border-blue-500/20 rounded-[16px] flex items-center justify-center text-blue-500 mb-0.5">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
      </div>
      <h1 class="text-[22px] font-bold m-0 tracking-tight text-white">Switch to Desktop</h1>
      <p class="text-[15px] leading-[1.5] m-0 text-slate-400">This Admin Panel works best on desktop. Please switch to a larger screen for the best experience.</p>
    </div>
  `;
  document.body.appendChild(blocker);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    waitAndInit();
    initMobileBlocker();
  });
} else {
  waitAndInit();
  initMobileBlocker();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <KottsterApp pageEntries={pageEntries} />
  </React.StrictMode>,
);

