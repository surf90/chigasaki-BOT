import json
import urllib.request
import os
from datetime import datetime, timezone, timedelta


def fetch_json(url):
    """URLからJSONデータを取得する。"""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (ChigaLog/1.0)'})
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None


def main():
    print("気象庁 天気予報データの取得を開始します...")

    aggregated_data = {
        "updated_at": datetime.now(timezone(timedelta(hours=9))).isoformat(),
        "forecast": fetch_json("https://www.jma.go.jp/bosai/forecast/data/forecast/140000.json"),
        "overview": fetch_json("https://www.jma.go.jp/bosai/forecast/data/overview_forecast/140000.json"),
    }

    os.makedirs("data", exist_ok=True)

    output_path = "data/forecast_data.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(aggregated_data, f, ensure_ascii=False, indent=2)

    print(f"保存完了: {output_path}")


if __name__ == "__main__":
    main()
