# Keka Time Helper

A zero-dependency, single-file browser tool that augments the [Keka](https://www.keka.com/) HR portal's attendance page with second-precision time tracking — total work duration, break time, and the **exact clock-out time** to complete your target hours — rendered as a live overlay inside Keka's own UI.

No build step, no framework, no extension to install. It ships as a **bookmarklet** (or Tampermonkey userscript) and updates itself.

> _Built to answer one daily question — "when have I actually done my 8 hours?" — without the mental math._

<!-- Add a short demo GIF here: it makes the repo. e.g. ![demo](docs/demo.gif) -->

## Features

- **Second-precise stats** — total work, break, overtime, and remaining time, computed from Keka's authenticated attendance API (`validInOutPairs`), not just the minute-rounded values on screen.
- **Projected clock-out** — the exact time you'll hit 8h / 4h, updating **live every second** while you're clocked in.
- **Break planner** — a "Leave by" projection: tap a preset (or enter custom minutes) to see how an upcoming break shifts your finish time.
- **Manual entry mode** — reconstruct a day when biometric logs are missing or wrong. Edits happen at the **individual-punch level**: removing or inserting a single punch re-pairs everything after it (the way Keka pairs biometric logs by position), so a stray double-punch or a missing out-punch is a one-tap fix.
- **Desktop notifications** — a 10-minutes-to-target wrap-up alert, overtime nudges, and completion milestones (Web Notifications API).
- **Half / full-day aware** and read-only when viewing a colleague's page (privileged users see *their* data, computed from the DOM).

## How it works

The overlay reads from **two sources and reconciles them**:

- **DOM** — the punch rows in Keka's Angular-rendered attendance modal (minute precision).
- **API** — `GET /k/attendance/api/mytime/attendance/summary/{month}`, authenticated with the page's own `localStorage` bearer token, for second-precision pairs and totals.

API values drive the headline numbers when available; the script **falls back to DOM math** if the API is unreachable, so it degrades gracefully rather than breaking. Everything runs in the page's own context — no data ever leaves the browser.

A few engineering notes:

- **Self-updating distribution** — a GitHub Action (`sync-gist.yml`) PATCHes a public Gist on every push to `master`; the bookmarklet fetches that Gist at runtime, so users are always current without reinstalling.
- **Reliability** — the render loop is guarded so a one-off DOM/API error can't wedge the overlay (an earlier bug where a stuck flag deafened the mutation observer and silently broke modal-reopen is fixed by an always-reset `try/finally` + an un-gated observer).
- **One time vocabulary** — a shared formatter renders every duration consistently, with `tabular-nums` so live-ticking digits don't jitter.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the deeper rationale and [`ARCHITECTURE.md`](ARCHITECTURE.md) for the repo layout.

## Install

**Bookmarklet (no extension):** create a bookmark whose URL is:

```js
javascript:(()=>{fetch("https://gist.githubusercontent.com/Umang-Vadadoriya/ffc09708226db8bef988a0ecf1848518/raw/KekaEnhance.js").then(r=>r.text()).then(eval);})();
```

Open Keka, click the bookmark once, then open any day — the overlay appears. (Full user-facing walkthrough: [`docs/announcement.md`](docs/announcement.md).)

**Userscript:** install [`keka-time-helper.user.js`](keka-time-helper.user.js) in Tampermonkey/Violentmonkey — it runs automatically on `*.keka.com` and auto-updates via its `@updateURL`.

## Tech

Vanilla JavaScript (ES2020+), a single IIFE with `'use strict'`. No dependencies, no bundler, no tests — validated by `node --check` for syntax and by loading against the live site. GitHub Actions for release automation.

## Repository layout

| Path | What |
|------|------|
| `keka-time-helper.user.js` | The primary, actively-maintained tool |
| `docs/DESIGN.md` | Why the non-obvious decisions were made |
| `docs/announcement.md` | End-user install / usage walkthrough |
| `keka-api-samples/` | Redacted real API responses (drift detection) |
| `experiments/` | Companion prototypes — monthly-OT calculator, clock-out monitor |
| `.github/workflows/sync-gist.yml` | Auto-publishes the script to its Gist on push |

## Notes

This tool automates a third-party site whose markup and endpoints can change without notice, and it reads only the signed-in user's own data using the session's existing token. It's an independent utility, not affiliated with or endorsed by Keka.
