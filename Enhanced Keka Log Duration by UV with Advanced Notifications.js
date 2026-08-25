// ==UserScript==
// @name         Enhanced Keka Log Duration by UV with Advanced Notifications
// @name:en      Enhanced Keka Log Duration (English)
// @namespace    http://tampermonkey.net/
// @version      20.6
// @description  Calculate log durations with improved UI and smart notifications
// @description:en Calculate log durations with improved UI and smart notifications (English)
// @author       Umang Vadadoriya
// @tag          utility
// @tag          automation
// @match        https://*.keka.com/*
// @include      https://*.keka.com/*
// @exclude      https://*.keka.com/login*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=keka.com
// @grant        GM_notification
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @run-at       document-end
// @source       https://github.com/Umang-Vadadoriya
// @updateURL    https://gist.githubusercontent.com/Umang-Vadadoriya/ffc09708226db8bef988a0ecf1848518/raw/KekaEnhance.js
// @downloadURL  https://gist.githubusercontent.com/Umang-Vadadoriya/ffc09708226db8bef988a0ecf1848518/raw/KekaEnhance.js
// @supportURL   https://github.com/Umang-Vadadoriya
// @homepage     https://github.com/Umang-Vadadoriya
// @license      MIT
// @noframes
// @contributionURL https://github.com/Umang-Vadadoriya/
// @copyright    2026, Umang Vadadoriya (https://github.com/Umang-Vadadoriya)
// ==/UserScript==

(function () {
    'use strict';

    if (window.__kekaEnhanceLoaded) return;
    window.__kekaEnhanceLoaded = true;

    let modalOpen = false;
    let originalTitle = null;
    let plannedBreakMin = 0;
    let lastStartTime = null;
    let notificationInterval = null;
    let renderInterval = null;
    let manualTickInterval = null;
    let totalBreakTimeMinutes = 0;
    let notificationCounter = 0;
    let isUpdating = false;
    let isHalfDayMode = false;
    let isHalfDayAutoDetected = false;
    let debugMode = false;
    let uvClickCount = 0;
    let uvClickTimer = null;
    let isManualMode = false;
    let manualEntries = [];
    let showManualForm = false;
    let prefillInputs = null;
    let dayApiData = null;
    let tenMinAlertFired = false;
    let bannerDismissed = false;
    let previewBanner = false;
    let audioCtx = null;
    let notifierPairs = [];
    let notifierOpenInMs = null;

    const SCRIPT_VERSION = '20.6';
    const EIGHT_HOURS_IN_MINUTES = 8 * 60;
    const FOUR_HOURS_IN_MINUTES = 4 * 60;
    const NOTIFICATION_INTERVAL = 1;

    function getTargetHours() {
        return isHalfDayMode ? FOUR_HOURS_IN_MINUTES : EIGHT_HOURS_IN_MINUTES;
    }

    const NOTIFICATION_MESSAGES = [
        "Time check! {remaining} left in your workday. Keep going! 💠",
        "Quick update: {remaining} until you hit your 8-hour mark! 🎯",
        "Checking in - {remaining} to go. You've got this! 🌟",
        "Time flies! {remaining} remaining in your workday. Stay focused! 🚀",
        "Progress check: {remaining} left. Take a stretch if needed! 🧘‍♂️",
        "Head's up! {remaining} to complete your day. Keep up the great work! 👍",
        "Time update: {remaining} remaining. Remember to stay hydrated! 💧",
        "Almost there! {remaining} left in your workday. You're doing great! ⭐"
    ];

    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function showNotification(message) {
        if (Notification.permission === 'granted') {
            const notification = new Notification('Keka Time Alert', {
                body: message,
                icon: 'https://www.google.com/s2/favicons?sz=64&domain=keka.com',
                tag: 'keka-time-alert',
                requireInteraction: true,
                renotify: true,
                silent: false
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        }
    }

    function triggerTestNotification() {
        setTimeout(() => {
            showNotification('Test notification triggered! This is a 3-second delayed notification. 🔔');
        }, 3000);
    }

    function playAlertBeep() {

        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0, audioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.55);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.6);
        } catch {  }
    }

    function handleUVClick() {
        uvClickCount++;

        if (uvClickTimer) {
            clearTimeout(uvClickTimer);
        }

        if (uvClickCount === 3) {
            debugMode = !debugMode;
            console.log(`🐛 Debug Mode ${debugMode ? 'ENABLED' : 'DISABLED'}`);

            const container = document.querySelector('.modal-body form div[formarrayname="logs"]');
            if (container) {
                updateUI(container);
            }

            showNotification(`Debug Mode ${debugMode ? 'Enabled' : 'Disabled'}! 🐛`);

            uvClickCount = 0;
            uvClickTimer = null;
        } else {
            uvClickTimer = setTimeout(() => {
                uvClickCount = 0;
                uvClickTimer = null;
            }, 500);
        }
    }

    function getRandomNotificationMessage(remaining) {
        const messageIndex = notificationCounter % NOTIFICATION_MESSAGES.length;
        notificationCounter++;
        return NOTIFICATION_MESSAGES[messageIndex].replace('{remaining}', remaining);
    }

    function parseTime(timeStr) {
        if (!timeStr || timeStr === 'MISSING') return null;
        const [time, period] = timeStr.toLowerCase().split(' ');
        let [hours, minutes] = time.split(':').map(Number);

        if (period === 'pm' && hours !== 12) hours += 12;
        if (period === 'am' && hours === 12) hours = 0;

        return { hours, minutes };
    }

    function calculateDuration(startTimeStr, endTimeStr) {
        const start = parseTime(startTimeStr);
        const end = endTimeStr === 'MISSING' ?
            { hours: new Date().getHours(), minutes: new Date().getMinutes() } :
            parseTime(endTimeStr);

        if (!start || !end) return { hours: 0, minutes: 0 };

        let durationMinutes = (end.hours - start.hours) * 60 + (end.minutes - start.minutes);
        if (durationMinutes < 0) durationMinutes += 24 * 60;
        if (durationMinutes > 12 * 60) durationMinutes = 0;

        return {
            hours: Math.floor(durationMinutes / 60),
            minutes: durationMinutes % 60
        };
    }

    function timeToTodayMs(timeStr) {
        const t = parseTime(timeStr);
        if (!t) return null;
        const d = new Date();
        d.setHours(t.hours, t.minutes, 0, 0);
        return d.getTime();
    }
    function startMinutesOf(entry) {
        const t = parseTime(entry.start);
        return t ? t.hours * 60 + t.minutes : 0;
    }

    function formatDuration(hours, minutes) {
        return `${hours}h ${minutes}m`;
    }

    function formatDurationSec(totalSeconds) {
        const total = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return `${h}h ${m}m ${s}s`;
    }

    function formatDurationHTML(totalSeconds) {
        const total = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return `${h}<span class="dur-u">h</span> ${m}<span class="dur-u">m</span><span class="dur-s">·&nbsp;${s}s</span>`;
    }

    function subdueSecondsHTML(timeStr) {
        if (typeof timeStr !== 'string') return timeStr;
        return timeStr.replace(
            /(\d{1,2}:\d{2})(:\d{2})(\s*[ap]m)?/i,
            '$1<span style="opacity: 0.78; font-size: 0.7em; margin-left: 2px; font-weight: 500; letter-spacing: 0.3px;">$2</span>$3'
        );
    }

    function processManualEntries(renderOnUI = true) {
        if (manualEntries.length === 0) {
            return { isEmpty: true, totalDuration: 'N/A', firstStartTime: null, totalHours: 0, breakTime: 0 };
        }

        manualEntries.sort((a, b) => startMinutesOf(a) - startMinutesOf(b));

        const now = Date.now();
        let totalWorkMs = 0;
        let breakMs = 0;
        let openStartMs = null;
        let prevEndMs = null;
        const firstStartMs = timeToTodayMs(manualEntries[0].start);

        manualEntries.forEach((entry) => {
            const sMs = timeToTodayMs(entry.start);
            if (sMs == null) return;
            if (prevEndMs != null && sMs > prevEndMs) breakMs += sMs - prevEndMs;
            if (!entry.end) {
                totalWorkMs += Math.max(0, now - sMs);
                openStartMs = sMs;
                prevEndMs = now;
            } else {
                const eMs = timeToTodayMs(entry.end);
                totalWorkMs += Math.max(0, eMs - sMs);
                prevEndMs = eMs;
            }
        });

        const totalWorkSeconds = totalWorkMs / 1000;

        return {
            totalWorkSeconds,
            totalDuration: formatDurationSec(totalWorkSeconds),
            totalDurationHTML: formatDurationHTML(totalWorkSeconds),
            totalHours: totalWorkSeconds / 3600,
            breakMs,
            breakSeconds: Math.floor(breakMs / 1000),
            breakTime: Math.round(breakMs / 60000),
            firstStartTime: manualEntries[0].start,
            firstStartDate: firstStartMs != null ? new Date(firstStartMs) : undefined,
            manualOpenStartMs: openStartMs,
            isManual: true
        };
    }

    function punchMinutes(t) {
        const p = parseTime(t);
        return p ? p.hours * 60 + p.minutes : 0;
    }
    function flattenPunches() {
        const punches = [];
        manualEntries.forEach(e => {
            if (e.start) punches.push(e.start);
            if (e.end) punches.push(e.end);
        });
        return punches.sort((a, b) => punchMinutes(a) - punchMinutes(b));
    }

    function repairFromPunches(punches) {
        const sorted = [...punches].sort((a, b) => punchMinutes(a) - punchMinutes(b));
        const pairs = [];
        for (let i = 0; i < sorted.length; i += 2) {
            pairs.push({ start: sorted[i], end: sorted[i + 1] || null });
        }
        manualEntries = pairs;
    }
    function insertPunch(timeStr) {
        const n = normalizeTimeFormat(timeStr);
        if (!n) return false;
        const p = flattenPunches();
        p.push(n);
        repairFromPunches(p);
        return true;
    }
    function removePunchAt(index) {
        const p = flattenPunches();
        if (index < 0 || index >= p.length) return;
        p.splice(index, 1);
        repairFromPunches(p);
    }

    function validateTimeFormat(timeStr) {

        const timeRegex = /^(0?[1-9]|1[0-2]):([0-5][0-9])\s?(AM|PM|am|pm)$/i;
        return timeRegex.test(timeStr.trim());
    }

    function normalizeTimeFormat(timeStr) {

        const trimmed = timeStr.trim();
        const match = trimmed.match(/^(0?[1-9]|1[0-2]):([0-5][0-9])\s?(AM|PM|am|pm)$/i);
        if (!match) return null;

        const [, hours, minutes, period] = match;
        const paddedHours = hours.padStart(2, '0');
        return `${paddedHours}:${minutes} ${period.toUpperCase()}`;
    }

    function isStartBeforeEnd(startTime, endTime) {
        const start = parseTime(startTime);
        const end = parseTime(endTime);

        if (!start || !end) return false;

        const startMinutes = start.hours * 60 + start.minutes;
        const endMinutes = end.hours * 60 + end.minutes;

        return startMinutes < endMinutes;
    }

    function validateManualEntry(startTime, endTime) {
        const errors = [];
        const hasEnd = !!(endTime && endTime.trim() !== '');

        if (!startTime || startTime.trim() === '') {
            errors.push('Start time is required');
        } else if (!validateTimeFormat(startTime)) {
            errors.push('Invalid start time format. Use HH:MM AM/PM (e.g., 9:00 AM)');
        }

        if (hasEnd && !validateTimeFormat(endTime)) {
            errors.push('Invalid end time format. Use HH:MM AM/PM (e.g., 5:00 PM)');
        }

        if (errors.length === 0 && hasEnd && !isStartBeforeEnd(startTime, endTime)) {
            errors.push('End time must be after start time');
        }

        return {
            isValid: errors.length === 0,
            errors,
            isOpen: !hasEnd
        };
    }

    function renderManualEntryUI(container) {
        const gradients = {
            purple: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
            blue: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
            green: 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)',
            orange: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
            pink: 'linear-gradient(135deg, #f472b6 0%, #db2777 100%)',
            red: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
        };

        let previewHTML = '';
        if (manualEntries.length > 0) {
            const preview = processManualEntries(false);
            const breakHTML = Number.isFinite(preview.breakSeconds)
                ? formatDurationHTML(preview.breakSeconds)
                : formatDurationHTML((preview.breakTime || 0) * 60);
            // Projected leave time for these entries, plus an adjustable extra
            // break — belongs here because it's derived from the punches you're
            // modelling (first punch + target + breaks so far + planned break).
            const targetLbl = isHalfDayMode ? '4hr' : '8hr';
            const baseBreakMs = Number.isFinite(preview.breakMs) ? preview.breakMs : (preview.breakTime || 0) * 60000;
            const plannedOut = (calculateTargetCompletion(preview.firstStartTime, preview.totalHours, preview.breakTime, {
                firstStartDate: preview.firstStartDate,
                breakMs: baseBreakMs + plannedBreakMin * 60000,
                totalWorkSeconds: preview.totalWorkSeconds,
            }).completionTime || 'N/A').replace(' (Completed ✓)', '');
            // Break presets as tap chips + a custom-minutes input on the
            // "Leave by" card. Active preset is inverted; a non-preset value
            // lives in the custom box.
            const presets = [0, 15, 30, 45, 60];
            const isCustomBreak = plannedBreakMin > 0 && !presets.includes(plannedBreakMin);
            const breakChips = presets.map(m => {
                const on = plannedBreakMin === m;
                return `<button class="break-plan-chip" data-min="${m}" style="padding:5px 8px;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums;background:${on ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.16)'};color:${on ? '#1d4ed8' : '#fff'};">${m === 0 ? 'None' : '+' + m}</button>`;
            }).join('');
            previewHTML = `
                <div style="padding: 14px 16px; background: ${gradients.blue}; border-radius: 12px; color: white; margin-bottom: 12px;">
                    <div style="font-size: 13px; opacity: 0.9; margin-bottom: 4px; font-weight: 500;">🎯 Leave by (${targetLbl})</div>
                    <div style="font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums;">${subdueSecondsHTML(plannedOut)}</div>
                    <div style="display: flex; align-items: center; gap: 5px; margin-top: 12px; flex-wrap: nowrap;">
                        <span style="font-size: 14px; margin-right: 1px; flex-shrink: 0;">☕</span>
                        ${breakChips}
                        <input id="break-plan-custom" type="number" min="0" max="480" inputmode="numeric" placeholder="min" value="${isCustomBreak ? plannedBreakMin : ''}" title="Custom minutes"
                            style="width:48px;flex-shrink:0;padding:5px 4px;border:none;border-radius:7px;font-size:12px;font-weight:700;text-align:center;box-sizing:border-box;font-variant-numeric:tabular-nums;background:${isCustomBreak ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.16)'};color:${isCustomBreak ? '#1d4ed8' : '#fff'};">
                    </div>
                </div>
                <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                    <div style="flex: 1; padding: 14px 16px; background: ${gradients.green}; border-radius: 12px; color: white;">
                        <div style="font-size: 13px; opacity: 0.9; margin-bottom: 4px; font-weight: 500;">Preview Total</div>
                        <div style="font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums;">${preview.totalDurationHTML || preview.totalDuration}</div>
                    </div>
                    <div style="flex: 1; padding: 14px 16px; background: ${gradients.pink}; border-radius: 12px; color: white;">
                        <div style="font-size: 13px; opacity: 0.9; margin-bottom: 4px; font-weight: 500;">Break</div>
                        <div style="font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums;">${breakHTML}</div>
                    </div>
                </div>
            `;
        }

        let entriesListHTML = '';
        if (manualEntries.length > 0) {
            const punchChip = (label, time, punchIdx, isNow) => `
                <span style="display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:6px 10px;background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.3);border-radius:8px;font-size:13px;font-weight:600;color:inherit;">
                    <span style="opacity:0.6;font-size:11px;font-weight:700;letter-spacing:0.4px;flex-shrink:0;">${label}</span>
                    ${isNow ? '<span style="background:rgba(34,197,94,0.18);color:#22c55e;padding:1px 7px;border-radius:6px;font-weight:700;">now</span>' : `<span style="white-space:nowrap;">${time}</span><button class="remove-punch-btn" data-punch="${punchIdx}" title="Remove this punch" aria-label="Remove punch" style="margin-left:auto;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:none;border-radius:50%;background:rgba(239,68,68,0.2);color:#ef4444;font-size:13px;line-height:1;cursor:pointer;">×</button>`}
                </span>`;
            entriesListHTML = '<div style="margin-bottom: 16px; display:flex; flex-direction:column; gap:8px;">';
            let prevEnd = null;
            manualEntries.forEach((entry, index) => {
                const isOpen = !entry.end;
                const inIdx = index * 2, outIdx = index * 2 + 1;

                const work = calculateDuration(entry.start, entry.end || 'MISSING');
                const workText = `${work.hours}h ${work.minutes}m`;
                const brk = prevEnd ? calculateDuration(prevEnd, entry.start) : null;
                const breakText = brk ? `${brk.hours}h ${brk.minutes}m` : null;
                const capsuleHTML = brk
                    ? `<div class="duration-capsule dual-capsule"><div class="work-side" data-work="${workText}" title="Work: ${workText}"><span class="work-text">${workText}</span></div><div class="break-side" data-break="${breakText}" title="Break: ${breakText}"><span class="break-text">${breakText}</span></div></div>`
                    : `<div class="duration-capsule work-only">Work: ${workText}</div>`;
                entriesListHTML += `
                    <div style="
                        padding: 10px 12px;
                        background: rgba(148, 163, 184, 0.08);
                        border: 1px solid rgba(148, 163, 184, 0.25);
                        border-radius: 10px;
                    ">
                        <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;">
                            ${punchChip('IN', entry.start, inIdx, false)}
                            <span style="opacity:0.4;">→</span>
                            ${punchChip('OUT', entry.end, outIdx, isOpen)}
                        </div>
                        <div style="margin-top:8px;display:flex;align-items:center;gap:8px;">${capsuleHTML}${isOpen ? '<span style="font-size:11px;opacity:0.6;">· working</span>' : ''}</div>
                    </div>
                `;
                prevEnd = entry.end;
            });
            entriesListHTML += '</div>';
        }

        const manualUI = `
            <div class="manual-entry-container">
                <div style="
                    text-align: center;
                    margin-bottom: 20px;
                    padding-bottom: 16px;
                    border-bottom: 1px solid rgba(148, 163, 184, 0.25);
                ">
                    <div style="font-size: 20px; font-weight: 700; color: inherit; margin-bottom: 4px;">📝 Manual Log Entry</div>
                    <div style="font-size: 13px; color: inherit; opacity: 0.65;">Add your time entries manually</div>
                </div>

                ${previewHTML}
                ${manualEntries.length > 0 ? `
                <div style="display:flex;align-items:center;gap:8px;margin:0 0 14px;opacity:0.5;font-size:10px;font-weight:700;letter-spacing:0.6px;">
                    <div style="flex:1;height:1px;background:rgba(148,163,184,0.3);"></div>
                    PUNCHES
                    <div style="flex:1;height:1px;background:rgba(148,163,184,0.3);"></div>
                </div>` : ''}
                ${entriesListHTML}

                <div id="manual-error-message" style="
                    display: none;
                    padding: 12px;
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                    border-radius: 8px;
                    color: white;
                    font-size: 13px;
                    font-weight: 500;
                    margin-bottom: 16px;
                "></div>

                <div style="
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 12px;
                    margin-bottom: 16px;
                ">
                    <div>
                        <label style="
                            display: block;
                            font-size: 12px;
                            font-weight: 600;
                            color: inherit;
                            opacity: 0.7;
                            margin-bottom: 6px;
                        ">Start Time</label>
                        <input
                            type="text"
                            id="manual-start-time"
                            placeholder="9:00 AM"
                            style="
                                width: 100%;
                                padding: 10px 12px;
                                border: 1px solid rgba(148, 163, 184, 0.35);
                                background: rgba(148, 163, 184, 0.14);
                                color: inherit;
                                border-radius: 8px;
                                font-size: 14px;
                                transition: border-color 0.2s, box-shadow 0.2s;
                                box-sizing: border-box;
                            "
                        />
                    </div>
                    <div>
                        <label style="
                            display: block;
                            font-size: 12px;
                            font-weight: 600;
                            color: inherit;
                            opacity: 0.7;
                            margin-bottom: 6px;
                        ">End Time</label>
                        <input
                            type="text"
                            id="manual-end-time"
                            placeholder="5:00 PM or blank"
                            style="
                                width: 100%;
                                padding: 10px 12px;
                                border: 1px solid rgba(148, 163, 184, 0.35);
                                background: rgba(148, 163, 184, 0.14);
                                color: inherit;
                                border-radius: 8px;
                                font-size: 14px;
                                transition: border-color 0.2s, box-shadow 0.2s;
                                box-sizing: border-box;
                            "
                        />
                    </div>
                </div>

                <button id="add-manual-entry-btn" style="
                    width: 100%;
                    padding: 12px 20px;
                    background: ${manualEntries.length > 0 ? 'transparent' : gradients.purple};
                    color: ${manualEntries.length > 0 ? 'inherit' : 'white'};
                    border: ${manualEntries.length > 0 ? '1px solid rgba(148, 163, 184, 0.4)' : 'none'};
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    box-shadow: ${manualEntries.length > 0 ? 'none' : '0 4px 6px rgba(0, 0, 0, 0.1)'};
                    margin-bottom: 12px;
                ">➕ Add In + Out pair</button>

                ${manualEntries.length > 0 ? `
                <div style="display:flex;align-items:center;gap:8px;margin:4px 0 12px;opacity:0.5;font-size:11px;">
                    <div style="flex:1;height:1px;background:rgba(148,163,184,0.3);"></div>
                    or fix one punch
                    <div style="flex:1;height:1px;background:rgba(148,163,184,0.3);"></div>
                </div>

                <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:16px;">
                    <input
                        type="text"
                        id="manual-insert-time"
                        placeholder="e.g. 1:30 PM"
                        style="width:100%;padding:10px 12px;border:1px solid rgba(148,163,184,0.35);background:rgba(148,163,184,0.14);color:inherit;border-radius:8px;font-size:14px;box-sizing:border-box;transition:border-color 0.2s, box-shadow 0.2s;"
                    />
                    <button id="insert-punch-btn" style="padding:10px 16px;background:transparent;color:#3b82f6;border:1px solid rgba(59,130,246,0.5);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all 0.2s ease;">↳ Insert punch</button>
                </div>
                ` : ''}

                ${manualEntries.length > 0 ? `
                    <button id="calculate-manual-btn" style="
                        width: 100%;
                        padding: 12px 20px;
                        background: ${gradients.green};
                        color: white;
                        border: none;
                        border-radius: 10px;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                        margin-bottom: 12px;
                    ">✓ Calculate & Show Metrics</button>
                ` : ''}

                <button id="exit-manual-mode-btn" style="
                    width: 100%;
                    padding: 10px 20px;
                    background: transparent;
                    color: inherit;
                    opacity: 0.75;
                    border: 1px solid rgba(148, 163, 184, 0.35);
                    border-radius: 10px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                ">${manualEntries.length > 0 ? '← Back to Results' : '← Cancel'}</button>

                <style>
                    #manual-start-time:focus, #manual-end-time:focus, #manual-insert-time:focus {
                        outline: none;
                        border-color: #a78bfa;
                        box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.25);
                    }
                    .remove-punch-btn { transition: background 0.15s ease, transform 0.1s ease; }
                    .remove-punch-btn:hover { background: rgba(239, 68, 68, 0.32) !important; color: #fff !important; }
                    .remove-punch-btn:focus-visible { outline: 2px solid #ef4444; outline-offset: 1px; }
                    .remove-punch-btn:active { transform: scale(0.9); }
                    #add-manual-entry-btn:hover, #insert-punch-btn:hover { filter: brightness(1.05); border-color: rgba(148, 163, 184, 0.6); }
                    .manual-entry-container .dur-u { font-size: 0.62em; font-weight: 500; opacity: 0.78; margin-left: 1px; }
                    .manual-entry-container .dur-s { font-size: 0.7em; font-weight: 500; opacity: 0.78; margin-left: 8px; letter-spacing: 0.3px; }
                    .uv-signature {
                        position: relative;
                        overflow: visible;
                    }
                    .uv-text {
                        position: relative;
                        display: inline-block;
                        transition: all 0.3s ease;
                    }
                    .uv-full-name {
                        position: absolute;
                        bottom: calc(100% + 8px);
                        left: 50%;
                        transform: translateX(-50%) translateY(10px);
                        background: #7c3aed;
                        color: white;
                        padding: 7px 13px;
                        border-radius: 8px;
                        font-size: 11.5px;
                        font-weight: 600;
                        letter-spacing: 0.2px;
                        white-space: nowrap;
                        opacity: 0;
                        pointer-events: none;
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        box-shadow: 0 6px 16px rgba(124, 58, 237, 0.32);
                        z-index: 1000;
                    }
                    .uv-full-name::after {
                        content: '';
                        position: absolute;
                        top: 100%;
                        left: 50%;
                        transform: translateX(-50%);
                        border: 5px solid transparent;
                        border-top-color: #7c3aed;
                    }
                    .uv-text:hover .uv-full-name {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                    @keyframes uv-heartbeat {
                        0%, 100% { transform: scale(1); }
                        15% { transform: scale(1.28); }
                        30% { transform: scale(1); }
                        45% { transform: scale(1.16); }
                        60% { transform: scale(1); }
                    }
                    .uv-heart {
                        display: inline-block;
                        animation: uv-heartbeat 1.8s ease-in-out infinite;
                    }
                    @keyframes uv-shimmer {
                        to { background-position: 200% center; }
                    }
                    .uv-text:hover {
                        background: linear-gradient(90deg, #a855f7, #6366f1, #ec4899, #a855f7);
                        background-size: 200% auto;
                        -webkit-background-clip: text;
                        background-clip: text;
                        -webkit-text-fill-color: transparent;
                        text-shadow: none !important;
                        animation: uv-shimmer 2s linear infinite;
                    }
                    .uv-full-name {
                        -webkit-text-fill-color: #fff;
                    }
                </style>
                <div style="
                    text-align: center;
                    margin-top: 20px;
                    padding: 10px 16px 0;
                    border-top: 1px solid rgba(148, 163, 184, 0.25);
                    font-size: 10px;
                    color: inherit;
                    font-weight: 500;
                    letter-spacing: 0.5px;
                " class="uv-signature">
                    <span style="opacity: 0.6;">Made with <span class="uv-heart">💜</span> by </span><span style="color: #a855f7; font-weight: 700; text-shadow: 0 0 10px rgba(168, 85, 247, 0.45);" class="uv-text">UV<span class="uv-full-name">Umang Vadadoriya 👋</span></span><span style="opacity: 0.5; font-size: 9px; margin-left: 7px; letter-spacing: 0;">·&nbsp;v${SCRIPT_VERSION}</span>
                </div>
            </div>
        `;

        return manualUI;
    }

    function attachManualEntryHandlers(container) {
        const addBtn = document.getElementById('add-manual-entry-btn');
        const calculateBtn = document.getElementById('calculate-manual-btn');
        const exitBtn = document.getElementById('exit-manual-mode-btn');
        const startInput = document.getElementById('manual-start-time');
        const endInput = document.getElementById('manual-end-time');
        const errorMsg = document.getElementById('manual-error-message');

        if (prefillInputs) {
            if (startInput) startInput.value = prefillInputs.start || '';
            if (endInput) endInput.value = prefillInputs.end || '';
            prefillInputs = null;
        }

        function showError(message) {
            errorMsg.textContent = message;
            errorMsg.style.display = 'block';
            setTimeout(() => {
                errorMsg.style.display = 'none';
            }, 5000);
        }

        function clearError() {
            errorMsg.style.display = 'none';
        }

        if (addBtn) {
            addBtn.addEventListener('click', () => {
                clearError();
                const startTime = startInput.value.trim();
                const endTime = endInput.value.trim();

                const validation = validateManualEntry(startTime, endTime);
                if (!validation.isValid) {
                    showError(validation.errors.join('. '));
                    return;
                }

                const punches = flattenPunches();
                punches.push(normalizeTimeFormat(startTime));
                if (endTime) punches.push(normalizeTimeFormat(endTime));
                repairFromPunches(punches);

                startInput.value = '';
                endInput.value = '';
                updateUI(container);
            });
        }

        const insertBtn = document.getElementById('insert-punch-btn');
        const insertInput = document.getElementById('manual-insert-time');
        if (insertBtn && insertInput) {
            const doInsert = () => {
                clearError();
                const t = insertInput.value.trim();
                if (!validateTimeFormat(t)) {
                    showError('Invalid time format. Use HH:MM AM/PM (e.g., 1:30 PM)');
                    return;
                }
                insertPunch(t);
                insertInput.value = '';
                updateUI(container);
            };
            insertBtn.addEventListener('click', doInsert);
            insertInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doInsert(); });
        }

        if (calculateBtn) {
            calculateBtn.addEventListener('click', () => {
                if (manualEntries.length > 0) {
                    isManualMode = true;
                    showManualForm = false;
                    updateUI(container);
                }
            });
        }

        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
                isManualMode = false;
                showManualForm = false;
                manualEntries = [];
                prefillInputs = null;
                if (manualTickInterval) { clearInterval(manualTickInterval); manualTickInterval = null; }
                updateUI(container);
            });
        }

        document.querySelectorAll('.remove-punch-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-punch'));
                removePunchAt(idx);
                updateUI(container);
            });
        });

        document.querySelectorAll('.break-plan-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                plannedBreakMin = parseInt(e.currentTarget.getAttribute('data-min')) || 0;
                updateUI(container);
            });
        });
        const bpCustom = document.getElementById('break-plan-custom');
        if (bpCustom) {
            // 'change' (Enter/blur), not 'input' — the manual form doesn't auto
            // re-render, so this keeps focus while typing and applies on commit.
            bpCustom.addEventListener('change', () => {
                const v = parseInt(bpCustom.value, 10);
                plannedBreakMin = Number.isFinite(v) ? Math.min(480, Math.max(0, v)) : 0;
                updateUI(container);
            });
        }

        if (addBtn) {
            addBtn.addEventListener('mouseenter', () => {
                addBtn.style.transform = 'translateY(-2px)';
                addBtn.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.15)';
            });
            addBtn.addEventListener('mouseleave', () => {
                addBtn.style.transform = 'translateY(0)';
                addBtn.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
            });
        }

        if (calculateBtn) {
            calculateBtn.addEventListener('mouseenter', () => {
                calculateBtn.style.transform = 'translateY(-2px)';
                calculateBtn.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.15)';
            });
            calculateBtn.addEventListener('mouseleave', () => {
                calculateBtn.style.transform = 'translateY(0)';
                calculateBtn.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
            });
        }

        if (exitBtn) {
            exitBtn.addEventListener('mouseenter', () => {
                exitBtn.style.borderColor = 'rgba(148, 163, 184, 0.6)';
                exitBtn.style.opacity = '1';
            });
            exitBtn.addEventListener('mouseleave', () => {
                exitBtn.style.borderColor = 'rgba(148, 163, 184, 0.35)';
                exitBtn.style.opacity = '0.75';
            });
        }
    }

    function processTimeEntries(container, renderOnUI = true) {
        if (!container) return null;

        const timeRows = container.querySelectorAll('.ng-untouched.ng-pristine.ng-valid');

        if (isManualMode && manualEntries.length > 0) {
            return processManualEntries(renderOnUI);
        }

        const validTimeRows = Array.from(timeRows).filter(row => {
            const hasStartTime = row.querySelector('.d-flex.align-items-center .w-120.mr-20 .text-small');
            const hasEndTime = row.querySelector('.d-flex.align-items-center .w-120:not(.mr-20) .text-small');
            return hasStartTime || hasEndTime;
        });

        if (validTimeRows.length === 0) {
            return { isEmpty: true, totalDuration: 'N/A', firstStartTime: null, totalHours: 0, breakTime: 0 };
        }

        let totalMinutes = 0;
        let firstStartTime = null;
        let breakTime = 0;
        let startTime = null;
        let endTime = null;
        let brekduration = null;

        validTimeRows.forEach((row, index) => {
            const startTimeElement = row.querySelector('.d-flex.align-items-center .w-120.mr-20 .text-small');
            const endTimeElement = row.querySelector('.d-flex.align-items-center .w-120:not(.mr-20) .text-small');

            startTime = startTimeElement ? startTimeElement.textContent.trim() : null;

            if (index === 0) {
                firstStartTime = startTime;
            } else if (endTime) {
                brekduration = calculateDuration(endTime, startTime);
                breakTime += brekduration.hours * 60 + brekduration.minutes;
            }

            endTime = endTimeElement ? endTimeElement.textContent.trim() : null;
            const duration = calculateDuration(startTime, endTime);
            totalMinutes += duration.hours * 60 + duration.minutes;

            if (renderOnUI && !row.querySelector('.duration-info')) {
                const durationInfoElement = document.createElement('div');
                durationInfoElement.className = 'duration-info';

                const workText = `${duration.hours}h ${duration.minutes}m`;
                const breakText = brekduration ? `${brekduration.hours}h ${brekduration.minutes}m` : null;

                if (brekduration && index !== 0) {
                    durationInfoElement.innerHTML = `<div class="duration-capsule dual-capsule"><div class="work-side" data-work="${workText}" title="Work: ${workText}"><span class="work-text">${workText}</span></div><div class="break-side" data-break="${breakText}" title="Break: ${breakText}"><span class="break-text">${breakText}</span></div></div>`;
                } else {
                    durationInfoElement.innerHTML = `<div class="duration-capsule work-only">Work: ${workText}</div>`;
                }

                row.appendChild(durationInfoElement);
            }
        });

        const totalHours = Math.floor(totalMinutes / 60);
        const totalMins = totalMinutes % 60;

        return {
            totalDuration: formatDuration(totalHours, totalMins),
            firstStartTime,
            totalHours: totalHours + totalMins / 60,
            breakTime,
        };
    }

    function extractPageEntries(container) {
        if (!container) return { pairs: [], openStart: null };
        const timeRows = container.querySelectorAll('.ng-untouched.ng-pristine.ng-valid');
        const pairs = [];
        let openStart = null;
        Array.from(timeRows).forEach(row => {
            const startEl = row.querySelector('.d-flex.align-items-center .w-120.mr-20 .text-small');
            const endEl   = row.querySelector('.d-flex.align-items-center .w-120:not(.mr-20) .text-small');
            const rawStart = startEl ? startEl.textContent.trim() : '';
            const rawEnd   = endEl   ? endEl.textContent.trim()   : '';
            if (!rawStart) return;
            const normStart = normalizeTimeFormat(rawStart);
            if (!normStart) return;
            if (!rawEnd || rawEnd === 'MISSING') {
                openStart = normStart;
                return;
            }
            const normEnd = normalizeTimeFormat(rawEnd);
            if (!normEnd) return;
            pairs.push({ start: normStart, end: normEnd });
        });
        return { pairs, openStart };
    }

    function calculateTargetCompletion(firstStartTime, totalWorkedHours, totalBreakTime, opts) {

        if (!firstStartTime) return { completionTime: 'N/A', overtime: 'N/A' };

        const hasPreciseInputs = !!(opts && (opts.firstStartDate instanceof Date || Number.isFinite(opts.breakMs)));

        let startDate;
        if (opts && opts.firstStartDate instanceof Date) {
            startDate = opts.firstStartDate;
        } else {
            const start = parseTime(firstStartTime);
            if (!start) return { completionTime: 'N/A', overtime: 'N/A' };
            startDate = new Date();
            startDate.setHours(start.hours, start.minutes, 0);
        }

        const targetMinutes = getTargetHours();
        const targetSeconds = targetMinutes * 60;
        const totalWorkSeconds = (opts && Number.isFinite(opts.totalWorkSeconds))
            ? opts.totalWorkSeconds
            : totalWorkedHours * 3600;

        const breakMs = (opts && Number.isFinite(opts.breakMs))
            ? opts.breakMs
            : (totalBreakTime * 60 * 1000);
        const rawCompletionMs = startDate.getTime() + (targetMinutes * 60 * 1000) + breakMs;
        const completionDate = hasPreciseInputs
            ? new Date(rawCompletionMs)
            : new Date(Math.ceil(rawCompletionMs / 60000) * 60000);
        let completionTime = completionDate.toLocaleTimeString('en-IN', hasPreciseInputs ? {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        } : {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        if (totalWorkSeconds >= targetSeconds) {
            completionTime += ' (Completed ✓)';
        }

        const overtimeSec = totalWorkSeconds > targetSeconds ? Math.floor(totalWorkSeconds - targetSeconds) : 0;
        const overtime = overtimeSec > 0 ? formatDurationSec(overtimeSec) : 'No overtime';
        const overtimeHTML = overtimeSec > 0 ? formatDurationHTML(overtimeSec) : 'No overtime';

        return { completionTime, overtime, overtimeHTML };
    }

    function formatSimpleRemainingTime(minutes) {
        const targetHours = isHalfDayMode ? 4 : 8;
        if (minutes <= 0) return `${targetHours} hours completed! 🎉`;

        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        if (hours === 0) {
            return `${mins} minutes`;
        } else if (mins === 0) {
            return `${hours} hour${hours > 1 ? 's' : ''}`;
        } else {
            return `${hours} hour${hours > 1 ? 's' : ''} and ${mins} minute${mins > 1 ? 's' : ''}`;
        }
    }

    function calculateRemainingTime(startTimeStr, breakTimeMinutes, opts) {

        const targetMinutes = getTargetHours();
        const targetSeconds = targetMinutes * 60;

        if (opts && Number.isFinite(opts.totalWorkSeconds)) {
            const effectiveSec = opts.totalWorkSeconds;
            const remainingSec = targetSeconds - effectiveSec;

            const remainingMin = Math.round(remainingSec / 60);
            return {
                remaining: Math.max(0, remainingMin),
                remainingSeconds: Math.max(0, remainingSec),
                completed: effectiveSec >= targetSeconds,
                overtime: Math.min(0, remainingMin),
            };
        }

        const start = parseTime(startTimeStr);
        if (!start) return null;

        const now = new Date();
        const startDate = new Date();
        startDate.setHours(start.hours, start.minutes, 0);

        let elapsedMinutes = Math.floor((now - startDate) / (1000 * 60));
        if (elapsedMinutes < 0) elapsedMinutes += 24 * 60;

        const effectiveWorkMinutes = elapsedMinutes - breakTimeMinutes;
        const remainingMinutes = targetMinutes - effectiveWorkMinutes;

        return {
            remaining: Math.max(0, remainingMinutes),
            completed: effectiveWorkMinutes >= targetMinutes,
            overtime: Math.min(0, remainingMinutes)
        };
    }

    function shouldNotify(remaining) {
        const hours = Math.floor(remaining / 60);
        const minutes = remaining % 60;

        return (hours >= 2 && hours <= 8 && minutes === 0) ||
               (hours === 0 && [60, 50, 40, 30, 20, 15, 5, 0].includes(minutes));
    }

    function shouldNotifyOvertime(overtimeMinutes) {
        const hours = Math.floor(overtimeMinutes / 60);
        const minutes = overtimeMinutes % 60;
        return (hours >= 1 && hours <= 5 && minutes === 0) ||
               (hours === 0 && [5, 10, 15, 20, 25, 30].includes(minutes));
    }

    function startBackgroundNotifications() {
        if (notificationInterval) clearInterval(notificationInterval);
        if (renderInterval) clearInterval(renderInterval);
        if (isViewingOtherEmployee()) return;

        const container = document.querySelector('.modal-body form div[formarrayname="logs"]');
        if (!container) return;

        const firstStartElement = container.querySelector('.d-flex.align-items-center .w-120.mr-20 .text-small');
        if (!firstStartElement) return;

        lastStartTime = firstStartElement.textContent.trim();
        const results = processTimeEntries(container, false);
        totalBreakTimeMinutes = results ? results.breakTime : 0;

        notificationInterval = setInterval(() => {

            let liveWorkSec = null;
            if (notifierPairs && notifierPairs.length) {
                liveWorkSec = 0;
                for (const p of notifierPairs) {
                    liveWorkSec += (new Date(p.outTime).getTime() - new Date(p.inTime).getTime()) / 1000;
                }
                if (notifierOpenInMs != null) {
                    liveWorkSec += Math.max(0, (Date.now() - notifierOpenInMs) / 1000);
                }
            }
            const remainingTime = calculateRemainingTime(
                lastStartTime,
                totalBreakTimeMinutes,
                liveWorkSec != null ? { totalWorkSeconds: liveWorkSec } : undefined
            );
            if (!remainingTime) return;

            const targetLabel = isHalfDayMode ? '4h' : '8h';
            if (!remainingTime.completed && remainingTime.remaining === 10 && !tenMinAlertFired) {
                showNotification(`⏰ 10 minutes to ${targetLabel} — start wrapping up!`);
                playAlertBeep();
                tenMinAlertFired = true;
            } else if (remainingTime.overtime < 0) {
                const overtimeMinutes = Math.abs(remainingTime.overtime);
                if (shouldNotifyOvertime(overtimeMinutes)) {
                    const hours = Math.floor(overtimeMinutes / 60);
                    const minutes = overtimeMinutes % 60;
                    let msg = "You're working overtime! ";
                    if (hours > 0) msg += `${hours} hour${hours > 1 ? 's' : ''} `;
                    if (minutes > 0) msg += `${minutes} minute${minutes > 1 ? 's' : ''} `;
                    showNotification(msg + "extra! 🚀");
                }
            } else if (!remainingTime.completed && shouldNotify(remainingTime.remaining)) {
                showNotification(getRandomNotificationMessage(formatSimpleRemainingTime(remainingTime.remaining)));
            } else if (remainingTime.completed && remainingTime.remaining === 0) {
                showNotification(`Congratulations! You've completed your ${isHalfDayMode ? 4 : 8}-hour workday! 🎉`);
            }

            if (remainingTime.remaining > 10 || remainingTime.completed) {
                tenMinAlertFired = false;
                bannerDismissed = false;
            }
            updateUI(container);
        }, NOTIFICATION_INTERVAL * 60 * 1000);

        renderInterval = setInterval(() => {
            if (!modalOpen || showManualForm || notifierOpenInMs == null) return;
            updateUI(container);
        }, 1000);
    }

    function stopBackgroundNotifications() {
        if (notificationInterval) {
            clearInterval(notificationInterval);
            notificationInterval = null;
        }
        if (renderInterval) {
            clearInterval(renderInterval);
            renderInterval = null;
        }
        if (manualTickInterval) {
            clearInterval(manualTickInterval);
            manualTickInterval = null;
        }
        lastStartTime = null;
        totalBreakTimeMinutes = 0;
        notifierPairs = [];
        notifierOpenInMs = null;
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).catch(err => {
            console.error('Failed to copy:', err);
        });
    }

    function formatCopyText(emoji, label, value) {
        return `${emoji}\n${label}:\n${value}`;
    }

    function getSelectedDateInfo() {
        const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        let txt = '';
        const dateTextEl = document.querySelector('.modal-body kk-text-styles[label="Selected date"]');
        if (dateTextEl) {
            txt = (dateTextEl.innerText || dateTextEl.textContent || '').trim();
        }
        if (!txt) {
            const input =
                document.querySelector('input[formcontrolname="selectedDate"]') ||
                document.querySelector('input[name="selectedDate"]') ||
                document.querySelector('.modal-body input[type="text"]');
            if (input) txt = input.value || '';
        }
        if (!txt) return null;
        const m = txt.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
        if (!m) return null;
        const mIdx = MONTHS[m[2].slice(0, 3)];
        if (mIdx === undefined) return null;
        const yyyy = m[3];
        const mm = String(mIdx + 1).padStart(2, '0');
        const dd = String(m[1]).padStart(2, '0');
        return {
            day: m[1], monthName: m[2], year: yyyy,
            monthKey: `${yyyy}-${mm}-01`,
            dateKey: `${yyyy}-${mm}-${dd}`,
        };
    }

    async function fetchMonthAttendance(monthKey) {
        const token = localStorage.getItem('access_token');
        if (!token) return null;
        const url = `${location.origin}/k/attendance/api/mytime/attendance/summary/${monthKey}`;
        try {
            const res = await fetch(url, {
                credentials: 'include',
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    Authorization: `Bearer ${token}`,
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });
            if (!res.ok) return null;
            const json = await res.json();
            if (!json.succeeded) return null;
            return Array.isArray(json.data) ? json.data : (json.data?.dailyAttendances || []);
        } catch {
            return null;
        }
    }

    function isViewingOtherEmployee() {
        return /\/employee\/\d+\//.test(location.hash || '');
    }

    async function loadDayAttendance() {
        if (isViewingOtherEmployee()) return null;
        const info = getSelectedDateInfo();
        if (!info) return null;
        const days = await fetchMonthAttendance(info.monthKey);
        if (!days) return null;
        return days.find(d => (d.attendanceDate || '').startsWith(info.dateKey)) || null;
    }

    function detectHalfDayMode() {
        try {
            const info = getSelectedDateInfo();
            if (!info) {

                const allRows = document.querySelectorAll('.on-hover, .attendance-log-row, [class*="border-bottom"]');
                for (const row of allRows) {
                    const rowText = row.textContent || '';
                    if (rowText.includes('LEAVE') || rowText.includes('Leave')) {
                        const modalOpen = document.querySelector('.modal.show, .modal.fade.show');
                        if (modalOpen) return true;
                    }
                }
                return false;
            }
            const { day, monthName: month } = info;

            const rowSelectors = [
                '.on-hover',
                '.attendance-log-row',
                '[class*="border-bottom"]',
                '.d-flex.align-items-center.px-16.py-12'
            ];

            for (const selector of rowSelectors) {
                const rows = document.querySelectorAll(selector);

                for (const row of rows) {
                    const rowText = row.textContent || '';

                    const hasMonth = rowText.includes(month);
                    const hasDay = rowText.includes(day) || rowText.includes(parseInt(day).toString());

                    if (hasMonth && hasDay) {

                        if (rowText.includes('LEAVE') || rowText.includes('Leave')) {
                            return true;
                        }
                    }
                }
            }

            return false;

        } catch (error) {
            console.error('Error in detectHalfDayMode:', error);
            return false;
        }
    }

    const updateUI = debounce((container) => {
        if (!container || isUpdating) return;
        isUpdating = true;
        try {
        const modalDialog = document.querySelector('.modal-dialog.right-modal.right-modal-450');
        if (modalDialog) {
            modalDialog.style.width = '500px';
        }

        const results = processTimeEntries(container);
        if (!results) {
            isUpdating = false;
            return;
        }

        const hasOpenPunch =
            (dayApiData && dayApiData.isInMissing) ||
            Array.from(container.querySelectorAll('.d-flex.align-items-center .w-120:not(.mr-20) .text-small'))
                .some(el => (el.textContent || '').trim() === 'MISSING');
        if (dayApiData && !isManualMode && !results.isEmpty) {
            const firstLog = dayApiData.firstLogOfTheDay || dayApiData.validInOutPairs?.[0]?.inTime;
            if (firstLog) {
                const t = new Date(firstLog);
                const hh = ((t.getHours() % 12) || 12).toString().padStart(2, '0');
                const mm = t.getMinutes().toString().padStart(2, '0');
                const ap = t.getHours() < 12 ? 'AM' : 'PM';
                results.firstStartTime = `${hh}:${mm} ${ap}`;
                results.firstStartDate = t;
            }

            const pairs = dayApiData.validInOutPairs || [];
            let breakMs = 0;
            for (let i = 1; i < pairs.length; i++) {
                breakMs += new Date(pairs[i].inTime) - new Date(pairs[i - 1].outTime);
            }

            let openInMs = null;
            if (hasOpenPunch) {
                if (dayApiData.isInMissing && dayApiData.lastLogOfTheDay) {
                    openInMs = new Date(dayApiData.lastLogOfTheDay).getTime();
                } else {
                    const entries = dayApiData.timeEntries || [];
                    for (let i = entries.length - 1; i >= 0; i--) {
                        const e = entries[i];
                        if (!e || e.punchStatus !== 0) continue;

                        const paired = entries.slice(i + 1).some(x => x && x.punchStatus === 1);
                        if (paired) continue;
                        openInMs = new Date(e.timestamp).getTime();
                        break;
                    }
                }

                if (openInMs == null) {
                    const missingRow = Array.from(container.querySelectorAll('.ng-untouched.ng-pristine.ng-valid'))
                        .find(row => {
                            const endEl = row.querySelector('.d-flex.align-items-center .w-120:not(.mr-20) .text-small');
                            return endEl && endEl.textContent.trim() === 'MISSING';
                        });
                    const startEl = missingRow?.querySelector('.d-flex.align-items-center .w-120.mr-20 .text-small');
                    const raw = startEl?.textContent.trim();
                    if (raw) {
                        const parsed = parseTime(raw);
                        if (parsed) {
                            const d = new Date();
                            d.setHours(parsed.hours, parsed.minutes, 0, 0);
                            openInMs = d.getTime();
                        }
                    }
                }

                if (openInMs != null && pairs.length > 0) {
                    const lastClosedOutMs = new Date(pairs[pairs.length - 1].outTime).getTime();
                    if (openInMs > lastClosedOutMs) {
                        breakMs += openInMs - lastClosedOutMs;
                    }
                }
            }
            if (pairs.length > 0 || (hasOpenPunch && openInMs != null)) {
                results.breakMs = breakMs;
            }

            let totalWorkSec = 0;
            for (const p of pairs) {
                totalWorkSec += (new Date(p.outTime).getTime() - new Date(p.inTime).getTime()) / 1000;
            }
            if (hasOpenPunch && openInMs != null) {
                totalWorkSec += Math.max(0, (Date.now() - openInMs) / 1000);
            }
            if (pairs.length > 0 || hasOpenPunch) {
                results.totalWorkSeconds = totalWorkSec;
                results.apiOpenInMs = openInMs;
                results.apiPairs = pairs;

                notifierPairs = pairs;
                notifierOpenInMs = openInMs;
            }

            if (!hasOpenPunch) {
                const totalEffMins = Math.round((dayApiData.totalEffectiveHours || 0) * 60);
                results.totalHours = totalEffMins / 60;
                results.totalDuration = formatDuration(Math.floor(totalEffMins / 60), totalEffMins % 60);
            }

            if (Number.isFinite(results.breakMs)) {
                results.breakSeconds = Math.floor(results.breakMs / 1000);
                results.breakTime = Math.round(results.breakMs / 60000);
            }

            if (Number.isFinite(results.totalWorkSeconds)) {
                results.totalDuration = formatDurationSec(results.totalWorkSeconds);
                results.totalDurationHTML = formatDurationHTML(results.totalWorkSeconds);
            }
        }

        if (isManualMode && !showManualForm && Number.isFinite(results.manualOpenStartMs)) {
            if (!manualTickInterval) {
                manualTickInterval = setInterval(() => {
                    if (modalOpen && isManualMode && !showManualForm) updateUI(container);
                }, 1000);
            }
        } else if (manualTickInterval) {
            clearInterval(manualTickInterval);
            manualTickInterval = null;
        }

        if (results.isEmpty && !isManualMode) {
            let totalDisplay = container.querySelector('.total-duration-display');
            if (!totalDisplay) {
                totalDisplay = document.createElement('div');
                totalDisplay.className = 'total-duration-display';
                container.appendChild(totalDisplay);
            }
            totalDisplay.innerHTML = `
                <style>
                    .manual-icon-btn {
                        position: absolute;
                        top: 2px;
                        right: 2px;
                        width: 25px;
                        height: 25px;
                        background: rgba(124, 58, 237, 0.1);
                        border: 1px solid rgba(124, 58, 237, 0.2);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        opacity: 0.6;
                        z-index: 10;
                    }
                    .manual-icon-btn:hover {
                        opacity: 1;
                        background: rgba(124, 58, 237, 0.15);
                        transform: scale(1.05);
                        box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
                    }
                    .manual-icon-btn svg {
                        width: 14px;
                        height: 14px;
                        stroke: #7c3aed;
                        fill: none;
                        stroke-width: 2;
                        stroke-linecap: round;
                        stroke-linejoin: round;
                    }
                </style>
                <div style="
                    margin: 20px;
                    padding: 40px 20px;
                    background: rgba(148, 163, 184, 0.08);
                    border-radius: 16px;
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.06), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
                    border: 1px solid rgba(148, 163, 184, 0.25);
                    text-align: center;
                    position: relative;
                ">
                    <button class="manual-icon-btn manual-entry-toggle-btn" title="Manual Entry Mode" onclick="this.dispatchEvent(new CustomEvent('toggleManualMode', {bubbles: true}))">
                        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                    </button>
                    <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;">📋</div>
                    <div style="font-size: 18px; font-weight: 600; color: inherit; margin-bottom: 8px;">No Time Entries</div>
                    <div style="font-size: 14px; color: inherit; opacity: 0.6;">Click the pen icon to add manual entries</div>
                </div>
            `;
            const manualBtn = totalDisplay.querySelector('.manual-entry-toggle-btn');
            if (manualBtn) {
                manualBtn.addEventListener('click', () => {
                    const { pairs, openStart } = extractPageEntries(container);
                    isManualMode = true;
                    showManualForm = true;
                    manualEntries = pairs;
                    if (openStart) { const p = flattenPunches(); p.push(openStart); repairFromPunches(p); }
                    prefillInputs = null;
                    updateUI(container);
                });
            }
            isUpdating = false;
            return;
        }

        if (isManualMode && showManualForm) {
            let totalDisplay = container.querySelector('.total-duration-display');
            if (!totalDisplay) {
                totalDisplay = document.createElement('div');
                totalDisplay.className = 'total-duration-display';
                container.appendChild(totalDisplay);
            }

            totalDisplay.style.cssText = `
                margin: 20px;
                padding: 20px;
                background: rgba(148, 163, 184, 0.08);
                border-radius: 16px;
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.06), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
                border: 1px solid rgba(148, 163, 184, 0.25);
                transition: all 0.3s ease;
                position: relative;
            `;
            totalDisplay.innerHTML = renderManualEntryUI(container);
            attachManualEntryHandlers(container);
            isUpdating = false;
            return;
        }

        const normalCalc = calculateTargetCompletion(
            results.firstStartTime,
            results.totalHours,
            results.breakTime,
            {
                firstStartDate: results.firstStartDate,
                breakMs: results.breakMs,
                totalWorkSeconds: results.totalWorkSeconds,
            }
        );
        const completionTime = normalCalc.completionTime;
        const overtime = normalCalc.overtime;
        const overtimeHTML = normalCalc.overtimeHTML || normalCalc.overtime;
        const remainingTime = calculateRemainingTime(
            results.firstStartTime,
            results.breakTime,
            Number.isFinite(results.totalWorkSeconds) ? { totalWorkSeconds: results.totalWorkSeconds } : undefined
        );

        let remainingTimeStr;
        let remainingTimeText;
        if (!remainingTime) {
            remainingTimeStr = remainingTimeText = 'N/A';
        } else if (remainingTime.completed) {
            remainingTimeStr = remainingTimeText = `${isHalfDayMode ? 4 : 8}h done 🎉`;
        } else {
            const remSec = Number.isFinite(remainingTime.remainingSeconds)
                ? remainingTime.remainingSeconds
                : remainingTime.remaining * 60;
            remainingTimeStr = formatDurationHTML(remSec);
            remainingTimeText = formatDurationSec(remSec);
        }
        const targetHoursLabel = isHalfDayMode ? '4hr' : '8hr';

        if (modalOpen) document.title = `${results.totalDuration}`;

        const gradients = {
            purple: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
            blue: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
            green: 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)',
            orange: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
            completed: 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)',
            pink: 'linear-gradient(135deg, #f472b6 0%, #db2777 100%)'
        };

        let totalDisplay = container.querySelector('.total-duration-display');
        if (!totalDisplay) {
            totalDisplay = document.createElement('div');
            totalDisplay.className = 'total-duration-display';
            container.appendChild(totalDisplay);
        }

        const isCompleted = remainingTime && remainingTime.completed;
        const showWrapupBanner = previewBanner || (
            remainingTime &&
            !remainingTime.completed &&
            remainingTime.remaining > 0 &&
            remainingTime.remaining <= 10 &&
            !bannerDismissed
        );
        const wrapupTargetLabel = isHalfDayMode ? '4h' : '8h';
        const wrapupRemainingLabel = remainingTime && remainingTime.remaining > 0 && remainingTime.remaining <= 10
            ? `${remainingTime.remaining} min`
            : '10 min';
        const wrapupBannerHTML = showWrapupBanner ? `
            <div class="wrapup-banner" role="alert" style="
                margin: 0 0 16px;
                padding: 12px 16px;
                display: flex;
                align-items: center;
                gap: 12px;
                background: linear-gradient(135deg, rgba(251, 146, 60, 0.18), rgba(234, 88, 12, 0.22));
                border: 1px solid rgba(251, 146, 60, 0.55);
                border-radius: 12px;
                color: inherit;
                animation: wrapup-pulse 2.4s ease-in-out infinite;
            ">
                <span style="font-size: 20px;">⏰</span>
                <div style="flex: 1; font-size: 13px; font-weight: 600;">
                    ${wrapupRemainingLabel} left to ${wrapupTargetLabel} — start wrapping up.
                </div>
                <button class="wrapup-dismiss-btn" aria-label="Dismiss" title="Dismiss" style="
                    background: transparent; border: none; color: inherit; opacity: 0.7;
                    font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px;
                ">✕</button>
            </div>` : '';

        totalDisplay.style.cssText = isCompleted ? `
            margin: 20px;
            padding: 20px;
            background: rgba(16, 185, 129, 0.08);
            border-radius: 16px;
            box-shadow: 0 0 30px rgba(16, 185, 129, 0.2), 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            border: 3px solid #10b981;
            transition: all 0.3s ease;
            position: relative;
        ` : `
            margin: 20px;
            padding: 20px;
            background: rgba(148, 163, 184, 0.08);
            border-radius: 16px;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.06), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
            border: 1px solid rgba(148, 163, 184, 0.25);
            transition: all 0.3s ease;
            position: relative;
        `;

        const selectedDateNode = document.querySelector('.modal-body kk-text-styles[label="Selected date"]');
        const dateHeaderRow = selectedDateNode ? selectedDateNode.parentElement : null;
        const legacyFormGroup = document.querySelector('.modal-body .form-group');
        const capsuleHost = dateHeaderRow || legacyFormGroup;
        if (!capsuleHost) return;

        const existingCapsule = capsuleHost.querySelector('.day-mode-capsule');
        const modeGradient = isHalfDayMode ? '#f97316 0%, #ea580c 100%' : '#3b82f6 0%, #2563eb 100%';
        const modeIcon = isHalfDayMode ? '🌗' : '☀️';
        const modeText = `${isHalfDayMode ? '🌗 Half Day' : '☀️ Full Day'}${isHalfDayAutoDetected ? ' (Auto)' : ''}`;

        if (!existingCapsule) {
            const capsuleHTML = `<div class="day-mode-capsule" style="position: relative; width: 50px; height: 32px; background: linear-gradient(135deg, ${modeGradient}); border-radius: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; flex-shrink: 0; margin-left: 12px;"><span class="mode-icon" style="font-size: 18px; transition: opacity 0.3s ease; z-index: 2;">${modeIcon}</span><span class="mode-full-text" style="position: absolute; font-size: 12px; color: white; font-weight: 600; white-space: nowrap; opacity: 0; transition: opacity 0.3s ease; pointer-events: none;">${modeText}</span></div>`;

            if (dateHeaderRow) {
                dateHeaderRow.style.display = 'flex';
                dateHeaderRow.style.alignItems = 'center';
                dateHeaderRow.insertAdjacentHTML('beforeend', capsuleHTML);
            } else {
                const label = legacyFormGroup.querySelector('label');
                const inputField = legacyFormGroup.querySelector('input');
                if (label) {
                    label.style.display = 'block';
                    label.style.marginBottom = '8px';
                }
                if (inputField) {
                    const inputWrapper = document.createElement('div');
                    inputWrapper.className = 'input-toggle-wrapper';
                    inputWrapper.style.cssText = 'display: flex; align-items: center; gap: 12px; position: relative;';
                    inputField.className += ' input-with-toggle';
                    inputField.style.cssText = 'width: 100%; transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);';
                    inputField.parentNode.insertBefore(inputWrapper, inputField);
                    inputWrapper.appendChild(inputField);
                    inputWrapper.insertAdjacentHTML('beforeend', capsuleHTML);
                } else {
                    legacyFormGroup.insertAdjacentHTML('beforeend', capsuleHTML);
                }
            }

            const capsuleEl = capsuleHost.querySelector('.day-mode-capsule');
            if (capsuleEl) {
                capsuleEl.addEventListener('click', () => {
                    isHalfDayMode = !isHalfDayMode;
                    isHalfDayAutoDetected = false;
                    updateUI(container);
                });
            }
        } else {
            existingCapsule.style.background = `linear-gradient(135deg, ${modeGradient})`;
            const icon = existingCapsule.querySelector('.mode-icon');
            const text = existingCapsule.querySelector('.mode-full-text');
            if (icon) icon.textContent = modeIcon;
            if (text) text.textContent = modeText;
        }

        totalDisplay.innerHTML = `
            <style>
                @keyframes wrapup-pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                .wrapup-dismiss-btn:hover { opacity: 1 !important; }
                .metric-card {
                    padding: 16px;
                    border-radius: 12px;
                    color: white;
                    transition: transform 0.2s ease-in-out;
                    position: relative;
                    overflow: hidden;
                    cursor: pointer;
                }
                .remaining-time-card {
                    cursor: default;
                }
                .metric-card:not(.remaining-time-card):hover {
                    transform: translateY(-2px);
                }
                .metric-card::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(255, 255, 255, 0.1);
                    opacity: 0;
                    transition: opacity 0.2s ease-in-out;
                }
                .metric-card:not(.remaining-time-card):hover::before {
                    opacity: 1;
                }
                .metric-label {
                    font-size: 14px;
                    opacity: 0.9;
                    margin-bottom: 6px;
                    font-weight: 500;
                }
                .metric-value {
                    font-size: 18px;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                    font-variant-numeric: tabular-nums;
                    font-feature-settings: 'tnum' 1;
                }
                .metric-value .dur-u {
                    font-size: 0.62em;
                    font-weight: 500;
                    opacity: 0.78;
                    margin-left: 1px;
                }
                .metric-value .dur-s {
                    font-size: 0.7em;
                    font-weight: 500;
                    opacity: 0.78;
                    margin-left: 8px;
                    letter-spacing: 0.3px;
                }
                .spark-icon {
                    position: absolute;
                    right: 12px;
                    top: 12px;
                    opacity: 0.2;
                    font-size: 24px;
                }
                .day-mode-capsule:hover {
                    width: 160px !important;
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15) !important;
                }
                .day-mode-capsule:hover .mode-icon {
                    opacity: 0;
                }
                .day-mode-capsule:hover .mode-full-text {
                    opacity: 1 !important;
                }
                .input-toggle-wrapper:has(.day-mode-capsule:hover) .input-with-toggle {
                    width: calc(100% - 172px) !important;
                }
                .test-notification-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15) !important;
                }
                .test-notification-btn:active {
                    transform: translateY(0);
                }
                .uv-signature {
                    position: relative;
                    overflow: visible;
                }
                .uv-text {
                    position: relative;
                    display: inline-block;
                    transition: all 0.3s ease;
                }
                .uv-full-name {
                    position: absolute;
                    bottom: calc(100% + 8px);
                    left: 50%;
                    transform: translateX(-50%) translateY(10px);
                    background: #7c3aed;
                    color: white;
                    padding: 7px 13px;
                    border-radius: 8px;
                    font-size: 11.5px;
                    font-weight: 600;
                    letter-spacing: 0.2px;
                    white-space: nowrap;
                    opacity: 0;
                    pointer-events: none;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: 0 6px 16px rgba(124, 58, 237, 0.32);
                    z-index: 1000;
                }
                .uv-full-name::after {
                    content: '';
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    border: 5px solid transparent;
                    border-top-color: #7c3aed;
                }
                .uv-text:hover .uv-full-name {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
                @keyframes uv-heartbeat {
                    0%, 100% { transform: scale(1); }
                    15% { transform: scale(1.28); }
                    30% { transform: scale(1); }
                    45% { transform: scale(1.16); }
                    60% { transform: scale(1); }
                }
                .uv-heart {
                    display: inline-block;
                    animation: uv-heartbeat 1.8s ease-in-out infinite;
                }
                @keyframes uv-shimmer {
                    to { background-position: 200% center; }
                }
                .uv-text:hover {
                    background: linear-gradient(90deg, #a855f7, #6366f1, #ec4899, #a855f7);
                    background-size: 200% auto;
                    -webkit-background-clip: text;
                    background-clip: text;
                    -webkit-text-fill-color: transparent;
                    text-shadow: none !important;
                    animation: uv-shimmer 2s linear infinite;
                }
                .uv-full-name {
                    -webkit-text-fill-color: #fff;
                }
                .manual-icon-btn {
                    position: absolute;
                    top: 2px;
                    right: 2px;
                    width: 23px;
                    height: 23px;
                    background: rgba(124, 58, 237, 0.1);
                    border: 1px solid rgba(124, 58, 237, 0.2);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    opacity: 0.6;
                    z-index: 10;
                }
                .manual-icon-btn:hover {
                    opacity: 1;
                    background: rgba(124, 58, 237, 0.15);
                    transform: scale(1.05);
                    box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
                }
                .manual-icon-btn svg {
                    width: 14px;
                    height: 14px;
                    stroke: #7c3aed;
                    fill: none;
                    stroke-width: 2;
                    stroke-linecap: round;
                    stroke-linejoin: round;
                }
            </style>
            <button class="manual-icon-btn manual-entry-toggle-btn" title="Manual Entry Mode" onclick="this.dispatchEvent(new CustomEvent('toggleManualMode', {bubbles: true}))">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
            </button>
            ${wrapupBannerHTML}
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 20px;">
                <div class="metric-card" style="background: ${gradients.purple}" onclick="this.dispatchEvent(new CustomEvent('copyDuration', {bubbles: true}))">
                    <div class="spark-icon">⏱️</div>
                    <div class="metric-label">Total Duration</div>
                    <div class="metric-value">${results.totalDurationHTML || formatDurationHTML((results.totalHours || 0) * 3600)}</div>
                </div>
                <div class="metric-card" style="background: ${gradients.blue}" onclick="this.dispatchEvent(new CustomEvent('copyCompletion', {bubbles: true}))">
                    <div class="spark-icon">🎯</div>
                    <div class="metric-label">${targetHoursLabel} Completion</div>
                    <div class="metric-value">${subdueSecondsHTML(completionTime)}</div>
                </div>
                <div class="metric-card" style="background: ${gradients.orange}" onclick="this.dispatchEvent(new CustomEvent('copyOvertime', {bubbles: true}))">
                    <div class="spark-icon">⭐</div>
                    <div class="metric-label">Overtime</div>
                    <div class="metric-value">${overtimeHTML}</div>
                </div>
                <div class="metric-card remaining-time-card" style="background: ${isCompleted ? gradients.completed : gradients.green}">
                    <div class="spark-icon">${isCompleted ? '🎉' : '⌛'}</div>
                    <div class="metric-label">Remaining Time</div>
                    <div class="metric-value">${remainingTimeStr}</div>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
                <div class="metric-card" style="background: ${gradients.pink}" onclick="this.dispatchEvent(new CustomEvent('copyBreakTime', {bubbles: true}))">
                    <div class="spark-icon">☕</div>
                    <div class="metric-label">Total Break Duration</div>
                    <div class="metric-value">${formatDurationHTML((Number.isFinite(results.breakSeconds) ? results.breakSeconds : (results.breakTime || 0) * 60))}</div>
                </div>
            </div>
            ${debugMode ? `<div style="margin-top: 20px; display: grid; gap: 10px;">
                <button class="test-notification-btn" style="
                    width: 100%;
                    padding: 12px 20px;
                    background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                " onclick="this.dispatchEvent(new CustomEvent('testNotification', {bubbles: true}))">
                    🔔 Test Notification (3s delay)
                </button>
                <button class="test-wrapup-btn" style="
                    width: 100%;
                    padding: 12px 20px;
                    background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                " onclick="this.dispatchEvent(new CustomEvent('testWrapupAlert', {bubbles: true}))">
                    ⏰ Preview 10-min Alert
                </button>
            </div>` : ''}
            <div style="
                text-align: center;
                margin-top: 20px;
                padding: 10px 16px 0;
                border-top: 1px solid rgba(148, 163, 184, 0.25);
                font-size: 10px;
                color: inherit;
                font-weight: 500;
                letter-spacing: 0.5px;
                cursor: pointer;
            " class="uv-signature">
                <span style="opacity: 0.6;">Made with <span class="uv-heart">💜</span> by </span><span style="color: #a855f7; font-weight: 700; text-shadow: 0 0 10px rgba(168, 85, 247, 0.45);" class="uv-text">UV<span class="uv-full-name">Umang Vadadoriya 👋</span></span><span style="opacity: 0.5; font-size: 9px; margin-left: 7px; letter-spacing: 0;">·&nbsp;v${SCRIPT_VERSION}</span>${debugMode ? ' <span style="color: #ef4444; font-weight: 700;">🐛 DEBUG</span>' : ''}
            </div>
        `;

        const oldTotalDisplay = totalDisplay;
        const newTotalDisplay = totalDisplay.cloneNode(false);
        newTotalDisplay.innerHTML = totalDisplay.innerHTML;
        if (oldTotalDisplay.parentNode) {
            oldTotalDisplay.parentNode.replaceChild(newTotalDisplay, oldTotalDisplay);
            totalDisplay = newTotalDisplay;
        }

        totalDisplay.addEventListener('copyDuration', () =>
            copyToClipboard(formatCopyText('⏱️', 'Total Duration', results.totalDuration)));

        totalDisplay.addEventListener('copyCompletion', () =>
            copyToClipboard(formatCopyText('🎯', `${targetHoursLabel} Completion`, completionTime)));

        totalDisplay.addEventListener('copyOvertime', () =>
            copyToClipboard(formatCopyText('⭐', 'Overtime', overtime)));

        totalDisplay.addEventListener('copyRemaining', () =>
            copyToClipboard(formatCopyText(isCompleted ? '🎉' : '⌛', 'Remaining Time', remainingTimeText)));

        totalDisplay.addEventListener('copyBreakTime', () =>
            copyToClipboard(formatCopyText('☕', 'Total Break Duration', Number.isFinite(results.breakSeconds) ? formatDurationSec(results.breakSeconds) : `${Math.floor(results.breakTime / 60)}h ${results.breakTime % 60}m`)));

        totalDisplay.addEventListener('testNotification', () => {
            triggerTestNotification();
        });

        totalDisplay.addEventListener('testWrapupAlert', () => {
            const targetLabel = isHalfDayMode ? '4h' : '8h';
            showNotification(`⏰ 10 minutes to ${targetLabel} — start wrapping up!`);
            playAlertBeep();
            previewBanner = true;
            bannerDismissed = false;
            tenMinAlertFired = true;
            updateUI(container);
        });

        const dismissBtn = totalDisplay.querySelector('.wrapup-dismiss-btn');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                bannerDismissed = true;
                previewBanner = false;
                updateUI(container);
            });
        }

        totalDisplay.addEventListener('toggleManualMode', () => {
            const { pairs, openStart } = extractPageEntries(container);
            isManualMode = true;
            showManualForm = true;
            manualEntries = pairs;
            if (openStart) { const p = flattenPunches(); p.push(openStart); repairFromPunches(p); }
            prefillInputs = null;
            updateUI(container);
        });

        const uvSignature = totalDisplay.querySelector('.uv-signature');
        if (uvSignature) {
            uvSignature.addEventListener('click', handleUVClick);
        }

        } finally {

            isUpdating = false;
        }
    }, 250);

    const style = document.createElement('style');
    style.textContent = `
        .duration-capsule { display: inline-flex; border-radius: 20px; margin-left: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .dual-capsule { position: relative; height: 28px; width: 120px; overflow: visible; }
        .work-side, .break-side { padding: 6px 12px; font-size: 12px; color: white; font-weight: 500; transition: all 0.3s ease; white-space: nowrap; display: flex; align-items: center; justify-content: center; cursor: pointer; width: 60px; position: absolute; top: 0; height: 100%; overflow: hidden; }
        .work-side { background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%); left: 0; border-radius: 20px 0 0 20px; }
        .break-side { background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%); right: 0; border-radius: 0 20px 20px 0; }
        .work-only { background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%); padding: 6px 12px; font-size: 12px; color: white; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; width: 120px; height: 28px; cursor: default; }
        .dual-capsule .work-side:hover { width: 120px !important; z-index: 10; box-shadow: 0 4px 6px rgba(0,0,0,0.15); border-radius: 20px !important; }
        .dual-capsule .break-side:hover { width: 120px !important; z-index: 10; box-shadow: 0 4px 6px rgba(0,0,0,0.15); border-radius: 20px !important; }
        .dual-capsule .work-side:hover .work-text::before { content: 'Work: '; }
        .dual-capsule .break-side:hover .break-text::before { content: 'Break: '; }
        div[formarrayname="premises"].max-h-500 { max-height: 100% !important; }
    `;
    document.head.appendChild(style);

    const observer = new MutationObserver(() => {

        let container = document.querySelector('.modal-body form div[formarrayname="logs"]');

        if (!container) {
            const premisesContainer = document.querySelector('.modal-body form div[formarrayname="premises"]');
            if (premisesContainer) {
                container = premisesContainer;
            }
        }

        if (container && !modalOpen) {
            modalOpen = true;
            originalTitle = document.title;
            plannedBreakMin = 0;
            isHalfDayMode = false;
            isHalfDayAutoDetected = false;
            dayApiData = null;
            updateUI(container);

            setTimeout(() => {
                const wasHalfDay = detectHalfDayMode();
                if (wasHalfDay !== isHalfDayMode) {
                    isHalfDayAutoDetected = wasHalfDay;
                    isHalfDayMode = wasHalfDay;
                    updateUI(container);
                }
            }, 100);

            loadDayAttendance().then(d => {
                if (!modalOpen) return;
                dayApiData = d;
                updateUI(container);
            });

            startBackgroundNotifications();
        } else if (!container && modalOpen) {
            modalOpen = false;
            if (originalTitle !== null) { document.title = originalTitle; originalTitle = null; }
            isHalfDayMode = false;
            isHalfDayAutoDetected = false;
            isManualMode = false;
            manualEntries = [];
            showManualForm = false;
            prefillInputs = null;
            dayApiData = null;
            tenMinAlertFired = false;
            bannerDismissed = false;
            previewBanner = false;
            stopBackgroundNotifications();
        }
    });

    function showActivationToast() {
        if (document.getElementById('uv-activation-toast')) return;
        const toast = document.createElement('div');
        toast.id = 'uv-activation-toast';
        toast.textContent = '✅  Keka helper active. Open any day to see your duration';
        toast.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%) translateY(-14px);
            background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
            color: white;
            padding: 12px 22px;
            border-radius: 10px;
            font-family: inherit;
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            box-shadow: 0 8px 24px rgba(124, 58, 237, 0.45);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 999999;
        `;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-14px)';
            setTimeout(() => toast.remove(), 350);
        }, 2600);
    }

    function startKekaEnhance() {
        observer.observe(document.body, { childList: true, subtree: true });
        showActivationToast();
    }
    if (document.body) {
        startKekaEnhance();
    } else {
        document.addEventListener('DOMContentLoaded', startKekaEnhance, { once: true });
    }
})();
