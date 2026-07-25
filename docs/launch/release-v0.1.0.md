# Codex Search Bridge v0.1.0

An open-source preview of a verified live-web research bridge for tool-capable external models running in Codex Desktop or Codex CLI.

## What ships

- `research_web`: isolated Codex native live search with strict structured output.
- `doctor`: read-only checks for installation, authentication, search evidence, opened pages, and schema validity.
- Evidence counters that separate native Codex page opens, restricted Bridge fetches, content-audit passes, and verified cited sources.
- A DNS-pinned, redirect-revalidating HTTP(S) verifier for cited public pages when Codex does not expose a URL-bearing open event.
- A second isolated live-search audit that reconciles fetched page text and can correct stale “latest” conclusions.
- Cross-platform plugin packaging, bilingual documentation, and an optional CLI-only transport for providers that reject MCP `namespace` tools.

## Install

```bash
codex plugin marketplace add Zhao73/codex-search-bridge
codex plugin add codex-search-bridge@codex-search-bridge
```

Start a new Codex task, then ask the model to call `doctor` before the first research request.

## Verified scope

- macOS 26.1 arm64, Node.js 26.5.0, Codex CLI 0.145.0: authenticated live search, page verification, second-pass audit, and local Marketplace integration.
- GitHub Actions: Windows, macOS, and Ubuntu on Node.js 20 and 22.
- 99 deterministic tests, isolated distribution smoke tests, and zero high-severity npm audit findings at release time.

## Preview limitations

- No external-model end-to-end success is claimed in v0.1.0. The tested 4B local models were negative; a 9B probe was stopped because of unacceptable pressure on a 16 GB host.
- A model must reliably call MCP or Codex command tools. The Bridge cannot create tool-use ability through instructions alone.
- Codex authentication, live-search policy, and user quota are required. Nested research adds latency and consumes that quota.
- Codex Desktop UI and Windows physical-machine flows are not yet recorded as verified.
- CLI-only mode may require network permission for the outer command sandbox; enabling task-wide shell network access has a broader trust impact described in the security guide.

Read the [verification record](https://github.com/Zhao73/codex-search-bridge/tree/v0.1.0/docs/verification), [architecture](https://github.com/Zhao73/codex-search-bridge/blob/v0.1.0/docs/architecture.md), and [security model](https://github.com/Zhao73/codex-search-bridge/blob/v0.1.0/docs/security.md) before relying on it for consequential research.

This is an unofficial community project and is not affiliated with or endorsed by OpenAI. Apache-2.0 licensed.
