# Contributing

Contributions are welcome when they preserve conservative evidence semantics.

## Setup

```bash
npm ci
npm run check
```

Node 20 and 22 are supported. Do not add a runtime dependency when a small standard-library module is sufficient.

## Required workflow

1. Add a failing test or sanitized raw fixture.
2. Run that focused test and record the expected failure.
3. Make the smallest implementation change.
4. Run the focused test, `npm run check`, and `npm audit --audit-level=high`.
5. Explain changes to evidence, privacy, compatibility, or quota behavior in the pull request.

Parser changes must include the original event shape with secrets, account identifiers, and private content removed. Unknown events may not be counted as search or open-page proof until their semantics are established.

Never weaken these invariants merely to make a new Codex version pass:

- a completed search event is mandatory;
- standard/deep work requires open-page proof;
- source provenance needs a conservative URL match;
- unsupported claims may be downgraded but not silently upgraded;
- conflicts and limitations remain visible;
- stdout remains reserved for MCP.

Real live-search tests require the maintainer's own Codex authentication and quota. Ordinary pull-request CI uses the deterministic fake worker.
