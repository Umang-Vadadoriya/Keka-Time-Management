/**
 * ============================================================
 *  Keka Monthly Working Time & OT Calculator
 * ============================================================
 *  Author : Umang Vadadoriya
 *  Usage  : Paste this script into the browser console while
 *           logged in on your Keka portal.
 *
 *  API dayType mapping (verified from live data):
 *    0 = Scheduled Work Day (Mon–Fri)
 *    1 = Public Holiday
 *    2 = Weekly Off (Sat/Sun)
 *
 *  attendanceDayStatus mapping:
 *    0 = Absent / Not Logged
 *    1 = Present / Logged
 *
 *  Leave detection:
 *    dayType=0 + attendanceDayStatus=0 + leaveDetails present
 * ============================================================
 */

(async function KekaOTCalc() {
    'use strict';

    // ── Configuration ───────────────────────────────────────
    const CONFIG = {
        // Set to a "YYYY-MM-01" string to fetch a specific month,
        // or leave null to auto-use the current month.
        targetMonth: null,

        // Standard daily working hours (Mon–Fri)
        standardHoursPerDay: 8,

        // Render the floating results panel on the page
        showUI: true,

        // Derived API base URL
        get apiBase() {
            return `${window.location.origin}/k/attendance/api/mytime/attendance/summary`;
        },
    };

    // ── Utility helpers ─────────────────────────────────────

    function getAccessToken() {
        const token = localStorage.getItem('access_token');
        if (!token) {
            throw new Error(
                '❌  No access_token in localStorage – are you logged in?'
            );
        }
        return token;
    }

    function resolveTargetMonth() {
        if (CONFIG.targetMonth) return CONFIG.targetMonth;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}-01`;
    }

    async function fetchAttendance(monthDate) {
        const token = getAccessToken();
        const url = `${CONFIG.apiBase}/${monthDate}`;
        console.log(`📡  Fetching: ${url}`);

        const res = await fetch(url, {
            credentials: 'include',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json; charset=utf-8',
                Authorization: `Bearer ${token}`,
                'X-Requested-With': 'XMLHttpRequest',
            },
            method: 'GET',
            mode: 'cors',
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const json = await res.json();
        if (!json.succeeded) throw new Error(json.message || 'API error');
        return json.data;
    }

    /** Parse "Xh Ym" → total minutes */
    function parseHHMM(str) {
        if (!str) return 0;
        const m = str.match(/(\d+)h\s*(\d+)m/);
        return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
    }

    /** Total minutes → "Xh Ym" */
    function fmtMin(mins) {
        const sign = mins < 0 ? '-' : '';
        const a = Math.abs(Math.round(mins));
        return `${sign}${Math.floor(a / 60)}h ${a % 60}m`;
    }

    function monthLabel(dateStr) {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            month: 'long',
            year: 'numeric',
        });
    }

    function dayLabel(isoStr) {
        const d = new Date(isoStr);
        return d.toLocaleDateString('en-IN', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
        });
    }

    function dayOfWeek(isoStr) {
        return new Date(isoStr).toLocaleDateString('en-US', { weekday: 'short' });
    }

    /** Does this API record have leave info? */
    function hasLeave(day) {
        if (day.leaveDetails && day.leaveDetails.length > 0) return true;
        if (day.leaveDayStatuses && day.leaveDayStatuses.length > 0) return true;
        return false;
    }

    /** Extract leave type name if available */
    function leaveTypeName(day) {
        if (day.leaveDetails && day.leaveDetails.length > 0) {
            return day.leaveDetails.map(l => l.leaveTypeName || 'Leave').join(', ');
        }
        return 'Leave';
    }

    // ── Core calculation ────────────────────────────────────

    function compute(data) {
        const STD = CONFIG.standardHoursPerDay * 60; // standard minutes/day
        const today = new Date();
        today.setHours(23, 59, 59, 999); // include today

        // Accumulators
        let workDayCount = 0;       // scheduled Mon–Fri work days in the month
        let presentWorkDays = 0;    // work days where employee was present
        let leaveDays = 0;          // work days on leave
        let absentDays = 0;         // work days absent (not leave, not future)
        let holidayCount = 0;       // public holidays
        let weeklyOffCount = 0;     // Sat/Sun
        let weekendWorkedCount = 0; // weekends where employee actually worked
        let holidayWorkedCount = 0; // holidays where employee actually worked

        let workDayEffMin = 0;      // effective minutes on work days only
        let workDayGrossMin = 0;    // gross minutes on work days only
        let weekendEffMin = 0;      // effective minutes on weekends
        let holidayEffMin = 0;      // effective minutes on holidays
        let totalEffMin = 0;        // all effective minutes
        let totalGrossMin = 0;      // all gross minutes

        let overtimeMin = 0;        // time beyond 8h on work days + all weekend/holiday work
        let deficitMin = 0;         // shortfall below 8h on present work days

        const rows = []; // daily breakdown for console table

        for (const day of data) {
            const dt = new Date(day.attendanceDate);
            if (dt > today) continue; // skip future dates

            const effMin = day.totalEffectiveHours != null
                ? Math.round(day.totalEffectiveHours * 60)
                : parseHHMM(day.effectiveHoursInHHMM);

            const grossMin = day.totalGrossHours != null
                ? Math.round(day.totalGrossHours * 60)
                : parseHHMM(day.grossHoursInHHMM);

            const worked = effMin > 0;
            const isLeave = hasLeave(day);
            const dow = dayOfWeek(day.attendanceDate);

            // ── Classify by dayType ──────────────────────
            let status = '';
            let otContrib = '';

            switch (day.dayType) {
                case 0: // ── Scheduled Work Day (Mon–Fri) ──
                    workDayCount++;
                    if (worked) {
                        presentWorkDays++;
                        workDayEffMin += effMin;
                        workDayGrossMin += grossMin;
                        totalEffMin += effMin;
                        totalGrossMin += grossMin;

                        const diff = effMin - STD;
                        if (diff > 0) {
                            overtimeMin += diff;
                            otContrib = `+${fmtMin(diff)}`;
                        } else if (diff < 0) {
                            deficitMin += Math.abs(diff);
                            otContrib = fmtMin(diff);
                        } else {
                            otContrib = '0';
                        }
                        status = '✅ Present';
                    } else if (isLeave) {
                        leaveDays++;
                        status = `🟠 ${leaveTypeName(day)}`;
                        otContrib = '-';
                    } else {
                        // Only mark absent if the date is past
                        const todayStart = new Date();
                        todayStart.setHours(0, 0, 0, 0);
                        if (dt < todayStart) {
                            absentDays++;
                            status = '🔴 Absent';
                        } else {
                            status = '⏳ Today';
                        }
                        otContrib = '-';
                    }
                    break;

                case 1: // ── Public Holiday ──
                    holidayCount++;
                    if (worked) {
                        holidayWorkedCount++;
                        holidayEffMin += effMin;
                        totalEffMin += effMin;
                        totalGrossMin += grossMin;
                        overtimeMin += effMin; // all holiday work = OT
                        otContrib = `+${fmtMin(effMin)} ⭐`;
                        status = '🟡 Holiday (Worked)';
                    } else {
                        status = '🟡 Holiday';
                        otContrib = '-';
                    }
                    break;

                case 2: // ── Weekly Off (Sat/Sun) ──
                    weeklyOffCount++;
                    if (worked) {
                        weekendWorkedCount++;
                        weekendEffMin += effMin;
                        totalEffMin += effMin;
                        totalGrossMin += grossMin;
                        overtimeMin += effMin; // all weekend work = OT
                        otContrib = `+${fmtMin(effMin)} ⭐`;
                        status = '🔵 W-Off (Worked)';
                    } else {
                        status = '🔵 W-Off';
                        otContrib = '-';
                    }
                    break;

                default:
                    status = `❓ Type ${day.dayType}`;
                    otContrib = '-';
                    break;
            }

            rows.push({
                Date: dayLabel(day.attendanceDate),
                Day: dow,
                Status: status,
                Effective: worked ? fmtMin(effMin) : '-',
                Gross: grossMin > 0 ? fmtMin(grossMin) : '-',
                'OT / Deficit': otContrib,
            });
        }

        // Required hours = (work days that aren't leave) × 8h
        const requiredWorkDays = presentWorkDays + absentDays; // days employee should have worked
        const requiredMin = requiredWorkDays * STD;

        // Net balance on work days only
        const netBalanceMin = workDayEffMin - requiredMin;

        // Average effective per present day (including weekends)
        const totalPresentDays = presentWorkDays + weekendWorkedCount + holidayWorkedCount;
        const avgEffMin = totalPresentDays > 0 ? totalEffMin / totalPresentDays : 0;

        // Average on work days only
        const avgWorkDayMin = presentWorkDays > 0 ? workDayEffMin / presentWorkDays : 0;

        return {
            monthName: monthLabel(data[0]?.attendanceDate || resolveTargetMonth()),

            // Day counts
            workDayCount,
            presentWorkDays,
            leaveDays,
            absentDays,
            holidayCount,
            weeklyOffCount,
            weekendWorkedCount,
            holidayWorkedCount,

            // Hours (formatted)
            requiredHours: fmtMin(requiredMin),
            workDayEffective: fmtMin(workDayEffMin),
            totalEffective: fmtMin(totalEffMin),
            totalGross: fmtMin(totalGrossMin),
            overtime: fmtMin(overtimeMin),
            deficit: fmtMin(deficitMin),
            netBalance: fmtMin(netBalanceMin),
            avgPerWorkDay: fmtMin(Math.round(avgWorkDayMin)),
            avgPerDay: fmtMin(Math.round(avgEffMin)),
            weekendEffective: fmtMin(weekendEffMin),
            holidayEffective: fmtMin(holidayEffMin),

            // Raw minutes (for UI logic)
            _requiredMin: requiredMin,
            _workDayEffMin: workDayEffMin,
            _totalEffMin: totalEffMin,
            _totalGrossMin: totalGrossMin,
            _overtimeMin: overtimeMin,
            _deficitMin: deficitMin,
            _netBalanceMin: netBalanceMin,
            _avgWorkDayMin: avgWorkDayMin,
            _weekendEffMin: weekendEffMin,
            _holidayEffMin: holidayEffMin,

            rows,
        };
    }

    // ── Console report ──────────────────────────────────────

    function printReport(s) {
        const D = '═'.repeat(62);
        const d = '─'.repeat(62);

        console.log('\n' + D);
        console.log(`  📊  MONTHLY WORKING-TIME REPORT — ${s.monthName}`);
        console.log(D);

        console.log('\n  📅  Day breakdown');
        console.log(d);
        console.log(`  Scheduled work days (Mon–Fri) : ${s.workDayCount}`);
        console.log(`  └─ Present                    : ${s.presentWorkDays}`);
        console.log(`  └─ On leave                   : ${s.leaveDays}`);
        console.log(`  └─ Absent                     : ${s.absentDays}`);
        console.log(`  Weekly offs (Sat/Sun)         : ${s.weeklyOffCount}   (worked: ${s.weekendWorkedCount})`);
        console.log(`  Public holidays               : ${s.holidayCount}   (worked: ${s.holidayWorkedCount})`);

        console.log('\n  ⏱️   Hours');
        console.log(d);
        console.log(`  Required (present+absent×8h)  : ${s.requiredHours}`);
        console.log(`  Work-day effective             : ${s.workDayEffective}`);
        console.log(`  Avg per work day               : ${s.avgPerWorkDay}  (${s.presentWorkDays} days)`);
        console.log(`  Total effective (all days)     : ${s.totalEffective}`);
        console.log(`  Total gross                    : ${s.totalGross}`);

        console.log('\n  📈  Overtime & balance');
        console.log(d);
        console.log(`  Overtime (>8h work + w/e + hol): ${s.overtime}`);
        console.log(`  Deficit  (<8h on work days)    : ${s.deficit}`);
        console.log(`  Net balance (work days only)   : ${s.netBalance}  ${s._netBalanceMin >= 0 ? '✅' : '⚠️'}`);
        if (s._weekendEffMin > 0) {
            console.log(`  Weekend work                   : ${s.weekendEffective}  (${s.weekendWorkedCount} day${s.weekendWorkedCount > 1 ? 's' : ''})`);
        }
        if (s._holidayEffMin > 0) {
            console.log(`  Holiday work                   : ${s.holidayEffective}  (${s.holidayWorkedCount} day${s.holidayWorkedCount > 1 ? 's' : ''})`);
        }

        console.log('\n' + D);
        console.log('\n  📋  Daily log');
        console.log(d);
        console.table(s.rows);
    }

    // ── Floating UI ─────────────────────────────────────────

    function renderPanel(s) {
        const old = document.getElementById('ot-calc-panel');
        if (old) old.remove();

        const panel = document.createElement('div');
        panel.id = 'ot-calc-panel';

        const pos = s._netBalanceMin >= 0;

        // Build month-selector buttons (last 12 months)
        const now = new Date();
        const monthBtns = Array.from({ length: 12 }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
            const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
            const full = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            const active = full === s.monthName ? ' active' : '';
            return `<button class="ot-month-btn${active}" data-month="${value}" title="${full}">${label}</button>`;
        }).join('');

        panel.innerHTML = `
<style>
#ot-calc-panel{position:fixed;top:70px;right:16px;z-index:99999;width:420px;max-height:92vh;overflow-y:auto;
  background:#0f172a;border:1px solid #1e293b;border-radius:16px;
  box-shadow:0 25px 50px -12px rgba(0,0,0,.5);font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;
  color:#e2e8f0;animation:otIn .3s ease-out}
@keyframes otIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
#ot-calc-panel *{box-sizing:border-box;margin:0}
#ot-calc-panel::-webkit-scrollbar{width:5px}
#ot-calc-panel::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}

.ot-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;
  background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:16px 16px 0 0}
.ot-hdr h3{font-size:15px;font-weight:600;color:#fff;letter-spacing:.3px}
.ot-hdr .sub{font-size:12px;color:rgba(255,255,255,.75);margin-top:2px}
.ot-x{background:rgba(255,255,255,.15);border:none;color:#fff;width:28px;height:28px;border-radius:8px;
  cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:background .2s}
.ot-x:hover{background:rgba(255,255,255,.3)}

.ot-body{padding:14px 18px}
.ot-sec{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.8px;margin:14px 0 8px;
  padding-bottom:5px;border-bottom:1px solid #1e293b}
.ot-sec:first-child{margin-top:0}

/* Month selector */
.ot-months{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.ot-month-btn{padding:5px 10px;border-radius:7px;border:1px solid #334155;background:transparent;
  color:#94a3b8;font-size:11px;font-weight:500;cursor:pointer;transition:all .2s}
.ot-month-btn:hover{background:rgba(99,102,241,.15);border-color:#6366f1;color:#a5b4fc}
.ot-month-btn.active{background:linear-gradient(135deg,#6366f1,#8b5cf6);border-color:transparent;color:#fff}

/* Balance banner */
.ot-bal{padding:14px 16px;border-radius:10px;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.ot-bal.pos{background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(16,185,129,.08));border:1px solid rgba(34,197,94,.2)}
.ot-bal.neg{background:linear-gradient(135deg,rgba(239,68,68,.12),rgba(244,63,94,.08));border:1px solid rgba(239,68,68,.2)}
.ot-bal-lbl{font-size:13px;color:#94a3b8}
.ot-bal-sub{font-size:11px;color:#64748b;margin-top:2px}
.ot-bal-val{font-size:22px;font-weight:700}

/* Cards grid */
.ot-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.ot-c{padding:12px 14px;border-radius:10px;position:relative;overflow:hidden}
.ot-c::before{content:'';position:absolute;inset:0;background:rgba(255,255,255,.03);
  border:1px solid rgba(255,255,255,.06);border-radius:10px;pointer-events:none}
.ot-c-l{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;position:relative}
.ot-c-v{font-size:19px;font-weight:700;position:relative}
.ot-c-s{font-size:10px;color:#64748b;margin-top:2px;position:relative}

.ot-c.purple  {background:linear-gradient(135deg,rgba(99,102,241,.15),rgba(139,92,246,.1))}
.ot-c.purple .ot-c-v{color:#a78bfa}
.ot-c.blue    {background:linear-gradient(135deg,rgba(59,130,246,.15),rgba(96,165,250,.1))}
.ot-c.blue .ot-c-v{color:#60a5fa}
.ot-c.green   {background:linear-gradient(135deg,rgba(34,197,94,.15),rgba(74,222,128,.1))}
.ot-c.green .ot-c-v{color:#4ade80}
.ot-c.cyan    {background:linear-gradient(135deg,rgba(6,182,212,.15),rgba(34,211,238,.1))}
.ot-c.cyan .ot-c-v{color:#22d3ee}
.ot-c.emerald {background:linear-gradient(135deg,rgba(16,185,129,.15),rgba(52,211,153,.1))}
.ot-c.emerald .ot-c-v{color:#34d399}
.ot-c.rose    {background:linear-gradient(135deg,rgba(244,63,94,.15),rgba(251,113,133,.1))}
.ot-c.rose .ot-c-v{color:#fb7185}
.ot-c.amber   {background:linear-gradient(135deg,rgba(245,158,11,.15),rgba(252,211,77,.1))}
.ot-c.amber .ot-c-v{color:#fcd34d}
.ot-c.orange  {background:linear-gradient(135deg,rgba(249,115,22,.15),rgba(251,146,60,.1))}
.ot-c.orange .ot-c-v{color:#fb923c}
.ot-c.violet  {background:linear-gradient(135deg,rgba(167,139,250,.15),rgba(196,181,253,.1))}
.ot-c.violet .ot-c-v{color:#c4b5fd}
.ot-c.sky     {background:linear-gradient(135deg,rgba(56,189,248,.15),rgba(125,211,252,.1))}
.ot-c.sky .ot-c-v{color:#7dd3fc}

/* Day chips */
.ot-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.ot-chip{padding:5px 11px;border-radius:20px;font-size:11px;font-weight:500;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#cbd5e1}
.ot-chip b{margin-right:3px}

.ot-foot{padding:10px 18px;border-top:1px solid #1e293b;text-align:center;font-size:10px;color:#475569}
</style>

<div class="ot-hdr">
  <div>
    <h3>📊 OT Calculator</h3>
    <div class="sub">${s.monthName}</div>
  </div>
  <button class="ot-x" id="ot-calc-close" title="Close">✕</button>
</div>

<div class="ot-body">
  <!-- Month selector -->
  <div class="ot-sec">Select Month</div>
  <div class="ot-months" id="ot-month-sel">${monthBtns}</div>

  <!-- Net balance banner -->
  <div class="ot-bal ${pos ? 'pos' : 'neg'}">
    <div>
      <div class="ot-bal-lbl">Net Balance (Work Days)</div>
      <div class="ot-bal-sub">${pos ? 'Surplus over required hours' : 'Deficit against required hours'}</div>
    </div>
    <div class="ot-bal-val" style="color:${pos ? '#4ade80' : '#f87171'}">${pos ? '+' : ''}${s.netBalance}</div>
  </div>

  <!-- Hours grid -->
  <div class="ot-sec">Hours Overview</div>
  <div class="ot-grid">
    <div class="ot-c purple">
      <div class="ot-c-l">Required</div>
      <div class="ot-c-v">${s.requiredHours}</div>
      <div class="ot-c-s">${s.presentWorkDays + s.absentDays} days × ${CONFIG.standardHoursPerDay}h</div>
    </div>
    <div class="ot-c blue">
      <div class="ot-c-l">Work-Day Effective</div>
      <div class="ot-c-v">${s.workDayEffective}</div>
      <div class="ot-c-s">Mon–Fri only</div>
    </div>
    <div class="ot-c green">
      <div class="ot-c-l">Total Effective</div>
      <div class="ot-c-v">${s.totalEffective}</div>
      <div class="ot-c-s">All days incl. W/E & Holidays</div>
    </div>
    <div class="ot-c cyan">
      <div class="ot-c-l">Total Gross</div>
      <div class="ot-c-v">${s.totalGross}</div>
      <div class="ot-c-s">Clock-in to clock-out</div>
    </div>
    <div class="ot-c emerald">
      <div class="ot-c-l">Overtime</div>
      <div class="ot-c-v">${s.overtime}</div>
      <div class="ot-c-s">&gt;${CONFIG.standardHoursPerDay}h + W/E + Holiday</div>
    </div>
    <div class="ot-c rose">
      <div class="ot-c-l">Deficit</div>
      <div class="ot-c-v">${s.deficit}</div>
      <div class="ot-c-s">&lt;${CONFIG.standardHoursPerDay}h on work days</div>
    </div>
    <div class="ot-c amber">
      <div class="ot-c-l">Avg / Work Day</div>
      <div class="ot-c-v">${s.avgPerWorkDay}</div>
      <div class="ot-c-s">${s.presentWorkDays} present days</div>
    </div>
    <div class="ot-c orange">
      <div class="ot-c-l">Weekend Work</div>
      <div class="ot-c-v">${s._weekendEffMin > 0 ? fmtMin(s._weekendEffMin) : '0h 0m'}</div>
      <div class="ot-c-s">${s.weekendWorkedCount} day${s.weekendWorkedCount !== 1 ? 's' : ''} worked</div>
    </div>
  </div>

  <!-- Attendance chips -->
  <div class="ot-sec">Attendance Summary</div>
  <div class="ot-chips">
    <div class="ot-chip"><b style="color:#4ade80">${s.presentWorkDays}</b>Present</div>
    <div class="ot-chip"><b style="color:#60a5fa">${s.weeklyOffCount}</b>W-Off</div>
    <div class="ot-chip"><b style="color:#fbbf24">${s.holidayCount}</b>Holiday</div>
    <div class="ot-chip"><b style="color:#fb923c">${s.leaveDays}</b>Leave</div>
    <div class="ot-chip"><b style="color:#f87171">${s.absentDays}</b>Absent</div>
  </div>
</div>

<div class="ot-foot">Keka OT Calculator • by Umang Vadadoriya</div>
`;

        document.body.appendChild(panel);

        // Close button
        document.getElementById('ot-calc-close').addEventListener('click', () => {
            panel.style.animation = 'otIn .2s ease-in reverse';
            setTimeout(() => panel.remove(), 200);
        });

        // Month selector click handler
        document.getElementById('ot-month-sel').addEventListener('click', async (e) => {
            const btn = e.target.closest('.ot-month-btn');
            if (!btn) return;
            const month = btn.dataset.month;
            console.log(`🔄  Switching to: ${month}`);
            // Show loading state
            btn.textContent = '⏳';
            try {
                const data = await fetchAttendance(month);
                const stats = compute(data);
                printReport(stats);
                renderPanel(stats);
            } catch (err) {
                console.error('❌', err.message);
                alert('Error: ' + err.message);
            }
        });
    }

    // ── Run ──────────────────────────────────────────────────

    try {
        console.log('🚀  Keka OT Calculator starting…');
        const month = resolveTargetMonth();
        console.log(`📅  Target month: ${month}`);

        const data = await fetchAttendance(month);
        console.log(`✅  Got ${data.length} days of data`);

        const stats = compute(data);
        printReport(stats);

        if (CONFIG.showUI) renderPanel(stats);

        return stats;
    } catch (err) {
        console.error('❌  Keka OT Calc error:', err.message);
        console.error(err);
    }
})();
