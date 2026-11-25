import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULTS, banned, names, nearDuplicate, pii, secrets, shingles, tooShort, type Config, type Decision, type Finding } from "./checks.ts";
import type { LocalModel } from "./local.ts";
import { inMemory, sqliteMemory, type RepeatMemory } from "./memory.ts";

export { DEFAULTS, type Config, type Decision, type Rule } from "./checks.ts";
export { ollama, mock, type LocalModel } from "./local.ts";
export { inMemory, sqliteMemory, type RepeatMemory } from "./memory.ts";

export type Result = { decision: Decision; reasons: string[]; costSavedEstimate: number };
export type LogEntry = { at: string; id?: string; source?: string; decision: Decision; reasons: string[]; chars: number; costSavedEstimate: number };
export type SieveOptions = { config?: Partial<Config>; local?: LocalModel | null; memory?: RepeatMemory; clock?: () => number };

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
    names: { ...DEFAULTS.names, ...partial.names },
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
  const clock = opts.clock ?? Date.now;
  const memory = opts.memory ?? (cfg.memory ? sqliteMemory(cfg.memory, cfg.recentWindow, cfg.recentTtlSeconds) : inMemory(cfg.recentWindow, cfg.recentTtlSeconds));
  if (cfg.log) mkdirSync(dirname(cfg.log), { recursive: true });
  let seen = 0;

  async function sieve(prompt: string, label?: string, meta: { id?: string; source?: string } = {}): Promise<Result> {
    const now = clock();
    const findings: Finding[] = [];
    const short = tooShort(prompt, cfg);
    if (short) findings.push(short);
    const sh = shingles(prompt);
    if (!short) {
      const dup = nearDuplicate(sh, memory.recent(now), cfg);
      if (dup) findings.push(dup);
    }
    const sensitive = [...secrets(prompt), ...pii(prompt), ...names(prompt, cfg)];
    findings.push(...sensitive, ...banned(prompt, cfg.rules));

    seen++;
    if (!short && !sensitive.length) memory.add(label ?? `prompt ${seen}`, sh, now);

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
    const result: Result = {
      decision,
      reasons: findings.length ? findings.map((f) => f.reason) : ["passed all checks"],
      costSavedEstimate: decision === "block" ? estimateCost(prompt, cfg) : 0,
    };
    if (cfg.log) {
      const entry: LogEntry = { at: new Date(now).toISOString(), ...meta, ...result, chars: prompt.length };
      appendFileSync(cfg.log, JSON.stringify(entry) + "\n");
    }
    return result;
  }

  return Object.assign(sieve, { config: cfg, close: () => memory.close?.() });
}

let defaultSieve: ReturnType<typeof createSieve> | undefined;

export async function sieve(prompt: string): Promise<Result> {
  defaultSieve ??= createSieve({ config: loadConfig() });
  return defaultSieve(prompt);
}
