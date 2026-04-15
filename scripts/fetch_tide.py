import os
import json
import datetime
import urllib.request
import urllib.error

LAT = 35.318
LON = 139.410
API_KEY = os.environ.get("STORMGLASS_API_KEY")

if not API_KEY:
    print("Error: STORMGLASS_API_KEY is not set.")
    exit(1)

# 日本時間の「今日の00:00」〜「23:59」を計算
JST = datetime.timezone(datetime.timedelta(hours=+9), 'JST')
now_jst = datetime.datetime.now(JST)
start_jst = now_jst.replace(hour=0, minute=0, second=0, microsecond=0)
end_jst = now_jst.replace(hour=23, minute=59, second=59, microsecond=0)

# 確実な通信のため、日付文字列ではなくUNIXタイムスタンプ（数値）に変換
start_timestamp = int(start_jst.timestamp())
end_timestamp = int(end_jst.timestamp())

# タイムスタンプを使ってURLを組み立てる
url = f"https://api.stormglass.io/v2/tide/extremes/point?lat={LAT}&lng={LON}&start={start_timestamp}&end={end_timestamp}"

req = urllib.request.Request(url)
req.add_header('Authorization', API_KEY)

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        
        # 取得したデータを tide_data.json として保存する
        with open('tide_data.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print("Successfully fetched and saved tide_data.json")

except urllib.error.URLError as e:
    print(f"Error fetching data: {e}")
    exit(1)