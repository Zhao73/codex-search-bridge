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

## Isolation and recursion prevention

- `features.plugins=false` prevents the child from loading this plugin again.
- Fresh `HOME`, `USERPROFILE`, and `CODEX_HOME` roots prevent discovery of user Skills, plugins, MCP servers, and configuration. Only `auth.json` is copied when needed.
- `--ignore-user-config` prevents an outer external provider or personal MCP configuration from replacing the research worker environment.
- `--ignore-rules` removes project-specific execution rules.
- `--sandbox read-only` and a fresh working directory prevent project modification.
- `--ephemeral` prevents a persistent child conversation.
- The public tool cannot supply a command, model, path, system prompt, or environment variable.

The worker still uses the user's Codex authentication and quota. Organization requirements remain authoritative and can disable live search.

## Compatibility strategy

Codex JSONL can evolve. Known event families are adapted explicitly and fixtures cover current `item.completed` events plus archived `web_search_call` records. Unknown event types and generic `other` web actions are never guessed to be page opens. On Codex CLI 0.145.0, a native page operation can appear without a URL-bearing action; the restricted fetcher provides transparent URL proof instead. A new event shape must arrive with a raw sanitized fixture and parser regression test.

Some local OpenAI-compatible providers reject Codex MCP `namespace` tools even though they support ordinary function tools. Setting `CODEX_SEARCH_BRIDGE_CLI_ONLY=1` makes the plugin's MCP server answer `tools/list` with an intentional empty array. The Skill then uses Codex's ordinary command tools with `tty: true`, waits for a readiness marker, and sends one bounded JSON line to the packaged stdin runner. The parser accepts either an actual LF or one provider-double-escaped final LF, but never loosens JSON or research-input validation. Both routes converge before research execution and use the same isolation, evidence, and verification code. Compatibility mode therefore fixes a transport mismatch only; it cannot make a model follow tools reliably.
