"""Running analytics and report generator updated for 35-column schema."""

import csv
import json
import os
from typing import Dict, List, Any
from models import parse_pace_to_seconds, parse_duration_to_seconds


def generate_analytics():
    csv_path = "/Users/nanshi1/Documents/4_github_repos/running-analyzer/data/running_records.csv"
    records = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            records.append(r)
            
    # Compute aggregate stats
    total_workouts = len(records)
    total_dist = sum(float(r["distance_km"]) for r in records if r.get("distance_km"))
    
    total_dur_sec = 0
    for r in records:
        if r.get("active_duration"):
            s = parse_duration_to_seconds(r["active_duration"])
            if s: total_dur_sec += s
            
    total_cal = sum(int(r["calories_kcal"]) for r in records if r.get("calories_kcal") and r["calories_kcal"].isdigit())
    
    outdoor_count = sum(1 for r in records if r.get("activity_type") == "户外跑步")
    indoor_count = sum(1 for r in records if r.get("activity_type") == "室内跑步")
    
    hr_list = [int(r["avg_heart_rate"]) for r in records if r.get("avg_heart_rate") and r["avg_heart_rate"].isdigit()]
    cadence_list = [int(r["avg_cadence_spm"]) for r in records if r.get("avg_cadence_spm") and r["avg_cadence_spm"].isdigit()]
    
    stride_list = []
    for r in records:
        if r.get("avg_stride_length_m"):
            try: stride_list.append(float(r["avg_stride_length_m"]))
            except: pass
    
    overall_avg_hr = round(sum(hr_list) / len(hr_list), 1) if hr_list else 0
    overall_avg_cadence = round(sum(cadence_list) / len(cadence_list), 1) if cadence_list else 0
    overall_avg_stride = round(sum(stride_list) / len(stride_list), 2) if stride_list else 0
    
    report_md = f"""# 🏃‍♂️ Running Training Analysis Report

## Summary Overview
- **Total Workouts Analyzed**: {total_workouts} sessions
- **Total Mileage**: {total_dist:.2f} km ({outdoor_count} Outdoor, {indoor_count} Indoor)
- **Total Duration**: {total_dur_sec // 3600}h {(total_dur_sec % 3600) // 60}m {total_dur_sec % 60}s
- **Total Calories Burned**: {total_cal:,} kcal
- **Overall Average Heart Rate**: {overall_avg_hr} bpm
- **Overall Average Cadence**: {overall_avg_cadence} spm
- **Overall Average Stride Length**: {overall_avg_stride} m

---
*Generated automatically by Running Analyzer Pipeline*
"""
    
    report_path = "/Users/nanshi1/Documents/4_github_repos/running-analyzer/analysis/training_report.md"
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report_md)
        
    print(f"Report successfully generated at {report_path}")

if __name__ == "__main__":
    generate_analytics()
