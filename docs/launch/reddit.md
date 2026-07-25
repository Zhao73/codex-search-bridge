# Reddit launch draft

## Suggested title

I made an MCP bridge so external models in Codex can use verified live-web search

## Post

I use external models inside Codex, but current-information questions were still awkward. Tool calling and real web research are separate capabilities.

Codex Search Bridge adds one `research_web` MCP tool. It launches a separate Codex live-search worker, requires actual search evidence, opens cited pages through a named native or restricted channel, and audits directly fetched text before accepting the result.

The returned result includes:

- source URLs matched against native-open evidence or restricted successful fetches;
- publication, update, event, and retrieval dates as different fields;
- confirmed, partial, unconfirmed, and conflicting claim states;
- an `as_of` timestamp and limitations.

No search event means failure. Standard/deep mode without page-opening evidence also fails.

Requirements are straightforward: the outer model must reliably follow MCP or Codex command tools, Codex must be installed and authenticated, and the user's account must allow live Web Search. The child search consumes the user's Codex quota. v0.1.0 is a preview and does not claim a positive external-model E2E run yet; the negative probes are included in the repository.

It is Apache-2.0, local, and unofficial:
https://github.com/Zhao73/codex-search-bridge
