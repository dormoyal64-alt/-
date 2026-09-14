"use client";

import { useState } from "react";
import { MapPin, Loader2, CheckCircle2, X, PencilLine } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { useAddressAutocomplete, type AddressResult } from "@/hooks/useAddressAutocomplete";

/**
 * Pulls a house number out of what was typed: "הרצל 15", "הרצל 15א",
 * "רחוב הרצל 15/3". OpenStreetMap rarely holds house numbers in Israel, so its
 * suggestions come back as bare streets — without this the number the user
 * typed would vanish the moment they picked one.
 */
export function extractHouseNumber(query: string): string | null {
  const m = query.match(/(?:^|\s)(\d+[א-ת]?(?:\s*[/-]\s*\d+)?)\s*$/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

/** Builds the one-line address we store and show. */
export function formatAddressLine(r: AddressResult): string {
  const line = [r.street, r.houseNumber].filter(Boolean).join(" ");
  return line || r.displayName;
}

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
  /** set once the user picked a result or confirmed their own text */
  selected?: AddressResult | null;
  onClear?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const { results, loading } = useAddressAutocomplete(value, cityHint);

  const typed = value.trim();
  const typedNumber = extractHouseNumber(typed);
  const verified = selected?.lat != null && selected?.lng != null;

  // A chosen address is shown as a card instead of a bare text field, so it is
  // obvious the address is settled — and whether it was checked against a map.
  if (selected) {
    return (
      <div
        className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 ${
          verified ? "border-success-100 bg-success-50" : "border-ink-100 bg-ink-50"
        }`}
      >
        {verified ? (
          <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-success-600" />
        ) : (
          <PencilLine className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink-900">{formatAddressLine(selected)}</p>
          {selected.city && <p className="truncate text-xs text-ink-500">{selected.city}</p>}
          <p className={`mt-1 text-[11px] font-semibold ${verified ? "text-success-700" : "text-ink-400"}`}>
            {selected.lat != null && selected.lng != null
              ? `כתובת אומתה מול מפת OpenStreetMap · ${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`
              : "כתובת שהוקלדה ידנית — לא אומתה מול מפה"}
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

  // Always offered, whether or not the map found anything: many Israeli
  // addresses simply are not in OpenStreetMap, and a job can't wait for that.
  function confirmTypedAddress() {
    if (!typed) return;
    const street = typedNumber ? typed.slice(0, typed.length - typedNumber.length).trim() || null : typed || null;
    onSelect({
      displayName: cityHint ? `${typed}, ${cityHint}` : typed,
      lat: null,
      lng: null,
      street,
      houseNumber: typedNumber,
      city: cityHint ?? null,
    });
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && typed) {
              e.preventDefault();
              confirmTypedAddress();
            }
          }}
          placeholder="למשל: הרצל 15"
          className="pr-10"
        />
        {loading && <Loader2 className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-300" />}
      </div>

      {focused && (typed.length > 0 || results.length > 0) && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-ink-100 bg-white shadow-popover">
          {results.map((r, i) => {
            // OSM gives back the street; keep the number the user typed.
            const merged: AddressResult = { ...r, houseNumber: r.houseNumber ?? typedNumber };
            return (
              <button
                type="button"
                key={i}
                onMouseDown={() => onSelect(merged)}
                className="flex w-full items-start gap-2 border-b border-ink-50 px-3.5 py-2.5 text-right hover:bg-brand-50"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-800">{formatAddressLine(merged)}</span>
                  <span className="block truncate text-xs text-ink-400">{merged.city ?? merged.displayName}</span>
                </span>
              </button>
            );
          })}

          {typed.length > 0 && (
            <button
              type="button"
              onMouseDown={confirmTypedAddress}
              className="flex w-full items-start gap-2 bg-ink-50/60 px-3.5 py-2.5 text-right hover:bg-brand-50"
            >
              <PencilLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-800">
                  שימוש בכתובת שהקלדתי: ״{typed}״
                </span>
                <span className="block text-xs text-ink-400">
                  {results.length > 0
                    ? "אם אף אחת מההצעות למעלה לא מדויקת"
                    : loading
                      ? "מחפש במפה..."
                      : "הכתובת תישמר בדיוק כפי שנרשמה"}
                </span>
              </span>
            </button>
          )}
        </div>
      )}

      <p className="mt-1.5 text-xs text-ink-400">
        אפשר להקליד רחוב ומספר בית ולבחור ״שימוש בכתובת שהקלדתי״ (או ללחוץ Enter) — לא חייבים לבחור מהרשימה.
      </p>
    </div>
  );
}
