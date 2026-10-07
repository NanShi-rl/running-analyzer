import json

with open('/Users/nanshi1/Documents/4_github_repos/running-analyzer/scripts/ocr_dump.json', 'r', encoding='utf-8') as f:
    ocr_data = json.load(f)

for name in ["IMG_4883.PNG", "IMG_4774.JPEG", "IMG_4791.PNG", "IMG_4826.JPEG", "IMG_4822.PNG", "IMG_5080.PNG", "IMG_5029.PNG"]:
    print(f"==================== {name} ====================")
    lines = ocr_data.get(name, [])
    for idx, l in enumerate(lines):
        print(f"{idx:02d}: {l}")
