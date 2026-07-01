import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.PanelGroupProps) {
  return (
    <ResizablePrimitive.PanelGroup
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.PanelResizeHandleProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      className={cn(
        "relative flex items-center justify-center bg-border focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden",
        "data-[panel-group-direction=horizontal]:w-2 data-[panel-group-direction=horizontal]:hover:w-3 data-[panel-group-direction=horizontal]:transition-[width]",
        "data-[panel-group-direction=vertical]:h-2 data-[panel-group-direction=vertical]:hover:h-3 data-[panel-group-direction=vertical]:transition-[height]",
        "hover:bg-slate-200/50",
        className
      )}
      {...props}
    >
      <div className={cn(
        "bg-border rounded-full",
        "data-[panel-group-direction=horizontal]:w-px data-[panel-group-direction=horizontal]:h-full",
        "data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full",
        "group-hover:bg-primary/50"
      )} />
      {withHandle && (
        <div className={cn(
          "z-10 flex shrink-0 rounded-full bg-slate-400/50 shadow-sm transition-all",
          "data-[panel-group-direction=horizontal]:h-8 data-[panel-group-direction=horizontal]:w-1.5",
          "data-[panel-group-direction=vertical]:w-8 data-[panel-group-direction=vertical]:h-1.5",
        )} />
      )}
    </ResizablePrimitive.PanelResizeHandle>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
