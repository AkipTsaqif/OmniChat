"use client";

import * as React from "react";
import {
  CheckIcon,
  CopyIcon,
  GlobeIcon,
  Loader2Icon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";

import {
  createOrUpdateShareLink,
  deleteShareLink,
  getConversationShareInfo,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function ShareDialog({
  open,
  onOpenChange,
  conversationId,
  conversationTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
  conversationTitle: string;
}) {
  const [shareId, setShareId] = React.useState<string | null>(null);
  const [loadedConvId, setLoadedConvId] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loading =
    open && !!conversationId && loadedConvId !== conversationId;

  React.useEffect(() => {
    if (!open || !conversationId) return;

    let active = true;
    getConversationShareInfo(conversationId)
      .then((info) => {
        if (active) {
          setShareId(info?.shareId ?? null);
          setLoadedConvId(conversationId);
        }
      })
      .catch(() => {
        if (active) {
          setLoadedConvId(conversationId);
        }
      });

    return () => {
      active = false;
    };
  }, [open, conversationId]);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = shareId ? `${origin}/share/${shareId}` : "";

  async function handleCreateOrUpdate() {
    if (!conversationId) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await createOrUpdateShareLink(conversationId);
      setShareId(res.shareId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create share link.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    if (!conversationId) return;
    setActionLoading(true);
    setError(null);
    try {
      await deleteShareLink(conversationId);
      setShareId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete share link.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  function handleCopy() {
    if (!shareUrl) return;
    void navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GlobeIcon className="size-4" />
            </div>
            <DialogTitle>Share chat</DialogTitle>
          </div>
          <DialogDescription className="pt-1.5">
            Anyone with this link will be able to view a public snapshot of{" "}
            <strong className="text-foreground">“{conversationTitle}”</strong>.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : shareId ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={shareUrl}
                className="font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <Button
                size="sm"
                onClick={handleCopy}
                className="gap-1.5 shrink-0"
              >
                {copied ? (
                  <>
                    <CheckIcon className="size-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>

            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                onClick={handleCreateOrUpdate}
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {actionLoading ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCwIcon className="size-3.5" />
                )}
                Update snapshot
              </Button>

              <Button
                variant="ghost"
                size="sm"
                disabled={actionLoading}
                onClick={handleDelete}
                className="gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2Icon className="size-3.5" />
                Remove link
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-3">
            <p className="text-xs text-muted-foreground">
              Future messages you send in this chat will not be visible in this
              public snapshot unless you update it.
            </p>

            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}

            <DialogFooter className="sm:justify-end">
              <Button
                onClick={handleCreateOrUpdate}
                disabled={actionLoading}
                className="gap-2 w-full sm:w-auto"
              >
                {actionLoading ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <GlobeIcon className="size-4" />
                )}
                Create public link
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
