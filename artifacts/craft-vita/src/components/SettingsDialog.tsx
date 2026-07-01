import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronDown,
  Sparkles,
  Monitor,
  Keyboard,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(true);

  const keyboardShortcuts = [
    {
      title: "AI Answer",
      description:
        "Get an instant AI response based on the current transcript.",
      shortcut: "G",
      icon: Sparkles,
      color: "text-brand bg-brand/10",
    },
    {
      title: "Analyze Screen",
      description: "Analyze the current shared screen for technical insights.",
      shortcut: "K",
      icon: Monitor,
      color: "text-slate-500 bg-slate-100",
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-175 bg-white rounded-xl shadow-2xl border-none p-0 overflow-hidden" aria-describedby={undefined}>
        <DialogHeader className="p-8 pb-4 border-b border-slate-50">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-brand/10 rounded-xl flex items-center justify-center">
              <Settings2 className="h-6 w-6 text-brand" />
            </div>
            <div>
              <DialogTitle className="text-2xl font-bold text-slate-900 leading-none">
                Settings
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1.5">
                Manage your preferences and system configurations.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-8 pt-6 space-y-6 max-h-[70vh] overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-widest px-1">
              General Settings
            </h3>

            <div className="bg-white border border-slate-100 rounded-lg shadow-sm overflow-hidden transition-all hover:border-slate-200">
              <Collapsible
                open={isKeyboardOpen}
                onOpenChange={setIsKeyboardOpen}
                className="w-full"
              >
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between w-full p-3 cursor-pointer select-none group">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 bg-slate-50 rounded-xl flex items-center justify-center group-hover:bg-slate-100 transition-colors">
                        <Keyboard className="h-5 w-5 text-slate-600" />
                      </div>
                      <h4 className="text-base font-bold text-slate-800">
                        Keyboard Shortcuts
                      </h4>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge
                        variant="secondary"
                        className="bg-[#e6fcf5] text-[#08916e] border-none px-3 py-1 text-xs font-bold rounded-full"
                      >
                        2 Active
                      </Badge>
                      <ChevronDown
                        className={cn(
                          "h-5 w-5 text-slate-400 transition-transform duration-300 ease-in-out group-hover:text-slate-600",
                          isKeyboardOpen && "rotate-180",
                        )}
                      />
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="animate-in slide-in-from-top-1 duration-300 ease-out">
                  <div className="border-t border-slate-50 divide-y divide-slate-50 bg-white">
                    {keyboardShortcuts.map((item, index) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between p-5 hover:bg-slate-50/20 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.color}`}
                            >
                              <Icon className="h-5 w-5" />
                            </div>
                            <div>
                              <h4 className="text-sm font-semibold text-gray-900">
                                {item.title}
                              </h4>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {item.description}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <kbd className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs font-bold text-slate-900 shadow-sm leading-none">
                              <span className="text-sm opacity-50 font-sans">
                                ⌘
                              </span>
                              <span className="opacity-30 font-light">+</span>
                              <span>{item.shortcut}</span>
                            </kbd>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>

          {/* <div className="bg-slate-50/50 border border-slate-100 border-dashed rounded-3xl p-12 text-center">
            <p className="text-sm font-medium text-slate-500">
              More settings coming soon
            </p>
          </div> */}
        </div>
      </DialogContent>
    </Dialog>
  );
}
