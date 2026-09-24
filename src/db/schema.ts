import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";
import type { ToolCallInfo } from "@/lib/types";

export const roleEnum = pgEnum("role", ["user", "assistant"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  /** scrypt hash, `salt:hash` hex. Null for OAuth-only accounts. */
  passwordHash: text("password_hash"),
  plan: text("plan").notNull().default("Free"),
  systemPrompt: text("system_prompt"),
  /**
   * Whether to offer a memory suggestion after each turn. This costs one extra
   * gateway call per turn, so it is switchable — and it only ever suggests,
   * never saves.
   */
  autoSuggestMemory: boolean("auto_suggest_memory").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ---------------------------------------------------------------- *
 * Auth.js adapter tables
 * ---------------------------------------------------------------- */

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

/* ---------------------------------------------------------------- *
 * Provider settings — the OmniRoute connection
 * ---------------------------------------------------------------- */

export const providerSettings = pgTable("provider_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Which gateway the key belongs to, e.g. "omniroute". */
  provider: text("provider").notNull().default("omniroute"),
  baseUrl: text("base_url").notNull(),
  /** AES-256-GCM ciphertext — never returned to the client. */
  apiKeyCipher: text("api_key_cipher").notNull(),
  /** Last 4 characters, safe to display for recognition. */
  apiKeyLast4: text("api_key_last4").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ---------------------------------------------------------------- *
 * Web search settings
 * ---------------------------------------------------------------- */

export const searchSettings = pgTable("search_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Which engine to try first. Everything else is still tried as a fallback,
   * with DuckDuckGo last as the keyless floor.
   */
  preferred: text("preferred").notNull().default("auto"),
  /** AES-256-GCM ciphertext. Null when the user has not supplied a key. */
  tavilyApiKeyCipher: text("tavily_api_key_cipher"),
  /** Last 4 characters, safe to display for recognition. */
  tavilyApiKeyLast4: text("tavily_api_key_last4"),
  /** Base URL of a self-hosted SearXNG instance. */
  searxngUrl: text("searxng_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ---------------------------------------------------------------- *
 * Chat
 * ---------------------------------------------------------------- */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    modelId: text("model_id").notNull(),
    systemPrompt: text("system_prompt"),
    pinned: boolean("pinned").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    /**
     * Whether cross-chat memory may be injected into this conversation. Off
     * means a clean room: a generic question gets no remembered context.
     */
    memoryEnabled: boolean("memory_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_conversations_user_recent").on(
      table.userId,
      table.updatedAt.desc(),
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    content: text("content").notNull(),
    modelId: text("model_id"),
    tokens: integer("tokens"),
    latencyMs: integer("latency_ms"),
    attachments: jsonb("attachments").$type<
      { id: string; name: string; size: string; kind: "image" | "file" }[]
    >(),
    toolCalls: jsonb("tool_calls").$type<ToolCallInfo[]>(),
    feedback: text("feedback").$type<"like" | "dislike">(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_messages_conversation").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const sharedChats = pgTable(
  "shared_chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    modelId: text("model_id").notNull(),
    messagesSnapshot: jsonb("messages_snapshot")
      .$type<
        {
          id: string;
          role: "user" | "assistant";
          content: string;
          createdAt: string;
          modelId?: string;
        }[]
      >()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_shared_chats_conversation").on(table.conversationId),
  ],
);

/* ---------------------------------------------------------------- *
 * Cross-chat memory
 * ---------------------------------------------------------------- */

/**
 * A fact the user asked us to keep between conversations.
 *
 * `conversationId` is nullable and does double duty: NULL means the memory is
 * global and applies everywhere; non-null means it is scoped to that one
 * conversation (and carries provenance along with `sourceMessageId`).
 *
 * `content` is written as a standalone sentence — it will be read out of
 * context and injected into prompts that never saw the conversation it came
 * from.
 */
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** null = global; non-null = only in that conversation. */
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    /** 'preference' | 'personal' | 'project' | 'constraint'. */
    category: text("category").notNull().default("preference"),
    content: text("content").notNull(),
    /** Provenance — lets the UI say "from our chat on 21 Sep". */
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    /** 'active' | 'archived'. Archived is a soft forget, not a delete. */
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_memories_user").on(
      table.userId,
      table.status,
      table.createdAt.desc(),
    ),
  ],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  conversations: many(conversations),
  providerSettings: one(providerSettings),
  searchSettings: one(searchSettings),
  sharedChats: many(sharedChats),
  memories: many(memories),
}));

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [conversations.userId],
      references: [users.id],
    }),
    messages: many(messages),
    sharedChats: many(sharedChats),
    memories: many(memories),
  }),
);

export const sharedChatsRelations = relations(sharedChats, ({ one }) => ({
  conversation: one(conversations, {
    fields: [sharedChats.conversationId],
    references: [conversations.id],
  }),
  user: one(users, {
    fields: [sharedChats.userId],
    references: [users.id],
  }),
}));

export const memoriesRelations = relations(memories, ({ one }) => ({
  user: one(users, {
    fields: [memories.userId],
    references: [users.id],
  }),
  conversation: one(conversations, {
    fields: [memories.conversationId],
    references: [conversations.id],
  }),
  sourceMessage: one(messages, {
    fields: [memories.sourceMessageId],
    references: [messages.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  memories: many(memories),
}));

export type DbUser = typeof users.$inferSelect;
export type DbConversation = typeof conversations.$inferSelect;
export type DbMessage = typeof messages.$inferSelect;
export type DbSharedChat = typeof sharedChats.$inferSelect;
export type DbProviderSettings = typeof providerSettings.$inferSelect;
export type DbSearchSettings = typeof searchSettings.$inferSelect;
export type DbMemory = typeof memories.$inferSelect;
