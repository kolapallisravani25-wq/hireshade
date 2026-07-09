import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useEffect, lazy, Suspense } from "react";
import { useConfirmedSignOut } from "@/hooks/useConfirmedSignOut";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { useSyncUser } from "@/hooks/useSyncUser";
import { isTauri } from "@/lib/utils";
import ResumeEditorV2 from "@/components/Resume/ResumeEditorV2";
import "./App.css";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TauriReturnBanner } from "@/components/TauriReturnBanner";
import Navbar from "./components/Navbar";
import { invoke } from "@tauri-apps/api/core";

// Lazy-load all route-level pages so each page's JS is only downloaded when
// the user first navigates to that route (bundle-dynamic-imports rule).
const Dashboard = lazy(() => import("./pages/Dashboard/page"));
const DesktopAuthHandoff = lazy(
  () => import("./pages/DesktopAuth/DesktopAuthHandoff"),
);
const Sessions = lazy(() => import("./pages/Sessions/page"));
const AllResumes = lazy(() => import("./pages/Resume/AllResume/page"));
const ATSAnalysis = lazy(() => import("./pages/Resume/ATSAnalysis/page"));
const CoverLetter = lazy(() => import("./pages/Resume/CoverLetter/page"));
const ATSResult = lazy(() => import("./pages/Resume/ATSResult/page"));
const Analytics = lazy(() => import("./pages/Analytics/page"));
const DocumentPage = lazy(() => import("./pages/Document/page"));
const AllQuestions = lazy(
  () => import("./pages/QuestionBank/All Questions/page"),
);
const UserQuestions = lazy(
  () => import("./pages/QuestionBank/User Questions/page"),
);
const CompanyQuestions = lazy(
  () => import("./pages/QuestionBank/CompanyQuestions/page"),
);
const QuestionDetails = lazy(
  () => import("./pages/QuestionBank/QuestionDetails/page"),
);
const ActiveSession = lazy(() => import("./pages/Sessions/ActiveSession/page"));
const SessionReview = lazy(() => import("./pages/Sessions/SessionReview"));
const BuildResume = lazy(() => import("./pages/Resume/BuildResume/page"));
const ResumeEditor = lazy(() => import("./pages/Resume/ResumeEditor/page"));
const SignInPage = lazy(() => import("./pages/Auth/SignIn/page"));
const SignUpPage = lazy(() => import("./pages/Auth/SignUp/page"));
const SSOCallbackPage = lazy(() => import("./pages/Auth/SSOCallback/page"));
const BillingPage = lazy(() => import("./pages/Billing/page"));
const AccountUsagePage = lazy(() => import("./pages/Account/Usage/page"));
const AIProjects = lazy(() => import("./pages/AIProjects/page"));
const ProjectRecommendations = lazy(
  () => import("./pages/AIProjects/ProjectRecommendations/page"),
);
const AssistantPage = lazy(() => import("./pages/Assistant/page"));
const SupportPage = lazy(() => import("./pages/Support/page"));
const HelpPage = lazy(() => import("./pages/Help/page"));

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
    </div>
  );
}

function App() {
  const { isSignedIn, isLoaded, signedOutConfirmed } = useConfirmedSignOut();
  const location = useLocation();
  const navigate = useNavigate();
  useSyncUser();

  
  // ── Auth sync: broadcast sign-out to widget
  // Navigation from widget → dashboard is handled via URL params (no event
  // needed — Rust calls win.navigate(url?openCreate=true&isFree=true) so the
  // React app loads directly at the right route with conditions in the URL.)
  useEffect(() => {
    if (!isTauri()) return;
    // Only broadcast once the sign-out is confirmed (not a token-refresh blip),
    // otherwise every transient false cascades to the launcher/floating windows.
    if (isLoaded && !isSignedIn && signedOutConfirmed) {
      emit("auth:signed-out").catch(() => undefined);
    }
  }, [isSignedIn, isLoaded, signedOutConfirmed]);

  // Listen for hireshade:// deep-links from the OS (e.g. "Return to HireShade"
  // button after OAuth, or a hireshade://oauth-callback from Clerk).
  // Rust already focuses the window; this handler covers URL routing.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    onOpenUrl((urls) => {
      const url = Array.isArray(urls) ? urls[0] : urls;
      if (typeof url !== "string") return;

      getCurrentWebviewWindow()
        .setFocus()
        .catch(() => undefined);

      if (url.startsWith("hireshade://oauth-callback")) {
        const parsed = new URL(url);
        navigate(`/sso-callback${parsed.search}`);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    // Listen for cross-window navigation requests
    const unlistenNavigate = listen("navigate", (event) => {
      const payload = event.payload as { to: string; state?: any };
      if (payload.to) {
        navigate(payload.to, { state: payload.state });
      }
    });

    return () => {
      unlisten?.();
      unlistenNavigate.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"></div>
          <p className="text-slate-600 font-medium">Loading HireShade...</p>
        </div>
      </div>
    );
  }

  // Define paths that don't require authentication
  const authPaths = [
    "/sign-in",
    "/sign-up",
    "/sso-callback",
    "/sign-in/sso-callback",
    "/sign-up/sso-callback",
  ];
  const isAuthPage = authPaths.some((path) =>
    location.pathname.startsWith(path),
  );

  // Desktop external-browser auth handoff. This page renders its own signed-in
  // and signed-out states (it shows Clerk sign-in inline when needed, then mints
  // a desktop token and hands it back to the app), so it must bypass the normal
  // auth-gate redirects below.
  if (location.pathname.startsWith("/desktop-auth")) {
    return (
      <Suspense fallback={<PageLoader />}>
        <DesktopAuthHandoff />
      </Suspense>
    );
  }

  // In the Tauri webview isSignedIn can blip false during a token refresh.
  // While the sign-out is still unconfirmed, hold on a loader instead of
  // bouncing to /sign-in — this is what previously kicked users out of the
  // session-creation form the moment they interacted with it.
  if (!isSignedIn && !signedOutConfirmed && !isAuthPage) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"></div>
          <p className="text-slate-600 font-medium">Loading HireShade...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn && signedOutConfirmed && !isAuthPage) {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  // If already signed in and trying to access an auth page, persist any
  // Tauri auth params into sessionStorage BEFORE redirecting so the
  // TauriReturnBanner can pick them up on the dashboard.
  if (isSignedIn && isAuthPage) {
    const sp = new URLSearchParams(location.search);
    if (sp.get("from") === "tauri") {
      sessionStorage.setItem("from_tauri", "true");
    }
    const port = sp.get("port");
    if (port) {
      sessionStorage.setItem("tauri_auth_port", port);
    }
    return <Navigate to="/dashboard" replace />;
  }

  if (!isSignedIn) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/sign-in/*" element={<SignInPage />} />
          <Route path="/sign-up/*" element={<SignUpPage />} />
          <Route path="/sso-callback" element={<SSOCallbackPage />} />
          <Route path="/sign-in/sso-callback" element={<SSOCallbackPage />} />
          <Route path="/sign-up/sso-callback" element={<SSOCallbackPage />} />
          <Route path="*" element={<Navigate to="/sign-in" replace />} />
        </Routes>
      </Suspense>
    );
  }

  // Full-page Session Review (Issue 1) — rendered inside the main app layout
  // (sidebar + navbar) as a full-height workspace, NOT the ActiveSession overlay.
  if (location.pathname.endsWith("/review")) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="flex flex-col h-screen overflow-hidden">
          <TauriReturnBanner />
          <Navbar />
          <div className="flex-1 overflow-hidden min-h-0">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route
                  path="/sessions/:id/review"
                  element={<SessionReview />}
                />
                <Route path="*" element={<Navigate to="/sessions" replace />} />
              </Routes>
            </Suspense>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Handle active session route (Overlay) outside main layout
  if (location.pathname.startsWith("/sessions/")) {
    const id = location.pathname.split("/")[2];
    if (id && id !== "list") {
      // Assuming list is /sessions or similar
      return (
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/sessions/:id" element={<ActiveSession />} />
          </Routes>
        </Suspense>
      );
    }
  }

  //Routes

  // ── Temporary design preview — remove once ResumeEditorV2 is wired up ──
  if (location.pathname === "/resume/editor-v2") {
    return <ResumeEditorV2 />;
  }

  // Full-bleed assistant layout — needs full viewport height for chat UI
  if (location.pathname === "/assistant") {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="flex flex-col h-screen overflow-hidden">
          <TauriReturnBanner />
          <Navbar />
          <div className="flex-1 overflow-hidden min-h-0">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/assistant" element={<AssistantPage />} />
                <Route
                  path="*"
                  element={<Navigate to="/assistant" replace />}
                />
              </Routes>
            </Suspense>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Full-bleed editor layout — no padding wrapper, no max-width constraint
  if (location.pathname === "/resume/editor") {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="flex flex-col h-screen overflow-hidden">
          <TauriReturnBanner />
          <Navbar />
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/resume/editor" element={<ResumeEditor />} />
                <Route
                  path="*"
                  element={<Navigate to="/resume/editor" replace />}
                />
              </Routes>
            </Suspense>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-muted/20 flex flex-col min-h-0">
        <TauriReturnBanner />
        <Navbar />
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-7xl mx-auto">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route
                  path="/"
                  element={<Navigate to="/dashboard" replace />}
                />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/sessions" element={<Sessions />} />
                <Route path="/resume/all" element={<AllResumes />} />
                <Route path="/resume/ats-analysis" element={<ATSAnalysis />} />
                <Route path="/resume/build" element={<BuildResume />} />
                <Route path="/resume/editor" element={<ResumeEditor />} />
                <Route path="/resume/cover-letter" element={<CoverLetter />} />
                <Route path="/resume/ats-result" element={<ATSResult />} />
                <Route path="/ai-projects" element={<AIProjects />} />
                <Route
                  path="/ai-projects/:projectId"
                  element={<ProjectRecommendations />}
                />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/document" element={<DocumentPage />} />
                <Route path="/billing" element={<BillingPage />} />
                <Route path="/account/usage" element={<AccountUsagePage />} />
                <Route path="/support" element={<SupportPage />} />
                <Route path="/help" element={<HelpPage />} />
                <Route
                  path="/questions"
                  element={<Navigate to="/questions/all" replace />}
                />
                <Route path="/questions/all" element={<AllQuestions />} />
                <Route path="/questions/user" element={<UserQuestions />} />
                <Route
                  path="/questions/user/question/:questionId"
                  element={<Navigate to="/questions/user" replace />}
                />
                <Route
                  path="/questions/company/:companySlug"
                  element={<CompanyQuestions />}
                />
                <Route
                  path="/questions/company/:companySlug/question/:questionId"
                  element={<QuestionDetails />}
                />
                <Route
                  path="/questions/question/:questionId"
                  element={<QuestionDetails />}
                />
                <Route
                  path="*"
                  element={<Navigate to="/dashboard" replace />}
                />
              </Routes>
            </Suspense>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default App;
