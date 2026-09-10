"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Briefcase, Lock, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("אימייל או סיסמה שגויים. נסו שוב.");
      return;
    }
    const redirect = searchParams.get("redirect") || "/dashboard";
    router.push(redirect);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-brand-800 to-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-white">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur">
            <Briefcase className="h-7 w-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-extrabold">JobCRM</h1>
            <p className="text-sm text-white/60">מערכת ניהול עבודות וקבלנים</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="animate-slide-up space-y-4 rounded-3xl bg-white p-6 shadow-popover sm:p-7">
          <div>
            <Label htmlFor="email">אימייל</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pr-10"
                placeholder="you@example.com"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="password">סיסמה</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
                placeholder="••••••••"
              />
            </div>
          </div>
          {error && <p className="text-sm font-medium text-danger-600">{error}</p>}
          <Button type="submit" fullWidth size="lg" loading={loading}>
            כניסה למערכת
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-white/40">
          מערכת פרטית לניהול העסק — הגישה מוגבלת למשתמשים מורשים בלבד.
        </p>
      </div>
    </div>
  );
}
