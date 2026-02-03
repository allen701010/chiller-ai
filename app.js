/**
 * 冰水主機 AI 專家系統 - 核心應用邏輯
 * 版本: 1.2.5
 */

// ==========================================
// 全域變數
// ==========================================
// 手機版修正：預設值直接填入，避免 undefined 錯誤
let globalWeather = { temp: 26.5, hum: 60, enthalpy: 50 };
let userApiKey = localStorage.getItem("openrouter_key") || "";
let globalBase64 = null;

// ==========================================
// 冰機噸數配置
// ==========================================
const CHILLER_CONFIG = {
    large: [
        { id: 1, name: '1號大冰機', capacity: 715 },
        { id: 2, name: '2號大冰機', capacity: 715 },
        { id: 3, name: '3號大冰機', capacity: 715 }
    ],
    small: [
        { id: 4, name: '4號小冰機', capacity: 270 },
        { id: 5, name: '5號小冰機', capacity: 270 }
    ],
    totalCapacity: 2685  // 715*3 + 270*2
};

// ==========================================
// 焓值計算
// ==========================================
function calculateEnthalpy(temp, rh) {
    if (!temp || !rh) return 0;
    const Es = 6.112 * Math.exp((17.67 * temp) / (temp + 243.5));
    const E = Es * (rh / 100);
    const w = 0.622 * E / (1013.25 - E);
    const h = 1.006 * temp + w * (2501 + 1.86 * temp);
    return parseFloat(h.toFixed(1));
}

// ==========================================
// 規則引擎
// ==========================================
function runRuleEngine() {
    try {
        const h = globalWeather.enthalpy;

        let color = "#bdc3c7";
        let title = "等待條件...";
        let content = "";

        // --- 根據焓值自動判斷規則 ---
        if (h >= 95) {
            color = "#8e44ad";
            title = `【極限負載】 外氣焓值 ${h} (≧ 95)`;
            content = `<ul><li>運轉建議：<span class="tag-machine">1台大冰</span> + <span class="tag-machine">2台小冰</span> (全開)。</li><li>指令：確保散熱效率最大化。</li></ul>`;
        } else if (h >= 85 && h <= 94) {
            color = "#c0392b";
            title = `【規則 4】 外氣焓值 ${h} (85~94)`;
            content = `<ul><li>運轉建議：<span class="tag-machine">1台大冰</span> (100%) + 加開 <span class="tag-machine">4號小冰</span>。</li><li>水泵：大泵48Hz，小泵40~42Hz。</li></ul>`;
        } else if (h >= 72 && h <= 84) {
            color = "#e67e22";
            title = `【規則 3】 外氣焓值 ${h} (72~84)`;
            content = `<ul><li>操作指令：<span class="tag-action">切換至一台大冰</span> (1號或2號)。</li><li>水泵：上限 48Hz。</li></ul>`;
        } else if (h >= 56 && h < 72) {
            color = "#2980b9";
            title = `【規則 2】 外氣焓值 ${h} (56~71)`;
            content = `<ul><li>運轉建議：<span class="tag-machine">4號小冰</span> + <span class="tag-machine">加開 5號小冰</span>。</li><li>水泵：上限 40Hz。</li></ul>`;
        } else if (h < 56) {
            color = "#27ae60";
            title = `【規則 1】 外氣焓值 ${h} (< 56)`;
            content = `<ul><li>運轉建議：<span class="tag-machine">4號小冰</span> 單獨運轉。</li><li>水泵：上限 45Hz。</li></ul>`;
        }

        document.getElementById("rule-output").innerHTML = `
        <div class="rule-box" style="border-left-color: ${color};">
            <span class="rule-title" style="color:${color}">${title}</span>
            <div class="rule-content">${content}</div>
        </div>`;

    } catch (e) { console.error("規則運算錯誤:", e); }
}

// 取得焓值對應的規則編號
function getRule(enthalpy) {
    if (enthalpy >= 95) return 5;
    if (enthalpy >= 85) return 4;
    if (enthalpy >= 72) return 3;
    if (enthalpy >= 56) return 2;
    return 1;
}

// 計算時間偏移
function getTimeOffset(hour, minutes) {
    const date = new Date();
    date.setHours(hour);
    date.setMinutes(0);
    date.setMinutes(date.getMinutes() + minutes);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// ==========================================
// 圖片上傳事件處理
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    const inputImages = document.getElementById("inputImages");
    if (inputImages) {
        inputImages.addEventListener("change", (e) => {
            if (e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    document.getElementById("preview-area").innerHTML = `<img src="${evt.target.result}">`;
                    globalBase64 = evt.target.result;
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        });
    }

    const resetKeyButton = document.getElementById("reset-key-button");
    if (resetKeyButton) {
        resetKeyButton.addEventListener("click", () => {
            const key = prompt("輸入 OpenRouter API Key:", userApiKey);
            if (key) { userApiKey = key.trim(); localStorage.setItem("openrouter_key", userApiKey); }
        });
    }
});
