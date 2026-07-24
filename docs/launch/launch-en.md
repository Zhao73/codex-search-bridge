# Launch copy, English

## Short post

I built Codex Search Bridge for a specific gap: an external model can run inside Codex and call MCP tools, but it does not automatically inherit Codex native live-web research.

The plugin exposes one research tool. It starts an isolated `codex --search exec` worker, checks the JSONL stream for real search and page-opening events, matches cited URLs, separates publication dates from event dates, and returns uncertainty instead of hiding it.

It requires a tool-capable model, an authenticated Codex installation, and the user's own quota. It is an unofficial community project.

Source and install instructions:
https://github.com/Zhao73/codex-search-bridge

## Long post

Open models inside Codex can be useful, but “latest” questions expose a hard boundary: the conversational model may support MCP while lacking reliable live-web research of its own.

Codex Search Bridge gives that model one narrow tool: `research_web`.

Behind the tool, the Bridge starts a fresh Codex worker with native live search. The worker runs in a temporary directory, read-only, with user rules and plugins disabled. The Bridge then checks what actually happened:

- Was there a completed live search event?
- Did standard research open a source page?
- Did cited URLs appear in the event stream?
- Are publication, update, event, and retrieval dates separate?
- Which claims remain unconfirmed or conflicting?

If the evidence is missing, the tool fails. A worker saying “I searched” is not enough.

The limit matters: this works with external models that can reliably call MCP tools. It does not add tool calling to a model that lacks it. It also uses the user's Codex authentication and quota.

Codex Search Bridge is open source under Apache-2.0 and is not an official OpenAI plugin.

Repository:
https://github.com/Zhao73/codex-search-bridge

## Headline alternatives

1. Let tool-capable models borrow Codex live search
2. Real web research for external models inside Codex
3. A verifiable search bridge between your model and Codex
