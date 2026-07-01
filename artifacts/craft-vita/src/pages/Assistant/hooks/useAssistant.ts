import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";

const API = import.meta.env.VITE_BACKEND_URL;

export interface AssistantChat {
  id: string;
  title: string;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
}

export interface AssistantMessage {
  id: string;
  chatId: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations?: { id: string; question: string; sessionId?: string; companyName?: string | null }[];
  createdAt: string;
}

async function apiFetch(url: string, token: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useAssistant() {
  const { getToken } = useAuth();
  const [chats, setChats] = useState<AssistantChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const streamingIdRef = useRef<string | null>(null);

  const getAuthToken = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");
    return token;
  }, [getToken]);

  const loadChats = useCallback(async () => {
    try {
      const token = await getAuthToken();
      const res = await apiFetch(`${API}/api/assistant`, token);
      setChats(res.data ?? []);
    } catch (err: any) {
      setError(err.message);
    }
  }, [getAuthToken]);

  const createChat = useCallback(async (title?: string): Promise<AssistantChat | null> => {
    try {
      const token = await getAuthToken();
      const res = await apiFetch(`${API}/api/assistant`, token, {
        method: "POST",
        body: JSON.stringify({ title: title ?? "New Chat" }),
      });
      const chat: AssistantChat = res.data;
      setChats((prev) => [chat, ...prev]);
      return chat;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, [getAuthToken]);

  const selectChat = useCallback(async (chatId: string) => {
    setActiveChatId(chatId);
    setMessages([]);
    setIsLoading(true);
    try {
      const token = await getAuthToken();
      const res = await apiFetch(`${API}/api/assistant/${chatId}/messages`, token);
      setMessages(res.data ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [getAuthToken]);

  const renameChat = useCallback(async (chatId: string, title: string) => {
    try {
      const token = await getAuthToken();
      await apiFetch(`${API}/api/assistant/${chatId}/title`, token, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, title } : c)),
      );
    } catch (err: any) {
      setError(err.message);
    }
  }, [getAuthToken]);

  const deleteChat = useCallback(async (chatId: string) => {
    try {
      const token = await getAuthToken();
      await apiFetch(`${API}/api/assistant/${chatId}`, token, { method: "DELETE" });
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        setActiveChatId(null);
        setMessages([]);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [getAuthToken, activeChatId]);

  const setScopeSession = useCallback(async (chatId: string, sessionId: string | null) => {
    try {
      const token = await getAuthToken();
      await apiFetch(`${API}/api/assistant/${chatId}/session`, token, {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      });
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, sessionId } : c)),
      );
    } catch (err: any) {
      setError(err.message);
    }
  }, [getAuthToken]);

  const sendMessage = useCallback(
    async (query: string, aiModel?: string) => {
      if (!query.trim() || isStreaming) return;

      let chatId = activeChatId;

      if (!chatId) {
        const chat = await createChat(query.slice(0, 50));
        if (!chat) return;
        chatId = chat.id;
        setActiveChatId(chatId);
      }

      const userMsg: AssistantMessage = {
        id: `user-${Date.now()}`,
        chatId,
        role: "USER",
        content: query,
        createdAt: new Date().toISOString(),
      };

      const streamingMsgId = `streaming-${Date.now()}`;
      const streamingMsg: AssistantMessage = {
        id: streamingMsgId,
        chatId,
        role: "ASSISTANT",
        content: "",
        createdAt: new Date().toISOString(),
      };

      streamingIdRef.current = streamingMsgId;
      setMessages((prev) => [...prev, userMsg, streamingMsg]);
      setIsStreaming(true);
      setInputValue("");

      try {
        const token = await getAuthToken();
        const res = await fetch(`${API}/api/assistant/${chatId}/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ query, aiModel }),
        });

        if (!res.ok) throw new Error("Stream request failed");

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                accumulated += data.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamingMsgId ? { ...m, content: accumulated } : m,
                  ),
                );
              }
              if (data.done) break;
              if (data.error) throw new Error(data.error);
            } catch {
              // skip malformed lines
            }
          }
        }

        await loadChats();
      } catch (err: any) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingMsgId
              ? { ...m, content: "Sorry, something went wrong. Please try again." }
              : m,
          ),
        );
        setError(err.message);
      } finally {
        setIsStreaming(false);
        streamingIdRef.current = null;
      }
    },
    [activeChatId, isStreaming, createChat, getAuthToken, loadChats],
  );

  const newChat = useCallback(async () => {
    const chat = await createChat();
    if (chat) {
      setActiveChatId(chat.id);
      setMessages([]);
    }
  }, [createChat]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const activeChat = chats.find((c) => c.id === activeChatId) ?? null;

  return {
    chats,
    activeChat,
    activeChatId,
    messages,
    isStreaming,
    isLoading,
    inputValue,
    setInputValue,
    error,
    setError,
    loadChats,
    createChat,
    newChat,
    selectChat,
    renameChat,
    deleteChat,
    setScopeSession,
    sendMessage,
  };
}
