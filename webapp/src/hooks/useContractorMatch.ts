"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import type { ContractorStatsRow } from "@/lib/types";

export interface MatchedContractor {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  active: boolean;
  commissionPct: number;
  closeRate: number;
  jobsSent: number;
  jobsClosedSuccess: number;
  openJobsCount: number;
}

export function useContractorMatch(professionId: string | null, jobTypeId: string | null, cityId: string | null) {
  const { contractors } = useRefData();
  const supabase = useMemo(() => createClient(), []);
  const [stats, setStats] = useState<Record<string, ContractorStatsRow>>({});
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase.rpc("contractor_stats", { p_from: "2000-01-01", p_to: new Date().toISOString() }).then(({ data }) => {
      const map: Record<string, ContractorStatsRow> = {};
      (data as ContractorStatsRow[] | null)?.forEach((row) => (map[row.contractor_id] = row));
      setStats(map);
    });
    supabase
      .from("jobs")
      .select("contractor_id")
      .eq("is_closed", false)
      .not("contractor_id", "is", null)
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        (data as { contractor_id: string }[] | null)?.forEach((row) => {
          counts[row.contractor_id] = (counts[row.contractor_id] ?? 0) + 1;
        });
        setOpenCounts(counts);
      });
  }, [supabase]);

  const matches: MatchedContractor[] = useMemo(() => {
    if (!professionId || !jobTypeId || !cityId) return [];
    return contractors
      .filter(
        (c) =>
          c.contractor_professions.some((p) => p.profession_id === professionId) &&
          c.contractor_job_types.some((jt) => jt.job_type_id === jobTypeId) &&
          c.contractor_cities.some((ci) => ci.city_id === cityId)
      )
      .map((c) => {
        const override = c.contractor_job_types.find((jt) => jt.job_type_id === jobTypeId)?.commission_pct;
        const s = stats[c.id];
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          whatsapp: c.whatsapp,
          active: c.active,
          commissionPct: override ?? c.default_commission_pct,
          closeRate: s?.close_rate ?? 0,
          jobsSent: s?.jobs_sent ?? 0,
          jobsClosedSuccess: s?.jobs_closed_success ?? 0,
          openJobsCount: openCounts[c.id] ?? 0,
        };
      })
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (b.closeRate !== a.closeRate) return b.closeRate - a.closeRate;
        return a.openJobsCount - b.openJobsCount;
      });
  }, [contractors, professionId, jobTypeId, cityId, stats, openCounts]);

  return matches;
}
