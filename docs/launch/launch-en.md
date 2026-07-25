# Launch copy, English

## Short post

I built Codex Search Bridge for a specific gap: an external model can run inside Codex and call MCP tools, but it does not automatically inherit Codex native live-web research.

The plugin exposes one research tool. It starts an isolated `codex --search exec` worker, requires real search evidence, opens cited pages through an attributable native or restricted path, reconciles fetched text in a second live-search audit, separates publication dates from event dates, and returns uncertainty instead of hiding it.

It requires a model that reliably follows tool calls, an authenticated Codex installation, and the user's own quota. v0.1.0 is a preview: the Bridge and authenticated research path are verified, while the tested local models are recorded as negative or incomplete rather than advertised as compatible. It is an unofficial community project.

Source and install instructions:
https://github.com/Zhao73/codex-search-bridge

## Long post

Open models inside Codex can be useful, but “latest” questions expose a hard boundary: the conversational model may support MCP while lacking reliable live-web research of its own.

Codex Search Bridge gives that model one narrow tool: `research_web`.

Behind the tool, the Bridge starts a fresh Codex worker with native live search. The worker runs in a temporary directory, read-only, with user rules and plugins disabled. The Bridge then checks what actually happened:

- Was there a completed live search event?
- Did standard research open a source page through a named evidence channel?
- Did every cited URL match native-open evidence or a successful restricted fetch?
- If the Bridge fetched content directly, did a second live-search worker audit it?
- Are publication, update, event, and retrieval dates separate?
- Which claims remain unconfirmed or conflicting?

If the evidence is missing, the tool fails. A worker saying “I searched” is not enough.

The limit matters: this is designed for external models that reliably call MCP or Codex command tools. It does not add tool calling to a model that lacks it. The first local-model probes did not pass end to end, and the compatibility table says so. It also uses the user's Codex authentication and quota.

Codex Search Bridge is open source under Apache-2.0 and is not an official OpenAI plugin.

Repository:
https://github.com/Zhao73/codex-search-bridge

## Headline alternatives

1. A verified Codex live-search bridge for tool-capable models
2. Real web research for external models inside Codex
3. A verifiable search bridge between your model and Codex
