# Running Training Records Analyzer & Manager — Architecture & Enhancement Plan

## 1. Executive Summary & Goals

This project provides an interactive Single Page Application (SPA) designed according to the **IBM Carbon Design System (Carbon Gray 100 / Gray 90 Dark Theme)**, backed by a lightweight Python REST server ([`server.py`](server.py:1)) and a unified CSV data store ([`data/running_records.csv`](data/running_records.csv:1)).

The SPA is organized into two primary tabs:
1. **Tab 1: 📊 训练分析看板 (Analytics Dashboard)** — Front page displaying aggregated KPIs, focused progression charts (Monthly Distance stacked bar chart with total kilometer numbers on top, VO2 Max Breakthrough Trajectory, Separated Pace and Heart Rate Trend Charts, and Heart Rate Zone Time Distribution Pie Chart with percentages), alongside an **Indoor vs Outdoor Best Records** section with interactive progressive milestone history modals and side progression charts (5K, 10K, Longest Distance, Longest Duration calculated from continuous by-km splits and workout summaries, strictly excluding interval runs).
2. **Tab 2: 🏃‍♂️ 训练记录明细与编辑 (Workouts & Split Editor)** — The workout list table, multi-condition search & filtering toolbar, in-place workout metadata editor modal, and the granular By-KM split editor modal with automatic pace/stride computation.

---

## 2. SPA Structure & Navigation Architecture

### 2.1 Tab Navigation
In `web/index.html`, the top header features a tab bar:
- **Tab 1: 📊 训练分析 (Analytics Dashboard)** — Front page default view.
- **Tab 2: 🏃‍♂️ 跑步记录与编辑 (Workouts & Records)** — Detailed workout table and modal editors.

```
+-----------------------------------------------------------------------------------------+
| [🏃 Logo] 跑步训练分析与管理系统      [📊 训练分析]  [🏃‍♂️ 记录管理]     [总跑量: 602km] [导出CSV]  |
+-----------------------------------------------------------------------------------------+
| TAB 1: 📊 训练分析看板 (Analysis Dashboard)                                              |
|                                                                                         |
|  [ 🏆 最佳纪录 Personal Best Records (户外 vs 室内) ]                                   |
|   - 户外: 最快 5K | 最快 10K | 最远距离 | 最长时长 (点击打开突破轨迹列表 + 演进折线图 Modal) |
|   - 室内: 最快 5K | 最快 10K | 最远距离 | 最长时长 (点击打开突破轨迹列表 + 演进折线图 Modal) |
|                                                                                         |
|  [ 📈 核心趋势图表 Visual Analytics ]                                                    |
|   - 1. 月度总跑量堆叠柱状图 (Distance by Month - 柱顶标注合并总跑量数字)                  |
|   - 2. 最大摄氧量突破轨迹图 (VO2 Max Breakthroughs - 仅绘制历史上创新高的突破节点)       |
|   - 3. 心率区间总用时占比分布饼图 (Zone Time Distribution Pie Chart - 标注时长与百分比) |
+-----------------------------------------------------------------------------------------+
| TAB 2: 🏃‍♂️ 记录管理与明细 (Workout Details & Editor)                                      |
|  [ 🔍 搜索与筛选工具栏: 运动类型 / 训练类型 / 待补全状态 / 搜索框 ]                       |
|  [ 📋 跑步记录数据表格: 20+ 项指标展示, 排序, 状态高亮 ]                                 |
|  [ ✏️ 操作: 编辑记录基本信息 Modal | 公里分段 (By-KM) 编辑器 Modal | 删除记录 ]             |
+-----------------------------------------------------------------------------------------+
```

---

## 3. Analysis Dashboard Requirements & Implementation Design

### 3.1 Personal Best Records (最佳纪录看板) & Progressive History
The best records section displays cards categorized by **Outdoor (户外跑步)** and **Indoor (室内跑步)** across 4 core benchmarks:
1. **5K 最快用时 (Best 5K)**
2. **10K 最快用时 (Best 10K)**
3. **最远跑步距离 (Longest Distance)**
4. **最长跑步时长 (Longest Time)**

#### Algorithm for 5K / 10K Best Times:
1. **Exclude Interval Runs (间歇跑排除)**: Workouts categorized under `间歇跑` (interval runs) are strictly excluded from PB evaluations because they contain intermittent recovery pauses.
2. **Continuous Split Window Search**: For non-interval workouts with valid `splits_by_km_json`:
   - Inspect all continuous windows of $N$ splits summing to $\ge 5.0\text{ km}$ or $\ge 10.0\text{ km}$.
   - Sum the durations of the splits in that continuous window. If a workout has 10 x 1km splits, test all sliding windows $i \dots i+k$ that sum to target distance, and find the minimum cumulative time.
3. **Workout Summary Fallback**: If splits are not recorded or missing duration, but the workout distance is within range (e.g. $4.8\text{ km} \le \text{dist} \le 5.4\text{ km}$ or $9.8\text{ km} \le \text{dist} \le 10.5\text{ km}$), use the workout's `active_duration` and `avg_pace`.
3. **Progressive Record Evolution (历史演变轨迹)**:
   - Sort all workouts chronologically by `date` + `start_time`.
   - Iterate through time: a new record entry is recorded whenever a workout surpasses (faster time, further distance, or longer duration) the current standing record at that specific point in time.
4. **Interactive Modal with Side Chart**:
   - Left side: Chronological milestone nodes showing date, previous record vs new record, and margin of improvement.
   - Right side: Dynamic Chart.js line chart showing the visual curve of how the record improved over time.

---

### 3.2 Visual Analytics Charts (基于 Chart.js)

#### 1. 月度总跑量堆叠柱状图 (Distance by Month)
- **Aggregation**: Group workouts by Year-Month (e.g., `2026-06`, `2026-07`, `2026-08`, `2026-09`, `2026-10`).
- **Stacked View**: Stacks **Outdoor Mileage (户外)** and **Indoor Mileage (室内)**.
- **Top Label**: Custom Chart.js plugin draws the exact combined total monthly kilometer number on top of each stacked bar.

#### 2. 最大摄氧量突破轨迹图 (VO2 Max Breakthroughs)
- **Filter**: Chronologically tracks workouts where `vo2_max` is present.
- **Breakthrough Logic**: Only plots data points where VO2 Max reached a new historical high at that point in time (e.g. 40.5 $\to$ 40.7 $\to$ 41.2 $\to$ 41.5 $\to$ 44.0 $\to$ 44.4 $\to$ 44.6 $\to$ 44.9).
- **Features**: Smooth curve highlighting aerobic capacity progression milestones.

#### 3. 心率区间总用时占比分布饼图 (Zone Time Distribution Pie Chart)
- **Time-weighted Calculation**: For each workout with zone percentages and `active_duration`:
  $$\text{Zone Time (minutes)} = \text{Total Active Duration (minutes)} \times \frac{\text{Zone Pct}}{100}$$
- **Visualization**:
  - Interactive Pie Chart dividing cumulative training time across 4 canonical schema categories:
    - Zone 1: 缓和热身 (Warmup ≤130 bpm)
    - Zone 2: 有氧耐力 (Aerobic Endurance 131-150 bpm)
    - Zone 3: 有氧动力 (Aerobic Power 151-163 bpm)
    - Zone 4/Zone 5 (Combined): 乳酸阈值 / 无氧 (Threshold & Anaerobic ≥164 bpm)
  - Color-coded summary cards alongside the chart displaying exact total minutes, total hours, and percentages.

---

## 4. Workout Details & Edit Tab Requirements

### 4.1 Features in Tab 2
- **Search & Filtering**: Real-time filtering across ID, Route, Notes, Records, Activity Type, Training Type, and Missing Fields.
- **Sortable Data Table**: Multi-column sorting (Date, Distance, Duration, Pace, Heart Rate, Cadence, Training Type).
- **Edit Modal**: Update all 37 CSV attributes with validation and auto-calculation of duration/pace.
- **By-KM Split Breakdown Modal**:
  - Add / edit / delete individual kilometer splits.
  - Auto-calculate split pace from duration, and stride length from cadence.
  - Real-time split pace & heart rate mini trend chart.
- **Automatic CSV Synchronization**: Instant POST requests to Python backend (`server.py`) with automatic `.bak` backup generation and UI toast notifications.
