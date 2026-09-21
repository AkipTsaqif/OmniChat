export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "meta"
  | "mistral"
  | "deepseek"
  | "xai"
  | "qwen"
  | "cohere"
  | "unknown";

export type ThinkingLevel = "off" | "low" | "medium" | "high";

/** Result of probing the user's configured gateway. */
export type ProviderStatus =
  | "none"
  | "ok"
  | "empty"
  | "unauthorized"
  | "unreachable"
  | "key_undecryptable";

export type Provider = {
  id: ProviderId;
  name: string;
  /** Short mark rendered inside the provider chip. */
  mark: string;
  /** Tailwind classes for the provider chip. */
  accent: string;
};

export type Model = {
  id: string;
  name: string;
  provider: string;
  providerName?: string;
  providerMark?: string;
  description: string;
  contextWindow: string;
  badges?: string[];
};

/** Models are discovered from the gateway, so a chat may have none yet. */
export type ModelCatalog = Model[];

export type Role = "user" | "assistant";

export type Feedback = "like" | "dislike";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type ToolCallInfo = {
  id: string;
  name: string;
  query?: string;
  state: "running" | "done";
  results?: SearchResult[];
};

export type Attachment = {
  id: string;
  name: string;
  size: string;
  kind: "image" | "file";
};

export type Message = {
  id: string;
  role: Role;
  /** Raw content. Fenced code blocks (```lang) are rendered specially. */
  content: string;
  createdAt: string;
  /** Only set for assistant messages. */
  modelId?: string;
  attachments?: Attachment[];
  toolCalls?: ToolCallInfo[];
  feedback?: Feedback | null;
  /** Assistant-side telemetry, rendered in the message footer. */
  stats?: {
    tokens: number;
    latency: string;
  };
};

export type Conversation = {
  id: string;
  title: string;
  modelId: string;
  systemPrompt?: string | null;
  updatedAt: string;
  /** Grouping bucket used by the sidebar history list. */
  bucket: "Today" | "Yesterday" | "Previous 7 days" | "Older";
  pinned?: boolean;
  preview: string;
  messages: Message[];
};
