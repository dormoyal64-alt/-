"use client";

import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { useRefData } from "@/lib/refdata";
import { ownerOnlyPaths } from "./nav";
import { PageSpinner } from "@/components/ui/Misc";

/**
 * Stops office staff landing on a money page by typing its address.
 *
 * This is politeness, not protection: the database refuses them the figures
 * either way, and without this they would simply see a page of zeros and
 * wonder what was broken. The real boundary is the RLS policies.
 */
export function OwnerOnlyGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isOwner, profile, loading } = useRefData();

  const restricted = ownerOnlyPaths.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!restricted) return <>{children}</>;

  // wait for the profile before deciding, or an owner sees a flash of the wall
  if (loading || !profile) return <PageSpinner />;
  if (isOwner) return <>{children}</>;

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <Lock className="h-7 w-7" />
      </div>
      <h1 className="text-lg font-extrabold text-ink-900">העמוד הזה סגור</h1>
      <p className="mt-1.5 text-sm text-ink-500">
        דוחות כספיים ורווחים פתוחים לבעל העסק בלבד. אפשר להמשיך לעבוד במסכי העבודות והקבלנים.
      </p>
    </div>
  );
}
