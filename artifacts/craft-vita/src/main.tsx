import "@/lib/disableDebugLogs";
import { BrowserRouter, useNavigate } from "react-router-dom";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider } from "@clerk/clerk-react";
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
