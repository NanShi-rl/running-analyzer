"""Data models and helper functions for running records matching the updated 35-column schema."""

from __future__ import annotations
import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

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


def parse_pace_to_seconds(pace_str: Optional[str]) -> Optional[int]:
    """Convert pace string like 07'11\", 7:11, 07:11 to seconds per km."""
    if not pace_str:
        return None
    cleaned = str(pace_str).strip().replace("'", ":").replace('"', '').replace('”', '').replace('’', ':')
    match = re.search(r"(\d+):(\d+)", cleaned)
    if match:
        mins = int(match.group(1))
        secs = int(match.group(2))
        return mins * 60 + secs
    return None


def format_seconds_to_pace(seconds: Optional[int]) -> Optional[str]:
    """Convert seconds per km to MM'SS\" format."""
    if seconds is None or seconds <= 0:
        return None
    mins = seconds // 60
    secs = seconds % 60
    return f"{mins:02d}'{secs:02d}\""


def parse_duration_to_seconds(duration_str: Optional[str]) -> Optional[int]:
    """Convert duration string (HH:MM:SS or MM:SS) to total seconds."""
    if not duration_str:
        return None
    parts = [int(p) for p in str(duration_str).strip().split(":") if p.isdigit()]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    elif len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return None


def format_seconds_to_duration(seconds: Optional[int]) -> Optional[str]:
    """Convert seconds to HH:MM:SS format."""
    if seconds is None or seconds < 0:
        return None
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


@dataclass
class KmSplit:
    km: int
    distance_km: float = 1.0
    duration: Optional[str] = None
    avg_pace: Optional[str] = None
    avg_heart_rate: Optional[int] = None
    avg_cadence_spm: Optional[int] = None
    avg_stride_length_m: Optional[float] = None
    avg_power_watts: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items()}


@dataclass
class WorkoutRecord:
    workout_id: str
    date: str
    start_time: str
    activity_type: str = "户外跑步"  # 户外跑步 / 室内跑步
    route_name: Optional[str] = None
    distance_km: Optional[float] = None
    active_duration: Optional[str] = None
    avg_pace: Optional[str] = None
    avg_heart_rate: Optional[int] = None
    max_heart_rate: Optional[int] = None
    vo2_max: Optional[float] = None
    hr_zone_warmup_pct: Optional[float] = None
    hr_zone_aerobic_endurance_pct: Optional[float] = None
    hr_zone_aerobic_power_pct: Optional[float] = None
    hr_zone_threshold_pct: Optional[float] = None
    hr_zone_anaerobic_pct: Optional[float] = None
    avg_cadence_spm: Optional[int] = None
    avg_stride_length_m: Optional[float] = None
    avg_power_watts: Optional[int] = None
    avg_ground_contact_time_ms: Optional[float] = None
    max_ground_contact_time_ms: Optional[float] = None
    min_ground_contact_time_ms: Optional[float] = None
    avg_flight_time_ms: Optional[float] = None
    max_flight_time_ms: Optional[float] = None
    min_flight_time_ms: Optional[float] = None
    avg_vertical_oscillation_cm: Optional[float] = None
    max_vertical_oscillation_cm: Optional[float] = None
    min_vertical_oscillation_cm: Optional[float] = None
    elevation_gain_m: Optional[int] = None
    calories_kcal: Optional[int] = None
    training_load: Optional[int] = None
    weather: Optional[str] = None
    temperature_c: Optional[float] = None
    records_achieved: Optional[str] = None
    notes: Optional[str] = None
    training_type: Optional[str] = None
    splits_by_km_json: Optional[str] = None

    def to_csv_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        result = {}
        for col in CSV_COLUMNS:
            val = data.get(col)
            result[col] = "" if val is None else val
        return result
