# Architecture

Codex Search Bridge is a local stdio MCP server with a bounded stdin compatibility entrypoint. Its outer client is an external model running in Codex; its inner worker is a separate authenticated Codex CLI process with native live Web Search.

## Data flow

1. The external model calls `research_web` with a question and bounded filters. In CLI-only compatibility mode, the bundled Skill sends the same object as one JSON line to `scripts/research.mjs`, which invokes `dist/server.mjs --research-stdin`.
2. Zod rejects unknown fields, invalid calendar dates, empty date intersections, and unsafe limits.
3. The Bridge creates private task, home, Codex-home, and temp directories. It copies only `auth.json` when API-key authentication is not active.
4. It sends a fixed, injection-aware prompt over stdin to an argument-array invocation equivalent to:

   ```text
   codex --search -c features.plugins=false exec
     --ignore-user-config --ignore-rules
     --sandbox read-only --ephemeral --skip-git-repo-check
     --cd <temporary-directory> --json
     --output-schema <schema> --output-last-message <result> -
   ```

5. `codex --search` performs live research. Standard/deep prompts explicitly require an `open_page` action for cited sources.
6. The child emits JSONL to stdout and schema-constrained JSON to a temporary result file.
7. The Bridge parses completed search/page events. A URL-bearing native open is accepted directly. For cited URLs without native-open proof, the restricted fetcher resolves and pins a public address, opens the page, revalidates every redirect, and extracts bounded visible text.
8. When direct fetch evidence exists, a second ephemeral Codex worker receives the untrusted draft plus fetched excerpts. It must search live again, re-evaluate ordered claims such as “latest,” and correct or downgrade stale conclusions.
9. Newly cited audit sources are opened before final verification. The verifier combines the explicitly separated evidence channels, calculates URL provenance, and rejects direct fetch evidence without a completed audit pass.
10. The task directory, including its temporary auth copy, is removed in `finally` on success, error, timeout, and cancellation.
11. The structured result returns through MCP; the Skill renders it in the current conversation.

## Component boundaries

| Module | Responsibility |
|---|---|
| `contracts.ts` | Stable input/result types and validation |
| `time-window.ts` | Recency and explicit-date intersection |
| `research-prompt.ts` | Fixed prompt and untrusted-data delimiters |
| `codex-process.ts` | `shell=false` spawn, limits, cancellation, bounded queue |
| `research-runner.ts` | Isolation, Codex arguments, result loading, cleanup |
| `jsonl-events.ts` | Current and archived Codex event adapters |
| `page-fetch.ts` | SSRF-resistant, DNS-pinned cited-page verification |
| `url-evidence.ts` | Conservative URL normalization and redirect matching |
| `verifier.ts` | Search/open-page/claim proof and result downgrades |
| `doctor.ts` | Read-only installation and live capability checks |
| `server.ts` | MCP boundary and bounded JSON-over-stdin compatibility entrypoint |

## Evidence model

The worker's prose is not proof. The verifier always requires a completed native Codex search action in JSONL. Standard and deep modes additionally require an attributable page open. Native URL-bearing opens count as `codex_open_page_events`; restricted direct opens count as `bridge_fetch_events`; `opened_page_events` is their sum. When Bridge fetches are present, `content_audit_passes` must also be nonzero. The Bridge fetcher cannot satisfy the live-search requirement and is never presented as Codex-native search.

URL provenance uses exact normalized HTTP(S) URLs. It may remove fragments and known tracking parameters, sort semantic query parameters, and follow only explicitly observed redirects. Same-domain URLs, different IDs, or guessed canonical pages are not treated as equivalent. `cited_sources_verified` includes sources matched through either named evidence channel.

Every source gets `provenance_verified`. Claims marked confirmed without a verified cited source are downgraded to unconfirmed. Conflicts are preserved. The Bridge never upgrades worker confidence.

## Search providers

The host that calls the tool and the backend that performs the search are independent. `selectProvider` resolves `codex` → `claude` → `tavily`, taking the first that is available, and `CODEX_SEARCH_BRIDGE_PROVIDER` pins one explicitly. Every result carries `verification.provider` and `verification.evidence_tier`.

`codex` and `claude` are both agent workers and share the whole pipeline: prompt, structured result, page fetcher, content audit, and verifier. They differ only in how the worker is spawned and how its evidence is read.

- **codex** — `codex --search ... --json` with `--output-schema`; evidence is parsed from JSONL `web_search` actions.
- **claude** — `claude --print --output-format stream-json`; a `tool_use` block named `WebSearch` is a search event, a `WebFetch` block is a native page open, and cited URLs are recovered from the `Links: [...]` array Claude embeds in the search `tool_result` text. Claude Code has no `--output-schema`, so the result shape is stated in the prompt and validated afterwards by `normalizeWorkerResult`.
- **tavily** — not an agent. The Bridge queries the search API, opens every returned URL through its own restricted fetcher, and emits a single `unconfirmed` claim. No model reads the pages.

### Evidence tiers

| Tier | Reached when | Ceiling |
| --- | --- | --- |
| `native_audited` | agent worker searched, opened pages, and a second isolated worker reconciled fetched text | `verified` |
| `native` | agent worker searched and opened pages, no audit pass | `partial` |
| `search_api` | search API supplied URLs, only the Bridge opened them | `partial`, hard-capped |

The `search_api` cap is enforced in the verifier rather than left to the caller: complete URL provenance is not the same as a model having read the page, and only the audited tier may report `verified`.

## Isolation and recursion prevention

The Codex worker gets full process isolation:

- `features.plugins=false` prevents the child from loading this plugin again.
- Fresh `HOME`, `USERPROFILE`, and `CODEX_HOME` roots prevent discovery of user Skills, plugins, MCP servers, and configuration. Only `auth.json` is copied when needed.
- `--ignore-user-config` prevents an outer external provider or personal MCP configuration from replacing the research worker environment.
- `--ignore-rules` removes project-specific execution rules.
- `--sandbox read-only` and a fresh working directory prevent project modification.
- `--ephemeral` prevents a persistent child conversation.
- The public tool cannot supply a command, model, path, system prompt, or environment variable.

The worker still uses the user's Codex authentication and quota. Organization requirements remain authoritative and can disable live search.

The Claude worker cannot use the same approach. Claude Code resolves its login from the user's config directory and, on macOS, the Keychain; a fresh `HOME` and an isolated `CLAUDE_CONFIG_DIR` both make it report "Not logged in". It therefore keeps the real `HOME` and is confined on the command line instead:

- `--strict-mcp-config` with no `--mcp-config` loads zero MCP servers, which is what prevents recursion into this Bridge.
- `--setting-sources ""` loads no user, project, or local settings, so no hooks, permission allowlists, or `CLAUDE.md` apply.
- `--allowedTools WebSearch WebFetch` plus an explicit deny list keeps the worker away from shell and file tools.
- `--permission-mode dontAsk` and a throwaway working directory keep the run non-interactive and out of the user's project.
- `--bare` is deliberately **not** used: it would also disable MCP and settings, but it restricts auth to `ANTHROPIC_API_KEY`, breaking every OAuth subscription user.

Only `PATH`, `HOME`, `USER`, `LOGNAME`, locale, temp roots, and platform variables reach the Claude worker. `USER` is load-bearing on macOS — without it the Keychain lookup fails and the worker reports "Not logged in" despite a valid session. `ANTHROPIC_BASE_URL` and gateway credentials are stripped, because an open-weight model behind a gateway has no server-side `WebSearch` tool.

This is weaker than the Codex worker's isolation and is documented as such rather than described as equivalent.

## Compatibility strategy

Codex JSONL can evolve. Known event families are adapted explicitly and fixtures cover current `item.completed` events plus archived `web_search_call` records. Unknown event types and generic `other` web actions are never guessed to be page opens. On Codex CLI 0.145.0, a native page operation can appear without a URL-bearing action; the restricted fetcher provides transparent URL proof instead. A new event shape must arrive with a raw sanitized fixture and parser regression test.

Some local OpenAI-compatible providers reject Codex MCP `namespace` tools even though they support ordinary function tools. Setting `CODEX_SEARCH_BRIDGE_CLI_ONLY=1` makes the plugin's MCP server answer `tools/list` with an intentional empty array. The Skill then uses Codex's ordinary command tools with `tty: true`, waits for a readiness marker, and sends one bounded JSON line to the packaged stdin runner. The parser accepts either an actual LF or one provider-double-escaped final LF, but never loosens JSON or research-input validation. Both routes converge before research execution and use the same isolation, evidence, and verification code. Compatibility mode therefore fixes a transport mismatch only; it cannot make a model follow tools reliably.
