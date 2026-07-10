import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/clerk-react";
import { registerGetToken } from "@/lib/globalAuth";
import { hasDesktopSession } from "@/lib/desktopSession";

export function useSyncUser() {
  const { getToken, isSignedIn } = useAuth();

  const getTokenRef = useRef(getToken);
  useEffect(() => { getTokenRef.current = getToken; }, [getToken]);
  useEffect(() => {
    // In the desktop app the desktop access token is the source of truth
    // (registered by DesktopAuthProvider). Registering Clerk's signed-out token
    // here would clobber it and 401 every call. Skip when a desktop session
    // exists; on the web this registers Clerk's token as before.
    if (hasDesktopSession()) return;
    registerGetToken(() => getTokenRef.current());
  }, []);

  useEffect(() => {
    async function sync() {
      if (!isSignedIn) {
        localStorage.removeItem("userId");
        return;
      }

      try {
        const token = await getToken();
        if (!token) return;

        const response = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/auth/me`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (response.ok) {
          const data = await response.json();
          if (data && data.id) {
            localStorage.setItem("userId", data.id);
            window.dispatchEvent(new CustomEvent("userSynced", { detail: { userId: data.id } }));
          }
        } else {
          console.error("Failed to fetch user profile", await response.text());
        }
      } catch (error) {
        console.error("Error fetching user profile:", error);
      }
    }

    sync();
  }, [isSignedIn, getToken]);
}
