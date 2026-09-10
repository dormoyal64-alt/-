import { NextRequest, NextResponse } from "next/server";

// Proxies to Nominatim (OpenStreetMap) — free geocoding, no API key required.
// A descriptive User-Agent is mandatory under Nominatim's usage policy
// (https://operations.osmfoundation.org/policies/nominatim/) and browsers can't
// set that header themselves, so this route runs the request server-side.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  const city = request.nextUrl.searchParams.get("city")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const query = city ? `${q}, ${city}, ישראל` : `${q}, ישראל`;
  // Defaults to the public OpenStreetMap service. Override NOMINATIM_URL to point
  // at a self-hosted Nominatim (higher rate limits, no fair-use cap).
  const base = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
  const url = new URL(base.replace(/\/$/, "") + "/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "il");
  url.searchParams.set("limit", "6");
  url.searchParams.set("accept-language", "he");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "JobCRM/1.0 (private business management app)",
      },
      // Nominatim rate limit is 1 req/sec per usage policy; this app calls it
      // only after debounced user keystrokes, well under that limit.
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      return NextResponse.json({ results: [], error: "geocode_upstream_error" }, { status: 502 });
    }

    const data: Array<{
      display_name: string;
      lat: string;
      lon: string;
      address?: Record<string, string>;
    }> = await res.json();

    const results = data.map((item) => ({
      displayName: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      street: item.address?.road ?? null,
      houseNumber: item.address?.house_number ?? null,
      city:
        item.address?.city ??
        item.address?.town ??
        item.address?.village ??
        item.address?.municipality ??
        null,
    }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [], error: "geocode_network_error" }, { status: 502 });
  }
}
