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

/** A single page reduced to readable text by the `fetch_page` tool. */
export type PageContent = {
  url: string;
  title: string;
  text: string;
  /** True when the text hit the length cap and the page continues. */
  truncated: boolean;
};

/** Which backend actually answered a search. */
export type SearchSource = "tavily" | "searxng" | "duckduckgo";

/**
 * `ok: true` with zero results is a genuine empty set — the web had nothing.
 * `ok: false` means no backend produced an answer at all. The two must never be
 * conflated: the first is a finding, the second is an inability to check.
 */
export type SearchOutcome =
  | { ok: true; source: SearchSource; results: SearchResult[] }
  | { ok: false; reason: string };

export type ToolCallInfo = {
  id: string;
  name: string;
  /** Search query, for `web_search`. */
  query?: string;
  /** Page read, for `fetch_page`. */
  url?: string;
  title?: string;
  excerpt?: string;
  state: "running" | "done" | "failed";
  /** Which backend answered, when one did. */
  source?: SearchSource;
  /** Why the tool ran but produced nothing usable. */
  error?: string;
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
