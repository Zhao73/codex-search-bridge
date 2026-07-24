# Security policy

## Supported versions

Security fixes are applied to the latest tagged `0.x` release. Before a stable `1.0.0`, users should upgrade to the newest release rather than expecting backports.

## Report privately

Do not open a public issue for vulnerabilities, credential exposure, command injection, path traversal, unsafe process termination, prompt-injection escalation, or evidence-verification bypass.

Use the repository's **GitHub Security Advisory** “Report a vulnerability” flow. Include:

- affected version and operating system;
- minimum reproduction without real credentials;
- expected and observed security boundary;
- whether a malicious model, tool input, webpage, or local configuration is required;
- sanitized logs or fixtures.

Do not include API keys, Codex tokens, private conversation content, or unredacted home paths.

The maintainer will acknowledge a complete report through the private advisory. Public disclosure and attribution are coordinated after a fix or mitigation is available.
