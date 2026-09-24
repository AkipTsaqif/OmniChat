"use client";

import * as React from "react";
import {
  ArchiveIcon,
  CreditCardIcon,
  LogOutIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  BrainIcon,
  GlobeIcon,
  SparklesIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";

import type { Conversation, ProviderStatus } from "@/lib/types";

/** Short sidebar label for a gateway that is configured but not usable. */
const PROVIDER_STATUS_LABEL: Partial<Record<ProviderStatus, string>> = {
  unreachable: "Gateway unreachable",
  unauthorized: "API key rejected",
  key_undecryptable: "Key needs re-entry",
  empty: "No models served",
};
import { HISTORY_BUCKETS } from "@/lib/data";
import {
  archiveConversation,
  deleteConversation,
  renameConversation,
  signOutAction,
  togglePinned,
} from "@/app/actions";
import { getGateway } from "@/lib/providers";
import { useSessionUser } from "@/components/chat/user-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ProviderMark } from "@/components/chat/provider-mark";

function ConversationItem({
  conversation,
  isActive,
  onSelect,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  const [, startTransition] = React.useTransition();

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
    });
  }

  function rename() {
    const next = window.prompt("Rename conversation", conversation.title);
    if (next) run(() => renameConversation(conversation.id, next));
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={() => onSelect(conversation.id)}
        className="h-8 pr-8"
        tooltip={conversation.title}
      >
        <ProviderMark modelId={conversation.modelId} className="size-4 text-[8px]" />
        <span className="truncate">{conversation.title}</span>
      </SidebarMenuButton>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction showOnHover aria-label="Conversation options">
              <MoreHorizontalIcon />
            </SidebarMenuAction>
          }
        />
        <DropdownMenuContent align="start" side="right" className="w-44 min-w-44">
          <DropdownMenuItem
            onClick={() => run(() => togglePinned(conversation.id))}
          >
            <PinIcon />
            {conversation.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={rename}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              run(async () => {
                await archiveConversation(conversation.id);
                if (isActive) onSelect("");
              })
            }
          >
            <ArchiveIcon />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              run(async () => {
                await deleteConversation(conversation.id);
                if (isActive) onSelect("");
              })
            }
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

export function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onOpenSettings,
  provider,
  providerStatus = "none",
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onOpenSettings: (tab?: "provider" | "prompts" | "search" | "memory") => void;
  provider: { provider: string; baseUrl: string; last4: string } | null;
  providerStatus?: ProviderStatus;
}) {
  const user = useSessionUser();
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(needle) ||
        conversation.preview.toLowerCase().includes(needle),
    );
  }, [conversations, query]);

  const pinned = filtered.filter((conversation) => conversation.pinned);
  const byBucket = HISTORY_BUCKETS.map((bucket) => ({
    bucket,
    items: filtered.filter(
      (conversation) => !conversation.pinned && conversation.bucket === bucket,
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-2 px-1 pt-1">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MessagesSquareIcon className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">OmniChat</span>
          <Badge variant="secondary" className="ml-auto h-5 text-[10px]">
            {user.plan}
          </Badge>
        </div>

        <Button onClick={onNewChat} className="w-full justify-start gap-2">
          <PlusIcon />
          New chat
        </Button>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {pinned.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>Pinned</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {pinned.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isActive={conversation.id === activeId}
                    onSelect={onSelect}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {byBucket.map((group) => (
          <SidebarGroup key={group.bucket}>
            <SidebarGroupLabel>{group.bucket}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isActive={conversation.id === activeId}
                    onSelect={onSelect}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            {query.trim()
              ? `No chats match “${query}”.`
              : "No chats yet. Start one above."}
          </div>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => onOpenSettings("provider")}
              className="gap-2 border bg-background"
            >
              <SparklesIcon
                className={
                  !provider
                    ? "text-amber-500"
                    : providerStatus === "ok"
                      ? "text-emerald-500"
                      : "text-destructive"
                }
              />
              <div className="flex min-w-0 flex-col text-left leading-tight">
                <span className="text-xs font-medium">
                  {provider
                    ? getGateway(provider.provider).name
                    : "Connect a provider"}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {!provider
                    ? "Add an API key to start chatting"
                    : providerStatus === "ok"
                      ? `Key ••••${provider.last4}`
                      : PROVIDER_STATUS_LABEL[providerStatus] ??
                        `Key ••••${provider.last4}`}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton size="lg" className="gap-2">
                    <Avatar size="sm">
                      <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                        {user.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col text-left leading-tight">
                      <span className="truncate text-xs font-medium">
                        {user.name}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {user.email}
                      </span>
                    </div>
                    <MoreHorizontalIcon className="ml-auto" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent
                align="start"
                side="top"
                className="w-56 min-w-56"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => onOpenSettings("provider")}>
                    <SettingsIcon />
                    Provider settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenSettings("search")}>
                    <GlobeIcon />
                    Web search
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenSettings("memory")}>
                    <BrainIcon />
                    Memory
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenSettings("prompts")}>
                    <WandSparklesIcon />
                    Custom system prompt
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <CreditCardIcon />
                    Billing
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <ArchiveIcon />
                    Archived chats
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => signOutAction()}
                >
                  <LogOutIcon />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
