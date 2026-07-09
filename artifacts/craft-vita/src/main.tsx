import "@/lib/disableDebugLogs";
import { BrowserRouter, useNavigate } from "react-router-dom";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider } from "@clerk/clerk-react";

// ── Desktop (Tauri) Clerk mode ────────────────────────────────────────────────
// In the Tauri webview, Clerk's default "standard browser" mode maintains the
// session with cross-origin Secure cookies on clerk.hireshade.com. The webview
// (tauri.localhost) cannot reliably persist/send those cookies, so sign-in
// succeeds but the session evaporates on the first background sync — clerk-js's
// on-focus "touch" ping comes back unauthenticated and the app bounces to the
// login screen. Loading clerk-js with standardBrowser:false switches it to its
// JWT-based session syncing (the mode built for webview environments like
// Capacitor — no cookies involved), and touchSession:false disables the focus
// ping that was the immediate bounce trigger. Web builds are unaffected.
const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
const desktopClerkOptions: { standardBrowser?: boolean; touchSession?: boolean } =
  isTauri ? { standardBrowser: false, touchSession: false } : {};
import { Toaster } from "sonner";
import App from "./App";
import { store } from "./store/store";
import { DesktopAuthHydrator } from "@/components/auth/DesktopAuthHydrator";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing Publishable Key");
}

function ClerkProviderWithNavigate({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();

  return (
    <ClerkProvider
      {...desktopClerkOptions}
      allowedRedirectProtocols={["http:", "https:", "tauri:"]}
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      routerPush={(to: string) => navigate(to)}
      routerReplace={(to: string) => navigate(to, { replace: true })}
    >
      {children}
    </ClerkProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <ClerkProviderWithNavigate>
          <TooltipProvider>
            <DesktopAuthHydrator source="main">
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </DesktopAuthHydrator>
            <Toaster richColors position="bottom-right" />
          </TooltipProvider>
        </ClerkProviderWithNavigate>
      </BrowserRouter>
    </Provider>
  </StrictMode>,
);
