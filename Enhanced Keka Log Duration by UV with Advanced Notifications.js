// ==UserScript==
// @name         Enhanced Keka Log Duration by UV with Advanced Notifications
// @name:en      Enhanced Keka Log Duration (English)
// @namespace    http://tampermonkey.net/
// @version      11.0
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
// @source       https://github.com/Umang-Vadadoriya-YCS/Keka-Time-Management
// @updateURL    https://gist.githubusercontent.com/Umang-Vadadoriya-YCS/8154cc8ed2fb3e2b73042d88a9422685/raw/Enhanced%2520Keka%2520Log%2520Duration%2520by%2520UV%2520with%2520Advanced%2520Notifications.js
// @downloadURL  https://gist.githubusercontent.com/Umang-Vadadoriya-YCS/8154cc8ed2fb3e2b73042d88a9422685/raw/Enhanced%2520Keka%2520Log%2520Duration%2520by%2520UV%2520with%2520Advanced%2520Notifications.js
// @supportURL   https://github.com/Umang-Vadadoriya-YCS/Keka-Time-Management/issues
// @homepage     https://github.com/Umang-Vadadoriya-YCS/Keka-Time-Management
// @compatible   firefox
// @compatible   chrome
// @license      MIT
// @noframes
// @contributionURL https://github.com/Umang-Vadadoriya-YCS/Keka-Time-Management
// @copyright    2024, Umang Vadadoriya (https://github.com/Umang-Vadadoriya-YCS)
// ==/UserScript==


// #TODO - Introduce Half Day Mode
// #TODO - On Click of notification it should take us to the Website (TEST)
// #TODO - Add a feature to Show Total Break Duration in UI (DONE)
// #TODO - Add a feature to Copy the Total Duration to Clipboard (DONE)
// #TODO - Add a feature to Copy the 8hr Completion Time to Clipboard (DONE)
// #TODO - Add a feature to Copy the Overtime to Clipboard (DONE)
// #TODO - Add a feature to Copy the Remaining Time to Clipboard (DONE)
// #TODO - Add Work Hours Individual Logs Same as Break Time Logs (DONE)
// #TODO - Add Day Mode Full/Half Auto Detection and Manual Selection (DONE)

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
    let cheatModeEnabled = false;
    let cheatClickCount = 0;
    let cheatClickTimer = null;

    // Constants
    const EIGHT_HOURS_IN_MINUTES = 8 * 60;
    const FOUR_HOURS_IN_MINUTES = 4 * 60;
    const NOTIFICATION_INTERVAL = 1; // minutes
    const MIN_WORK_PERCENTAGE = 96.87;
    const MIN_WORK_TIME_MINUTES = 465; // 7h 45m = 96.87% of 480min
    
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

    function handleCheatModeClick() {
        cheatClickCount++;
        
        if (cheatClickTimer) {
            clearTimeout(cheatClickTimer);
        }
        
        if (cheatClickCount === 6) {
            cheatModeEnabled = !cheatModeEnabled;
            if (debugMode) {
                console.log(`🎯 Cheat Mode ${cheatModeEnabled ? 'ENABLED' : 'DISABLED'}`);
            }
            
            const container = document.querySelector('.modal-body form div[formarrayname="logs"]');
            if (container) {
                updateUI(container);
            }
            
            showNotification(`Cheat Mode ${cheatModeEnabled ? 'Enabled' : 'Disabled'}! 🎯`);
            
            cheatClickCount = 0;
            cheatClickTimer = null;
        } else {
            cheatClickTimer = setTimeout(() => {
                cheatClickCount = 0;
                cheatClickTimer = null;
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

    function processTimeEntries(container, renderOnUI = true) {
        if (!container) return null;

        const timeRows = container.querySelectorAll('.ng-untouched.ng-pristine.ng-valid');
        let totalMinutes = 0;
        let firstStartTime = null;
        let breakTime = 0;
        let startTime = null;
        let endTime = null;
        let brekduration = null;

        timeRows.forEach((row, index) => {
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

    function calculateCheatModeStats(firstStartTime, totalWorkedMinutes, breakTimeMinutes) {
        if (!firstStartTime) {
            return {
                currentPercentage: 0,
                status: 'red',
                minTimeRemaining: MIN_WORK_TIME_MINUTES,
                earlyLeaveTime: 'N/A',
                isSafeToLeave: false
            };
        }

        const shiftMinutes = EIGHT_HOURS_IN_MINUTES;
        const currentPercentage = (totalWorkedMinutes / shiftMinutes) * 100;
        
        let status = 'red';
        let statusText = '1 day LOP';
        if (currentPercentage >= MIN_WORK_PERCENTAGE) {
            status = 'green';
            statusText = 'Safe';
        } else if (currentPercentage >= 50) {
            status = 'yellow';
            statusText = '0.5 day LOP';
        }

        const minTimeRemaining = Math.max(0, MIN_WORK_TIME_MINUTES - totalWorkedMinutes);
        const isSafeToLeave = currentPercentage >= MIN_WORK_PERCENTAGE;

        const start = parseTime(firstStartTime);
        let earlyLeaveTime = 'N/A';
        if (start) {
            const startDate = new Date();
            startDate.setHours(start.hours, start.minutes, 0);
            const leaveDate = new Date(startDate.getTime() + (MIN_WORK_TIME_MINUTES * 60 * 1000) + (breakTimeMinutes * 60 * 1000));
            earlyLeaveTime = leaveDate.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        }

        return {
            currentPercentage: currentPercentage.toFixed(2),
            status,
            statusText,
            minTimeRemaining,
            earlyLeaveTime,
            isSafeToLeave
        };
    }

    function calculateCheatCompletionTime(firstStartTime, totalWorkedMinutes, totalBreakTime) {
        if (!firstStartTime) return { completionTime: 'N/A', overtime: 'N/A' };

        const start = parseTime(firstStartTime);
        if (!start) return { completionTime: 'N/A', overtime: 'N/A' };

        const startDate = new Date();
        startDate.setHours(start.hours, start.minutes, 0);

        const completionDate = new Date(startDate.getTime() + (MIN_WORK_TIME_MINUTES * 60 * 1000) + (totalBreakTime * 60 * 1000));
        let completionTime = completionDate.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        if (totalWorkedMinutes >= MIN_WORK_TIME_MINUTES) {
            completionTime += ' (Completed ✓)';
        }

        const overtimeMinutes = totalWorkedMinutes > MIN_WORK_TIME_MINUTES ? totalWorkedMinutes - MIN_WORK_TIME_MINUTES : 0;
        const overtimeHours = Math.floor(overtimeMinutes / 60);
        const overtimeMins = Math.floor(overtimeMinutes % 60);
        const overtime = overtimeMinutes > 0 ? `${overtimeHours} Hr ${overtimeMins} Min` : 'No overtime';

        return { completionTime, overtime };
    }

    function calculateCheatRemainingTime(startTimeStr, breakTimeMinutes) {
        const start = parseTime(startTimeStr);
        if (!start) return null;

        const now = new Date();
        const startDate = new Date();
        startDate.setHours(start.hours, start.minutes, 0);

        let elapsedMinutes = Math.floor((now - startDate) / (1000 * 60));
        if (elapsedMinutes < 0) elapsedMinutes += 24 * 60;

        const effectiveWorkMinutes = elapsedMinutes - breakTimeMinutes;
        const remainingMinutes = MIN_WORK_TIME_MINUTES - effectiveWorkMinutes;

        return {
            remaining: Math.max(0, remainingMinutes),
            completed: effectiveWorkMinutes >= MIN_WORK_TIME_MINUTES,
            overtime: Math.min(0, remainingMinutes)
        };
    }

    function formatCheatRemainingTime(minutes) {
        if (minutes <= 0) return `7h 45m completed! 🎉`;

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
            
            // Get the selected date with multiple attempts
            let selectedDateInput = document.querySelector('input[formcontrolname="selectedDate"]');
            
            // Try alternative selectors
            if (!selectedDateInput) {
                selectedDateInput = document.querySelector('input[name="selectedDate"]');
            }
            if (!selectedDateInput) {
                selectedDateInput = document.querySelector('.modal-body input[type="text"]');
            }
            
            if (!selectedDateInput) {
                
                // Alternative: Get date from modal header or title
                const modalHeader = document.querySelector('.modal-header, .modal-title');
                if (modalHeader) {
                }
                
                // Check all attendance rows for LEAVE
                const allRows = document.querySelectorAll('.on-hover, .attendance-log-row, [class*="border-bottom"]');
                
                for (const row of allRows) {
                    const rowText = row.textContent || '';
                    
                    // Check if this row has LEAVE and was recently clicked
                    if (rowText.includes('LEAVE') || rowText.includes('Leave')) {
                        // Check if modal is currently open
                        const modalOpen = document.querySelector('.modal.show, .modal.fade.show');
                        if (modalOpen) {
                            return true;
                        }
                    }
                }
                
                return false;
            }
            
            const selectedDateValue = selectedDateInput.value;
            
            if (!selectedDateValue) {
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
        if (!results) return;

        // Calculate cheat mode stats first
        const totalWorkedMinutes = results.totalHours * 60;
        const cheatStats = calculateCheatModeStats(results.firstStartTime, totalWorkedMinutes, results.breakTime);

        // Use cheat mode calculations if enabled
        let completionTime, overtime, remainingTime, remainingTimeStr, targetHoursLabel;
        
        if (cheatModeEnabled) {
            // Calculate based on 7h 45m (465 minutes)
            const cheatCompletionTime = calculateCheatCompletionTime(results.firstStartTime, totalWorkedMinutes, results.breakTime);
            completionTime = cheatCompletionTime.completionTime;
            overtime = cheatCompletionTime.overtime;
            
            remainingTime = calculateCheatRemainingTime(results.firstStartTime, results.breakTime);
            remainingTimeStr = remainingTime ? formatCheatRemainingTime(remainingTime.remaining) : 'N/A';
            targetHoursLabel = '7.75hr';
        } else {
            // Normal calculations
            const normalCalc = calculateTargetCompletion(
                results.firstStartTime,
                results.totalHours,
                results.breakTime
            );
            completionTime = normalCalc.completionTime;
            overtime = normalCalc.overtime;
            
            remainingTime = calculateRemainingTime(results.firstStartTime, results.breakTime);
            remainingTimeStr = remainingTime ? formatSimpleRemainingTime(remainingTime.remaining) : 'N/A';
            targetHoursLabel = isHalfDayMode ? '4hr' : '8hr';
        }
        
        document.title = `${results.totalDuration}`;

        // Define gradient backgrounds
        const gradients = {
            purple: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
            blue: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
            green: 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)',
            orange: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
            completed: 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)',
            pink: 'linear-gradient(135deg, #f472b6 0%, #db2777 100%)',
            cheatGreen: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            cheatYellow: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
            cheatRed: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
        };

        let totalDisplay = container.querySelector('.total-duration-display');
        if (!totalDisplay) {
            totalDisplay = document.createElement('div');
            totalDisplay.className = 'total-duration-display';
            container.appendChild(totalDisplay);
        }
        
        // Update container styling based on cheat mode
        if (cheatModeEnabled) {
            const bgColor = cheatStats.status === 'green' ? 'rgba(16, 185, 129, 0.08)' : 
                           cheatStats.status === 'yellow' ? 'rgba(251, 191, 36, 0.08)' : 
                           'rgba(239, 68, 68, 0.08)';
            const borderColor = cheatStats.status === 'green' ? '#10b981' : 
                               cheatStats.status === 'yellow' ? '#fbbf24' : 
                               '#ef4444';
            const shadowColor = cheatStats.status === 'green' ? 'rgba(16, 185, 129, 0.2)' : 
                               cheatStats.status === 'yellow' ? 'rgba(251, 191, 36, 0.2)' : 
                               'rgba(239, 68, 68, 0.2)';
            
            totalDisplay.style.cssText = `
                margin: 20px;
                padding: 20px;
                background: ${bgColor};
                border-radius: 16px;
                box-shadow: 0 0 30px ${shadowColor}, 0 10px 15px -3px rgba(0, 0, 0, 0.1);
                border: 3px solid ${borderColor};
                transition: all 0.3s ease;
            `;
        } else {
            totalDisplay.style.cssText = `
                margin: 20px;
                padding: 20px;
                background: #ffffff;
                border-radius: 16px;
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
                border: 1px solid #e2e8f0;
                transition: all 0.3s ease;
            `;
        }

        const isCompleted = remainingTime && remainingTime.completed;

        // Insert or update day mode toggle
        const selectedDateFormGroup = document.querySelector('.modal-body .form-group');
        if (!selectedDateFormGroup) return;
        
        const existingCapsule = selectedDateFormGroup.querySelector('.day-mode-capsule');
        const modeGradient = isHalfDayMode ? '#f97316 0%, #ea580c 100%' : '#3b82f6 0%, #2563eb 100%';
        const modeIcon = isHalfDayMode ? '🌗' : '☀️';
        const modeText = `${isHalfDayMode ? '🌗 Half Day' : '☀️ Full Day'}${isHalfDayAutoDetected ? ' (Auto)' : ''}`;
        
        if (!existingCapsule) {
            const label = selectedDateFormGroup.querySelector('label');
            const inputField = selectedDateFormGroup.querySelector('input');
            
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
                
                inputWrapper.insertAdjacentHTML('beforeend', `<div class="day-mode-capsule" style="position: relative; width: 50px; height: 32px; background: linear-gradient(135deg, ${modeGradient}); border-radius: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; flex-shrink: 0;"><span class="mode-icon" style="font-size: 18px; transition: opacity 0.3s ease; z-index: 2;">${modeIcon}</span><span class="mode-full-text" style="position: absolute; font-size: 12px; color: white; font-weight: 600; white-space: nowrap; opacity: 0; transition: opacity 0.3s ease; pointer-events: none;">${modeText}</span></div>`);
                
                inputWrapper.querySelector('.day-mode-capsule').addEventListener('click', () => {
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
            </style>
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
                <div class="metric-card remaining-time-card" style="background: ${isCompleted ? gradients.completed : gradients.green}" onclick="this.dispatchEvent(new CustomEvent('cheatModeClick', {bubbles: true}))">
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
                padding: 10px 16px;
                background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                border-radius: 8px;
                font-size: 10px;
                color: #94a3b8;
                font-weight: 500;
                letter-spacing: 0.5px;
                cursor: pointer;
            " class="uv-signature">
                Enhanced by <span style="color: #7c3aed; font-weight: 600;" class="uv-text">UV</span> ✨${debugMode ? ' <span style="color: #ef4444; font-weight: 700;">🐛 DEBUG</span>' : ''}
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

        totalDisplay.addEventListener('cheatModeClick', () => {
            handleCheatModeClick();
        });

        const uvSignature = totalDisplay.querySelector('.uv-signature');
        if (uvSignature) {
            uvSignature.addEventListener('click', handleUVClick);
        }

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
        
        const container = document.querySelector('.modal-body form div[formarrayname="logs"]');

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
            stopBackgroundNotifications();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
