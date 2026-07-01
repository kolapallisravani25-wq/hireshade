export interface Citation {
  id: string;
  question?: string;
  answer?: string;
  technologies?: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  timestamp: string;
}
