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

Do not claim to have searched unless the tool succeeds and returns a nonzero `web_search_events` count. For standard or deep work, require a nonzero `opened_page_events` count.

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
