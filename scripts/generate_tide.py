import urllib.request
import json
from datetime import datetime

def parse_jma_tide_data(year, station_code="D8"):
    """
    気象庁の固定長テキストデータを取得し、JSON化しやすい辞書形式に変換します。
    """
    url = f"https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/{year}/{station_code}.txt"
    tide_dict = {}

    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as response:
            text_data = response.read().decode('shift_jis') 
            
        lines = text_data.splitlines()

        for line in lines:
            if len(line) < 136: # 行の長さが足りない場合はスキップ
                continue

            yy_str = line[72:74]
            mm_str = line[74:76]
            dd_str = line[76:78]
            
            full_year = 2000 + int(yy_str)
            # 空白を取り除き、必ず2桁のゼロ埋め（04など）にする
            date_key = f"{full_year}-{mm_str.strip().zfill(2)}-{dd_str.strip().zfill(2)}"

            def extract_extremes(data_str, type_name):
                extremes = []
                for i in range(4):
                    chunk = data_str[i*7:(i+1)*7]
                    
                    # 空白や欠測データ('9999')をスキップ
                    if not chunk.strip() or chunk.startswith('9999'):
                        continue
                        
                    hh = chunk[0:2].strip()
                    mm = chunk[2:4].strip()
                    level_cm_str = chunk[4:7].strip()
                    
                    if hh and mm and level_cm_str:
                        # 万が一潮位が「999（データなし）」の場合はスキップ
                        if level_cm_str == '999':
                            continue
                            
                        time_iso = f"{date_key}T{hh.zfill(2)}:{mm.zfill(2)}:00+09:00"
                        
                        try:
                            # センチメートルをメートルに変換
                            level_m = int(level_cm_str) / 100.0  
                            extremes.append({
                                "time": time_iso,
                                "type": type_name,
                                "height": level_m  
                            })
                        except ValueError:
                            # 万が一、数字に変換できないノイズが含まれていた場合は無視して進める
                            pass
                            
                return extremes

            # 【修正箇所】文字の切り取り位置（インデックス）を仕様書通りに修正
            # 満潮: 81文字目〜108文字目 (Pythonのインデックスでは 80:108)
            high_tides = extract_extremes(line[80:108], "high")
            # 干潮: 109文字目〜136文字目 (Pythonのインデックスでは 108:136)
            low_tides = extract_extremes(line[108:136], "low")

            daily_extremes = high_tides + low_tides
            # 時刻順に並び替え
            daily_extremes.sort(key=lambda x: x["time"])
            
            tide_dict[date_key] = daily_extremes

        return tide_dict

    except Exception as e:
        print(f"データの取得・解析中にエラーが発生しました: {e}")
        return None

if __name__ == "__main__":
    target_year = input("取得する年を西暦で入力してください（例: 2026）: ")
    
    print(f"気象庁から {target_year} 年の潮汐データを取得中...")
    
    result_data = parse_jma_tide_data(int(target_year))
    
    if result_data:
        output_filename = "tidedata.json"
        with open(output_filename, "w", encoding="utf-8") as f:
            json.dump(result_data, f, ensure_ascii=False, indent=2)
        print(f"正常に {output_filename} を生成しました。")
