import { useAssistant } from "./hooks/useAssistant";
import { ChatList } from "./components/ChatList";
import { ChatWindow } from "./components/ChatWindow";
import { useEffect } from "react";

export default function AssistantPage() {
  const {
    chats,
    activeChat,
    activeChatId,
    messages,
    isStreaming,
    isLoading,
    inputValue,
    setInputValue,
    newChat,
    selectChat,
    renameChat,
    deleteChat,
    setScopeSession,
    sendMessage,
    loadChats,
  } = useAssistant();

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left panel — chat list */}
      <div className="w-72 flex-shrink-0 hidden md:flex flex-col">
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onNew={newChat}
          onSelect={selectChat}
          onRename={renameChat}
          onDelete={deleteChat}
        />
      </div>

      {/* Right panel — chat window */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ChatWindow
          chat={activeChat}
          messages={messages}
          isStreaming={isStreaming}
          isLoading={isLoading}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSend={sendMessage}
          onScopeChange={setScopeSession}
        />
      </div>
    </div>
  );
}
