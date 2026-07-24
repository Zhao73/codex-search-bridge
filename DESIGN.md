---
name: Codex Search Bridge
description: A forensic visual system for verified live-web research
colors:
  void: "#07110F"
  evidence-surface: "#10201C"
  verified-teal: "#22D3C5"
  source-ink: "#F2F7F5"
  muted-evidence: "#9FB4AE"
  evidence-line: "#274038"
typography:
  display:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "clamp(2.75rem, 7vw, 5.5rem)"
    fontWeight: 700
    lineHeight: 0.94
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  evidence:
    fontFamily: "Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  sharp: "0px"
  surface: "12px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "24px"
  lg: "48px"
components:
  evidence-panel:
    backgroundColor: "{colors.evidence-surface}"
    textColor: "{colors.source-ink}"
    rounded: "{rounded.surface}"
    padding: "24px"
  verified-label:
    backgroundColor: "{colors.verified-teal}"
    textColor: "{colors.void}"
    typography: "{typography.evidence}"
    rounded: "{rounded.sharp}"
    padding: "6px 10px"
---

# Design System: Codex Search Bridge

## Overview

**Creative North Star: "The Evidence Relay"**

The visual system behaves like a chain-of-custody sheet built for the live web. Large direct language occupies one side; structured evidence travels through a clearly drawn relay on the other. The composition is asymmetric, dense enough to feel technically real, and restrained enough that every mark has a job.

It explicitly rejects generic AI-tool marketing, fake terminal dashboards, OpenAI visual mimicry, and template-first SaaS layouts. The work should look like an independent open-source instrument, not a model advertisement.

**Key Characteristics:**

- One teal signal moving through dark neutral space
- Strong sans display type with compact mono evidence labels
- Flat geometry, explicit connections, no decorative glow
- Dates, URLs, and verification states treated as first-class content
- Community status visible but subordinate to the product promise

## Colors

The palette is a quiet near-black field interrupted by one precise verification signal.

### Primary

- **Verified Teal:** The only accent. Use it for the bridge path, proof state, and one dominant word or action.

### Neutral

- **Void:** Main background for every promotional surface.
- **Evidence Surface:** Group related evidence without shadows.
- **Source Ink:** Primary text and high-importance source detail.
- **Muted Evidence:** Supporting descriptions and timestamps.
- **Evidence Line:** Structural separators and inactive connections.

**The One Signal Rule.** Verified Teal is the only saturated color. If a second accent appears, the evidence hierarchy has failed.

**The No Glow Rule.** Never add an outer neon glow, purple haze, or mesh gradient. Contrast and geometry carry the signal.

## Typography

**Display Font:** Arial/Helvetica with system sans fallback  
**Body Font:** Arial/Helvetica with system sans fallback  
**Label/Mono Font:** Menlo/Consolas with monospace fallback

**Character:** The display voice is blunt and public; the evidence voice is compact and procedural. The families are deliberately system-safe so SVG renders remain deterministic across Windows, macOS, GitHub, and CI.

### Hierarchy

- **Display** (700, fluid up to 5.5rem, 0.94): Project name and one launch promise only.
- **Headline** (700, 2rem, 1.05): Major proof statement.
- **Title** (700, 1.25rem, 1.2): Evidence stage and section labels.
- **Body** (400, 1rem, 1.55): Explanatory copy, capped near 68 characters per line.
- **Evidence** (600, 0.875rem, 0.02em): URLs, dates, events, and statuses. Short labels may use uppercase.

**The Human First Rule.** Lead with plain-language consequence; use mono only for actual machine evidence. Mono cannot substitute for technical credibility.

## Elevation

The system is flat by default. Depth comes from tonal surfaces, overlap, and line weight. Promotional art uses no drop shadows. A panel may sit on Evidence Surface with an Evidence Line boundary, but it never combines a border with a wide soft shadow.

**The Chain of Custody Rule.** Connections are always visually behind the evidence they connect. A line may explain flow but may never obscure text.

## Components

### Evidence Panels

- **Shape:** Compactly curved surface (12px radius).
- **Background:** Evidence Surface against Void.
- **Shadow Strategy:** None.
- **Border:** Evidence Line only when separation is otherwise ambiguous.
- **Internal Padding:** 24px for large panels, 12px for small proof blocks.

### Verified Labels

- **Shape:** Sharp rectangle (0px radius), not a pill.
- **Color:** Verified Teal background with Void text.
- **Typography:** Evidence mono; uppercase permitted for `VERIFIED` only.
- **Use:** One final state per evidence chain. Never repeat as decoration.

### Source Rows

- **Style:** URL or publisher in Source Ink, dates in Muted Evidence, one Evidence Line between logical groups.
- **State:** Confirmed and unconfirmed states always include a word label in addition to any color.

### Bridge Mark

- **Style:** Two rigid endpoints connected by a single stepped teal path.
- **Meaning:** External model on one side, verified Codex research on the other.
- **Restriction:** Never combine the mark with OpenAI logos or derivative knots.

## Do's and Don'ts

### Do:

- **Do** make search, open-page, URL, event date, and uncertainty states visible.
- **Do** use Verified Teal as one scarce signal against Void.
- **Do** keep display letter spacing at or above -0.04em.
- **Do** preserve useful SVG `<title>` and `<desc>` metadata.
- **Do** label the project as an unofficial community project.

### Don't:

- **Don't** use generic AI-tool marketing with purple gradients, glowing brains, or vague intelligence claims.
- **Don't** build fake terminal dashboards that imply runtime proof.
- **Don't** use OpenAI visual mimicry or suggest an official plugin.
- **Don't** claim “works with every model” without the MCP tool-calling requirement.
- **Don't** use three identical feature cards, glass panels, decorative status dots, gradient text, or wide soft shadows.
- **Don't** use an em dash or en dash as visible punctuation. Use periods, commas, or a regular hyphen.
