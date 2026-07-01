import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

interface OverlayContainerProps {
  leftComponent: React.ReactNode;
  rightComponent: React.ReactNode;
  isFullscreen: boolean;
}

export const OverlayContainer = ({
  leftComponent,
  rightComponent,
  isFullscreen,
}: OverlayContainerProps) => {
  if (!isFullscreen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* 🌫️ GLOBAL DIM BACKGROUND */}
      <div className="absolute inset-0 bg-black/40" />

      {/* CONTENT */}
      <div className="relative z-10 w-full h-full">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* LEFT PANEL */}
          <ResizablePanel defaultSize={40} minSize={10}>
            <div
              className={cn(
                "h-full relative overflow-hidden transition-all duration-500 flex flex-col",
                "bg-white/10 text-white border border-white/20",
              )}
            >
              {leftComponent}
            </div>

            {/* <Button
              onClick={() => setIsLeftCollapsed(!isLeftCollapsed)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-50 h-10 w-6 p-0 rounded-r-xl bg-white/20 border border-white/30 text-white hover:bg-white/40"
            >
              {isLeftCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button> */}
          </ResizablePanel>

          <ResizableHandle className="bg-white/10 hover:bg-white/20" />

          {/* RIGHT PANEL */}
          <ResizablePanel defaultSize={60} minSize={10}>
            <div
              className={cn(
                "h-full relative overflow-hidden transition-all duration-500 flex flex-col",
                "bg-white/10 text-white border border-white/20",
              )}
            >
              {rightComponent}
            </div>

            {/* <Button
              onClick={() => setIsRightCollapsed(!isRightCollapsed)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-50 h-10 w-6 p-0 rounded-l-xl bg-white/20 border border-white/30 text-white hover:bg-white/40"
            >
              {isRightCollapsed ? (
                <ChevronLeft className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button> */}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
};
