"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, RefreshCw, Send, Sparkles, WifiOff } from "lucide-react";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Misc";
import { formatAgorot } from "@/lib/money";
import { ApprovalCard } from "@/components/assistant/ApprovalCard";
import { ChatTranscript, type ChatLine } from "@/components/assistant/ChatTranscript";
import { ConversationsCard } from "@/components/assistant/ConversationsCard";
import {
  agentError,
  decideAgentAction,
  fetchAgentStatus,
  fetchConversation,
  fetchConversations,
  sendAgentMessage,
  type AgentStatus,
  type ConversationSummary,
  type PendingAction,
} from "@/components/assistant/api";

/**
 * Telling the business what to do, in words.
 *
 * Every other screen is a form: it knows in advance which thing you came to
 * change. This one does not, which is the point — the owner is in a van between
 * jobs and can say "תסגור את 1042 ב-900 במזומן" faster than they can find the
 * job, open it and fill in the closing.
 *
 * Two rules shape the layout. The first is that nothing touching money happens
 * without the owner: when a turn comes back with a pending action the transcript
 * is interrupted by an approval card and the composer goes dead, so the only
 * thing left to do on the screen is answer it. Nothing may be queued behind a
 * decision that has not been made.
 *
 * The second is that this screen costs money to use, unlike every other one. So
 * the month's spend against its ceiling is on the page — quietly, in the corner,
 * but never hidden — and when the ceiling is reached the screen says so in
 * words rather than failing silently on send.
 *
 * The routes it talks to may be missing entirely (before a deploy, or with no
 * key set). That is treated as a state of the screen, not as an error: it
 * explains what is missing and offers to look again, and never shows an input
 * that cannot send.
 */

let lineCounter = 0;
function lineId(): string {
  lineCounter += 1;
  return `l${lineCounter}`;
}

export default function AssistantPage() {
  const { settings } = useRefData();
  const toast = useToast();

  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  /** set by a 402, so the screen stops offering to spend money it does not have */
  const [capReached, setCapReached] = useState(false);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const next = await fetchAgentStatus();
      setStatus(next);
      setStatusError(null);
      setCapReached(next.cap_agorot > 0 && next.spent_agorot >= next.cap_agorot);
    } catch (e) {
      setStatus(null);
      setStatusError(agentError(e).message);
    } finally {
      setChecking(false);
    }
  }, []);

  // the list is a convenience; a route that is not there yet must not shout
  const loadConversations = useCallback(async (quiet = false) => {
    if (!quiet) setConversationsLoading(true);
    try {
      setConversations(await fetchConversations(20));
    } catch {
      setConversations([]);
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    loadConversations();
  }, [checkStatus, loadConversations]);

  // the newest line is the one being waited for, so it is the one in view
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, thinking, pending]);

  const configured = status?.configured === true;
  const canSend = configured && !capReached && !thinking && !pending && deciding === null;

  function applyTurnSpend(spent: number, cap: number) {
    setStatus((prev) => (prev ? { ...prev, spent_agorot: spent, cap_agorot: cap } : prev));
    if (cap > 0 && spent >= cap) setCapReached(true);
  }

  async function send() {
    const text = draft.trim();
    if (!text || !canSend) return;

    const mine: ChatLine = { id: lineId(), role: "user", text };
    setDraft("");
    setLines((prev) => [...prev, mine]);
    setThinking(true);
    try {
      const turn = await sendAgentMessage(conversationId, text);
      setConversationId(turn.conversationId);
      if (turn.reply.trim()) {
        setLines((prev) => [...prev, { id: lineId(), role: "assistant", text: turn.reply }]);
      }
      setPending(turn.pending);
      applyTurnSpend(turn.spent_agorot, turn.cap_agorot);
      loadConversations(true);
    } catch (e) {
      const err = agentError(e);
      if (err.status === 402) setCapReached(true);
      if (err.status === 503) setStatus((prev) => (prev ? { ...prev, configured: false } : prev));
      // a question that was never asked does not belong in the transcript, and
      // the words the owner typed are theirs — they go back in the box to retry
      setLines((prev) => prev.filter((l) => l.id !== mine.id));
      setDraft(text);
      toast.error(err.message);
    } finally {
      setThinking(false);
    }
  }

  async function decide(approve: boolean) {
    const action = pending;
    if (!action || deciding !== null) return;
    setDeciding(approve ? "approve" : "reject");
    try {
      const turn = await decideAgentAction(action.id, approve);
      setConversationId(turn.conversationId);
      // what was decided is written into the conversation, so a screen reopened
      // tomorrow still shows who allowed what
      setLines((prev) => [
        ...prev,
        {
          id: lineId(),
          role: "note",
          text: approve ? `אישרתם: ${action.summary}` : `ביטלתם: ${action.summary}`,
        },
        ...(turn.reply.trim() ? [{ id: lineId(), role: "assistant" as const, text: turn.reply }] : []),
      ]);
      // a follow-up may ask for one more approval; if not, the composer opens up
      setPending(turn.pending);
      applyTurnSpend(turn.spent_agorot, turn.cap_agorot);
      loadConversations(true);
    } catch (e) {
      const err = agentError(e);
      if (err.status === 402) setCapReached(true);
      // the action stays pending: it was never answered, and nothing else may
      // be sent until it is
      toast.error(err.message);
    } finally {
      setDeciding(null);
    }
  }

  function startNew() {
    setConversationId(null);
    setLines([]);
    setPending(null);
    setDraft("");
    inputRef.current?.focus();
  }

  async function openConversation(id: string) {
    if (openingId !== null) return;
    setOpeningId(id);
    try {
      const detail = await fetchConversation(id);
      setConversationId(id);
      setLines([
        ...detail.messages.map((m) => ({ id: m.id, role: m.role, text: m.text ?? "" })),
        // a tool that failed is part of the story of this conversation, and the
        // reason is the only thing that explains the reply above it
        ...detail.actions
          .filter((a) => a.status === "failed")
          .map((a) => ({
            id: `a${a.id}`,
            role: "note" as const,
            text: `הפעולה "${a.summary?.trim() || a.tool_name}" נכשלה${a.error ? `: ${a.error}` : ""}`,
          })),
      ]);
      const waiting = detail.actions.find((a) => a.status === "pending");
      setPending(
        waiting
          ? { id: waiting.id, tool_name: waiting.tool_name, summary: waiting.summary?.trim() || waiting.tool_name }
          : null
      );
    } catch (e) {
      toast.error(agentError(e, "לא הצלחנו לפתוח את השיחה").message);
    } finally {
      setOpeningId(null);
    }
  }

  const spendLine = status ? `${formatAgorot(status.spent_agorot)} מתוך ${formatAgorot(status.cap_agorot)} החודש` : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-ink-900">
          <Sparkles className="h-6 w-6 text-brand-600" /> עוזר
        </h1>
        <p className="break-words text-sm text-ink-500">
          אפשר לכתוב לו מה צריך, כמו להודעה — הוא עובד במערכת במקומכם, וכל פעולה שמשנה כסף עוברת קודם
          דרך האישור שלכם.
        </p>
        {spendLine && (
          <p className="mt-1 text-xs font-semibold text-ink-400">
            {spendLine}
            {status?.model ? (
              <span className="break-all font-medium text-ink-300" dir="ltr">
                {" "}
                · {status.model}
              </span>
            ) : null}
          </p>
        )}
      </div>

      {checking ? (
        <PageSpinner />
      ) : statusError ? (
        <Card className="border-ink-200">
          <CardBody className="space-y-3">
            <p className="flex items-center gap-2 text-base font-extrabold text-ink-900">
              <WifiOff className="h-5 w-5 text-ink-400" /> העוזר לא זמין כרגע
            </p>
            <p className="break-words text-sm text-ink-500">{statusError}</p>
            <p className="text-sm text-ink-500">
              שאר המערכת עובדת כרגיל — העוזר הוא תוספת, ואפשר להמשיך לעבוד במסכי העבודות והקבלנים בזמן
              שהוא לא עונה.
            </p>
            <Button variant="secondary" onClick={checkStatus}>
              <RefreshCw className="h-4 w-4" /> בדיקה שוב
            </Button>
          </CardBody>
        </Card>
      ) : !configured ? (
        <Card className="border-warning-100 bg-warning-50">
          <CardBody className="space-y-3">
            <p className="flex items-center gap-2 text-base font-extrabold text-warning-600">
              <KeyRound className="h-5 w-5" /> העוזר עוד לא הופעל
            </p>
            <p className="break-words text-sm font-semibold text-ink-700">
              כדי שהעוזר יוכל לענות צריך מפתח של Anthropic. בעל העסק צריך להוסיף אותו פעם אחת
              ב-Vercel: בהגדרות הפרויקט, במשתני הסביבה (Environment Variables), בשם{" "}
              <span dir="ltr" className="break-all font-bold">
                ANTHROPIC_API_KEY
              </span>{" "}
              — ואחרי זה לעשות Redeploy לפרויקט.
            </p>
            <p className="text-sm text-ink-500">
              עד שהמפתח יתווסף אין למי לשלוח הודעות, ולכן תיבת הכתיבה לא מוצגת. שאר המערכת עובדת כרגיל.
            </p>
            <Button variant="secondary" onClick={checkStatus}>
              <RefreshCw className="h-4 w-4" /> בדיקה שוב
            </Button>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="space-y-3 p-3 sm:p-4">
            <div
              ref={scroller}
              className="max-h-[52vh] min-h-[220px] overflow-y-auto overflow-x-hidden rounded-xl bg-ink-50/70 p-3"
            >
              <ChatTranscript
                lines={lines}
                thinking={thinking}
                emptyHint={`למשל: מה יש לי מחר? · תסגור את עבודה 1042 ב-900 ₪ במזומן · כמה ${
                  settings?.business_name?.trim() || "העסק"
                } הוציא על פרסום החודש?`}
              />
            </div>

            {pending && <ApprovalCard action={pending} deciding={deciding} onDecide={decide} />}

            {capReached && (
              <p className="break-words rounded-xl bg-danger-50 px-3.5 py-2.5 text-sm font-semibold text-danger-600">
                העוזר הגיע לתקרת ההוצאה שלו לחודש הזה
                {status ? ` (${formatAgorot(status.cap_agorot)})` : ""} ולכן הוא מפסיק לענות. התקרה
                מתאפסת בתחילת החודש הבא, וכל שאר המערכת ממשיכה לעבוד כרגיל. מי שרוצה להמשיך עוד החודש
                צריך להעלות את התקרה בהגדרות השרת.
                {/* TODO: אין בחוזה של ה-API דרך להעלות את התקרה מהמסך — אם ייווסף endpoint לעדכון
                    התקרה, להוסיף כאן כפתור במקום ההסבר. */}
              </p>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-center gap-2"
            >
              <Input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!canSend}
                enterKeyHint="send"
                placeholder={
                  pending
                    ? "יש פעולה שמחכה לאישור שלכם"
                    : capReached
                      ? "התקרה החודשית נגמרה"
                      : "מה צריך לעשות?"
                }
                aria-label="הודעה לעוזר"
                className="min-w-0 flex-1"
              />
              <Button type="submit" loading={thinking} disabled={!canSend || !draft.trim()} className="shrink-0">
                <Send className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">שליחה</span>
              </Button>
            </form>
            {pending && (
              <p className="text-xs font-semibold text-warning-600">
                אי אפשר לשלוח הודעה נוספת עד שתאשרו או תבטלו את הפעולה שלמעלה.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      <ConversationsCard
        conversations={conversations}
        activeId={conversationId}
        openingId={openingId}
        loading={conversationsLoading}
        onOpen={openConversation}
        onNew={startNew}
      />
    </div>
  );
}
