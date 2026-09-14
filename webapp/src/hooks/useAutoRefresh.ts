"use client";

import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 30_000;
/** visibilitychange and focus both fire when a tab comes back; only act once */
const EVENT_DEBOUNCE_MS = 3_000;

/**
 * Reloads a page's data when it is worth reloading: when the tab or the phone
 * app comes back to the front, and every half minute while it is actually being
 * looked at.
 *
 * Two people share one database here, so what someone else typed is already
 * saved — the only thing missing is a reason to go and fetch it. Polling a tab
 * nobody is looking at would be that reason wasted, so the timer only runs
 * while the page is visible.
 *
 * The callback is held in a ref, so callers do not have to wrap it in
 * useCallback to avoid restarting the timer on every render.
 */
export function useAutoRefresh(
  onRefresh: () => void | Promise<void>,
  { intervalMs = DEFAULT_INTERVAL_MS, enabled = true }: { intervalMs?: number; enabled?: boolean } = {}
) {
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;

    function run() {
      void cb.current();
    }

    // Coming back to a tab fires visibilitychange and focus together, so the
    // event path is debounced. The timer is not: its own interval is already
    // the pace, and debouncing it as well would swallow ticks.
    let lastEvent = 0;
    function onWake() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastEvent < EVENT_DEBOUNCE_MS) return;
      lastEvent = now;
      run();
    }

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, intervalMs);

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [intervalMs, enabled]);
}
