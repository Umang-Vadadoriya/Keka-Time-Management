# Design notes

Rationale for the non-obvious decisions in `keka-time-helper.user.js`. The code itself is kept comment-light; this file is the "why".

## Data sources: DOM vs API
The overlay reads from two places:
- **DOM** — the punch rows rendered in Keka's Regularize modal (HH:MM precision only).
- **API** — `GET {origin}/k/attendance/api/mytime/attendance/summary/{YYYY-MM-01}` for the logged-in user, second-precise (`validInOutPairs`, `totalEffectiveHours`, `totalBreakDuration`, `firstLogOfTheDay`, `timeEntries`). Auth = `Bearer localStorage.access_token`.

`updateUI` uses DOM math as the baseline and overrides the headline stats with API values when available; it falls back to DOM if the API is unreachable.

### Viewing another employee → DOM only
A privileged user can open a colleague's page (`#/employee/{id}/time/attendance/logs`). The `/mytime/` endpoint is token-scoped, so it would return the **viewer's** data, not the viewed employee's. `isViewingOtherEmployee()` detects the `/employee/{id}/` route; when true, `loadDayAttendance()` returns null (skip the API entirely) so every stat comes from the DOM (which already shows the viewed person), and background notifications are suppressed. The employee-specific endpoint (`/k/attendance/api/employee/{id}/attendance/summary/{month}`) exists and mirrors `/mytime/`, but we deliberately don't use it — DOM-only was the chosen behavior.

## Reliability: the modal-reopen deadlock (v20.2)
`updateUI` sets a module `isUpdating` guard. If any line inside threw, the flag stayed `true` forever, and the `MutationObserver` — which was gated on `if (isUpdating) return` — went permanently deaf, so it never detected the modal closing (`modalOpen` stuck true) and the next open silently did nothing. Two rules keep this from recurring; do not undo them:
- `updateUI`'s body is wrapped in `try { … } finally { isUpdating = false }` — the flag **always** resets.
- The observer is **not** gated on `isUpdating`. Its open/close logic only acts on a container-presence *transition* (guarded by `modalOpen`), so `updateUI`'s own DOM writes can't re-enter it.

## Time formatting
One vocabulary across the whole overlay:
- `formatDurationSec(sec)` → plain `8h 1m 33s` (tab title, clipboard).
- `formatDurationHTML(sec)` → `8h 1m · 33s` with unit letters (`.dur-u`) and seconds (`.dur-s`) subdued; card values use `tabular-nums` so live-ticking digits don't jitter.
- Break, overtime, and remaining are second-precise. Break is always API-sourced (gaps between `validInOutPairs`), including the open-punch case.

Keep the `@version` header and the `SCRIPT_VERSION` constant in sync — the footer renders `SCRIPT_VERSION`.

## Manual entry mode
Used when biometric logs are missing/wrong. Stored as in/out **pairs** (`manualEntries`, open entry = `{start, end:null}`) for display + compute, but edited at the **punch** level so a stray/missing single punch can be fixed without rebuilding whole pairs:
- `flattenPunches()` → sorted flat list of every punch.
- `repairFromPunches(punches)` → pair consecutively (1&2, 3&4 …); odd trailing punch → open entry.
- Add / insert / remove operate on the flat list then re-pair, so everything after a change shifts by one — matching how Keka pairs biometric logs by position.

Other manual-mode notes:
- An **open** ("still working") entry counts live to `now`; it ticks via a dedicated `manualTickInterval` (the normal `renderInterval` isn't created on empty days, which is exactly when manual mode is used).
- The edit page reuses the results page's visual language: the same `metric-card` gradient cards and colour roles (purple = Total Duration, pink = Break, blue = Completion, which also hosts the break planner), the `manual-icon-btn` corner tab (✕ to leave, where the results page has the pen; styled once in the global stylesheet, flush with the card's top-right corner and 18px tall so it stays inside the card's 20px padding), and the gradient primary button.
- Punches render as one row per pair: `IN ──[work]── OUT  [☕ break]`. The purple work pill sits on the connector between the two times (dashed after the pill while the pair is still open); the blue pill on the right is the break *before* that pair, so the first row's slot is empty. Same colours as the work/break capsule on Keka's log rows. Rows share one grid (`.me-list` columns + `subgrid` rows) so the work pills line up across rows without fixed widths.
- Budget for ~290px: that's the panel's inner width inside Keka's regularization modal, far narrower than a standalone preview. Times drop the leading zero and the per-punch × floats on the time (shown on row hover) instead of taking inline space. Check layout changes inside the real modal, not just a wide preview.
- A single input adds punches: one time inserts one punch, a range (`9:30 AM - 1:00 PM`, `–`, `—` or `to`) inserts both ends. Both go through `insertPunch` then re-pair. Parsing is `parsePunchInput` → `normalizeTimeFormat` → `parseFlexibleTime`. It accepts 12-hour forms (`9:30am`, `9.30 p.m.`, `9a`, `930am`) and 24-hour forms (`13:30`, `1330`, `0930`, `9`), and always displays as 12-hour.
- `guessPm` applies to typed input only: a bare 1–6 with no AM/PM and no leading zero means afternoon (`1:30` → 1:30 PM, `01:30` → 1:30 AM). It is never applied to text read from Keka's page, which is unambiguous.
- Click (or Enter/Space on) a punch time to edit it in place. The input is sized to the text so the row doesn't move. Enter or blur saves via `editPunchAt`, which re-pairs. Escape cancels. Invalid input on Enter keeps editing; invalid input on blur reverts. The input stops Enter/Escape from propagating, so they can't submit Keka's form or close its modal.
- The ✕ button exits immediately (no confirm), dropping the edited punches and falling back to the page's logs.
- Everything renders inside Keka's regularization `<form>`. Every `<button>` the script creates must be `type="button"`, and Enter in its text inputs must `preventDefault()`. Otherwise Enter implicitly submits the form, which clicks the form's first submit button. That button is either our ✕ (kicking you back to the results page) or Keka's "+ Add Log" (adding a stray Attendance Adjustment row to the real request). This was fixed in v21.1.
- No overlap validation: the punch/shift model sorts + re-pairs, and corrective inserts may intentionally interleave.

## Layout
The results page and the manual page are both framed as a single card on `.total-duration-display`. The manual page's inner `.manual-entry-container` is a flush wrapper only (no box), so the two pages look identical and there's no box-in-a-box.

## Rendering the results card
`updateUI` runs every second while a punch is open, but the results card is only rebuilt when its layout changes. The layout key is: completed, wrap-up banner and its minute label, 4h/8h target, and debug mode. The rebuild is the full `innerHTML` write, the clone-swap that drops old listeners, and the listener re-bind. On every other tick only the five `[data-k]` value nodes are patched, and only when their HTML differs. That keeps animations (the footer heart), hover state and listeners intact. The copy handlers read the module-level `homeCopy`, refreshed each tick, not the locals of the render that bound them, so copied values stay live. Any new per-tick value on the card needs a `data-k` entry in `valuesHTML`. Anything that changes the card's structure must go into `layoutKey`.
- Copy feedback: `copyToClipboard` resolves `true` on success, and the clicked card (the custom event's target) gets `.is-copied` for 1.2s. Its `::after` reads "Copied ✓" in the label's exact spot and type while `.metric-label` fades out. On these narrow cards, a badge anywhere else covered text.
- One palette, `GRADIENTS`, serves both pages, with fixed colour roles: purple = worked, blue = completion, pink = break, orange = overtime, green = remaining (completed reuses green).

## Implementation notes (moved out of code comments)
- **No test code ships.** The script is served from a Gist to Tampermonkey and the bookmarklet, so it carries nothing test-only. `tests/load-script.js` splices a hook into its in-memory copy, right after `window.__kekaEnhanceLoaded = true;`, which hands the IIFE's internals to the tests. Keep that line unique. If it changes, update `ANCHOR` in the loader. Every test fails loudly if it's missing. Add any new helper you want tested to `HOOK` there.
- **Manual form never redraws on a timer.** The once-a-minute notification tick skips `updateUI` while `showManualForm` is set, and the 1s render tick already did. A timed redraw would wipe whatever is being typed.
- **Minute-only values on the edit page.** Manual punches are minute-precise, so the edit page shows h/m only and strips seconds from the leave time. A seconds field there would always read "0s".
- **Break chips vs the custom box.** The custom-minutes input must not carry `.break-plan-chip`. That class wires the preset click handler, which would reset the break and redraw on focus (the v21.0 "can't type in Other" bug). The handler also binds only to `.break-plan-chip[data-min]`.
- **The custom box applies on commit.** It applies on Enter (handled with `preventDefault`, for the same implicit-submit reason as the punch input) or on `change`/blur, never on `input`, so typing keeps focus.
- **Refocus after Add.** `updateUI` is debounced (250ms), so the input that had focus is replaced after the handler returns. `doAdd` clears the input immediately, so a quick second Enter can't re-add the punch, and sets `refocusPunchInput`. The next `attachManualEntryHandlers` focuses the new input.
- **Edit-in-place sizing.** `.me-time` is the text plus 2px padding each side with -2px margins, so it takes up `width - 4`. The edit input has -5px margins, so it takes up `width - 10`. Setting it to `rect.width + 6` keeps the column the same width. Use the fractional `getBoundingClientRect().width`, not `offsetWidth`: rounding shifts the column when the edited time is the widest one.
- **Edit-in-place finish.** Only a successful change redraws. Cancel and revert put the original `<span>` back without redrawing, so an error message stays visible.
