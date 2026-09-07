# Architecture

A collection of standalone, client-side JavaScript scripts that augment the Keka HR portal (`*.keka.com`) in-browser. There is no build system, package manager, or test suite — each `.js` file is self-contained and runs via Tampermonkey/Violentmonkey, a browser bookmarklet, or pasted into the DevTools console.

## Scripts

- **`keka-time-helper.user.js`** — the primary, actively-maintained userscript. A Tampermonkey-style header (`==UserScript==`) targets `https://*.keka.com/*`. It parses the attendance log on the page, fetches Keka's attendance-summary API for second-precision totals, computes work duration / break time / projected leaving time, renders an overlay UI, and fires desktop notifications. State is held in module-scope `let` variables inside an IIFE (e.g. `isHalfDayMode`, `manualEntries`, `dayApiData`). The `@updateURL`/`@downloadURL` point to a Gist (`raw/KekaEnhance.js`) — the published Gist is what users actually pull at runtime.
- **`experiments/OT-Calc.js`** — a console-paste script (no userscript header). An async IIFE that hits Keka's attendance API to compute monthly working time / overtime. Its header comment documents the API `dayType` / `attendanceDayStatus` enum — preserve those notes when editing.
- **`experiments/keka-clock-monitor-user.js`** — a separate userscript that polls the Keka employee API every 5 min for clock-in status and notifies on a clocked-out state. Tenant-specific; the employee id defaults to a hardcoded value but is overridable via `localStorage`.
- **`keka-api-samples/`** — captured real responses (identifiers redacted) from the Keka APIs the main script depends on. Diff against fresh fetches to detect API drift; not authoritative for code logic.
- **`docs/DESIGN.md`** — rationale for the non-obvious decisions in the main script (the "why" behind the code).
- **`docs/announcement.md`** — the user-facing install message for the bookmarklet form (fetches the Gist and `eval`s it). Update when the install flow changes.
- **`.github/workflows/sync-gist.yml`** — auto-syncs the main script to the Gist on every push to `master` that touches it. Requires repo secret `GIST_TOKEN` (a PAT with Gists: read & write).

## Distribution model

Users fetch the active script from the Gist, not this repo. The repo file is the source of truth; the workflow above keeps the Gist in lockstep automatically on push to `master`. Bumping `@version` in the header (kept in sync with the `SCRIPT_VERSION` constant) is the conventional release signal.

## Conventions

- Single IIFE per file, `'use strict'`, mutable module-level state declared with `let` at the top.
- The main script reads from both the DOM (start/end punches, modal layout) and Keka's authenticated attendance-summary API (for second-precision totals). API auth uses `localStorage.access_token` as a Bearer token. Fetches fail soft — if the API is unreachable, the script falls back to DOM-derived math.
- DOM mutations target Keka's Angular-rendered attendance table; selectors are brittle by nature and may need updating after Keka UI changes.
- Notifications use the Web Notifications API directly (`new Notification(...)`).
- No linter, formatter, or type system — match the surrounding style file-by-file.

## Working in this repo

- There is nothing to install, build, or run. Edits are validated by loading the script in the browser against Keka (and a quick `node --check` for syntax).
- When changing the main script, bump `@version` in the UserScript header (and the mirrored `SCRIPT_VERSION` constant). The Gist updates automatically via the workflow on push to `master`.
- Be careful with selector / API-shape assumptions — these scripts run against a third-party site whose markup and endpoints can change without notice. The `keka-api-samples/` fixtures help spot API drift.
