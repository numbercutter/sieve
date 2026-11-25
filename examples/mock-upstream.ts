export function mockUpstream(port = Number(process.env.PORT ?? 9100)) {
  let calls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
      const body = (await req.json()) as { model?: string; messages: { role: string; content: string }[] };
      calls++;
      const last = body.messages.at(-1)?.content ?? "";
      return Response.json({
        id: `chatcmpl-mock-${calls}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? "mock",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: `mock answer to: ${String(last).slice(0, 60)}` } }],
        usage: { prompt_tokens: Math.ceil(String(last).length / 4), completion_tokens: 8, total_tokens: Math.ceil(String(last).length / 4) + 8 },
      });
    },
  });
  return { server, calls: () => calls };
}

if (import.meta.main) {
  const { server } = mockUpstream();
  console.log(`mock upstream on http://${server.hostname}:${server.port}/v1/chat/completions`);
}
