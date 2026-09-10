"use client";

import { useEffect, useRef, useState } from "react";

export interface AddressResult {
  displayName: string;
  lat: number;
  lng: number;
  street: string | null;
  houseNumber: string | null;
  city: string | null;
}

export function useAddressAutocomplete(query: string, cityHint?: string) {
  const [results, setResults] = useState<AddressResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.trim().length < 3) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: query });
        if (cityHint) params.set("city", cityHint);
        const res = await fetch(`/api/geocode?${params.toString()}`, { signal: controller.signal });
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        // aborted or network error — ignore, next keystroke will retry
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, cityHint]);

  return { results, loading };
}
