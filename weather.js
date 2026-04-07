/**
 * 冰水主機 AI 專家系統 - 天氣與預測模組
 * 版本: 1.2.5
 */

// ==========================================
// API 配置
// ==========================================
const CWA_API_KEY = 'CWA-1140C840-6DB4-43F4-B08C-8782C7305D72';
const CWA_STATION_ID = '466920';  // 台北站

// CORS Proxy (解決 GitHub Pages 跨域問題)
// 多個 CORS Proxy 備用清單，依序嘗試
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?url=',
  'https://api.codetabs.com/v1/proxy?quest='
];
let currentProxyIndex = 0;
const USE_CORS_PROXY = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && !location.protocol.includes('file');

// 帶 timeout 的 fetch（每次嘗試獨立的 timeout，避免共用 AbortController）
async function fetchWithTimeout(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// 透過 CORS Proxy 取得資料（含自動 fallback）
// 策略：先直連 → 失敗再依序嘗試每個 CORS Proxy
async function fetchWithProxy(targetUrl) {
  // 本地開發環境直接 fetch
  if (!USE_CORS_PROXY) {
    return fetch(targetUrl);
  }

  // 第一步：先嘗試直連（有些 API 本身支援 CORS）
  try {
    const res = await fetchWithTimeout(targetUrl, 5000);
    if (res.ok) {
      console.log(`✅ 直連成功: ${new URL(targetUrl).hostname}`);
      return res;
    }
  } catch (e) {
    console.warn(`⚠️ 直連失敗 (${new URL(targetUrl).hostname}):`, e.message);
  }

  // 第二步：依序嘗試 CORS Proxy（每個有獨立 timeout）
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyIndex = (currentProxyIndex + i) % CORS_PROXIES.length;
    const proxy = CORS_PROXIES[proxyIndex];
    const fetchUrl = proxy + encodeURIComponent(targetUrl);

    try {
      const res = await fetchWithTimeout(fetchUrl, 6000);
      if (res.ok) {
        // 驗證回應內容不是 proxy 錯誤頁面
        const cloned = res.clone();
        const text = await cloned.text();
        if (text.startsWith('error') || text.includes('error code')) {
          console.warn(`⚠️ CORS Proxy 回傳錯誤內容 (${proxy.split('/')[2]}):`, text.substring(0, 80));
          continue;
        }
        currentProxyIndex = proxyIndex;
        console.log(`✅ CORS Proxy 成功: ${proxy.split('/')[2]}`);
        // 重新包裝成 Response 以便後續 .json() 使用
        return new Response(text, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers
        });
      }
    } catch (e) {
      console.warn(`⚠️ CORS Proxy 失敗 (${proxy.split('/')[2]}):`, e.message);
    }
  }

  throw new Error('所有 CORS Proxy 均無法連線');
}

// 除錯訊息
console.log('🌐 Weather.js 載入完成');
console.log('📍 目前位置:', location.hostname);
console.log('🔄 使用 CORS Proxy:', USE_CORS_PROXY);

let forecastData = [];
let lastForecastSource = '';

// ==========================================
// 天氣顯示更新
// ==========================================
function showLocationStatus(message, isError = false) {
    const statusEl = document.getElementById("location-status");
    if (statusEl) {
        statusEl.innerText = message;
        statusEl.style.color = isError ? "#ff6b6b" : "#ffeaa7";
    }
}

function setWeatherData(t, rh, source = "南港區") {
    const h = calculateEnthalpy(t, rh);
    const tempEl = document.getElementById("w-temp");
    const humEl = document.getElementById("w-hum");
    const hEl = document.getElementById("w-h");

    if (tempEl) tempEl.innerText = t;
    if (humEl) humEl.innerText = rh;
    if (hEl) hEl.innerText = h;

    globalWeather = { temp: t, hum: rh, enthalpy: h };
    showLocationStatus(`✓ ${source}`);
    runRuleEngine();

    // 天氣數據更新後，同步更新 24 小時預測圖表和預警
    if (forecastData.length > 0) {
        drawEnthalpyChart();
        generateForecastAlerts();
    }
}

// ==========================================
// 南港區天氣取得
// ==========================================
async function getNangangWeather() {
    showLocationStatus("正在取得南港區天氣...");

    // 優先使用 CWA 中央氣象署（直連成功率高）
    try {
        const cwaUrl = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?Authorization=${CWA_API_KEY}&StationId=${CWA_STATION_ID}`;
        const res = await fetchWithProxy(cwaUrl);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.records?.Station?.[0]) {
                const station = data.records.Station[0];
                const weather = station.WeatherElement;
                const temp = parseFloat(weather.AirTemperature);
                const hum = parseInt(weather.RelativeHumidity);
                if (!isNaN(temp) && !isNaN(hum) && temp !== -99 && hum !== -99) {
                    console.log(`🌡️ CWA 即時天氣: ${temp}°C, ${hum}%`);
                    setWeatherData(temp, hum, "中央氣象署即時天氣");
                    return true;
                }
            }
        }
    } catch (e) {
        console.warn('CWA 即時天氣失敗:', e.message);
    }

    // 備用：Open-Meteo
    try {
        const lat = 25.0554;
        const lon = 121.6169;
        const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relative_humidity_2m&timezone=Asia%2FTaipei`;
        const res = await fetchWithProxy(openMeteoUrl);
        if (!res.ok) throw new Error("API 回應錯誤");
        const data = await res.json();
        const t = data.current_weather?.temperature;

        const hourlyTime = data.hourly?.time || [];
        const hourlyHum = data.hourly?.relative_humidity_2m || [];
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const currentHourStr = `${year}-${month}-${day}T${hour}:00`;

        let rh = null;
        for (let i = 0; i < hourlyTime.length; i++) {
            if (hourlyTime[i] === currentHourStr) {
                rh = hourlyHum[i];
                break;
            }
        }
        if (rh === null) rh = hourlyHum[now.getHours()];

        if (t !== undefined && rh !== undefined) {
            console.log(`🌡️ Open-Meteo 南港區: ${t}°C, ${rh}%`);
            setWeatherData(t, rh, "南港區即時天氣");
            return true;
        }
    } catch (e) {
        console.warn("Open-Meteo 天氣 API 失敗", e);
    }
    return false;
}

// 使用本地預設值
function useLocalDefault() {
    const month = new Date().getMonth() + 1;
    let temp, hum;

    if (month >= 6 && month <= 9) {
        temp = 30 + Math.random() * 4;
        hum = 70 + Math.random() * 15;
    } else if (month >= 12 || month <= 2) {
        temp = 15 + Math.random() * 5;
        hum = 65 + Math.random() * 15;
    } else {
        temp = 22 + Math.random() * 6;
        hum = 65 + Math.random() * 15;
    }

    temp = parseFloat(temp.toFixed(1));
    hum = Math.round(hum);
    setWeatherData(temp, hum, `南港區估算值 (${month}月)`);
}

// 初始化天氣
async function initWeather() {
    showLocationStatus("正在取得南港區天氣...");
    const success = await getNangangWeather();
    if (!success) {
        showLocationStatus("⚠️ 網路受限，使用本地估算", true);
        useLocalDefault();
    }
}

// ==========================================
// 24 小時預測 API
// ==========================================

// CWA 中央氣象署 API
async function tryCWA_API() {
    try {
        const cwaUrl = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?Authorization=${CWA_API_KEY}&StationId=${CWA_STATION_ID}`;
        const res = await fetchWithProxy(cwaUrl);

        if (!res.ok) throw new Error('CWA API 回應錯誤');

        const data = await res.json();
        if (!data.success || !data.records?.Station?.[0]) {
            throw new Error('CWA 無資料');
        }

        const station = data.records.Station[0];
        const weather = station.WeatherElement;
        const temp = parseFloat(weather.AirTemperature);
        const hum = parseInt(weather.RelativeHumidity);

        if (isNaN(temp) || isNaN(hum) || temp === -99 || hum === -99) {
            throw new Error('CWA 資料無效');
        }

        const enthalpy = calculateEnthalpy(temp, hum);
        const now = new Date();
        const currentHour = now.getHours();

        forecastData = [];
        for (let i = 0; i < 24; i++) {
            const futureHour = (currentHour + i) % 24;
            let tempOffset = 0;
            let humOffset = 0;

            if (futureHour >= 6 && futureHour <= 14) {
                tempOffset = (futureHour - 6) * 0.5;
            } else if (futureHour > 14 && futureHour < 20) {
                tempOffset = (20 - futureHour) * 0.3;
            } else {
                tempOffset = -1;
            }

            humOffset = -tempOffset * 2;

            const forecastTemp = Math.max(5, Math.min(40, temp + tempOffset));
            const forecastHum = Math.max(20, Math.min(100, hum + humOffset));
            const forecastEnthalpy = calculateEnthalpy(forecastTemp, forecastHum);

            forecastData.push({
                hour: futureHour,
                hoursFromNow: i,
                temp: Math.round(forecastTemp * 10) / 10,
                hum: Math.round(forecastHum),
                enthalpy: forecastEnthalpy,
                timeStr: new Date(now.getTime() + i * 3600000).toISOString()
            });
        }

        setWeatherData(temp, hum, weather.Weather || '陰');
        lastForecastSource = 'CWA';
        console.log(`✅ 使用 CWA 中央氣象署資料 (${station.StationName}站): ${temp}°C, ${hum}%`);
        return true;

    } catch (e) {
        console.warn('⚠️ CWA API 失敗:', e.message);
        return false;
    }
}

// Open-Meteo API
async function tryOpenMeteoAPI() {
    const lat = 25.04294;
    const lon = 121.61377;

    try {
        const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m&forecast_days=2&timezone=Asia%2FTaipei`;
        const res = await fetchWithProxy(openMeteoUrl);

        if (!res.ok) throw new Error('API 回應錯誤');

        const data = await res.json();
        const hourlyTime = data.hourly?.time || [];
        const hourlyTemp = data.hourly?.temperature_2m || [];
        const hourlyHum = data.hourly?.relative_humidity_2m || [];

        if (hourlyTemp.length === 0) throw new Error('無資料');

        const now = new Date();
        const currentHour = now.getHours();

        forecastData = [];
        for (let i = 0; i < 24; i++) {
            const dataIndex = currentHour + i;
            if (dataIndex < hourlyTemp.length) {
                const temp = hourlyTemp[dataIndex];
                const hum = hourlyHum[dataIndex];
                const enthalpy = calculateEnthalpy(temp, hum);
                const timeStr = hourlyTime[dataIndex];
                const hour = new Date(timeStr).getHours();

                forecastData.push({
                    hour: hour,
                    hoursFromNow: i,
                    temp: temp,
                    hum: hum,
                    enthalpy: enthalpy,
                    timeStr: timeStr
                });
            }
        }
        lastForecastSource = 'Open-Meteo';
        console.log('✅ 使用 Open-Meteo API 取得預報');
        return true;

    } catch (e) {
        console.warn('⚠️ Open-Meteo API 失敗:', e.message);
        return false;
    }
}

// wttr.in 備用 API
async function tryWttrAPI() {
    try {
        const wttrUrl = 'https://wttr.in/25.04294,121.61377?format=j1';
        const res = await fetchWithProxy(wttrUrl);

        if (!res.ok) throw new Error('API 回應錯誤');

        const data = await res.json();
        const weatherDays = data.weather || [];

        if (weatherDays.length === 0) throw new Error('無資料');

        const now = new Date();
        const currentHour = now.getHours();

        let allHourlyData = [];
        weatherDays.forEach((day, dayIndex) => {
            const hourlyArr = day.hourly || [];
            hourlyArr.forEach(h => {
                const timeValue = parseInt(h.time) / 100;
                allHourlyData.push({
                    dayIndex: dayIndex,
                    hour: timeValue,
                    absoluteHour: dayIndex * 24 + timeValue,
                    temp: parseFloat(h.tempC),
                    hum: parseInt(h.humidity)
                });
            });
        });

        allHourlyData.sort((a, b) => a.absoluteHour - b.absoluteHour);

        function interpolate(x, x1, y1, x2, y2) {
            if (x2 === x1) return y1;
            return y1 + (y2 - y1) * (x - x1) / (x2 - x1);
        }

        forecastData = [];
        const currentAbsoluteHour = currentHour;

        for (let i = 0; i < 24; i++) {
            const targetAbsoluteHour = currentAbsoluteHour + i;
            const targetHour = targetAbsoluteHour % 24;

            let prevPoint = null;
            let nextPoint = null;

            for (let j = 0; j < allHourlyData.length; j++) {
                const d = allHourlyData[j];
                const adjustedAbsoluteHour = d.dayIndex * 24 + d.hour;

                if (adjustedAbsoluteHour <= targetAbsoluteHour) {
                    prevPoint = { ...d, adjustedHour: adjustedAbsoluteHour };
                }
                if (adjustedAbsoluteHour >= targetAbsoluteHour && !nextPoint) {
                    nextPoint = { ...d, adjustedHour: adjustedAbsoluteHour };
                }
            }

            let temp, hum;
            if (prevPoint && nextPoint && prevPoint !== nextPoint) {
                temp = interpolate(targetAbsoluteHour, prevPoint.adjustedHour, prevPoint.temp, nextPoint.adjustedHour, nextPoint.temp);
                hum = interpolate(targetAbsoluteHour, prevPoint.adjustedHour, prevPoint.hum, nextPoint.adjustedHour, nextPoint.hum);
            } else if (prevPoint) {
                temp = prevPoint.temp;
                hum = prevPoint.hum;
            } else if (nextPoint) {
                temp = nextPoint.temp;
                hum = nextPoint.hum;
            } else {
                continue;
            }

            temp = parseFloat(temp.toFixed(1));
            hum = Math.round(hum);
            const enthalpy = calculateEnthalpy(temp, hum);

            const targetDate = new Date(now);
            targetDate.setHours(targetDate.getHours() + i);

            forecastData.push({
                hour: targetHour,
                hoursFromNow: i,
                temp: temp,
                hum: hum,
                enthalpy: enthalpy,
                timeStr: targetDate.toISOString()
            });
        }

        if (forecastData.length < 12) throw new Error('資料不足');

        lastForecastSource = 'wttr.in';
        console.log('✅ 使用 wttr.in 備用 API 取得預報');
        return true;

    } catch (e) {
        console.warn('⚠️ wttr.in 備用 API 失敗:', e.message);
        return false;
    }
}

// 本地估算 fallback
function useForecastFallback() {
    const now = new Date();
    const currentHour = now.getHours();
    const month = now.getMonth() + 1;

    forecastData = [];
    for (let i = 0; i < 24; i++) {
        const hour = (currentHour + i) % 24;

        let baseTemp, baseHum;
        if (month >= 6 && month <= 9) {
            baseTemp = 28 + 5 * Math.sin((hour - 6) * Math.PI / 12);
            baseHum = 75 + 10 * Math.cos((hour - 14) * Math.PI / 12);
        } else if (month >= 12 || month <= 2) {
            baseTemp = 14 + 4 * Math.sin((hour - 6) * Math.PI / 12);
            baseHum = 70 + 10 * Math.cos((hour - 14) * Math.PI / 12);
        } else {
            baseTemp = 22 + 5 * Math.sin((hour - 6) * Math.PI / 12);
            baseHum = 70 + 10 * Math.cos((hour - 14) * Math.PI / 12);
        }

        const temp = parseFloat(baseTemp.toFixed(1));
        const hum = Math.round(Math.max(40, Math.min(95, baseHum)));
        const enthalpy = calculateEnthalpy(temp, hum);

        forecastData.push({
            hour: hour,
            hoursFromNow: i,
            temp: temp,
            hum: hum,
            enthalpy: enthalpy,
            timeStr: `估算-${hour}:00`
        });
    }
    lastForecastSource = '本地估算';
    console.log('ℹ️ 使用本地估算值（無法連線任何 API）');
    return true;
}

// 主要預報取得函式
async function get24HourForecast() {
    const statusEl = document.getElementById('forecast-status');
    if (statusEl) statusEl.textContent = '正在取得天氣預報...(中央氣象署)';

    let success = false;

    // 優先使用 CWA（直連成功率最高）
    success = await tryCWA_API();

    if (!success) {
        if (statusEl) statusEl.textContent = 'CWA 無法連線，嘗試 Open-Meteo...';
        success = await tryOpenMeteoAPI();
    }

    if (!success) {
        if (statusEl) statusEl.textContent = '嘗試備用來源 (wttr.in)...';
        success = await tryWttrAPI();
    }

    if (!success) {
        if (statusEl) statusEl.textContent = '所有 API 無法連線，使用本地估算...';
        useForecastFallback();
    }

    const now = new Date();
    if (statusEl) {
        if (lastForecastSource === 'CWA') {
            statusEl.textContent = `📡 中央氣象署 (臺北站) | ${now.toLocaleTimeString('zh-TW')}`;
        } else if (lastForecastSource === 'Open-Meteo') {
            statusEl.textContent = `🎯 Open-Meteo (中研公園) | ${now.toLocaleTimeString('zh-TW')}`;
        } else if (lastForecastSource === 'wttr.in') {
            statusEl.textContent = `⚡ 備用來源 | ${now.toLocaleTimeString('zh-TW')}`;
        } else {
            statusEl.textContent = `⚠️ 估算值 | ${now.toLocaleTimeString('zh-TW')}`;
        }
    }

    drawEnthalpyChart();
    generateForecastAlerts();
    saveAnalysisHistory();

    return forecastData;
}

// ==========================================
// 圖表繪製
// ==========================================
function drawEnthalpyChart() {
    const canvas = document.getElementById('enthalpy-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    if (forecastData.length === 0) return;

    const displayHours = 7;
    const limitedForecastData = forecastData.slice(0, displayHours);
    const currentEnthalpy = globalWeather.enthalpy || limitedForecastData[0]?.enthalpy || 50;

    const allEnthalpies = [currentEnthalpy, ...limitedForecastData.slice(1).map(d => d.enthalpy)];
    const minH = Math.floor((Math.min(...allEnthalpies) - 5) / 10) * 10 - 5;
    const maxH = Math.ceil((Math.max(...allEnthalpies) + 5) / 10) * 10 + 5;

    const padding = { left: 35, right: 10, top: 15, bottom: 25 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // 繪製背景區域
    const ruleZones = [
        { min: 0, max: 56, color: 'rgba(46, 204, 113, 0.2)', label: '規則1' },
        { min: 56, max: 72, color: 'rgba(41, 128, 185, 0.2)', label: '規則2' },
        { min: 72, max: 85, color: 'rgba(230, 126, 34, 0.2)', label: '規則3' },
        { min: 85, max: 95, color: 'rgba(192, 57, 43, 0.2)', label: '規則4' },
        { min: 95, max: 150, color: 'rgba(142, 68, 173, 0.2)', label: '極限' }
    ];

    ruleZones.forEach(zone => {
        if (zone.max > minH && zone.min < maxH) {
            const y1 = padding.top + chartHeight - ((Math.min(zone.max, maxH) - minH) / (maxH - minH)) * chartHeight;
            const y2 = padding.top + chartHeight - ((Math.max(zone.min, minH) - minH) / (maxH - minH)) * chartHeight;
            ctx.fillStyle = zone.color;
            ctx.fillRect(padding.left, y1, chartWidth, y2 - y1);
        }
    });

    // 繪製 Y 軸網格線和標籤
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;

    // 計算合適的刻度間距
    const range = maxH - minH;
    let step = 10;
    if (range <= 20) step = 5;
    else if (range <= 50) step = 10;
    else step = 20;

    // 計算起始刻度值（對齊到 step 的倍數）
    const startValue = Math.ceil(minH / step) * step;

    // 繪製水平網格線和 Y 軸標籤
    for (let h = startValue; h <= maxH; h += step) {
        const y = padding.top + chartHeight - ((h - minH) / (maxH - minH)) * chartHeight;

        // 繪製網格線
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        // 繪製 Y 軸標籤
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(h.toString(), padding.left - 3, y + 3);
    }

    // 額外標記臨界線（如果在範圍內）
    const criticalLines = [56, 72, 85, 95];
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;

    criticalLines.forEach(h => {
        if (h >= minH && h <= maxH) {
            const y = padding.top + chartHeight - ((h - minH) / (maxH - minH)) * chartHeight;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }
    });

    ctx.setLineDash([]);


    // 繪製誤差範圍帶
    const chartData = [currentEnthalpy, ...limitedForecastData.slice(1).map(d => d.enthalpy)];
    const errorMargin = 4;

    ctx.beginPath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    chartData.forEach((enthalpy, i) => {
        const x = padding.left + (i / (chartData.length - 1)) * chartWidth;
        const margin = i === 0 ? 0 : errorMargin;
        const yUpper = padding.top + chartHeight - ((enthalpy + margin - minH) / (maxH - minH)) * chartHeight;
        if (i === 0) ctx.moveTo(x, yUpper);
        else ctx.lineTo(x, yUpper);
    });
    for (let i = chartData.length - 1; i >= 0; i--) {
        const x = padding.left + (i / (chartData.length - 1)) * chartWidth;
        const margin = i === 0 ? 0 : errorMargin;
        const yLower = padding.top + chartHeight - ((chartData[i] - margin - minH) / (maxH - minH)) * chartHeight;
        ctx.lineTo(x, yLower);
    }
    ctx.closePath();
    ctx.fill();

    // 繪製焓值曲線
    ctx.beginPath();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;

    chartData.forEach((enthalpy, i) => {
        const x = padding.left + (i / (chartData.length - 1)) * chartWidth;
        const y = padding.top + chartHeight - ((enthalpy - minH) / (maxH - minH)) * chartHeight;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();

    // 繪製數據點
    chartData.forEach((enthalpy, i) => {
        const x = padding.left + (i / (chartData.length - 1)) * chartWidth;
        const y = padding.top + chartHeight - ((enthalpy - minH) / (maxH - minH)) * chartHeight;

        let pointColor = '#fff';
        if (enthalpy >= 95) pointColor = '#9b59b6';
        else if (enthalpy >= 85) pointColor = '#e74c3c';
        else if (enthalpy >= 72) pointColor = '#f39c12';
        else if (enthalpy >= 56) pointColor = '#3498db';
        else pointColor = '#2ecc71';

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = pointColor;
        ctx.fill();
    });

    // 繪製 X 軸標籤
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';

    for (let i = 2; i < limitedForecastData.length; i += 2) {
        const d = limitedForecastData[i];
        const x = padding.left + (i / (chartData.length - 1)) * chartWidth;
        ctx.fillText(`${d.hour.toString().padStart(2, '0')}:00`, x, height - 5);
    }

    ctx.fillStyle = '#ffeaa7';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('現在', padding.left, height - 5);
}

// ==========================================
// 預警生成
// ==========================================
function generateForecastAlerts() {
    const alertsContainer = document.getElementById('forecast-alerts');
    if (!alertsContainer || forecastData.length === 0) return;

    const alerts = [];
    const currentEnthalpy = globalWeather.enthalpy || forecastData[0]?.enthalpy || 0;
    const currentRule = getRule(currentEnthalpy);
    const alertedChanges = new Set();

    for (let i = 1; i <= 6 && i < forecastData.length; i++) {
        const d = forecastData[i];
        const prevEnthalpy = (i === 1) ? currentEnthalpy : forecastData[i - 1]?.enthalpy;
        const prevRule = getRule(prevEnthalpy);
        const nextRule = getRule(d.enthalpy);

        if (prevRule !== nextRule) {
            const timeStr = `${d.hour.toString().padStart(2, '0')}:00`;
            const changeKey = `${prevRule}->${nextRule}`;

            if (alertedChanges.has(changeKey)) continue;

            if (d.enthalpy >= 72 && prevEnthalpy < 72) {
                alerts.push({ type: 'warning', icon: '⚠️', message: `預計 ${timeStr} 焓值將達 ${d.enthalpy.toFixed(0)}，建議 ${getTimeOffset(d.hour, -30)} 前切換至大冰機` });
                alertedChanges.add(changeKey);
            } else if (d.enthalpy < 56 && prevEnthalpy >= 56) {
                alerts.push({ type: 'info', icon: '💡', message: `預計 ${timeStr} 焓值將降至 ${d.enthalpy.toFixed(0)}，可切換為 4號小冰單獨運轉（規則1）` });
                alertedChanges.add(changeKey);
            } else if (d.enthalpy >= 85 && prevEnthalpy < 85) {
                alerts.push({ type: 'warning', icon: '🔥', message: `預計 ${timeStr} 進入高負載區 (焓值 ${d.enthalpy.toFixed(0)})，建議加開小冰機` });
                alertedChanges.add(changeKey);
            } else if (d.enthalpy >= 95 && prevEnthalpy < 95) {
                alerts.push({ type: 'warning', icon: '🚨', message: `預計 ${timeStr} 進入極限負載區 (焓值 ${d.enthalpy.toFixed(0)})，建議全開冰機` });
                alertedChanges.add(changeKey);
            } else if (d.enthalpy < 72 && prevEnthalpy >= 72) {
                alerts.push({ type: 'info', icon: '📉', message: `預計 ${timeStr} 焓值將降至 ${d.enthalpy.toFixed(0)}，可考慮切回小冰機` });
                alertedChanges.add(changeKey);
            } else if (d.enthalpy >= 56 && prevEnthalpy < 56) {
                alerts.push({ type: 'info', icon: '📈', message: `預計 ${timeStr} 焓值將升至 ${d.enthalpy.toFixed(0)}，建議加開 5號小冰（規則2）` });
                alertedChanges.add(changeKey);
            }
        }
    }

    // 顯示預警
    if (alerts.length === 0) {
        let currentAdvice = '';
        if (currentEnthalpy >= 95) currentAdvice = '🔴 極限負載：建議 1台大冰 + 2台小冰（全開）';
        else if (currentEnthalpy >= 85) currentAdvice = '🟠 規則4：建議 1台大冰(100%) + 加開4號小冰';
        else if (currentEnthalpy >= 72) currentAdvice = '🟡 規則3：建議切換至1台大冰';
        else if (currentEnthalpy >= 56) currentAdvice = '🔵 規則2：建議 4號小冰 + 加開5號小冰';
        else currentAdvice = '🟢 規則1：建議 4號小冰單獨運轉';

        alertsContainer.innerHTML = `<div class="forecast-alert info">📊 現況焓值 ${currentEnthalpy.toFixed(1)} | ${currentAdvice}</div><div class="forecast-alert info" style="opacity:0.8;">✅ 未來 6 小時預測無規則變化</div>`;
    } else {
        alertsContainer.innerHTML = alerts.map(a => `<div class="forecast-alert ${a.type}">${a.icon} ${a.message}</div>`).join('');
    }
}

// 儲存分析歷史
function saveAnalysisHistory() {
    if (forecastData.length === 0) return;

    const now = new Date();
    const key = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}`;

    const currentData = forecastData[0];
    const historyEntry = {
        enthalpy: currentData.enthalpy,
        temp: currentData.temp,
        hum: currentData.hum,
        rule: getRule(currentData.enthalpy),
        timestamp: now.toISOString()
    };

    let history = {};
    try {
        history = JSON.parse(localStorage.getItem('chillerHistory') || '{}');
    } catch (e) {
        history = {};
    }

    history[key] = historyEntry;

    // 只保留最近 7 天
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().slice(0, 10);

    Object.keys(history).forEach(k => {
        if (k < cutoffDate) delete history[k];
    });

    localStorage.setItem('chillerHistory', JSON.stringify(history));
}

// ==========================================
// 測試預警功能
// ==========================================
function testForecastAlerts() {
    const alertsContainer = document.getElementById('forecast-alerts');
    if (!alertsContainer) return alert('找不到預警容器！');

    const testAlerts = [
        { type: 'warning', icon: '⚠️', message: '【測試】預計 14:00 焓值將達 75，建議 13:30 前切換至大冰機' },
        { type: 'warning', icon: '🔥', message: '【測試】預計 15:00 進入高負載區 (焓值 88)，建議加開小冰機' },
        { type: 'info', icon: '📈', message: '【測試】未來 2 小時焓值預計上升 10 (70 → 80)，建議提前準備' }
    ];

    alertsContainer.innerHTML = '<div class="forecast-alert info" style="background: #fff3cd; border-left-color: #f39c12;">🧪 測試模式 - 以下為模擬預警</div>' +
        testAlerts.map(a => `<div class="forecast-alert ${a.type}">${a.icon} ${a.message}</div>`).join('');

    const statusEl = document.getElementById('forecast-status');
    if (statusEl) statusEl.textContent = '🧪 測試預警已觸發 - 5 秒後恢復正常';

    setTimeout(() => {
        generateForecastAlerts();
        if (statusEl) statusEl.textContent = '✓ 已恢復正常預警顯示';
    }, 5000);
}

// 刷新預報
function refresh24HourForecast() {
    const btn = event?.target?.closest('button');
    if (btn) {
        btn.classList.add('is-loading');
        setTimeout(() => btn.classList.remove('is-loading'), 1000);
    }
    get24HourForecast();
}

// ==========================================
// 初始化
// ==========================================
function initForecastSystem() {
    get24HourForecast();
    setInterval(get24HourForecast, 30 * 60 * 1000);
    window.addEventListener('resize', () => {
        if (forecastData.length > 0) drawEnthalpyChart();
    });
}

// 頁面載入後初始化
document.addEventListener('DOMContentLoaded', () => {
    initWeather();
    initForecastSystem();
});
