# Running Training Records Analyzer & Manager

An end-to-end running training records management Single Page Application (SPA), data recording pipeline, and analytics dashboard.

---

## Quick Start: Starting the Web Server

The web application and REST backend are self-contained in Python standard libraries (no third-party pip dependencies required to run the server).

### 1. Launch the Server

Run the server script using Python 3:

```bash
python3 server.py 8888
```

> **Note:** If no port argument is specified, it defaults to port `8888`. You can also specify a custom port, for example `python3 server.py 8080`.

### 2. Access the Web Dashboard

Open your browser and navigate to:

```
http://localhost:8888
```

### 3. Stop the Server

Press `Ctrl + C` in the terminal window where the server is running.

---

## Key Features & SPA Two-Tab Structure

The SPA is divided into two primary views accessible via the top navigation bar:

### Tab 1: 📊 训练分析看板 (Analytics Dashboard)
- **Personal Best Records (最佳纪录看板)**:
  - **Outdoor vs. Indoor Segregation**: Dedicated benchmark cards for **户外跑步 (Outdoor)** and **室内跑步 (Indoor)**.
  - **Core Categories**: 5K PB, 10K PB, Longest Distance (最远距离), and Longest Time (最长时长).
  - **Interval Run Exclusion (排除间歇跑)**: All sessions tagged with `间歇跑` are filtered out of PB milestone evaluations due to resting/pauses between repetitions.
  - **Continuous By-KM Breakdown Calculation**: Computes 5K and 10K records by examining continuous sliding windows of kilometer splits (`splits_by_km_json`) within each workout (with automatic fallback to workout totals for runs without granular splits).
  - **Interactive Progressive Milestone History Modal**: Clicking on any record card opens a milestone timeline modal detailing the entire historical progression of that record over time (e.g. 1h15m $\to$ 1h09m $\to$ 1h00m $\to$ 59m44s), dates achieved, margin of improvement, and direct navigation to the corresponding workout record.
- **Analytics Charts**:
  - **Monthly Distance Stacked Bar Chart (月度总跑量趋势)**: Monthly mileage grouped by Year-Month and stacked by Outdoor vs Indoor.
  - **VO2 Max Progression Chart (最大摄氧量进展趋势)**: Filtered progression curve plotting aerobic fitness over time for runs with VO2 Max data.
  - **Separated Pace Trend Chart (平均配速演进趋势)**: Inverted Y-axis pace line chart (higher point = faster pace).
  - **Separated Heart Rate Trend Chart (心率演进趋势)**: Average HR and Max HR curves over time.
  - **Run Zone Distributions by Time Spent (心率区间总用时占比分布)**: Accurately computes actual time spent in each zone ($\text{Active Duration} \times \text{Zone \%}$) across Zone 1 (Warmup), Zone 2 (Aerobic Endurance), Zone 3 (Aerobic Power), and combined Zone 4/Zone 5 (Threshold & Anaerobic) with exact percentages.

### Tab 2: 🏃‍♂️ 记录明细与编辑 (Workouts & Split Editor)
- **Interactive Workout Management**: Search by keywords, filter by activity type, training type, or missing data fields, and sort across any metric column.
- **Bi-Directional CSV Synchronization**: Editing, creating, or deleting workout records immediately persists changes back to [`data/running_records.csv`](data/running_records.csv:1) with automatic `.bak` backup generation.
- **Granular By-KM Split Editor**: Add, edit, or remove per-kilometer splits with automatic pace computation from duration and stride length estimation from cadence. Includes a real-time split pacing and heart rate trend chart.
- **Multi-select Training Types & Notes**: Categorize sessions (轻松跑, 间歇跑, 节奏跑, 渐加速跑, 冲击PB跑) with subjective notes and feedback.

---

## Project Structure

- [`server.py`](server.py:1) - Lightweight HTTP server & REST API (`/api/records`, `/api/stats`, `/api/records/<workout_id>/splits`) using Python standard libraries.
- [`data/running_records.csv`](data/running_records.csv:1) - Primary dataset storing all training records and embedded by-km JSON splits (37-column schema).
- [`running-analyzer-plan.md`](running-analyzer-plan.md:1) - Detailed architecture design and implementation plan specification.
- [`web/`](web/) - Frontend SPA static files:
  - [`web/index.html`](web/index.html:1) - Two-tab dashboard layout, PB milestone cards, analytics chart containers, and modal dialogs.
  - [`web/app.js`](web/app.js:1) - Client application logic, continuous sliding-window PB calculations, progressive history tracking, Chart.js renderers, and CSV synchronization.
  - [`web/style.css`](web/style.css:1) - Modern custom styles, tab active states, PB card hover transitions, and timeline dots.
- [`scripts/`](scripts/) - Data models, validation tools, and OCR/data parsing utilities.
- [`analysis/`](analysis/) - Training report generator and statistical analysis scripts.
