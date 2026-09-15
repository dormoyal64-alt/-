"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type {
  AppSettings,
  City,
  Contractor,
  ContractorWithRelations,
  Helper,
  ReferralCompany,
  JobStatus,
  JobType,
  LeadSource,
  PaymentMethod,
  Profession,
  Profile,
} from "@/lib/types";

interface RefData {
  professions: Profession[];
  jobTypes: JobType[];
  cities: City[];
  paymentMethods: PaymentMethod[];
  leadSources: LeadSource[];
  jobStatuses: JobStatus[];
  contractors: ContractorWithRelations[];
  helpers: Helper[];
  referralCompanies: ReferralCompany[];
  settings: AppSettings | null;
  /** the signed-in user's own profile; null until it loads */
  profile: Profile | null;
  /** false for office staff — decides what the menu offers, while the database
   *  decides what can actually be read */
  isOwner: boolean;
  loading: boolean;
  /** pass quiet when reloading in the background, so no spinner appears */
  refresh: (quiet?: boolean) => Promise<void>;
}

const RefDataContext = createContext<RefData | null>(null);

export function RefDataProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [jobStatuses, setJobStatuses] = useState<JobStatus[]>([]);
  const [contractors, setContractors] = useState<ContractorWithRelations[]>([]);
  const [helpers, setHelpers] = useState<Helper[]>([]);
  const [referralCompanies, setReferralCompanies] = useState<ReferralCompany[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [p, jt, c, pm, ls, js, con, hp, rc, st] = await Promise.all([
      supabase.from("professions").select("*").order("sort_order"),
      supabase.from("job_types").select("*").order("sort_order"),
      supabase.from("cities").select("*").order("name"),
      supabase.from("payment_methods").select("*").order("sort_order"),
      supabase.from("lead_sources").select("*").order("sort_order"),
      supabase.from("job_statuses").select("*").order("sort_order"),
      supabase
        .from("contractors")
        .select(
          "*, contractor_professions(profession_id), contractor_cities(city_id), contractor_job_types(job_type_id, commission_pct), contractor_hours(weekday, starts_at, ends_at)"
        )
        .order("name"),
      supabase.from("helpers").select("*").order("name"),
      supabase.from("referral_companies").select("*").order("name"),
      supabase.from("app_settings").select("*").eq("id", true).maybeSingle(),
    ]);

    // the caller's own profile, for what the menu should offer
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      const { data: me } = await supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
      setProfile((me as Profile) ?? null);
    } else {
      setProfile(null);
    }

    setProfessions(p.data ?? []);
    setJobTypes(jt.data ?? []);
    setCities(c.data ?? []);
    setPaymentMethods(pm.data ?? []);
    setLeadSources(ls.data ?? []);
    setJobStatuses(js.data ?? []);
    setContractors((con.data as ContractorWithRelations[]) ?? []);
    setHelpers((hp.data as Helper[]) ?? []);
    setReferralCompanies((rc.data as ReferralCompany[]) ?? []);
    setSettings((st.data as AppSettings) ?? null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A contractor someone else added should turn up in the job form without
  // anyone having to reload the page. Quiet, so no spinner blinks over a form
  // that is halfway filled in.
  useAutoRefresh(() => refresh(true), { intervalMs: 60_000 });

  return (
    <RefDataContext.Provider
      value={{
        professions, jobTypes, cities, paymentMethods, leadSources, jobStatuses,
        contractors, helpers, referralCompanies, settings,
        profile,
        // Only 'clerk' means office staff. Anything else — 'owner', the older
        // 'admin', or a value from a database that has not been migrated yet —
        // is the owner. Testing for 'owner' instead locked the real owner out
        // of their own reports on any database where the update had not been
        // run, because the menu shipped ahead of the migration. Failing this
        // way round is safe: the menu is presentation, and the database refuses
        // a clerk the figures regardless of what it shows.
        isOwner: profile ? profile.role !== "clerk" : false,
        loading,
        refresh,
      }}
    >
      {children}
    </RefDataContext.Provider>
  );
}

export function useRefData() {
  const ctx = useContext(RefDataContext);
  if (!ctx) throw new Error("useRefData must be used within RefDataProvider");
  return ctx;
}
