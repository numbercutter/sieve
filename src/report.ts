import type { Decision } from "./checks.ts";
import type { LogEntry } from "./index.ts";

export type Bucket = { key: string; total: number; forward: number; review: number; block: number; saved: number };
export type Report = { entries: number; skipped: number; first: string; last: string; buckets: Bucket[]; total: Bucket; reasons: [string, number][] };

export function reasonKind(reason: string): string {
  if (reason.startsWith("near-duplicate")) return "near-duplicate";
  if (reason.startsWith("too short")) return "too short";
  const rule = reason.match(/^rule "([^"]+)"/);
  if (rule) return `rule "${rule[1]}"`;
  const skipped = reason.match(/^(\S+) skipped:/);
  if (skipped) return `${skipped[1]} skipped`;
  return reason;
}

const keyFor = (at: string, by: "hour" | "day" | "week") => {
  if (by === "hour") return `${at.slice(0, 13)}:00`;
  if (by === "day") return at.slice(0, 10);
  const d = new Date(`${at.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return `week of ${d.toISOString().slice(0, 10)}`;
};

export function summarize(text: string, by: "hour" | "day" | "week" = "day"): Report {
  const buckets = new Map<string, Bucket>();
  const reasons = new Map<string, number>();
  const blank = (key: string): Bucket => ({ key, total: 0, forward: 0, review: 0, block: 0, saved: 0 });
  const total = blank("total");
  let entries = 0;
  let skipped = 0;
  let first = "";
  let last = "";
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e: LogEntry;
    try {
      e = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (typeof e?.at !== "string" || Number.isNaN(Date.parse(e.at)) || !["forward", "review", "block"].includes(e.decision)) {
      skipped++;
      continue;
    }
    entries++;
    const at = new Date(e.at).toISOString();
    if (!first || at < first) first = at;
    if (!last || at > last) last = at;
    const key = keyFor(at, by);
    const b = buckets.get(key) ?? blank(key);
    for (const x of [b, total]) {
      x.total++;
      x[e.decision as Decision]++;
      x.saved += Number(e.costSavedEstimate) || 0;
    }
    buckets.set(key, b);
    for (const r of new Set((e.reasons ?? []).map(reasonKind))) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  return {
    entries,
    skipped,
    first,
    last,
    buckets: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
    total,
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

export function render(r: Report, label: string): string {
  if (!r.entries) return `${label}: no decisions${r.skipped ? ` (${r.skipped} unreadable lines)` : ""}`;
  const w = Math.max(10, ...r.buckets.map((b) => b.key.length));
  const pct = (b: Bucket) => `${Math.round((b.block / b.total) * 100)}%`;
  const row = (b: Bucket) =>
    `${b.key.padEnd(w)}  ${String(b.total).padStart(5)}  ${String(b.forward).padStart(7)}  ${String(b.review).padStart(6)}  ${String(b.block).padStart(5)}  ${pct(b).padStart(8)}  ${("$" + b.saved.toFixed(4)).padStart(10)}`;
  const lines = [
    `${label} · ${r.entries} decisions · ${r.first.slice(0, 16).replace("T", " ")} → ${r.last.slice(0, 16).replace("T", " ")} UTC${r.skipped ? ` · ${r.skipped} unreadable lines skipped` : ""}`,
    "",
    `${"".padEnd(w)}  ${"total".padStart(5)}  ${"forward".padStart(7)}  ${"review".padStart(6)}  ${"block".padStart(5)}  ${"blocked".padStart(8)}  ${"est. saved".padStart(10)}`,
    ...r.buckets.map(row),
    row(r.total),
    "",
    "reasons (prompts with at least one)",
    ...r.reasons.slice(0, 12).map(([k, n]) => `  ${String(n).padStart(5)}  ${k}`),
  ];
  return lines.join("\n");
}
