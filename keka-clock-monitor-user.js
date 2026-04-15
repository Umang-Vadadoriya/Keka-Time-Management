// ==UserScript==
// @name         Keka Clock-In Status Monitor
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Monitors Keka clock-in status every 5 minutes and notifies when status is 0 (clocked out)
// @author       You
// @match        https://your-tenant.keka.com/*
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      your-tenant.keka.com
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
    const API_BASE_URL = "https://your-tenant.keka.com/k/default/api/employee/";
    const STORAGE_KEY_EMPLOYEE_ID = 'keka_monitor_employee_id';
    
    let monitorInterval = null;
    let isMonitoring = false;
    let lastStatus = null;
    let notificationSound = null;
    let employeeId = localStorage.getItem(STORAGE_KEY_EMPLOYEE_ID) || '000000'; // Default employee ID
    let isMinimized = false;

    // Create UI overlay
    function createUI() {
        const container = document.createElement('div');
        container.id = 'keka-monitor-ui';
        container.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            z-index: 10000;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 15px 20px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: white;
            min-width: 280px;
            backdrop-filter: blur(10px);
        `;

        container.innerHTML = `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <h3 style="margin: 0; font-size: 16px; font-weight: 600;">
                        🕐 Clock-In Monitor
                    </h3>
                    <button id="minimize-btn" style="
                        padding: 4px 8px;
                        border: none;
                        border-radius: 4px;
                        background: rgba(255,255,255,0.15);
                        color: white;
                        cursor: pointer;
                        font-size: 14px;
                        transition: all 0.2s;
                        line-height: 1;
                    " title="Minimize">−</button>
                </div>
                <div id="monitor-content" style="transition: all 0.3s;">
                <div style="margin-bottom: 8px;">
                    <label style="font-size: 11px; opacity: 0.9; display: block; margin-bottom: 4px;">
                        Employee ID:
                    </label>
                    <div style="display: flex; gap: 4px;">
                        <input 
                            type="text" 
                            id="employee-id-input" 
                            value="${employeeId}"
                            placeholder="Enter Employee ID"
                            style="
                                flex: 1;
                                padding: 6px 8px;
                                border: none;
                                border-radius: 4px;
                                background: rgba(255,255,255,0.9);
                                color: #333;
                                font-size: 13px;
                                font-family: monospace;
                            "
                        />
                        <button id="save-employee-id" style="
                            padding: 6px 12px;
                            border: none;
                            border-radius: 4px;
                            background: rgba(255,255,255,0.25);
                            color: white;
                            cursor: pointer;
                            font-size: 11px;
                            font-weight: 500;
                            transition: all 0.2s;
                        ">💾</button>
                    </div>
                </div>
                <div id="status-display" style="font-size: 13px; opacity: 0.95; margin-bottom: 8px;">
                    Status: <span id="current-status" style="font-weight: bold;">Initializing...</span>
                </div>
                <div id="last-check" style="font-size: 11px; opacity: 0.8;">
                    Last check: Never
                </div>
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <button id="toggle-monitor" style="
                    flex: 1;
                    padding: 8px 12px;
                    border: none;
                    border-radius: 6px;
                    background: rgba(255,255,255,0.2);
                    color: white;
                    cursor: pointer;
                    font-weight: 500;
                    font-size: 13px;
                    transition: all 0.2s;
                ">Start Monitoring</button>
                <button id="check-now" style="
                    padding: 8px 12px;
                    border: none;
                    border-radius: 6px;
                    background: rgba(255,255,255,0.15);
                    color: white;
                    cursor: pointer;
                    font-size: 13px;
                    transition: all 0.2s;
                ">Check Now</button>
            </div>
            <div style="font-size: 11px; opacity: 0.75; text-align: center; line-height: 1.4;">
                Checks every 5 minutes<br>
                <span style="opacity: 0.6;">⚠️ Persistent notifications</span>
            </div>
                </div>
        `;

        document.body.appendChild(container);

        // Add hover effects
        const buttons = container.querySelectorAll('button');
        buttons.forEach(btn => {
            const originalBg = btn.style.background;
            btn.addEventListener('mouseenter', () => {
                if (btn.id !== 'toggle-monitor' || !isMonitoring) {
                    btn.style.background = 'rgba(255,255,255,0.35)';
                }
                btn.style.transform = 'translateY(-1px)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = originalBg;
                btn.style.transform = 'translateY(0)';
            });
        });

        // Event listeners
        document.getElementById('toggle-monitor').addEventListener('click', toggleMonitoring);
        document.getElementById('check-now').addEventListener('click', checkStatus);
        document.getElementById('save-employee-id').addEventListener('click', saveEmployeeId);
        document.getElementById('minimize-btn').addEventListener('click', toggleMinimize);
        
        // Allow Enter key to save employee ID
        document.getElementById('employee-id-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveEmployeeId();
            }
        });

        return container;
    }

    // Toggle minimize
    function toggleMinimize() {
        isMinimized = !isMinimized;
        const content = document.getElementById('monitor-content');
        const btn = document.getElementById('minimize-btn');
        const container = document.getElementById('keka-monitor-ui');
        
        if (isMinimized) {
            content.style.display = 'none';
            btn.textContent = '+';
            btn.title = 'Expand';
            container.style.minWidth = 'auto';
        } else {
            content.style.display = 'block';
            btn.textContent = '−';
            btn.title = 'Minimize';
            container.style.minWidth = '280px';
        }
    }

    // Save employee ID
    function saveEmployeeId() {
        const input = document.getElementById('employee-id-input');
        const newEmployeeId = input.value.trim();
        
        if (!newEmployeeId) {
            alert('Please enter a valid Employee ID');
            return;
        }
        
        if (!/^\d+$/.test(newEmployeeId)) {
            alert('Employee ID must be a number');
            return;
        }
        
        // Stop monitoring if active
        if (isMonitoring) {
            stopMonitoring();
        }
        
        // Update employee ID
        employeeId = newEmployeeId;
        localStorage.setItem(STORAGE_KEY_EMPLOYEE_ID, employeeId);
        
        // Visual feedback
        const saveBtn = document.getElementById('save-employee-id');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = '✓';
        saveBtn.style.background = 'rgba(76, 175, 80, 0.5)';
        
        setTimeout(() => {
            saveBtn.textContent = originalText;
            saveBtn.style.background = 'rgba(255,255,255,0.25)';
        }, 1500);
        
        updateUI('Employee ID updated. Click Start to monitor.', null);
        console.log(`✅ Employee ID updated to: ${employeeId}`);
    }

    // Get API URL with current employee ID
    function getApiUrl() {
        return `${API_BASE_URL}${employeeId}/profile/clockInDetailsForToday`;
    }

    // Initialize audio for notifications
    function initAudio() {
        // Create a simple beep sound using Web Audio API
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        notificationSound = () => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        };
    }

    // Get access token from localStorage
    function getAccessToken() {
        try {
            const accessToken = localStorage.getItem('access_token');
            if (!accessToken) {
                console.warn('No access_token found in localStorage');
                return null;
            }
            return accessToken;
        } catch (error) {
            console.error('Error reading access_token from localStorage:', error);
            return null;
        }
    }

    // Check clock-in status
    async function checkStatus() {
        try {
            const accessToken = getAccessToken();
            
            if (!accessToken) {
                updateUI('❌ Error: No access token found', null);
                updateLastCheckTime();
                return;
            }

            const apiUrl = getApiUrl();
            console.log(`🔍 Checking status for Employee ID: ${employeeId}`);

            const response = await fetch(apiUrl, {
                credentials: "include",
                headers: {
                    "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0",
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Content-Type": "application/json; charset=utf-8",
                    "X-Requested-With": "XMLHttpRequest",
                    "Authorization": `Bearer ${accessToken}`,
                    "Sec-GPC": "1",
                    "Sec-Fetch-Dest": "empty",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Site": "same-origin"
                },
                referrer: "https://your-tenant.keka.com/",
                method: "GET",
                mode: "cors"
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.succeeded && result.data) {
                const clockInStatus = result.data.clockInStatus;
                const statusText = clockInStatus === 0 ? '⚠️ CLOCKED OUT' : 
                                 clockInStatus === 1 ? '✅ CLOCKED IN' : 
                                 '❓ UNKNOWN';
                
                updateUI(statusText, clockInStatus);
                
                // Notify if clocked out (status is 0)
                if (clockInStatus === 0) {
                    notifyUser(result.data);
                }
                
                lastStatus = clockInStatus;
            } else {
                updateUI('❌ Error: ' + (result.message || 'Unknown error'), null);
            }
            
            updateLastCheckTime();
            
        } catch (error) {
            console.error('Keka Monitor Error:', error);
            updateUI('❌ Error: ' + error.message, null);
            updateLastCheckTime();
        }
    }

    // Update UI with status
    function updateUI(statusText, status) {
        const statusElement = document.getElementById('current-status');
        if (statusElement) {
            statusElement.textContent = statusText;
            
            // Change color based on status
            if (status === 0) {
                statusElement.style.color = '#ffeb3b';
                statusElement.style.textShadow = '0 0 10px rgba(255,235,59,0.5)';
            } else if (status === 1) {
                statusElement.style.color = '#4caf50';
                statusElement.style.textShadow = 'none';
            } else {
                statusElement.style.color = 'white';
                statusElement.style.textShadow = 'none';
            }
        }
    }

    // Update last check time
    function updateLastCheckTime() {
        const lastCheckElement = document.getElementById('last-check');
        if (lastCheckElement) {
            const now = new Date();
            lastCheckElement.textContent = `Last check: ${now.toLocaleTimeString()}`;
        }
    }

    // Notify user
    function notifyUser(data) {
        const title = '⚠️ Clock-In Alert!';
        const message = 'You are currently CLOCKED OUT!\n' +
                       `Status: ${data.clockInStatus}\n` +
                       `Day Type: ${data.dayType}\n` +
                       `Remote: ${data.isRemote ? 'Yes' : 'No'}`;
        
        // Desktop notification (if Tampermonkey grant is available)
        if (typeof GM_notification !== 'undefined') {
            GM_notification({
                title: title,
                text: message,
                timeout: 0, // 0 means persistent until dismissed
                onclick: () => {
                    window.focus();
                }
            });
        } else {
            // Fallback to browser notification (persistent)
            if ('Notification' in window) {
                if (Notification.permission === 'granted') {
                    new Notification(title, {
                        body: message,
                        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">⚠️</text></svg>',
                        requireInteraction: true, // Makes notification persistent
                        tag: 'keka-clock-alert', // Groups notifications
                        renotify: true, // Play sound even if notification exists
                        silent: false // Ensure sound plays
                    });
                } else if (Notification.permission !== 'denied') {
                    Notification.requestPermission().then(permission => {
                        if (permission === 'granted') {
                            new Notification(title, { 
                                body: message,
                                requireInteraction: true,
                                tag: 'keka-clock-alert'
                            });
                        }
                    });
                }
            }
        }

        // Play sound
        if (notificationSound) {
            try {
                notificationSound();
                // Play twice with delay for emphasis
                setTimeout(notificationSound, 300);
            } catch (e) {
                console.error('Error playing sound:', e);
            }
        }

        // Flash the UI
        const container = document.getElementById('keka-monitor-ui');
        if (container) {
            let flashCount = 0;
            const flashInterval = setInterval(() => {
                container.style.background = flashCount % 2 === 0 ? 
                    'linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%)' :
                    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                flashCount++;
                if (flashCount >= 6) {
                    clearInterval(flashInterval);
                }
            }, 500);
        }

        console.warn('🚨 KEKA ALERT: You are clocked out!', data);
    }

    // Toggle monitoring
    function toggleMonitoring() {
        if (isMonitoring) {
            stopMonitoring();
        } else {
            startMonitoring();
        }
    }

    // Start monitoring
    function startMonitoring() {
        if (isMonitoring) return;
        
        isMonitoring = true;
        const toggleBtn = document.getElementById('toggle-monitor');
        if (toggleBtn) {
            toggleBtn.textContent = 'Stop Monitoring';
            toggleBtn.style.background = 'rgba(255,107,107,0.3)';
        }
        
        // Check immediately
        checkStatus();
        
        // Then check every 5 minutes
        monitorInterval = setInterval(checkStatus, CHECK_INTERVAL);
        
        console.log('✅ Keka monitoring started - checking every 5 minutes');
    }

    // Stop monitoring
    function stopMonitoring() {
        if (!isMonitoring) return;
        
        isMonitoring = false;
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
        
        const toggleBtn = document.getElementById('toggle-monitor');
        if (toggleBtn) {
            toggleBtn.textContent = 'Start Monitoring';
            toggleBtn.style.background = 'rgba(255,255,255,0.2)';
        }
        
        console.log('⏸️ Keka monitoring stopped');
    }

    // Initialize when page loads
    function init() {
        // Wait for page to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        // Remove existing UI if any
        const existingUI = document.getElementById('keka-monitor-ui');
        if (existingUI) {
            existingUI.remove();
        }

        // Create UI
        setTimeout(() => {
            createUI();
            initAudio();
            
            // Request notification permission
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
            
            console.log('🕐 Keka Clock-In Monitor loaded. Click "Start Monitoring" to begin.');
        }, 1000);
    }

    // Start initialization
    init();

})();
