import type { Config } from "./checks.ts";

export type LocalModel = { name: string; relevant(prompt: string, cfg: Config): Promise<boolean> };

function question(prompt: string, cfg: Config): string {
  return `You are a gatekeeper for an assistant whose job is: ${cfg.scope.description}
Decide whether the user message below is a genuine request that fits that job.
Answer with exactly one word: yes or no.

User message:
"""
${prompt.slice(0, 4000)}
"""`;
}

export function ollama(model = "llama3.2", url = process.env.OLLAMA_URL ?? "http://localhost:11434"): LocalModel {
  return {
    name: `ollama:${model}`,
    async relevant(prompt, cfg) {
      const res = await fetch(`${url.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: question(prompt, cfg),
          stream: false,
          options: { temperature: 0, num_predict: 3 },
        }),
        signal: AbortSignal.timeout(cfg.local.timeoutMs),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const { response } = (await res.json()) as { response: string };
      return /^\W*yes\b/i.test(response);
    },
  };
}

export function mock(): LocalModel {
  return {
    name: "mock",
    async relevant(prompt, cfg) {
      if (!cfg.scope.keywords.length) return true;
      const text = prompt.toLowerCase();
      return cfg.scope.keywords.some((k) => text.includes(k.toLowerCase()));
    },
  };
}
