#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const outputFlag = args.indexOf("--output-last-message");
const outputPath = outputFlag === -1 ? undefined : args[outputFlag + 1];
let prompt = "";
for await (const chunk of process.stdin) {
  prompt += chunk;
}

if (outputPath === undefined) {
  process.stderr.write("missing output path");
  process.exit(2);
}

const questionMatch = /"question":\s*"([^"]+)"/.exec(prompt);
const question = questionMatch?.[1] ?? "When did it launch?";
const omitNativeOpen = question.includes("Bridge fallback");
const result = {
  answer: "The launch occurred on July 24.",
  as_of: "2026-07-25T03:00:00Z",
  query: {
    question,
    depth: "standard",
    max_sources: 6
  },
  claims: [
    {
      id: "C1",
      claim: "The launch occurred on July 24.",
      status: "confirmed",
      confidence: "high",
      event_date: "2026-07-24",
      source_ids: ["S1"]
    }
  ],
  sources: [
    {
      id: "S1",
      url: "https://example.com/launch",
      title: "Official launch",
      published_at: "2026-07-24",
      retrieved_at: "2026-07-25T03:00:00Z",
      source_type: "primary",
      provenance_verified: false
    }
  ],
  verification: {
    status: "failed",
    web_search_events: 0,
    opened_page_events: 0,
    codex_open_page_events: 0,
    bridge_fetch_events: 0,
    content_audit_passes: 0,
    cited_sources_verified: 0,
    total_cited_sources: 0
  },
  limitations: []
};

process.stdout.write(`${JSON.stringify({
  type: "item.completed",
  item: {
    id: "search_1",
    type: "web_search",
    query: "launch",
    action: { type: "search", query: "launch" }
  }
})}\n`);
if (!omitNativeOpen) {
  process.stdout.write(`${JSON.stringify({
    type: "item.completed",
    item: {
      id: "open_1",
      type: "web_search",
      query: "https://example.com/launch",
      action: { type: "open_page", url: "https://example.com/launch" }
    }
  })}\n`);
}
process.stdout.write(`${JSON.stringify({
  type: "item.completed",
  item: { id: "message_1", type: "agent_message", text: JSON.stringify(result) }
})}\n`);
await writeFile(outputPath, JSON.stringify(result), "utf8");
