import streamlit as st
import datetime
import random
import os
import json
import urllib.request
import urllib.error

LAT = 35.318
LON = 139.410
API_KEY = os.environ.get("STORMGLASS_API_KEY")

# --- Page Configuration ---
st.set_page_config(
    page_title="Surf90Chigasaki",
    page_icon="🌊",
    layout="centered",
    initial_sidebar_state="collapsed"
)

# --- Custom CSS for Styling ---
def local_css():
    st.markdown("""
    <style>
    /* Main Background */
    .stApp {
        background-color: #F0F8FF; /* AliceBlue */
    }
    
    /* Header Styling */
    h1 {
        color: #006994; /* Sea Blue */
        font-family: 'Helvetica Neue', sans-serif;
    }
    
    h2, h3 {
        color: #0077BE; /* Ocean Blue */
    }
    
    /* Card-like containers using Streamlit's markdown */
    div.stContainer {
        border-radius: 10px;
        padding: 10px;
    }
    
    /* Metric styling */
    [data-testid="stMetricValue"] {
        font-size: 1.5rem;
        color: #003366;
    }
    
    [data-testid="stMetricLabel"] {
        color: #555;
    }
    
    /* Custom info box */
    .info-box {
        background-color: white;
        padding: 15px;
        border-radius: 10px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        margin-bottom: 15px;
    }
    
    .weather-card {
        background-color: white;
        padding: 10px;
        border-radius: 8px;
        text-align: center;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        min-width: 80px;
    }
    
    </style>
    """, unsafe_allow_html=True)

local_css()

# --- Mock Data Functions ---

def get_tide_info():
    """Fetches real tide data from Storm Glass API."""
    if not API_KEY:
        st.error("Error: STORMGLASS_API_KEY is not set.")
        return "Unknown", []

    # 日本時間の「今日の00:00」〜「23:59」を計算し、UTCに変換する
    JST = datetime.timezone(datetime.timedelta(hours=+9), 'JST')
    now_jst = datetime.datetime.now(JST)
    start_jst = now_jst.replace(hour=0, minute=0, second=0, microsecond=0)
    end_jst = now_jst.replace(hour=23, minute=59, second=59, microsecond=999999)

    start_utc = start_jst.astimezone(datetime.timezone.utc).isoformat()
    end_utc = end_jst.astimezone(datetime.timezone.utc).isoformat()

    url = f"https://api.stormglass.io/v2/tide/extremes/point?lat={LAT}&lng={LON}&start={start_utc}&end={end_utc}"

    req = urllib.request.Request(url)
    req.add_header('Authorization', API_KEY)

    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            
            # 取得したデータを tide_data.json として保存する
            with open('tide_data.json', 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            
            # Process data for display
            tides = []
            for item in data.get('data', []):
                timestamp = datetime.datetime.fromisoformat(item['time'].replace('Z', '+00:00'))
                time_jst = timestamp.astimezone(JST).strftime('%H:%M')
                level_cm = f"{item['height'] * 100:.0f}cm"  # Assuming height in meters
                tide_type = "High (満潮)" if item['type'] == 'high' else "Low (干潮)"
                icon = "⬆️" if item['type'] == 'high' else "⬇️"
                tides.append({
                    "time": time_jst,
                    "level": level_cm,
                    "type": tide_type,
                    "icon": icon
                })
            
            # Mock tide type for now
            tide_type = "中潮 (Middle)"
            return tide_type, tides

    except urllib.error.URLError as e:
        st.error(f"Error fetching data: {e}")
        return "Unknown", []

def get_weather_forecast():
    """Generates mock weather forecast for next 6 hours."""
    forecasts = []
    current_hour = datetime.datetime.now().hour
    
    weather_icons = ["☀️", "🌤️", "☁️", "🌥️", "🌧️"]
    
    for i in range(6):
        h = (current_hour + i) % 24
        
        # Simple mock logic
        if 6 <= h < 18:
            icon = weather_icons[0] if i < 2 else weather_icons[1]
            temp = 22 + (1 if h > 10 and h < 14 else -1) * i
        else:
            icon = "🌙"
            temp = 18 - 0.5 * i
            
        forecasts.append({
            "time": f"{h:02d}:00",
            "icon": icon,
            "temp": f"{temp:.1f}°C"
        })
    return forecasts

# --- Main App Interface ---

# 1. Header Section
st.markdown("<div style='text-align: center;'><h1>Surf90Chigasaki</h1></div>", unsafe_allow_html=True)
st.markdown("<div style='text-align: center; color: #666; margin-bottom: 20px;'>茅ヶ崎ヘッドランド (Tバー) の波情報</div>", unsafe_allow_html=True)

# Beach Image (Placeholder using Unsplash source for "ocean waves")
st.image("https://images.unsplash.com/photo-1505118380757-91f5f5632de0?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80", use_column_width=True, caption="Current View (Mock)")

st.markdown("""
<div class='info-box' style='text-align: center;'>
    <p>茅ヶ崎のシンボルであるTバー周辺の波情報をお届けします。<br>今日の波はどうかな？</p>
</div>
""", unsafe_allow_html=True)

# 2. Tide Info Section
st.markdown("### 🌊 Tide Info (潮汐)")

tide_type, tide_data = get_tide_info()
date_str = datetime.datetime.now().strftime('%Y/%m/%d')

st.markdown(f"""
<div class='info-box'>
    <div style='display: flex; justify-content: space-between; align-items: center;'>
        <b>{date_str}</b>
        <span style='background-color: #e0f7fa; padding: 2px 8px; border-radius: 4px; color: #006064;'>{tide_type}</span>
    </div>
    <hr style='margin: 10px 0; border: 0; border-top: 1px solid #eee;'>
""", unsafe_allow_html=True)

# Tide List
for item in tide_data:
    color = "red" if "High" in item['type'] else "blue"
    st.markdown(f"""
    <div style='display: flex; justify-content: space-between; margin-bottom: 8px;'>
        <span>{item['icon']} <b style='color: {color};'>{item['type']}</b></span>
        <span style='font-family: monospace;'>{item['time']}</span>
        <span style='font-family: monospace;'>{item['level']}</span>
    </div>
    """, unsafe_allow_html=True)

st.markdown("</div>", unsafe_allow_html=True)

# 3. Weather Forecast Section
st.markdown("### 🌤️ Weather Forecast")

forecasts = get_weather_forecast()

# Display as horizontal cards using columns
cols = st.columns(len(forecasts))

for idx, col in enumerate(cols):
    with col:
        item = forecasts[idx]
        st.markdown(f"""
        <div class='weather-card'>
            <div style='font-size: 0.8em; color: #666;'>{item['time']}</div>
            <div style='font-size: 2em; margin: 5px 0;'>{item['icon']}</div>
            <div style='font-weight: bold; color: #333;'>{item['temp']}</div>
        </div>
        """, unsafe_allow_html=True)

# Footer
st.markdown("---")
st.markdown("<div style='text-align: center; color: #aaa; font-size: 0.8em;'>© 2026 Surf90Chigasaki</div>", unsafe_allow_html=True)
