"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import type { City, ContractorStatsRow, ContractorWithRelations } from "@/lib/types";

/**
 * How well a contractor fits the job being opened. A perfect fit is rare —
 * most people never tick every job type for every contractor — so instead of
 * hiding everyone who isn't an exact match, rank them and show the lot.
 */
export type MatchTier = "exact" | "city" | "region" | "profession";

export const MATCH_TIER_LABEL: Record<MatchTier, string> = {
  exact: "התאמה מלאה",
  city: "עובד בעיר הזו",
  region: "עובד באזור",
  profession: "מהתחום",
};

export const MATCH_TIER_HINT: Record<MatchTier, string> = {
  exact: "רשום לתחום, לסוג העבודה ולעיר",
  city: "רשום לתחום ולעיר, לא לסוג העבודה הזה",
  region: "רשום לתחום ולעיר אחרת באותו אזור",
  profession: "רשום לתחום, אבל לא לאזור הזה",
};

const TIER_RANK: Record<MatchTier, number> = { exact: 3, city: 2, region: 1, profession: 0 };

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
  tier: MatchTier;
  /** the cities this contractor covers in the job's region, for the "why" line */
  nearbyCities: string[];
}

export function useContractorMatch(professionId: string | null, jobTypeId: string | null, cityId: string | null) {
  const { contractors, cities } = useRefData();
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

  const matches = useMemo(
    () => rankMatches({ contractors, cities, professionId, jobTypeId, cityId, stats, openCounts }),
    [contractors, cities, professionId, jobTypeId, cityId, stats, openCounts]
  );

  return matches;
}


export function rankMatches({
  contractors,
  cities,
  professionId,
  jobTypeId,
  cityId,
  stats,
  openCounts,
}: {
  contractors: ContractorWithRelations[];
  cities: Pick<City, "id" | "name" | "region">[];
  professionId: string | null;
  jobTypeId: string | null;
  cityId: string | null;
  stats: Record<string, Pick<ContractorStatsRow, "close_rate" | "jobs_sent" | "jobs_closed_success">>;
  openCounts: Record<string, number>;
}): MatchedContractor[] {
  // The profession is the one hard filter: a plumber is no help on an electrical
  // job. Everything narrower than that only affects the ordering, so the whole
  // trade stays on screen and the choice stays with the user.
  if (!professionId || !cityId) return [];

  const cityById = new Map(cities.map((c) => [c.id, c]));
  const region = cityById.get(cityId)?.region ?? null;
  const regionCityIds = region
    ? new Set(cities.filter((c) => c.region === region).map((c) => c.id))
    : new Set<string>();

  return contractors
    .filter((c) => c.contractor_professions.some((p) => p.profession_id === professionId))
    .map((c) => {
      const coveredCityIds = c.contractor_cities.map((ci) => ci.city_id);
      const coversCity = coveredCityIds.includes(cityId);
      const coversJobType = !!jobTypeId && c.contractor_job_types.some((jt) => jt.job_type_id === jobTypeId);
      const nearbyIds = coveredCityIds.filter((id) => id !== cityId && regionCityIds.has(id));

      const tier: MatchTier = coversCity
        ? coversJobType
          ? "exact"
          : "city"
        : nearbyIds.length > 0
          ? "region"
          : "profession";

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
        tier,
        nearbyCities: nearbyIds
          .map((id) => cityById.get(id)?.name)
          .filter((n): n is string => !!n)
          .slice(0, 3),
      };
    })
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[b.tier] - TIER_RANK[a.tier];
      if (b.closeRate !== a.closeRate) return b.closeRate - a.closeRate;
      return a.openJobsCount - b.openJobsCount;
    });
}
