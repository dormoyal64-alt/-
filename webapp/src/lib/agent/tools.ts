import type { SupabaseClient } from "@supabase/supabase-js";
import { JOB_SELECT, closeJob, createJob } from "@/lib/api/jobs";
import { formatAgorotPlain } from "@/lib/money";
import { formatDateHe } from "@/lib/dates";

/**
 * The doors the assistant is allowed through.
 *
 * Every one of these is something this business can already do from a screen,
 * and every one runs on the caller's own Supabase session — so row level
 * security decides what the assistant may touch exactly as it decides what the
 * owner may see. The assistant is given no key of its own and no way around
 * the rules the rest of the system keeps.
 *
 * They are split by one question: does this change anything?
 *
 * A reader runs the moment it is asked. A writer does not run at all — it is
 * recorded, described to the owner in their own language, and waits. That
 * split is the whole safety model, and it lives here rather than in the prompt
 * because a prompt is a request and this is a rule: a model that decided to
 * close every open job could not, because closing is not something it is able
 * to do by itself.
 */

export type ToolKind = "read" | "write";

export interface AgentTool {
  name: string;
  kind: ToolKind;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  run(supabase: SupabaseClient, input: Record<string, unknown>): Promise<unknown>;
}

const str = (d: string) => ({ type: "string", description: d });
const num = (d: string) => ({ type: "number", description: d });

/** A job as the assistant should see it: named things, not raw ids and agorot. */
function jobForModel(j: Record<string, any>) {
  return {
    id: j.id,
    job_number: j.job_number,
    customer_name: j.customer_name,
    customer_phone: j.customer_phone,
    address: j.address_full,
    city: j.city?.name ?? null,
    profession: j.profession?.name ?? null,
    job_type: j.job_type?.name ?? null,
    contractor: j.contractor?.name ?? null,
    performed_by: j.performed_by,
    status: j.status?.name ?? null,
    is_closed: j.is_closed,
    opened_at: j.opened_at,
    scheduled_at: j.scheduled_at,
    closed_at: j.closed_at,
    quoted_price: j.quoted_price_agorot ? formatAgorotPlain(j.quoted_price_agorot) : null,
    final_price: j.final_price_agorot ? formatAgorotPlain(j.final_price_agorot) : null,
  };
}

export const AGENT_TOOLS: AgentTool[] = [
  // -------------------------------------------------------------------------
  // Readers — these run at once
  // -------------------------------------------------------------------------
  {
    name: "find_jobs",
    kind: "read",
    description:
      "Search the business's jobs by customer name, phone, job number, or status. " +
      "Use this before acting on any job — never guess a job id. Returns at most 20.",
    input_schema: {
      type: "object",
      properties: {
        query: str("Customer name, phone or job number. Leave empty to list recent jobs."),
        only_open: { type: "boolean", description: "true to return only jobs that are not yet closed" },
      },
      additionalProperties: false,
    },
    async run(supabase, input) {
      const q = String(input.query ?? "").trim();
      let sel = supabase.from("jobs").select(JOB_SELECT).order("opened_at", { ascending: false }).limit(20);
      if (input.only_open) sel = sel.eq("is_closed", false);
      if (q) {
        // one string, several columns: the owner types whatever he remembers
        const like = `%${q.replace(/[%,()]/g, "")}%`;
        sel = sel.or(`customer_name.ilike.${like},customer_phone.ilike.${like},job_number.ilike.${like}`);
      }
      const { data, error } = await sel;
      if (error) throw new Error(error.message);
      return { jobs: ((data as unknown as Record<string, any>[]) ?? []).map(jobForModel) };
    },
  },
  {
    name: "get_job",
    kind: "read",
    description: "Read one job in full by its id, including money already recorded on it.",
    input_schema: {
      type: "object",
      properties: { job_id: str("The job's id, as returned by find_jobs") },
      required: ["job_id"],
      additionalProperties: false,
    },
    async run(supabase, input) {
      const { data, error } = await supabase
        .from("jobs")
        .select(JOB_SELECT)
        .eq("id", String(input.job_id))
        .single();
      if (error) throw new Error(error.message);
      const j = data as unknown as Record<string, any>;
      return {
        ...jobForModel(j),
        contractor_share: j.contractor_share_agorot ? formatAgorotPlain(j.contractor_share_agorot) : null,
        business_share: j.business_share_agorot ? formatAgorotPlain(j.business_share_agorot) : null,
        helper_pay: j.helper_pay_agorot ? formatAgorotPlain(j.helper_pay_agorot) : null,
        closing_notes: j.closing_notes,
      };
    },
  },
  {
    name: "list_reference_data",
    kind: "read",
    description:
      "List the business's own settings needed to open a job: professions, job types, cities, " +
      "contractors, payment methods and job statuses. Call this before open_job.",
    input_schema: {
      type: "object",
      properties: {
        what: {
          type: "string",
          enum: ["professions", "job_types", "cities", "contractors", "payment_methods", "statuses"],
          description: "Which list to read",
        },
        query: str("Optional filter on the name"),
      },
      required: ["what"],
      additionalProperties: false,
    },
    async run(supabase, input) {
      const table = {
        professions: "professions",
        job_types: "job_types",
        cities: "cities",
        contractors: "contractors",
        payment_methods: "payment_methods",
        statuses: "job_statuses",
      }[String(input.what)] as string;
      let sel = supabase.from(table).select("*").limit(60);
      const q = String(input.query ?? "").trim();
      if (q) sel = sel.ilike("name", `%${q.replace(/[%,()]/g, "")}%`);
      const { data, error } = await sel;
      if (error) throw new Error(error.message);
      return {
        items: ((data as Record<string, any>[]) ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          ...(r.profession_id ? { profession_id: r.profession_id } : {}),
        })),
      };
    },
  },
  {
    name: "money_summary",
    kind: "read",
    description:
      "How the business did over a period: revenue, what went out, and what is left. " +
      "Use for questions like 'how much did I make this month'.",
    input_schema: {
      type: "object",
      properties: {
        from: str("First day, as YYYY-MM-DD"),
        to: str("Last day, as YYYY-MM-DD"),
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    async run(supabase, input) {
      const { data, error } = await supabase.rpc("money_report", {
        p_from: `${input.from}T00:00:00`,
        p_to: `${input.to}T23:59:59.999`,
      });
      if (error) throw new Error(error.message);
      const r = (Array.isArray(data) ? data[0] : data) as Record<string, number> | null;
      if (!r) return { note: "no data for that period" };
      const m = (k: string) => formatAgorotPlain(r[k] ?? 0);
      return {
        period: `${formatDateHe(String(input.from))} – ${formatDateHe(String(input.to))}`,
        jobs_closed: r.jobs_closed,
        revenue: m("revenue_agorot"),
        paid_to_contractors: m("contractor_paid_agorot"),
        helpers: m("helper_agorot"),
        business_expenses: m("business_expenses_agorot"),
        tax: m("tax_agorot"),
        net: m("net_agorot"),
      };
    },
  },

  // -------------------------------------------------------------------------
  // Writers — these are never executed by the loop. They are proposed.
  // -------------------------------------------------------------------------
  {
    name: "open_job",
    kind: "write",
    description:
      "Open a new job. Requires ids from list_reference_data — resolve the profession, job type, " +
      "city and status first. The owner approves before this happens.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: str("The customer's name"),
        customer_phone: str("The customer's phone"),
        profession_id: str("id from list_reference_data('professions')"),
        job_type_id: str("id from list_reference_data('job_types')"),
        city_id: str("id from list_reference_data('cities')"),
        status_id: str("id from list_reference_data('statuses') — the opening status"),
        address_full: str("Street, number and city as one line"),
        quoted_price: num("Price quoted on the phone, in shekels"),
        contractor_id: str("id from list_reference_data('contractors'), when a contractor will do it"),
        notes: str("Anything the owner said that does not fit a field"),
      },
      required: ["customer_name", "customer_phone", "profession_id", "job_type_id", "city_id", "status_id"],
      additionalProperties: false,
    },
    async run(supabase, input) {
      const job = await createJob(supabase, {
        customer_name: String(input.customer_name),
        customer_phone: String(input.customer_phone),
        profession_id: String(input.profession_id),
        job_type_id: String(input.job_type_id),
        city_id: String(input.city_id),
        status_id: String(input.status_id),
        address_full: input.address_full ? String(input.address_full) : null,
        quoted_price_agorot: input.quoted_price != null ? Math.round(Number(input.quoted_price) * 100) : null,
        contractor_id: input.contractor_id ? String(input.contractor_id) : null,
        performed_by: input.contractor_id ? "contractor" : "self",
        notes: input.notes ? String(input.notes) : null,
        opened_at: new Date().toISOString(),
        // the assistant never messages a contractor on its own
        notify_contractor: false,
      });
      return { opened: jobForModel(job as unknown as Record<string, any>) };
    },
  },
  {
    name: "close_job",
    kind: "write",
    description:
      "Close a job at the price it actually finished at. Find the job first and confirm it is the " +
      "right one. The owner approves before this happens.",
    input_schema: {
      type: "object",
      properties: {
        job_id: str("The job's id, from find_jobs"),
        final_price: num("What the job closed at, in shekels"),
        payment_method_id: str("id from list_reference_data('payment_methods')"),
        paid_to: {
          type: "string",
          enum: ["business", "contractor"],
          description: "Who took the customer's money",
        },
        with_receipt: { type: "boolean", description: "true if a receipt was or will be given" },
        notes: str("Closing note"),
      },
      required: ["job_id", "final_price"],
      additionalProperties: false,
    },
    async run(supabase, input) {
      await closeJob(supabase, String(input.job_id), {
        closedSuccessfully: true,
        finalPriceAgorot: Math.round(Number(input.final_price) * 100),
        finalPaymentMethodId: input.payment_method_id ? String(input.payment_method_id) : null,
        paymentReceivedBy: (input.paid_to === "contractor" ? "contractor" : "business") as "business" | "contractor",
        closingNotes: input.notes ? String(input.notes) : null,
        closedAt: new Date().toISOString(),
        withReceipt: !!input.with_receipt,
      });
      const { data } = await supabase.from("jobs").select(JOB_SELECT).eq("id", String(input.job_id)).single();
      return { closed: jobForModel((data ?? {}) as unknown as Record<string, any>) };
    },
  },
  {
    name: "add_job_expense",
    kind: "write",
    description: "Record something bought for one job — a part, parking, equipment hire. The owner approves first.",
    input_schema: {
      type: "object",
      properties: {
        job_id: str("The job's id, from find_jobs"),
        description: str("What it was, e.g. משאבה"),
        amount: num("What it cost, in shekels"),
      },
      required: ["job_id", "description", "amount"],
      additionalProperties: false,
    },
    async run(supabase, input) {
      const { error } = await supabase.from("job_expenses").insert({
        job_id: String(input.job_id),
        description: String(input.description),
        amount_agorot: Math.round(Number(input.amount) * 100),
      });
      if (error) throw new Error(error.message);
      return { added: true };
    },
  },
  {
    name: "set_job_schedule",
    kind: "write",
    description: "Set or change when a job is booked for. The owner approves first.",
    input_schema: {
      type: "object",
      properties: {
        job_id: str("The job's id, from find_jobs"),
        scheduled_at: str("When, as an ISO timestamp in Israel time"),
      },
      required: ["job_id", "scheduled_at"],
      additionalProperties: false,
    },
    async run(supabase, input) {
      const { error } = await supabase
        .from("jobs")
        .update({ scheduled_at: String(input.scheduled_at) })
        .eq("id", String(input.job_id));
      if (error) throw new Error(error.message);
      return { scheduled: true };
    },
  },
  {
    name: "escalate_to_owner",
    kind: "write",
    description:
      "Hand the conversation to the owner. Use when you are stuck, when the person is upset, when " +
      "the question is beyond you, or when it sounds urgent. Say plainly why.",
    input_schema: {
      type: "object",
      properties: {
        reason: str("Why the owner is needed, in Hebrew, one sentence"),
        urgency: { type: "string", enum: ["normal", "urgent"], description: "urgent for flooding, sewage, no water" },
      },
      required: ["reason"],
      additionalProperties: false,
    },
    async run() {
      // The handover is the record itself: the action row is written before this
      // runs, and the screens read it. Nothing else has to happen here.
      return { escalated: true };
    },
  },
];

export const TOOLS_BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

/** The tool list as the API wants it — stable order, so the prompt cache holds. */
export function toolSchemas() {
  return AGENT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}
