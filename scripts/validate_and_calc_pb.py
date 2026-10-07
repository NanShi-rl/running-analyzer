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


def calculate_pbs(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate personal bests for indoor vs outdoor separately."""
    pbs = {
        "户外跑步": {
            "fastest_pace": None,
            "longest_distance": None,
            "best_5k": None,
            "best_10k": None,
        },
        "室内跑步": {
            "fastest_pace": None,
            "longest_distance": None,
            "best_5k": None,
            "best_10k": None,
        }
    }
    
    for r in records:
        act = r.get("activity_type", "户外跑步")
        if act not in pbs:
            act = "户外跑步"
            
        dist = float(r["distance_km"]) if r.get("distance_km") else None
        pace_sec = int(r["avg_pace_sec"]) if r.get("avg_pace_sec") else None
        dur_sec = int(r["active_duration_sec"]) if r.get("active_duration_sec") else None
        
        if pace_sec and (pbs[act]["fastest_pace"] is None or pace_sec < pbs[act]["fastest_pace"]["pace_sec"]):
            pbs[act]["fastest_pace"] = {
                "workout_id": r["workout_id"],
                "pace": r["avg_pace"],
                "pace_sec": pace_sec,
                "distance_km": dist,
                "source": r["source_files"]
            }
            
        if dist and (pbs[act]["longest_distance"] is None or dist > pbs[act]["longest_distance"]["dist"]):
            pbs[act]["longest_distance"] = {
                "workout_id": r["workout_id"],
                "dist": dist,
                "duration": r["active_duration"],
                "source": r["source_files"]
            }
            
        # 5K candidate (distance between 4.8 and 5.5 km or explicit PB)
        if dist and 4.8 <= dist <= 5.5 and dur_sec:
            if pbs[act]["best_5k"] is None or dur_sec < pbs[act]["best_5k"]["duration_sec"]:
                pbs[act]["best_5k"] = {
                    "workout_id": r["workout_id"],
                    "distance_km": dist,
                    "duration": r["active_duration"],
                    "duration_sec": dur_sec,
                    "pace": r["avg_pace"],
                    "source": r["source_files"]
                }
                
        # 10K candidate (distance between 9.8 and 10.5 km or explicit PB)
        if dist and 9.8 <= dist <= 10.5 and dur_sec:
            if pbs[act]["best_10k"] is None or dur_sec < pbs[act]["best_10k"]["duration_sec"]:
                pbs[act]["best_10k"] = {
                    "workout_id": r["workout_id"],
                    "distance_km": dist,
                    "duration": r["active_duration"],
                    "duration_sec": dur_sec,
                    "pace": r["avg_pace"],
                    "source": r["source_files"]
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
