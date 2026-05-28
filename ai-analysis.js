/**
 * 冰水主機 AI 專家系統 - AI 分析模組
 * 版本: 1.2.5
 * 
 * 新增功能：
 * - 分析結果快取 (30 分鐘有效)
 * - 分析歷史記錄 (最多 50 筆)
 * - 強化錯誤處理與進度顯示
 */

// ==========================================
// AI 模型配置
// ==========================================
const MODEL_FALLBACK_LIST = [
    // 多模態模型（支援圖片分析）
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "google/gemma-4-31b-it:free",
    "moonshotai/kimi-k2.6:free",
    // 純文字備用模型
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "openai/gpt-oss-120b:free",
];

// ==========================================
// 分析結果快取系統 (新增)
// ==========================================
const CACHE_TTL = 30 * 60 * 1000;  // 30 分鐘快取有效期
let analysisCache = {};

function getCacheKey(enthalpy, loadRT) {
    // 將焓值四捨五入到整數，負載四捨五入到十位數
    const enthalpyKey = Math.round(enthalpy);
    const loadKey = Math.round(loadRT / 10) * 10;
    return `${enthalpyKey}-${loadKey}`;
}

function getCachedResult(enthalpy, loadRT) {
    const key = getCacheKey(enthalpy, loadRT);
    const cached = analysisCache[key];

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('📦 使用快取結果:', key);
        return cached.result;
    }
    return null;
}

function setCacheResult(enthalpy, loadRT, result) {
    const key = getCacheKey(enthalpy, loadRT);
    analysisCache[key] = {
        result: result,
        timestamp: Date.now()
    };

    // 清理過期快取
    const now = Date.now();
    Object.keys(analysisCache).forEach(k => {
        if (now - analysisCache[k].timestamp > CACHE_TTL) {
            delete analysisCache[k];
        }
    });
}

// ==========================================
// 分析歷史記錄系統 (新增)
// ==========================================
const MAX_HISTORY_ITEMS = 50;
const AI_HISTORY_KEY = 'ai_analysis_history';

function getAnalysisHistory() {
    try {
        return JSON.parse(localStorage.getItem(AI_HISTORY_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function saveToHistory(enthalpy, loadRT, suggestion, model) {
    const history = getAnalysisHistory();

    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        timestamp: new Date().toISOString(),
        enthalpy: enthalpy,
        loadRT: loadRT,
        suggestion: suggestion.substring(0, 200),  // 只保存前 200 字
        model: model
    };

    history.unshift(entry);

    // 保留最新 50 筆
    if (history.length > MAX_HISTORY_ITEMS) {
        history.splice(MAX_HISTORY_ITEMS);
    }

    localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(history));
    console.log('💾 已儲存分析歷史記錄');

    return entry;
}

function clearAnalysisHistory() {
    localStorage.removeItem(AI_HISTORY_KEY);
    console.log('🗑️ 已清除分析歷史記錄');
}

// ==========================================
// 模型進度追蹤 (新增)
// ==========================================
let currentModelIndex = 0;
let totalModels = MODEL_FALLBACK_LIST.length;

function updateModelProgress(index, container) {
    currentModelIndex = index;
    const progressPercent = ((index + 1) / totalModels) * 100;

    const progressHtml = `
        <div class="model-progress">
            <span>嘗試模型 ${index + 1}/${totalModels}</span>
            <div class="model-progress-bar">
                <div class="model-progress-fill" style="width: ${progressPercent}%"></div>
            </div>
        </div>
    `;

    if (container) {
        const existingProgress = container.querySelector('.model-progress');
        if (existingProgress) {
            existingProgress.outerHTML = progressHtml;
        }
    }
}

// ==========================================
// AI 模型呼叫
// ==========================================

// 視覺分析 (帶圖片)
async function callAIModel(modelName, prompt) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${userApiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.href
        },
        body: JSON.stringify({
            model: modelName,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: globalBase64 } }
                ]
            }]
        })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    if (!data.choices || !data.choices.length) throw new Error("無回應");
    return { content: data.choices[0].message.content, model: modelName };
}

// 遞迴嘗試分析
async function tryAnalysisRecursive(modelIndex, prompt) {
    if (modelIndex >= MODEL_FALLBACK_LIST.length) {
        throw new Error("所有 AI 模型繁忙，請稍後再試。");
    }

    const loadingText = document.getElementById("loading-text");
    if (loadingText) {
        loadingText.innerHTML = `AI 分析中 (嘗試模型 ${modelIndex + 1}/${MODEL_FALLBACK_LIST.length})
            <span class="loading-dots"><span></span><span></span><span></span></span>`;
    }

    try {
        return await callAIModel(MODEL_FALLBACK_LIST[modelIndex], prompt);
    } catch (error) {
        console.warn(`Model ${modelIndex + 1} failed:`, error.message);
        return await tryAnalysisRecursive(modelIndex + 1, prompt);
    }
}

// 純文字 AI 呼叫
async function callAIModelText(modelName, prompt) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${userApiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.href
        },
        body: JSON.stringify({
            model: modelName,
            messages: [{ role: "user", content: prompt }]
        })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    if (!data.choices || !data.choices.length) throw new Error("無回應");
    return { content: data.choices[0].message.content, model: modelName };
}

async function tryTextAnalysisRecursive(modelIndex, prompt, progressContainer = null) {
    if (modelIndex >= MODEL_FALLBACK_LIST.length) {
        throw new Error("所有 AI 模型繁忙");
    }

    updateModelProgress(modelIndex, progressContainer);

    try {
        return await callAIModelText(MODEL_FALLBACK_LIST[modelIndex], prompt);
    } catch (error) {
        console.warn(`Text model ${modelIndex + 1} failed:`, error.message);
        return await tryTextAnalysisRecursive(modelIndex + 1, prompt, progressContainer);
    }
}

// ==========================================
// 冰機負載分析
// ==========================================
function calculateOptimalChillers(loadRT) {
    const configs = [];

    for (let large = 0; large <= 3; large++) {
        for (let small = 0; small <= 2; small++) {
            if (large === 0 && small === 0) continue;
            const capacity = large * 715 + small * 270;
            if (capacity >= loadRT) {
                const loadRate = (loadRT / capacity * 100).toFixed(1);
                const efficiency = loadRate >= 50 && loadRate <= 85 ? 'optimal' :
                    loadRate < 50 ? 'low' : 'high';
                configs.push({ large, small, capacity, loadRate, efficiency });
            }
        }
    }

    configs.sort((a, b) => a.capacity - b.capacity);
    return configs.slice(0, 3);
}

// 執行 AI 冰機分析
async function runAIChillerAnalysis() {
    const loadInput = document.getElementById('current-load');
    const resultDiv = document.getElementById('ai-chiller-result');
    const loadRT = parseFloat(loadInput?.value);

    if (!loadRT || loadRT <= 0) {
        if (resultDiv) {
            resultDiv.innerHTML = `<div style="background:rgba(255,255,255,0.2); padding:10px; border-radius:8px;">
                ⚠️ 請輸入有效的負載噸數
            </div>`;
        }
        return;
    }

    // 每次都執行新分析（不使用快取）
    const loadRate = (loadRT / CHILLER_CONFIG.totalCapacity * 100).toFixed(1);
    const optimalConfigs = calculateOptimalChillers(loadRT);

    // 顯示基本分析結果
    let basicResult = `
        <div style="background:rgba(255,255,255,0.25); padding:15px; border-radius:10px; color:#1a1a2e;">
            <div style="font-size:1.3rem; font-weight:bold; margin-bottom:12px;">📊 負載率分析</div>
            <div style="font-size:1.2rem; margin-bottom:15px;">
                目前負載：<strong>${loadRT} RT</strong> / 總容量 ${CHILLER_CONFIG.totalCapacity} RT = 
                <span style="font-size:1.5rem; font-weight:bold; color:#c0392b;">${loadRate}%</span>
            </div>
            <div style="font-size:1.3rem; font-weight:bold; margin-bottom:10px;">🏭 建議運轉組合</div>
    `;

    optimalConfigs.forEach((cfg, idx) => {
        const icon = idx === 0 ? '✅' : '💡';
        const effiText = cfg.efficiency === 'optimal' ? '（最佳效率區間）' :
            cfg.efficiency === 'low' ? '（負載偏低）' : '（高負載）';
        const bgColor = idx === 0 ? 'rgba(46, 204, 113, 0.3)' : 'rgba(255,255,255,0.1)';
        basicResult += `
            <div style="background:${bgColor}; padding:10px; border-radius:8px; margin-bottom:8px; font-size:1.1rem;">
                ${icon} <strong>${cfg.large}台大冰 + ${cfg.small}台小冰</strong> 
                <span style="opacity:0.9;">(${cfg.capacity}RT, 負載率${cfg.loadRate}%)</span>
                <span style="color:#c0392b;">${effiText}</span>
            </div>
        `;
    });

    basicResult += `</div>`;
    resultDiv.innerHTML = basicResult;

    // 如果有 API Key，執行 AI 深度分析
    if (userApiKey) {
        resultDiv.innerHTML += `
            <div style="margin-top:15px; font-size:1.1rem; color:rgba(13,13,21,0.9); display:flex; align-items:center; gap:8px;">
                🤖 AI 深度分析中
                <span class="loading-dots"><span></span><span></span><span></span></span>
            </div>
            <div class="model-progress">
                <span>準備中...</span>
                <div class="model-progress-bar">
                    <div class="model-progress-fill" style="width: 0%"></div>
                </div>
            </div>
        `;

        try {
            const forecastPreview = typeof forecastData !== 'undefined' && forecastData.length > 0
                ? forecastData.slice(0, 7).map((d, i) => `${i}h後: ${d.enthalpy.toFixed(1)}`).join(', ')
                : '無預測資料';

            const recommendedConfig = optimalConfigs[0];

            // 取得電價資訊
            const currentPricing = typeof getCurrentPricing === 'function' ? getCurrentPricing() : null;
            const hourlyPrices = typeof getHourlyPrices === 'function' ? getHourlyPrices(6) : [];

            const pricingInfo = currentPricing
                ? `- 目前電價時段：${currentPricing.typeName}（${currentPricing.season}）
- 目前電價：${currentPricing.price} 元/度`
                : '- 電價資訊：無法取得';

            const futurePricing = hourlyPrices.length > 0
                ? hourlyPrices.map(p => `${p.time} ${p.typeName} ${p.price}元`).join(', ')
                : '無預測資料';

            // 取得目前運轉中的冰機
            const runningChillers = [];
            if (document.getElementById('chiller-g01')?.checked) runningChillers.push('CHU-G01(大冰)');
            if (document.getElementById('chiller-g02')?.checked) runningChillers.push('CHU-G02(大冰)');
            if (document.getElementById('chiller-g03')?.checked) runningChillers.push('CHU-G03(大冰)');
            if (document.getElementById('chiller-g04')?.checked) runningChillers.push('CHU-G04(小冰)');
            if (document.getElementById('chiller-g05')?.checked) runningChillers.push('CHU-G05(小冰)');
            const runningChillersText = runningChillers.length > 0 ? runningChillers.join(', ') : '無（全部停機）';

            // 計算目前運轉容量
            const runningLarge = runningChillers.filter(c => c.includes('大冰')).length;
            const runningSmall = runningChillers.filter(c => c.includes('小冰')).length;
            const runningCapacity = runningLarge * 715 + runningSmall * 270;

            // 取得冰水溫度
            const supplyTemp = document.getElementById('supply-temp')?.value || '';
            const returnTemp = document.getElementById('return-temp')?.value || '';
            const tempDiff = (supplyTemp && returnTemp) ? (parseFloat(returnTemp) - parseFloat(supplyTemp)).toFixed(1) : '';
            const tempInfo = (supplyTemp && returnTemp)
                ? `- 冰水出水溫度：${supplyTemp}°C
- 冰水回水溫度：${returnTemp}°C
- 出回水溫差：${tempDiff}°C`
                : '- 冰水溫度：未提供';

            const prompt = `你是冰水空調系統運轉專家。請根據以下資料進行分析：

【冰機配置與規格】
- 大冰機 CHU-G01, G02, G03：各 715RT，額定 COP 6.1，額定耗功 412kW
- 小冰機 CHU-G04, G05：各 270RT，額定 COP 4.9，額定耗功 194kW
- 總冷凍能力：2,685RT

【目前運轉狀態】
- 運轉中冰機：${runningChillersText}
- 目前運轉容量：${runningCapacity} RT
- 目前負載：${loadRT} RT（負載率 ${loadRate}%）
- 運轉效率：${runningCapacity > 0 ? ((loadRT / runningCapacity) * 100).toFixed(1) : 0}%
${tempInfo}

【環境條件】
- 外氣焓值：${globalWeather.enthalpy} kJ/kg
- 外氣溫度：${globalWeather.temp}°C
- 外氣濕度：${globalWeather.hum}%

【電價資訊】
${pricingInfo}
- 未來6小時電價：${futurePricing}

【未來6小時焓值預測】
${forecastPreview}

【系統計算建議】
- 建議配置：${recommendedConfig.large}台大冰 + ${recommendedConfig.small}台小冰 (${recommendedConfig.capacity}RT)

請提供：
1. **現況評估**：目前運轉配置是否合適？效率如何？
2. **調整建議**：是否需要增減或切換冰機？具體說明應開啟/關閉哪台
3. **節能分析**：評估冰水溫差與負載匹配度，提供節能建議
4. **電費優化**：考量電價時段與剩餘運轉時間，如何降低電費
5. **趨勢提醒**：根據焓值預測，建議何時調整運轉策略

請用繁體中文，簡潔專業地回答。`;

            const { content: aiResult, model: usedModel } = await tryTextAnalysisRecursive(0, prompt, resultDiv);

            const fullResult = basicResult + `
                <div style="background:rgba(255,255,255,0.2); padding:15px; border-radius:10px; margin-top:15px; color:#1a1a2e;">
                    <div style="font-size:1.3rem; font-weight:bold; margin-bottom:10px;">🤖 AI 深度分析</div>
                    <div style="font-size:1.1rem; line-height:1.8;">${aiResult.replace(/\n/g, '<br>')}</div>
                    <div style="margin-top:10px; font-size:0.8rem; opacity:0.7;">模型: ${usedModel.split('/').pop()}</div>
                </div>
            `;

            resultDiv.innerHTML = fullResult;

            // 儲存快取
            setCacheResult(globalWeather.enthalpy, loadRT, fullResult);

            // 儲存歷史
            saveToHistory(globalWeather.enthalpy, loadRT, aiResult, usedModel);

        } catch (err) {
            resultDiv.innerHTML = basicResult + `
                <div style="margin-top:15px; color:#c0392b; font-size:1.1rem;">
                    ⚠️ AI 分析暫時無法使用：${err.message}
                    <br><button onclick="runAIChillerAnalysis()" style="margin-top:10px; padding:8px 16px; border-radius:6px; border:none; background:#ffeaa7; color:#333; cursor:pointer;">🔄 重試</button>
                </div>
            `;
        }
    }
}

// ==========================================
// 視覺分析按鈕事件
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    const analyzeButton = document.getElementById("analyze-button");
    if (analyzeButton) {
        analyzeButton.addEventListener("click", async () => {
            if (!globalBase64) return alert("請先上傳圖片！");
            if (!userApiKey) {
                userApiKey = prompt("請輸入 API Key (OpenRouter):");
                if (!userApiKey) return;
                localStorage.setItem("openrouter_key", userApiKey);
            }

            const overlay = document.getElementById("loading-overlay");
            const reportDiv = document.getElementById("analysis-report");
            if (overlay) overlay.style.display = "flex";

            try {
                const prompt = `
請快速判讀這張冰水主機 SCADA 畫面。

【任務】只需判斷 CHU-G01、CHU-G02、CHU-G03、CHU-G04、CHU-G05 這五台主機的運轉狀態。
【判斷標準】亮綠燈 = 運轉中，非綠燈 = 停止。

【目前條件】焓值 ${globalWeather.enthalpy} kJ/kg

請用以下格式回答：
✅ 運轉中：CHU-Gxx, CHU-Gxx（列出亮綠燈的主機）
⏸️ 停止中：CHU-Gxx（列出非綠燈的主機）
📊 運轉台數：X 台
💡 節能建議：根據焓值 ${globalWeather.enthalpy}，簡短說明是否符合節能邏輯。
`;

                const { content: result, model: usedModel } = await tryAnalysisRecursive(0, prompt);
                if (reportDiv) {
                    reportDiv.innerHTML = result.replace(/\n/g, "<br>") +
                        `<div style="margin-top:15px; font-size:0.8rem; color:#888;">使用模型: ${usedModel.split('/').pop()}</div>`;
                }

                // 初始化進階對話
                if (typeof initChatAfterAnalysis === 'function') {
                    initChatAfterAnalysis(result);
                }

            } catch (err) {
                if (reportDiv) {
                    reportDiv.innerHTML = `<span style="color:red; font-weight:bold;">❌ 分析失敗：${err.message}</span>
                        <br><button onclick="document.getElementById('analyze-button').click()" style="margin-top:10px; padding:8px 16px; border-radius:6px; border:1px solid #ddd; background:#fff; cursor:pointer;">🔄 重試</button>`;
                }
            } finally {
                if (overlay) overlay.style.display = "none";
            }
        });
    }
});

// ==========================================
// 進階 AI 對話功能
// ==========================================
let chatHistory = [];
let initialAnalysisResult = '';

function initChatAfterAnalysis(analysisResult) {
    initialAnalysisResult = analysisResult;
    chatHistory = [
        {
            role: "system",
            content: `你是冰水主機專家 AI 助手。以下是你剛才對 SCADA 畫面的初步分析結果：
${analysisResult}

目前環境條件：焓值 ${globalWeather.enthalpy} kJ/kg，溫度 ${globalWeather.temp}°C，濕度 ${globalWeather.hum}%。

【重要限制】
1. 你只能回答與以下主題相關的問題：
   - 畫面上顯示的冰水主機運轉狀態
   - 節能建議與分析結果
   - 焓值與環境條件的解釋
   - 冰水主機的運轉操作建議

2. 如果使用者詢問與上述主題無關的問題，請禮貌地回覆：
   「抱歉，我只能回答與目前冰水主機分析結果相關的問題。請針對畫面上的分析結果提問。」

【接受糾正】
如果使用者指出你的分析判斷有誤，請：
1. 禮貌地接受糾正並感謝使用者
2. 根據使用者提供的正確資訊，重新調整你的分析結論
3. 基於修正後的狀態，更新節能建議

使用繁體中文，回答簡潔明瞭。`
        }
    ];

    const chatSection = document.getElementById('chat-section');
    if (chatSection) {
        chatSection.style.display = 'block';
        const messagesDiv = document.getElementById('chat-messages');
        if (messagesDiv) messagesDiv.innerHTML = '';
        appendMessage('system', '✅ 初步分析完成！您可以針對分析結果提出進一步的問題。');
        chatSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function appendMessage(role, content) {
    const messagesDiv = document.getElementById('chat-messages');
    if (!messagesDiv) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.innerHTML = content.replace(/\n/g, '<br>');
    messagesDiv.appendChild(bubble);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showTypingIndicator() {
    const messagesDiv = document.getElementById('chat-messages');
    if (!messagesDiv) return;

    const indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.className = 'chat-bubble ai';
    indicator.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    messagesDiv.appendChild(indicator);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}

async function sendChatMessage(customMessage = null) {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const message = customMessage || input?.value.trim();

    if (!message) return;
    if (!userApiKey) {
        alert('請先設定 API Key！');
        return;
    }

    appendMessage('user', message);
    if (input && !customMessage) input.value = '';

    chatHistory.push({ role: 'user', content: message });

    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    showTypingIndicator();

    try {
        let aiReply = null;
        let lastError = null;
        let usedModel = '';

        for (let i = 0; i < MODEL_FALLBACK_LIST.length; i++) {
            try {
                const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${userApiKey}`,
                        "Content-Type": "application/json",
                        "HTTP-Referer": window.location.href
                    },
                    body: JSON.stringify({
                        model: MODEL_FALLBACK_LIST[i],
                        messages: chatHistory
                    })
                });

                const data = await response.json();

                if (data.error) throw new Error(data.error.message);
                if (!data.choices || !data.choices.length) throw new Error('無回應');

                aiReply = data.choices[0].message.content;
                usedModel = MODEL_FALLBACK_LIST[i];
                break;
            } catch (modelErr) {
                console.warn(`對話模型 ${i + 1} 失敗:`, modelErr.message);
                lastError = modelErr;
            }
        }

        hideTypingIndicator();

        if (!aiReply) {
            throw lastError || new Error('所有模型都無法回應');
        }

        chatHistory.push({ role: 'assistant', content: aiReply });
        appendMessage('ai', aiReply);

    } catch (err) {
        hideTypingIndicator();
        appendMessage('system', `❌ 錯誤：${err.message}`);
    } finally {
        if (input) input.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        if (input) input.focus();
    }
}

function askQuickQuestion(question) {
    sendChatMessage(question);
}

function handleChatKeypress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
}

function clearChat() {
    if (confirm('確定要清除對話記錄嗎？')) {
        const messagesDiv = document.getElementById('chat-messages');
        if (messagesDiv) messagesDiv.innerHTML = '';
        chatHistory = chatHistory.slice(0, 1);
        appendMessage('system', '對話已清除。您可以繼續提問。');
    }
}
