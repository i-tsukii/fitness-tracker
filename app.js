/* Two-user fitness tracker: steps + light/extra exercise + shared weekly goal.
 * Data is stored locally in the browser via localStorage (no server required).
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, push, set, onValue, remove } 
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDwfg7_87CWCMbp_6MxzH2EOSlWioC7xKg",
  authDomain: "fitness-program-5d16d.firebaseapp.com",
  databaseURL: "https://fitness-program-5d16d-default-rtdb.firebaseio.com",
  projectId: "fitness-program-5d16d",
  storageBucket: "fitness-program-5d16d.firebasestorage.app",
  messagingSenderId: "74735763444",
  appId: "1:74735763444:web:135742c5c03f0078b543a1",
  measurementId: "G-WLVY624FWJ"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

(function () {
  const STORAGE_KEY = "fitnessTracker.state.v1";
  const users = [
    { id: "u1", name: "Laia", color: "green" },
    { id: "u2", name: "Venny", color: "blue" },
  ];

  // Planned workout days: Tue / Thu / Sat
  // JS getDay(): Sun=0 ... Sat=6
  const plannedWorkoutDays = [2, 4, 6];

  /** @type {{activities: Array<any>, goals: {weeklyStepGoal:number, weeklyExerciseGoal:number}}} */
  let state = {
    activities: [],
    goals: { weeklyStepGoal: 70000, weeklyExerciseGoal: 10 },
  };

  let els = {};

  const PAGES = ["dashboard", "tracker", "history", "calendar"];
  let currentPage = "dashboard";

  function $(sel) {
    return document.querySelector(sel);
  }

  function parseISODate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    // Use local time midnight.
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }

  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function startOfWeekMonday(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    // Convert so Monday=0 ... Sunday=6
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d;
  }

  function endOfWeekMonday(startMonday) {
    const d = new Date(startMonday.getFullYear(), startMonday.getMonth(), startMonday.getDate(), 0, 0, 0, 0);
    d.setDate(d.getDate() + 6);
    return d;
  }

  function weekLabel(startMonday) {
    const end = endOfWeekMonday(startMonday);
    const m1 = startMonday.toLocaleString(undefined, { month: "short" });
    const m2 = end.toLocaleString(undefined, { month: "short" });
    return `${m1} ${startMonday.getDate()} - ${m2} ${end.getDate()}`;
  }

  function monthLabel(date) {
    return date.toLocaleString(undefined, { month: "long", year: "numeric" });
  }

  function safeNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.activities) && parsed.goals) state = parsed;
    } catch {
      // ignore
    }
  }

function saveEntry(data) {
    const trackerRef = ref(database, "trackerEntries");
    const newEntry = push(trackerRef);

    set(newEntry, data);
}

async function resetAllData() {
    try {
        await remove(ref(database, "trackerEntries"));

        state.activities = [];

        renderDashboard();
        renderHistory();
        renderCalendar();
        renderTracker();

        toast("All tracker data has been reset.");
    } catch (error) {
        console.error("Reset failed:", error);
        toast("Failed to reset data.");
    }
}

function toast(message) {
    const t = els.toast;
    if (!t) return;
    t.textContent = message;
    t.classList.add("show");
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(() => t.classList.remove("show"), 2200);
}

function normalizeStepType(type) {
    const t = String(type || "").toLowerCase();
    if (t === "walk" || t === "jog" || t === "run") return t;
    return "walk";
}

  function getStepType(activity) {
    return activity.stepType || "walk";
  }

  function getExtraExercise(activity) {
    if (activity.extraExercise && String(activity.extraExercise).trim()) return String(activity.extraExercise).trim();
    if (activity.durationMinutes && safeNumber(activity.durationMinutes, 0) > 0) {
      return `${safeNumber(activity.durationMinutes, 0)} min`;
    }
    if (activity.exerciseType && activity.exerciseType !== "None") return activity.exerciseType;
    return "";
  }

  function hasExtraExercise(activity) {
    if (getExtraExercise(activity)) return true;
    if (activity.exerciseType && activity.exerciseType !== "None") return true;
    return false;
  }

  function addActivity(record) {
    state.activities.push(record);
    saveEntry(record);
  }

  function getActivities() {
    return state.activities.slice();
  }

  function combinedStepsForDate(iso) {
    const dayActivities = state.activities.filter((a) => a.date === iso);
    return dayActivities.reduce((sum, a) => sum + safeNumber(a.steps, 0), 0);
  }

  function stepsForUserOnDate(userId, iso) {
    return state.activities
      .filter((a) => a.userId === userId && a.date === iso)
      .reduce((sum, a) => sum + safeNumber(a.steps, 0), 0);
  }

  function exercisesForUserOnDate(userId, iso) {
    return state.activities
      .filter((a) => a.userId === userId && a.date === iso && hasExtraExercise(a))
      .length;
  }

  function combinedExercisesForDate(iso) {
    return state.activities
      .filter((a) => a.date === iso && hasExtraExercise(a))
      .length;
  }

  function weekTotals(weekStartMonday) {
    const weekEnd = endOfWeekMonday(weekStartMonday);
    const isoStart = toISODate(weekStartMonday);
    const isoEnd = toISODate(weekEnd);

    const weekActivities = state.activities.filter((a) => a.date >= isoStart && a.date <= isoEnd);

    const out = {
      perUser: {
        u1: { steps: 0, exercises: 0 },
        u2: { steps: 0, exercises: 0 },
      },
      combined: { steps: 0, exercises: 0 },
    };

    for (const a of weekActivities) {
      const u = a.userId;
      const steps = safeNumber(a.steps, 0);
      const isEx = hasExtraExercise(a);
      out.perUser[u].steps += steps;
      out.perUser[u].exercises += isEx ? 1 : 0;
      out.combined.steps += steps;
      out.combined.exercises += isEx ? 1 : 0;
    }
    return out;
  }

  function dailySeries(userId, daysBack) {
    const today = new Date();
    const series = [];
    for (let i = daysBack - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 0, 0, 0, 0);
      const iso = toISODate(d);
      series.push({ iso, value: stepsForUserOnDate(userId, iso) });
    }
    return series;
  }

  function weeklySeriesCombined(weeksBack) {
    const today = new Date();
    const start = startOfWeekMonday(today);
    const out = [];
    for (let i = weeksBack - 1; i >= 0; i--) {
      const wk = new Date(start.getFullYear(), start.getMonth(), start.getDate() - i * 7, 0, 0, 0, 0);
      const totals = weekTotals(wk);
      out.push({ weekStart: wk, value: totals.combined.steps });
    }
    return out;
  }

  function weekEntriesByUser(weekStartMonday, userId) {
    const weekEnd = endOfWeekMonday(weekStartMonday);
    const isoStart = toISODate(weekStartMonday);
    const isoEnd = toISODate(weekEnd);
    const weekActs = state.activities.filter((a) => a.userId === userId && a.date >= isoStart && a.date <= isoEnd);
    return weekActs;
  }

  function consistencyForWeek(weekStartMonday) {
    const weekEnd = endOfWeekMonday(weekStartMonday);
    const plannedWorkoutISO = [];
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStartMonday.getFullYear(), weekStartMonday.getMonth(), weekStartMonday.getDate() + i, 0, 0, 0, 0);
      weekDays.push(toISODate(d));
      if (plannedWorkoutDays.includes(d.getDay())) plannedWorkoutISO.push(toISODate(d));
    }

    const result = { perUser: { u1: { dayConsistency: 0, workoutConsistency: 0 }, u2: { dayConsistency: 0, workoutConsistency: 0 } } };

    for (const u of users) {
      let anyStepDays = 0;
      let workoutDaysHit = 0;
      for (const iso of weekDays) {
        const stepsAny = stepsForUserOnDate(u.id, iso) > 0;
        if (stepsAny) anyStepDays++;

        if (plannedWorkoutISO.includes(iso)) {
          const exAny = exercisesForUserOnDate(u.id, iso) > 0;
          if (exAny) workoutDaysHit++;
        }
      }

      result.perUser[u.id].dayConsistency = anyStepDays / 7;
      result.perUser[u.id].workoutConsistency = plannedWorkoutISO.length ? workoutDaysHit / plannedWorkoutISO.length : 0;
    }

    // Combined exercise consistency: at least one user exercised on each planned day.
    let combinedWorkoutHit = 0;
    for (const iso of plannedWorkoutISO) {
      if (combinedExercisesForDate(iso) > 0) combinedWorkoutHit++;
    }
    result.combinedWorkoutConsistency = plannedWorkoutISO.length ? combinedWorkoutHit / plannedWorkoutISO.length : 0;

    return result;
  }

  function renderLineChart(svgEl, series, options) {
    // series: [{values:[{xLabel,value}], stroke, fill?}]
    const width = 600;
    const height = 180;
    svgEl.innerHTML = "";

    const padding = { left: 38, right: 10, top: 10, bottom: 30 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Determine max to scale.
    let maxV = 0;
    for (const s of series) for (const p of s.values) maxV = Math.max(maxV, safeNumber(p.value, 0));
    maxV = maxV || 1;

    // Horizontal grid lines
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const t = i / gridLines;
      const y = padding.top + chartH * (1 - t);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", padding.left);
      line.setAttribute("x2", padding.left + chartW);
      line.setAttribute("y1", y);
      line.setAttribute("y2", y);
      line.setAttribute("stroke", "rgba(15,23,42,0.08)");
      line.setAttribute("stroke-width", "1");
      svgEl.appendChild(line);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.textContent = Math.round(maxV * t).toString();
      label.setAttribute("x", padding.left - 8);
      label.setAttribute("y", y + 4);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("font-size", "11");
      label.setAttribute("fill", "rgba(107,114,128,0.95)");
      svgEl.appendChild(label);
    }

    // X axis labels (few)
    const n = series[0]?.values?.length || 0;
    const step = n > 10 ? 2 : 1;
    for (let i = 0; i < n; i += step) {
      const x = padding.left + (chartW * i) / Math.max(1, n - 1);
      const d = new Date(series[0].values[i].iso);
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.textContent = d.toLocaleString(undefined, { weekday: "short" });
      label.setAttribute("x", x);
      label.setAttribute("y", padding.top + chartH + 22);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "11");
      label.setAttribute("fill", "rgba(107,114,128,0.95)");
      svgEl.appendChild(label);
    }

    // Draw each series.
    for (const s of series) {
      const points = s.values.map((p, idx) => {
        const x = padding.left + (chartW * idx) / Math.max(1, n - 1);
        const y = padding.top + chartH * (1 - safeNumber(p.value, 0) / maxV);
        return { x, y };
      });

      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", s.stroke);
      poly.setAttribute("stroke-width", "3");
      poly.setAttribute("stroke-linecap", "round");
      poly.setAttribute("stroke-linejoin", "round");
      poly.setAttribute("points", points.map((pt) => `${pt.x},${pt.y}`).join(" "));
      svgEl.appendChild(poly);

      // Points
      for (const pt of points) {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("cx", pt.x);
        c.setAttribute("cy", pt.y);
        c.setAttribute("r", "4");
        c.setAttribute("fill", s.stroke);
        c.setAttribute("opacity", "0.9");
        svgEl.appendChild(c);
      }
    }
  }

  function renderBarChart(svgEl, bars) {
    // bars: [{label, value}]
    const width = 600;
    const height = 180;
    svgEl.innerHTML = "";

    const padding = { left: 30, right: 10, top: 10, bottom: 30 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    let maxV = 0;
    for (const b of bars) maxV = Math.max(maxV, safeNumber(b.value, 0));
    maxV = maxV || 1;

    // grid
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const t = i / gridLines;
      const y = padding.top + chartH * (1 - t);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", padding.left);
      line.setAttribute("x2", padding.left + chartW);
      line.setAttribute("y1", y);
      line.setAttribute("y2", y);
      line.setAttribute("stroke", "rgba(15,23,42,0.08)");
      line.setAttribute("stroke-width", "1");
      svgEl.appendChild(line);
    }

    const n = bars.length || 1;
    const gap = 10;
    const barW = (chartW - gap * (n - 1)) / n;

    bars.forEach((b, i) => {
      const x = padding.left + i * (barW + gap);
      const value = safeNumber(b.value, 0);
      const h = (value / maxV) * chartH;
      const y = padding.top + (chartH - h);

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", x);
      rect.setAttribute("y", y);
      rect.setAttribute("width", barW);
      rect.setAttribute("height", h);
      rect.setAttribute("rx", "10");
      rect.setAttribute("fill", "rgba(59,130,246,0.75)");
      rect.setAttribute("stroke", "rgba(59,130,246,0.55)");
      svgEl.appendChild(rect);

      // x labels (show fewer)
      if (n <= 8 || i % 2 === 0) {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.textContent = b.label;
        label.setAttribute("x", x + barW / 2);
        label.setAttribute("y", padding.top + chartH + 22);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size", "11");
        label.setAttribute("fill", "rgba(107,114,128,0.95)");
        svgEl.appendChild(label);
      }
    });
  }

  function setProgressBar(el, pct) {
    const v = clamp(pct, 0, 100);
    el.style.width = `${v}%`;
  }

  function statusFromProgress(pct) {
    if (pct >= 100) return { cls: "complete", label: "Goal hit" };
    if (pct >= 60) return { cls: "ongoing", label: "On track" };
    return { cls: "missed", label: "Needs focus" };
  }

  function overallGoalStats() {
    const today = new Date();
    const periodStart = new Date(today.getFullYear(), 0, 1, 0, 0, 0, 0);
    const periodEnd = new Date(2026, 11, 31, 0, 0, 0, 0);
    const isoStart = toISODate(periodStart);
    const isoEnd = toISODate(periodEnd);

    const totalSteps = state.activities
      .filter((a) => a.date >= isoStart && a.date <= isoEnd)
      .reduce((sum, a) => sum + safeNumber(a.steps, 0), 0);

    const weekStart = startOfWeekMonday(periodStart);
    const endWeek = startOfWeekMonday(periodEnd);
    const totalWeeks = Math.max(1, Math.round((endWeek - weekStart) / (7 * 24 * 3600 * 1000)) + 1);

    // Calculate total target by summing progressive weekly goals
    let totalTarget = 0;
    for (let i = 0; i < totalWeeks; i++) {
      const wk = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i * 7, 0, 0, 0, 0);
      totalTarget += getWeeklyStepGoalForDate(wk);
    }

    const pct = totalTarget ? (totalSteps / totalTarget) * 100 : 0;

    return { totalSteps, totalTarget, pct, totalWeeks };
  }

  function renderDashboard() {
    const today = new Date();
    const todayISO = toISODate(today);
    const weekStart = startOfWeekMonday(today);

    // Weekly totals
    const totals = weekTotals(weekStart);

    // Get the current week's progressive goal
    const currentWeeklyGoal = getWeeklyStepGoalForDate(today);

    const perUserTargets = {
      u1: currentWeeklyGoal,
      u2: currentWeeklyGoal,
    };

    const u1Steps = totals.perUser.u1.steps;
    const u2Steps = totals.perUser.u2.steps;
    const combined = totals.combined.steps;

    const u1Pct = perUserTargets.u1 ? (u1Steps / perUserTargets.u1) * 100 : 0;
    const u2Pct = perUserTargets.u2 ? (u2Steps / perUserTargets.u2) * 100 : 0;
    const sharedPct = (currentWeeklyGoal * 2) ? (combined / (currentWeeklyGoal * 2)) * 100 : 0;

    els.todayStepsU1.textContent = stepsForUserOnDate("u1", todayISO).toLocaleString();
    els.todayStepsU2.textContent = stepsForUserOnDate("u2", todayISO).toLocaleString();

    els.u1WeekSteps.textContent = u1Steps.toLocaleString();
    els.u2WeekSteps.textContent = u2Steps.toLocaleString();
    els.combinedWeekSteps.textContent = combined.toLocaleString();

    // Display weekly goals on user cards
    els.u1WeeklyGoal.textContent = currentWeeklyGoal.toLocaleString();
    els.u2WeeklyGoal.textContent = currentWeeklyGoal.toLocaleString();
    els.combinedWeeklyGoal.textContent = (currentWeeklyGoal * 2).toLocaleString();

    els.u1WeekPct.textContent = `${Math.round(clamp(u1Pct, 0, 999))}%`;
    els.u2WeekPct.textContent = `${Math.round(clamp(u2Pct, 0, 999))}%`;
    els.sharedWeekPct.textContent = `${Math.round(clamp(sharedPct, 0, 999))}%`;

    setProgressBar(els.u1ProgressBar, u1Pct);
    setProgressBar(els.u2ProgressBar, u2Pct);
    setProgressBar(els.sharedProgressBar, sharedPct);

    const u1Status = statusFromProgress(u1Pct);
    els.u1StatusPill.textContent = u1Status.label;

    const u2Status = statusFromProgress(u2Pct);
    els.u2StatusPill.textContent = u2Status.label;

    const diff = u1Steps - u2Steps;
    const diffText = diff === 0 ? "Both users are neck-and-neck." : diff > 0 ? "Laia is slightly ahead this week." : "Venny is slightly ahead this week.";
    els.comparisonText.textContent = `${diffText} (${u1Steps.toLocaleString()} vs ${u2Steps.toLocaleString()})`;

    // Exercises weekly
    const exercisesTotal = totals.combined.exercises;
    const exercisesPct = state.goals.weeklyExerciseGoal ? (exercisesTotal / state.goals.weeklyExerciseGoal) * 100 : 0;
    els.exercisesWeekTotal.textContent = exercisesTotal.toLocaleString();
    els.exercisesWeekPct.textContent = `${Math.round(clamp(exercisesPct, 0, 999))}%`;

    els.currentWeekPill.textContent = `${weekLabel(weekStart)}`;

    const series1 = dailySeries("u1", 7);
    const series2 = dailySeries("u2", 7);
    renderLineChart(els.u1StepsLineChart, [
      { values: series1.map((p) => ({ iso: p.iso, value: p.value })), stroke: "#420303" },
    ]);
    renderLineChart(els.u2StepsLineChart, [
      { values: series2.map((p) => ({ iso: p.iso, value: p.value })), stroke: "#0524D7" },
    ]);

    const bars = weeklySeriesCombined(8).map((wk) => {
      const d = wk.weekStart;
      const short = d.toLocaleString(undefined, { month: "short" }) + " " + d.getDate();
      return { label: short.replace(/\s+/g, " "), value: wk.value };
    });
    renderBarChart(els.weeklyBarChart, bars);

    const overall = overallGoalStats();
    els.overallStepsTotal.textContent = overall.totalSteps.toLocaleString();
    els.overallGoalPct.textContent = `${Math.round(clamp(overall.pct, 0, 999))}%`;
    els.overallGoalLabel.textContent = `Target: ${overall.totalTarget.toLocaleString()} steps through December 2026 (${overall.totalWeeks} weeks)`;
    setProgressBar(els.overallProgressBar, overall.pct);

    // Recent entries
    renderRecentEntries();
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderRecentEntries() {
    const tbody = els.recentEntriesBody;
    const hint = els.recentEntriesHint;
    const acts = state.activities
      .slice()
      .sort((a, b) => (b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0)))
      .slice(0, 8);

    if (!acts.length) {
      tbody.innerHTML = "";
      hint.textContent = "No entries yet. Start by logging today in the Tracker tab.";
      return;
    }

    tbody.innerHTML = acts
      .map((a) => {
        const u = users.find((x) => x.id === a.userId)?.name || a.userId;
        const stepType = getStepType(a);
        return `
          <tr>
            <td>${escapeHtml(new Date(a.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</td>
            <td>${escapeHtml(u)}</td>
            <td>${safeNumber(a.steps, 0).toLocaleString()}</td>
            <td>${escapeHtml(stepType)}</td>
          </tr>
        `;
      })
      .join("");

    hint.textContent = "Latest saved entries (auto-updates).";
  }

  function renderHistory() {
    // Populate filter options based on stored data and current date window.
    renderHistoryFilterOptions();

    const userFilter = els.historyUserFilter.value;
    const weekFilter = els.historyWeekFilter.value;
    const monthFilter = els.historyMonthFilter.value;

    const filtered = state.activities
      .filter((a) => {
        if (userFilter !== "all" && a.userId !== userFilter) return false;
        if (weekFilter !== "all") {
          const wkStart = parseISODate(weekFilter);
          const wkEnd = endOfWeekMonday(wkStart);
          if (a.date < toISODate(wkStart) || a.date > toISODate(wkEnd)) return false;
        }
        if (monthFilter !== "all") {
          const [y, m] = monthFilter.split("-").map(Number);
          const isoPrefix = `${y}-${String(m).padStart(2, "0")}-`;
          if (!a.date.startsWith(isoPrefix)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0)))
      .slice(0, 10); // Limit to 10 items

    const body = els.historyTableBody;
    const empty = els.historyEmptyState;

    if (!filtered.length) {
      body.innerHTML = "";
      empty.style.display = "block";
    } else {
      empty.style.display = "none";
      body.innerHTML = filtered
        .map((a) => {
          const u = users.find((x) => x.id === a.userId)?.name || a.userId;
          const stepType = getStepType(a);
          const extraExercise = getExtraExercise(a) || "—";
          const notes = a.notes ? a.notes : "—";
          return `
            <tr>
              <td>${escapeHtml(new Date(a.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</td>
              <td>${escapeHtml(u)}</td>
              <td>${safeNumber(a.steps, 0).toLocaleString()}</td>
              <td>${escapeHtml(stepType)}</td>
              <td class="notes">${escapeHtml(extraExercise)}</td>
              <td class="notes">${escapeHtml(notes)}</td>
            </tr>
          `;
        })
        .join("");
    }

    renderHistoryWeeklyComparison(userFilter);
  }

  function renderHistoryFilterOptions() {
    // Week options: from June 2026 onwards.
    const june1_2026 = new Date(2026, 5, 1, 0, 0, 0, 0);
    const weekStart = startOfWeekMonday(june1_2026);
    const end = new Date(2026, 11, 31, 0, 0, 0, 0);
    const weekSel = els.historyWeekFilter;
    const existingWeekValues = new Set(Array.from(weekSel.options).map((o) => o.value));

    // Determine min/max based on activity dates to include relevant weeks.
    const actDates = state.activities.map((a) => a.date);
    const minActIso = actDates.length ? actDates.reduce((min, x) => (x < min ? x : min), actDates[0]) : null;

    const minDate = minActIso ? parseISODate(minActIso) : june1_2026;
    const minWeekStart = startOfWeekMonday(minDate);

    const weeksToAdd = 30;
    for (let i = 0; i < weeksToAdd; i++) {
      const wk = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i * 7, 0, 0, 0, 0);
      if (wk > end) continue;
      if (wk < minWeekStart) continue;
      const wkIso = toISODate(wk);
      if (existingWeekValues.has(wkIso)) continue;
      const opt = document.createElement("option");
      opt.value = wkIso;
      opt.textContent = weekLabel(wk);
      weekSel.appendChild(opt);
    }

    // Month options: from June 2026 through December 2026.
    const monthSel = els.historyMonthFilter;
    const existingMonthValues = new Set(Array.from(monthSel.options).map((o) => o.value));
    const cursor = new Date(2026, 5, 1, 0, 0, 0, 0); // June 2026
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 5 + i, 1, 0, 0, 0, 0);
      if (d > end) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (existingMonthValues.has(key)) continue;
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = d.toLocaleString(undefined, { month: "long", year: "numeric" });
      monthSel.appendChild(opt);
    }
  }

  function renderHistoryWeeklyComparison(userFilter) {
    const container = els.historyWeeklyComparison;
    const today = new Date();
    const currentWeekStart = startOfWeekMonday(today);
    const previousWeekStart = new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate() - 7, 0, 0, 0, 0);

    const weeks = [];
    // Add previous week
    weeks.push({ wk: previousWeekStart, totals: weekTotals(previousWeekStart) });
    // Add current week
    weeks.push({ wk: currentWeekStart, totals: weekTotals(currentWeekStart) });

    // If userFilter is not all, still show combined comparison by week but emphasize one user.
    container.innerHTML = weeks
      .map(({ wk, totals: t }) => {
        const weeklyGoal = getWeeklyStepGoalForDate(wk);
        const pct = weeklyGoal ? (t.combined.steps / weeklyGoal) * 100 : 0;
        const wkEnd = endOfWeekMonday(wk);
        const now = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);

        let badge = "ongoing";
        if (wkEnd < now) badge = t.combined.steps >= weeklyGoal ? "done" : "missed";
        else if (pct >= 100) badge = "done";
        else if (pct < 60) badge = "ongoing";

        const primaryUser = userFilter === "all" ? null : userFilter;
        const u1 = t.perUser.u1.steps;
        const u2 = t.perUser.u2.steps;
        const chosen = primaryUser ? t.perUser[primaryUser].steps : null;

        const u1Style = primaryUser === "u1" ? "font-weight:950" : "";
        const u2Style = primaryUser === "u2" ? "font-weight:950" : "";

        return `
          <div class="card">
            <div class="card-title">${weekLabel(wk)}</div>
            <div class="compare-top">
              <div class="compare-badges">
                <span class="badge ${badge === "done" ? "done" : badge === "missed" ? "missed" : "ongoing"}">
                  ${Math.round(clamp(pct, 0, 999))}% steps
                </span>
                <span class="badge ${t.combined.exercises >= state.goals.weeklyExerciseGoal ? "done" : "ongoing"}">
                  ${t.combined.exercises}/${state.goals.weeklyExerciseGoal} exercises
                </span>
              </div>
            </div>
            <div class="compare-metrics">
              <div class="compare-metric">
                <div class="k">Laia's step count</div>
                <div class="v" style="${u1Style}">${u1.toLocaleString()}</div>
              </div>
              <div class="compare-metric">
                <div class="k">Venny's step count</div>
                <div class="v" style="${u2Style}">${u2.toLocaleString()}</div>
              </div>
              <div class="compare-metric">
                <div class="k">Combined step count</div>
                <div class="v">${t.combined.steps.toLocaleString()}</div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function plannedDailySteps() {
    const weekly = safeNumber(state.goals.weeklyStepGoal, 0);
    // Keep it simple: evenly distribute across days.
    return Math.round(weekly / 7);
  }

  function getWeeklyStepGoalForDate(date) {
    // Fixed goal: all weeks have 1000 steps
    return 1000;
  }

  function renderCalendar() {
    const container = els.calendarContainer;
    const upcomingCards = els.upcomingWeeksCards;
    container.innerHTML = "";
    upcomingCards.innerHTML = "";

    const today = new Date();
    const now = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const end = new Date(2026, 11, 31, 0, 0, 0, 0);

    if (now > end) {
      container.innerHTML = `<div class="muted">Calendar ends at December 2026. No days to show.</div>`;
      return;
    }

    // Upcoming weeks panel: start from June 2026 + next 4
    const june1_2026 = new Date(2026, 5, 1, 0, 0, 0, 0);
    const startWeek = startOfWeekMonday(june1_2026);
    const weeksAhead = 5;
    const weekCards = [];
    for (let i = 0; i < weeksAhead; i++) {
      const wk = new Date(startWeek.getFullYear(), startWeek.getMonth(), startWeek.getDate() + i * 7, 0, 0, 0, 0);
      if (wk > end) continue;
      const totals = weekTotals(wk);
      const weeklyGoal = getWeeklyStepGoalForDate(wk);
      const dailyTarget = Math.round(weeklyGoal / 7);
      const wkEnd = endOfWeekMonday(wk);
      let st = "upcoming";
      if (wkEnd < now) st = totals.combined.steps >= weeklyGoal ? "complete" : "missed";
      else if (wkStartEq(wk, startWeek)) st = totals.combined.steps >= weeklyGoal ? "complete" : (totals.combined.steps > 0 ? "ongoing" : "ongoing");
      else st = "upcoming";

      const plannedWorkout = plannedWorkoutDays
        .map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d])
        .join(" / ");

      const pct = weeklyGoal ? (totals.combined.steps / weeklyGoal) * 100 : 0;
      weekCards.push(`
        <div class="week-card ${st}">
          <div class="week-card-top">
            <div class="week-card-week">${weekLabel(wk)}</div>
            <div class="week-card-badges">${Math.round(clamp(pct, 0, 999))}% steps</div>
          </div>
          <div class="week-card-steps">
            <div>
              <b>${totals.combined.steps.toLocaleString()}</b>
              <div class="week-card-sub">Goal: ${weeklyGoal.toLocaleString()}/week (${dailyTarget.toLocaleString()}/day)</div>
            </div>
            <div>
              <b>${totals.combined.exercises.toLocaleString()}</b>
              <div class="week-card-sub">Workouts: ${plannedWorkout}</div>
            </div>
          </div>
        </div>
      `);
    }
    upcomingCards.innerHTML = weekCards.join("");

    // Month blocks from June 2026 through Dec 2026
    let cursor = new Date(2026, 5, 1, 0, 0, 0, 0); // June 1, 2026
    const currentMonthKey = `2026-6`; // June 2026
    while (cursor <= end) {
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 0, 0, 0, 0);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 0, 0, 0, 0);

      // Build grid from Monday start to Sunday end.
      const gridStart = startOfWeekMonday(monthStart);
      const endWeek = endOfWeekMonday(startOfWeekMonday(monthEnd));
      const dayCount = Math.round((endWeek - gridStart) / (24 * 3600 * 1000)) + 1;

      const days = [];
      for (let i = 0; i < dayCount; i++) {
        const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i, 0, 0, 0, 0);
        days.push(d);
      }

      const dowNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const dowRow = dowNames.map((n) => `<div class="dow">${n}</div>`).join("");

      const cells = days
        .map((d) => {
          const iso = toISODate(d);
          const inMonth = d.getMonth() === cursor.getMonth();

          const stepTotal = combinedStepsForDate(iso);
          const isFuture = d > now;
          const weeklyGoal = getWeeklyStepGoalForDate(d);
          const dailyTargetForDay = Math.round(weeklyGoal / 7);

          let stepStatus = "upcoming";
          if (!isFuture) {
            if (stepTotal >= dailyTargetForDay) stepStatus = "completed";
            else if (stepTotal > 0) stepStatus = "ongoing";
            else stepStatus = "missed";
          }

          const workoutPlanned = plannedWorkoutDays.includes(d.getDay());
          let workoutStatus = "upcoming";
          if (workoutPlanned) {
            const exAny = combinedExercisesForDate(iso) > 0;
            if (isFuture) workoutStatus = "upcoming";
            else workoutStatus = exAny ? "completed" : "missed";
          }

          // Small labels inside cell: show steps only for current/future days to reduce clutter.
          const labelSteps =
            iso === toISODate(now) || d.getTime() > now.getTime() ? `${Math.round(stepTotal / 1000)}k` : "";

          return `
            <div class="day-cell ${inMonth ? "" : "muted-cell"}">
              <div class="day-num">
                <b>${d.getDate()}</b>
                <span>${labelSteps}</span>
              </div>
              <div class="day-indicators">
                <span class="chip-dot chip-step ${stepStatus}" title="Steps status"></span>
                ${
                  workoutPlanned
                    ? `<span class="chip-dot chip-workout ${workoutStatus}" title="Planned workout status"></span>`
                    : `<span class="chip-dot chip-workout upcoming" style="opacity:0.15" title="No workout planned"></span>`
                }
              </div>
            </div>
          `;
        })
        .join("");

      const key = `${cursor.getFullYear()}-${cursor.getMonth() + 1}`;
      const open = key === currentMonthKey ? "open" : "";
      const details = `
        <details class="month-block" ${open}>
          <summary>${monthLabel(cursor)}</summary>
          <div class="month-body">
            <div class="month-grid">
              ${dowRow}
              ${cells}
            </div>
          </div>
        </details>
      `;

      container.insertAdjacentHTML("beforeend", details);

      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 0, 0, 0, 0);
    }
  }

  function wkStartEq(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function getPageIdFromHash() {
    const raw = (window.location.hash || "").replace("#", "").trim();
    return PAGES.includes(raw) ? raw : null;
  }

  function getPageIdFromNavButton(btn) {
    const fromPage = btn.getAttribute("data-page");
    if (fromPage && PAGES.includes(fromPage)) return fromPage;

    // Backwards compatibility: old attribute was `data-scroll="#tracker"`.
    const fromScroll = btn.getAttribute("data-scroll");
    if (fromScroll && fromScroll.startsWith("#")) {
      const id = fromScroll.slice(1);
      return PAGES.includes(id) ? id : null;
    }

    return null;
  }

  function setActivePageUI(pageId) {
    currentPage = pageId;

    document.querySelectorAll(".section").forEach((sec) => {
      sec.classList.toggle("active", sec.id === pageId);
    });

    document.querySelectorAll(".sidebar-link").forEach((btn) => {
      const pid = getPageIdFromNavButton(btn);
      const isActive = pid === pageId;
      btn.classList.toggle("active", isActive);
      if (isActive) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
  }

  function renderPage(pageId) {
    if (pageId === "dashboard") return renderDashboard();
    if (pageId === "tracker") return renderRecentEntries();
    if (pageId === "history") return renderHistory();
    if (pageId === "calendar") return renderCalendar();
  }

  function initNavigation() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".sidebar-link");
      if (!btn) return;

      const pageId = getPageIdFromNavButton(btn);
      if (!pageId) return;

      // Update hash so refresh/bookmark keeps the right page.
      if (window.location.hash !== `#${pageId}`) window.location.hash = pageId;
      switchPage(pageId, { updateHash: false });
    });

    window.addEventListener("hashchange", () => {
      const pageId = getPageIdFromHash();
      if (!pageId || pageId === currentPage) return;
      switchPage(pageId, { updateHash: false });
    });
  }

  function switchPage(pageId, { updateHash = true } = {}) {
    if (!PAGES.includes(pageId)) pageId = "dashboard";

    setActivePageUI(pageId);
    if (updateHash) {
      if (window.location.hash !== `#${pageId}`) window.location.hash = pageId;
    }
    renderPage(pageId);

    // Make navigation feel like a page change.
    const sec = document.getElementById(pageId);
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function initForms() {
    // Activity form
    const form = els.activityForm;
    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const userId = els.activityUser.value;
      const date = els.activityDate.value;
      const steps = Math.max(0, safeNumber(els.activitySteps.value, 0));
      const stepType = normalizeStepType(els.activityStepType.value);
      const extraExercise = (els.activityExtraExercise.value || "").trim();
      const notes = (els.activityNotes.value || "").trim();

      if (!date) {
        toast("Please select a date.");
        return;
      }

      const record = {
        id: uid(),
        userId,
        date,
        steps,
        stepType,
        extraExercise,
        notes: notes || "",
        createdAt: Date.now(),
      };

      addActivity(record);

      // Friendly hint
      els.formHint.textContent = `Saved ${userId === "u1" ? "Laia" : "Venny"} for ${date}.`;

      // Real-time update
      renderAll();
      toast("Entry saved. Dashboard updated.");

      els.activityExtraExercise.value = "";
      els.activityNotes.value = "";
    });

    // Reset all data
    els.btnReset.addEventListener("click", () => {
      const ok = confirm("Reset ALL saved tracker data and goals back to defaults?");
      if (!ok) return;
      state = {
        activities: [],
        goals: { weeklyStepGoal: 70000, weeklyExerciseGoal: 10 },
      };
      saveState();
      renderAll();
      toast("All data cleared.");
    });
  }

  function initHistoryControls() {
    els.historyUserFilter.addEventListener("change", () => renderHistory());
    els.historyWeekFilter.addEventListener("change", () => renderHistory());
    els.historyMonthFilter.addEventListener("change", () => renderHistory());
    els.btnHistoryResetFilters.addEventListener("click", () => {
      els.historyUserFilter.value = "all";
      els.historyWeekFilter.value = "all";
      els.historyMonthFilter.value = "all";
      renderHistory();
      toast("Filters cleared.");
    });
  }

  function renderAll() {
    renderDashboard();
    renderHistory();
    renderCalendar();
  }

  function init() {
    // DOM refs
    els.toast = $("#toast");
    els.btnReset = $("#btnReset");

    // Dashboard
    els.currentWeekPill = $("#currentWeekPill");
    els.todayStepsU1 = $("#todayStepsU1");
    els.todayStepsU2 = $("#todayStepsU2");
    els.u1WeeklyGoal = $("#u1WeeklyGoal");
    els.u2WeeklyGoal = $("#u2WeeklyGoal");
    els.combinedWeeklyGoal = $("#combinedWeeklyGoal");

    els.u1WeekSteps = $("#u1WeekSteps");
    els.u2WeekSteps = $("#u2WeekSteps");
    els.combinedWeekSteps = $("#combinedWeekSteps");

    els.u1WeekPct = $("#u1WeekPct");
    els.u2WeekPct = $("#u2WeekPct");
    els.sharedWeekPct = $("#sharedWeekPct");

    els.u1ProgressBar = $("#u1ProgressBar");
    els.u2ProgressBar = $("#u2ProgressBar");
    els.sharedProgressBar = $("#sharedProgressBar");

    els.u1StatusPill = $("#u1StatusPill");
    els.u2StatusPill = $("#u2StatusPill");
    els.comparisonText = $("#comparisonText");

    els.exercisesWeekTotal = $("#exercisesWeekTotal");
    els.exercisesWeekPct = $("#exercisesWeekPct");

    els.u1StepsLineChart = $("#u1StepsLineChart");
    els.u2StepsLineChart = $("#u2StepsLineChart");
    els.weeklyBarChart = $("#weeklyBarChart");
    els.overallStepsTotal = $("#overallStepsTotal");
    els.overallGoalPct = $("#overallGoalPct");
    els.overallGoalLabel = $("#overallGoalLabel");
    els.overallProgressBar = $("#overallProgressBar");

    // Recent entries
    els.recentEntriesBody = $("#recentEntriesBody");
    els.recentEntriesHint = $("#recentEntriesHint");

    // Tracker
    els.activityForm = $("#activityForm");
    els.activityUser = $("#activityUser");
    els.activityDate = $("#activityDate");
    els.activitySteps = $("#activitySteps");
    els.activityStepType = $("#activityStepType");
    els.activityExtraExercise = $("#activityExtraExercise");
    els.activityNotes = $("#activityNotes");
    els.formHint = $("#formHint");

    // History
    els.historyUserFilter = $("#historyUserFilter");
    els.historyWeekFilter = $("#historyWeekFilter");
    els.historyMonthFilter = $("#historyMonthFilter");
    els.btnHistoryResetFilters = $("#btnHistoryResetFilters");
    els.historyTableBody = $("#historyTableBody");
    els.historyEmptyState = $("#historyEmptyState");
    els.historyWeeklyComparison = $("#historyWeeklyComparison");

    // Calendar
    els.upcomingWeeksCards = $("#upcomingWeeksCards");
    els.calendarContainer = $("#calendarContainer");

    // Fill default date
    const todayISO = toISODate(new Date());
    els.activityDate.value = todayISO;
    els.activitySteps.value = "10000";
    els.activityStepType.value = "walk";
    els.activityExtraExercise.value = "";
    els.activityNotes.value = "";
    els.formHint.textContent = "";

    //loadState();

    const trackerRef = ref(database, "trackerEntries");

    onValue(trackerRef, (snapshot) => {
    const data = snapshot.val();

    if (data) {
        state.activities = Object.values(data);
    } else {
        state.activities = [];
    }
    renderAll();
    });

    // Cross-tab real-time updates.
    

    initNavigation();
    initForms();
    initHistoryControls();

    const initialPage = getPageIdFromHash() || "dashboard";
    setActivePageUI(initialPage);
    renderPage(initialPage);
  }

  document.addEventListener("DOMContentLoaded", init);
})();

