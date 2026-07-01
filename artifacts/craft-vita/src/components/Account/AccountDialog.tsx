import { Dialog, DialogContent } from "@/components/ui/dialog";
import { UserProfile } from "@clerk/clerk-react";

interface AccountDialogProps {
  isOpen: boolean;
  onClose: (open: boolean) => void;
}

export function AccountDialog({ isOpen, onClose }: AccountDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-auto max-w-[95vw] sm:max-w-fit bg-white rounded-xl shadow-sm border border-gray-100 p-0 max-h-[85vh] flex flex-col [&>button]:bg-white! [&>button]:rounded-full! hover:[&>button]:bg-gray-100!" aria-describedby={undefined}>
        <div className="flex-1 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <UserProfile
            routing="hash"
            appearance={{
              elements: {
                rootBox: "h-full",
                cardBox: "shadow-none border-none",
                card: "m-0 p-0 shadow-none border-none",
                pageScrollBox:
                  "p-4 sm:p-8 h-full overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
              },
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
