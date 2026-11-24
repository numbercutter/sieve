#!/usr/bin/env bun
import { DEFAULTS, createSieve, loadConfig, mock, ollama, type Config, type LocalModel, type Result } from "./index.ts";

const USAGE = `sieve — only the good stuff goes to the cloud

usage:
  sieve run <prompts.jsonl>   route every prompt and print a table
  sieve check "<prompt>"      route one prompt, print JSON

options:
  --config <path>             rules file (default ./sieve.config.json)
  --mock                      offline stand-in for the local model
  --ollama [model]            ask a local Ollama model (OLLAMA_URL, default http://localhost:11434)
  --json                      print one JSON result per line instead of a table`;

const args = process.argv.slice(2);
const has = (f: string) => {
  const i = args.indexOf(f);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const value = (f: string) => {
  const i = args.indexOf(f);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--") || v.endsWith(".jsonl")) {
    args.splice(i, 1);
    return "";
  }
  args.splice(i, 2);
  return v;
};
const fail = (msg: string): never => {
  console.error(`sieve: ${msg}`);
  process.exit(1);
};

const configPath = value("--config") || "sieve.config.json";
const useMock = has("--mock");
const ollamaModel = value("--ollama");
const json = has("--json");
const [cmd, target] = args;

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(USAGE);
  process.exit(cmd ? 0 : 1);
}

let config: Partial<Config> = {};
try {
  config = loadConfig(configPath);
} catch (err) {
  fail(`could not read ${configPath}: ${(err as Error).message}`);
}

let local: LocalModel | null = null;
if (useMock) local = mock();
else if (ollamaModel !== undefined) local = ollama(ollamaModel || config.local?.model || DEFAULTS.local.model, process.env.OLLAMA_URL ?? config.local?.url);
const sieve = createSieve({ config, local });

if (cmd === "check") {
  if (!target) fail("check needs a prompt");
  console.log(JSON.stringify(await sieve(target), null, 2));
  process.exit(0);
}
if (cmd !== "run") fail(`unknown command "${cmd}"\n\n${USAGE}`);
if (!target) fail("run needs a .jsonl file");
const file = Bun.file(target);
if (!(await file.exists())) fail(`no such file: ${target}`);

const lines = (await file.text()).split("\n").map((l) => l.trim()).filter(Boolean);
const rows: { id: string; prompt: string; r: Result }[] = [];
for (const [n, line] of lines.entries()) {
  let item: unknown;
  try {
    item = JSON.parse(line);
  } catch {
    fail(`line ${n + 1} is not JSON`);
  }
  const rec: { id?: string | number; prompt?: unknown } = typeof item === "string" ? { prompt: item } : (item ?? {});
  if (typeof rec.prompt !== "string") fail(`line ${n + 1} has no "prompt" string`);
  const id = String(rec.id ?? n + 1);
  const r = await sieve(rec.prompt as string, `#${id}`);
  rows.push({ id, prompt: rec.prompt as string, r });
  if (json) console.log(JSON.stringify({ id, ...r }));
}
if (json) process.exit(0);

const tty = process.stdout.isTTY;
const color = { forward: "32", block: "31", review: "33" } as const;
const paint = (d: keyof typeof color) => (tty ? `\x1b[${color[d]}m${d.padEnd(7)}\x1b[0m` : d.padEnd(7));
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t.padEnd(n);
};
const idW = Math.max(2, ...rows.map((r) => r.id.length));
console.log(`${"id".padEnd(idW)}  decision  ${"prompt".padEnd(44)}  reasons`);
console.log(`${"-".repeat(idW)}  --------  ${"-".repeat(44)}  ${"-".repeat(30)}`);
for (const { id, prompt, r } of rows)
  console.log(`${id.padEnd(idW)}  ${paint(r.decision)}   ${clip(prompt, 44)}  ${r.reasons.join("; ")}`);

const count = (d: string) => rows.filter((r) => r.r.decision === d).length;
const saved = rows.reduce((s, r) => s + r.r.costSavedEstimate, 0);
const blocked = count("block");
console.log(
  `\n${rows.length} prompts · ${count("forward")} forward · ${count("review")} review · ${blocked} block` +
    (local ? ` · local model: ${local.name}` : " · local model: off"),
);
console.log(
  `cloud calls avoided: ${blocked} of ${rows.length} (${rows.length ? Math.round((blocked / rows.length) * 100) : 0}%) · est. saved $${saved.toFixed(4)}`,
);
