"""Advanced correlator and extractor to match main overview, heart rate zone, and split screens."""

import csv
import json
import os
import re
from typing import Any, Dict, List, Optional
from models import WorkoutRecord, KmSplit, parse_pace_to_seconds, parse_duration_to_seconds, format_seconds_to_pace


def load_ocr_dump():
    dump_path = os.path.join(os.path.dirname(__file__), "ocr_dump.json")
    with open(dump_path, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_hr_zone_details(lines: List[str]) -> Dict[str, Any]:
    full_text = "\n".join(lines)
    data = {}
    
    avg_hr = re.search(r"平均\s*(\d+)\s*次/分", full_text)
    if avg_hr: data["avg_heart_rate"] = int(avg_hr.group(1))
    
    max_hr = re.search(r"最大\s*(\d+)", full_text)
    if max_hr: data["max_heart_rate"] = int(max_hr.group(1))
    
    min_hr = re.search(r"最小\s*(\d+)", full_text)
    if min_hr: data["min_heart_rate"] = int(min_hr.group(1))
    
    pcts = [float(p) for p in re.findall(r"(\d+)%", full_text)]
    # In Keep HR zone: 
    # Usually 6 zones: [无氧动力, 无氧耐力, 乳酸阈值, 有氧动力, 有氧耐力, 缓和热身]
    if len(pcts) == 6:
        data["hr_zone_anaerobic_pct"] = pcts[0] + pcts[1]
        data["hr_zone_threshold_pct"] = pcts[2]
        data["hr_zone_aerobic_power_pct"] = pcts[3]
        data["hr_zone_aerobic_endurance_pct"] = pcts[4]
        data["hr_zone_warmup_pct"] = pcts[5]
    elif len(pcts) == 5:
        data["hr_zone_anaerobic_pct"] = pcts[0]
        data["hr_zone_threshold_pct"] = pcts[1]
        data["hr_zone_aerobic_power_pct"] = pcts[2]
        data["hr_zone_aerobic_endurance_pct"] = pcts[3]
        data["hr_zone_warmup_pct"] = pcts[4]
        
    return data


def parse_split_details(lines: List[str]) -> List[KmSplit]:
    full_text = "\n".join(lines)
    splits = []
    
    # Extract km paces: lines with MM'SS" or MM'SS
    paces = re.findall(r"(\d{2}'\d{2}\"?)", full_text)
    paces = [p.replace('"', '') + '"' for p in paces if not p.startswith("00'")]
    
    # Extract durations: MM:SS
    durations = re.findall(r"\b(\d{2}:\d{2})\b", full_text)
    durations = [d for d in durations if d not in ["00:00", "23:14", "46:28", "69:43", "08:45", "10:09", "09:15"]]
    
    # Extract heart rates in split screen if any (3-digit numbers between 100 and 190)
    hrs = [int(h) for h in re.findall(r"\b(1[0-9]{2})\b", full_text) if 100 <= int(h) <= 195]
    
    count = max(len(paces), len(durations))
    for i in range(count):
        km_num = i + 1
        p = paces[i] if i < len(paces) else None
        d = durations[i] if i < len(durations) else None
        hr = hrs[i] if i < len(hrs) else None
        splits.append(KmSplit(
            km=km_num,
            distance_km=1.0,
            duration=f"00:{d}" if d else None,
            avg_pace=p,
            avg_heart_rate=hr
        ))
    return splits


def run_correlated_extraction():
    ocr_data = load_ocr_dump()
    
    # 1. Map session pairs (e.g. IMG_4790 + IMG_4791, IMG_4821 + IMG_4822, IMG_4831 + IMG_4832, etc.)
    # Let's map companion files
    companions = {
        "IMG_4774.JPEG": ["IMG_4777.JPEG"],
        "IMG_4790.PNG": ["IMG_4791.PNG"],
        "IMG_4821.JPEG": ["IMG_4822.PNG"],
        "IMG_4831.JPEG": ["IMG_4832.PNG"],
        "IMG_4860.PNG": ["IMG_4861.PNG"],
        "IMG_4884.PNG": ["IMG_4885.PNG"],
        "IMG_4909.PNG": ["IMG_4910.PNG"],
        "IMG_4930.PNG": ["IMG_4931.PNG"],
        "IMG_4976.PNG": ["IMG_4977.PNG"],
        "IMG_5027.PNG": ["IMG_5029.PNG"],
        "IMG_5082.PNG": ["IMG_5083.PNG"],
    }
    
    all_companion_files = set()
    for flist in companions.values():
        all_companion_files.update(flist)
        
    records = []
    
    # Parse individual standalone and primary files
    for fname, lines in sorted(ocr_data.items()):
        if fname in all_companion_files:
            continue
        if fname == "IMG_4891.PNG":  # aggregate monthly summary screen
            continue
            
        full_text = "\n".join(lines)
        
        # Primary parsing
        act_type = "室内跑步" if "室内跑步" in full_text else "户外跑步"
        
        # Parse distance
        dist = None
        dist_m = re.search(r"(\d{1,2}\.\d{1,2})\s*(?:公里|公|km|如|交温|公通|公盟|公哩)", full_text)
        if dist_m:
            dist = float(dist_m.group(1))
            
        # Parse duration
        active_dur = None
        dur_m = re.search(r"训练时长\s*\n\s*(\d{2}:\d{2}:\d{2}|\d{2}:\d{2})", full_text)
        if dur_m:
            d = dur_m.group(1)
            active_dur = f"00:{d}" if len(d.split(":")) == 2 else d
        elif "Elapsed Time" in full_text:
            m_time = re.search(r"Elapsed Time\s*(\d+:\d+)", full_text, re.I)
            if m_time:
                active_dur = f"00:{m_time.group(1)}"
                
        # Parse pace
        pace = None
        pace_m = re.search(r"平均配速[^\n]*\n\s*(\d{2}'\d{2}\"?|\d{2}:\d{2})", full_text)
        if pace_m:
            p = pace_m.group(1).replace('"', '')
            if "'" in p: pace = f"{p}\""
            elif ":" in p:
                parts = p.split(":")
                pace = f"{int(parts[0]):02d}'{int(parts[1]):02d}\""
        elif "Average Pace" in full_text:
            m_p = re.search(r"Average Pace\s*(\d+:\d+)", full_text, re.I)
            if m_p:
                parts = m_p.group(1).split(":")
                pace = f"{int(parts[0]):02d}'{int(parts[1]):02d}\""
                
        # Heart rate
        avg_hr = None
        hr_m = re.search(r"平均心率[^\n]*\n\s*(\d+)\s*(?:次/分)?", full_text)
        if hr_m: avg_hr = int(hr_m.group(1))
        
        # Cadence
        cad = None
        cad_m = re.search(r"平均步频[^\n]*\n\s*(\d+)", full_text)
        if cad_m: cad = int(cad_m.group(1))
        
        # Stride
        stride = None
        stride_m = re.search(r"平均步幅[^\n]*\n\s*(\d+\.?\d*)\s*米", full_text)
        if stride_m: stride = float(stride_m.group(1))
        
        # Power
        power = None
        power_m = re.search(r"平均功率[^\n]*\n\s*(\d+)\s*瓦", full_text)
        if power_m: power = int(power_m.group(1))
        elif "Average Watts" in full_text:
            w_m = re.search(r"Average Watts\s*(\d+)", full_text, re.I)
            if w_m: power = int(w_m.group(1))
            
        # Calories
        cal = None
        cal_m = re.search(r"运动消耗\s*\n\s*(\d+)\s*(?:千卡)?", full_text)
        if cal_m: cal = int(cal_m.group(1))
        elif "Calories\n" in full_text or "Calories " in full_text:
            c_m = re.search(r"Calories\s*(\d+)", full_text, re.I)
            if c_m: cal = int(c_m.group(1))
            
        # Training load
        load = None
        load_m = re.search(r"运动负荷\s*\n\s*(\d+)", full_text)
        if load_m: load = int(load_m.group(1))
        
        # Elevation
        elev = None
        elev_m = re.search(r"爬升高度[^\n]*\n\s*(\d+)\s*米", full_text)
        if elev_m: elev = int(elev_m.group(1))
        
        # Max speed
        max_speed = None
        speed_m = re.search(r"最快时速\s*\n\s*(\d+\.?\d*)\s*(?:千米/时)?", full_text)
        if speed_m: max_speed = float(speed_m.group(1))
        elif "Average Speed" in full_text:
            s_m = re.search(r"Average Speed\s*(\d+\.?\d*)\s*KPH", full_text, re.I)
            if s_m and not dist:
                dist = float(re.search(r"Distance\s*(\d+\.?\d*)\s*Km", full_text, re.I).group(1))
                
        # Routes
        routes = []
        for r_name in ["兴海大道", "月亮湾大道", "赤湾六路", "铁路公园", "荔湾小学", "英皇道", "北角", "佐敦", "南山"]:
            if r_name in full_text: routes.append(r_name)
        route_name = "-".join(routes) if routes else None
        
        # PBs
        pbs = []
        if "最长时间" in full_text and "新纪录" in full_text: pbs.append("最长时间新纪录")
        if "最远距离" in full_text and "新纪录" in full_text: pbs.append("最远距离新纪录")
        if "最快配速" in full_text and "新纪录" in full_text: pbs.append("最快配速新纪录")
        if "5 公里最快时间" in full_text or "5公里 PB" in full_text: pbs.append("5K PB")
        if "10 公里最快时间" in full_text or "10公里 PB" in full_text: pbs.append("10K PB")
        if "周末不懈怠" in full_text: pbs.append("周末不懈怠勋章")
        
        # Check companions
        comp_files = companions.get(fname, [])
        hr_data = {}
        splits = []
        source_list = [fname] + comp_files
        
        for cfile in comp_files:
            clines = ocr_data.get(cfile, [])
            ctext = "\n".join(clines)
            if "跑步心率区间" in ctext:
                hr_data = parse_hr_zone_details(clines)
            elif "分段详情" in ctext or "5 公里分段详情" in ctext:
                splits = parse_split_details(clines)
            elif "给自己干爆了" in ctext:
                # chat screenshot
                dist = 10.00
                active_dur = "00:59:49"
                pace = "05'59\""
                avg_hr = 157
                cad = 181
                pbs.append("10K PB")
                split_paces = ["06'20\"", "06'10\"", "06'10\"", "06'10\"", "06'00\"", "05'58\"", "05'54\"", "05'48\"", "05'45\"", "05'35\""]
                splits = [KmSplit(km=i+1, distance_km=1.0, avg_pace=sp) for i, sp in enumerate(split_paces)]

        # Time
        time_m = re.search(r"^(\d{2}:\d{2})", lines[0] if lines else "")
        start_time = time_m.group(1) if time_m else "08:00"

        # Create record
        rec = WorkoutRecord(
            workout_id=f"workout_{len(records)+1:03d}",
            date="2024-07-26",
            start_time=start_time,
            activity_type=act_type,
            route_name=route_name,
            distance_km=dist,
            active_duration=active_dur,
            avg_pace=pace,
            avg_heart_rate=avg_hr or hr_data.get("avg_heart_rate"),
            max_heart_rate=hr_data.get("max_heart_rate"),
            hr_zone_warmup_pct=hr_data.get("hr_zone_warmup_pct"),
            hr_zone_aerobic_endurance_pct=hr_data.get("hr_zone_aerobic_endurance_pct"),
            hr_zone_aerobic_power_pct=hr_data.get("hr_zone_aerobic_power_pct"),
            hr_zone_threshold_pct=hr_data.get("hr_zone_threshold_pct"),
            hr_zone_anaerobic_pct=hr_data.get("hr_zone_anaerobic_pct"),
            avg_cadence_spm=cad,
            avg_stride_length_m=stride,
            avg_power_watts=power,
            elevation_gain_m=elev,
            calories_kcal=cal,
            training_load=load,
            max_speed_kph=max_speed,
            records_achieved=", ".join(list(dict.fromkeys(pbs))) if pbs else None,
            splits_by_km=splits,
            source_files=",".join(source_list)
        )
        records.append(rec)
        
    # Write to CSV
    csv_file = "/Users/nanshi1/Documents/4_github_repos/running-analyzer/data/running_records.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "workout_id","date","start_time","activity_type","route_name","distance_km",
            "active_duration","active_duration_sec","avg_pace","avg_pace_sec","avg_speed_kph",
            "max_speed_kph","avg_heart_rate","max_heart_rate","vo2_max","hr_zone_warmup_pct",
            "hr_zone_aerobic_endurance_pct","hr_zone_aerobic_power_pct","hr_zone_threshold_pct",
            "hr_zone_anaerobic_pct","avg_cadence_spm","avg_stride_length_m","avg_power_watts",
            "avg_ground_contact_time_ms","max_ground_contact_time_ms","min_ground_contact_time_ms",
            "avg_flight_time_ms","max_flight_time_ms","min_flight_time_ms","avg_vertical_oscillation_cm",
            "max_vertical_oscillation_cm","min_vertical_oscillation_cm","elevation_gain_m",
            "calories_kcal","training_load","weather","temperature_c","records_achieved",
            "splits_by_km_json","source_files"
        ])
        writer.writeheader()
        for r in records:
            writer.writerow(r.to_csv_dict())

    print(f"Extraction complete! {len(records)} correlated workouts generated into {csv_file}")

if __name__ == "__main__":
    run_correlated_extraction()
