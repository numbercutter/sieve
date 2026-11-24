import { existsSync, readFileSync } from "node:fs";
import { DEFAULTS, banned, nearDuplicate, pii, secrets, shingles, tooShort, type Config, type Decision, type Finding } from "./checks.ts";
import type { LocalModel } from "./local.ts";

export { DEFAULTS, type Config, type Decision, type Rule } from "./checks.ts";
export { ollama, mock, type LocalModel } from "./local.ts";

export type Result = { decision: Decision; reasons: string[]; costSavedEstimate: number };
export type SieveOptions = { config?: Partial<Config>; local?: LocalModel | null };

export function loadConfig(path = "sieve.config.json"): Partial<Config> {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

function merge(partial: Partial<Config>): Config {
  return {
    ...DEFAULTS,
    ...partial,
    scope: { ...DEFAULTS.scope, ...partial.scope },
    local: { ...DEFAULTS.local, ...partial.local },
    pricing: { ...DEFAULTS.pricing, ...partial.pricing },
  };
}

export function estimateCost(prompt: string, cfg: Config): number {
  const inputTokens = Math.ceil(prompt.length / 4);
  const p = cfg.pricing;
  return (inputTokens * p.inputPerMTok + p.expectedOutputTokens * p.outputPerMTok) / 1_000_000;
}

export function createSieve(opts: SieveOptions = {}) {
  const cfg = merge(opts.config ?? {});
  const local = opts.local ?? null;
  const recent: { label: string; sh: Set<string> }[] = [];
  let seen = 0;

  async function sieve(prompt: string, label?: string): Promise<Result> {
    const findings: Finding[] = [];
    const short = tooShort(prompt, cfg);
    if (short) findings.push(short);
    const sh = shingles(prompt);
    if (!short) {
      const dup = nearDuplicate(sh, recent, cfg);
      if (dup) findings.push(dup);
    }
    findings.push(...secrets(prompt), ...pii(prompt), ...banned(prompt, cfg.rules));

    seen++;
    if (!short) {
      recent.push({ label: label ?? `prompt ${seen}`, sh });
      if (recent.length > cfg.recentWindow) recent.shift();
    }

    if (!findings.some((f) => f.decision === "block") && local) {
      try {
        if (!(await local.relevant(prompt, cfg))) findings.push({ decision: "block", reason: `${local.name}: off-topic` });
      } catch (err) {
        findings.push({ decision: "forward", reason: `${local.name} skipped: ${(err as Error).message}` });
      }
    }

    const decision: Decision = findings.some((f) => f.decision === "block")
      ? "block"
      : findings.some((f) => f.decision === "review")
        ? "review"
        : "forward";
    return {
      decision,
      reasons: findings.length ? findings.map((f) => f.reason) : ["passed all checks"],
      costSavedEstimate: decision === "block" ? estimateCost(prompt, cfg) : 0,
    };
  }

  return Object.assign(sieve, { config: cfg });
}

let defaultSieve: ReturnType<typeof createSieve> | undefined;

export async function sieve(prompt: string): Promise<Result> {
  defaultSieve ??= createSieve({ config: loadConfig() });
  return defaultSieve(prompt);
}
