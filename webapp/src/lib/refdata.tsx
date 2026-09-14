"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  refresh: () => Promise<void>;
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

  const refresh = useCallback(async () => {
    setLoading(true);
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
          "*, contractor_professions(profession_id), contractor_cities(city_id), contractor_job_types(job_type_id, commission_pct)"
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

  return (
    <RefDataContext.Provider
      value={{
        professions, jobTypes, cities, paymentMethods, leadSources, jobStatuses,
        contractors, helpers, referralCompanies, settings,
        profile,
        isOwner: profile?.role === "owner",
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
