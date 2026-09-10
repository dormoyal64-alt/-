"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  City,
  Contractor,
  ContractorWithRelations,
  JobStatus,
  JobType,
  LeadSource,
  PaymentMethod,
  Profession,
} from "@/lib/types";

interface RefData {
  professions: Profession[];
  jobTypes: JobType[];
  cities: City[];
  paymentMethods: PaymentMethod[];
  leadSources: LeadSource[];
  jobStatuses: JobStatus[];
  contractors: ContractorWithRelations[];
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
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [p, jt, c, pm, ls, js, con] = await Promise.all([
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
    ]);
    setProfessions(p.data ?? []);
    setJobTypes(jt.data ?? []);
    setCities(c.data ?? []);
    setPaymentMethods(pm.data ?? []);
    setLeadSources(ls.data ?? []);
    setJobStatuses(js.data ?? []);
    setContractors((con.data as ContractorWithRelations[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <RefDataContext.Provider
      value={{ professions, jobTypes, cities, paymentMethods, leadSources, jobStatuses, contractors, loading, refresh }}
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
