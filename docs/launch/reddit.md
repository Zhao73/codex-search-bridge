# Reddit launch draft

## Suggested title

I made an MCP bridge so external models in Codex can use verified live-web search

## Post

I use external models inside Codex, but current-information questions were still awkward. Tool calling and real web research are separate capabilities.

Codex Search Bridge adds one `research_web` MCP tool. It launches a separate Codex live-search worker, asks it to open relevant pages, and checks the actual JSONL events before accepting the result.

The returned result includes:

- source URLs matched against observed web events;
- publication, update, event, and retrieval dates as different fields;
- confirmed, partial, unconfirmed, and conflicting claim states;
- an `as_of` timestamp and limitations.

No search event means failure. Standard/deep mode without page-opening evidence also fails.

Requirements are straightforward: the outer model must support MCP, Codex must be installed and authenticated, and the user's account must allow live Web Search. The child search consumes the user's Codex quota.

It is Apache-2.0, local, and unofficial:
https://github.com/Zhao73/codex-search-bridge
