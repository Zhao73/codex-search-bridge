---
name: verified-web-research
description: Search and verify current web information through the Codex Search Bridge MCP. Use for explicit requests to search, browse, open links, check sources, or verify facts, and for unstable information such as latest news, today's events, current people or prices, recent releases, schedules, laws, regulations, standards, and referenced pages or papers not already provided.
---

# Verified Web Research

Use `research_web` whenever the answer depends on current or externally referenced information.

## Run research

1. Pass the user's actual question to `research_web`.
2. Use `standard` depth by default.
3. Use `quick` only for a narrow, low-risk lookup.
4. Use `deep` for consequential claims, disputed events, or requests for comprehensive research.
5. Add `recency_hours`, `date_from`, or `date_to` only when the request supplies or clearly implies that boundary.
6. Keep `max_sources` between 3 and 12. Prefer 6 unless the task needs broader coverage.

Do not claim to have searched unless the tool succeeds and returns a nonzero `web_search_events` count. For standard or deep work, require a nonzero `opened_page_events` count. When describing provenance, distinguish native `codex_open_page_events` from restricted `bridge_fetch_events`; never describe a Bridge fetch as a Codex-native open action. If `bridge_fetch_events` is nonzero, require `content_audit_passes` to be nonzero.

## Standard-function fallback for local providers

Some local OpenAI-compatible providers accept ordinary function tools but reject Codex MCP `namespace` tools. When `research_web` is not present and `CODEX_SEARCH_BRIDGE_CLI_ONLY=1`, use the bundled compatibility runner. Do not use curl, another search engine, or a shell pipeline.

1. Resolve `scripts/research.mjs` relative to the directory containing this `SKILL.md`. Never guess a repository path.
2. Call `exec_command` with only `node <absolute-path-to-scripts/research.mjs>` and set `tty: true` so stdin remains open. Do not put the question or JSON on the shell command line. Wait for `CODEX_SEARCH_BRIDGE_READY` and retain the returned session ID.
3. The process waits for one JSON line. Use `write_stdin` with that session ID, set `yield_time_ms: 30000`, and send the same `research_web` input object followed by one actual LF newline. In the tool-call JSON this is represented as `"chars": "{...}\\n"`; do not type two characters `\\` and `n` into the terminal. The runner defensively accepts one double-escaped final newline from providers that serialize it incorrectly.
4. A nonempty `write_stdin` call can yield before research finishes. When you see `CODEX_SEARCH_BRIDGE_RESEARCHING_POLL_SESSION` or any running-session status, call `write_stdin` again on the same session with empty `chars` and `yield_time_ms: 300000`. Repeat until the command exits.
5. Parse only the final JSON object printed after the process exits. Apply every evidence rule in this Skill. `CODEX_SEARCH_BRIDGE_READY`, `CODEX_SEARCH_BRIDGE_RESEARCHING_POLL_SESSION`, PTY input echo, and a running-session status are diagnostics, not research output. Never invent an answer or counters from those markers.

The CLI runner starts the same isolated Codex research engine as MCP. This fallback exists only for provider protocol compatibility; it does not weaken evidence checks.

## Render the result in this conversation

Lead with the synthesized answer. Put clickable source links next to the claims they support.

For news and dated events, distinguish:

- `published_at`: when the source first appeared;
- `updated_at`: when the page changed;
- `event_date`: when the event actually happened;
- `retrieved_at`: when this research accessed the source.

State the result's `as_of` time. Preserve the tool's confidence and status. Never upgrade `partial`, `low`, `unknown`, `unconfirmed`, or `conflicting` evidence.

Add a short **Unconfirmed or conflicting / 未确认或冲突** section whenever any claim has status `unconfirmed`, `partially_confirmed`, or `conflicting`, or when `limitations` is non-empty. Do not hide a conflict to make the answer cleaner.

## Handle failure honestly

- If the error is `CODEX_NOT_FOUND`, ask the user to install Codex CLI or configure `CODEX_SEARCH_BRIDGE_CODEX_BIN`.
- If the error is `CODEX_AUTH_REQUIRED`, ask the user to sign in to Codex.
- If the error is `WEB_SEARCH_UNAVAILABLE`, state that account or workspace policy blocked live search.
- If the error is `EVIDENCE_VERIFICATION_FAILED`, state that search/open-page proof was missing; do not answer from memory as if it were current.
- For setup problems, call `doctor` and report its exact safe remediation list.

This workflow works only when the current external model can call MCP tools. A model without reliable tool calling cannot gain web access from instructions alone.
