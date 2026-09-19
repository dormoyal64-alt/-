"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Whether the business has connected WhatsApp, and how to send through it.
 *
 * The answer comes from the server, because what decides it is an access
 * token the browser is never given. Until the answer arrives the screens
 * treat it as "not connected" and offer the manual button, which is the one
 * that always works.
 */
export function useWhatsappSender() {
  const [configured, setConfigured] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/whatsapp")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setConfigured(!!d?.configured);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setChecked(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const send = useCallback(async (jobId: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const response = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        return { ok: false, error: data?.error ?? "השליחה נכשלה" };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "אין חיבור לרשת" };
    }
  }, []);

  return { configured, checked, send };
}
