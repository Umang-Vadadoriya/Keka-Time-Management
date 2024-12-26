// ==UserScript==
// @name         Enhanced Keka Log Duration by UV with Advanced Notifications
// @name:en      Enhanced Keka Log Duration (English)
// @namespace    http://tampermonkey.net/
// @version      6.2
// @description  Calculate log durations with improved UI and smart notifications
// @description:en Calculate log durations with improved UI and smart notifications (English)
// @author       Umang Vadadoriya
// @tag          utility
// @tag          automation
// @match        https://ezeetechnosys.keka.com/*
// @include      https://ezeetechnosys.keka.com/*
// @exclude      https://ezeetechnosys.keka.com/login*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=keka.com
// @grant        GM_notification
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @run-at       document-end
// @source       https://github.com/Umang-Vadadoriya-YCS/Keka-Time-Management
// @updateURL    https://raw.githubusercontent.com/Umang-Vadadoriya-YCS/Keka-Time-Management/refs/heads/master/Enhanced%20Keka%20Log%20Duration%20by%20UV%20with%20Advanced%20Notifications.js
// @downloadURL  https://raw.githubusercontent.com/Umang-Vadadoriya-YCS/Keka-Time-Management/refs/heads/master/Enhanced%20Keka%20Log%20Duration%20by%20UV%20with%20Advanced%20Notifications.js
// @supportURL   https://github.com/Umang-Vadadoriya-YCS/Keka-Time-Management/issues
// @homepage     https://github.com/Umang-Vadadoriya-YCS/Keka-Time-Management
// @compatible   firefox
// @compatible   chrome
// @license      MIT
// @noframes
// @contributionURL https://github.com/Umang-Vadadoriya-YCS/Keka-Time-Management
// @copyright    2024, Umang Vadadoriya (https://github.com/Umang-Vadadoriya-YCS)
// ==/UserScript==

(function () {
    'use strict';

    // Global state variables
    let modalOpen = false;
    let lastStartTime = null;
    let notificationInterval = null;
    let totalBreakTimeMinutes = 0;
    let notificationCounter = 0;

    // Constants
    const EIGHT_HOURS_IN_MINUTES = 8 * 60;
    const NOTIFICATION_INTERVAL = 1; // minutes

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
            new Notification('Keka Time Alert', {
                body: message,
                icon: 'https://www.google.com/s2/favicons?sz=64&domain=keka.com'
            });
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

            if (index !== 0 && brekduration && renderOnUI) {
                const breakInfoElement = row.querySelector('.break-info') || document.createElement('div');
                breakInfoElement.className = 'break-info';
                breakInfoElement.innerHTML = `
                    <div class="break-duration-badge" style="
                        background: #f1f5f9;
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 12px;
                        color: #64748b;
                        margin-left: 10px;
                    ">
                        Break: ${brekduration.hours}h ${brekduration.minutes}m
                    </div>`;
                if (!row.querySelector('.break-info')) {
                    row.appendChild(breakInfoElement);
                }
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

    function calculateEightHourCompletion(firstStartTime, totalWorkedHours, totalBreakTime) {
        if (!firstStartTime) return { completionTime: 'N/A', overtime: 'N/A' };

        const start = parseTime(firstStartTime);
        if (!start) return { completionTime: 'N/A', overtime: 'N/A' };

        const startDate = new Date();
        startDate.setHours(start.hours, start.minutes, 0);

        const eightHoursInMinutes = 8 * 60;
        const totalWorkedMinutes = totalWorkedHours * 60;

        const completionDate = new Date(startDate.getTime() + (eightHoursInMinutes * 60 * 1000) + (totalBreakTime * 60 * 1000));
        let completionTime = completionDate.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        if (totalWorkedMinutes >= eightHoursInMinutes) {
            completionTime += ' (Completed ✓)';
        }

        const overtimeMinutes = totalWorkedMinutes > eightHoursInMinutes ? totalWorkedMinutes - eightHoursInMinutes : 0;
        const overtimeHours = Math.floor(overtimeMinutes / 60);
        const overtimeMins = Math.floor(overtimeMinutes % 60);
        const overtime = overtimeMinutes > 0 ? `${overtimeHours} Hr ${overtimeMins} Min` : 'No overtime';

        return { completionTime, overtime };
    }

    function formatSimpleRemainingTime(minutes) {
        if (minutes <= 0) return "8 hours completed! 🎉";

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
        // TODO - Handle Calculation Based On Last Start Time
        const start = parseTime(startTimeStr);
        if (!start) return null;

        const now = new Date();
        const startDate = new Date();
        startDate.setHours(start.hours, start.minutes, 0);

        let elapsedMinutes = Math.floor((now - startDate) / (1000 * 60));
        if (elapsedMinutes < 0) elapsedMinutes += 24 * 60;

        const effectiveWorkMinutes = elapsedMinutes - breakTimeMinutes;
        const remainingMinutes = EIGHT_HOURS_IN_MINUTES - effectiveWorkMinutes;

        return {
            remaining: Math.max(0, remainingMinutes),
            completed: effectiveWorkMinutes >= EIGHT_HOURS_IN_MINUTES,
            overtime: Math.min(0, remainingMinutes)
        };
    }

    function shouldNotify(remaining) {
        // For regular workday remaining time
        const hourNotifications = [8, 7, 6, 5, 4, 3, 2];
        const minuteNotifications = [60, 50, 40, 30, 20, 15, 10, 5, 0];

        // Convert remaining minutes to hours and minutes
        const hours = Math.floor(remaining / 60);
        const minutes = remaining % 60;

        // Check if current time matches any notification point
        return hourNotifications.includes(hours) && minutes === 0 ||
               hours === 0 && minuteNotifications.includes(minutes);
    }

    function shouldNotifyOvertime(overtimeMinutes) {
        // For overtime notifications
        const overtimeHourNotifications = [1, 2, 3, 4, 5];
        const overtimeMinuteNotifications = [5, 10, 15, 20, 25, 30];

        const hours = Math.floor(overtimeMinutes / 60);
        const minutes = overtimeMinutes % 60;

        return overtimeHourNotifications.includes(hours) && minutes === 0 ||
               hours === 0 && overtimeMinuteNotifications.includes(minutes);
    }

    function startBackgroundNotifications() {
        if (notificationInterval) {
            clearInterval(notificationInterval);
        }

        const container = document.querySelector('.modal-body form div[formarrayname="logs"]');
        if (!container) return;

        const firstStartElement = container.querySelector('.d-flex.align-items-center .w-120.mr-20 .text-small');
        if (!firstStartElement) return;

        lastStartTime = firstStartElement.textContent.trim();


        // Calculate initial break time
        const results = processTimeEntries(container, false);
        totalBreakTimeMinutes = results ? results.breakTime : 0;

        notificationInterval = setInterval(() => {
            const remainingTime = calculateRemainingTime(lastStartTime, totalBreakTimeMinutes);

            if (remainingTime) {
                if (remainingTime.overtime < 0) {
                    // Handle overtime notifications
                    const overtimeMinutes = Math.abs(remainingTime.overtime);
                    if (shouldNotifyOvertime(overtimeMinutes)) {
                        const hours = Math.floor(overtimeMinutes / 60);
                        const minutes = overtimeMinutes % 60;
                        let message = "You're working overtime! ";
                        if (hours > 0) {
                            message += `${hours} hour${hours > 1 ? 's' : ''} `;
                        }
                        if (minutes > 0) {
                            message += `${minutes} minute${minutes > 1 ? 's' : ''} `;
                        }
                        message += "extra! 🚀";
                        showNotification(message);
                    }
                } else if (!remainingTime.completed && shouldNotify(remainingTime.remaining)) {
                    // Handle regular workday notifications
                    const timeStr = formatSimpleRemainingTime(remainingTime.remaining);
                    showNotification(getRandomNotificationMessage(timeStr));
                } else if (remainingTime.completed && remainingTime.remaining === 0) {
                    // Notify when exactly 8 hours are completed
                    showNotification("Congratulations! You've completed your 8-hour workday! 🎉");
                }
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

    const updateUI = debounce((container) => {
        if (!container) return;
        const modalDialog = document.querySelector('.modal-dialog.right-modal.right-modal-450');
        if (modalDialog) {
            modalDialog.style.width = '500px';
        }

        const results = processTimeEntries(container);
        if (!results) return;

        const { completionTime, overtime } = calculateEightHourCompletion(
            results.firstStartTime,
            results.totalHours,
            results.breakTime
        );

        const remainingTime = calculateRemainingTime(results.firstStartTime, results.breakTime);
        const remainingTimeStr = remainingTime ? formatSimpleRemainingTime(remainingTime.remaining) : 'N/A';
        document.title = `${results.totalDuration}`;

        // Define gradient backgrounds
        const gradients = {
            purple: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
            blue: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
            green: 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)',
            orange: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
            completed: 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)'
        };

        let totalDisplay = container.querySelector('.total-duration-display');
        if (!totalDisplay) {
            totalDisplay = document.createElement('div');
            totalDisplay.className = 'total-duration-display';
            totalDisplay.style.cssText = `
                margin: 20px;
                padding: 20px;
                background: #ffffff;
                border-radius: 16px;
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
                border: 1px solid #e2e8f0;
            `;
            container.appendChild(totalDisplay);
        }

        const isCompleted = remainingTime && remainingTime.completed;

        totalDisplay.innerHTML = `
            <style>
                .metric-card {
                    padding: 16px;
                    border-radius: 12px;
                    color: white;
                    transition: transform 0.2s ease-in-out;
                    position: relative;
                    overflow: hidden;
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
            </style>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;">
                <div class="metric-card" style="background: ${gradients.purple}">
                    <div class="spark-icon">⏱️</div>
                    <div class="metric-label">Total Duration</div>
                    <div class="metric-value">${results.totalDuration}</div>
                </div>
                <div class="metric-card" style="background: ${gradients.blue}">
                    <div class="spark-icon">🎯</div>
                    <div class="metric-label">8hr Completion</div>
                    <div class="metric-value">${completionTime}</div>
                </div>
                <div class="metric-card" style="background: ${gradients.orange}">
                    <div class="spark-icon">⭐</div>
                    <div class="metric-label">Overtime</div>
                    <div class="metric-value">${overtime}</div>
                </div>
                <div class="metric-card" style="background: ${isCompleted ? gradients.completed : gradients.green}">
                    <div class="spark-icon">${isCompleted ? '🎉' : '⌛'}</div>
                    <div class="metric-label">Remaining Time</div>
                    <div class="metric-value">${remainingTimeStr}</div>
                </div>
            </div>
        `;

        // Add colorful styling to break duration badges
        const breakInfoElements = container.querySelectorAll('.break-info');
        breakInfoElements.forEach((element, index) => {
            element.innerHTML = element.innerHTML.replace(
                'class="break-duration-badge"',
                `class="break-duration-badge" style="
                    background: ${gradients.blue};
                    padding: 6px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    color: white;
                    margin-left: 10px;
                    font-weight: 500;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                    display: inline-block;
                "`
            );
        });
    }, 250);

    // Add styles for break duration indicators
    const style = document.createElement('style');
    style.textContent = `
            .break-duration-badge {
                transition: transform 0.2s ease-in-out;
            }
            .break-duration-badge:hover {
                transform: translateY(-1px);
            }
        `;
    document.head.appendChild(style);

    // Initialize observer
    const observer = new MutationObserver(mutations => {
        const container = document.querySelector('.modal-body form div[formarrayname="logs"]');

        if (container && !modalOpen) {
            modalOpen = true;
            updateUI(container);
            startBackgroundNotifications();
        } else if (!container && modalOpen) {
            modalOpen = false;
            stopBackgroundNotifications();
        }
    });

    // Start observing
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
