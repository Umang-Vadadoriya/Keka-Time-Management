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
- A single input adds punches: one time inserts one punch, a range (`9:30 AM - 1:00 PM`, `–` or `to`) inserts both ends. Both go through `insertPunch` then re-pair.
- The ✕ button exits immediately (no confirm), dropping the edited punches and falling back to the page's logs.
- Everything renders inside Keka's regularization `<form>`. Every `<button>` the script creates must be `type="button"`, and Enter in its text inputs must `preventDefault()`. Otherwise Enter implicitly submits the form, which clicks the form's first submit button. That button is either our ✕ (kicking you back to the results page) or Keka's "+ Add Log" (adding a stray Attendance Adjustment row to the real request). This was fixed in v21.1.
- No overlap validation: the punch/shift model sorts + re-pairs, and corrective inserts may intentionally interleave.

## Layout
The results page and the manual page are both framed as a single card on `.total-duration-display`. The manual page's inner `.manual-entry-container` is a flush wrapper only (no box), so the two pages look identical and there's no box-in-a-box.

## Rendering the results card
`updateUI` runs every second while a punch is open, but the results card is only rebuilt when its layout changes. The layout key is: completed, wrap-up banner and its minute label, 4h/8h target, and debug mode. The rebuild is the full `innerHTML` write, the clone-swap that drops old listeners, and the listener re-bind. On every other tick only the five `[data-k]` value nodes are patched, and only when their HTML differs. That keeps animations (the footer heart), hover state and listeners intact. The copy handlers read the module-level `homeCopy`, refreshed each tick, not the locals of the render that bound them, so copied values stay live. Any new per-tick value on the card needs a `data-k` entry in `valuesHTML`. Anything that changes the card's structure must go into `layoutKey`.
