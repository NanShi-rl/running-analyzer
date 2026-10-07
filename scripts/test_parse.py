import json
import re
import os
import csv
from models import parse_pace_to_seconds, parse_duration_to_seconds, format_seconds_to_pace

with open('/Users/nanshi1/Documents/4_github_repos/running-analyzer/scripts/ocr_dump.json', 'r', encoding='utf-8') as f:
    ocr_data = json.load(f)

print(f"Total screenshots loaded: {len(ocr_data)}")
