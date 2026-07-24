# Architecture

Codex Search Bridge is a local stdio MCP server. Its outer client is an external model running in Codex; its inner worker is a separate authenticated Codex CLI process with native live Web Search.

## Data flow

1. The external model calls `research_web` with a question and bounded filters.
2. Zod rejects unknown fields, invalid calendar dates, empty date intersections, and unsafe limits.
3. The Bridge creates a new private temporary directory.
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
7. The Bridge parses completed search/page events, validates the result, calculates URL provenance, and downgrades unsupported claims.
8. The temporary directory is removed in `finally`, including error and cancellation paths.
9. The structured result returns through MCP; the Skill renders it in the current conversation.

## Component boundaries

| Module | Responsibility |
|---|---|
| `contracts.ts` | Stable input/result types and validation |
| `time-window.ts` | Recency and explicit-date intersection |
| `research-prompt.ts` | Fixed prompt and untrusted-data delimiters |
| `codex-process.ts` | `shell=false` spawn, limits, cancellation, bounded queue |
| `research-runner.ts` | Isolation, Codex arguments, result loading, cleanup |
| `jsonl-events.ts` | Current and archived Codex event adapters |
| `url-evidence.ts` | Conservative URL normalization and redirect matching |
| `verifier.ts` | Search/open-page/claim proof and result downgrades |
| `doctor.ts` | Read-only installation and live capability checks |
| `server.ts` | MCP protocol boundary |

## Evidence model

The worker's prose is not proof. The verifier requires a completed search action in JSONL. Standard and deep modes additionally require a completed open-page action.

URL provenance uses exact normalized HTTP(S) URLs. It may remove fragments and known tracking parameters, sort semantic query parameters, and follow only explicitly observed redirects. Same-domain URLs, different IDs, or guessed canonical pages are not treated as equivalent.

Every source gets `provenance_verified`. Claims marked confirmed without a verified cited source are downgraded to unconfirmed. Conflicts are preserved. The Bridge never upgrades worker confidence.

## Isolation and recursion prevention

- `features.plugins=false` prevents the child from loading this plugin again.
- `--ignore-user-config` prevents an outer external provider or personal MCP configuration from replacing the research worker environment.
- `--ignore-rules` removes project-specific execution rules.
- `--sandbox read-only` and a fresh working directory prevent project modification.
- `--ephemeral` prevents a persistent child conversation.
- The public tool cannot supply a command, model, path, system prompt, or environment variable.

The worker still uses the user's Codex authentication and quota. Organization requirements remain authoritative and can disable live search.

## Compatibility strategy

Codex JSONL can evolve. Known event families are adapted explicitly and fixtures cover current `item.completed` events plus archived `web_search_call` records. Unknown event types are recorded as limitations and never counted as evidence. A new event shape must arrive with a raw sanitized fixture and parser regression test.
