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

The child inherits an allowlist needed for cross-platform startup and authentication, including `PATH`, platform temp/system variables, `HOME`/`USERPROFILE`, optional `CODEX_HOME`, and optional OpenAI API configuration. It does not inherit arbitrary variables such as `NODE_OPTIONS`.

## Prompt injection

Prompt injection cannot be eliminated from web research. The fixed worker prompt declares snippets, pages, metadata, and embedded content to be untrusted evidence. It forbids following page instructions, executing downloaded code, reading local files, revealing credentials, logging in, or submitting forms.

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
- URL observation proves that Codex accessed a URL, not that every statement on that page is accurate.
- Nested Codex work consumes user quota and adds latency.

Report vulnerabilities through the private process in [../SECURITY.md](../SECURITY.md).
