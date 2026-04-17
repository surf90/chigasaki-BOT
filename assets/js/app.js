const LAT = 35.3175;
const LON = 139.4151;

// Open-Meteo レスポンスをセッション内で30分キャッシュするヘルパー
async function fetchWithCache(url, cacheKey, ttlMs = 30 * 60 * 1000) {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < ttlMs) return data;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${url}`);
    const data = await res.json();
    sessionStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
    return data;
}

function displayFetchTime() {
    const now = new Date();
    const options = {
        month: 'short', day: 'numeric', weekday: 'short',
        hour: '2-digit', minute: '2-digit'
    };
    const el = document.getElementById('current-time');
    el.innerHTML = `更新日時: ${now.toLocaleString('ja-JP', options)} 🔄`;
    el.onclick = () => fetchWeatherData();
}

const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current_weather=true&windspeed_unit=ms`;
const marineUrl  = `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}&current=wave_height,sea_surface_temperature`;

function getWindDirection16(degree) {
    const directions = ["北","北北東","北東","東北東","東","東南東","南東","南南東","南","南南西","南西","西南西","西","西北西","北西","北北西"];
    return directions[Math.round(degree / 22.5) % 16];
}

async function calculateTide() {
    const synodicMonth = 29.530588853;
    const knownNewMoon = new Date('2000-01-06T18:14:00+09:00').getTime();
    const targetDate = new Date();
    targetDate.setHours(12, 0, 0, 0);

    // 数式による概算（フォールバック用）
    let age = ((targetDate.getTime() - knownNewMoon) / (1000 * 60 * 60 * 24)) % synodicMonth;
    if (age < 0) age += synodicMonth;
    let ageSource = "計算値";

    // NASA SVS 当日JSONから精度の高い月齢を取得
    try {
        // 日付をキーにしてキャッシュ（1日1回取得で十分）
        const dayKey = new Date().toISOString().slice(0, 10);
        const resp = await fetch(`data/moon_today.json?d=${dayKey}`);
        if (resp.ok) {
            const moonToday = await resp.json();
            if (moonToday.age !== undefined) {
                age = parseFloat(moonToday.age);
                ageSource = "NASA";
            }
        }
    } catch (e) {
        // フォールバック：数式の計算値を使用
    }

    const MathRoundAge = Math.round(age) % 30;
    let tideType;
    if (MathRoundAge === 29 || MathRoundAge <= 2 || (MathRoundAge >= 14 && MathRoundAge <= 16)) {
        tideType = "大潮";
    } else if (
        (MathRoundAge >= 3  && MathRoundAge <= 6)  ||
        (MathRoundAge >= 12 && MathRoundAge <= 13) ||
        (MathRoundAge >= 17 && MathRoundAge <= 20) ||
        (MathRoundAge >= 26 && MathRoundAge <= 28)
    ) {
        tideType = "中潮";
    } else if ((MathRoundAge >= 7 && MathRoundAge <= 9) || (MathRoundAge >= 21 && MathRoundAge <= 23)) {
        tideType = "小潮";
    } else if (MathRoundAge === 10 || MathRoundAge === 24) {
        tideType = "長潮";
    } else if (MathRoundAge === 11 || MathRoundAge === 25) {
        tideType = "若潮";
    } else {
        tideType = "不明";
    }

    const ageLabel = ageSource === "NASA"
        ? `月齢: ${age.toFixed(1)}`
        : `月齢: ${age.toFixed(1)} / 計算値`;
    document.getElementById('tide-type').innerHTML =
        `${tideType} <span style="font-weight:normal;font-size:0.85em;color:#707070;">(${ageLabel})</span>`;
}

function getDummyTideExtremes() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return [
        { time: new Date(now.getTime() +  5 * 3600000).toISOString(), type: 'high', height: 1.4 },
        { time: new Date(now.getTime() + 11 * 3600000).toISOString(), type: 'low',  height: 0.3 },
        { time: new Date(now.getTime() + 17 * 3600000).toISOString(), type: 'high', height: 1.5 },
        { time: new Date(now.getTime() + 23 * 3600000).toISOString(), type: 'low',  height: 0.4 },
    ];
}

async function fetchTideExtremes() {
    document.getElementById('tide-status').textContent = '読み込み中...';

    if (!window.location.protocol.startsWith('http')) {
        displayTideData(getDummyTideExtremes());
        updateTideSource("取得失敗");
        return;
    }

    const now = new Date();
    const dayKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    // STEP 1: 気象庁 当日JSONを試す（数百バイト）
    try {
        const res = await fetch(`data/tide_today.json?d=${dayKey}`);
        if (res.ok) {
            const todayData = await res.json();
            if (todayData.date === dayKey && todayData.tides && todayData.tides.length > 0) {
                displayTideData(todayData.tides);
                updateTideSource("気象庁");
                return;
            }
        }
    } catch (e) {
        console.warn("tide_today.json 取得失敗 -> Stormglassへフォールバック");
    }

    // STEP 2: Stormglass フォールバック
    try {
        const hour12Buster = Math.floor(Date.now() / (12 * 60 * 60 * 1000));
        const res = await fetch(`data/tide_data.json?t=${hour12Buster}`);
        if (!res.ok) throw new Error();
        const sgData = await res.json();
        if (sgData && sgData.data) {
            displayTideData(sgData.data);
            updateTideSource("Stormglass");
            return;
        }
    } catch (e) {
        console.error("Stormglass tide_data.json も取得失敗");
    }

    // STEP 3: ダミー波形
    displayTideData(getDummyTideExtremes());
    updateTideSource("取得失敗");
    const container = document.getElementById('tide-extremes-container');
    const note = document.createElement('div');
    note.style.cssText = 'font-size:.8rem;color:#c0392b;text-align:right;margin-top:5px;';
    note.textContent = '※データ取得エラーのためダミー波形を表示しています';
    container.appendChild(note);
}

function updateTideSource(sourceName) {
    const titleSpan = document.querySelector('#tide-info-box h2 span');
    if (titleSpan) titleSpan.textContent = `（${sourceName}）`;
}

let tideChartInstance = null;

function displayTideData(extremes) {
    const container = document.getElementById('tide-extremes-container');
    container.innerHTML = '';

    if (!extremes || extremes.length === 0) {
        container.innerHTML = '<div class="data-row"><span>満潮・干潮:</span> <span>データなし</span></div>';
        return;
    }

    const chartDataPoints = [];
    let hasHeightData = false;
    const highTides = [];
    const lowTides  = [];

    extremes.forEach(item => {
        const dateObj  = new Date(item.time);
        const timeStr  = dateObj.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        let heightValue = item.type === 'high' ? 1 : 0;
        let heightText  = '';
        if (item.height !== undefined && item.height !== null) {
            hasHeightData = true;
            heightValue = parseFloat(item.height);
            heightText = ` <span style="color:#888888;font-weight:normal;font-size:0.85em;">(${heightValue.toFixed(1)} m)</span>`;
        }
        const formattedTime = `${timeStr}${heightText}`;
        (item.type === 'high' ? highTides : lowTides).push(formattedTime);
        chartDataPoints.push({ timeMs: dateObj.getTime(), timeStr, type: item.type, height: heightValue });
    });

    const sep = '<span style="color:#888888;font-weight:normal;"> , </span>';
    if (highTides.length > 0) {
        const row = document.createElement('div');
        row.className = 'data-row';
        row.innerHTML = `<span>満潮:</span> <span style="color:#0275d8;font-weight:bold;">${highTides.join(sep)}</span>`;
        container.appendChild(row);
    }
    if (lowTides.length > 0) {
        const row = document.createElement('div');
        row.className = 'data-row';
        row.innerHTML = `<span>干潮:</span> <span style="color:#d9534f;font-weight:bold;">${lowTides.join(sep)}</span>`;
        container.appendChild(row);
    }

    drawTideChart(chartDataPoints, hasHeightData);
}

function drawTideChart(extremes, hasHeightData) {
    if (window.Chart) Chart.defaults.font.family = 'Inter, "Zen Kaku Gothic New", sans-serif';

    document.getElementById('tide-chart-container').style.display = 'block';
    const ctx = document.getElementById('tideChart').getContext('2d');

    extremes.sort((a, b) => a.timeMs - b.timeMs);

    const labels = [], dataPoints = [], pointRadii = [], pointColors = [];

    if (extremes.length >= 2) {
        const step = 30 * 60 * 1000;
        for (let i = 0; i < extremes.length - 1; i++) {
            const pt1 = extremes[i], pt2 = extremes[i + 1];
            labels.push(pt1.timeStr);
            dataPoints.push(pt1.height);
            pointRadii.push(5);
            pointColors.push(pt1.type === 'high' ? '#0275d8' : '#d9534f');
            for (let t = pt1.timeMs + step; t < pt2.timeMs; t += step) {
                const norm  = (t - pt1.timeMs) / (pt2.timeMs - pt1.timeMs);
                const cosV  = (1 - Math.cos(Math.PI * norm)) / 2;
                labels.push(new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
                dataPoints.push(pt1.height + (pt2.height - pt1.height) * cosV);
                pointRadii.push(0);
                pointColors.push('#0056b3');
            }
        }
        const last = extremes[extremes.length - 1];
        labels.push(last.timeStr);
        dataPoints.push(last.height);
        pointRadii.push(5);
        pointColors.push(last.type === 'high' ? '#0275d8' : '#d9534f');
    }

    if (tideChartInstance) tideChartInstance.destroy();

    tideChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: hasHeightData ? '潮位 (m)' : '潮位イメージ',
                data: dataPoints,
                borderColor: '#0056b3',
                backgroundColor: 'rgba(0,86,179,0.15)',
                borderWidth: 2,
                pointBackgroundColor: pointColors,
                pointBorderColor: '#fff',
                pointRadius: pointRadii,
                pointHoverRadius: 7,
                fill: true,
                tension: 0.4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => hasHeightData ? ctx.parsed.y.toFixed(2) + ' m' : '潮位イメージ'
                    }
                }
            },
            scales: {
                y: {
                    display: hasHeightData,
                    suggestedMin: hasHeightData ? Math.min(...dataPoints) - 0.2 : -0.2,
                    suggestedMax: hasHeightData ? Math.max(...dataPoints) + 0.2 :  1.2,
                    ticks: { callback: v => v.toFixed(1) + ' m' }
                },
                x: {
                    ticks: {
                        autoSkip: false,
                        maxRotation: 0,
                        callback(value, index) {
                            const label = this.getLabelForValue(value);
                            if (!label) return null;
                            if (index === 0) return label;
                            const parts = label.split(':');
                            if (parts.length < 2) return null;
                            const hour = parseInt(parts[0], 10);
                            if (hour % 4 === 0) {
                                const prevLabel = this.getLabelForValue(value - 1);
                                if (!prevLabel) return null;
                                if (hour !== parseInt(prevLabel.split(':')[0], 10)) {
                                    const firstHour = parseInt(this.getLabelForValue(0).split(':')[0], 10);
                                    let diff = Math.abs(hour - firstHour);
                                    if (diff > 12) diff = 24 - diff;
                                    if (diff < 2) return null;
                                    return ('0' + hour).slice(-2) + ':00';
                                }
                            }
                            return null;
                        }
                    },
                    grid: { display: false }
                }
            }
        }
    });
}

const WARNING_CODE_MAP = {
    '02': { name: '暴風雪警報',     level: 'keiho'     },
    '03': { name: '大雨警報',       level: 'keiho'     },
    '04': { name: '洪水警報',       level: 'keiho'     },
    '05': { name: '暴風警報',       level: 'keiho'     },
    '06': { name: '大雪警報',       level: 'keiho'     },
    '07': { name: '波浪警報',       level: 'keiho'     },
    '08': { name: '高潮警報',       level: 'keiho'     },
    '09': { name: '土砂災害警報',   level: 'keiho'     },
    '10': { name: '大雨注意報',     level: 'chuiho'    },
    '12': { name: '大雪注意報',     level: 'chuiho'    },
    '13': { name: '風雪注意報',     level: 'chuiho'    },
    '14': { name: '雷注意報',       level: 'chuiho'    },
    '15': { name: '強風注意報',     level: 'chuiho'    },
    '16': { name: '波浪注意報',     level: 'chuiho'    },
    '17': { name: '融雪注意報',     level: 'chuiho'    },
    '18': { name: '洪水注意報',     level: 'chuiho'    },
    '19': { name: '高潮注意報',     level: 'chuiho'    },
    '20': { name: '濃霧注意報',     level: 'chuiho'    },
    '21': { name: '乾燥注意報',     level: 'chuiho'    },
    '22': { name: 'なだれ注意報',   level: 'chuiho'    },
    '23': { name: '低温注意報',     level: 'chuiho'    },
    '24': { name: '霜注意報',       level: 'chuiho'    },
    '25': { name: '着氷注意報',     level: 'chuiho'    },
    '26': { name: '着雪注意報',     level: 'chuiho'    },
    '32': { name: '暴風雪特別警報', level: 'tokubetsu' },
    '33': { name: '大雨特別警報',   level: 'tokubetsu' },
    '35': { name: '暴風特別警報',   level: 'tokubetsu' },
    '36': { name: '大雪特別警報',   level: 'tokubetsu' },
    '37': { name: '波浪特別警報',   level: 'tokubetsu' },
    '38': { name: '高潮特別警報',   level: 'tokubetsu' },
};

async function fetchJmaWarning() {
    const secBuster = Math.floor(Date.now() / 1000);
    const warningUrl = `https://www.jma.go.jp/bosai/warning/data/warning/140000.json?t=${secBuster}`;
    try {
        const res = await fetch(warningUrl);
        if (!res.ok) throw new Error('JMA warning fetch failed');
        const data = await res.json();

        const cityAreas = data.areaTypes?.[1]?.areas ?? [];
        const chigasakiArea = cityAreas.find(a => a.code === '1420700');
        const listEl = document.getElementById('jma-warning-list');
        listEl.innerHTML = '';

        const activeWarnings = chigasakiArea
            ? chigasakiArea.warnings.filter(w => w.status !== '解除' && w.code)
            : [];

        const warningBox = document.getElementById('jma-warning-box');
        if (activeWarnings.length === 0) {
            listEl.innerHTML = '<div class="warning-none">✅ 現在、注意報・警報はありません</div>';
            warningBox.classList.remove('warning-active');
        } else {
            warningBox.classList.add('warning-active');
            const order = { tokubetsu: 0, keiho: 1, chuiho: 2 };
            activeWarnings.sort((a, b) => {
                const la = (WARNING_CODE_MAP[a.code] || {}).level || 'chuiho';
                const lb = (WARNING_CODE_MAP[b.code] || {}).level || 'chuiho';
                return (order[la] ?? 9) - (order[lb] ?? 9);
            });
            activeWarnings.forEach(w => {
                const info = WARNING_CODE_MAP[w.code] || { name: `コード${w.code}`, level: 'chuiho' };
                const levelLabel = info.level === 'tokubetsu' ? '特別警報' : info.level === 'keiho' ? '警報' : '注意報';
                const item = document.createElement('div');
                item.className = 'warning-item';
                item.innerHTML = `<span class="warning-badge badge-${info.level}">${levelLabel}</span><span class="warning-name">${info.name}</span>`;
                listEl.appendChild(item);
            });
        }

        document.getElementById('jma-warning-loading').style.display = 'none';
        document.getElementById('jma-warning-content').style.display = 'block';
    } catch (e) {
        console.error('JMA warning error:', e);
        document.getElementById('jma-warning-loading').style.display = 'none';
        document.getElementById('jma-warning-error').style.display = 'block';
    }
}

async function fetchJmaForecast() {
    const hour8Buster = Math.floor(Date.now() / (8 * 60 * 60 * 1000));
    try {
        const res = await fetch(`data/forecast_data.json?t=${hour8Buster}`);
        if (!res.ok) throw new Error('forecast_data.json fetch failed');
        const data = await res.json();

        const shortTerm  = data.forecast[0];
        const timeSeries0 = shortTerm.timeSeries[0];
        const timeSeries1 = shortTerm.timeSeries[1];
        const areaWeather = timeSeries0.areas.find(a => a.area.code === '140010') || timeSeries0.areas[0];
        const areaPop     = timeSeries1.areas.find(a => a.area.code === '140010') || timeSeries1.areas[0];

        document.getElementById('jma-weather').textContent = areaWeather.weathers?.[0] ?? '--';
        document.getElementById('jma-pop').textContent     = areaPop.pops?.[0] ? areaPop.pops[0] + '%' : '--';
        document.getElementById('jma-overview-text').textContent = data.overview.text || '';
        const hasTyphoon = data.overview.text?.includes('台風');
        document.getElementById('jma-typhoon-notice').style.display = hasTyphoon ? 'flex' : 'none';

        document.getElementById('jma-loading').style.display = 'none';
        document.getElementById('jma-forecast-content').style.display = 'block';
    } catch (e) {
        console.error('JMA forecast error:', e);
        document.getElementById('jma-loading').style.display = 'none';
        document.getElementById('jma-error').style.display = 'block';
    }
}

function toggleOverview() {
    const el  = document.getElementById('jma-overview-text');
    const btn = document.getElementById('jma-overview-toggle');
    if (el.style.display === 'none') {
        el.style.display = 'block';
        btn.textContent  = '概況を閉じる ▲';
    } else {
        el.style.display = 'none';
        btn.textContent  = '概況を表示 ▼';
    }
}

let waveChartInstance = null;

async function fetchWaveGuidance() {
    try {
        const hour3Buster = Math.floor(Date.now() / (3 * 60 * 60 * 1000));
        const resp = await fetch(`data/wave_guid_20.json?t=${hour3Buster}`);
        if (!resp.ok) throw new Error('wave_guid_20.json の読み込みに失敗');
        const json = await resp.json();

        const now      = new Date();
        const todayJst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
        const todayStr = `${todayJst.getFullYear()}-${String(todayJst.getMonth()+1).padStart(2,'0')}-${String(todayJst.getDate()).padStart(2,'0')}`;
        const tomorrowJst = new Date(todayJst);
        tomorrowJst.setDate(tomorrowJst.getDate() + 1);
        const tomorrowStr = `${tomorrowJst.getFullYear()}-${String(tomorrowJst.getMonth()+1).padStart(2,'0')}-${String(tomorrowJst.getDate()).padStart(2,'0')}`;

        const todayData = (json.data || []).filter(d =>
            d.time.startsWith(todayStr) || d.time.startsWith(tomorrowStr + 'T00:00')
        );
        if (todayData.length === 0) throw new Error('本日の波浪データがありません');

        waveChartInstance = drawWaveCombinedChart('waveChart', waveChartInstance, todayData);

        const nowMs   = Date.now();
        const current = todayData.filter(d => new Date(d.time).getTime() <= nowMs).pop();
        document.getElementById('hero-wave').textContent = current ? current.wave_height.toFixed(1) : '--';

        document.getElementById('wave-guid-loading').style.display = 'none';
        document.getElementById('wave-guid-content').style.display = 'block';
    } catch (e) {
        console.error('Wave guidance error:', e);
        document.getElementById('wave-guid-loading').style.display = 'none';
        document.getElementById('wave-guid-error').style.display = 'block';
    }
}

function drawWaveCombinedChart(canvasId, existingInstance, data) {
    if (window.Chart) Chart.defaults.font.family = 'Inter, "Zen Kaku Gothic New", sans-serif';
    if (existingInstance) existingInstance.destroy();

    const heightData = data.map(d => ({ x: new Date(d.time).getTime(), y: d.wave_height }));
    const periodData = data.map(d => ({ x: new Date(d.time).getTime(), y: d.period }));

    const jstOffsetMs    = 9 * 60 * 60 * 1000;
    const todayJstStartMs = Math.floor((Date.now() + jstOffsetMs) / 86400000) * 86400000 - jstOffsetMs;
    const xMin = todayJstStartMs +  4 * 60 * 60 * 1000;
    const xMax = todayJstStartMs + 24 * 60 * 60 * 1000;
    const h4ms = 4 * 60 * 60 * 1000;

    const ctx   = document.getElementById(canvasId).getContext('2d');
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: '最大波高',
                    data: heightData,
                    borderColor: '#0275d8', backgroundColor: '#0275d826',
                    borderWidth: 2, pointRadius: 3,
                    pointBackgroundColor: '#0275d8', pointBorderColor: '#fff',
                    pointHoverRadius: 6, fill: true, tension: 0.3, yAxisID: 'yWave',
                },
                {
                    label: '周期',
                    data: periodData,
                    borderColor: '#27ae60', backgroundColor: 'transparent',
                    borderWidth: 2, pointRadius: 3,
                    pointBackgroundColor: '#27ae60', pointBorderColor: '#fff',
                    pointHoverRadius: 6, fill: false, tension: 0.3, yAxisID: 'yPeriod',
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title(items) {
                            if (!items.length) return '';
                            const ms = items[0].parsed.x;
                            const h  = (new Date(ms).getUTCHours() + 9) % 24;
                            const m  = new Date(ms).getUTCMinutes();
                            return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
                        },
                        label(ctx) {
                            return ctx.dataset.yAxisID === 'yWave'
                                ? `最大波高: ${ctx.parsed.y.toFixed(1)} m`
                                : `周期: ${ctx.parsed.y.toFixed(0)} 秒`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear', min: xMin, max: xMax,
                    ticks: {
                        stepSize: h4ms, maxRotation: 0,
                        callback(value) {
                            const h = (new Date(value).getUTCHours() + 9) % 24;
                            if (h === 0 || h === 24) return null;
                            return String(h).padStart(2,'0') + ':00';
                        }
                    },
                    grid: { display: false }
                },
                yWave: {
                    type: 'linear', position: 'left',
                    title: { display: true, text: '最大波高 [m]', font: { size: 11 }, color: '#0275d8' },
                    ticks: { callback: v => v.toFixed(1) },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                yPeriod: {
                    type: 'linear', position: 'right',
                    title: { display: true, text: '周期 [秒]', font: { size: 11 }, color: '#27ae60' },
                    ticks: { stepSize: 1, callback: v => Number.isInteger(v) ? v : null },
                    grid: { display: false }
                }
            }
        }
    });
    return chart;
}

async function fetchWeatherData() {
    const timeEl = document.getElementById('current-time');
    if (timeEl.innerHTML !== '') {
        timeEl.innerHTML = 'データを更新中... ⏳';
        document.getElementById('weather-content').style.opacity      = '0.5';
        document.getElementById('weather-content').style.pointerEvents = 'none';
    }
    try {
        await calculateTide();
        fetchTideExtremes();
        fetchJmaForecast();
        fetchJmaWarning();
        fetchWaveGuidance();

        // Open-Meteo はセッション内30分キャッシュ
        const [weatherData, marineData] = await Promise.all([
            fetchWithCache(weatherUrl, 'cache_weather'),
            fetchWithCache(marineUrl,  'cache_marine'),
        ]);

        const temp = weatherData.current_weather.temperature;
        document.getElementById('temp').textContent     = `${temp}℃`;
        document.getElementById('wind').textContent     = `${weatherData.current_weather.windspeed} m/s`;
        document.getElementById('wind-dir').textContent = getWindDirection16(weatherData.current_weather.winddirection);
        document.getElementById('hero-temp').textContent = temp;

        const cur = marineData.current;
        document.getElementById('wave-height').textContent =
            (cur?.wave_height != null) ? `${cur.wave_height} m` : 'データなし';
        if (cur?.sea_surface_temperature != null) {
            document.getElementById('sea-temp').textContent      = `${cur.sea_surface_temperature}℃`;
            document.getElementById('hero-sea-temp').textContent = cur.sea_surface_temperature;
        } else {
            document.getElementById('sea-temp').textContent      = 'データなし';
            document.getElementById('hero-sea-temp').textContent = '--';
        }

        document.getElementById('skeleton-loading').style.display = 'none';
        document.getElementById('weather-content').style.display  = 'block';
        document.getElementById('weather-content').style.opacity      = '1';
        document.getElementById('weather-content').style.pointerEvents = 'auto';
        _lastFetchTime = Date.now();
        displayFetchTime();

    } catch (error) {
        console.error('Fetch error:', error);
        document.getElementById('skeleton-loading').style.display = 'none';
        document.getElementById('error').style.display            = 'block';
        document.getElementById('weather-content').style.opacity      = '1';
        document.getElementById('weather-content').style.pointerEvents = 'auto';
        if (timeEl.innerHTML.includes('更新中')) displayFetchTime();
    }
}

let _toastShown    = false;
let _lastFetchTime = Date.now();

function showToast() {
    if (_toastShown) return;
    _toastShown = true;
    const t = document.getElementById('toast');
    t.style.display = 'block';
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => hideToast(), 8000);
}

function hideToast() {
    const t = document.getElementById('toast');
    t.classList.remove('show');
    setTimeout(() => { t.style.display = 'none'; _toastShown = false; }, 400);
}

function _onUserInteraction() {
    if (Date.now() - _lastFetchTime >= 3 * 60 * 60 * 1000) showToast();
}
['click', 'touchstart'].forEach(ev => document.addEventListener(ev, _onUserInteraction));

window.onload = () => {
    fetchWeatherData();
    setInterval(fetchWeatherData, 3 * 60 * 60 * 1000);
};
