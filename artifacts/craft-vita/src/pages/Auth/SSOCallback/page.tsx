import { useEffect, useRef } from "react";
import { useClerk } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";

// Handles the OAuth redirect for both existing users (sign-in) and new users
// (sign-up). Clerk's handleRedirectCallback processes the handshake params,
// creates the session if needed, and then navigates to the appropriate URL.
const SSOCallbackPage = () => {
  const { handleRedirectCallback } = useClerk();
  const navigate = useNavigate();
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    handleRedirectCallback({
      signInForceRedirectUrl: "/dashboard",
      signUpForceRedirectUrl: "/dashboard",
    }).catch(() => {
      // Callback processing failed — fall back to sign-in
      navigate("/sign-in", { replace: true });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
        <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
      </div>
    </div>
  );
};

export default SSOCallbackPage;


