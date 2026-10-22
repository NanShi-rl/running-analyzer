"""Export running records CSV to JSON format for static deployment (e.g. GitHub Pages)."""

import csv
import json
import os
import sys

WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_FILE = os.path.join(WORKSPACE_DIR, "data", "running_records.csv")
OUTPUT_JSON = os.path.join(WORKSPACE_DIR, "web", "data", "records.json")


def export_records_to_json(csv_path: str = CSV_FILE, output_path: str = OUTPUT_JSON) -> None:
    if not os.path.exists(csv_path):
        print(f"Error: CSV file not found at {csv_path}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    records = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            splits_raw = row.get("splits_by_km_json", "")
            splits = []
            if splits_raw:
                try:
                    splits = json.loads(splits_raw)
                except Exception:
                    splits = []
            row_copy = dict(row)
            row_copy["splits"] = splits
            records.append(row_copy)

    payload = {
        "success": True,
        "count": len(records),
        "data": records
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"Successfully exported {len(records)} records to {output_path}")


if __name__ == "__main__":
    export_records_to_json()
