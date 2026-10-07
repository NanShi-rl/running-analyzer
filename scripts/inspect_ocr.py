import json

with open('/Users/nanshi1/Documents/4_github_repos/running-analyzer/scripts/ocr_dump.json', 'r', encoding='utf-8') as f:
    ocr_data = json.load(f)

for fname, lines in ocr_data.items():
    print(f"=== {fname} ===")
    for idx, l in enumerate(lines[:12]):
        print(f"  [{idx}] {l}")
