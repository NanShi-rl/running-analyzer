"""Lightweight Python web server & REST API to serve SPA and persist running records to CSV."""

from __future__ import annotations
import csv
import json
import mimetypes
import os
import shutil
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE = os.path.join(WORKSPACE_DIR, "data", "running_records.csv")
WEB_DIR = os.path.join(WORKSPACE_DIR, "web")

# Schema fields in standard order
CSV_COLUMNS = [
    "workout_id", "date", "start_time", "activity_type", "route_name",
    "distance_km", "active_duration", "avg_pace", "avg_heart_rate",
    "max_heart_rate", "vo2_max", "hr_zone_warmup_pct",
    "hr_zone_aerobic_endurance_pct", "hr_zone_aerobic_power_pct",
    "hr_zone_threshold_pct", "hr_zone_anaerobic_pct", "avg_cadence_spm",
    "avg_stride_length_m", "avg_power_watts", "avg_ground_contact_time_ms",
    "max_ground_contact_time_ms", "min_ground_contact_time_ms",
    "avg_flight_time_ms", "max_flight_time_ms", "min_flight_time_ms",
    "avg_vertical_oscillation_cm", "max_vertical_oscillation_cm",
    "min_vertical_oscillation_cm", "elevation_gain_m", "calories_kcal",
    "training_load", "weather", "temperature_c", "records_achieved",
    "notes", "training_type", "splits_by_km_json"
]


def load_all_records() -> list[dict]:
    if not os.path.exists(CSV_FILE):
        return []
    records = []
    with open(CSV_FILE, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Parse splits JSON if valid
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
    return records


def save_all_records(records: list[dict]) -> None:
    # Create backup before overwrite
    backup_file = CSV_FILE + ".bak"
    if os.path.exists(CSV_FILE):
        shutil.copyfile(CSV_FILE, backup_file)
        
    with open(CSV_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for r in records:
            row_to_write = {}
            for col in CSV_COLUMNS:
                if col == "splits_by_km_json":
                    # If splits field exists as list, serialize to json string
                    if "splits" in r and isinstance(r["splits"], list):
                        row_to_write[col] = json.dumps(r["splits"], ensure_ascii=False) if r["splits"] else ""
                    else:
                        row_to_write[col] = r.get("splits_by_km_json", "")
                else:
                    val = r.get(col, "")
                    row_to_write[col] = "" if val is None else str(val)
            writer.writerow(row_to_write)


class RunningServerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def _send_json(self, data: any, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/records":
            records = load_all_records()
            self._send_json({"success": True, "count": len(records), "data": records})
            return

        if path.startswith("/api/records/"):
            workout_id = path.split("/api/records/")[1].strip("/")
            records = load_all_records()
            found = next((r for r in records if r.get("workout_id") == workout_id), None)
            if found:
                self._send_json({"success": True, "data": found})
            else:
                self._send_json({"success": False, "error": "Workout not found"}, status=404)
            return

        if path == "/api/stats":
            records = load_all_records()
            total_dist = sum(float(r["distance_km"]) for r in records if r.get("distance_km"))
            outdoor = sum(1 for r in records if r.get("activity_type") == "户外跑步")
            indoor = sum(1 for r in records if r.get("activity_type") == "室内跑步")
            missing_splits = sum(1 for r in records if not r.get("splits"))
            self._send_json({
                "success": True,
                "data": {
                    "total_workouts": len(records),
                    "total_distance_km": round(total_dist, 2),
                    "outdoor_count": outdoor,
                    "indoor_count": indoor,
                    "missing_splits_count": missing_splits
                }
            })
            return

        # Serve static web files
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len).decode("utf-8")
        try:
            payload = json.loads(post_body) if post_body else {}
        except Exception as e:
            self._send_json({"success": False, "error": f"Invalid JSON payload: {e}"}, status=400)
            return

        records = load_all_records()

        # Update or create record
        if path == "/api/records" or path == "/api/records/update":
            workout_id = payload.get("workout_id")
            if not workout_id:
                self._send_json({"success": False, "error": "workout_id is required"}, status=400)
                return

            updated = False
            for i, r in enumerate(records):
                if r.get("workout_id") == workout_id:
                    # Update fields
                    for k, v in payload.items():
                        if k == "splits":
                            r["splits"] = v
                            r["splits_by_km_json"] = json.dumps(v, ensure_ascii=False) if v else ""
                        elif k in CSV_COLUMNS:
                            r[k] = "" if v is None else str(v)
                    records[i] = r
                    updated = True
                    break

            if not updated:
                # Add as new record
                if "splits" in payload:
                    payload["splits_by_km_json"] = json.dumps(payload["splits"], ensure_ascii=False)
                records.append(payload)

            save_all_records(records)
            self._send_json({"success": True, "message": "Record saved successfully", "workout_id": workout_id})
            return

        # Update splits specifically
        if path.startswith("/api/records/") and path.endswith("/splits"):
            parts = path.strip("/").split("/")
            workout_id = parts[2]
            splits = payload.get("splits", [])
            
            matched = False
            for r in records:
                if r.get("workout_id") == workout_id:
                    r["splits"] = splits
                    r["splits_by_km_json"] = json.dumps(splits, ensure_ascii=False) if splits else ""
                    matched = True
                    break

            if matched:
                save_all_records(records)
                self._send_json({"success": True, "message": "Splits updated successfully", "workout_id": workout_id})
            else:
                self._send_json({"success": False, "error": "Workout not found"}, status=404)
            return

        self._send_json({"success": False, "error": "Endpoint not found"}, status=404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/records/"):
            workout_id = path.split("/api/records/")[1].strip("/")
            if not workout_id:
                self._send_json({"success": False, "error": "workout_id is required"}, status=400)
                return

            records = load_all_records()
            initial_count = len(records)
            records = [r for r in records if r.get("workout_id") != workout_id]

            if len(records) < initial_count:
                save_all_records(records)
                self._send_json({"success": True, "message": "Record deleted successfully", "workout_id": workout_id})
            else:
                self._send_json({"success": False, "error": "Workout not found"}, status=404)
            return

        self._send_json({"success": False, "error": "Endpoint not found"}, status=404)


def run_server(port: int = 8888):
    os.makedirs(WEB_DIR, exist_ok=True)
    server_address = ("", port)
    httpd = ThreadingHTTPServer(server_address, RunningServerHandler)
    print(f"🚀 Running Analyzer SPA Server started at http://localhost:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8888
    run_server(port)
