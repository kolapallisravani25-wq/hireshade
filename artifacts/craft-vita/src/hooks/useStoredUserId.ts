import { useEffect, useState } from "react";

/**
 * The internal (backend) user id that `useSyncUser` stores in localStorage after
 * calling `/api/auth/me`. This is NOT the Clerk user id — several list endpoints
 * (resume/document/ATS) are scoped by this internal id.
 *
 * Returned as reactive state so components re-render (and re-fetch) when the id
 * becomes available. Without this, a component that reads localStorage once at
 * mount stays empty forever if the id wasn't set yet — e.g. right after a data
 * wipe cleared localStorage and `useSyncUser` only repopulates it a moment later
 * on the next sign-in. `useSyncUser` dispatches a `userSynced` event when it
 * writes the id, which this hook listens for.
 */
export function useStoredUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem("userId") : null,
  );

  useEffect(() => {
    const sync = () =>
      setUserId(
        typeof localStorage !== "undefined"
          ? localStorage.getItem("userId")
          : null,
      );
    window.addEventListener("userSynced", sync);
    window.addEventListener("storage", sync); // cross-tab / other writers
    return () => {
      window.removeEventListener("userSynced", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return userId;
}
