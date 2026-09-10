// All money is stored as integer אגורות (1 ₪ = 100 agorot) to avoid floating point errors.

export function shekelsToAgorot(shekels: number | string): number {
  const n = typeof shekels === "string" ? parseFloat(shekels.replace(/[^\d.-]/g, "")) : shekels;
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function agorotToShekels(agorot: number | null | undefined): number {
  if (!agorot) return 0;
  return agorot / 100;
}

export function formatAgorot(agorot: number | null | undefined): string {
  const shekels = agorotToShekels(agorot);
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: shekels % 1 === 0 ? 0 : 2,
  }).format(shekels);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return new Intl.NumberFormat("he-IL").format(n);
}

export function formatPercent(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || isNaN(n)) return "0%";
  return `${n.toFixed(digits)}%`;
}
