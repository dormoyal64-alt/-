import { useEffect, useRef, useState } from 'react';

export interface AddressSuggestion {
  label: string;
}

interface NominatimResult {
  display_name: string;
}

/** Live address suggestions from OpenStreetMap/Nominatim, debounced and cancellable. */
export function useAddressSuggestions(query: string, cityName: string) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);

      const q = [trimmed, cityName, 'ישראל'].filter(Boolean).join(', ');
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=il&limit=5&accept-language=he&q=${encodeURIComponent(q)}`;

      fetch(url, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('geocoding failed'))))
        .then((data: NominatimResult[]) => {
          setSuggestions(data.map((d) => ({ label: d.display_name })));
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          setSuggestions([]);
        })
        .finally(() => setLoading(false));
    }, 450);

    return () => clearTimeout(timer);
  }, [query, cityName]);

  return { suggestions, loading };
}
