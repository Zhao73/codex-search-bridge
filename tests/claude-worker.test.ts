import { describe, expect, it } from "vitest";

import {
  buildClaudeArgs,
  extractJsonObject,
  extractSearchResultUrls,
  parseClaudeStream,
  stripClaudeRedirects,
} from "../src/claude-worker.js";
import { BridgeError } from "../src/errors.js";

function streamLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function assistantToolUse(name: string, input: unknown, id: string): string {
  return streamLine({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
}

describe("buildClaudeArgs", () => {
  it("loads no MCP servers so the Bridge cannot recurse into itself", () => {
    const args = buildClaudeArgs({ cwd: "/tmp/task", maxTurns: 12 });
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--mcp-config");
    // `--bare` disables OAuth and keychain auth, which breaks subscription
    // users, so it must never be added back as a shortcut for isolation.
    expect(args).not.toContain("--bare");
  });

  it("allows only the two read-only web tools", () => {
    const args = buildClaudeArgs({ cwd: "/tmp/task", maxTurns: 12 });
    const allowedIndex = args.indexOf("--allowedTools");
    expect(args.slice(allowedIndex + 1, allowedIndex + 3)).toEqual([
      "WebSearch",
      "WebFetch",
    ]);
    expect(args).toContain("--disallowedTools");
    expect(args).toContain("Bash");
  });
});

describe("stripClaudeRedirects", () => {
  it("drops gateway redirects and the gateway key", () => {
    const result = stripClaudeRedirects({
      ANTHROPIC_BASE_URL: "https://mallowapi.com/v1",
      ANTHROPIC_AUTH_TOKEN: "gateway-token",
      ANTHROPIC_API_KEY: "gateway-key",
      PATH: "/usr/bin",
    });

    expect(result.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(result.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.PATH).toBe("/usr/bin");
  });

  it("keeps a real Anthropic key when no gateway is configured", () => {
    const result = stripClaudeRedirects({ ANTHROPIC_API_KEY: "real-key" });
    expect(result.ANTHROPIC_API_KEY).toBe("real-key");
  });

  it("strips redirects regardless of case, as Windows env names allow", () => {
    // Windows treats environment variable names case-insensitively and keeps
    // whatever case was set (`Path` is the classic example). A case-sensitive
    // delete would leak the gateway token to the real Anthropic endpoint.
    const result = stripClaudeRedirects({
      Anthropic_Base_Url: "https://mallowapi.com/v1",
      anthropic_auth_token: "gateway-token",
      AnThRoPiC_ApI_kEy: "gateway-key",
      Path: "C:\\Windows\\System32",
    });

    const remaining = Object.keys(result).map((key) => key.toLowerCase());
    expect(remaining).not.toContain("anthropic_base_url");
    expect(remaining).not.toContain("anthropic_auth_token");
    expect(remaining).not.toContain("anthropic_api_key");
    expect(JSON.stringify(result)).not.toContain("gateway-token");
    expect(JSON.stringify(result)).not.toContain("gateway-key");
    // Unrelated variables keep their original casing.
    expect(result.Path).toBe("C:\\Windows\\System32");
  });

  it("keeps a mixed-case real key when no gateway is present", () => {
    const result = stripClaudeRedirects({ Anthropic_Api_Key: "real-key" });
    expect(JSON.stringify(result)).toContain("real-key");
  });
});

describe("extractSearchResultUrls", () => {
  it("reads the Links array Claude embeds in the tool result text", () => {
    const content =
      'Web search results for query: "node lts"\n\n' +
      'Links: [{"title":"A","url":"https://a.example/1"},{"title":"B","url":"https://b.example/2"}]\n\n' +
      "Based on the results...";
    expect(extractSearchResultUrls(content)).toEqual([
      "https://a.example/1",
      "https://b.example/2",
    ]);
  });

  it("returns nothing for unparseable or absent link blocks", () => {
    expect(extractSearchResultUrls("no links here")).toEqual([]);
    expect(extractSearchResultUrls("Links: [not json]\n\n")).toEqual([]);
  });
});

describe("extractJsonObject", () => {
  it("accepts a bare object and a fenced object", () => {
    expect(extractJsonObject('{"answer":"x"}')).toEqual({ answer: "x" });
    expect(
      extractJsonObject('Here you go:\n```json\n{"answer":"y"}\n```'),
    ).toEqual({ answer: "y" });
  });

  it("throws when no JSON object is present", () => {
    try {
      extractJsonObject("I could not complete the research.");
      expect.unreachable("plain prose must throw");
    } catch (error) {
      expect((error as BridgeError).code).toBe("INVALID_STRUCTURED_OUTPUT");
    }
  });
});

describe("parseClaudeStream", () => {
  it("counts search and fetch events and collects both URL kinds", () => {
    const stream =
      streamLine({ type: "system", subtype: "init" }) +
      assistantToolUse("WebSearch", { query: "node lts" }, "t1") +
      streamLine({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content:
                'Links: [{"title":"A","url":"https://a.example/1"}]\n\ndone',
            },
          ],
        },
      }) +
      assistantToolUse("WebFetch", { url: "https://a.example/1" }, "t2") +
      streamLine({
        type: "result",
        is_error: false,
        result: '{"answer":"done"}',
      });

    const summary = parseClaudeStream(stream);

    expect(summary.isError).toBe(false);
    expect(summary.evidence.webSearchEvents).toBe(1);
    expect(summary.evidence.codexOpenPageEvents).toBe(1);
    expect(summary.evidence.openedPageEvents).toBe(1);
    expect(summary.evidence.bridgeFetchEvents).toBe(0);
    expect(summary.evidence.queries).toEqual(["node lts"]);
    // A searched-but-not-opened URL is observed evidence, not opened evidence.
    expect(summary.evidence.observedUrls).toEqual(["https://a.example/1"]);
    expect(summary.evidence.openedUrls).toEqual(["https://a.example/1"]);
    expect(summary.finalMessage).toBe('{"answer":"done"}');
  });

  it("reports a failed run and survives non-JSON noise", () => {
    const stream =
      "warning: something happened\n" +
      streamLine({ type: "result", is_error: true, result: "rate limited" });

    const summary = parseClaudeStream(stream);
    expect(summary.isError).toBe(true);
    expect(summary.evidence.webSearchEvents).toBe(0);
  });

  it("yields zero search evidence for an empty stream", () => {
    const summary = parseClaudeStream("");
    expect(summary.evidence.webSearchEvents).toBe(0);
    expect(summary.finalMessage).toBeUndefined();
  });
});
