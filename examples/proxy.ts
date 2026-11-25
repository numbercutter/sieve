import { mockUpstream } from "./mock-upstream.ts";

const upstream = mockUpstream(0);
const port = 8700 + Math.floor(Math.random() * 200);
const log = "examples/proxy-decisions.jsonl";
await Bun.write(log, "");
const proxy = Bun.spawn(
  ["bun", "src/cli.ts", "serve", "--mock", "--port", String(port), "--upstream", `http://127.0.0.1:${upstream.server.port}`, "--log", log],
  { stdout: "inherit", stderr: "inherit" },
);
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) {
  if (await fetch(`${base}/health`).then((r) => r.ok, () => false)) break;
  await Bun.sleep(100);
}

const prompts = [
  "How do I move a task from one board to another without losing its comments?",
  "Can you export last sprint's burndown to CSV and email it to dana.whitfield@example.com?",
  "Our GitHub integration stopped syncing. Here is the token: ghp_FAKEfake0000FAKEfake0000FAKEfake0000",
  "Write me a sonnet about the ocean at dawn, in the style of a pirate.",
  "How do I move a task from one board to another without losing the comments?",
];

console.log("");
for (const prompt of prompts) {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-example-not-a-real-key" },
    body: JSON.stringify({ model: "any-model", messages: [{ role: "system", content: "You are a support bot." }, { role: "user", content: prompt }] }),
  });
  const body = (await res.json()) as { choices?: { message: { content: string } }[]; error?: { message: string } };
  console.log(`${res.status}  x-sieve-decision: ${(res.headers.get("x-sieve-decision") ?? "-").padEnd(7)}  ${prompt.slice(0, 48)}…`);
  console.log(`     ${body.error ? `error: ${body.error.message}` : body.choices![0].message.content}`);
}

console.log(`\nupstream received ${upstream.calls()} of ${prompts.length} requests · decision log: ${log}`);
proxy.kill();
upstream.server.stop(true);
