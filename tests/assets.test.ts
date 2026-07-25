import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function asset(path: string): Promise<string> {
  return readFile(resolve(root, "assets", path), "utf8");
}

describe("promotional assets", () => {
  it.each([
    ["hero.svg", "0 0 1440 720"],
    ["social-card.svg", "0 0 1200 630"],
    ["logo.svg", "0 0 512 512"],
  ])("%s has exact geometry and accessible metadata", async (path, viewBox) => {
    const svg = await asset(path);
    expect(svg).toContain(`viewBox="${viewBox}"`);
    expect(svg).toMatch(/<title[^>]*>[^<]+<\/title>/);
    expect(svg).toMatch(/<desc[^>]*>[^<]+<\/desc>/);
    expect(svg).toContain("#22D3C5");
    expect(svg).not.toMatch(/[—–]/);
    expect(svg).not.toMatch(/official plugin|OpenAI logo/i);
  });

  it("labels the social card as an unofficial community project", async () => {
    const svg = await asset("social-card.svg");
    expect(svg).toContain("UNOFFICIAL COMMUNITY PROJECT");
    expect(svg).toContain("TOOL-CAPABLE MODEL");
    expect(svg).toContain("VERIFIED LIVE-WEB");
  });

  it("renders an exact 1200 by 630 social PNG", async () => {
    const metadata = await sharp(
      resolve(root, "assets/social-card.png"),
    ).metadata();
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
    expect(metadata.format).toBe("png");
  });

  it("renders an exact 1440 by 720 README hero PNG", async () => {
    const metadata = await sharp(resolve(root, "assets/hero.png")).metadata();
    expect(metadata.width).toBe(1440);
    expect(metadata.height).toBe(720);
    expect(metadata.format).toBe("png");
  });

  it("packages a square plugin icon", async () => {
    const metadata = await sharp(
      resolve(root, "plugins/codex-search-bridge/assets/logo.png"),
    ).metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    expect(metadata.format).toBe("png");
  });
});
