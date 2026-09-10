export function toCsv(rows: Record<string, unknown>[], headers?: { key: string; label: string }[]): string {
  if (rows.length === 0 && !headers) return "";
  const cols = headers ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }));

  const escape = (val: unknown) => {
    if (val === null || val === undefined) return "";
    const s = String(val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const headerLine = cols.map((c) => escape(c.label)).join(",");
  const lines = rows.map((row) => cols.map((c) => escape(row[c.key])).join(","));
  // BOM so Excel opens Hebrew UTF-8 correctly
  return "﻿" + [headerLine, ...lines].join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
