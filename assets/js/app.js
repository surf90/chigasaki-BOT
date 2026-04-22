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
    const xMax = chartXMin + CHART_DAYS * 24 * 60 * 60 *
