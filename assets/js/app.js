const LAT = 35.3175;

const nowLinePlugin = {
  id: 'nowLine',
  afterDraw(chart) {
    const now = Date.now();
    const xScale = chart.scales.x;
    if (now < xScale.min || now > xScale.max) return;
    const x = xScale.getPixelForValue(now);
    const ctx = chart.ctx;
    const { top, bottom } = chart.chartArea;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ff6600';
    ctx.fillRect(x - 3, top, 6, bottom - top);
    ctx.restore();
  }
};
const LON = 139.4151;

// セッション内キャッシュヘルパー（sessionStorage）
async function fetchWithCache(url, cacheKey, ttlMs = 30 * 60 * 1000) {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
        try {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < ttlMs) return data;
        } catch { sessionStorage.removeItem(cacheKey); }
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${url}`);
    const data = await res.json();
    sessionStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
    return data;
}

// 長期キャッシュヘルパー（localStorage）
async function fetchWithLocalCache(url, cacheKey, ttlMs) {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const { data, ts } = JSON.parse(cached);
            if (Date.now() - ts < ttlMs) return data;
        } catch { localStorage.removeItem(cacheKey); }
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${url}`);
    const data = await res.json();
    localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
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

// STEP 1: 3日分JSON（tide_3day.json）を優先
    try {
        const res = await fetch(`data/tide_3day.json?d=${dayKey}`);
        if (res.ok) {
            const data2 = await res.json();
            if (data2.days && data2.days.length > 0 && data2.days[0].date === dayKey) {
                const todayTides = data2.days[0].tides;
                const allTides   = data2.days.flatMap(d => d.tides);
                if (allTides.length > 0) {
                    displayTideData(todayTides, allTides);
                    updateTideSource("気象庁");
                    return;
                }
            }
        }
    } catch (e) {
        console.warn("tide_2day.json 取得失敗 -> tide_today.jsonへフォールバック");
    }

    // STEP 1b: 当日JSONにフォールバック
    try {
        const res = await fetch(`data/tide_today.json?d=${dayKey}`);
        if (res.ok) {
            const todayData = await res.json();
            if (todayData.date === dayKey && todayData.tides && todayData.tides.length > 0) {
                displayTideData(todayData.tides, todayData.tides);
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
            displayTideData(sgData.data, sgData.data);
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

// extremes: 当日のみ（テキスト表示用）、chartExtremes: 複数日（グラフ用）
function displayTideData(extremes, chartExtremes) {
    const container = document.getElementById('tide-extremes-container');
    container.innerHTML = '';

    if (!extremes || extremes.length === 0) {
        container.innerHTML = '<div class="data-row"><span>満潮・干潮:</span> <span>データなし</span></div>';
        return;
    }

    // テキスト表示（当日のみ）
    const highTides = [], lowTides = [];
    extremes.forEach(item => {
        const dateObj  = new Date(item.time);
        const timeStr  = dateObj.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        let heightText = '';
        if (item.height !== undefined && item.height !== null) {
            heightText = ` <span style="color:#888888;font-weight:normal;font-size:0.85em;">(${parseFloat(item.height).toFixed(1)} m)</span>`;
        }
        (item.type === 'high' ? highTides : lowTides).push(`${timeStr}${heightText}`);
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

    // グラフ描画（複数日分）
    const chartData = (chartExtremes || extremes);
    const chartDataPoints = [];
    let hasHeightData = false;
    chartData.forEach(item => {
        const dateObj   = new Date(item.time);
        const timeStr   = dateObj.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        let heightValue = item.type === 'high' ? 1 : 0;
        if (item.height !== undefined && item.height !== null) {
            hasHeightData = true;
            heightValue   = parseFloat(item.height);
        }
        chartDataPoints.push({ timeMs: dateObj.getTime(), timeStr, type: item.type, height: heightValue });
    });
    drawTideChart(chartDataPoints, hasHeightData);
}

// 両グラフで共有するx軸範囲と幅
let chartXMin = null;
const CHART_DAYS = 2;
const PX_PER_HOUR = 28;
const CHART_TOTAL_PX = PX_PER_HOUR * 24 * CHART_DAYS;
let chartScrollSynced = false;

function buildChartXTicks(xMin, xMax) {
    const h4ms = 4 * 60 * 60 * 1000;
    const jstOffsetMs = 9 * 60 * 60 * 1000;
    const ticks = [{ value: xMin }];
    // xMin の次の4時間境界（JST基準）を計算
    const xMinJst = xMin + jstOffsetMs;
    const firstBoundary = Math.ceil(xMinJst / h4ms) * h4ms - jstOffsetMs;
    for (let t = firstBoundary; t <= xMax; t += h4ms) {
        if (t > xMin + 60000) ticks.push({ value: t });
    }
    return ticks;
}

function chartXTickCallback(value, index) {
    const d = new Date(value + 9 * 60 * 60 * 1000); // JST
    const jstH = d.getUTCHours();
    const jstM = d.getUTCMinutes();
    const timeStr = jstM === 0 ? jstH + ':00' : jstH + ':' + String(jstM).padStart(2, '0');
    // 翌日0:00に日付を付加
    if (jstH === 0 && jstM === 0 && index > 0) {
        return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + timeStr;
    }
    return timeStr;
}

function setChartContainerWidth(containerId, px) {
    const el = document.getElementById(containerId);
    if (el) el.style.width = px + 'px';
}

function syncChartScroll() {
    if (chartScrollSynced) return;
    chartScrollSynced = true;
    const tideScroll = document.getElementById('tide-chart-scroll');
    const waveScroll = document.getElementById('wave-chart-scroll');
    if (!tideScroll || !waveScroll) return;
    let syncing = false;
    tideScroll.addEventListener('scroll', () => {
        if (syncing) return; syncing = true;
        waveScroll.scrollLeft = tideScroll.scrollLeft;
        syncing = false;
    });
    waveScroll.addEventListener('scroll', () => {
        if (syncing) return; syncing = true;
        tideScroll.scrollLeft = waveScroll.scrollLeft;
        syncing = false;
    });
}

function scrollChartsToNow() {
    if (chartXMin === null) return;
    const nowMs = Date.now();
    const pxPerMs = PX_PER_HOUR / (60 * 60 * 1000);
    const scrollLeft = Math.max(0, (nowMs - chartXMin) * pxPerMs - 80);
    const tideScroll = document.getElementById('tide-chart-scroll');
    const waveScroll = document.getElementById('wave-chart-scroll');
    if (tideScroll) tideScroll.scrollLeft = scrollLeft;
    if (waveScroll) waveScroll.scrollLeft = scrollLeft;
}

function drawTideChart(extremes, hasHeightData) {
    if (window.Chart) Chart.defaults.font.family = 'Inter, "Zen Kaku Gothic New", sans-serif';

    document.getElementById('tide-chart-container').style.display = 'block';
    setChartContainerWidth('tide-chart-container', CHART_TOTAL_PX);

    const canvas = document.getElementById('tideChart');
    canvas.width  = CHART_TOTAL_PX;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');

    extremes.sort((a, b) => a.timeMs - b.timeMs);

    // xMin = 最初の極値時刻、xMax = xMin + 3日
    chartXMin = extremes[0].timeMs;
    const xMax = chartXMin + CHART_DAYS * 24 * 60 * 60 * 1000;

    const dataPoints = [], pointRadii = [], pointColors = [];

    if (extremes.length >= 2) {
        const step = 30 * 60 * 1000;
        for (let i = 0; i < extremes.length - 1; i++) {
            const pt1 = extremes[i], pt2 = extremes[i + 1];
            dataPoints.push({ x: pt1.timeMs, y: pt1.height });
            pointRadii.push(5);
            pointColors.push(pt1.type === 'high' ? '#0275d8' : '#d9534f');
            for (let t = pt1.timeMs + step; t < pt2.timeMs; t += step) {
                const norm = (t - pt1.timeMs) / (pt2.timeMs - pt1.timeMs);
                const cosV = (1 - Math.cos(Math.PI * norm)) / 2;
                dataPoints.push({ x: t, y: pt1.height + (pt2.height - pt1.height) * cosV });
                pointRadii.push(0);
                pointColors.push('#0056b3');
            }
        }
        const last = extremes[extremes.length - 1];
        dataPoints.push({ x: last.timeMs, y: last.height });
        pointRadii.push(5);
        pointColors.push(last.type === 'high' ? '#0275d8' : '#d9534f');
    }

    if (tideChartInstance) tideChartInstance.destroy();

    const xTicks = buildChartXTicks(chartXMin, xMax);

    tideChartInstance = new Chart(ctx, {
        type: 'line',
        plugins: [nowLinePlugin],
        data: {
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
            responsive: false,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title(items) {
                            if (!items.length) return '';
                            const ms = items[0].parsed.x;
                            const h = (new Date(ms).getUTCHours() + 9) % 24;
                            const m = new Date(ms).getUTCMinutes();
                            return h + ':' + String(m).padStart(2, '0');
                        },
                        label: ctx => hasHeightData ? ctx.parsed.y.toFixed(2) + ' m' : '潮位イメージ'
                    }
                }
            },
            scales: {
                y: {
                    display: hasHeightData,
                    suggestedMin: hasHeightData ? Math.min(...dataPoints.map(d => d.y)) - 0.2 : -0.2,
                    suggestedMax: hasHeightData ? Math.max(...dataPoints.map(d => d.y)) + 0.2 :  1.2,
                    ticks: { callback: v => v.toFixed(1) + ' m' }
                    // 👇ここを追加（Y軸の幅を固定）
                    afterFit: function(scale) {
                        scale.width = 55; // 波グラフと同じ値に設定します（必要に応じて数値を調整してください）
                    }
                },
                x: {
                    type: 'linear', min: chartXMin, max: xMax,
                    afterBuildTicks(axis) { axis.ticks = xTicks; },
                    ticks: { maxRotation: 0, callback: chartXTickCallback },
                    grid: { display: false }
                }
            }
        }
    });

    syncChartScroll();
    scrollChartsToNow();
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
    const warningUrl = 'https://www.jma.go.jp/bosai/warning/data/warning/140000.json';
    try {
        const data = await fetchWithLocalCache(warningUrl, 'cache_jma_warning', 10 * 60 * 1000);

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
        const dateStrs = [];
        for (let i = 0; i < CHART_DAYS; i++) {
            const d = new Date(todayJst);
            d.setDate(d.getDate() + i);
            dateStrs.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
        }
        // 3日分 + 翌日00:00のデータを含める
        const nextDayJst = new Date(todayJst);
        nextDayJst.setDate(nextDayJst.getDate() + CHART_DAYS);
        const nextDayStr = `${nextDayJst.getFullYear()}-${String(nextDayJst.getMonth()+1).padStart(2,'0')}-${String(nextDayJst.getDate()).padStart(2,'0')}`;

        const todayData = (json.data || []).filter(d =>
            dateStrs.some(s => d.time.startsWith(s)) || d.time.startsWith(nextDayStr + 'T00:00')
        );
        if (todayData.length === 0) throw new Error('本日の波浪データがありません');

        waveChartInstance = drawWaveCombinedChart('waveChart', waveChartInstance, todayData);

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

    // 潮汐グラフと同じx軸範囲を使用（chartXMin が設定されていない場合は今日の4時から）
    const jstOffsetMs = 9 * 60 * 60 * 1000;
    const todayJstStartMs = Math.floor((Date.now() + jstOffsetMs) / 86400000) * 86400000 - jstOffsetMs;
    const xMin = chartXMin !== null ? chartXMin : todayJstStartMs + 4 * 60 * 60 * 1000;
    const xMax = xMin + CHART_DAYS * 24 * 60 * 60 * 1000;

    setChartContainerWidth('wave-chart-container', CHART_TOTAL_PX);

    const waveXTicks = buildChartXTicks(xMin, xMax);

    const waveCanvas = document.getElementById(canvasId);
    waveCanvas.width  = CHART_TOTAL_PX;
    waveCanvas.height = 200;
    const ctx   = waveCanvas.getContext('2d');
    const chart = new Chart(ctx, {
        type: 'line',
        plugins: [nowLinePlugin],
        data: {
            datasets: [
                {
                    label: '最大波高 [m]',
                    data: heightData,
                    borderColor: '#0275d8', backgroundColor: '#0275d826',
                    borderWidth: 2, pointRadius: 5,
                    pointBackgroundColor: '#0275d8', pointBorderColor: '#fff',
                    pointHoverRadius: 7, fill: true, tension: 0.3, yAxisID: 'yWave',
                },
                {
                    label: '周期 [秒]',
                    data: periodData,
                    borderColor: '#27ae60', backgroundColor: 'transparent',
                    borderWidth: 2, pointRadius: 5,
                    pointBackgroundColor: '#27ae60', pointBorderColor: '#fff',
                    pointHoverRadius: 7, fill: false, tension: 0.3, yAxisID: 'yPeriod',
                }
            ]
        },
        options: {
            responsive: false,
            maintainAspectRatio: false,
            layout: {
                padding: { top: 0, left: 0, right: 0, bottom: 24 }
            },
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
                            return h + ':' + String(m).padStart(2,'0');
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
                    afterBuildTicks(axis) { axis.ticks = waveXTicks; },
                    ticks: { maxRotation: 0, callback: chartXTickCallback },
                    grid: { display: false }
                },
yWave: {
                    type: 'linear', position: 'left',
                    title: { display: false },
                    ticks: { 
                        padding: 0,
                        maxTicksLimit: 4, 
                        callback: v => v.toFixed(1) 
                    },
                    grid: { 
                        color: 'rgba(0,0,0,0.05)',
                        drawTicks: false, // 【追加】目盛り線を非表示にする
                        tickLength: 0     // 【追加】念のため長さを0に
                    }
                    afterFit: function(scale) {
                        scale.width = 55; // 潮汐グラフと同じ値に設定します
                },
                yPeriod: {
                    type: 'linear', position: 'right',
                    title: { display: false },
                    ticks: { 
                        padding: 0,
                        maxTicksLimit: 4,
                        stepSize: 1, 
                        callback: v => Number.isInteger(v) ? v : null 
                    },
                    grid: { 
                        display: false,
                        drawTicks: false, // 【追加】目盛り線を非表示にする
                        tickLength: 0     // 【追加】念のため長さを0に
                    }
                }
            }
        }
    });

    // カスタムHTML凡例の生成と配置
    let legendDiv = document.getElementById(canvasId + '-custom-legend');
    if (!legendDiv) {
        legendDiv = document.createElement('div');
        legendDiv.id = canvasId + '-custom-legend';
        legendDiv.style.cssText = 'display: flex; justify-content: space-between; font-size: 11px; font-weight: 500; margin-bottom: 8px;';
        
        const container = document.getElementById(canvasId).parentNode;
        container.insertBefore(legendDiv, document.getElementById(canvasId));
    }

    window.toggleWaveDataset = function(index) {
        const isVisible = chart.isDatasetVisible(index);
        chart.setDatasetVisibility(index, !isVisible);
        chart.update();
        
        const legendItem = document.getElementById(`wave-legend-item-${index}`);
        if (legendItem) {
            legendItem.style.opacity = isVisible ? '0.4' : '1';
            legendItem.style.textDecoration = isVisible ? 'line-through' : 'none';
        }
    };

    legendDiv.innerHTML = `
        <div id="wave-legend-item-0" onclick="toggleWaveDataset(0)" style="display: flex; align-items: center; color: #0275d8; cursor: pointer; transition: 0.2s;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #0275d8; margin-right: 5px;"></span>
            最大波高 [m]
        </div>
        <div id="wave-legend-item-1" onclick="toggleWaveDataset(1)" style="display: flex; align-items: center; color: #27ae60; cursor: pointer; transition: 0.2s;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #27ae60; margin-right: 5px;"></span>
            周期 [秒]
        </div>
    `;

    syncChartScroll();
    scrollChartsToNow();

    return chart;
}

async function fetchWeatherData() {
    if (_isFetching) return;
    _isFetching = true;
    const timeEl = document.getElementById('current-time');
    if (timeEl.innerHTML !== '') {
        timeEl.innerHTML = 'データを更新中... ⏳';
        document.getElementById('weather-content').style.opacity      = '0.5';
        document.getElementById('weather-content').style.pointerEvents = 'none';
        (function smoothTop() {
            const start = window.scrollY, t0 = performance.now();
            function step(t) {
                const p = Math.min((t - t0) / 500, 1);
                window.scrollTo(0, start * (1 - p * p * (3 - 2 * p)));
                if (p < 1) requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
        })();
    }
    try {
        await calculateTide();
        // 潮汐を先に完了させ chartXMin を確定してから波グラフを描画
        await Promise.allSettled([
            fetchTideExtremes(),
            fetchJmaForecast(),
            fetchJmaWarning(),
        ]);
        await fetchWaveGuidance();

        // Open-Meteo はセッション内30分キャッシュ
        const [weatherResult, marineResult] = await Promise.allSettled([
            fetchWithCache(weatherUrl, 'cache_weather'),
            fetchWithCache(marineUrl,  'cache_marine'),
        ]);
        if (weatherResult.status === 'rejected') throw weatherResult.reason;
        if (marineResult.status  === 'rejected') throw marineResult.reason;
        const weatherData = weatherResult.value;
        const marineData  = marineResult.value;

        const temp = weatherData.current_weather.temperature;
        document.getElementById('temp').textContent     = `${temp}℃`;
        document.getElementById('wind').textContent     = `${weatherData.current_weather.windspeed} m/s`;
        document.getElementById('wind-dir').textContent = getWindDirection16(weatherData.current_weather.winddirection);
        document.getElementById('hero-temp').textContent = temp;
        document.getElementById('hero-wind').textContent = weatherData.current_weather.windspeed;

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
    } finally {
        _isFetching = false;
    }
}

let _isFetching    = false;
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

document.addEventListener('DOMContentLoaded', () => {
    fetchWeatherData();
    setInterval(fetchWeatherData, 3 * 60 * 60 * 1000);
});
