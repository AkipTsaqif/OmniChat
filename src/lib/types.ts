export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "meta"
  | "mistral"
  | "unknown";

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
  provider: ProviderId;
  description: string;
  contextWindow: string;
  badges?: string[];
};

/** Models are discovered from the gateway, so a chat may have none yet. */
export type ModelCatalog = Model[];

export type Role = "user" | "assistant";

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
  updatedAt: string;
  /** Grouping bucket used by the sidebar history list. */
  bucket: "Today" | "Yesterday" | "Previous 7 days" | "Older";
  pinned?: boolean;
  preview: string;
  messages: Message[];
};
