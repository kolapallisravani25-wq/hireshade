import { useState, useRef, useEffect } from "react";
import { Plus, Search, Trash2, Pencil, Check, X, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { AssistantChat } from "../hooks/useAssistant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  chats: AssistantChat[];
  activeChatId: string | null;
  isLoading?: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function ChatList({
  chats,
  activeChatId,
  isLoading,
  onNew,
  onSelect,
  onRename,
  onDelete,
}: Props) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  const filtered = chats.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()),
  );

  const startEdit = (chat: AssistantChat, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(chat.id);
    setEditValue(chat.title);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <div className="flex flex-col h-full border-r border-border bg-sidebar">
      <div className="p-3 border-b border-border">
        <Button
          onClick={onNew}
          className="w-full h-9 gap-2 text-sm bg-brand hover:bg-brand/90 text-white"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </Button>
      </div>

      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="pl-8 h-8 text-xs bg-muted/40 border-border"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex flex-col gap-1 px-2 py-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              {search ? "No matching chats" : "No chats yet. Start a new one!"}
            </p>
          </div>
        ) : (
          filtered.map((chat) => (
            <div
              key={chat.id}
              onClick={() => onSelect(chat.id)}
              className={cn(
                "group relative flex items-center gap-2 mx-2 my-0.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 hover:bg-muted/60",
                activeChatId === chat.id && "bg-muted border border-border",
              )}
            >
              {editingId === chat.id ? (
                <div
                  className="flex items-center gap-1 flex-1 min-w-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    ref={editRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    className="flex-1 text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:border-brand min-w-0"
                  />
                  <button
                    onClick={commitEdit}
                    className="p-0.5 text-green-500 hover:text-green-600 flex-shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="p-0.5 text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {chat.title}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {chat._count?.messages ?? 0} message{(chat._count?.messages ?? 0) !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={(e) => startEdit(chat, e)}
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(chat.id);
                      }}
                      className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
