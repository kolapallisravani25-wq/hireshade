import { useLocation, useSearchParams, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useStoredUserId } from "@/hooks/useStoredUserId";
import { ATSAnalysisDialog } from "./Resume/ATSAnalysisDialog";
import { BuildResumeDialog } from "./Resume/BuildResumeDialog";
import CreateSessionDialog from "@/components/Sessions/CreateSessionDialog";
import UploadDocumentDialog from "@/components/Document/UploadDocumentDialog";
import { CreditsBadge } from "@/components/CreditsBadge";
import { SidebarTrigger } from "@/components/ui/sidebar";

const routeConfig: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/sessions": "Sessions",
  "/resume/all": "All Resumes",
  "/resume/ats-analysis": "ATS Analysis",
  "/resume/build": "Resume Studio",
  "/resume/editor": "Resume Editor",
  "/resume/cover-letter": "Cover Letter",
  "/resume/ats-result": "ATS Result",
  "/analytics": "Analytics",
  "/document": "Document",
  "/questions": "Question Bank",
  "/ai-projects": "AI Projects",
  "/billing": "Credits",
  "/support": "Support",
  "/help": "Help & Manual",
};

const Navbar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const title =
    Object.entries(routeConfig)
      .sort((a, b) => b[0].length - a[0].length)
      .find(([route]) => location.pathname.startsWith(route))?.[1] ||
    "HireShade";

  const isATSAnalysisPage = location.pathname.startsWith("/resume/ats-analysis");
  const isSessionsPage = location.pathname === "/sessions";

  const openCreate = searchParams.get("openCreate") === "true";
  const openCreateIsFree = searchParams.get("isFree") === "true";

  useEffect(() => {
    if (openCreate || openCreateIsFree) {
      navigate(location.pathname, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDocumentPage = location.pathname.startsWith("/document");
  const userId = useStoredUserId() ?? "";

  return (
    <nav className="flex items-center justify-between px-5 bg-white border-b border-[#E8E6E0] sticky top-0 z-50 w-full h-14">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="md:hidden -ml-1 text-gray-400 hover:text-gray-700" />
        {/* DM Serif Display heading — matches reference topbar-title */}
        <h1 className="font-serif text-[18px] text-[#1B1B3A] leading-none">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        {isSessionsPage && (
          <>
            <CreateSessionDialog
              isFree={true}
              defaultOpen={openCreate && openCreateIsFree}
            />
            <CreateSessionDialog
              isFree={false}
              defaultOpen={openCreate && !openCreateIsFree}
            />
          </>
        )}
        {isATSAnalysisPage && <ATSAnalysisDialog />}
        {isDocumentPage && <UploadDocumentDialog userId={userId} />}

        <CreditsBadge />
      </div>
    </nav>
  );
};

export default Navbar;
