export type Decision = "forward" | "block" | "review";
export type Finding = { decision: Decision; reason: string };

export type Rule = { name: string; match: string[]; action?: "block" | "review" };

export type Config = {
  minChars: number;
  minWords: number;
  duplicateThreshold: number;
  recentWindow: number;
  rules: Rule[];
  scope: { description: string; keywords: string[] };
  local: { url: string; model: string; timeoutMs: number };
  pricing: { inputPerMTok: number; outputPerMTok: number; expectedOutputTokens: number };
};

export const DEFAULTS: Config = {
  minChars: 12,
  minWords: 3,
  duplicateThreshold: 0.75,
  recentWindow: 200,
  rules: [],
  scope: { description: "", keywords: [] },
  local: { url: "http://localhost:11434", model: "llama3.2", timeoutMs: 15000 },
  pricing: { inputPerMTok: 3, outputPerMTok: 15, expectedOutputTokens: 500 },
};

export function tooShort(prompt: string, cfg: Config): Finding | null {
  const text = prompt.trim();
  if (!text) return { decision: "block", reason: "empty prompt" };
  const words = text.split(/\s+/).length;
  if (text.length < cfg.minChars || words < cfg.minWords)
    return { decision: "block", reason: `too short (${words === 1 ? "1 word" : `${words} words`}, ${text.length} chars)` };
  return null;
}

export function shingles(text: string, k = 5): Set<string> {
  const s = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const out = new Set<string>();
  if (s.length <= k) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i <= s.length - k; i++) out.add(s.slice(i, i + k));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function nearDuplicate(sh: Set<string>, recent: { label: string; sh: Set<string> }[], cfg: Config): Finding | null {
  let best = { sim: 0, label: "" };
  for (const r of recent) {
    const sim = jaccard(sh, r.sh);
    if (sim > best.sim) best = { sim, label: r.label };
  }
  if (best.sim >= cfg.duplicateThreshold)
    return { decision: "block", reason: `near-duplicate of ${best.label} (${best.sim.toFixed(2)})` };
  return null;
}

const SECRETS: [string, RegExp][] = [
  ["OpenAI key", /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Stripe key", /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ["private key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["password or secret assignment", /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{8,}/i],
];

export function secrets(prompt: string): Finding[] {
  const kinds = SECRETS.filter(([, re]) => re.test(prompt)).map(([k]) => k);
  return kinds.map((k) => ({ decision: "block", reason: `contains secret: ${k}` }));
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function pii(prompt: string): Finding[] {
  const found: string[] = [];
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(prompt)) found.push("email address");
  if (/(?:\+?\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(prompt)) found.push("phone number");
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(prompt)) found.push("US SSN");
  const cards = prompt.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  if (cards.some((c) => luhn(c.replace(/\D/g, "")))) found.push("payment card number");
  if (/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/.test(prompt)) found.push("IBAN");
  return found.map((k) => ({ decision: "review", reason: `contains PII: ${k}` }));
}

export function banned(prompt: string, rules: Rule[]): Finding[] {
  const text = prompt.toLowerCase();
  return rules.flatMap((rule) => {
    const hit = rule.match.find((m) =>
      m.startsWith("/") && m.lastIndexOf("/") > 0
        ? new RegExp(m.slice(1, m.lastIndexOf("/")), m.slice(m.lastIndexOf("/") + 1) || "i").test(prompt)
        : new RegExp(`\\b${m.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text),
    );
    return hit ? [{ decision: rule.action ?? "block", reason: `rule "${rule.name}" matched "${hit}"` } as Finding] : [];
  });
}
