"""
GitHub Actionsから毎日 JST 0:05 に実行し、
当日分の月齢・潮汐データを小さなJSONとして出力するスクリプト。
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))

def load_json(filepath: str) -> dict | list | None:
    """JSONファイルを安全に読み込むヘルパー関数"""
    if not os.path.exists(filepath):
        print(f"[error] {filepath} が見つかりません。", file=sys.stderr)
        return None
    try:
        with open(filepath, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"[error] {filepath} の読み込みに失敗しました: {e}", file=sys.stderr)
        return None

def extract_moon_today() -> bool:
    """NASA SVSの年間JSONから当日JST正午の月齢エントリを抽出する。"""
    now_jst = datetime.now(JST)
    year = now_jst.year
    moon_file = f"data/mooninfo_{year}.json"

    moon_data = load_json(moon_file)
    if moon_data is None:
        return False

    target_utc = datetime(now_jst.year, now_jst.month, now_jst.day, 3, 0, 0, tzinfo=timezone.utc)
    year_start = datetime(year, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    hour_index = int((target_utc - year_start).total_seconds() / 3600)

    if hour_index < 0 or hour_index >= len(moon_data):
        print(f"[moon] hourIndex={hour_index} が範囲外です。", file=sys.stderr)
        return False

    entry = moon_data[hour_index]
    result = {
        "date": now_jst.strftime("%Y-%m-%d"),
        "age": round(entry["age"], 3),
        "phase": round(entry["phase"], 1),
    }

    os.makedirs("data", exist_ok=True) # ディレクトリ確保
    with open("data/moon_today.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"[moon] {result['date']} age={result['age']} phase={result['phase']}")
    return True

# 変更点: 引数として all_tides (読み込み済みのデータ) を受け取るようにした
def extract_tide_today(all_tides: dict) -> bool:
    """気象庁の年間潮汐JSONから当日のエントリを抽出する。"""
    date_str = datetime.now(JST).strftime("%Y-%m-%d")
    today_tides = all_tides.get(date_str, [])
    
    result = {
        "date": date_str,
        "tides": today_tides,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/tide_today.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"[tide] {date_str} {len(today_tides)} エントリを保存しました。")
    return True

# 変更点: 引数として all_tides を受け取るようにした
def extract_tide_3day(all_tides: dict) -> bool:
    """気象庁の年間潮汐JSONから本日〜翌々日のエントリを出力する。"""
    now_jst = datetime.now(JST)
    days = []

    for delta in range(3):
        d = now_jst + timedelta(days=delta)
        date_str = d.strftime("%Y-%m-%d")
        days.append({"date": date_str, "tides": all_tides.get(date_str, [])})

    result = {"generated": now_jst.isoformat(), "days": days}

    os.makedirs("data", exist_ok=True)
    with open("data/tide_3day.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"[tide3day] {days[0]['date']}〜{days[-1]['date']} を保存しました。")
    return True

if __name__ == "__main__":
    ok_moon = extract_moon_today()
    
    # 潮汐データはここで1回だけ読み込み、各関数に使い回す
    tide_data = load_json("data/tidedata.json")
    
    if tide_data is not None:
        ok_tide_today = extract_tide_today(tide_data)
        ok_tide_3day = extract_tide_3day(tide_data)
        ok_tide = ok_tide_today and ok_tide_3day
    else:
        ok_tide = False

    if not ok_moon or not ok_tide:
        sys.exit(1)
