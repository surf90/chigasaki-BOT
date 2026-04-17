"""
GitHub Actionsから毎日 JST 0:10 に実行し、
当日分の月齢・潮汐データを小さなJSONとして出力するスクリプト。

出力:
  data/moon_today.json  - 本日の月齢・月相（数十バイト）
  data/tide_today.json  - 本日の満潮・干潮一覧（数百バイト）
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))


def extract_moon_today() -> bool:
    """NASA SVSの年間JSONから当日JST正午の月齢エントリを抽出する。"""
    now_jst = datetime.now(JST)
    year = now_jst.year

    moon_file = f"data/mooninfo_{year}.json"
    if not os.path.exists(moon_file):
        print(f"[moon] {moon_file} が見つかりません。スキップします。", file=sys.stderr)
        return False

    # JST正午 = UTC 03:00 を基準にすることで、その日の代表値として安定する
    target_utc = datetime(now_jst.year, now_jst.month, now_jst.day, 3, 0, 0,
                          tzinfo=timezone.utc)
    year_start = datetime(year, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    hour_index = int((target_utc - year_start).total_seconds() / 3600)

    with open(moon_file, encoding="utf-8") as f:
        moon_data = json.load(f)

    if hour_index < 0 or hour_index >= len(moon_data):
        print(f"[moon] hourIndex={hour_index} が範囲外です。", file=sys.stderr)
        return False

    entry = moon_data[hour_index]
    result = {
        "date": now_jst.strftime("%Y-%m-%d"),
        "age": round(entry["age"], 3),
        "phase": round(entry["phase"], 1),
    }

    with open("data/moon_today.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"[moon] {result['date']} age={result['age']} phase={result['phase']}")
    return True


def extract_tide_today() -> bool:
    """気象庁の年間潮汐JSONから当日のエントリを抽出する。"""
    now_jst = datetime.now(JST)
    date_str = now_jst.strftime("%Y-%m-%d")

    tide_file = "data/tidedata.json"
    if not os.path.exists(tide_file):
        print(f"[tide] {tide_file} が見つかりません。スキップします。", file=sys.stderr)
        return False

    with open(tide_file, encoding="utf-8") as f:
        all_tides = json.load(f)

    today_tides = all_tides.get(date_str, [])
    result = {
        "date": date_str,
        "tides": today_tides,
    }

    with open("data/tide_today.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"[tide] {date_str} {len(today_tides)} エントリを保存しました。")
    return True


if __name__ == "__main__":
    ok_moon = extract_moon_today()
    ok_tide = extract_tide_today()

    if not ok_moon or not ok_tide:
        sys.exit(1)
