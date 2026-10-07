import json
import re

with open('/Users/nanshi1/Documents/4_github_repos/running-analyzer/scripts/ocr_dump.json', 'r', encoding='utf-8') as f:
    ocr_data = json.load(f)

for fname in sorted(ocr_data.keys()):
    lines = ocr_data[fname]
    t = lines[0] if lines else ""
    kind = "OTHER"
    text = " ".join(lines)
    if "跑步心率区间" in text: kind = "HR_ZONE"
    elif "分段详情" in text or "5 公里分段详情" in text: kind = "SPLITS"
    elif "运动数据" in text or "Workout Summary" in text or "给自己干爆了" in text: kind = "WORKOUT_MAIN"
    elif "室内跑步" in text or "户外跑步" in text: kind = "WORKOUT_MAIN"
    
    # print summary
    print(f"{fname:15s} | {kind:12s} | Top: {t[:10]:10s} | Lines: {len(lines)}")
