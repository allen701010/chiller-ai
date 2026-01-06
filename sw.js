// Service Worker for 冰水主機 AI 專家系統 PWA
const CACHE_NAME = 'chiller-ai-v5';  // 更新版本號 - 新增中午提醒
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// ==========================================
// 快取管理
// ==========================================

// 安裝 Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 快取檔案中...');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// 啟動 Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ 清除舊快取:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 攔截網路請求
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          return response;
        }).catch(() => {
          return caches.match('./index.html');
        });
      })
  );
});

// ==========================================
// 背景通知功能
// ==========================================

// 提醒時間設定
const REMINDER_TIMES = [
  { hour: 8, minute: 0, label: '早上' },
  { hour: 12, minute: 0, label: '中午' },
  { hour: 18, minute: 0, label: '下午' }
];

// 提前預警分析時間（提前 1 小時）
const PRE_ALERT_TIMES = [
  { hour: 7, minute: 0, label: '早上預警', targetHour: 8 },
  { hour: 11, minute: 0, label: '中午預警', targetHour: 12 },
  { hour: 17, minute: 0, label: '下午預警', targetHour: 18 }
];

// 焓值計算函數
function calculateEnthalpy(temp, rh) {
  if (!temp || !rh) return 0;
  const Es = 6.112 * Math.exp((17.67 * temp) / (temp + 243.5));
  const E = Es * (rh / 100);
  const w = 0.622 * E / (1013.25 - E);
  const h = 1.006 * temp + w * (2501 + 1.86 * temp);
  return parseFloat(h.toFixed(1));
}

// 取得規則編號
function getRule(enthalpy) {
  if (enthalpy >= 95) return 5;
  if (enthalpy >= 85) return 4;
  if (enthalpy >= 72) return 3;
  if (enthalpy >= 56) return 2;
  return 1;
}

// 取得天氣預報並檢查預警
async function fetchForecastAndCheck() {
  try {
    // 台北市南港區座標
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=25.0554&longitude=121.6169&hourly=temperature_2m,relative_humidity_2m&forecast_days=1&timezone=Asia%2FTaipei');
    if (!res.ok) return null;

    const data = await res.json();
    const hour = new Date().getHours();
    const temp = data.hourly?.temperature_2m?.[hour];
    const hum = data.hourly?.relative_humidity_2m?.[hour];

    if (temp !== undefined && hum !== undefined) {
      const enthalpy = calculateEnthalpy(temp, hum);
      return { temp, hum, enthalpy, rule: getRule(enthalpy) };
    }
  } catch (e) {
    console.warn('SW: 預報取得失敗', e);
  }
  return null;
}

// 發送通知
async function sendNotification(title, body, tag = 'chiller-reminder') {
  if (self.registration.showNotification) {
    await self.registration.showNotification(title, {
      body: body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: tag,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      actions: [
        { action: 'open', title: '開啟系統' },
        { action: 'dismiss', title: '稍後提醒' }
      ]
    });
  }
}

// 檢查是否需要發送提醒
async function checkAndNotify() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // 檢查提前預警分析時間 (07:00, 17:00)
  for (const preAlert of PRE_ALERT_TIMES) {
    if (currentHour === preAlert.hour && currentMinute >= 0 && currentMinute <= 5) {
      const alertKey = `sw-pre-alert-${now.toDateString()}-${preAlert.hour}`;

      const weather = await fetchForecastAndCheck();
      if (weather) {
        const body = `🔮 ${preAlert.label}分析\n\n目前焓值: ${weather.enthalpy} kJ/kg (規則 ${weather.rule})\n\n即將到 ${preAlert.targetHour}:00 分析時間，請準備進行冰水主機檢查。`;
        await sendNotification(`🔮 ${preAlert.label} - 提前預警`, body, alertKey);
        return;
      }
    }
  }

  // 檢查正式提醒時間 (08:00, 18:00)
  for (const time of REMINDER_TIMES) {
    if (currentHour === time.hour && currentMinute >= 0 && currentMinute <= 5) {
      const lastNotifyKey = `sw-notify-${now.toDateString()}-${time.hour}`;

      const weather = await fetchForecastAndCheck();
      let body = `${time.label}好！現在是 ${time.hour}:00，請進行冰水主機運轉狀態分析。`;

      if (weather) {
        body += `\n目前焓值: ${weather.enthalpy} kJ/kg (規則 ${weather.rule})`;
      }

      await sendNotification('🧊 冰水主機分析提醒', body, lastNotifyKey);
      return;
    }
  }

  // 檢查焓值預警 (每小時檢查一次)
  const weather = await fetchForecastAndCheck();
  if (weather) {
    // 高負載預警
    if (weather.enthalpy >= 85 && currentMinute <= 5) {
      await sendNotification(
        '🔥 高負載預警',
        `目前焓值 ${weather.enthalpy} kJ/kg，已進入規則 ${weather.rule} 區間，請確認冰機運轉狀態！`,
        `high-load-${currentHour}`
      );
    }
  }
}

// ==========================================
// 事件監聽
// ==========================================

// 一次性背景同步
self.addEventListener('sync', event => {
  console.log('SW: 背景同步觸發', event.tag);
  if (event.tag === 'sync-reminder') {
    event.waitUntil(checkAndNotify());
  }
});

// 定期背景同步 (Chrome 限定，需要 HTTPS)
self.addEventListener('periodicsync', event => {
  console.log('SW: 定期同步觸發', event.tag);
  if (event.tag === 'check-chiller-reminder') {
    event.waitUntil(checkAndNotify());
  }
});

// 從主頁面接收訊息
self.addEventListener('message', event => {
  console.log('SW: 收到訊息', event.data);

  if (event.data.type === 'CHECK_NOW') {
    checkAndNotify();
  }

  if (event.data.type === 'TRIGGER_TEST_NOTIFICATION') {
    sendNotification(
      '🧊 測試通知 (Service Worker)',
      '背景通知功能運作正常！即使關閉頁面也能收到通知。'
    );
  }
});

// 通知點擊處理
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        // 如果已有視窗開啟，聚焦它
        for (const client of clientList) {
          if (client.url.includes('index.html') && 'focus' in client) {
            return client.focus();
          }
        }
        // 否則開啟新視窗
        if (clients.openWindow) {
          return clients.openWindow('./index.html');
        }
      })
    );
  }
});

// 推播事件 (未來擴展用)
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      sendNotification(data.title || '冰水主機通知', data.body || '有新的通知')
    );
  }
});

console.log('🔧 Service Worker v2 已載入 (含背景通知功能)');
