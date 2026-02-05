/**
 * 高壓三段式時間電價模組
 * 依據台電高壓供電時間電價表
 * 
 * 夏月：5/16 ~ 10/15
 * 非夏月：夏月以外時間
 */

// ==========================================
// 電價設定
// ==========================================
const ELECTRICITY_PRICING = {
    // 夏月定義：5/16 ~ 10/15
    summerStart: { month: 5, day: 16 },
    summerEnd: { month: 10, day: 15 },

    // 週一至週五電價
    weekday: {
        summer: {
            peak: { price: 9.39, periods: [[16, 22]] },           // 尖峰 16:00~22:00
            semiPeak: { price: 5.85, periods: [[9, 16], [22, 24]] }, // 半尖峰 09:00~16:00, 22:00~24:00
            offPeak: { price: 2.53, periods: [[0, 9]] }            // 離峰 00:00~09:00
        },
        nonSummer: {
            peak: { price: null, periods: [] },                    // 無尖峰
            semiPeak: { price: 5.47, periods: [[6, 11], [14, 24]] }, // 半尖峰 06:00~11:00, 14:00~24:00
            offPeak: { price: 2.32, periods: [[0, 6], [11, 14]] }   // 離峰 00:00~06:00, 11:00~14:00
        }
    },

    // 週六電價
    saturday: {
        summer: {
            peak: { price: null, periods: [] },
            semiPeak: { price: 2.60, periods: [[9, 24]] },         // 半尖峰 09:00~24:00
            offPeak: { price: 2.53, periods: [[0, 9]] }            // 離峰 00:00~09:00
        },
        nonSummer: {
            peak: { price: null, periods: [] },
            semiPeak: { price: 2.41, periods: [[6, 11], [14, 24]] }, // 半尖峰 06:00~11:00, 14:00~24:00
            offPeak: { price: 2.32, periods: [[0, 6], [11, 14]] }   // 離峰 00:00~06:00, 11:00~14:00
        }
    },

    // 週日及離峰日電價
    sunday: {
        summer: {
            peak: { price: null, periods: [] },
            semiPeak: { price: null, periods: [] },
            offPeak: { price: 2.53, periods: [[0, 24]] }           // 離峰 全日
        },
        nonSummer: {
            peak: { price: null, periods: [] },
            semiPeak: { price: null, periods: [] },
            offPeak: { price: 2.32, periods: [[0, 24]] }           // 離峰 全日
        }
    }
};

// ==========================================
// 判斷函數
// ==========================================

/**
 * 判斷是否為夏月
 * @param {Date} date 
 * @returns {boolean}
 */
function isSummerMonth(date = new Date()) {
    const month = date.getMonth() + 1; // getMonth() 是 0-indexed
    const day = date.getDate();

    const { summerStart, summerEnd } = ELECTRICITY_PRICING;

    // 5/16 ~ 10/15
    if (month > summerStart.month && month < summerEnd.month) {
        return true;
    }
    if (month === summerStart.month && day >= summerStart.day) {
        return true;
    }
    if (month === summerEnd.month && day <= summerEnd.day) {
        return true;
    }
    return false;
}

/**
 * 取得星期幾對應的電價表
 * @param {Date} date 
 * @returns {'weekday' | 'saturday' | 'sunday'}
 */
function getDayType(date = new Date()) {
    const dayOfWeek = date.getDay(); // 0=週日, 6=週六
    if (dayOfWeek === 0) return 'sunday';
    if (dayOfWeek === 6) return 'saturday';
    return 'weekday';
}

/**
 * 檢查時間是否在指定時段內
 * @param {number} hour 小時 (0-23)
 * @param {Array} periods 時段陣列 [[start, end], ...]
 * @returns {boolean}
 */
function isInPeriod(hour, periods) {
    for (const [start, end] of periods) {
        if (hour >= start && hour < end) {
            return true;
        }
    }
    return false;
}

/**
 * 取得當前時段類型與電價
 * @param {Date} date 
 * @returns {{type: string, typeName: string, price: number, season: string, dayTypeName: string}}
 */
function getCurrentPricing(date = new Date()) {
    const hour = date.getHours();
    const isSummer = isSummerMonth(date);
    const dayType = getDayType(date);
    const season = isSummer ? 'summer' : 'nonSummer';
    const seasonName = isSummer ? '夏月' : '非夏月';

    // 日期類型名稱
    const dayTypeNames = {
        'weekday': '平日',
        'saturday': '週六',
        'sunday': '假日'
    };
    const dayTypeName = dayTypeNames[dayType] || '平日';

    const pricing = ELECTRICITY_PRICING[dayType][season];

    // 依優先順序檢查：尖峰 > 半尖峰 > 離峰
    if (pricing.peak.price && isInPeriod(hour, pricing.peak.periods)) {
        return { type: 'peak', typeName: '尖峰', price: pricing.peak.price, season: seasonName, dayTypeName };
    }
    if (pricing.semiPeak.price && isInPeriod(hour, pricing.semiPeak.periods)) {
        return { type: 'semiPeak', typeName: '半尖峰', price: pricing.semiPeak.price, season: seasonName, dayTypeName };
    }
    if (pricing.offPeak.price && isInPeriod(hour, pricing.offPeak.periods)) {
        return { type: 'offPeak', typeName: '離峰', price: pricing.offPeak.price, season: seasonName, dayTypeName };
    }

    // 預設回傳離峰
    return { type: 'offPeak', typeName: '離峰', price: pricing.offPeak.price || 2.32, season: seasonName, dayTypeName };
}

/**
 * 取得未來 N 小時的電價預覽
 * @param {number} hours 小時數
 * @param {Date} startDate 起始時間
 * @returns {Array<{hour: number, time: string, type: string, typeName: string, price: number}>}
 */
function getHourlyPrices(hours = 6, startDate = new Date()) {
    const result = [];
    const current = new Date(startDate);

    for (let i = 0; i < hours; i++) {
        const pricing = getCurrentPricing(current);
        result.push({
            hour: i,
            time: `${current.getHours().toString().padStart(2, '0')}:00`,
            ...pricing
        });
        current.setHours(current.getHours() + 1);
    }

    return result;
}

/**
 * 計算運轉電費
 * @param {number} powerKW 功率 (kW)
 * @param {number} hours 運轉時數
 * @param {number} pricePerKWh 每度電價
 * @returns {number} 電費 (元)
 */
function calculateRunningCost(powerKW, hours, pricePerKWh) {
    return powerKW * hours * pricePerKWh;
}

/**
 * 取得電價時段的 CSS 顏色類別
 * @param {string} type 時段類型
 * @returns {string} 顏色
 */
function getPricingColor(type) {
    switch (type) {
        case 'peak': return '#e74c3c';      // 紅色 - 尖峰
        case 'semiPeak': return '#f39c12';  // 橘色 - 半尖峰
        case 'offPeak': return '#27ae60';   // 綠色 - 離峰
        default: return '#95a5a6';
    }
}

/**
 * 更新電價顯示
 */
function updatePricingDisplay() {
    const pricing = getCurrentPricing();
    const container = document.getElementById('pricing-display');
    if (!container) return;

    const color = getPricingColor(pricing.type);

    container.innerHTML = `
        <div class="pricing-current" style="border-left: 4px solid ${color};">
            <div class="pricing-type" style="color: #1a1a2e;">${pricing.typeName}</div>
            <div class="pricing-value">${pricing.price.toFixed(2)} <small>元/度</small></div>
        </div>
    `;

    // 更新未來 6 小時預覽
    const hourlyPrices = getHourlyPrices(6);
    const previewContainer = document.getElementById('pricing-preview');
    if (previewContainer) {
        previewContainer.innerHTML = hourlyPrices.map(p => `
            <div class="pricing-hour" style="background: ${getPricingColor(p.type)}20; border-bottom: 2px solid ${getPricingColor(p.type)};">
                <span class="hour">${p.time}</span>
                <span class="price">${p.price.toFixed(2)}</span>
            </div>
        `).join('');
    }

    // 更新右上角標籤 (季節 + 日期類型)
    const seasonTag = document.getElementById('pricing-season');
    if (seasonTag) {
        seasonTag.textContent = `${pricing.season} ${pricing.dayTypeName}`;
    }
}

// 每分鐘更新電價顯示
setInterval(updatePricingDisplay, 60000);

// 初始化時更新
document.addEventListener('DOMContentLoaded', () => {
    updatePricingDisplay();
});

console.log('⚡ 電價模組已載入');
