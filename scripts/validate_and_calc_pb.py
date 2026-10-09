"""Validation, consistency check, and Indoor/Outdoor Personal Best (PB) tracker."""

import csv
import json
import os
from typing import Dict, List, Any


def load_dataset(csv_path: str) -> List[Dict[str, Any]]:
    records = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append(row)
    return records


def parse_time_sec(time_str: str) -> int:
    if not time_str:
        return 0
    parts = time_str.strip().split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1])
    elif len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    return 0


def find_best_continuous(record: Dict[str, Any], target_dist: int):
    splits_raw = record.get("splits_by_km_json", "")
    if splits_raw and splits_raw.strip().startswith("["):
        try:
            splits = json.loads(splits_raw)
            if isinstance(splits, list) and len(splits) >= target_dist:
                best_sec = None
                best_start = 1
                best_end = target_dist
                for i in range(len(splits) - target_dist + 1):
                    win = splits[i : i + target_dist]
                    win_sec = sum(parse_time_sec(s.get("duration", s.get("split_duration", ""))) for s in win)
                    if win_sec > 0:
                        if best_sec is None or win_sec < best_sec:
                            best_sec = win_sec
                            best_start = i + 1
                            best_end = i + target_dist
                if best_sec is not None:
                    return {"seconds": best_sec, "start_km": best_start, "end_km": best_end, "from_splits": True}
        except Exception:
            pass

    # Fallback to workout total
    dist = float(record["distance_km"]) if record.get("distance_km") else 0
    dur_sec = parse_time_sec(record.get("active_duration", ""))
    if dur_sec > 0:
        if target_dist == 5 and 4.8 <= dist <= 5.5:
            return {"seconds": dur_sec, "distance": dist, "from_splits": False}
        if target_dist == 10 and 9.8 <= dist <= 10.5:
            return {"seconds": dur_sec, "distance": dist, "from_splits": False}
    return None


def calculate_pbs(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate personal bests for indoor vs outdoor separately."""
    pbs = {
        "户外跑步": {
            "longest_distance": None,
            "longest_time": None,
            "best_5k": None,
            "best_10k": None,
        },
        "室内跑步": {
            "longest_distance": None,
            "longest_time": None,
            "best_5k": None,
            "best_10k": None,
        }
    }
    
    for r in records:
        act = r.get("activity_type", "户外跑步")
        if act not in pbs:
            act = "户外跑步"
            
        dist = float(r["distance_km"]) if r.get("distance_km") else 0
        dur_sec = parse_time_sec(r.get("active_duration", ""))
        
        # Longest distance
        if dist > 0 and (pbs[act]["longest_distance"] is None or dist > pbs[act]["longest_distance"]["dist"]):
            pbs[act]["longest_distance"] = {
                "workout_id": r.get("workout_id"),
                "date": r.get("date"),
                "dist": dist,
                "duration": r.get("active_duration"),
                "pace": r.get("avg_pace")
            }

        # Longest time
        if dur_sec > 0 and (pbs[act]["longest_time"] is None or dur_sec > pbs[act]["longest_time"]["duration_sec"]):
            pbs[act]["longest_time"] = {
                "workout_id": r.get("workout_id"),
                "date": r.get("date"),
                "duration": r.get("active_duration"),
                "duration_sec": dur_sec,
                "dist": dist
            }
            
        # Exclude interval runs for 5K and 10K PBs
        if "间歇跑" in (r.get("training_type") or ""):
            continue

        # 5K
        res5 = find_best_continuous(r, 5)
        if res5 and (pbs[act]["best_5k"] is None or res5["seconds"] < pbs[act]["best_5k"]["duration_sec"]):
            pbs[act]["best_5k"] = {
                "workout_id": r.get("workout_id"),
                "date": r.get("date"),
                "duration_sec": res5["seconds"],
                "duration_formatted": f"{res5['seconds'] // 60}:{res5['seconds'] % 60:02d}",
                "detail": res5
            }

        # 10K
        res10 = find_best_continuous(r, 10)
        if res10 and (pbs[act]["best_10k"] is None or res10["seconds"] < pbs[act]["best_10k"]["duration_sec"]):
            pbs[act]["best_10k"] = {
                "workout_id": r.get("workout_id"),
                "date": r.get("date"),
                "duration_sec": res10["seconds"],
                "duration_formatted": f"{res10['seconds'] // 60}:{res10['seconds'] % 60:02d}",
                "detail": res10
            }

    return pbs


def audit_and_report():
    csv_path = "/Users/nanshi1/Documents/4_github_repos/running-analyzer/data/running_records.csv"
    records = load_dataset(csv_path)
    
    print(f"Total records audited: {len(records)}")
    
    # Missing fields check
    missing_counts = {}
    for r in records:
        for k, v in r.items():
            if v == "" or v is None:
                missing_counts[k] = missing_counts.get(k, 0) + 1
                
    print("\n=== Missing Values Summary (Candidates for User Confirmation/Manual Populate) ===")
    for k in ["distance_km", "active_duration", "avg_pace", "avg_heart_rate", "avg_cadence_spm", "splits_by_km_json", "weather", "temperature_c"]:
        if k in missing_counts:
            print(f"  - {k:25s}: {missing_counts[k]} missing / {len(records)} total")

    pbs = calculate_pbs(records)
    print("\n=== Personal Bests Summary (Outdoor vs Indoor) ===")
    print(json.dumps(pbs, ensure_ascii=False, indent=2))
    
    # Save PB summary to a json file
    pb_file = "/Users/nanshi1/Documents/4_github_repos/running-analyzer/data/personal_bests.json"
    with open(pb_file, "w", encoding="utf-8") as f:
        json.dump(pbs, f, ensure_ascii=False, indent=2)
    print(f"\nSaved PB records to {pb_file}")

if __name__ == "__main__":
    audit_and_report()
