"use client";

import { useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { useAddressAutocomplete, type AddressResult } from "@/hooks/useAddressAutocomplete";

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  cityHint,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: AddressResult) => void;
  cityHint?: string;
}) {
  const [focused, setFocused] = useState(false);
  const { results, loading } = useAddressAutocomplete(value, cityHint);

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="התחילו להקליד כתובת... (רחוב ומספר בית)"
          className="pr-10"
        />
        {loading && <Loader2 className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-300" />}
      </div>
      {focused && results.length > 0 && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-ink-100 bg-white shadow-popover">
          {results.map((r, i) => (
            <button
              type="button"
              key={i}
              onMouseDown={() => onSelect(r)}
              className="flex w-full items-start gap-2 border-b border-ink-50 px-3.5 py-2.5 text-right text-sm last:border-0 hover:bg-brand-50"
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
              <span className="text-ink-700">{r.displayName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
