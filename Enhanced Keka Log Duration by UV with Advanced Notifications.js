// ==UserScript==
// @name         Enhanced Keka Log Duration by UV with Advanced Notifications
// @name:en      Enhanced Keka Log Duration (English)
// @namespace    http://tampermonkey.net/
// @version      19.6
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

    // Global state variables
    let modalOpen = false;
    let lastStartTime = null;
    let notificationInterval = null;
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
    let prefillInputs = null; // {start, end} — applied to the manual form on next render
    let dayApiData = null;
    let tenMinAlertFired = false; // OS notification fires once per 10-min window
    let bannerDismissed = false;  // user-controlled banner kill-switch
    let previewBanner = false;    // debug-mode preview override for the wrap-up banner
    let audioCtx = null;
    let notifierPairs = [];   // validInOutPairs snapshot for second-precise live recompute
    let notifierOpenInMs = null; // open-in timestamp when currently clocked in

    // Constants
    const SCRIPT_VERSION = '19.6'; // Mirror of the UserScript @version header — bump together.
    const EIGHT_HOURS_IN_MINUTES = 8 * 60;
    const FOUR_HOURS_IN_MINUTES = 4 * 60;
    const NOTIFICATION_INTERVAL = 1; // minutes

    // Get target hours based on mode
    function getTargetHours() {
        return isHalfDayMode ? FOUR_HOURS_IN_MINUTES : EIGHT_HOURS_IN_MINUTES;
    }

    // Notification messages array
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

    // Request notification permission on script load
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Utility functions
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
        // Gate on notification permission so the beep respects the user's "mute alerts" choice.
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
        } catch { /* Web Audio not available */ }
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

    function formatDuration(hours, minutes) {
        return `${hours} Hr ${minutes} Min`;
    }

    function formatDurationSec(totalSeconds) {
        const total = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return `${h} Hr ${m} Min ${s} Sec`;
    }

    function processManualEntries(renderOnUI = true) {
        if (manualEntries.length === 0) {
            return { isEmpty: true, totalDuration: 'N/A', firstStartTime: null, totalHours: 0, breakTime: 0 };
        }

        let totalMinutes = 0;
        let firstStartTime = manualEntries[0].start;
        let breakTime = 0;

        manualEntries.forEach((entry, index) => {
            const duration = calculateDuration(entry.start, entry.end);
            totalMinutes += duration.hours * 60 + duration.minutes;

            // Calculate break time between entries
            if (index > 0) {
                const prevEndTime = manualEntries[index - 1].end;
                const currentStartTime = entry.start;
                const breakDuration = calculateDuration(prevEndTime, currentStartTime);
                breakTime += breakDuration.hours * 60 + breakDuration.minutes;
            }
        });

        const totalHours = Math.floor(totalMinutes / 60);
        const totalMins = totalMinutes % 60;

        return {
            totalDuration: formatDuration(totalHours, totalMins),
            firstStartTime,
            totalHours: totalHours + totalMins / 60,
            breakTime,
            isManual: true
        };
    }

    function validateTimeFormat(timeStr) {
        // Validates time format: HH:MM AM/PM
        const timeRegex = /^(0?[1-9]|1[0-2]):([0-5][0-9])\s?(AM|PM|am|pm)$/i;
        return timeRegex.test(timeStr.trim());
    }

    function normalizeTimeFormat(timeStr) {
        // Normalize time format to match existing format
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
        
        if (!startTime || startTime.trim() === '') {
            errors.push('Start time is required');
        } else if (!validateTimeFormat(startTime)) {
            errors.push('Invalid start time format. Use HH:MM AM/PM (e.g., 9:00 AM)');
        }
        
        if (!endTime || endTime.trim() === '') {
            errors.push('End time is required');
        } else if (!validateTimeFormat(endTime)) {
            errors.push('Invalid end time format. Use HH:MM AM/PM (e.g., 5:00 PM)');
        }
        
        if (errors.length === 0 && !isStartBeforeEnd(startTime, endTime)) {
            errors.push('End time must be after start time');
        }
        
        return {
            isValid: errors.length === 0,
            errors
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

        // Calculate preview if entries exist
        let previewHTML = '';
        if (manualEntries.length > 0) {
            const preview = processManualEntries(false);
            previewHTML = `
                <div style="
                    padding: 16px;
                    background: ${gradients.green};
                    border-radius: 12px;
                    color: white;
                    margin-bottom: 16px;
                ">
                    <div style="font-size: 14px; opacity: 0.9; margin-bottom: 6px; font-weight: 500;">Preview Total</div>
                    <div style="font-size: 24px; font-weight: 600;">${preview.totalDuration}</div>
                </div>
            `;
        }

        // Render entry list
        let entriesListHTML = '';
        if (manualEntries.length > 0) {
            entriesListHTML = '<div style="margin-bottom: 16px;">';
            manualEntries.forEach((entry, index) => {
                const duration = calculateDuration(entry.start, entry.end);
                entriesListHTML += `
                    <div style="
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 12px 16px;
                        background: rgba(148, 163, 184, 0.12);
                        border: 1px solid rgba(148, 163, 184, 0.25);
                        border-radius: 10px;
                        margin-bottom: 8px;
                    ">
                        <div style="flex: 1;">
                            <div style="font-size: 14px; font-weight: 600; color: inherit;">${entry.start} - ${entry.end}</div>
                            <div style="font-size: 12px; color: inherit; opacity: 0.65;">Duration: ${duration.hours}h ${duration.minutes}m</div>
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button class="edit-entry-btn entry-icon-btn" data-index="${index}" title="Edit" aria-label="Edit">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 20h9"></path>
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                                </svg>
                            </button>
                            <button class="remove-entry-btn entry-icon-btn entry-icon-btn--danger" data-index="${index}" title="Remove" aria-label="Remove">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M3 6h18"></path>
                                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            });
            entriesListHTML += '</div>';
        }

        const manualUI = `
            <div class="manual-entry-container" style="
                margin: 20px;
                padding: 20px;
                background: rgba(148, 163, 184, 0.08);
                border-radius: 16px;
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.06), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
                border: 1px solid rgba(148, 163, 184, 0.25);
            ">
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
                                background: rgba(148, 163, 184, 0.08);
                                color: inherit;
                                border-radius: 8px;
                                font-size: 14px;
                                transition: border-color 0.2s;
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
                            placeholder="5:00 PM"
                            style="
                                width: 100%;
                                padding: 10px 12px;
                                border: 1px solid rgba(148, 163, 184, 0.35);
                                background: rgba(148, 163, 184, 0.08);
                                color: inherit;
                                border-radius: 8px;
                                font-size: 14px;
                                transition: border-color 0.2s;
                                box-sizing: border-box;
                            "
                        />
                    </div>
                </div>

                <button id="add-manual-entry-btn" style="
                    width: 100%;
                    padding: 12px 20px;
                    background: ${gradients.purple};
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                    margin-bottom: 12px;
                ">➕ Add Entry</button>

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
                    .entry-icon-btn {
                        width: 28px;
                        height: 28px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        background: transparent;
                        color: inherit;
                        opacity: 0.65;
                        border: 1px solid rgba(148, 163, 184, 0.35);
                        border-radius: 6px;
                        cursor: pointer;
                        transition: opacity 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
                        padding: 0;
                    }
                    .entry-icon-btn:hover {
                        opacity: 1;
                        border-color: rgba(148, 163, 184, 0.6);
                    }
                    .entry-icon-btn:active {
                        transform: scale(0.94);
                    }
                    .entry-icon-btn--danger:hover {
                        color: #ef4444;
                        border-color: rgba(239, 68, 68, 0.6);
                        opacity: 1;
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
                        background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
                        color: white;
                        padding: 8px 16px;
                        border-radius: 8px;
                        font-size: 12px;
                        font-weight: 600;
                        white-space: nowrap;
                        opacity: 0;
                        pointer-events: none;
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
                        z-index: 1000;
                    }
                    .uv-full-name::after {
                        content: '';
                        position: absolute;
                        top: 100%;
                        left: 50%;
                        transform: translateX(-50%);
                        border: 6px solid transparent;
                        border-top-color: #6366f1;
                    }
                    .uv-text:hover .uv-full-name {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                </style>
                <div style="
                    text-align: center;
                    margin-top: 20px;
                    padding: 10px 16px 0;
                    border-top: 1px solid rgba(148, 163, 184, 0.25);
                    font-size: 10px;
                    color: inherit;
                    opacity: 0.55;
                    font-weight: 500;
                    letter-spacing: 0.5px;
                " class="uv-signature">
                    Enhanced by <span style="color: #7c3aed; font-weight: 600;" class="uv-text">UV<span class="uv-full-name">Umang Vadadoriya</span></span> ✨<span style="opacity: 0.45; font-size: 9px; margin-left: 6px; letter-spacing: 0;">v${SCRIPT_VERSION}</span>
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

                const normalizedStart = normalizeTimeFormat(startTime);
                const normalizedEnd = normalizeTimeFormat(endTime);

                manualEntries.push({
                    start: normalizedStart,
                    end: normalizedEnd
                });

                startInput.value = '';
                endInput.value = '';
                updateUI(container);
            });
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
                updateUI(container);
            });
        }

        // Handle remove entry buttons
        document.querySelectorAll('.remove-entry-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.getAttribute('data-index'));
                manualEntries.splice(index, 1);
                updateUI(container);
            });
        });

        // Handle edit entry buttons: pop the entry into the inputs for adjustment.
        document.querySelectorAll('.edit-entry-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.getAttribute('data-index'));
                const entry = manualEntries[index];
                if (!entry) return;
                prefillInputs = { start: entry.start, end: entry.end };
                manualEntries.splice(index, 1);
                updateUI(container);
            });
        });

        // Add hover effects
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
        
        // Check if in manual mode and use manual entries
        if (isManualMode && manualEntries.length > 0) {
            return processManualEntries(renderOnUI);
        }
        
        // Filter to only actual time entry rows (must contain time elements)
        const validTimeRows = Array.from(timeRows).filter(row => {
            const hasStartTime = row.querySelector('.d-flex.align-items-center .w-120.mr-20 .text-small');
            const hasEndTime = row.querySelector('.d-flex.align-items-center .w-120:not(.mr-20) .text-small');
            return hasStartTime || hasEndTime;
        });
        
        // Detect empty logs state
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
        // opts: { firstStartDate?: Date, breakMs?: number, totalWorkSeconds?: number }
        // - firstStartDate / breakMs feed the completion-time math at second precision.
        // - totalWorkSeconds is the precise (API + live) total effective work seconds;
        //   used for the (Completed ✓) flag and the overtime card so DOM minute-rounding
        //   never flips the flag before the user has actually hit the target.
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
            : new Date(Math.ceil(rawCompletionMs / 60000) * 60000); // ceil only when we lack seconds
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

        const overtimeSec = totalWorkSeconds > targetSeconds ? totalWorkSeconds - targetSeconds : 0;
        const overtimeMinutes = Math.floor(overtimeSec / 60);
        const overtimeHours = Math.floor(overtimeMinutes / 60);
        const overtimeMins = overtimeMinutes % 60;
        const overtime = overtimeMinutes > 0 ? `${overtimeHours} Hr ${overtimeMins} Min` : 'No overtime';

        return { completionTime, overtime };
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
        // opts.totalWorkSeconds — when supplied, drives `remaining`, `completed`,
        // and `overtime` at second precision (sourced from API pairs + live open
        // punch). Without it, fall back to the legacy DOM-minute math.
        const targetMinutes = getTargetHours();
        const targetSeconds = targetMinutes * 60;

        if (opts && Number.isFinite(opts.totalWorkSeconds)) {
            const effectiveSec = opts.totalWorkSeconds;
            const remainingSec = targetSeconds - effectiveSec;
            // `remaining` is displayed in minutes — round to nearest so the
            // 10-min alert fires near actual T-10 instead of drifting +/-30s.
            const remainingMin = Math.round(remainingSec / 60);
            return {
                remaining: Math.max(0, remainingMin),
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
        // 10-minute mark is handled by a dedicated wrap-up alert; intentionally excluded here.
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

        const container = document.querySelector('.modal-body form div[formarrayname="logs"]');
        if (!container) return;

        const firstStartElement = container.querySelector('.d-flex.align-items-center .w-120.mr-20 .text-small');
        if (!firstStartElement) return;

        lastStartTime = firstStartElement.textContent.trim();
        const results = processTimeEntries(container, false);
        totalBreakTimeMinutes = results ? results.breakTime : 0;

        notificationInterval = setInterval(() => {
            // Recompute totalWorkSeconds live from the stashed pairs + open-in.
            // Falls back to DOM-minute math if API data hasn't loaded yet.
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
            // Re-arm the 10-min alert and the banner when the window moves out
            // (manual edit, half-day toggle, etc.).
            if (remainingTime.remaining > 10 || remainingTime.completed) {
                tenMinAlertFired = false;
                bannerDismissed = false;
            }
            updateUI(container);
        }, NOTIFICATION_INTERVAL * 60 * 1000);
    }

    function stopBackgroundNotifications() {
        if (notificationInterval) {
            clearInterval(notificationInterval);
            notificationInterval = null;
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

    async function loadDayAttendance() {
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
                // Last-ditch: scan any attendance row marked LEAVE while a modal is open.
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
            
            // Check all possible attendance row selectors
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
                    
                    // Check if this row matches our date
                    const hasMonth = rowText.includes(month);
                    const hasDay = rowText.includes(day) || rowText.includes(parseInt(day).toString());
                    
                    if (hasMonth && hasDay) {
                        
                        // Check for LEAVE keyword
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
        const modalDialog = document.querySelector('.modal-dialog.right-modal.right-modal-450');
        if (modalDialog) {
            modalDialog.style.width = '500px';
        }

        const results = processTimeEntries(container);
        if (!results) {
            isUpdating = false;
            return;
        }

        // Override DOM-derived totals with API-precise values when available.
        // DOM only exposes HH:MM (no seconds), so cumulative truncation can
        // shift work/break by ~1 min and (more critically) make the displayed
        // "out time" earlier than the real 8h-completion second.
        //
        // Layered override:
        //   1) When the day has an open punch, the API doesn't count the live
        //      working interval — DOM math correctly extends it to "now". So
        //      we keep results.totalHours/breakTime/totalDuration as-is.
        //   2) Regardless of open-punch state, we always attach second-precise
        //      `firstStartDate` + `breakMs` (from validInOutPairs) so that the
        //      completion-time calc can show seconds and be exact.
        //   3) Manual mode keeps DOM math entirely (user is editing locally).
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
            // Exact break milliseconds across completed pairs (closed gaps).
            const pairs = dayApiData.validInOutPairs || [];
            let breakMs = 0;
            for (let i = 1; i < pairs.length; i++) {
                breakMs += new Date(pairs[i].inTime) - new Date(pairs[i - 1].outTime);
            }
            // When currently clocked in (open punch), find the open-in moment so
            // we can: (a) add the most-recent-break gap to breakMs when there's
            // at least one closed pair preceding it, and (b) include live work
            // seconds (now − openIn) in totalWorkSec. Detection runs regardless
            // of pairs.length — a fresh day with only an open punch (and no
            // closed pairs yet) still needs the live work counted.
            let openInMs = null;
            if (hasOpenPunch) {
                if (dayApiData.isInMissing && dayApiData.lastLogOfTheDay) {
                    openInMs = new Date(dayApiData.lastLogOfTheDay).getTime();
                } else {
                    const entries = dayApiData.timeEntries || [];
                    for (let i = entries.length - 1; i >= 0; i--) {
                        const e = entries[i];
                        if (!e || e.punchStatus !== 0) continue;
                        // Skip entries that are already matched by a later "out".
                        const paired = entries.slice(i + 1).some(x => x && x.punchStatus === 1);
                        if (paired) continue;
                        openInMs = new Date(e.timestamp).getTime();
                        break;
                    }
                }
                // DOM fallback (HH:MM only): the row with end="MISSING".
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
                // Only add the openIn-gap to breakMs when there's a preceding
                // closed pair to measure from. When pairs is empty (e.g., fresh
                // day with just the first in-punch), there's no break to add.
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
            // Precise total effective work seconds: closed pairs + (live open punch).
            // Used for (Completed ✓) and overtime, so DOM minute-rounding can never
            // flip the flag before the user has actually hit the target.
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
                // Stash for the background notifier — it recomputes totalWorkSec
                // each tick using Date.now() so its `completed` / `remaining` are
                // second-precise too.
                notifierPairs = pairs;
                notifierOpenInMs = openInMs;
            }
            // Closed-day work totals come from the API; keep DOM totals when the
            // day's still in progress.
            if (!hasOpenPunch) {
                const totalEffMins = Math.round((dayApiData.totalEffectiveHours || 0) * 60);
                const breakMins = Math.round((dayApiData.totalBreakDuration || 0) * 60);
                results.totalHours = totalEffMins / 60;
                results.breakTime = breakMins;
                results.totalDuration = formatDuration(Math.floor(totalEffMins / 60), totalEffMins % 60);
            }
            // Override the displayed Total Duration with second precision whenever
            // we have a precise totalWorkSeconds (closed pairs + live open punch).
            // Sourced from validInOutPairs so it agrees with Keka to the second.
            if (Number.isFinite(results.totalWorkSeconds)) {
                results.totalDuration = formatDurationSec(results.totalWorkSeconds);
            }
        }

        // If logs are empty and NOT in manual mode, show empty state
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
                    prefillInputs = openStart ? { start: openStart, end: '' } : null;
                    updateUI(container);
                });
            }
            isUpdating = false;
            return;
        }

        // If in manual mode, show manual entry UI
        if (isManualMode && showManualForm) {
            let totalDisplay = container.querySelector('.total-duration-display');
            if (!totalDisplay) {
                totalDisplay = document.createElement('div');
                totalDisplay.className = 'total-duration-display';
                container.appendChild(totalDisplay);
            }
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
        const remainingTime = calculateRemainingTime(
            results.firstStartTime,
            results.breakTime,
            Number.isFinite(results.totalWorkSeconds) ? { totalWorkSeconds: results.totalWorkSeconds } : undefined
        );
        const remainingTimeStr = remainingTime ? formatSimpleRemainingTime(remainingTime.remaining) : 'N/A';
        const targetHoursLabel = isHalfDayMode ? '4hr' : '8hr';

        document.title = `${results.totalDuration}`;

        // Define gradient backgrounds
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

        // Insert or update day mode toggle.
        // Keka redesigned the modal: the date is no longer an <input>; it's plain text inside
        // <kk-text-styles label="Selected date"> within a flex row at the top of .modal-body.
        // Anchor to that row when present; fall back to legacy .modal-body .form-group for older tenants.
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
                .metric-card:hover {
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
                .metric-card:hover::before {
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
                    background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
                    color: white;
                    padding: 8px 16px;
                    border-radius: 8px;
                    font-size: 12px;
                    font-weight: 600;
                    white-space: nowrap;
                    opacity: 0;
                    pointer-events: none;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
                    z-index: 1000;
                }
                .uv-full-name::after {
                    content: '';
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    border: 6px solid transparent;
                    border-top-color: #6366f1;
                }
                .uv-text:hover .uv-full-name {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
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
                    <div class="metric-value">${results.totalDuration}</div>
                </div>
                <div class="metric-card" style="background: ${gradients.blue}" onclick="this.dispatchEvent(new CustomEvent('copyCompletion', {bubbles: true}))">
                    <div class="spark-icon">🎯</div>
                    <div class="metric-label">${targetHoursLabel} Completion</div>
                    <div class="metric-value">${completionTime}</div>
                </div>
                <div class="metric-card" style="background: ${gradients.orange}" onclick="this.dispatchEvent(new CustomEvent('copyOvertime', {bubbles: true}))">
                    <div class="spark-icon">⭐</div>
                    <div class="metric-label">Overtime</div>
                    <div class="metric-value">${overtime}</div>
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
                    <div class="metric-value">${Math.floor(results.breakTime / 60)} Hr ${results.breakTime % 60} Min</div>
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
                opacity: 0.55;
                font-weight: 500;
                letter-spacing: 0.5px;
                cursor: pointer;
            " class="uv-signature">
                Enhanced by <span style="color: #7c3aed; font-weight: 600;" class="uv-text">UV<span class="uv-full-name">Umang Vadadoriya</span></span> ✨<span style="opacity: 0.45; font-size: 9px; margin-left: 6px; letter-spacing: 0;">v${SCRIPT_VERSION}</span>${debugMode ? ' <span style="color: #ef4444; font-weight: 700;">🐛 DEBUG</span>' : ''}
            </div>
        `;

        // Remove old event listeners by cloning the element (if it already existed)
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
            copyToClipboard(formatCopyText(isCompleted ? '🎉' : '⌛', 'Remaining Time', remainingTimeStr)));
            
        totalDisplay.addEventListener('copyBreakTime', () => 
            copyToClipboard(formatCopyText('☕', 'Total Break Duration', `${Math.floor(results.breakTime / 60)} Hr ${results.breakTime % 60} Min`)));

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
            prefillInputs = openStart ? { start: openStart, end: '' } : null;
            updateUI(container);
        });

        const uvSignature = totalDisplay.querySelector('.uv-signature');
        if (uvSignature) {
            uvSignature.addEventListener('click', handleUVClick);
        }

        // Manual entry button hover is handled by CSS

        isUpdating = false;
    }, 250);

    // Add styles for duration capsules
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

    // Initialize observer
    const observer = new MutationObserver(() => {
        if (isUpdating) return;
        
        // Check for both possible containers: logs (with entries) or premises (without entries)
        let container = document.querySelector('.modal-body form div[formarrayname="logs"]');
        
        // If logs container doesn't exist, check for premises container (no entries case)
        if (!container) {
            const premisesContainer = document.querySelector('.modal-body form div[formarrayname="premises"]');
            if (premisesContainer) {
                container = premisesContainer;
            }
        }

        if (container && !modalOpen) {
            modalOpen = true;
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

    observer.observe(document.body, { childList: true, subtree: true });
})();
