import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import LaunchApp from "./rebuild/LaunchApp";
import "./App.css";

const SignInPage = lazy(() => import("./pages/Auth/SignIn/page"));
const SignUpPage = lazy(() => import("./pages/Auth/SignUp/page"));
const SSOCallbackPage = lazy(() => import("./pages/Auth/SSOCallback/page"));

function PageLoader() {
  return (
    <div className="grid min-h-screen place-items-center bg-white">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-900 border-t-transparent" />
        <p className="text-sm font-bold text-slate-600">Loading HireShade...</p>
      </div>
    </div>
  );
}

export default function App() {
  const { isLoaded, isSignedIn } = useUser();
  const location = useLocation();

  if (!isLoaded) return <PageLoader />;

  const authPaths = ["/sign-in", "/sign-up", "/sso-callback", "/sign-in/sso-callback", "/sign-up/sso-callback"];
  const isAuthPage = authPaths.some((path) => location.pathname.startsWith(path));

  if (!isSignedIn || isAuthPage) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/sign-in/*" element={<SignInPage />} />
          <Route path="/sign-up/*" element={<SignUpPage />} />
          <Route path="/sso-callback" element={<SSOCallbackPage />} />
          <Route path="/sign-in/sso-callback" element={<SSOCallbackPage />} />
          <Route path="/sign-up/sso-callback" element={<SSOCallbackPage />} />
          <Route path="*" element={<Navigate to={isSignedIn ? "/dashboard" : "/sign-in"} replace />} />
        </Routes>
      </Suspense>
    );
  }

  return <LaunchApp />;
}
