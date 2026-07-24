# Hacker News launch draft

## Title

Show HN: Codex Search Bridge, verified live-web research for external models in Codex

## Text

I built a local Codex plugin that lets any MCP-capable external model running in Codex Desktop or CLI call Codex native live-web search.

The MCP surface is intentionally small: `research_web` and `doctor`. A research call starts an isolated `codex --search exec` process in a temporary directory with a read-only sandbox, ephemeral state, ignored user rules, and plugins disabled to prevent recursion.

The part I cared about was proof. The server parses Codex JSONL and requires a completed search event. Standard/deep mode also requires an open-page event. It normalizes and matches cited URLs against observed events, keeps publication and event dates separate, and downgrades unsupported claims. If the worker only says it searched, the call fails.

The tradeoffs are explicit. The outer model must support MCP tool calls. The child uses the user's Codex authentication and quota. Account or workspace policy can disable live search. This is an unofficial community project, not an OpenAI plugin.

Apache-2.0 source, architecture, threat model, and cross-platform install instructions:
https://github.com/Zhao73/codex-search-bridge

I would especially value feedback on Codex JSONL compatibility across versions and Windows process-tree handling.
