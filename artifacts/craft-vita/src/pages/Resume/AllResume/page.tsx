import { useState, useEffect, Suspense } from "react";
import { useUser } from "@clerk/clerk-react";
import ListOfResumes, { Resume } from "@/components/Resume/ListOfResumes";
import { Skeleton } from "@/components/ui/skeleton";

function ResumeTableSkeleton() {
  return (
    <div className="space-y-4 px-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

function ResumeListContent({ userId }: { userId: string }) {
  const [selectedResume, setSelectedResume] = useState<Resume | null>(null);

  return (
    <div className="space-y-6">
      <ListOfResumes
        userId={userId}
        onSelectResume={setSelectedResume}
        selectedResumeId={selectedResume?.id}
      />
    </div>
  );
}

export default function AllResumes() {
  const { isLoaded, isSignedIn } = useUser();
  const [userId, setUserId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  // ✅ async-cheap-condition-before-await: Check conditions before fetching
  // ✅ rendering-hydration-no-flicker: Proper loading state to avoid flicker
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    // Fast path: userId already in localStorage
    const storedUserId = localStorage.getItem("userId");
    if (storedUserId) {
      setUserId(storedUserId);
      setIsReady(true);
      return;
    }

    // Slow path: useSyncUser hasn't finished yet — wait for the event
    function onUserSynced(e: Event) {
      const detail = (e as CustomEvent<{ userId: string }>).detail;
      if (detail?.userId) {
        setUserId(detail.userId);
        setIsReady(true);
      }
    }

    window.addEventListener("userSynced", onUserSynced);
    return () => window.removeEventListener("userSynced", onUserSynced);
  }, [isLoaded, isSignedIn]);

  // Handle loading states with proper UI feedback
  if (!isLoaded) {
    return (
      <div className="space-y-6 px-2 py-8">
        <div>
          <Skeleton className="h-8 w-32 rounded mb-4" />
          <ResumeTableSkeleton />
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-slate-600">Please sign in to view your resumes</p>
      </div>
    );
  }

  if (!isReady || !userId) {
    return (
      <div className="space-y-6 px-2 py-8">
        <div>
          <Skeleton className="h-8 w-32 rounded mb-4" />
          <ResumeTableSkeleton />
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<ResumeTableSkeleton />}>
      <ResumeListContent userId={userId} />
    </Suspense>
  );
}
