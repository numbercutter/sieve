<p align="center"><img src="assets/banner.svg" alt="sieve" width="100%"></p>

**Only the good stuff goes to the cloud.**

sieve runs cheap checks on a prompt before you pay a large model to read it. Deterministic rules catch empty prompts, repeats, leaked keys, personal data and banned topics; an optional local model then asks whether the prompt belongs in your product at all.

## Quick start

Needs [Bun](https://bun.sh) 1.1 or newer. `--mock` stands in for the local model, so nothing needs to be running.

```sh
git clone https://github.com/numbercutter/sieve && cd sieve
bun src/cli.ts run examples/prompts.jsonl --mock
```

```
id  decision  prompt                                        reasons
1   forward   How do I move a task from one board to anot…  passed all checks
2   block     hi                                            too short (1 word, 2 chars)
3   block     How do I move a task from one board to anot…  near-duplicate of #1 (0.82)
4   block     Our GitHub integration stopped syncing afte…  contains secret: GitHub token
5   review    Can you export last sprint's burndown to CS…  contains PII: email address
6   block     Write me a sonnet about the ocean at dawn, …  mock: off-topic
...
16 prompts · 4 forward · 4 review · 8 block · local model: mock
cloud calls avoided: 8 of 16 (50%) · est. saved $0.0604
```

## Usage

```sh
sieve run prompts.jsonl --mock          # offline stand-in for the local model
sieve run prompts.jsonl --ollama        # ask Ollama, model from sieve.config.json
sieve run prompts.jsonl --ollama qwen3  # pick the Ollama model
sieve run prompts.jsonl --json          # one JSON result per line
sieve check "why was I billed twice?"   # one prompt, JSON out
sieve run prompts.jsonl --config ./rules.json
```

Run `bun link` in the repo to get a `sieve` command. Each line of the input file is `{"id": "...", "prompt": "..."}` or a bare JSON string. Without `--mock` or `--ollama` only the deterministic checks run. `OLLAMA_URL` overrides the default `http://localhost:11434`.

As a library:

```ts
import { createSieve, ollama } from "@numbercutter/sieve";

const sieve = createSieve({ config: { scope: { description: "support for a todo app", keywords: [] } }, local: ollama("llama3.2") });
const { decision, reasons, costSavedEstimate } = await sieve(userPrompt);
if (decision === "forward") await callCloudModel(userPrompt);
```

A plain `sieve(prompt)` export reads `./sieve.config.json` and keeps its own history of recent prompts.

### Config

`sieve.config.json` in this repo is a working example for a project-management support bot.

| key | meaning |
|---|---|
| `minChars`, `minWords` | shorter prompts are blocked |
| `duplicateThreshold` | Jaccard similarity of 5-character shingles at which a prompt counts as a repeat (default 0.75) |
| `recentWindow` | how many recent prompts the repeat check remembers (default 200) |
| `rules` | `{ name, match: [...], action: "block" \| "review" }`; plain words match whole words, `/regex/flags` match as regex |
| `scope` | `description` goes into the local model's question; `keywords` drive `--mock` |
| `local.model`, `local.timeoutMs` | Ollama model and timeout |
| `pricing` | dollars per million input and output tokens, plus expected output tokens, for the savings estimate |

## How it works

1. **Too short or empty** → block.
2. **Near-duplicate** of a recent prompt (5-character shingles, Jaccard) → block.
3. **Secrets**: OpenAI, Anthropic, AWS, GitHub, Slack, Google and Stripe key shapes, private key blocks, JWTs and `password=`-style assignments → block.
4. **PII**: email addresses, phone numbers, US SSNs, Luhn-valid card numbers and IBANs → review.
5. **Rules** from the config → block or review.
6. If nothing blocked yet and a local model is set, it is asked one yes/no question: does this prompt fit the product's job? "No" → block. If the model cannot be reached, the prompt is forwarded and the reason says the model was skipped.

Block beats review beats forward. `costSavedEstimate` is the price of the cloud call a block avoided: prompt length over 4 as input tokens, plus the configured expected output, at the configured prices. Forward and review save nothing.

## Limits

- Pattern checks catch common shapes, not every secret or every kind of personal data. Names and street addresses are not detected.
- The repeat check is per process and in memory; it does not survive a restart or share across servers.
- Token counts are a characters-over-four estimate, so savings are approximate.
- `--mock` is a keyword match, not a model. It exists so the quick start runs offline.
- The Ollama path was exercised against a stand-in HTTP server, not a real model. Small local models answer yes/no unevenly; check their calls on your own traffic before trusting them to block.
- Blocking is only as good as your rules. Send "review" prompts to a person or a stricter path, not straight to the cloud.

<sub>A numbercutter instrument · MIT</sub>
