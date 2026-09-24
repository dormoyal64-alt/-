"use client";

import { MessageSquare, Plus } from "lucide-react";
import clsx from "clsx";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Misc";
import { formatDateTimeHe } from "@/lib/dates";
import type { ConversationSummary } from "./api";

/** What each stored status is called on screen. */
const statusLabel: Record<string, string> = {
  open: "פתוחה",
  needs_owner: "מחכה לך",
  closed: "נסגרה",
};

/**
 * The conversations that came before.
 *
 * Short, and deliberately so: this is a way back into something left half
 * finished, not an archive to browse. A conversation the assistant got stuck in
 * is marked, because that one is waiting on a person and the others are not.
 */
export function ConversationsCard({
  conversations,
  activeId,
  openingId,
  loading,
  onOpen,
  onNew,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  /** the row whose conversation is being fetched */
  openingId: string | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-ink-400" /> שיחות אחרונות
        </CardTitle>
        <Button variant="secondary" size="sm" onClick={onNew}>
          <Plus className="h-4 w-4" /> שיחה חדשה
        </Button>
      </CardHeader>
      <CardBody className="p-0">
        {loading ? (
          <p className="px-5 py-4 text-sm text-ink-400">טוען...</p>
        ) : conversations.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-400">עדיין לא דיברתם עם העוזר.</p>
        ) : (
          <div className="divide-y divide-ink-50">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpen(c.id)}
                disabled={openingId !== null}
                className={clsx(
                  "flex w-full items-center gap-2 px-4 py-3 text-start disabled:opacity-60",
                  c.id === activeId ? "bg-brand-50" : "hover:bg-ink-50"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink-800">{c.title?.trim() || "שיחה בלי כותרת"}</p>
                  <p className="truncate text-xs text-ink-400">{formatDateTimeHe(c.updated_at)}</p>
                </div>
                {c.status === "needs_owner" && (
                  <span className="shrink-0 rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-bold text-warning-600">
                    {statusLabel.needs_owner}
                  </span>
                )}
                {c.status === "closed" && (
                  <span className="shrink-0 text-[11px] font-semibold text-ink-400">{statusLabel.closed}</span>
                )}
                {openingId === c.id && <Spinner className="h-4 w-4 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
