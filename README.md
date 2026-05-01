# Chrome Replacer

Manifest V3 Chrome extension that rewrites text on any webpage using find‑and‑replace rules you manage from a dedicated config page.

## Features

- **Left‑click the toolbar icon** — opens the config page in a new tab.
- **Unlimited rules** in a virtualized, single‑pane scrolling list (no pagination).
- **Live search** across find + replace text; **filter pills** by status (All / Enabled / Disabled) and regex‑only.
- **Bulk actions** — select rows with the always‑visible checkbox; the toolbar swaps in to offer Enable, Disable, Duplicate, and Delete. Destructive actions ask for confirmation with a count, and expose an Undo toast for 8s.
- **Per‑rule toggles** — inline VS Code‑style `.*` regex, `|ab|` match‑whole‑word, `Aa` ignore‑case, and `~` loose‑punctuation buttons on each row. Invalid regex gets a red accent and an inline error tooltip; the engine skips it instead of breaking the page.
- **Loose punctuation** (`~`, literal mode) — every run of spaces/symbols in your find pattern compiles to a captured `\W*`, and the original separators get re‑injected into the replacement. So `Primitive Doctor` → `Doctor Primitive` with `~` on rewrites `Primitive-Doctor` to `Doctor-Primitive` and `Primitive  Doctor` (double space) to `Doctor  Primitive` — the punctuation between words is preserved instead of being collapsed into whatever spaces you typed in the replacement.
- **Map mode** (`{·}` toggle) — conditional replacement driven by the captured group. Find must be a regex with at least one capture; Replace holds a `key=value` table, one per line, with optional `*=fallback` and `$1..$9` / `$&` backreferences. Example: find `\bdared? to (take|talk|walk)\b`, replace `take=took` / `talk=talked` / `walk=walked`. Rows in Map mode expand inline into a multi‑line editor.
- **Import / Export** rules as JSON for backup and sharing.
- **Saves across reload and restart** via `chrome.storage.local`; changes propagate to the content script in real time through `chrome.storage.onChanged`.

## Install (dev)

1. Clone this repo.
2. `chrome://extensions` → enable Developer Mode → **Load unpacked** → select this directory.
3. Click the toolbar icon to open the config page.

## Design notes

The config page was designed against a research survey of rule‑editor UIs (VS Code keybindings, uBlock Origin, Stylus, Linear, Raycast, 1Password, Gmail bulk actions) and UX principles (Hick's, Fitts's, Miller's, progressive disclosure, Nielsen's error‑prevention heuristic). Key decisions:

- **Virtualized single‑pane list** over pagination — you own every rule, so `Ctrl+F` and smooth scroll beat page breaks.
- **Always‑visible row checkboxes** + **header‑swap bulk toolbar** (Gmail pattern) — the bulk affordance is discoverable upfront; the toolbar appears without layout shift.
- **Vertical find → replace field pair with inline right‑edge toggles** — mirrors the VS Code Find Widget convention users already know.
- **Monospace inputs** — users compare whitespace, count chars, and scan for regex metacharacters; proportional fonts mislead.
- **Linear / Raycast dark aesthetic** — near‑black surfaces, one indigo accent, WCAG AA contrast.
- **Undo‑first destructive flow** — Delete asks with a count, then shows an Undo toast for 8s; no hidden trash.

## Workflow

Every change goes on a branch + PR against `main`. Commit identity is set inline via `git -c` with the Hagryph noreply address; tags are annotated. SemVer: patch for fixes, minor for features, major for breaking.
