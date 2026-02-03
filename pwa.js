/**
 * 冰水主機 AI 專家系統 - PWA 支援模組
 * 版本: 1.2.5
 */

// ==========================================
// Service Worker 註冊
// ==========================================
let swRegistration = null;

async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const swUrl = `sw.js?v=${window.CACHE_BUSTER || Date.now()}`;
            swRegistration = await navigator.serviceWorker.register(swUrl);
            console.log('✅ Service Worker 註冊成功 (版本:', window.CACHE_BUSTER, ')');

            await navigator.serviceWorker.ready;
            console.log('✅ Service Worker 已啟用');

            // 嘗試註冊定期背景同步
            if ('periodicSync' in swRegistration) {
                try {
                    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
                    if (status.state === 'granted') {
                        await swRegistration.periodicSync.register('check-chiller-reminder', {
                            minInterval: 60 * 60 * 1000
                        });
                        console.log('✅ 定期背景同步已註冊');
                    } else {
                        console.log('⚠️ 定期背景同步權限未授予');
                    }
                } catch (e) {
                    console.log('⚠️ 定期背景同步不可用:', e.message);
                }
            }

            // 註冊一次性背景同步
            if ('sync' in swRegistration) {
                try {
                    await swRegistration.sync.register('sync-reminder');
                    console.log('✅ 一次性背景同步已註冊');
                } catch (e) {
                    console.log('⚠️ 背景同步不可用:', e.message);
                }
            }

        } catch (err) {
            console.log('Service Worker 註冊失敗:', err);
        }
    }
}

// 頁面關閉前觸發同步
window.addEventListener('beforeunload', async () => {
    if (swRegistration && 'sync' in swRegistration) {
        try {
            await swRegistration.sync.register('sync-reminder');
        } catch (e) {
            // 無法同步，忽略
        }
    }
});

// 頁面載入後註冊
window.addEventListener('load', registerServiceWorker);
