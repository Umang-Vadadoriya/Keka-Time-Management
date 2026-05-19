// ==UserScript==
// @name         Enhanced Keka Log Duration by UV with Advanced Notifications
// @name:en      Enhanced Keka Log Duration (English)
// @namespace    http://tampermonkey.net/
// @version      15.2
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

    // Constants
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
                        background: white;
                        border: 2px solid #e2e8f0;
                        border-radius: 10px;
                        margin-bottom: 8px;
                    ">
                        <div style="flex: 1;">
                            <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${entry.start} - ${entry.end}</div>
                            <div style="font-size: 12px; color: #64748b;">Duration: ${duration.hours}h ${duration.minutes}m</div>
                        </div>
                        <button class="remove-entry-btn" data-index="${index}" style="
                            background: ${gradients.red};
                            color: white;
                            border: none;
                            border-radius: 8px;
                            padding: 8px 12px;
                            font-size: 12px;
                            font-weight: 600;
                            cursor: pointer;
                            transition: transform 0.2s;
                        ">Remove</button>
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
                    <div style="font-size: 20px; font-weight: 700; color: #1e293b; margin-bottom: 4px;">📝 Manual Log Entry</div>
                    <div style="font-size: 13px; color: #64748b;">Add your time entries manually</div>
                </div>

                ${previewHTML}
                ${entriesListHTML}

                <div id="manual-error-message" style="
                    display: none;
                    padding: 12px;
                    background: linear-gradient(135deg, #fecaca 0%, #fca5a5 100%);
                    border-radius: 8px;
                    color: #7f1d1d;
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
                            color: #475569;
                            margin-bottom: 6px;
                        ">Start Time</label>
                        <input
                            type="text"
                            id="manual-start-time"
                            placeholder="9:00 AM"
                            style="
                                width: 100%;
                                padding: 10px 12px;
                                border: 2px solid #e2e8f0;
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
                            color: #475569;
                            margin-bottom: 6px;
                        ">End Time</label>
                        <input
                            type="text"
                            id="manual-end-time"
                            placeholder="5:00 PM"
                            style="
                                width: 100%;
                                padding: 10px 12px;
                                border: 2px solid #e2e8f0;
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
                    color: #64748b;
                    border: 2px solid #e2e8f0;
                    border-radius: 10px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                ">${manualEntries.length > 0 ? '← Back to Results' : '← Cancel'}</button>

                <style>
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
                    color: #94a3b8;
                    font-weight: 500;
                    letter-spacing: 0.5px;
                " class="uv-signature">
                    Enhanced by <span style="color: #7c3aed; font-weight: 600;" class="uv-text">UV<span class="uv-full-name">Umang Vadadoriya</span></span> ✨
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
                    updateUI(container);
                }
            });
        }

        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
                isManualMode = false;
                if (manualEntries.length === 0) {
                    manualEntries = [];
                }
                updateUI(container);
            });
        }

        // Handle remove entry buttons
        document.querySelectorAll('.remove-entry-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.getAttribute('data-index'));
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
                exitBtn.style.borderColor = '#cbd5e1';
                exitBtn.style.color = '#475569';
            });
            exitBtn.addEventListener('mouseleave', () => {
                exitBtn.style.borderColor = '#e2e8f0';
                exitBtn.style.color = '#64748b';
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

    function calculateTargetCompletion(firstStartTime, totalWorkedHours, totalBreakTime) {
        if (!firstStartTime) return { completionTime: 'N/A', overtime: 'N/A' };

        const start = parseTime(firstStartTime);
        if (!start) return { completionTime: 'N/A', overtime: 'N/A' };

        const startDate = new Date();
        startDate.setHours(start.hours, start.minutes, 0);

        const targetMinutes = getTargetHours();
        const totalWorkedMinutes = totalWorkedHours * 60;

        const completionDate = new Date(startDate.getTime() + (targetMinutes * 60 * 1000) + (totalBreakTime * 60 * 1000));
        let completionTime = completionDate.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        if (totalWorkedMinutes >= targetMinutes) {
            completionTime += ' (Completed ✓)';
        }

        const overtimeMinutes = totalWorkedMinutes > targetMinutes ? totalWorkedMinutes - targetMinutes : 0;
        const overtimeHours = Math.floor(overtimeMinutes / 60);
        const overtimeMins = Math.floor(overtimeMinutes % 60);
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

    function calculateRemainingTime(startTimeStr, breakTimeMinutes) {
        const start = parseTime(startTimeStr);
        if (!start) return null;

        const now = new Date();
        const startDate = new Date();
        startDate.setHours(start.hours, start.minutes, 0);

        let elapsedMinutes = Math.floor((now - startDate) / (1000 * 60));
        if (elapsedMinutes < 0) elapsedMinutes += 24 * 60;

        const effectiveWorkMinutes = elapsedMinutes - breakTimeMinutes;
        const targetMinutes = getTargetHours();
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
               (hours === 0 && [60, 50, 40, 30, 20, 15, 10, 5, 0].includes(minutes));
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
            const remainingTime = calculateRemainingTime(lastStartTime, totalBreakTimeMinutes);
            if (!remainingTime) return;

            if (remainingTime.overtime < 0) {
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
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).catch(err => {
            console.error('Failed to copy:', err);
        });
    }

    function formatCopyText(emoji, label, value) {
        return `${emoji}\n${label}:\n${value}`;
    }

    function detectHalfDayMode() {
        try {
            
            // Get the selected date. New Keka modal exposes it as text inside
            // <kk-text-styles label="Selected date">; legacy modal used <input formcontrolname="selectedDate">.
            let selectedDateValue = '';
            const dateTextEl = document.querySelector('.modal-body kk-text-styles[label="Selected date"]');
            if (dateTextEl) {
                selectedDateValue = (dateTextEl.innerText || dateTextEl.textContent || '').trim();
            }
            if (!selectedDateValue) {
                const selectedDateInput =
                    document.querySelector('input[formcontrolname="selectedDate"]') ||
                    document.querySelector('input[name="selectedDate"]') ||
                    document.querySelector('.modal-body input[type="text"]');
                if (selectedDateInput) {
                    selectedDateValue = selectedDateInput.value || '';
                }
            }

            if (!selectedDateValue) {
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
            
            // Parse the date
            const dateMatch = selectedDateValue.match(/(\d+)\s+(\w+)\s+(\d+)/);
            if (!dateMatch) {
                return false;
            }
            
            const [, day, month, year] = dateMatch;
            
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
                    background: #ffffff;
                    border-radius: 16px;
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
                    border: 1px solid #e2e8f0;
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
                    <div style="font-size: 18px; font-weight: 600; color: #475569; margin-bottom: 8px;">No Time Entries</div>
                    <div style="font-size: 14px; color: #94a3b8;">Click the pen icon to add manual entries</div>
                </div>
            `;
            const manualBtn = totalDisplay.querySelector('.manual-entry-toggle-btn');
            if (manualBtn) {
                manualBtn.addEventListener('click', () => {
                    isManualMode = true;
                    updateUI(container);
                });
            }
            isUpdating = false;
            return;
        }
        
        // If in manual mode, show manual entry UI
        if (isManualMode && manualEntries.length === 0) {
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
            results.breakTime
        );
        const completionTime = normalCalc.completionTime;
        const overtime = normalCalc.overtime;
        const remainingTime = calculateRemainingTime(results.firstStartTime, results.breakTime);
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
            ${debugMode ? `<div style="margin-top: 20px;">
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
            </div>` : ''}
            <div style="
                text-align: center;
                margin-top: 20px;
                padding: 10px 16px 0;
                border-top: 1px solid rgba(148, 163, 184, 0.25);
                font-size: 10px;
                color: #94a3b8;
                font-weight: 500;
                letter-spacing: 0.5px;
                cursor: pointer;
            " class="uv-signature">
                Enhanced by <span style="color: #7c3aed; font-weight: 600;" class="uv-text">UV<span class="uv-full-name">Umang Vadadoriya</span></span> ✨${debugMode ? ' <span style="color: #ef4444; font-weight: 700;">🐛 DEBUG</span>' : ''}
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

        totalDisplay.addEventListener('toggleManualMode', () => {
            isManualMode = true;
            manualEntries = [];
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
            updateUI(container);
            
            setTimeout(() => {
                const wasHalfDay = detectHalfDayMode();
                if (wasHalfDay !== isHalfDayMode) {
                    isHalfDayAutoDetected = wasHalfDay;
                    isHalfDayMode = wasHalfDay;
                    updateUI(container);
                }
            }, 100);
            
            startBackgroundNotifications();
        } else if (!container && modalOpen) {
            modalOpen = false;
            isHalfDayMode = false;
            isHalfDayAutoDetected = false;
            isManualMode = false;
            manualEntries = [];
            stopBackgroundNotifications();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
