---
name: ServicePilot AI
description: An editorial operations studio for grounded customer-support decisions.
colors:
  studio-black: "#0A0A08"
  graphite: "#1D1D1B"
  graphite-raised: "#292927"
  paper: "#F6F6F2"
  paper-muted: "#D7D7D0"
  chrome: "#A5A5A0"
  acid-lime: "#8CFF3E"
  acid-lime-soft: "#D8FFB7"
  product-deep-blue: "#102B4E"
  product-ocean-blue: "#1765A6"
  product-mid-blue: "#183B67"
  product-camera-blue: "#244E7B"
  product-lens-blue: "#2F80C9"
  product-ink-blue: "#071628"
  product-lens-ink: "#0C1D31"
  product-silver: "#B8C3CF"
  product-ice: "#D8E8F7"
  danger: "#FF6B57"
  warning: "#FFD95A"
typography:
  display:
    fontFamily: "Aptos, Tahoma, sans-serif"
    fontSize: "clamp(3.25rem, 7.6vw, 6rem)"
    fontWeight: 900
    lineHeight: 0.88
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Aptos, Tahoma, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 4.75rem)"
    fontWeight: 850
    lineHeight: 0.96
    letterSpacing: "-0.055em"
  body:
    fontFamily: "Aptos, Tahoma, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Aptos, Tahoma, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.04em"
  productDisplay:
    fontFamily: "Aptos, Tahoma, sans-serif"
    fontSize: "clamp(3.2rem, 8.8vw, 6rem)"
    fontWeight: 900
    lineHeight: 0.88
    letterSpacing: "-0.04em"
rounded:
  pill: "999px"
  control: "12px"
  card: "16px"
  stage: "72px"
  device: "48px"
  deviceInner: "38px"
  camera: "30px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "20px"
  lg: "32px"
  xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.acid-lime}"
    textColor: "{colors.studio-black}"
    rounded: "{rounded.pill}"
    padding: "14px 22px"
  button-dark:
    backgroundColor: "{colors.studio-black}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "14px 22px"
  card-dark:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "24px"
  card-paper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.studio-black}"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design System: ServicePilot AI

## Overview

**Creative North Star: "The Proof Studio"**

ServicePilot is treated as a creative operations studio whose material is evidence: stark paper-white stages sit inside a near-black working environment, while acid lime marks the exact places where a decision becomes safe to act on. The system translates the supplied Creatix reference into an operational product language without copying its agency content or depending on portrait photography.

The interface is expressive at section scale and disciplined at task scale. Large grotesk headlines establish the workflow; dense cards remain scan-friendly and familiar. **Key Characteristics:** white capsule stage, black editorial canvas, acid-lime proof marks, oversized type, rounded metric bands, monochrome operational panels, and visible provenance.

## Colors

The base palette is restrained black-and-white with one committed acid-lime proof color. Product imagery may introduce one documented, subject-derived tonal ramp while controls and status semantics stay in the base palette.

### Primary
- **Acid Proof Lime** (`#8CFF3E`): confirmed, selected, safe, or ready states; primary actions; no decorative gradients.

### Neutral
- **Studio Black** (`#0A0A08`): page canvas and dark controls.
- **Graphite** (`#1D1D1B`): primary work panels.
- **Raised Graphite** (`#292927`): secondary cards and hover states.
- **Proof Paper** (`#F6F6F2`): hero stage, readable content surfaces, and inverse sections.
- **Muted Paper** (`#D7D7D0`): secondary text on dark surfaces.
- **Chrome** (`#A5A5A0`): low-emphasis metadata and dividers.

### Product tonal ramp
- **Deep Blue** (`#102B4E`), **Ocean Blue** (`#1765A6`), **Mid Blue** (`#183B67`), **Camera Blue** (`#244E7B`), **Lens Blue** (`#2F80C9`), **Ink Blue** (`#071628`), and **Lens Ink** (`#0C1D31`) may be used only inside the iPhone product illustration.
- **Product Silver** (`#B8C3CF`) and **Product Ice** (`#D8E8F7`) define the device edge and its local label.
- **The Product-Field Rule.** Subject color stays inside product media; it does not replace lime for actions or application states.

### Named Rules
**The Proof-Mark Rule.** Lime means a state, selection, citation, or action. It never appears as ambient decoration without information.

## Typography

**Display Font:** Aptos Display–style system grotesk via Aptos/Tahoma fallbacks

**Body Font:** Aptos/Tahoma system stack
**Character:** compact, decisive, and legible in both Thai and English; hierarchy comes from scale and weight rather than multiple font families.

### Hierarchy
- **Display** (900, fluid 3.25–6rem, 0.88): hero thesis and the full-width workflow manifesto.
- **Headline** (850, fluid 2.25–4.75rem, 0.96): major sections.
- **Title** (800, 1.2–1.6rem): cards and operational groups.
- **Body** (400–600, 0.95–1rem, 1.55): explanations and evidence.
- **Label** (800, 0.75rem, tracked): status, category, and provenance labels.
- **Product Display** (900, fluid 3.2–6rem, 0.88): a product name in the storefront hero; never used in operational panels.

### Named Rules
**The Two-Speed Rule.** Page-level ideas are enormous; task-level content stays at comfortable operational sizes. Do not render evidence or controls as microtype.

## Layout

Use a centered max-width studio canvas with 16–28px gutters. The first viewport is a large paper stage with an embedded black pill navigation and an operational proof composition. Dark sections alternate between wide metric bands, asymmetric two-column work panels, and full-width manifestos. Desktop grids collapse to one column below 760px; all controls retain at least a 44px target. Section spacing is generous, while card spacing is compact and repeatable.

## Elevation & Depth

Depth is structural rather than glassy. Paper and graphite surfaces separate through tone, one-pixel borders, deliberate overlap, and occasional hard ambient shadows. Backdrop blur is not part of this world.

### Shadow Vocabulary
- **Stage Lift** (`0 28px 80px rgba(0,0,0,.24)`): the white opening stage only.
- **Control Lift** (`0 8px 24px rgba(0,0,0,.18)`): floating action controls and dialogs.

### Named Rules
**The Printed-Surface Rule.** Cards look cut from paper or graphite sheets; avoid glassmorphism and luminous edge glows.

## Shapes

The page uses four recurring silhouettes: full pills for navigation and actions, 12px controls, 16px work cards, and a 72px opening stage silhouette pinned by the supplied reference. Small decorative lime bursts are allowed as product marks, but not as generic icon tiles.

## Components

### Buttons
- **Shape:** full pill with a 44px minimum height.
- **Primary:** acid lime on studio black; strong label; subtle upward press on hover.
- **Secondary:** transparent or paper with a one-pixel graphite border.
- **Focus:** a two-pixel lime ring separated by a dark offset.

### Chips
- **Style:** compact pill, neutral outline at rest, lime fill when selected.
- **State:** selected states always expose `aria-pressed` or equivalent semantics.

### Cards / Containers
- **Corner Style:** 16px; 72px only for the opening stage.
- **Background:** solid paper or graphite.
- **Shadow Strategy:** mostly flat; stage and dialog only.
- **Border:** one-pixel tonal edge.

### Inputs / Fields
- **Style:** solid paper or raised graphite, 12px radius, visible label, 44px minimum height.
- **Focus:** lime border and high-contrast ring.
- **Error / Disabled:** explicit copy plus danger or muted treatment; never opacity alone.

### Navigation
- Black pill embedded into the paper stage on desktop; compact row with a menu disclosure on mobile. Current section uses semantic `aria-current` and a lime proof mark.

### Approval Gate
- Write actions sit on paper inside a graphite frame. The proposed action, amount, policy reason, provenance, and the two decision controls must remain visible together.

## Do's and Don'ts

### Do:
- **Do** use acid lime only for verified state and decisive action.
- **Do** expose real data provenance next to every live/demo status.
- **Do** let operational content, not decoration, become the hero asset.
- **Do** keep Thai and English body copy at readable task sizes.

### Don't:
- **Don't** use blur-heavy glass panels, neon glows, or the discarded isometric orbit language.
- **Don't** copy the reference site's agency claims, people, or metrics.
- **Don't** label synthetic evaluation values as live telemetry.
- **Don't** allow a visual success state before the backend confirms persistence.
