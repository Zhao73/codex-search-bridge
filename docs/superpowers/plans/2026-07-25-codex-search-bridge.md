# Codex Search Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, brand, and publicly release a cross-platform Codex plugin that lets any MCP-capable external model invoke an isolated Codex live-web research worker and return evidence-checked sources, dates, conflicts, and uncertainties to the current conversation.

**Architecture:** A local stdio MCP server exposes `research_web` and `doctor`. `research_web` validates a deliberately small input, starts an isolated `codex --search exec` process, parses JSONL search/open-page evidence, validates structured output against a JSON Schema, and returns a verification-enriched result. A bundled Skill tells the current external model when to call the tool and how to render verified research in the current Codex conversation.

**Tech Stack:** Node.js 20+, TypeScript, `@modelcontextprotocol/sdk`, Zod, `cross-spawn`, Vitest, tsup, GitHub Actions, Codex CLI 0.145.0 baseline, SVG promotional assets, Apache-2.0.

---

## File map

The implementation uses focused modules with stable boundaries:

- `package.json`: scripts, runtime dependencies, engines, package metadata.
- `tsconfig.json`: strict TypeScript configuration.
- `tsup.config.ts`: single-file ESM build configuration.
- `vitest.config.ts`: deterministic unit/integration test configuration.
- `src/contracts.ts`: public Zod inputs, result types, JSON Schema-compatible contracts.
- `src/errors.ts`: stable public error codes and redacted MCP error conversion.
- `src/time-window.ts`: date/recency intersection validation.
- `src/url-evidence.ts`: URL normalization and observed-source matching.
- `src/jsonl-events.ts`: version-tolerant Codex JSONL parsing.
- `src/verifier.ts`: evidence and claim verification rules.
- `src/research-prompt.ts`: fixed prompt that treats web content as untrusted evidence.
- `src/codex-process.ts`: cross-platform child-process execution, timeout, cancellation, limits.
- `src/research-runner.ts`: temp workspace, Codex arguments, structured result loading, cleanup.
- `src/doctor.ts`: read-only environment and live-search diagnostic checks.
- `src/server.ts`: stdio MCP server and tool registration.
- `schemas/research-result.schema.json`: schema passed to `codex exec --output-schema`.
- `tests/fixtures/fake-codex.mjs`: deterministic fake Codex JSONL producer.
- `tests/*.test.ts`: unit and integration coverage.
- `scripts/build-plugin.mjs`: copy the bundled server and schema into the plugin.
- `scripts/check-dist.mjs`: fail when committed plugin artifacts differ from a clean build.
- `plugins/codex-search-bridge/.codex-plugin/plugin.json`: distributable plugin manifest.
- `plugins/codex-search-bridge/.mcp.json`: local stdio MCP declaration if required by the current plugin schema.
- `plugins/codex-search-bridge/skills/verified-web-research/SKILL.md`: trigger and rendering workflow.
- `plugins/codex-search-bridge/skills/verified-web-research/agents/openai.yaml`: skill discovery metadata.
- `.agents/plugins/marketplace.json`: Git marketplace index.
- `.github/workflows/ci.yml`: Windows/macOS/Linux verification matrix.
- `.github/workflows/release.yml`: tagged release artifact verification.
- `README.md`, `README.zh-CN.md`: public installation, usage, compatibility, proof, limitations.
- `docs/architecture.md`, `docs/security.md`, `CONTRIBUTING.md`, `SECURITY.md`: maintainership documentation.
- `assets/hero.svg`, `assets/social-card.svg`, `assets/social-card.png`: public visual identity.
- `docs/launch/`: English, Chinese, Hacker News, and Reddit launch copy.

### Task 1: Toolchain and deterministic package skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `LICENSE`
- Test: `tests/smoke.test.ts`

- [x] **Step 1: Create the package manifest and lock current dependency versions**

Use `npm view <package> version` to record current stable versions, then create scripts with these exact behaviors:

```json
{
  "name": "codex-search-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsup && node scripts/build-plugin.mjs",
    "check": "npm run typecheck && npm run test && npm run build && node scripts/check-dist.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "doctor": "node plugins/codex-search-bridge/dist/server.mjs --doctor"
  }
}
```

Install `@modelcontextprotocol/sdk`, `zod`, and `cross-spawn` as runtime dependencies. Install `@types/cross-spawn`, `@types/node`, `typescript`, `tsup`, `tsx`, `vitest`, and `sharp` as development dependencies. Commit `package-lock.json`.

- [x] **Step 2: Create strict compiler, build, and test configuration**

Use ESM, NodeNext resolution, `strict: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`. Build `src/server.ts` to `dist/server.mjs`, bundle runtime dependencies, emit no source maps in the distributable plugin, and run tests in Node environment with a 10-second default timeout.

- [x] **Step 3: Write the initial failing smoke test**

```ts
import { describe, expect, it } from "vitest";
import { PROJECT_NAME } from "../src/contracts.js";

describe("package skeleton", () => {
  it("exports the public project name", () => {
    expect(PROJECT_NAME).toBe("Codex Search Bridge");
  });
});
```

- [x] **Step 4: Run the smoke test and verify the expected failure**

Run: `npm test -- tests/smoke.test.ts`

Expected: FAIL because `src/contracts.ts` does not exist.

- [x] **Step 5: Add the minimal contracts module and Apache-2.0 license**

```ts
export const PROJECT_NAME = "Codex Search Bridge" as const;
export const PROJECT_VERSION = "0.1.0" as const;
```

Add the unmodified Apache License 2.0 text with copyright `2026 ChouJ`.

- [x] **Step 6: Run the smoke test and commit**

Run: `npm test -- tests/smoke.test.ts`

Expected: 1 test passes.

Commit:

```bash
git add package.json package-lock.json tsconfig.json tsup.config.ts vitest.config.ts .gitignore LICENSE src/contracts.ts tests/smoke.test.ts
git commit -m "chore: bootstrap Codex Search Bridge"
```

### Task 2: Public contracts, input validation, and time windows

**Files:**
- Modify: `src/contracts.ts`
- Create: `src/errors.ts`
- Create: `src/time-window.ts`
- Create: `schemas/research-result.schema.json`
- Test: `tests/contracts.test.ts`
- Test: `tests/time-window.test.ts`

- [x] **Step 1: Write failing contract tests**

Cover these exact cases:

```ts
expect(() => ResearchWebInputSchema.parse({ question: "" })).toThrow();
expect(() => ResearchWebInputSchema.parse({ question: "x", max_sources: 2 })).toThrow();
expect(() => ResearchWebInputSchema.parse({ question: "x", max_sources: 13 })).toThrow();
expect(ResearchWebInputSchema.parse({ question: " latest release ", depth: "standard" }).question)
  .toBe("latest release");
expect(() => ResearchWebInputSchema.parse({ question: "x", date_from: "2026-02-30" })).toThrow();
```

Also validate a complete `ResearchResult` with `confirmed`, `partially_confirmed`, `unconfirmed`, and `conflicting` claims.

- [x] **Step 2: Run contract tests and verify failure**

Run: `npm test -- tests/contracts.test.ts`

Expected: FAIL with missing schema exports.

- [x] **Step 3: Implement Zod contracts and stable error codes**

Define and export:

```ts
export const DepthSchema = z.enum(["quick", "standard", "deep"]);
export const VerificationStatusSchema = z.enum([
  "confirmed",
  "partially_confirmed",
  "unconfirmed",
  "conflicting"
]);
export const ConfidenceSchema = z.enum(["high", "moderate", "low", "unknown"]);
```

`ResearchWebInputSchema` must enforce question length 1–8,000, recency 1–8,760, source count 3–12, strict ISO calendar dates, BCP-47-like language tags, and default values `max_sources=6`, `depth="standard"`.

`BridgeError` must expose only these public codes: `INVALID_INPUT`, `CODEX_NOT_FOUND`, `CODEX_AUTH_REQUIRED`, `WEB_SEARCH_UNAVAILABLE`, `WORKER_TIMEOUT`, `WORKER_CANCELLED`, `WORKER_FAILED`, `OUTPUT_LIMIT_EXCEEDED`, `INVALID_STRUCTURED_OUTPUT`, `EVIDENCE_VERIFICATION_FAILED`, and `QUEUE_FULL`.

- [x] **Step 4: Write failing time-window tests**

```ts
expect(resolveTimeWindow({ question: "x", date_from: "2026-07-01", date_to: "2026-07-25" }, now))
  .toEqual({ from: "2026-07-01", to: "2026-07-25" });
expect(resolveTimeWindow({ question: "x", recency_hours: 24 }, new Date("2026-07-25T12:00:00Z")))
  .toEqual({ fromInstant: "2026-07-24T12:00:00.000Z", toInstant: "2026-07-25T12:00:00.000Z" });
expect(() => resolveTimeWindow({ question: "x", date_from: "2026-07-25", date_to: "2026-07-01" }, now))
  .toThrowError(/INVALID_INPUT/);
```

- [x] **Step 5: Implement time-window intersection and JSON Schema**

Use UTC instants for `recency_hours`, calendar dates for explicit date bounds, and reject an empty intersection. Add a strict Draft 2020-12 schema for the worker result: all top-level properties required except optional query filters; `additionalProperties: false` at every object boundary; RFC 3339 formats for instants; explicit enums for statuses.

- [x] **Step 6: Run tests, validate the schema, and commit**

Run: `npm test -- tests/contracts.test.ts tests/time-window.test.ts && npm run typecheck`

Expected: all tests pass and TypeScript reports no errors.

Commit:

```bash
git add src/contracts.ts src/errors.ts src/time-window.ts schemas/research-result.schema.json tests/contracts.test.ts tests/time-window.test.ts
git commit -m "feat: define verified research contracts"
```

### Task 3: JSONL evidence parsing, URL provenance, and claim verification

**Files:**
- Create: `src/jsonl-events.ts`
- Create: `src/url-evidence.ts`
- Create: `src/verifier.ts`
- Test: `tests/jsonl-events.test.ts`
- Test: `tests/url-evidence.test.ts`
- Test: `tests/verifier.test.ts`
- Create: `tests/fixtures/events/*.jsonl`

- [x] **Step 1: Write failing JSONL parser tests**

Fixtures must include search, `open_page`, malformed line, unknown event, final message, and process error cases. Assert:

```ts
const evidence = parseCodexJsonl(fixture);
expect(evidence.webSearchEvents).toBe(1);
expect(evidence.openedPageEvents).toBe(2);
expect(evidence.observedUrls).toContain("https://example.com/news/launch");
expect(evidence.unknownEventTypes).toEqual(["future.event"]);
```

Malformed non-empty JSONL must raise `WORKER_FAILED`; unknown well-formed event types must be preserved for diagnostics and never counted as proof.

- [x] **Step 2: Implement the streaming parser**

Expose `CodexEvidence` with counters, observed URLs, queries, unknown types, final message text, and sanitized error summaries. Parse one line at a time so the runner can enforce byte limits without buffering unbounded output.

- [x] **Step 3: Write failing URL normalization tests**

Verify host casing, default ports, fragments, `utm_*`, `gclid`, and trailing-slash behavior. Do not strip semantic query parameters.

```ts
expect(normalizeEvidenceUrl("HTTPS://Example.COM:443/a/?utm_source=x#top"))
  .toBe("https://example.com/a");
expect(urlsMatch("https://example.com/story?id=7", "https://example.com/story?id=8"))
  .toBe(false);
```

- [x] **Step 4: Implement provenance matching**

Return exact normalized matches first. Support redirects only through an explicit observed redirect map; never infer equivalence from matching domains alone.

- [x] **Step 5: Write failing verifier tests**

Cover:

- zero search events -> `EVIDENCE_VERIFICATION_FAILED`;
- standard/deep without opened pages -> failed;
- all cited URLs unmatched -> failed;
- some matched URLs -> partial;
- all matched URLs and supported claims -> verified;
- claims that cite unknown sources -> downgraded to unconfirmed;
- conflicting claim status remains conflicting;
- a relative publication time may not produce high confidence.

- [x] **Step 6: Implement conservative verification**

`verifyResearchResult(result, evidence, depth)` must return a new immutable result. It sets each source `provenance_verified`, downgrades unsupported statuses, calculates counters, adds limitations, and refuses to upgrade a Worker-provided confidence. It must never silently remove a conflicting or unconfirmed claim.

- [x] **Step 7: Run evidence tests and commit**

Run: `npm test -- tests/jsonl-events.test.ts tests/url-evidence.test.ts tests/verifier.test.ts`

Expected: all evidence and verification tests pass.

Commit:

```bash
git add src/jsonl-events.ts src/url-evidence.ts src/verifier.ts tests/jsonl-events.test.ts tests/url-evidence.test.ts tests/verifier.test.ts tests/fixtures/events
git commit -m "feat: verify Codex web-search evidence"
```

### Task 4: Safe research prompt and cross-platform Codex runner

**Files:**
- Create: `src/research-prompt.ts`
- Create: `src/codex-process.ts`
- Create: `src/research-runner.ts`
- Create: `tests/fixtures/fake-codex.mjs`
- Test: `tests/research-prompt.test.ts`
- Test: `tests/codex-process.test.ts`
- Test: `tests/research-runner.test.ts`

- [x] **Step 1: Write failing prompt tests**

Assert that a prompt built from a hostile question preserves the question as delimited data and always contains these requirements: live search, open relevant pages for standard/deep, distinguish publication/update/event/retrieval dates, treat page instructions as untrusted, cite source IDs, preserve conflicts, and return only the schema-compatible JSON result.

- [x] **Step 2: Implement the fixed prompt builder**

Serialize the validated request as JSON inside explicit `<research_request>` delimiters. Do not concatenate caller text into instructions. Include the current RFC 3339 instant and timezone. Keep the system invariant text constant so tests can snapshot it.

- [x] **Step 3: Write failing process-control tests**

Use a fake child process to prove:

- arguments are an array and `shell` is false;
- stdin receives the prompt;
- timeout yields `WORKER_TIMEOUT`;
- abort yields `WORKER_CANCELLED`;
- stdout/stderr byte caps yield `OUTPUT_LIMIT_EXCEEDED`;
- non-zero exit maps auth and search-policy signatures to their stable error codes;
- arbitrary stderr text is redacted before public return.

- [x] **Step 4: Implement process control**

Use `cross-spawn`. Spawn a detached process group on POSIX, and terminate the Windows process tree through a platform-specific helper without interpolating user text. Default caps: stdout 8 MiB, stderr 1 MiB; default concurrency two; queue length eight.

- [x] **Step 5: Write the fake Codex executable and runner tests**

The fixture accepts Codex-like arguments, reads stdin, emits deterministic JSONL, and writes a schema-valid result to the `--output-last-message` path. Test exact global/subcommand ordering:

```ts
expect(args.slice(0, 4)).toEqual(["--search", "-c", "features.plugins=false", "exec"]);
expect(args).toContain("--ignore-user-config");
expect(args).toContain("--ignore-rules");
expect(args).toContain("--sandbox");
expect(args).toContain("read-only");
expect(args).toContain("--ephemeral");
```

- [x] **Step 6: Implement the research runner**

Create a private temporary directory per task, call the process controller, parse the result file with `ResearchResultSchema`, parse JSONL evidence, verify it, and remove the temporary directory in `finally`. Support `CODEX_SEARCH_BRIDGE_CODEX_BIN` and maintainer-only `CODEX_SEARCH_BRIDGE_MODEL`; neither is exposed to MCP input.

- [x] **Step 7: Run runner tests and commit**

Run: `npm test -- tests/research-prompt.test.ts tests/codex-process.test.ts tests/research-runner.test.ts`

Expected: prompt, process, cleanup, timeout, and result-verification tests pass on the current platform.

Commit:

```bash
git add src/research-prompt.ts src/codex-process.ts src/research-runner.ts tests/research-prompt.test.ts tests/codex-process.test.ts tests/research-runner.test.ts tests/fixtures/fake-codex.mjs
git commit -m "feat: run isolated Codex research workers"
```

### Task 5: MCP server and environment doctor

**Files:**
- Create: `src/doctor.ts`
- Create: `src/server.ts`
- Test: `tests/doctor.test.ts`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Write failing doctor tests**

Inject command and runner dependencies. Verify supported Node, Codex not found, parsed Codex version, auth failure, live-search evidence failure, and a fully healthy result. Assert no doctor output contains `OPENAI_API_KEY`, bearer tokens, home-directory contents, or full stderr.

- [ ] **Step 2: Implement doctor checks**

Return a structured object with `status: healthy|degraded|failed`, Node version, Codex version, CLI discovery, authentication result, live-search evidence result, structured-output result, and an ordered list of safe remediation messages. The live check uses a minimal query and the same evidence verifier as `research_web`.

- [ ] **Step 3: Write failing MCP protocol tests**

Use the SDK `Client` with `StdioClientTransport` to launch `src/server.ts` through the locally installed `tsx` executable. Assert tool listing exposes exactly `research_web` and `doctor`, invalid input returns `INVALID_INPUT`, a successful research call returns structured content, and logs never contaminate stdout protocol frames.

- [ ] **Step 4: Implement the stdio MCP server**

Register both tools with Zod-derived input schemas. Send operational logs only to stderr. Add `--doctor` CLI mode that prints the same safe doctor JSON and exits 0 only when healthy. Convert `BridgeError` to machine-readable MCP error content without exposing stack traces by default.

- [ ] **Step 5: Run MCP tests and commit**

Run: `npm test -- tests/doctor.test.ts tests/server.test.ts && npm run typecheck`

Expected: doctor and MCP protocol tests pass without stdout contamination.

Commit:

```bash
git add src/doctor.ts src/server.ts tests/doctor.test.ts tests/server.test.ts
git commit -m "feat: expose verified research over MCP"
```

### Task 6: Build artifact, Codex plugin, marketplace, and Skill

**Files:**
- Create: `scripts/build-plugin.mjs`
- Create: `scripts/check-dist.mjs`
- Create: `plugins/codex-search-bridge/.codex-plugin/plugin.json`
- Create: `plugins/codex-search-bridge/.mcp.json`
- Create: `plugins/codex-search-bridge/skills/verified-web-research/SKILL.md`
- Create: `plugins/codex-search-bridge/skills/verified-web-research/agents/openai.yaml`
- Create: `.agents/plugins/marketplace.json`
- Test: `tests/plugin-package.test.ts`

- [ ] **Step 1: Inspect current official plugin schemas before authoring manifests**

Read the complete local `plugin-creator` and `skill-creator` instructions and current official Codex plugin docs. Inspect at least one installed plugin with an MCP server. Record the exact current manifest keys in the test fixture; do not guess between `.mcp.json`, embedded `mcpServers`, and `mcp_servers`.

- [ ] **Step 2: Write failing package validation tests**

Assert plugin name/version/description, server entry path, bundled schema existence, skill discovery metadata, marketplace source path, executable build presence, and that every declared relative path stays inside the plugin directory.

- [ ] **Step 3: Implement build and dist consistency scripts**

`build-plugin.mjs` copies `dist/server.mjs` and `schemas/research-result.schema.json` into the plugin. `check-dist.mjs` builds into a temporary directory and byte-compares distributable files to committed artifacts, returning a non-zero exit on drift.

- [ ] **Step 4: Author the plugin and marketplace manifests**

Use the current validated schema. The stdio server command must invoke Node with a plugin-root-relative bundled `dist/server.mjs`. Declare no network API key or OAuth connector because the child Codex process uses the user's existing Codex authentication.

- [ ] **Step 5: Author the verified web research Skill**

The Skill must require `research_web` for explicit searches and unstable facts, state the tool-capability limitation, render inline links, distinguish all four date fields, display `as_of`, preserve conflicts, list unconfirmed information, and state when no real search evidence exists. Keep instructions concise enough for weaker local models.

- [ ] **Step 6: Validate skill metadata and build the plugin**

Run the validation scripts supplied by `skill-creator`, then:

Run: `npm run build && npm test -- tests/plugin-package.test.ts && node scripts/check-dist.mjs`

Expected: built artifact exists, package tests pass, and dist consistency check returns 0.

- [ ] **Step 7: Install from the local marketplace and test discovery**

Use the exact current `codex plugin marketplace add` and `codex plugin add` syntax shown by `--help`. Verify `codex plugin list` shows `codex-search-bridge` enabled, and inspect the installed snapshot rather than assuming the source folder is used directly.

- [ ] **Step 8: Commit**

```bash
git add scripts plugins .agents package.json package-lock.json tests/plugin-package.test.ts
git commit -m "feat: package Codex Search Bridge plugin"
```

### Task 7: Public documentation, security guidance, and CI

**Files:**
- Create: `README.md`
- Create: `README.zh-CN.md`
- Create: `docs/architecture.md`
- Create: `docs/security.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Test: `tests/docs.test.ts`

- [ ] **Step 1: Write failing documentation tests**

Assert both READMEs contain: community/unofficial notice, MCP-capable model limitation, Codex auth/quota requirement, Windows/macOS instructions, verified current install commands, `doctor`, live-search proof explanation, date semantics, privacy model, uninstall instructions, and links to architecture/security docs.

- [ ] **Step 2: Write English and Chinese READMEs from actual local commands**

Run each published command locally before including it. Use a five-minute Quick Start, a compatibility table with `tested`, `CI-tested`, and `unverified` states, one verified sample result, troubleshooting by stable error code, and no unconditional “any model” claim.

- [ ] **Step 3: Write architecture and security documents**

Document the child-process boundary, event-proof algorithm, URL matching, prompt-injection model, data sent to Codex, temporary-file lifecycle, quota/latency implications, responsible disclosure, and explicit non-goals.

- [ ] **Step 4: Add contribution and security policy**

Require tests for new Codex event shapes, fixtures for parser changes, no secrets in issues, and private vulnerability reporting through GitHub's security advisory flow.

- [ ] **Step 5: Add CI and release workflows**

CI matrix: `macos-latest`, `windows-latest`, `ubuntu-latest` with Node 20 and 22; run `npm ci`, `npm run check`, and plugin package validation. Release workflow triggers on `v*`, rebuilds, checks dist drift, packages the plugin directory, generates checksums, and attaches them to the GitHub release without publishing npm.

- [ ] **Step 6: Run documentation and full local checks**

Run: `npm test -- tests/docs.test.ts && npm run check`

Expected: documentation requirements and all previous tests pass.

- [ ] **Step 7: Commit**

```bash
git add README.md README.zh-CN.md docs/architecture.md docs/security.md CONTRIBUTING.md SECURITY.md .github tests/docs.test.ts
git commit -m "docs: add cross-platform setup and security guide"
```

### Task 8: Visual identity and launch materials

**Files:**
- Create: `assets/hero.svg`
- Create: `assets/social-card.svg`
- Create: `assets/social-card.png`
- Create: `scripts/render-assets.mjs`
- Create: `docs/launch/launch-en.md`
- Create: `docs/launch/launch-zh-CN.md`
- Create: `docs/launch/hacker-news.md`
- Create: `docs/launch/reddit.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Test: `tests/assets.test.ts`

- [ ] **Step 1: Load the required visual workflow skills**

Read `design-taste-frontend` and `impeccable` completely enough to follow their routed visual-quality, accessibility, typography, and anti-template rules. Read `copywriting` before writing launch copy. Do not use OpenAI logos or imply official affiliation.

- [ ] **Step 2: Define the visual direction**

Use a restrained dark technical identity: near-black background, warm off-white text, one electric-cyan accent, monospaced evidence labels, and an architecture motif that visually connects external model → verified bridge → live web. Avoid generic purple AI gradients, glowing brain icons, fake dashboards, and illegible terminal screenshots.

- [ ] **Step 3: Create responsive SVG hero and social card**

The hero must remain legible at 640px width, include the project name, one-line value proposition, and an “Unofficial community project” marker. The 1200×630 card must preserve safe margins for social cropping and pass contrast checks.

- [ ] **Step 4: Render and inspect the PNG**

Create `scripts/render-assets.mjs` using `sharp`, render `assets/social-card.svg` to an exact 1200×630 PNG, and strip variable timestamp metadata. Inspect the PNG at original resolution and verify text is not clipped, the community label is visible, and no copyrighted third-party logos appear.

- [ ] **Step 5: Write truthful launch copy**

English and Chinese posts must demonstrate: actual live search event, opened page evidence, publication/event date separation, source links, and unconfirmed labeling. Hacker News and Reddit versions lead with the technical mechanism and limitations, not hype. Every performance or compatibility statement must point to test evidence.

- [ ] **Step 6: Add asset tests and README visuals**

Assert SVG dimensions/viewBox, accessible `<title>`/`<desc>`, required community label, PNG dimensions, and absence of `OpenAI logo`/`official plugin` claims. Embed the SVG hero with useful alt text in both READMEs.

- [ ] **Step 7: Run tests and commit**

Run: `npm test -- tests/assets.test.ts && npm run check`

Expected: asset validation and all checks pass.

Commit:

```bash
git add assets docs/launch README.md README.zh-CN.md tests/assets.test.ts
git commit -m "docs: add visual identity and launch kit"
```

### Task 9: Real Codex and external-model verification

**Files:**
- Create: `docs/verification/2026-07-25-macos.md`
- Create: `docs/verification/sample-result.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Run the full clean verification suite**

Run:

```bash
npm ci
npm run check
git status --short
```

Expected: all tests/build checks pass and the only changes are intentional verification artifacts created after this command.

- [ ] **Step 2: Run the real doctor**

Run the bundled server's `--doctor` mode with the authenticated Codex 0.145.0 installation. Capture only sanitized status, versions, event counts, timestamps, and error codes.

- [ ] **Step 3: Run a time-sensitive real research query**

Choose a public event from the last 24 hours. Require `standard` depth. Save the structured result and verify manually that source URLs open, publication dates exist when claimed, event dates are independently supported, and unconfirmed facts are not presented as confirmed.

- [ ] **Step 4: Verify JSONL evidence independently**

Confirm at least one live `web_search` event, at least one open-page action, and source URL intersection. Record exact counts and the retrieval time in the verification document.

- [ ] **Step 5: Verify current-conversation behavior with an external model**

Run Codex CLI using one configured external model known to support MCP tools. Ask it for the same current event without explicitly naming the tool. Verify it invokes `research_web` and renders the result in the current conversation with inline sources, dates, `as_of`, and an uncertainty section. If no compatible external model is locally configured, document this item as unverified and do not claim it publicly; continue with all other work.

- [ ] **Step 6: Re-run checks and commit evidence**

Run: `npm run check`

Expected: full suite passes after adding sanitized evidence.

Commit:

```bash
git add docs/verification README.md README.zh-CN.md
git commit -m "test: document verified live-search workflow"
```

### Task 10: GitHub publication and v0.1.0 release

**Files:**
- Modify if necessary: repository metadata and release notes
- Create through GitHub: public repository, Actions runs, v0.1.0 release

- [ ] **Step 1: Audit every acceptance criterion against authoritative evidence**

Create a checklist from section 16 of the design specification. For each item, link a test, command output, installed plugin state, verification document, rendered asset, or public GitHub state. Any unsupported item remains incomplete and must be fixed or explicitly narrowed in public compatibility claims.

- [ ] **Step 2: Verify GitHub authentication and repository-name availability**

Run: `gh auth status` and `gh repo view <authenticated-owner>/codex-search-bridge`.

Expected: authenticated account identified. If the repository does not exist, create it; if it exists and is unrelated, stop before overwriting and use `codex-web-search-bridge` only after confirming the collision.

- [ ] **Step 3: Create the public repository and push main**

Use non-interactive GitHub CLI with description `Give any tool-capable model in Codex verified live-web research.` Add topics `codex`, `mcp`, `web-search`, `open-source`, `local-llm`, and `ai-agents`. Set the repository homepage only if a real project page exists.

- [ ] **Step 4: Wait for and inspect GitHub Actions**

Use `gh run list` and `gh run watch`. If any matrix job fails, inspect logs, reproduce locally when possible, fix, recommit, and push. Do not treat a partial green matrix as success.

- [ ] **Step 5: Tag and publish v0.1.0**

After main CI is fully green, create signed or annotated tag `v0.1.0`, push it, verify the release workflow, and publish release notes containing install commands, verified platforms, known limitations, checksums, and the community-project notice.

- [ ] **Step 6: Verify the public repository as a new user would**

Open the public GitHub page, inspect rendered README/hero/social preview, clone into a fresh temporary directory, follow the published installation steps, run `doctor`, and ensure the release artifact matches its checksum. Check that no secrets, local absolute paths, private emails in docs, or unredacted logs are present.

- [ ] **Step 7: Publish the prepared launch text and report exact state**

The repository and GitHub release are authorized external writes. Publishing to third-party communities is not implied by “GitHub 公开发布”; keep Hacker News/Reddit/other posts as ready-to-use drafts unless separately authorized. Report the repository URL, release URL, CI result, live-search evidence, verified platforms, unverified external-model/platform items, and exact commit/tag.

- [ ] **Step 8: Mark the persistent goal complete only after the audit passes**

Run a final `git status`, test suite, GitHub Actions check, public clone smoke test, and requirement-by-requirement audit. Call `update_goal(status="complete")` only if coding, tests, visual promotion, public repository, and release are all proven complete.
