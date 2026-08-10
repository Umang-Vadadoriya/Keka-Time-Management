# Enhanced Keka Log Duration — design notes

Rationale for the non-obvious decisions in `Enhanced Keka Log Duration by UV with Advanced Notifications.js`. The code itself is kept comment-light; this file is the "why".

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
- Rows render the same work/break capsule as the main page; break on a row = the gap before that pair.
- No overlap validation: the punch/shift model sorts + re-pairs, and corrective inserts may intentionally interleave.

## Layout
The results page and the manual page are both framed as a single card on `.total-duration-display`. The manual page's inner `.manual-entry-container` is a flush wrapper only (no box), so the two pages look identical and there's no box-in-a-box.
