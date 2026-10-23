/**
 * Running Analyzer SPA Application Logic
 * Supports Analytics Dashboard (Tab 1) & Workout Management (Tab 2)
 */

let allWorkouts = [];
let currentWorkoutForSplits = null;
let currentSplitsList = [];
let splitChartInstance = null;
let currentActiveTab = "analytics"; // "analytics" or "workouts"

// Analytics Chart instances
let monthlyDistanceChart = null;
let vo2MaxProgressionChart = null;
let zoneDistributionChart = null;
let pbHistoryChartInstance = null;

// PB Records cache & history
let pbRecordsMap = {};

// Sorting state
let currentSortColumn = "date";
let currentSortDirection = "desc"; // "asc" or "desc"

// CSV schema column definition
const CSV_COLUMNS = [
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
];

// GitHub Sync configuration keys
const GITHUB_TOKEN_KEY = "running_analyzer_gh_token";
const GITHUB_REPO_KEY = "running_analyzer_gh_repo"; // e.g. "username/running-analyzer"
const GITHUB_BRANCH_KEY = "running_analyzer_gh_branch"; // default "main"

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  fetchData();
  setupEventListeners();
  updateGitHubSyncStatusUI();
});

function setupEventListeners() {
  document.getElementById("search-input").addEventListener("input", filterAndRenderTable);
  document.getElementById("filter-activity").addEventListener("change", filterAndRenderTable);
  document.getElementById("filter-training-type").addEventListener("change", filterAndRenderTable);
  document.getElementById("filter-missing").addEventListener("change", filterAndRenderTable);

  // Auto-calculate pace in Workout Modal when distance or duration changes
  document.getElementById("field-distance").addEventListener("input", autoCalcWorkoutPace);
  document.getElementById("field-duration").addEventListener("input", autoCalcWorkoutPace);
}

// Switch between Analytics Dashboard and Workouts Table
function switchTab(tabName) {
  currentActiveTab = tabName;
  const btnAnalytics = document.getElementById("tab-btn-analytics");
  const btnWorkouts = document.getElementById("tab-btn-workouts");
  const viewAnalytics = document.getElementById("view-analytics");
  const viewWorkouts = document.getElementById("view-workouts");

  if (tabName === "analytics") {
    btnAnalytics.className = "tab-btn active px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all text-white bg-indigo-600 shadow-sm";
    btnWorkouts.className = "tab-btn px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all text-slate-400 hover:text-slate-200";
    viewAnalytics.classList.remove("hidden");
    viewWorkouts.classList.add("hidden");
    renderAllAnalyticsCharts();
  } else {
    btnWorkouts.className = "tab-btn active px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all text-white bg-indigo-600 shadow-sm";
    btnAnalytics.className = "tab-btn px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all text-slate-400 hover:text-slate-200";
    viewWorkouts.classList.remove("hidden");
    viewAnalytics.classList.add("hidden");
    filterAndRenderTable();
  }
}

function autoCalcWorkoutPace() {
  const distVal = parseFloat(document.getElementById("field-distance").value);
  const durStr = document.getElementById("field-duration").value;
  const durSec = timeStringToSeconds(durStr);
  const paceInput = document.getElementById("field-pace");

  if (distVal && distVal > 0 && durSec && durSec > 0) {
    const paceSecPerKm = Math.round(durSec / distVal);
    const paceMin = Math.floor(paceSecPerKm / 60);
    const paceRemSec = paceSecPerKm % 60;
    paceInput.value = `${String(paceMin).padStart(2, '0')}'${String(paceRemSec).padStart(2, '0')}"`;
  }
}

// Fetch all records & stats from API (with static fallback for GitHub Pages)
async function fetchData() {
  try {
    let res = null;
    // 1. Try local backend server API first
    try {
      res = await fetch("/api/records");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (apiErr) {
      // 2. If API is not available (e.g. GitHub Pages / static hosting), fall back to static data/records.json
      // Append cache buster timestamp to prevent browser from serving stale cached JSON
      res = await fetch(`data/records.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`Static data load failed: HTTP ${res.status}`);
    }

    const json = await res.json();
    if (json.success) {
      allWorkouts = json.data;
      updateHeaderKPIs();
      computeAllPersonalBests();
      if (currentActiveTab === "analytics") {
        renderAllAnalyticsCharts();
      } else {
        filterAndRenderTable();
      }
    } else {
      showToast("获取数据失败: " + json.error, "error");
    }
  } catch (err) {
    console.error("Fetch error:", err);
    showToast("无法加载跑步数据，请确认后端已启动或静态数据已生成", "error");
  }
}

// Helper: parse duration or pace string into total seconds
function timeStringToSeconds(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/"/g, '').replace(/”/g, '').replace(/’/g, ':').replace(/'/g, ':');
  const parts = cleaned.split(':').map(p => parseInt(p, 10)).filter(n => !isNaN(n));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

// Helper: format seconds to HH:MM:SS or MM:SS
function secondsToTimeString(sec, alwaysShowHours = false) {
  if (!sec || isNaN(sec) || sec <= 0) return "--:--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0 || alwaysShowHours) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Helper: format seconds to pace string MM'SS"
function secondsToPaceString(sec) {
  if (!sec || isNaN(sec) || sec <= 0) return "--'--\"";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`;
}

// Compute and render top header KPIs
function updateHeaderKPIs() {
  let totalDist = 0;
  let outdoorCount = 0;
  let indoorCount = 0;
  let totalCadence = 0;
  let cadenceCount = 0;
  let totalHr = 0;
  let hrCount = 0;
  let missingSplitsCount = 0;

  // Find latest VO2 Max
  const sortedByDate = [...allWorkouts].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  let latestVo2 = "--";
  for (let i = sortedByDate.length - 1; i >= 0; i--) {
    const v = parseFloat(sortedByDate[i].vo2_max);
    if (!isNaN(v) && v > 0) {
      latestVo2 = v.toFixed(1);
      break;
    }
  }

  allWorkouts.forEach(w => {
    const d = parseFloat(w.distance_km);
    if (!isNaN(d)) totalDist += d;
    if (w.activity_type === "户外跑步") outdoorCount++;
    else if (w.activity_type === "室内跑步") indoorCount++;

    const cad = parseInt(w.avg_cadence_spm);
    if (!isNaN(cad) && cad > 0) {
      totalCadence += cad;
      cadenceCount++;
    }

    const hr = parseInt(w.avg_heart_rate);
    if (!isNaN(hr) && hr > 0) {
      totalHr += hr;
      hrCount++;
    }

    if (!w.splits || w.splits.length === 0) {
      missingSplitsCount++;
    }
  });

  const avgCad = cadenceCount ? Math.round(totalCadence / cadenceCount) : "--";
  const avgHr = hrCount ? Math.round(totalHr / hrCount) : "--";

  document.getElementById("nav-total-dist").textContent = `${totalDist.toFixed(1)} km`;
  document.getElementById("nav-total-count").textContent = `${allWorkouts.length} 次`;

  document.getElementById("stat-distance").textContent = `${totalDist.toFixed(2)} km`;
  document.getElementById("stat-split-type").textContent = `户外: ${outdoorCount} · 室内: ${indoorCount}`;

  document.getElementById("stat-count").textContent = `${allWorkouts.length} 次`;
  document.getElementById("stat-missing-splits").textContent = `待补全分段: ${missingSplitsCount} 次`;

  document.getElementById("stat-latest-vo2max").textContent = latestVo2;
  document.getElementById("stat-avg-cadence").textContent = `${avgCad} spm`;
  document.getElementById("stat-avg-hr").textContent = `平均心率: ${avgHr} bpm`;
}

// ==============================================================
// BEST RECORDS & PROGRESSIVE MILESTONE HISTORY COMPUTATION
// ==============================================================

/**
 * Calculates Best 5K, 10K, Longest Distance, Longest Time
 * for both Outdoor and Indoor workouts.
 * Uses continuous By-KM split segment sliding windows where available,
 * and maintains the complete progressive milestone history over time.
 */
function computeAllPersonalBests() {
  // Sort chronological by date + start_time
  const sortedWorkouts = [...allWorkouts].sort((a, b) => {
    const da = `${a.date || ''} ${a.start_time || ''}`;
    const db = `${b.date || ''} ${b.start_time || ''}`;
    return da.localeCompare(db);
  });

  const categories = [
    { key: "outdoor_5k", type: "time_min", targetDist: 5, activity: "户外跑步", name: "最快 5K 成绩 (户外)" },
    { key: "outdoor_10k", type: "time_min", targetDist: 10, activity: "户外跑步", name: "最快 10K 成绩 (户外)" },
    { key: "outdoor_dist", type: "dist_max", activity: "户外跑步", name: "最远跑步距离 (户外)" },
    { key: "outdoor_time", type: "time_max", activity: "户外跑步", name: "最长跑步时长 (户外)" },
    { key: "indoor_5k", type: "time_min", targetDist: 5, activity: "室内跑步", name: "最快 5K 成绩 (室内)" },
    { key: "indoor_10k", type: "time_min", targetDist: 10, activity: "室内跑步", name: "最快 10K 成绩 (室内)" },
    { key: "indoor_dist", type: "dist_max", activity: "室内跑步", name: "最远跑步距离 (室内)" },
    { key: "indoor_time", type: "time_max", activity: "室内跑步", name: "最长跑步时长 (室内)" },
  ];

  pbRecordsMap = {};

  categories.forEach(cat => {
    // Exclude '间歇跑' (Interval runs) from PB calculations as they contain intermittent pauses
    const filteredWorkouts = sortedWorkouts.filter(w => {
      const isActivityMatch = (w.activity_type || "户外跑步") === cat.activity;
      const isIntervalRun = (w.training_type || "").includes("间歇跑");
      return isActivityMatch && !isIntervalRun;
    });
    const history = [];
    let currentBest = null;

    filteredWorkouts.forEach(w => {
      let recordCandidate = null;

      if (cat.type === "time_min") {
        // Find best continuous window of targetDist (5 or 10 km)
        const bestContinuous = findBestContinuousTime(w, cat.targetDist);
        if (bestContinuous) {
          recordCandidate = {
            val: bestContinuous.seconds,
            displayVal: secondsToTimeString(bestContinuous.seconds),
            detail: bestContinuous.isFromSplits 
              ? `第 ${bestContinuous.startKm} 至 ${bestContinuous.endKm} 公里连续分段用时 (配速: ${secondsToPaceString(Math.round(bestContinuous.seconds / cat.targetDist))})`
              : `单次全程用时 (总里程: ${bestContinuous.distance} km, 配速: ${w.avg_pace || '--'})`,
            workout: w,
            date: w.date,
            isFromSplits: bestContinuous.isFromSplits
          };
        }
      } else if (cat.type === "dist_max") {
        const d = parseFloat(w.distance_km);
        if (!isNaN(d) && d > 0) {
          recordCandidate = {
            val: d,
            displayVal: `${d.toFixed(2)} km`,
            detail: `用时: ${w.active_duration || '--'} · 平均配速: ${w.avg_pace || '--'} · 路线: ${w.route_name || '--'}`,
            workout: w,
            date: w.date
          };
        }
      } else if (cat.type === "time_max") {
        const s = timeStringToSeconds(w.active_duration);
        if (s > 0) {
          recordCandidate = {
            val: s,
            displayVal: secondsToTimeString(s, true),
            detail: `距离: ${w.distance_km || '--'} km · 平均配速: ${w.avg_pace || '--'} · 消耗: ${w.calories_kcal || '--'} kcal`,
            workout: w,
            date: w.date
          };
        }
      }

      if (recordCandidate) {
        let isNewRecord = false;
        let improvement = null;

        if (currentBest === null) {
          isNewRecord = true;
          improvement = "首个基准纪录";
        } else if (cat.type === "time_min" && recordCandidate.val < currentBest.val) {
          isNewRecord = true;
          const diffSec = currentBest.val - recordCandidate.val;
          const diffStr = secondsToTimeString(diffSec);
          improvement = `提升 ${diffStr} (原纪录: ${currentBest.displayVal})`;
        } else if (cat.type === "dist_max" && recordCandidate.val > currentBest.val) {
          isNewRecord = true;
          const diffKm = (recordCandidate.val - currentBest.val).toFixed(2);
          improvement = `增加 +${diffKm} km (原纪录: ${currentBest.displayVal})`;
        } else if (cat.type === "time_max" && recordCandidate.val > currentBest.val) {
          isNewRecord = true;
          const diffSec = recordCandidate.val - currentBest.val;
          const diffStr = secondsToTimeString(diffSec);
          improvement = `延长 +${diffStr} (原纪录: ${currentBest.displayVal})`;
        }

        if (isNewRecord) {
          currentBest = recordCandidate;
          history.push({
            date: recordCandidate.date,
            time: recordCandidate.workout.start_time,
            workoutId: recordCandidate.workout.workout_id,
            displayVal: recordCandidate.displayVal,
            val: recordCandidate.val,
            detail: recordCandidate.detail,
            improvement: improvement,
            workout: recordCandidate.workout
          });
        }
      }
    });

    pbRecordsMap[cat.key] = {
      meta: cat,
      currentBest: currentBest,
      history: history
    };
  });

  updatePbCardsUI();
}

/**
 * Searches continuous By-KM split windows summing to targetDist km (e.g. 5 or 10).
 * If granular split durations are not available, falls back to workout total
 * if total distance is within [targetDist - 0.25, targetDist + 0.55].
 */
function findBestContinuousTime(workout, targetDist) {
  const splits = workout.splits || [];
  const validSplits = splits.filter(s => s && timeStringToSeconds(s.duration) > 0);

  // If we have enough valid consecutive 1km splits
  if (validSplits.length >= targetDist) {
    let minTimeSec = Infinity;
    let bestStart = 1;
    let bestEnd = targetDist;

    for (let i = 0; i <= validSplits.length - targetDist; i++) {
      let windowSumSec = 0;
      let windowDist = 0;
      for (let j = 0; j < targetDist; j++) {
        const splitObj = validSplits[i + j];
        windowSumSec += timeStringToSeconds(splitObj.duration);
        windowDist += parseFloat(splitObj.distance_km || 1);
      }

      if (windowDist >= targetDist * 0.98 && windowSumSec < minTimeSec) {
        minTimeSec = windowSumSec;
        bestStart = validSplits[i].km || (i + 1);
        bestEnd = validSplits[i + targetDist - 1].km || (i + targetDist);
      }
    }

    if (minTimeSec !== Infinity && minTimeSec > 0) {
      return {
        seconds: minTimeSec,
        isFromSplits: true,
        startKm: bestStart,
        endKm: bestEnd,
        distance: targetDist
      };
    }
  }

  // Fallback: Check if the entire workout duration qualifies
  const totalDist = parseFloat(workout.distance_km);
  const totalDurSec = timeStringToSeconds(workout.active_duration);

  if (!isNaN(totalDist) && totalDist >= targetDist * 0.96 && totalDist <= targetDist * 1.08 && totalDurSec > 0) {
    // Exact or normalized segment time
    const adjustedSec = totalDist >= targetDist 
      ? Math.round(totalDurSec * (targetDist / totalDist))
      : totalDurSec;

    return {
      seconds: adjustedSec,
      isFromSplits: false,
      distance: totalDist.toFixed(2)
    };
  }

  return null;
}

// Update the 8 PB cards in the DOM
function updatePbCardsUI() {
  const cardMappings = [
    { key: "outdoor_5k", valEl: "pb-val-outdoor-5k", metaEl: "pb-meta-outdoor-5k", countEl: "pb-count-outdoor-5k" },
    { key: "outdoor_10k", valEl: "pb-val-outdoor-10k", metaEl: "pb-meta-outdoor-10k", countEl: "pb-count-outdoor-10k" },
    { key: "outdoor_dist", valEl: "pb-val-outdoor-dist", metaEl: "pb-meta-outdoor-dist", countEl: "pb-count-outdoor-dist" },
    { key: "outdoor_time", valEl: "pb-val-outdoor-time", metaEl: "pb-meta-outdoor-time", countEl: "pb-count-outdoor-time" },
    { key: "indoor_5k", valEl: "pb-val-indoor-5k", metaEl: "pb-meta-indoor-5k", countEl: "pb-count-indoor-5k" },
    { key: "indoor_10k", valEl: "pb-val-indoor-10k", metaEl: "pb-meta-indoor-10k", countEl: "pb-count-indoor-10k" },
    { key: "indoor_dist", valEl: "pb-val-indoor-dist", metaEl: "pb-meta-indoor-dist", countEl: "pb-count-indoor-dist" },
    { key: "indoor_time", valEl: "pb-val-indoor-time", metaEl: "pb-meta-indoor-time", countEl: "pb-count-indoor-time" },
  ];

  cardMappings.forEach(m => {
    const data = pbRecordsMap[m.key];
    const valEl = document.getElementById(m.valEl);
    const metaEl = document.getElementById(m.metaEl);
    const countEl = document.getElementById(m.countEl);

    if (!valEl || !metaEl || !countEl) return;

    if (data && data.currentBest) {
      valEl.textContent = data.currentBest.displayVal;
      metaEl.textContent = `达成日期: ${data.currentBest.date} · ${data.currentBest.workout.route_name || data.currentBest.workout.activity_type}`;
      countEl.textContent = `共 ${data.history.length} 次突破`;
    } else {
      valEl.textContent = "--";
      metaEl.textContent = "暂无匹配纪录";
      countEl.textContent = "0 次记录";
    }
  });
}

// Open PB Breakthrough History Modal
function openPbHistoryModal(recordKey) {
  const data = pbRecordsMap[recordKey];
  if (!data) return;

  const modal = document.getElementById("modal-pb-history");
  const title = document.getElementById("pb-modal-title");
  const subtitle = document.getElementById("pb-modal-subtitle");
  const timelineList = document.getElementById("pb-timeline-list");
  const summary = document.getElementById("pb-modal-summary");

  title.textContent = `🏆 ${data.meta.name} · 突破历史`;
  subtitle.textContent = `${data.meta.activity} · 历次刷新里程碑记录与演变轨迹 (共 ${data.history.length} 次)`;

  if (!data.history || data.history.length === 0) {
    timelineList.innerHTML = `<div class="text-slate-500 py-6 text-center text-xs">暂无该项历史纪录</div>`;
    summary.textContent = "暂无达成纪录";
    if (pbHistoryChartInstance) pbHistoryChartInstance.destroy();
  } else {
    summary.textContent = `当前最高个人纪录于 ${data.currentBest.date} 达成 (${data.currentBest.displayVal})`;
    
    // Render timeline in reverse chronological order (newest on top)
    const itemsHtml = data.history.map((item, idx) => {
      const isLatest = idx === data.history.length - 1;
      const dotColor = isLatest ? "bg-amber-400 ring-4 ring-amber-400/20" : "bg-slate-500";
      const badgeBg = isLatest ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-slate-800 text-slate-400 border-slate-700";

      return `
        <div class="relative pb-4">
          <div class="timeline-dot ${dotColor}"></div>
          <div class="bg-slate-900/90 border ${isLatest ? 'border-amber-500/50 shadow-lg shadow-amber-950/20' : 'border-slate-800'} rounded-xl p-3 space-y-1.5 transition-all text-xs">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="font-bold ${isLatest ? 'text-amber-300' : 'text-white'}">${item.displayVal}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full border ${badgeBg} font-medium">
                  ${isLatest ? '👑 当前PB' : `第 ${idx + 1} 次突破`}
                </span>
              </div>
              <span class="text-[11px] text-slate-400">${item.date}</span>
            </div>
            
            <p class="text-[11px] text-slate-300 truncate" title="${item.detail}">${item.detail}</p>
            
            <div class="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
              <span class="text-emerald-400 font-medium">${item.improvement}</span>
              <button onclick="closePbHistoryModal(); switchTab('workouts'); openWorkoutModal('${item.workoutId}');" class="text-indigo-400 hover:text-indigo-300 underline font-medium">
                #${item.workoutId} →
              </button>
            </div>
          </div>
        </div>
      `;
    }).reverse().join("");

    timelineList.innerHTML = itemsHtml;

    // Render Side Chart in PB modal
    renderPbHistorySideChart(data);
  }

  modal.classList.remove("hidden");
}

function closePbHistoryModal() {
  document.getElementById("modal-pb-history").classList.add("hidden");
  if (pbHistoryChartInstance) {
    pbHistoryChartInstance.destroy();
    pbHistoryChartInstance = null;
  }
}

/**
 * Render Side Line Chart inside PB Breakthrough History Modal
 */
function renderPbHistorySideChart(data) {
  const canvas = document.getElementById("chart-pb-progression");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const unitBadge = document.getElementById("pb-chart-unit-badge");

  if (pbHistoryChartInstance) {
    pbHistoryChartInstance.destroy();
  }

  const isTimeMin = data.meta.type === "time_min";
  const isTimeMax = data.meta.type === "time_max";
  const isDistMax = data.meta.type === "dist_max";

  if (unitBadge) {
    unitBadge.textContent = (isTimeMin || isTimeMax) ? "用时 (MM:SS 或 HH:MM:SS)" : "里程 (公里 km)";
  }

  const labels = data.history.map(item => item.date);
  const chartValues = data.history.map(item => item.val);

  pbHistoryChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: data.meta.name,
          data: chartValues,
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.15)",
          pointBackgroundColor: "#fbbf24",
          pointBorderColor: "#ffffff",
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBorderWidth: 2,
          fill: true,
          tension: 0.2,
          borderWidth: 2.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: "rgba(51, 65, 85, 0.4)" },
          ticks: { color: "#94a3b8", font: { size: 10 }, maxRotation: 45 }
        },
        y: {
          reverse: isTimeMin, // Faster time is higher up!
          grid: { color: "rgba(51, 65, 85, 0.4)" },
          ticks: {
            color: "#94a3b8",
            font: { size: 10 },
            callback: (val) => {
              if (isTimeMin || isTimeMax) {
                return secondsToTimeString(val);
              }
              return `${val} km`;
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const histItem = data.history[item.dataIndex];
              return `突破纪录: ${histItem.displayVal}`;
            },
            afterLabel: (item) => {
              const histItem = data.history[item.dataIndex];
              return `节点提升: ${histItem.improvement}\n训练 ID: ${histItem.workoutId}`;
            }
          }
        }
      }
    }
  });
}

// ==============================================================
// ANALYTICS CHARTS RENDERING (Chart.js)
// ==============================================================

function renderAllAnalyticsCharts() {
  renderMonthlyDistanceChart();
  renderVo2MaxProgressionChart();
  renderZoneDistributionChart();
}

/**
 * Custom Chart.js Plugin to draw combined total distance label on top of stacked bar chart
 */
const stackedTotalPlugin = {
  id: "stackedTotalLabels",
  afterDatasetsDraw(chart) {
    if (chart.config.type !== "bar") return;
    const { ctx, scales: { x, y } } = chart;
    
    // Find the bar datasets to compute bar sum
    const barDatasets = chart.data.datasets.filter(d => (d.type || chart.config.type) === "bar");
    if (barDatasets.length === 0) return;

    // Use the meta of the first bar dataset for horizontal X positioning
    const metaBar = chart.getDatasetMeta(0);
    if (!metaBar || !metaBar.data) return;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#ffffff";

    chart.data.labels.forEach((label, index) => {
      let totalDist = 0;
      barDatasets.forEach(dataset => {
        totalDist += (dataset.data[index] || 0);
      });

      if (totalDist > 0 && metaBar.data[index]) {
        const xPos = metaBar.data[index].x;
        const yPos = y.getPixelForValue(totalDist);
        ctx.fillText(`${totalDist.toFixed(1)} km`, xPos, yPos - 5);
      }
    });

    ctx.restore();
  }
};

/**
 * 1. Monthly Distance Stacked Bar Chart with Combined Total on Top & Average Pace Line
 */
function renderMonthlyDistanceChart() {
  const canvas = document.getElementById("chart-monthly-distance");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Group distance & duration by Month (YYYY-MM)
  const monthMap = {};
  allWorkouts.forEach(w => {
    if (!w.date) return;
    const month = w.date.substring(0, 7); // "2026-06"
    if (!monthMap[month]) {
      monthMap[month] = { outdoor: 0, indoor: 0, total: 0, durationSec: 0, distForPace: 0 };
    }
    const dist = parseFloat(w.distance_km) || 0;
    if (w.activity_type === "室内跑步") {
      monthMap[month].indoor += dist;
    } else {
      monthMap[month].outdoor += dist;
    }
    monthMap[month].total += dist;

    // Duration in seconds for calculating distance-weighted average pace
    const durSec = timeStringToSeconds(w.active_duration);
    if (durSec > 0 && dist > 0) {
      monthMap[month].durationSec += durSec;
      monthMap[month].distForPace += dist;
    } else if (w.avg_pace && dist > 0) {
      const paceSec = timeStringToSeconds(w.avg_pace);
      if (paceSec > 0) {
        monthMap[month].durationSec += paceSec * dist;
        monthMap[month].distForPace += dist;
      }
    }
  });

  const sortedMonths = Object.keys(monthMap).sort();
  const outdoorData = sortedMonths.map(m => parseFloat(monthMap[m].outdoor.toFixed(1)));
  const indoorData = sortedMonths.map(m => parseFloat(monthMap[m].indoor.toFixed(1)));

  // Calculate distance-weighted average pace (seconds per km) for each month
  const paceSecondsData = sortedMonths.map(m => {
    const item = monthMap[m];
    if (item.distForPace > 0 && item.durationSec > 0) {
      return Math.round(item.durationSec / item.distForPace);
    }
    return null;
  });

  // Calculate min/max pace seconds for setting inverted y-axis bounds
  const validPaceSecs = paceSecondsData.filter(p => p !== null && p > 0);
  const minPaceSec = validPaceSecs.length > 0 ? Math.min(...validPaceSecs) : 300;
  const maxPaceSec = validPaceSecs.length > 0 ? Math.max(...validPaceSecs) : 600;

  // Calculate highest monthly total to set reasonable y-axis headroom for labels
  const maxMonthlyTotal = Math.max(...sortedMonths.map(m => monthMap[m].total), 0);

  if (monthlyDistanceChart) monthlyDistanceChart.destroy();

  monthlyDistanceChart = new Chart(ctx, {
    type: "bar",
    plugins: [stackedTotalPlugin],
    data: {
      labels: sortedMonths,
      datasets: [
        {
          type: "line",
          label: "平均配速 (min/km)",
          data: paceSecondsData,
          yAxisID: "yPace",
          borderColor: "#f1c21b",
          backgroundColor: "#f1c21b",
          borderWidth: 2.5,
          pointBackgroundColor: "#f1c21b",
          pointBorderColor: "#161616",
          pointBorderWidth: 2,
          pointRadius: 4.5,
          pointHoverRadius: 6.5,
          tension: 0.25,
          order: 1
        },
        {
          type: "bar",
          label: "户外跑步 (km)",
          data: outdoorData,
          yAxisID: "y",
          backgroundColor: "rgba(16, 185, 129, 0.8)",
          borderColor: "#10b981",
          borderWidth: 1,
          borderRadius: 4,
          stack: "distanceStack",
          order: 2
        },
        {
          type: "bar",
          label: "室内跑步 (km)",
          data: indoorData,
          yAxisID: "y",
          backgroundColor: "rgba(99, 102, 241, 0.8)",
          borderColor: "#6366f1",
          borderWidth: 1,
          borderRadius: 4,
          stack: "distanceStack",
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 20 }
      },
      scales: {
        x: {
          grid: { color: "rgba(51, 65, 85, 0.4)" },
          ticks: { color: "#94a3b8", font: { size: 11 } }
        },
        y: {
          type: "linear",
          position: "left",
          stacked: true,
          beginAtZero: true,
          suggestedMax: maxMonthlyTotal * 1.15,
          grid: { color: "rgba(51, 65, 85, 0.4)" },
          ticks: {
            color: "#94a3b8",
            font: { size: 11 },
            callback: (val) => `${val} km`
          },
          title: {
            display: true,
            text: "跑量 (km)",
            color: "#94a3b8",
            font: { size: 11 }
          }
        },
        yPace: {
          type: "linear",
          position: "right",
          reverse: true, // Inverted: faster pace (lower seconds) is higher up
          min: Math.max(240, Math.floor((minPaceSec - 45) / 30) * 30),
          max: Math.ceil((maxPaceSec + 45) / 30) * 30,
          grid: { drawOnChartArea: false }, // Avoid cluttering grid lines
          ticks: {
            color: "#f1c21b",
            font: { size: 11 },
            callback: (val) => secondsToPaceString(val)
          },
          title: {
            display: true,
            text: "平均配速",
            color: "#f1c21b",
            font: { size: 11 }
          }
        }
      },
      plugins: {
        legend: {
          labels: { color: "#cbd5e1", font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              if (item.dataset.type === "line") {
                const paceStr = item.raw ? secondsToPaceString(item.raw) : "--";
                return `月度平均配速: ${paceStr} /km`;
              }
              return `${item.dataset.label}: ${item.raw} km`;
            },
            footer: (items) => {
              const barItems = items.filter(it => it.dataset.type === "bar");
              if (barItems.length > 0) {
                const total = barItems.reduce((acc, curr) => acc + curr.raw, 0);
                return `月度合并总跑量: ${total.toFixed(1)} km`;
              }
              return "";
            }
          }
        }
      }
    }
  });
}

/**
 * 2. VO2 Max Progression Chart (Breakthrough Milestones Only)
 * Only plots the points in time where VO2 Max reached a new historical record!
 */
function renderVo2MaxProgressionChart() {
  const canvas = document.getElementById("chart-vo2max-progression");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Chronologically sorted workouts with valid VO2 max
  const sortedVo2Runs = allWorkouts
    .filter(w => {
      const v = parseFloat(w.vo2_max);
      return !isNaN(v) && v > 0;
    })
    .sort((a, b) => {
      const da = `${a.date || ''} ${a.start_time || ''}`;
      const db = `${b.date || ''} ${b.start_time || ''}`;
      return da.localeCompare(db);
    });

  // Extract breakthrough points only (best at that point in time)
  const breakthroughs = [];
  let currentMaxVo2 = 0;

  sortedVo2Runs.forEach(w => {
    const v = parseFloat(w.vo2_max);
    if (v > currentMaxVo2) {
      currentMaxVo2 = v;
      breakthroughs.push({
        date: w.date,
        vo2: v,
        workout: w
      });
    }
  });

  const labels = breakthroughs.map(b => b.date);
  const data = breakthroughs.map(b => b.vo2);

  if (vo2MaxProgressionChart) vo2MaxProgressionChart.destroy();

  vo2MaxProgressionChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "最大摄氧量新高 (VO2 Max ml/kg/min)",
          data: data,
          borderColor: "#a855f7",
          backgroundColor: "rgba(168, 85, 247, 0.2)",
          pointBackgroundColor: "#c084fc",
          pointBorderColor: "#ffffff",
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBorderWidth: 2,
          fill: true,
          tension: 0.25,
          borderWidth: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: "rgba(51, 65, 85, 0.4)" },
          ticks: { color: "#94a3b8", font: { size: 11 }, maxRotation: 30 }
        },
        y: {
          suggestedMin: 38,
          suggestedMax: 48,
          grid: { color: "rgba(51, 65, 85, 0.4)" },
          ticks: { color: "#94a3b8", font: { size: 11 } }
        }
      },
      plugins: {
        legend: {
          labels: { color: "#cbd5e1", font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (item) => `新高突破: ${item.raw} ml/kg/min`,
            afterLabel: (item) => {
              const b = breakthroughs[item.dataIndex];
              return `达成日期: ${b.date}\n训练 ID: ${b.workout.workout_id} (${b.workout.activity_type})\n距离: ${b.workout.distance_km} km · 配速: ${b.workout.avg_pace || '--'}`;
            }
          }
        }
      }
    }
  });
}

/**
 * 3. Run Zone Distributions by Time Spent (Pie Chart with Percentages & Legend Cards)
 * Compares cumulative duration in minutes spent across Zone 1 to Zone 5
 */
function renderZoneDistributionChart() {
  const canvas = document.getElementById("chart-zone-distribution");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Filter workouts that have zone info & valid active_duration
  const validZoneWorkouts = allWorkouts.filter(w => {
    const hasWarmup = w.hr_zone_warmup_pct !== "" && w.hr_zone_warmup_pct !== null && w.hr_zone_warmup_pct !== undefined;
    const hasAero = w.hr_zone_aerobic_endurance_pct !== "" && w.hr_zone_aerobic_endurance_pct !== null && w.hr_zone_aerobic_endurance_pct !== undefined;
    const durSec = timeStringToSeconds(w.active_duration);
    return (hasWarmup || hasAero) && durSec > 0;
  });

  const statsBadge = document.getElementById("zone-chart-stats-badge");
  if (statsBadge) {
    statsBadge.textContent = `${validZoneWorkouts.length} 次有效心率区间记录`;
  }

  // Calculate total time in minutes for each zone across all workouts
  // Combine Z4 & Z5 (Threshold + Anaerobic) as modeled in schema
  let totalMinWarmup = 0;
  let totalMinZone2 = 0;
  let totalMinZone3 = 0;
  let totalMinZone4_5 = 0;

  validZoneWorkouts.forEach(w => {
    const durMin = timeStringToSeconds(w.active_duration) / 60.0;
    const wWarmup = parseFloat(w.hr_zone_warmup_pct) || 0;
    const wZ2 = parseFloat(w.hr_zone_aerobic_endurance_pct) || 0;
    const wZ3 = parseFloat(w.hr_zone_aerobic_power_pct) || 0;
    // Both Z4 and Z5 percentages are summed into Z4/5
    const wZ4 = parseFloat(w.hr_zone_threshold_pct) || 0;
    const wZ5 = parseFloat(w.hr_zone_anaerobic_pct) || 0;

    totalMinWarmup += durMin * (wWarmup / 100);
    totalMinZone2 += durMin * (wZ2 / 100);
    totalMinZone3 += durMin * (wZ3 / 100);
    totalMinZone4_5 += durMin * ((wZ4 + wZ5) / 100);
  });

  const totalAllZonesMin = totalMinWarmup + totalMinZone2 + totalMinZone3 + totalMinZone4_5;

  const zoneDataMinutes = [
    Math.round(totalMinWarmup),
    Math.round(totalMinZone2),
    Math.round(totalMinZone3),
    Math.round(totalMinZone4_5)
  ];

  const zonePercentages = totalAllZonesMin > 0 ? [
    ((totalMinWarmup / totalAllZonesMin) * 100).toFixed(1),
    ((totalMinZone2 / totalAllZonesMin) * 100).toFixed(1),
    ((totalMinZone3 / totalAllZonesMin) * 100).toFixed(1),
    ((totalMinZone4_5 / totalAllZonesMin) * 100).toFixed(1)
  ] : ["0", "0", "0", "0"];

  const zoneLabels = [
    `Z1 缓和热身 (≤130 bpm)`,
    `Z2 有氧耐力 (131-150 bpm)`,
    `Z3 有氧动力 (151-163 bpm)`,
    `Z4/Z5 乳酸阈值/无氧 (≥164 bpm)`
  ];

  const zoneColors = [
    "#94a3b8", // Z1 Grey
    "#10b981", // Z2 Emerald
    "#38bdf8", // Z3 Sky Blue
    "#f59e0b"  // Z4/Z5 Amber-Orange
  ];

  // Render Zone Summary Side Cards
  const cardsContainer = document.getElementById("zone-stats-cards");
  if (cardsContainer) {
    cardsContainer.innerHTML = zoneLabels.map((lbl, i) => {
      const min = zoneDataMinutes[i];
      const hrs = (min / 60).toFixed(1);
      const pct = zonePercentages[i];
      const color = zoneColors[i];

      return `
        <div class="bg-slate-900/80 border border-slate-700/60 rounded-xl p-2.5 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full shrink-0" style="background-color: ${color}"></span>
            <div class="truncate max-w-[170px]">
              <div class="font-semibold text-slate-200 truncate text-[11px]">${lbl}</div>
              <div class="text-[10px] text-slate-400">${min} 分钟 (${hrs} 小时)</div>
            </div>
          </div>
          <span class="font-bold text-xs px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700" style="color: ${color}">
            ${pct}%
          </span>
        </div>
      `;
    }).join("");
  }

  if (zoneDistributionChart) zoneDistributionChart.destroy();

  zoneDistributionChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: zoneLabels,
      datasets: [
        {
          data: zoneDataMinutes,
          backgroundColor: zoneColors,
          borderColor: "#1e293b",
          borderWidth: 2,
          hoverOffset: 8
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "#cbd5e1",
            font: { size: 11 },
            boxWidth: 12,
            generateLabels: (chart) => {
              const orig = Chart.overrides.pie.plugins.legend.labels.generateLabels(chart);
              orig.forEach((l, idx) => {
                l.text = `${l.text} · ${zonePercentages[idx]}%`;
              });
              return orig;
            }
          }
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              const label = item.label || '';
              const min = item.raw || 0;
              const hrs = (min / 60).toFixed(1);
              const pct = zonePercentages[item.dataIndex];
              return ` ${label}: ${min} 分钟 (${hrs}小时) [${pct}%]`;
            }
          }
        }
      }
    }
  });
}

// ==============================================================
// TAB 2: WORKOUT RECORDS TABLE & FILTERING
// ==============================================================

function handleSort(column) {
  if (currentSortColumn === column) {
    currentSortDirection = currentSortDirection === "asc" ? "desc" : "asc";
  } else {
    currentSortColumn = column;
    currentSortDirection = "asc";
  }
  updateSortIcons();
  filterAndRenderTable();
}

function updateSortIcons() {
  const columns = ["workout_id", "date", "activity_type", "distance_km", "active_duration", "avg_pace", "avg_heart_rate", "avg_cadence_spm", "route_name", "training_type"];
  columns.forEach(col => {
    const icon = document.getElementById(`sort-icon-${col}`);
    if (icon) {
      if (col === currentSortColumn) {
        icon.textContent = currentSortDirection === "asc" ? "▲" : "▼";
        icon.className = "text-[10px] text-indigo-400 font-bold";
      } else {
        icon.textContent = "↕";
        icon.className = "text-[10px] text-slate-600";
      }
    }
  });
}

function filterAndRenderTable() {
  const searchTerm = (document.getElementById("search-input").value || "").trim().toLowerCase();
  const actFilter = document.getElementById("filter-activity").value;
  const trainFilter = document.getElementById("filter-training-type").value;
  const missingFilter = document.getElementById("filter-missing").value;

  const filtered = allWorkouts.filter(w => {
    // Search match
    if (searchTerm) {
      const haystack = [
        w.workout_id, w.date, w.route_name, w.records_achieved, w.notes, w.training_type, w.weather
      ].join(" ").toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }

    // Activity type filter
    if (actFilter !== "ALL" && w.activity_type !== actFilter) return false;

    // Training type filter
    if (trainFilter !== "ALL") {
      const tt = w.training_type || "";
      if (!tt.includes(trainFilter)) return false;
    }

    // Missing data filter
    if (missingFilter === "MISSING_SPLITS") {
      if (w.splits && w.splits.length > 0) return false;
    } else if (missingFilter === "MISSING_HR") {
      if (w.avg_heart_rate && parseInt(w.avg_heart_rate) > 0) return false;
    } else if (missingFilter === "HAS_SPLITS") {
      if (!w.splits || w.splits.length === 0) return false;
    }

    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    let valA = a[currentSortColumn];
    let valB = b[currentSortColumn];

    if (currentSortColumn === "distance_km") {
      valA = parseFloat(valA) || 0;
      valB = parseFloat(valB) || 0;
    } else if (currentSortColumn === "avg_heart_rate" || currentSortColumn === "avg_cadence_spm") {
      valA = parseInt(valA) || 0;
      valB = parseInt(valB) || 0;
    } else if (currentSortColumn === "active_duration" || currentSortColumn === "avg_pace") {
      valA = timeStringToSeconds(valA);
      valB = timeStringToSeconds(valB);
    } else {
      valA = (valA || "").toString().toLowerCase();
      valB = (valB || "").toString().toLowerCase();
    }

    if (valA < valB) return currentSortDirection === "asc" ? -1 : 1;
    if (valA > valB) return currentSortDirection === "asc" ? 1 : -1;
    return 0;
  });

  renderTableRows(filtered);
  document.getElementById("filtered-count-badge").textContent = `显示 ${filtered.length} / ${allWorkouts.length} 项`;
}

function renderTableRows(workouts) {
  const tbody = document.getElementById("workout-table-body");
  const emptyState = document.getElementById("table-empty-state");

  if (workouts.length === 0) {
    tbody.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");

  tbody.innerHTML = workouts.map(w => {
    const isOutdoor = w.activity_type === "户外跑步";
    const typeBadge = isOutdoor
      ? `<span class="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-medium"><i class="fa-solid fa-tree text-[10px] mr-1"></i>户外</span>`
      : `<span class="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[11px] font-medium"><i class="fa-solid fa-dumbbell text-[10px] mr-1"></i>室内</span>`;

    const splitCount = (w.splits && w.splits.length) ? w.splits.length : 0;
    const splitBadge = splitCount > 0
      ? `<button onclick="openSplitsModal('${w.workout_id}')" class="px-2.5 py-1 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 font-medium text-[11px] transition-colors flex items-center gap-1 mx-auto">
           <i class="fa-solid fa-check text-[10px]"></i> ${splitCount} 分段详情
         </button>`
      : `<button onclick="openSplitsModal('${w.workout_id}')" class="px-2.5 py-1 rounded-lg bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/30 text-amber-300 font-medium text-[11px] transition-colors flex items-center gap-1 mx-auto">
           <i class="fa-solid fa-pen-to-square text-[10px]"></i> 录入分段
         </button>`;

    const hrDisplay = w.avg_heart_rate 
      ? `<span class="text-white font-medium">${w.avg_heart_rate}</span> <span class="text-slate-500 text-[10px]">/ ${w.max_heart_rate || '--'}</span>`
      : `<span class="text-slate-500">--</span>`;

    const recordsBadge = w.records_achieved 
      ? `<span class="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-semibold"><i class="fa-solid fa-trophy mr-1"></i>${w.records_achieved}</span>`
      : '';

    const trainingTags = (w.training_type || "").split(",").filter(Boolean).map(t => 
      `<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]">${t.trim()}</span>`
    ).join(" ");

    return `
      <tr class="hover:bg-slate-800/60 transition-colors">
        <td class="py-3 px-4 font-mono font-semibold text-slate-200">${w.workout_id}</td>
        <td class="py-3 px-3">
          <div class="font-medium text-slate-200">${w.date || '--'}</div>
          <div class="text-[10px] text-slate-500">${w.start_time || ''}</div>
        </td>
        <td class="py-3 px-3">${typeBadge}</td>
        <td class="py-3 px-3 font-semibold text-emerald-400">${w.distance_km ? parseFloat(w.distance_km).toFixed(2) : '--'}</td>
        <td class="py-3 px-3 font-mono text-slate-200">${w.active_duration || '--'}</td>
        <td class="py-3 px-3 font-mono font-medium text-amber-300">${w.avg_pace || '--'}</td>
        <td class="py-3 px-3">${hrDisplay}</td>
        <td class="py-3 px-3 text-sky-300">${w.avg_cadence_spm ? `${w.avg_cadence_spm}` : '--'}</td>
        <td class="py-3 px-3 max-w-[240px]">
          <div class="truncate text-slate-200 font-medium" title="${w.route_name || ''}">${w.route_name || '--'}</div>
          <div class="truncate text-slate-400 text-[10px]" title="${w.notes || ''}">${w.notes || ''}</div>
          ${recordsBadge}
        </td>
        <td class="py-3 px-3">
          <div class="flex flex-wrap gap-1">${trainingTags || '<span class="text-slate-500">--</span>'}</div>
        </td>
        <td class="py-3 px-3 text-center">${splitBadge}</td>
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button onclick="openWorkoutModal('${w.workout_id}')" class="p-1.5 bg-slate-700/60 hover:bg-indigo-600 text-slate-300 hover:text-white rounded-lg transition-colors" title="编辑基本信息">
              <i class="fa-solid fa-pen text-xs"></i>
            </button>
            <button onclick="handleDeleteWorkout('${w.workout_id}')" class="p-1.5 bg-slate-700/60 hover:bg-rose-600 text-slate-300 hover:text-white rounded-lg transition-colors" title="删除记录">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

// ==============================================================
// MODAL 1: WORKOUT DETAILS EDIT / CREATE
// ==============================================================

function openWorkoutModal(workoutId) {
  const modal = document.getElementById("modal-workout");
  const title = document.getElementById("modal-workout-title");
  const subtitle = document.getElementById("modal-workout-subtitle");
  const deleteBtn = document.getElementById("btn-modal-delete");

  if (workoutId) {
    const w = allWorkouts.find(item => item.workout_id === workoutId);
    if (!w) return;

    title.textContent = "编辑跑步记录";
    subtitle.textContent = `${w.workout_id} · ${w.date || ''} ${w.activity_type || ''}`;
    deleteBtn.classList.remove("hidden");

    document.getElementById("edit-workout-id").value = w.workout_id;
    document.getElementById("edit-splits-json").value = JSON.stringify(w.splits || []);

    document.getElementById("field-date").value = w.date || "";
    document.getElementById("field-start-time").value = w.start_time || "";
    document.getElementById("field-activity-type").value = w.activity_type || "户外跑步";
    document.getElementById("field-route-name").value = w.route_name || "";

    document.getElementById("field-distance").value = w.distance_km || "";
    document.getElementById("field-duration").value = w.active_duration || "";
    document.getElementById("field-pace").value = w.avg_pace || "";

    document.getElementById("field-avg-hr").value = w.avg_heart_rate || "";
    document.getElementById("field-max-hr").value = w.max_heart_rate || "";
    document.getElementById("field-vo2max").value = w.vo2_max || "";
    document.getElementById("field-calories").value = w.calories_kcal || "";

    document.getElementById("field-hr-warmup").value = w.hr_zone_warmup_pct || "";
    document.getElementById("field-hr-aerobic-endurance").value = w.hr_zone_aerobic_endurance_pct || "";
    document.getElementById("field-hr-aerobic-power").value = w.hr_zone_aerobic_power_pct || "";
    document.getElementById("field-hr-threshold").value = w.hr_zone_threshold_pct || "";

    document.getElementById("field-cadence").value = w.avg_cadence_spm || "";
    document.getElementById("field-stride").value = w.avg_stride_length_m || "";
    document.getElementById("field-power").value = w.avg_power_watts || "";
    document.getElementById("field-elevation").value = w.elevation_gain_m || "";

    document.getElementById("field-avg-gct").value = w.avg_ground_contact_time_ms || "";
    document.getElementById("field-max-gct").value = w.max_ground_contact_time_ms || "";
    document.getElementById("field-min-gct").value = w.min_ground_contact_time_ms || "";
    document.getElementById("field-training-load").value = w.training_load || "";

    document.getElementById("field-avg-flight").value = w.avg_flight_time_ms || "";
    document.getElementById("field-max-flight").value = w.max_flight_time_ms || "";
    document.getElementById("field-min-flight").value = w.min_flight_time_ms || "";

    document.getElementById("field-avg-vert").value = w.avg_vertical_oscillation_cm || "";
    document.getElementById("field-max-vert").value = w.max_vertical_oscillation_cm || "";
    document.getElementById("field-min-vert").value = w.min_vertical_oscillation_cm || "";

    document.getElementById("field-weather").value = w.weather || "";
    document.getElementById("field-temp").value = w.temperature_c || "";
    document.getElementById("field-records-achieved").value = w.records_achieved || "";
    document.getElementById("field-notes").value = w.notes || "";

    // Set checkboxes for training_type
    const tTypes = (w.training_type || "").split(",").map(t => t.trim());
    document.querySelectorAll("input[name='training-type-opt']").forEach(cb => {
      cb.checked = tTypes.includes(cb.value);
    });

  } else {
    // Generate new workout ID
    const maxIdNum = allWorkouts.reduce((max, curr) => {
      const match = (curr.workout_id || "").match(/workout_(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        return num > max ? num : max;
      }
      return max;
    }, 0);
    const newId = `workout_${String(maxIdNum + 1).padStart(3, '0')}`;

    title.textContent = "新增跑步记录";
    subtitle.textContent = `系统将自动生成 ID: ${newId}`;
    deleteBtn.classList.add("hidden");

    document.getElementById("workout-form").reset();
    document.getElementById("edit-workout-id").value = newId;
    document.getElementById("edit-splits-json").value = "[]";

    const todayStr = new Date().toISOString().split("T")[0];
    document.getElementById("field-date").value = todayStr;
    document.getElementById("field-start-time").value = "08:00";
    document.getElementById("field-activity-type").value = "户外跑步";
  }

  modal.classList.remove("hidden");
}

function closeWorkoutModal() {
  document.getElementById("modal-workout").classList.add("hidden");
}

async function handleSaveWorkout(event) {
  event.preventDefault();

  const selectedTrainingTypes = Array.from(document.querySelectorAll("input[name='training-type-opt']:checked"))
    .map(cb => cb.value)
    .join(",");

  let splits = [];
  try {
    splits = JSON.parse(document.getElementById("edit-splits-json").value || "[]");
  } catch (e) {
    splits = [];
  }

  const payload = {
    workout_id: document.getElementById("edit-workout-id").value,
    date: document.getElementById("field-date").value,
    start_time: document.getElementById("field-start-time").value,
    activity_type: document.getElementById("field-activity-type").value,
    route_name: document.getElementById("field-route-name").value,
    distance_km: document.getElementById("field-distance").value,
    active_duration: document.getElementById("field-duration").value,
    avg_pace: document.getElementById("field-pace").value,
    avg_heart_rate: document.getElementById("field-avg-hr").value,
    max_heart_rate: document.getElementById("field-max-hr").value,
    vo2_max: document.getElementById("field-vo2max").value,
    calories_kcal: document.getElementById("field-calories").value,
    hr_zone_warmup_pct: document.getElementById("field-hr-warmup").value,
    hr_zone_aerobic_endurance_pct: document.getElementById("field-hr-aerobic-endurance").value,
    hr_zone_aerobic_power_pct: document.getElementById("field-hr-aerobic-power").value,
    hr_zone_threshold_pct: document.getElementById("field-hr-threshold").value,
    avg_cadence_spm: document.getElementById("field-cadence").value,
    avg_stride_length_m: document.getElementById("field-stride").value,
    avg_power_watts: document.getElementById("field-power").value,
    elevation_gain_m: document.getElementById("field-elevation").value,
    avg_ground_contact_time_ms: document.getElementById("field-avg-gct").value,
    max_ground_contact_time_ms: document.getElementById("field-max-gct").value,
    min_ground_contact_time_ms: document.getElementById("field-min-gct").value,
    training_load: document.getElementById("field-training-load").value,
    avg_flight_time_ms: document.getElementById("field-avg-flight").value,
    max_flight_time_ms: document.getElementById("field-max-flight").value,
    min_flight_time_ms: document.getElementById("field-min-flight").value,
    avg_vertical_oscillation_cm: document.getElementById("field-avg-vert").value,
    max_vertical_oscillation_cm: document.getElementById("field-max-vert").value,
    min_vertical_oscillation_cm: document.getElementById("field-min-vert").value,
    weather: document.getElementById("field-weather").value,
    temperature_c: document.getElementById("field-temp").value,
    records_achieved: document.getElementById("field-records-achieved").value,
    training_type: selectedTrainingTypes,
    notes: document.getElementById("field-notes").value,
    splits: splits
  };

  try {
    let savedSuccessfully = false;

    // 1. Try local backend server API first
    try {
      const res = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          showToast("记录保存成功，已同步至本地 CSV！");
          savedSuccessfully = true;
          closeWorkoutModal();
          await fetchData();
          return;
        }
      }
    } catch (apiErr) {
      // Local server not running or network failed, fallback to GitHub API
    }

    // 2. Fallback to GitHub REST API commit (for GitHub Pages hosting)
    showToast("正在通过 GitHub API 同步提交至仓库...", "success");

    // Prepare new list in memory
    const existingIdx = allWorkouts.findIndex(w => w.workout_id === payload.workout_id);
    let updatedWorkouts = [...allWorkouts];
    if (existingIdx >= 0) {
      updatedWorkouts[existingIdx] = { ...updatedWorkouts[existingIdx], ...payload };
    } else {
      // New record, insert at beginning
      updatedWorkouts.unshift(payload);
    }

    const commitMsg = payload.workout_id && existingIdx >= 0
      ? `feat: update workout ${payload.workout_id}`
      : `feat: log workout ${payload.workout_id} on ${payload.date}`;

    await commitRecordsToGitHub(updatedWorkouts, commitMsg);

    allWorkouts = updatedWorkouts;
    updateHeaderKPIs();
    computeAllPersonalBests();
    if (currentActiveTab === "analytics") {
      renderAllAnalyticsCharts();
    } else {
      filterAndRenderTable();
    }

    showToast("已成功提交至 GitHub 仓库！GitHub Actions 将在稍后自动重新部署静态页面。");
    closeWorkoutModal();
  } catch (err) {
    console.error("Save workout error:", err);
    showToast(err.message || "网络请求异常，保存失败", "error");
  }
}

// ==============================================================
// MODAL 2: BY-KM SPLIT EDITOR
// ==============================================================

function openSplitsModal(workoutId) {
  const w = allWorkouts.find(item => item.workout_id === workoutId);
  if (!w) return;

  currentWorkoutForSplits = w;
  currentSplitsList = JSON.parse(JSON.stringify(w.splits || []));

  document.getElementById("modal-split-title").textContent = `公里分段明细 (${w.workout_id})`;
  document.getElementById("modal-split-subtitle").textContent = `${w.date || ''} · ${w.activity_type || ''} · 目标总里程 ${w.distance_km || '--'} km`;

  renderSplitsTable();
  updateSplitsChart();
  document.getElementById("modal-splits").classList.remove("hidden");
}

function closeSplitsModal() {
  document.getElementById("modal-splits").classList.add("hidden");
  currentWorkoutForSplits = null;
  currentSplitsList = [];
}

function renderSplitsTable() {
  const tbody = document.getElementById("split-table-body");
  let totalDurSec = 0;
  let totalDistKm = 0;

  if (currentSplitsList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-8 text-center text-slate-500 text-xs">
          暂无公里分段明细数据，点击右上角「添加下一公里」开始录入。
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = currentSplitsList.map((s, idx) => {
      const dSec = timeStringToSeconds(s.duration);
      totalDurSec += dSec;
      totalDistKm += parseFloat(s.distance_km || 1);

      return `
        <tr class="hover:bg-slate-800/50">
          <td class="py-2 px-3 font-mono font-semibold text-slate-400">#${s.km || idx + 1}</td>
          <td class="py-2 px-3">
            <input type="number" step="0.01" value="${s.distance_km !== null && s.distance_km !== undefined ? s.distance_km : 1.0}"
              onchange="handleSplitInputChange(${idx}, 'distance_km', this.value)"
              class="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white font-mono text-xs focus:border-emerald-500">
          </td>
          <td class="py-2 px-3">
            <input type="text" placeholder="00:06:30" value="${s.duration || ''}"
              onchange="handleSplitInputChange(${idx}, 'duration', this.value)"
              class="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white font-mono text-xs focus:border-emerald-500">
          </td>
          <td class="py-2 px-3">
            <input type="text" placeholder="06'30&quot;" value="${s.avg_pace || ''}"
              onchange="handleSplitInputChange(${idx}, 'avg_pace', this.value)"
              class="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-amber-300 font-mono text-xs focus:border-emerald-500">
          </td>
          <td class="py-2 px-3">
            <input type="number" placeholder="145" value="${s.avg_heart_rate || ''}"
              onchange="handleSplitInputChange(${idx}, 'avg_heart_rate', this.value)"
              class="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-rose-300 font-mono text-xs focus:border-emerald-500">
          </td>
          <td class="py-2 px-3">
            <input type="number" placeholder="176" value="${s.avg_cadence_spm || ''}"
              onchange="handleSplitInputChange(${idx}, 'avg_cadence_spm', this.value)"
              class="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sky-300 font-mono text-xs focus:border-emerald-500">
          </td>
          <td class="py-2 px-3">
            <input type="number" step="0.01" placeholder="0.82" value="${s.avg_stride_length_m || ''}"
              onchange="handleSplitInputChange(${idx}, 'avg_stride_length_m', this.value)"
              class="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-emerald-300 font-mono text-xs focus:border-emerald-500">
          </td>
          <td class="py-2 px-3">
            <input type="number" placeholder="185" value="${s.avg_power_watts || ''}"
              onchange="handleSplitInputChange(${idx}, 'avg_power_watts', this.value)"
              class="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-300 font-mono text-xs focus:border-emerald-500">
          </td>
          <td class="py-2 px-2 text-center">
            <button onclick="removeSplitRow(${idx})" class="text-slate-500 hover:text-rose-400 p-1 transition-colors" title="删除该分段">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // Update summary badge
  const summaryBadge = document.getElementById("split-summary-badge");
  summaryBadge.textContent = `累计 ${totalDistKm.toFixed(2)} km · 预计分段总用时 ${secondsToTimeString(totalDurSec, true)}`;
}

function handleSplitInputChange(index, field, value) {
  if (!currentSplitsList[index]) return;

  if (field === "distance_km" || field === "avg_stride_length_m") {
    currentSplitsList[index][field] = value === "" ? null : parseFloat(value);
  } else if (field === "avg_heart_rate" || field === "avg_cadence_spm" || field === "avg_power_watts") {
    currentSplitsList[index][field] = value === "" ? null : parseInt(value, 10);
  } else {
    currentSplitsList[index][field] = value;
  }

  // Smart calculations
  const row = currentSplitsList[index];
  const dist = parseFloat(row.distance_km) || 1.0;

  if (field === "duration" && value) {
    const durSec = timeStringToSeconds(value);
    if (durSec > 0 && dist > 0) {
      const paceSec = Math.round(durSec / dist);
      const paceMin = Math.floor(paceSec / 60);
      const paceRem = paceSec % 60;
      row.avg_pace = `${String(paceMin).padStart(2, '0')}'${String(paceRem).padStart(2, '0')}"`;
    }
  }

  if ((field === "avg_cadence_spm" || field === "duration") && row.avg_cadence_spm && row.duration) {
    const durSec = timeStringToSeconds(row.duration);
    const cad = parseInt(row.avg_cadence_spm, 10);
    if (durSec > 0 && cad > 0 && dist > 0) {
      const totalSteps = (durSec / 60.0) * cad;
      const strideMeters = (dist * 1000) / totalSteps;
      row.avg_stride_length_m = parseFloat(strideMeters.toFixed(2));
    }
  }

  renderSplitsTable();
  updateSplitsChart();
}

function addNewSplitRow() {
  const nextKm = currentSplitsList.length + 1;
  currentSplitsList.push({
    km: nextKm,
    distance_km: 1.0,
    duration: "",
    avg_pace: "",
    avg_heart_rate: null,
    avg_cadence_spm: null,
    avg_stride_length_m: null,
    avg_power_watts: null
  });
  renderSplitsTable();
  updateSplitsChart();
}

function removeSplitRow(index) {
  currentSplitsList.splice(index, 1);
  currentSplitsList.forEach((s, idx) => s.km = idx + 1);
  renderSplitsTable();
  updateSplitsChart();
}

function updateSplitsChart() {
  const canvas = document.getElementById("splitTrendChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const labels = currentSplitsList.map((s, i) => `KM ${s.km || i + 1}`);
  const paceSeconds = currentSplitsList.map(s => timeStringToSeconds(s.avg_pace) || null);
  const heartRates = currentSplitsList.map(s => s.avg_heart_rate || null);

  if (splitChartInstance) {
    splitChartInstance.destroy();
  }

  splitChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "分段配速 (MM'SS\")",
          data: paceSeconds,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          yAxisID: "yPace",
          tension: 0.3,
          pointRadius: 4,
          fill: true
        },
        {
          label: "平均心率 (bpm)",
          data: heartRates,
          borderColor: "#f43f5e",
          backgroundColor: "rgba(244, 63, 94, 0.1)",
          yAxisID: "yHr",
          tension: 0.3,
          pointRadius: 4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: "rgba(51, 65, 85, 0.3)" },
          ticks: { color: "#94a3b8" }
        },
        yPace: {
          type: "linear",
          position: "left",
          reverse: true, // Higher is faster!
          grid: { color: "rgba(51, 65, 85, 0.3)" },
          ticks: {
            color: "#10b981",
            callback: (val) => secondsToPaceString(val)
          }
        },
        yHr: {
          type: "linear",
          position: "right",
          suggestedMin: 120,
          suggestedMax: 180,
          grid: { drawOnChartArea: false },
          ticks: { color: "#f43f5e" }
        }
      },
      plugins: {
        legend: {
          labels: { color: "#cbd5e1" }
        }
      }
    }
  });
}

async function saveCurrentSplits() {
  if (!currentWorkoutForSplits) return;

  const workoutId = currentWorkoutForSplits.workout_id;
  try {
    // 1. Try local backend server API first
    try {
      const res = await fetch(`/api/records/${workoutId}/splits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ splits: currentSplitsList })
      });
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          showToast("分段明细已成功保存并同步！");
          closeSplitsModal();
          await fetchData();
          return;
        }
      }
    } catch (apiErr) {
      // Local server not running or network failed, fallback to GitHub API
    }

    // 2. Fallback to GitHub REST API commit
    showToast("正在通过 GitHub API 同步分段明细至仓库...", "success");

    const existingIdx = allWorkouts.findIndex(w => w.workout_id === workoutId);
    if (existingIdx === -1) {
      throw new Error(`未找到对应训练记录: ${workoutId}`);
    }

    let updatedWorkouts = [...allWorkouts];
    updatedWorkouts[existingIdx] = {
      ...updatedWorkouts[existingIdx],
      splits: currentSplitsList,
      splits_by_km_json: JSON.stringify(currentSplitsList)
    };

    await commitRecordsToGitHub(updatedWorkouts, `feat: update splits for ${workoutId}`);

    allWorkouts = updatedWorkouts;
    updateHeaderKPIs();
    computeAllPersonalBests();
    if (currentActiveTab === "analytics") {
      renderAllAnalyticsCharts();
    } else {
      filterAndRenderTable();
    }

    showToast("分段明细已成功同步至 GitHub 仓库！");
    closeSplitsModal();
  } catch (err) {
    console.error("Save splits error:", err);
    showToast(err.message || "网络请求异常，保存分段失败", "error");
  }
}

// Delete workout
function handleDeleteFromModal() {
  const workoutId = document.getElementById("edit-workout-id").value;
  if (workoutId) {
    handleDeleteWorkout(workoutId);
  }
}

async function handleDeleteWorkout(workoutId) {
  if (!confirm(`确定要永久删除训练记录 [${workoutId}] 吗？此操作将同步修改 CSV 数据。`)) {
    return;
  }

  try {
    // 1. Try local backend server API first
    try {
      const res = await fetch(`/api/records/${workoutId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          showToast(`记录 [${workoutId}] 已成功删除！`);
          closeWorkoutModal();
          await fetchData();
          return;
        }
      }
    } catch (apiErr) {
      // Local server not running or network failed, fallback to GitHub API
    }

    // 2. Fallback to GitHub REST API commit
    showToast("正在通过 GitHub API 同步删除操作至仓库...", "success");

    let updatedWorkouts = allWorkouts.filter(w => w.workout_id !== workoutId);
    await commitRecordsToGitHub(updatedWorkouts, `feat: delete workout ${workoutId}`);

    allWorkouts = updatedWorkouts;
    updateHeaderKPIs();
    computeAllPersonalBests();
    if (currentActiveTab === "analytics") {
      renderAllAnalyticsCharts();
    } else {
      filterAndRenderTable();
    }

    showToast(`记录 [${workoutId}] 已从 GitHub 仓库成功删除！`);
    closeWorkoutModal();
  } catch (err) {
    console.error("Delete error:", err);
    showToast(err.message || "网络请求异常，删除失败", "error");
  }
}

// Export CSV
function exportCsvFile() {
  // Support both server API endpoint and static deployment path
  window.open("data/running_records.csv", "_blank");
}

function refreshData() {
  fetchData();
  showToast("数据已刷新");
}

// ==============================================================
// GITHUB REST API & CSV SERIALIZATION HELPERS (Option 1)
// ==============================================================

function getGitHubConfig() {
  return {
    token: localStorage.getItem(GITHUB_TOKEN_KEY) || "",
    repo: localStorage.getItem(GITHUB_REPO_KEY) || "",
    branch: localStorage.getItem(GITHUB_BRANCH_KEY) || "main"
  };
}

function setGitHubConfig(token, repo, branch = "main") {
  if (token) localStorage.setItem(GITHUB_TOKEN_KEY, token.trim());
  else localStorage.removeItem(GITHUB_TOKEN_KEY);

  if (repo) localStorage.setItem(GITHUB_REPO_KEY, repo.trim().replace(/^https?:\/\/github\.com\//, ""));
  else localStorage.removeItem(GITHUB_REPO_KEY);

  if (branch) localStorage.setItem(GITHUB_BRANCH_KEY, branch.trim());
  else localStorage.setItem(GITHUB_BRANCH_KEY, "main");

  updateGitHubSyncStatusUI();
}

function updateGitHubSyncStatusUI() {
  const { token, repo } = getGitHubConfig();
  const indicator = document.getElementById("gh-sync-status-indicator");
  const badgeText = document.getElementById("gh-sync-status-text");

  if (indicator && badgeText) {
    if (token && repo) {
      indicator.className = "w-2 h-2 rounded-full bg-[#24a148] animate-pulse";
      badgeText.textContent = `已绑定 GitHub (${repo.split("/")[1] || repo})`;
      badgeText.className = "text-[#6fdc8c] text-[11px]";
    } else {
      indicator.className = "w-2 h-2 rounded-full bg-[#8d8d8d]";
      badgeText.textContent = "未配置 GitHub 写入 Token";
      badgeText.className = "text-[#8d8d8d] text-[11px]";
    }
  }
}

function openGitHubSettingsModal() {
  const modal = document.getElementById("modal-gh-settings");
  if (!modal) return;
  const { token, repo, branch } = getGitHubConfig();

  // Try auto-inferring repo from URL if empty (e.g. username.github.io/repo-name)
  let inferredRepo = repo;
  if (!inferredRepo && window.location.hostname.endsWith("github.io")) {
    const owner = window.location.hostname.split(".")[0];
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const repoName = pathParts.length > 0 ? pathParts[0] : "";
    if (owner && repoName) {
      inferredRepo = `${owner}/${repoName}`;
    }
  }

  document.getElementById("gh-input-token").value = token || "";
  document.getElementById("gh-input-repo").value = inferredRepo || "";
  document.getElementById("gh-input-branch").value = branch || "main";
  modal.classList.remove("hidden");
}

function closeGitHubSettingsModal() {
  const modal = document.getElementById("modal-gh-settings");
  if (modal) modal.classList.add("hidden");
}

function handleSaveGitHubSettings(e) {
  if (e) e.preventDefault();
  const token = document.getElementById("gh-input-token").value;
  const repo = document.getElementById("gh-input-repo").value;
  const branch = document.getElementById("gh-input-branch").value || "main";

  setGitHubConfig(token, repo, branch);
  closeGitHubSettingsModal();
  showToast(token ? "GitHub 写入配置已保存" : "GitHub Token 已清除");
}

/**
 * Escape CSV field to RFC 4180 standard
 */
function escapeCsvField(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize a list of workout records to CSV string
 */
function serializeRecordsToCsv(records) {
  const header = CSV_COLUMNS.join(",");
  const rows = records.map(r => {
    return CSV_COLUMNS.map(col => {
      if (col === "splits_by_km_json") {
        if (r.splits && Array.isArray(r.splits) && r.splits.length > 0) {
          return escapeCsvField(JSON.stringify(r.splits));
        } else if (r.splits_by_km_json) {
          return escapeCsvField(r.splits_by_km_json);
        }
        return "";
      }
      return escapeCsvField(r[col] !== undefined ? r[col] : "");
    }).join(",");
  });

  return [header, ...rows].join("\n");
}

/**
 * Commit data/running_records.csv to GitHub via GitHub Contents API
 */
async function commitRecordsToGitHub(records, commitMessage) {
  const { token, repo, branch } = getGitHubConfig();
  if (!token || !repo) {
    throw new Error("请先点击顶部「GitHub 写入配置」输入 GitHub Token 和仓库名称，以便在 GitHub Pages 直接修改数据。");
  }

  const filePath = "data/running_records.csv";
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`;

  // Step 1: Get existing file sha
  let sha = null;
  const getRes = await fetch(apiUrl, {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": `token ${token}`
    }
  });

  if (getRes.ok) {
    const fileInfo = await getRes.json();
    sha = fileInfo.sha;
  } else if (getRes.status !== 404) {
    const errBody = await getRes.json().catch(() => ({}));
    throw new Error(errBody.message || `GitHub API 获取文件失败 (HTTP ${getRes.status})`);
  }

  // Step 2: Generate updated CSV content & base64 encode
  const csvContent = serializeRecordsToCsv(records);
  const utf8Bytes = new TextEncoder().encode(csvContent);
  let binaryStr = "";
  for (let i = 0; i < utf8Bytes.length; i++) {
    binaryStr += String.fromCharCode(utf8Bytes[i]);
  }
  const base64Content = btoa(binaryStr);

  // Step 3: PUT request to create/update file
  const putPayload = {
    message: commitMessage || `chore: update running records`,
    content: base64Content,
    branch: branch
  };
  if (sha) {
    putPayload.sha = sha;
  }

  const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": `token ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(putPayload)
  });

  if (!putRes.ok) {
    const errBody = await putRes.json().catch(() => ({}));
    throw new Error(errBody.message || `GitHub 提交失败 (HTTP ${putRes.status})`);
  }

  return await putRes.json();
}

// Toast notification helper
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  const msg = document.getElementById("toast-message");

  msg.textContent = message;
  toast.className = type === "error"
    ? "fixed bottom-6 right-6 z-50 bg-[#da1e28] text-white px-4 py-2.5 shadow-2xl flex items-center gap-2 text-xs font-medium transform translate-y-0 opacity-100 transition-all duration-300 border border-[#393939]"
    : "fixed bottom-6 right-6 z-50 bg-[#24a148] text-white px-4 py-2.5 shadow-2xl flex items-center gap-2 text-xs font-medium transform translate-y-0 opacity-100 transition-all duration-300 border border-[#393939]";

  setTimeout(() => {
    toast.classList.add("translate-y-20", "opacity-0");
  }, 4000);
}
