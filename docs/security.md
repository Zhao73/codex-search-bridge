# Security model

Codex Search Bridge crosses two trust boundaries: an external model calls a local MCP tool, and an authenticated Codex worker reads hostile public web content.

## Protected assets

- Codex authentication and API configuration;
- current workspace files and conversation context;
- host environment variables and filesystem paths;
- integrity of source URLs, dates, and verification status;
- local CPU, memory, process, and quota capacity.

## Process boundary

The Bridge uses argument-array process creation with `shell=false`. User questions are written to stdin and never interpolated into PowerShell, `cmd.exe`, `/bin/sh`, executable names, CLI flags, paths, or environment values.

The public MCP input cannot override the Codex executable. A local administrator may set `CODEX_SEARCH_BRIDGE_CODEX_BIN` and `CODEX_SEARCH_BRIDGE_MODEL` before starting the plugin. These values are configuration authority, not model-controlled tool arguments.

In CLI-only compatibility mode, the packaged wrapper derives the server path relative to its own installed URL, invokes Node with `shell=false`, and inherits stdin/stdout directly. It accepts exactly one JSON line capped at 16 KiB. The research question and filters never become command-line arguments, executable paths, or environment-variable values; the same strict input schema is applied after parsing. The nested Codex process needs network access, so an outer command sandbox must either receive a per-command network approval or be configured with `sandbox_workspace_write.network_access=true`. The latter grants network access to every shell command in that outer task and should be paired with a trusted model and narrow workspace.

The child inherits only a cross-platform allowlist such as `PATH`, platform system variables, locale, and optional OpenAI API configuration. `HOME`, `USERPROFILE`, `CODEX_HOME`, and all temp variables are replaced with fresh task-local roots. When API-key authentication is absent, only the existing Codex `auth.json` is copied with owner-only permissions. User configuration, Skills, plugins, MCP servers, caches, and arbitrary variables such as `NODE_OPTIONS` are not copied.

## Restricted page fetcher

The fetcher is an evidence adapter for Codex versions that do not expose URL-bearing page-open events. It cannot search and therefore cannot satisfy `web_search_events`.

- Only credential-free `http:` and `https:` URLs on their default ports are accepted.
- DNS results are checked before connection; any local, loopback, link-local, private, multicast, documentation, benchmark, reserved, IPv4-mapped-private, or configured translation range is rejected.
- The validated address is pinned for the connection while the original hostname remains the HTTP Host and TLS SNI name, preventing DNS rebinding between validation and connection.
- Every redirect is resolved and revalidated, with a maximum of five.
- Requests send no Cookie or Authorization header, use identity encoding, time out after ten seconds, and retain at most 512 KiB.
- Only successful HTML, XHTML, plain text, JSON, JSON-LD, or PDF responses count as page evidence. Individual failures remain visible in `limitations`.
- HTML scripts, styles, templates, comments, SVG, and tags are removed; whitespace is compacted and at most 40,000 visible-text characters per page enter the audit prompt. PDF binaries are never decoded into prompt text.

The address policy follows the [IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml), the [IANA IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml), and Node's documented [`BlockList`](https://nodejs.org/api/net.html#class-netblocklist) primitives. The implementation is intentionally conservative for IPv6 and permits only global-unicast space after explicit special-range exclusions.

## Prompt injection

Prompt injection cannot be eliminated from web research. Both the research and audit prompts declare snippets, pages, metadata, fetched excerpts, and embedded content to be untrusted evidence. They forbid following page instructions, executing downloaded code, reading local files, revealing credentials, logging in, or submitting forms.

The caller request is serialized as escaped JSON. `<`, `>`, and `&` are Unicode-escaped so caller text cannot close the request delimiter and visually inject a new XML-like instruction block.

These controls limit actions; they do not guarantee that every web fact is true. Primary-source preference, URL provenance, confidence, independent sources, conflicts, and explicit limitations remain necessary.

## Filesystem and lifecycle

- Each request receives a new system temporary directory.
- The worker uses `--sandbox read-only`.
- The result file and schema path are selected by the Bridge, not by the model.
- Cleanup runs after success, failure, timeout, and cancellation.
- The current project is never selected as child cwd.

## Resource controls

- At most two workers run concurrently.
- At most eight requests wait in the local queue.
- Default timeouts are 90 seconds (`quick`), 180 seconds (`standard`), and 300 seconds (`deep`).
- stdout is capped at 8 MiB and stderr at 1 MiB.
- Cancellation terminates the process tree, with a forced fallback.

## Logs and errors

MCP protocol frames are the only stdout output. Operational messages use stderr. Public errors expose stable codes and safe remediation, not worker stderr, stack traces, bearer credentials, API keys, or full home paths.

`doctor` reports versions, booleans, counters, timestamps, and remediation text. It never returns token contents, raw environment values, or complete worker stderr.

## Known limitations

- A tool-capable model can still call the tool with a poor research question.
- Codex or account policy can disable Web Search.
- Pages behind authentication, payment, anti-bot controls, region restrictions, or outages may be inaccessible.
- Event schemas can change; unknown events fail conservatively.
- URL observation or a successful restricted fetch proves page access and provenance, not that every statement on that page is accurate.
- Nested Codex work consumes user quota and adds latency.
- Provider protocol support and model behavior are separate: compatibility mode can avoid unsupported MCP `namespace` tools, but cannot force an outer model to invoke ordinary command tools.
- The Claude search provider runs with the user's real `HOME` because Claude Code cannot authenticate without it. It is confined by `--strict-mcp-config`, `--setting-sources ""`, a two-tool allowlist, and a throwaway working directory, so it cannot run shell commands or edit files — but it is not process-isolated to the same degree as the Codex worker, and it can read files the user's account can read if a future tool allowlist change ever permits it.
- The Tavily search provider sends the research question to a third party. Results are filtered through the same scheme, credential, and port policy as the restricted fetcher, and literal private or loopback IP hosts are dropped before any fetch, but the question itself leaves the machine.
- The `search_api` evidence tier proves that URLs were returned and opened. It does not prove any model read them, so it can never report `verified`.

Report vulnerabilities through the private process in [../SECURITY.md](../SECURITY.md).
