"use client";

import { useState } from "react";
import { MapPin, Loader2, CheckCircle2, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { useAddressAutocomplete, type AddressResult } from "@/hooks/useAddressAutocomplete";

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  cityHint,
  selected,
  onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: AddressResult) => void;
  cityHint?: string;
  /** set once the user picked a real result, so we can show it was verified */
  selected?: AddressResult | null;
  onClear?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const { results, loading } = useAddressAutocomplete(value, cityHint);

  // A picked address is shown as a confirmed card instead of a bare text field,
  // so it is obvious the address is a real one and not just typed text.
  if (selected) {
    const line = [selected.street, selected.houseNumber].filter(Boolean).join(" ");
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-success-100 bg-success-50 px-3.5 py-3">
        <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-success-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink-900">{line || selected.displayName}</p>
          <p className="truncate text-xs text-ink-500">{selected.city ?? selected.displayName}</p>
          <p className="mt-1 text-[11px] font-semibold text-success-700">
            כתובת אומתה מול מפת OpenStreetMap
            {selected.lat && selected.lng ? ` · ${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}` : ""}
          </p>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label="שינוי כתובת"
            className="shrink-0 rounded-full p-1 text-ink-400 hover:bg-white hover:text-ink-700"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

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

      {focused && value.trim().length >= 3 && !loading && results.length === 0 && (
        <p className="mt-1.5 text-xs text-ink-400">לא נמצאה כתובת תואמת — אפשר להמשיך ולהקליד ידנית</p>
      )}

      {focused && results.length > 0 && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-ink-100 bg-white shadow-popover">
          {results.map((r, i) => {
            const line = [r.street, r.houseNumber].filter(Boolean).join(" ");
            return (
              <button
                type="button"
                key={i}
                onMouseDown={() => onSelect(r)}
                className="flex w-full items-start gap-2 border-b border-ink-50 px-3.5 py-2.5 text-right last:border-0 hover:bg-brand-50"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-800">{line || r.displayName}</span>
                  <span className="block truncate text-xs text-ink-400">{r.city ?? r.displayName}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
