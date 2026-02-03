/**
 * 冰水主機 AI 專家系統 - 通知系統
 * 版本: 1.2.5
 */

// ==========================================
// 定時提醒配置
// ==========================================
// 正式提醒時間
const REMINDER_TIMES = [
    { hour: 8, minute: 0, label: '早上', type: 'reminder' },
    { hour: 12, minute: 0, label: '中午', type: 'reminder' },
    { hour: 17, minute: 0, label: '下午', type: 'reminder' }
];

// 提前預警分析時間（提前 1 小時）
const PRE_ALERT_TIMES = [
    { hour: 7, minute: 0, label: '早上預警', targetHour: 8 },
    { hour: 11, minute: 0, label: '中午預警', targetHour: 12 },
    { hour: 16, minute: 0, label: '下午預警', targetHour: 17 }
];

let notificationPermission = 'default';
let lastNotifiedTime = localStorage.getItem('lastNotifiedTime') || '';

// ==========================================
// 音效系統
// ==========================================
let audioContext = null;

// 初始化音訊上下文
async function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // 如果 AudioContext 被暫停（瀏覽器自動播放政策），嘗試恢復
    if (audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
            console.log('🔊 AudioContext 已恢復');
        } catch (e) {
            console.warn('無法恢復 AudioContext:', e);
        }
    }
    return audioContext;
}

// 播放預警音效（急促警告音）
async function playWarningSound() {
    try {
        const ctx = await getAudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.frequency.value = 880;  // 高音 A5
        oscillator.type = 'square';

        gainNode.gain.setValueAtTime(0.3, ctx.currentTime);

        oscillator.start(ctx.currentTime);

        // 急促的嗶嗶嗶聲
        for (let i = 0; i < 3; i++) {
            gainNode.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.2);
            gainNode.gain.setValueAtTime(0, ctx.currentTime + i * 0.2 + 0.1);
        }

        oscillator.stop(ctx.currentTime + 0.6);
        console.log('🔊 播放預警音效');
    } catch (e) {
        console.warn('無法播放音效', e);
    }
}

// 播放正式通知音效（溫和鈴聲）
async function playReminderSound() {
    try {
        const ctx = await getAudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.frequency.value = 523.25;  // 中音 C5
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 1);
        console.log('🔔 播放正式通知音效');
    } catch (e) {
        console.warn('無法播放音效', e);
    }
}

// 播放測試音效（短促提示音）
async function playTestSound() {
    try {
        const ctx = await getAudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.frequency.value = 659.25;  // E5
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.3);
        console.log('🎵 播放測試音效');
    } catch (e) {
        console.warn('無法播放音效', e);
    }
}

// ==========================================
// 分頁標題閃爍提醒功能
// ==========================================
let titleFlashInterval = null;
const originalTitle = document.title;

// 開始閃爍標題
function startTitleFlash(alertText) {
    stopTitleFlash();

    let isOriginal = true;
    titleFlashInterval = setInterval(() => {
        document.title = isOriginal ? alertText : originalTitle;
        isOriginal = !isOriginal;
    }, 500);

    console.log('🔔 開始分頁標題閃爍提醒');
}

// 停止閃爍標題
function stopTitleFlash() {
    if (titleFlashInterval) {
        clearInterval(titleFlashInterval);
        titleFlashInterval = null;
        document.title = originalTitle;
        console.log('🔔 停止分頁標題閃爍提醒');
    }
}

// 當頁面獲得焦點時停止閃爍
window.addEventListener('focus', stopTitleFlash);

// ==========================================
// 發送通知
// ==========================================
// soundType: 'warning' | 'reminder' | 'test' | 'none'
function sendNotification(title, body, soundType = 'reminder') {
    // 開始分頁標題閃爍提醒
    const flashText = soundType === 'warning' ? '🔮 預警通知！' : '⏰ 分析提醒！';
    startTitleFlash(flashText);

    // 播放對應音效
    switch (soundType) {
        case 'warning':
            playWarningSound();
            break;
        case 'reminder':
            playReminderSound();
            break;
        case 'test':
            playTestSound();
            break;
    }

    // 頁面內提醒
    const bellIcon = document.getElementById('bell-icon');
    if (bellIcon) {
        bellIcon.classList.add('bell-animate');
        setTimeout(() => bellIcon.classList.remove('bell-animate'), 500);
    }

    // 瀏覽器通知
    if (notificationPermission === 'granted') {
        try {
            const uniqueTag = `chiller-${soundType}-${Date.now()}`;
            const notification = new Notification(title, {
                body: body,
                icon: 'icon-192.png',
                tag: uniqueTag,
                renotify: true,
                requireInteraction: true,
                silent: true
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        } catch (e) {
            console.warn('無法發送通知', e);
        }
    }

    // 頁面內彈窗
    setTimeout(() => {
        const confirmed = confirm(`⏰ ${title}\n\n${body}\n\n點擊「確定」關閉此提醒`);
        if (confirmed) {
            console.log('用戶已確認提醒');
        }
    }, 100);
}

// ==========================================
// 通知權限請求
// ==========================================
async function requestNotificationPermission() {
    const statusIcon = document.getElementById('notif-status-icon');
    const statusText = document.getElementById('notif-status-text');

    if (!('Notification' in window)) {
        if (statusIcon) statusIcon.className = 'status-icon inactive';
        if (statusText) statusText.textContent = '瀏覽器不支援通知';
        return false;
    }

    if (Notification.permission === 'granted') {
        notificationPermission = 'granted';
        if (statusIcon) statusIcon.className = 'status-icon active';
        if (statusText) statusText.textContent = '通知已啟用 ✓';
        return true;
    }

    if (Notification.permission === 'denied') {
        notificationPermission = 'denied';
        if (statusIcon) statusIcon.className = 'status-icon inactive';
        if (statusText) statusText.textContent = '通知被拒絕，請到設定開啟';
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        notificationPermission = permission;
        if (permission === 'granted') {
            if (statusIcon) statusIcon.className = 'status-icon active';
            if (statusText) statusText.textContent = '通知已啟用 ✓';
            return true;
        } else {
            if (statusIcon) statusIcon.className = 'status-icon inactive';
            if (statusText) statusText.textContent = '請允許通知以接收提醒';
            return false;
        }
    } catch (e) {
        if (statusIcon) statusIcon.className = 'status-icon inactive';
        if (statusText) statusText.textContent = '無法請求通知權限';
        return false;
    }
}

// ==========================================
// 提醒時間計算
// ==========================================
function getNextReminderTime() {
    const now = new Date();
    let nextReminder = null;

    for (const time of REMINDER_TIMES) {
        const reminderDate = new Date();
        reminderDate.setHours(time.hour, time.minute, 0, 0);

        if (reminderDate > now) {
            if (!nextReminder || reminderDate < nextReminder) {
                nextReminder = reminderDate;
            }
        }
    }

    if (!nextReminder) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const firstTime = REMINDER_TIMES.reduce((a, b) =>
            (a.hour * 60 + a.minute) < (b.hour * 60 + b.minute) ? a : b
        );
        tomorrow.setHours(firstTime.hour, firstTime.minute, 0, 0);
        nextReminder = tomorrow;
    }

    return nextReminder;
}

function formatCountdown(ms) {
    if (ms <= 0) return '現在！';

    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);

    if (hours > 0) {
        return `${hours}時${minutes}分`;
    } else if (minutes > 0) {
        return `${minutes}分${seconds}秒`;
    } else {
        return `${seconds}秒`;
    }
}

// ==========================================
// 提醒檢查
// ==========================================
function checkReminder() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // 檢查提前預警分析時間
    for (const preAlert of PRE_ALERT_TIMES) {
        if (currentHour === preAlert.hour && currentMinute >= 0 && currentMinute <= 5) {
            const alertKey = `pre-alert-${now.toDateString()}-${preAlert.hour}`;

            if (localStorage.getItem(alertKey) !== 'sent') {
                localStorage.setItem(alertKey, 'sent');
                triggerPreAlertAnalysis(preAlert);
            }
        }
    }

    // 檢查正式提醒時間
    for (const time of REMINDER_TIMES) {
        if (currentHour === time.hour && currentMinute >= 0 && currentMinute <= 5) {
            const reminderKey = `reminder-${now.toDateString()}-${time.hour}`;

            if (localStorage.getItem(reminderKey) !== 'sent') {
                localStorage.setItem(reminderKey, 'sent');

                sendNotification(
                    '🧊 冰水主機分析提醒',
                    `${time.label}好！現在是 ${time.hour}:00，請進行冰水主機運轉狀態分析。`,
                    'reminder'
                );
            }
        }
    }
}

// 提前預警分析
async function triggerPreAlertAnalysis(preAlert) {
    console.log(`⚠️ 觸發提前預警分析: ${preAlert.label}`);

    try {
        if (typeof get24HourForecast === 'function') {
            await get24HourForecast();
        }

        const currentEnthalpy = globalWeather.enthalpy;
        const currentRule = getRule(currentEnthalpy);

        const futureData = typeof forecastData !== 'undefined' ? forecastData[1] : null;

        if (futureData) {
            const futureRule = getRule(futureData.enthalpy);

            let alertMessage = `🔮 ${preAlert.label}分析\n\n`;
            alertMessage += `目前焓值: ${currentEnthalpy} kJ/kg (規則 ${currentRule})\n`;
            alertMessage += `預計 ${preAlert.targetHour}:00 焓值: ${futureData.enthalpy.toFixed(1)} kJ/kg (規則 ${futureRule})\n\n`;

            if (currentRule !== futureRule) {
                alertMessage += `⚠️ 注意！運轉策略將需調整`;
            } else {
                alertMessage += `✅ 運轉策略無需變更`;
            }

            sendNotification(`🔮 ${preAlert.label} - 提前預警分析`, alertMessage, 'warning');
        } else {
            let alertMessage = `🔮 ${preAlert.label}分析\n\n`;
            alertMessage += `目前焓值: ${currentEnthalpy} kJ/kg (規則 ${currentRule})\n\n`;
            alertMessage += `即將到 ${preAlert.targetHour}:00 分析時間，請準備進行冰水主機檢查。`;
            sendNotification(`🔮 ${preAlert.label}`, alertMessage, 'warning');
        }
    } catch (e) {
        console.error('預警分析失敗:', e);
        const currentEnthalpy = globalWeather.enthalpy;
        const currentRule = getRule(currentEnthalpy);
        let alertMessage = `🔮 ${preAlert.label}分析\n\n`;
        alertMessage += `目前焓值: ${currentEnthalpy} kJ/kg (規則 ${currentRule})\n\n`;
        alertMessage += `即將到 ${preAlert.targetHour}:00 分析時間，請準備進行冰水主機檢查。`;
        sendNotification(`🔮 ${preAlert.label}`, alertMessage, 'warning');
    }
}

// 更新倒數計時顯示
function updateCountdown() {
    const nextReminder = getNextReminderTime();
    const now = new Date();
    const diff = nextReminder - now;

    const countdownEl = document.getElementById('next-reminder');
    if (countdownEl) {
        const timeStr = nextReminder.getHours() < 12 ? '早上' : '下午';
        const hourStr = nextReminder.getHours().toString().padStart(2, '0');
        const minStr = nextReminder.getMinutes().toString().padStart(2, '0');
        countdownEl.textContent = `${timeStr} ${hourStr}:${minStr} (${formatCountdown(diff)})`;
    }
}

// ==========================================
// 測試功能
// ==========================================
function testNotification() {
    if (notificationPermission !== 'granted') {
        requestNotificationPermission().then(granted => {
            if (granted) {
                sendNotification('🧊 測試通知', '通知功能運作正常！您會在 08:00、12:00 及 17:00 收到提醒。', 'test');
            } else {
                alert('請先允許通知權限！');
            }
        });
    } else {
        sendNotification('🧊 測試通知', '通知功能運作正常！您會在 08:00、12:00 及 17:00 收到提醒。', 'test');
    }
}

function testReminder() {
    console.log('⏰ 手動觸發正式通知測試');
    const now = new Date();
    const hour = now.getHours();
    const label = hour < 12 ? '早上' : (hour < 17 ? '中午' : '下午');

    sendNotification(
        '🧊 冰水主機分析提醒',
        `${label}好！現在是 ${hour}:00，請進行冰水主機運轉狀態分析。`,
        'reminder'
    );
}

function testPreAlert() {
    console.log('🔮 手動觸發預警測試');

    const testAlert = {
        hour: new Date().getHours(),
        minute: 0,
        label: '預警測試',
        targetHour: new Date().getHours() + 1
    };

    triggerPreAlertAnalysis(testAlert);
}

// ==========================================
// 初始化提醒系統
// ==========================================
function initReminderSystem() {
    requestNotificationPermission();
    updateCountdown();

    // 每秒更新倒數計時
    setInterval(updateCountdown, 1000);

    // 每 30 秒檢查是否該提醒
    setInterval(checkReminder, 30000);

    // 立即檢查一次
    checkReminder();

    // 每 30 分鐘自動刷新 24 小時預測
    setInterval(() => {
        console.log('🔄 自動刷新 24 小時預測...');
        if (typeof get24HourForecast === 'function') {
            get24HourForecast();
        }
    }, 30 * 60 * 1000);
}

// ==========================================
// 音訊解鎖
// ==========================================
let audioUnlocked = false;

async function unlockAudio() {
    if (audioUnlocked) return;
    try {
        const ctx = await getAudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0;
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.start(0);
        oscillator.stop(0.001);
        audioUnlocked = true;
        console.log('🔓 音訊已解鎖');
    } catch (e) {
        console.warn('無法解鎖音訊:', e);
    }
}

document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('touchstart', unlockAudio, { once: true });

// 頁面載入後初始化
document.addEventListener('DOMContentLoaded', initReminderSystem);
