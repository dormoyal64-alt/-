/**
 * The assistant's routes, as this screen sees them.
 *
 * The routes themselves live elsewhere; what is here is the shape of the
 * conversation with them and — more importantly — the wording of every way it
 * can fail. A person reading "402" learns nothing, so each status is turned
 * into the one sentence that says what happened and what to do about it, in
 * the language the rest of the app speaks.
 *
 * A failed request is a normal thing here: the key may not be set, the month's
 * ceiling may be reached, and during a deploy the route may not answer at all.
 * None of those may take the screen down with them, so everything throws a
 * single kind of error carrying the status, and the screen decides what to show.
 */

export interface AgentStatus {
  /** false when no ANTHROPIC_API_KEY is set on the server */
  configured: boolean;
  model: string;
  spent_agorot: number;
  cap_agorot: number;
}

/** A tool call waiting on a person. Nothing else may be sent until it is answered. */
export interface PendingAction {
  id: string;
  tool_name: string;
  /** already written in Hebrew by the server, for the owner to read */
  summary: string;
}

/** What a turn comes back as, whether it started as a message or as an answer. */
export interface AgentTurn {
  ok: true;
  conversationId: string;
  reply: string;
  pending: PendingAction | null;
  spent_agorot: number;
  cap_agorot: number;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  /** 'open' | 'needs_owner' | 'closed' */
  status: string;
  updated_at: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  created_at: string;
}

export interface AgentActionRecord {
  id: string;
  tool_name: string;
  summary: string | null;
  /** 'pending' | 'approved' | 'rejected' | 'done' | 'failed' */
  status: string;
  error: string | null;
}

export interface ConversationDetail {
  conversation: ConversationSummary | null;
  messages: AgentMessage[];
  actions: AgentActionRecord[];
}

/** A failure with the HTTP status kept, so the screen can treat the cap differently from a crash. */
export class AgentError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentError";
    this.status = status;
  }
}

export function agentError(e: unknown, fallback = "משהו נכשל בדרך לעוזר"): AgentError {
  if (e instanceof AgentError) return e;
  return new AgentError(fallback, 0);
}

/**
 * What to tell the person, per status.
 *
 * 0 is our own name for "the request never left" — no network, or the route
 * answered with something that is not JSON, which is what a half-deployed
 * server looks like from here.
 */
function wording(status: number, serverError?: string | null): string {
  switch (status) {
    case 0:
      return "אין חיבור לשרת — הבקשה לא נשלחה. כדאי לנסות שוב בעוד רגע.";
    case 401:
      return "החיבור למערכת פג. יש להתחבר מחדש ולנסות שוב.";
    case 402:
      return "העוזר הגיע לתקרת ההוצאה של החודש, ולכן הוא מפסיק לענות עד תחילת החודש הבא.";
    case 404:
      return "העוזר עוד לא מותקן בשרת הזה, ולכן אין למי לשלוח את השאלה.";
    case 503:
      return "העוזר לא מחובר: חסר מפתח ANTHROPIC_API_KEY בשרת.";
    default:
      return serverError?.trim() || "הבקשה לעוזר נכשלה. כדאי לנסות שוב.";
  }
}

interface ErrorBody {
  ok?: boolean;
  error?: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new AgentError(wording(0), 0);
  }

  // a 404 from Next is an HTML page, and a proxy error is plain text; neither
  // parses, and neither should look like a crash to the person
  const body = (await response.json().catch(() => null)) as (ErrorBody & T) | null;

  if (!response.ok || !body || body.ok === false) {
    const status = response.ok ? 0 : response.status;
    throw new AgentError(wording(status, body?.error), status);
  }
  return body as T;
}

export function fetchAgentStatus(): Promise<AgentStatus> {
  return request<AgentStatus>("/api/agent/chat", { cache: "no-store" });
}

export async function fetchConversations(limit = 20): Promise<ConversationSummary[]> {
  const data = await request<{ conversations?: ConversationSummary[] }>(
    `/api/agent/conversations?limit=${limit}`,
    { cache: "no-store" }
  );
  return data.conversations ?? [];
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  const data = await request<Partial<ConversationDetail>>(
    `/api/agent/conversations/${encodeURIComponent(id)}`,
    { cache: "no-store" }
  );
  return {
    conversation: data.conversation ?? null,
    messages: data.messages ?? [],
    actions: data.actions ?? [],
  };
}

export function sendAgentMessage(conversationId: string | null, message: string): Promise<AgentTurn> {
  return request<AgentTurn>("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(conversationId ? { conversationId, message } : { message }),
  });
}

export function decideAgentAction(actionId: string, approve: boolean): Promise<AgentTurn> {
  return request<AgentTurn>("/api/agent/act", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionId, approve }),
  });
}
