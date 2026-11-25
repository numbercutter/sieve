import type { createSieve } from "./index.ts";

type Part = { type?: string; text?: string };
type Message = { role?: string; content?: string | Part[] | null };

export function lastUserText(body: unknown): string | null {
  const messages = (body as { messages?: Message[] })?.messages;
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n");
    return "";
  }
  return null;
}

function error(status: number, type: string, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: { type, code: type, message, ...extra } }, { status });
}

const DROP = new Set(["host", "content-length", "connection", "accept-encoding", "content-encoding", "transfer-encoding", "keep-alive"]);

export function serve(sieve: ReturnType<typeof createSieve>, opts: { port: number; upstream: string; hostname?: string }) {
  const upstream = opts.upstream.replace(/\/$/, "");
  let n = 0;
  return Bun.serve({
    hostname: opts.hostname ?? "127.0.0.1",
    port: opts.port,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/health") return Response.json({ ok: true, upstream });
      if (url.pathname !== "/v1/chat/completions") return error(404, "not_found", `sieve only proxies POST /v1/chat/completions, not ${req.method} ${url.pathname}`);
      if (req.method !== "POST") return error(405, "method_not_allowed", "use POST");

      const raw = await req.text();
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return error(400, "invalid_json", "request body is not JSON");
      }
      const prompt = lastUserText(body);
      if (prompt === null) return error(400, "no_user_message", "messages has no user message to check");

      const id = `req-${++n}`;
      const verdict = await sieve(prompt, `request ${n} at ${new Date().toISOString().slice(11, 19)}`, { id, source: "serve" });
      const reasons = verdict.reasons.join("; ");
      if (verdict.decision === "block") {
        const res = error(422, "sieve_blocked", `blocked by sieve: ${reasons}`, { reasons: verdict.reasons, decision: "block" });
        res.headers.set("x-sieve-decision", "block");
        return res;
      }

      const headers = new Headers();
      req.headers.forEach((v, k) => {
        if (!DROP.has(k.toLowerCase())) headers.set(k, v);
      });
      let res: Response;
      try {
        res = await fetch(`${upstream}${url.pathname}${url.search}`, { method: "POST", headers, body: raw });
      } catch (err) {
        return error(502, "upstream_unreachable", `could not reach ${upstream}: ${(err as Error).message}`);
      }
      const out = new Headers();
      res.headers.forEach((v, k) => {
        if (!DROP.has(k.toLowerCase())) out.set(k, v);
      });
      out.set("x-sieve-decision", verdict.decision);
      out.set("x-sieve-reasons", reasons.replace(/[^\x20-\x7e]/g, "?").slice(0, 500));
      return new Response(res.body, { status: res.status, headers: out });
    },
  });
}
