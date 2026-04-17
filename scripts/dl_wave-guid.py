import csv
import io
import json
import os
import urllib.request
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))
# 注: 気象庁サイト側の不具合により wave_guid.html?area=19 がエリア20（関東地方南部）のデータを配信している。
# 正しいエリアコードは20のため、CSVは wave_guid_20.csv を使用する。
URL = "https://www.data.jma.go.jp/waveinf/data/Guid/csv/wave_guid_20.csv"


def fetch_csv(url: str) -> str:
    """CSVデータをURLから取得してデコードする。"""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (ChigaLog/1.0)"})
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("shift_jis")


def parse_csv(csv_text: str) -> list[dict]:
    """CSVを解析して時刻・周期・波高のリストを返す。"""
    reader = csv.reader(io.StringIO(csv_text))
    next(reader)  # ヘッダー行をスキップ
    result = []
    for row in reader:
        if len(row) < 7:
            continue
        _, year, month, day, hour, period, wave_height = row[:7]
        try:
            dt = datetime(int(year), int(month), int(day), int(hour), tzinfo=JST)
            result.append({
                "time": dt.isoformat(),
                "period": float(period),
                "wave_height": float(wave_height),
            })
        except (ValueError, IndexError):
            continue
    return result


def main() -> None:
    """気象庁波浪ガイダンス（area=19）を取得してJSONに保存する。"""
    print("気象庁 波浪ガイダンス（area=19）の取得を開始します...")
    csv_text = fetch_csv(URL)
    data = parse_csv(csv_text)
    output = {
        "updated_at": datetime.now(JST).isoformat(),
        "area": 19,
        "data": data,
    }
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(repo_root, "data")
    os.makedirs(data_dir, exist_ok=True)
    output_path = os.path.join(data_dir, "wave_guid_20.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"保存完了: {output_path}（{len(data)}件）")


if __name__ == "__main__":
    main()
