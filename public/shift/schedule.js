const COMPACT_QUERY = "(max-width: 560px)";
const compactMedia = window.matchMedia(COMPACT_QUERY);

let config = null;
let currentMonth = new Date();
const loadedHolidayYears = new Set();

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("prevBtn").addEventListener("click", showPreviousMonth);
  document.getElementById("nextBtn").addEventListener("click", showNextMonth);

  if (typeof compactMedia.addEventListener === "function") {
    compactMedia.addEventListener("change", renderCalendarIfReady);
  } else if (typeof compactMedia.addListener === "function") {
    compactMedia.addListener(renderCalendarIfReady);
  }

  loadConfig();
});

async function loadConfig() {
  try {
    const scheduleData = await fetchScheduleData();
    const currentYear = new Date().getFullYear();
    const holidays = JapaneseHolidays.getHolidayMapForYears([
      currentYear - 1,
      currentYear,
      currentYear + 1
    ]);
    loadedHolidayYears.add(currentYear - 1);
    loadedHolidayYears.add(currentYear);
    loadedHolidayYears.add(currentYear + 1);

    config = { ...scheduleData, holidays };
    document.getElementById("pageTitle").textContent = config.settings.title || "みら勤務表";
    validateConfig(config);
    renderCalendar();
  } catch (error) {
    showLoadError(error);
  }
}

async function fetchScheduleData() {
  try {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    if (response.ok) return response.json();
  } catch {
    // GitHub Pagesや単純なローカルサーバーではJSONへ戻す。
  }

  const [settings, exceptions] = await Promise.all([
    fetchJson("settings.json", {}),
    fetchJson("exceptions.json", {})
  ]);
  return { settings, exceptions };
}

async function fetchJson(path, fallback) {
  const response = await fetch(path, { cache: "no-store" });

  if (response.status === 404) {
    return fallback;
  }

  if (!response.ok) {
    throw new Error(`${path} を読み込めませんでした`);
  }

  return response.json();
}

function validateConfig(config) {
  if (!Array.isArray(config.settings.periods) || config.settings.periods.length === 0) {
    throw new Error("settings.json の periods が未設定です");
  }

  if (!config.settings.patterns) {
    throw new Error("settings.json の patterns が未設定です");
  }

  for (const period of config.settings.periods) {
    if (!period.pattern) {
      throw new Error("settings.json の period に pattern がありません");
    }

    if (!config.settings.patterns[period.pattern]) {
      throw new Error(`settings.json の patterns に ${period.pattern} がありません`);
    }
  }
}

function renderCalendarIfReady() {
  if (config) {
    renderCalendar();
  }
}

function showLoadError(error) {
  const errorElement = document.getElementById("loadError");
  errorElement.classList.remove("hidden");
  errorElement.textContent = "読み込みエラー: " + error.message;

  document.getElementById("currentStatus").textContent =
    "ローカル確認時は python -m http.server 8000 を起動して http://localhost:8000/shift/ から開いてください。";
}

function parseDate(dateText) {
  const parts = dateText.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDayDiff(fromDate, toDate) {
  const from = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const to = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.floor((to - from) / 86400000);
}

function getMondayBasedWeekday(date) {
  return (date.getDay() + 6) % 7;
}

function isCompactView() {
  return compactMedia.matches;
}

function getActivePeriod(date) {
  const periods = [...config.settings.periods].sort((a, b) => parseDate(a.from) - parseDate(b.from));
  let active = periods[0];

  for (const period of periods) {
    if (date >= parseDate(period.from)) {
      active = period;
    } else {
      break;
    }
  }

  return active;
}

function resolvePeriod(period) {
  return {
    ...config.settings.patterns[period.pattern],
    ...period,
    patternName: period.pattern
  };
}

function expandPatternBlocks(blocks) {
  const pattern = [];

  for (const block of blocks || []) {
    const days = Number(block.days || 0);

    for (let i = 0; i < days; i++) {
      pattern.push({ mode: block.mode, status: block.status });
    }
  }

  return pattern;
}

function getCycleShiftOffset(date) {
  let offset = 0;
  const targetKey = formatDateKey(date);

  for (const [dateKey, item] of Object.entries(config.exceptions || {})) {
    if (dateKey <= targetKey && typeof item.shift === "number") {
      offset += item.shift;
    }
  }

  return offset;
}

function isHoliday(date, period) {
  const key = formatDateKey(date);
  return Boolean(config.holidays[key]) || Boolean((period.holidays || {})[key]);
}

function getHolidayName(date) {
  const key = formatDateKey(date);
  const value = config.holidays[key];

  if (!value) {
    return "";
  }

  return value === true ? "祝日" : String(value);
}

function getSchedule(date) {
  const period = resolvePeriod(getActivePeriod(date));
  const key = formatDateKey(date);
  let baseSchedule;

  if (period.type === "weekday") {
    baseSchedule = calculateWeekdaySchedule(date, period);
  } else if (period.type === "cycle") {
    baseSchedule = calculateCycleSchedule(date, period);
  } else {
    baseSchedule = calculateManualSchedule(date, period);
  }

  const override = config.exceptions[key] || {};

  return {
    mode: override.mode || baseSchedule.mode,
    status: override.status || baseSchedule.status,
    note: override.note || baseSchedule.note || "",
    memo: override.memo || baseSchedule.memo || "",
    ruleType: period.type,
    patternName: period.patternName
  };
}

function calculateWeekdaySchedule(date, period) {
  const workdays = period.workdays || [1, 2, 3, 4, 5];
  const isWorkday = workdays.includes(date.getDay()) && !isHoliday(date, period);
  return { mode: period.mode || "day", status: isWorkday ? "work" : "rest" };
}

function calculateCycleSchedule(date, period) {
  const pattern = expandPatternBlocks(period.patternBlocks);

  if (pattern.length === 0) {
    throw new Error("cycle pattern の patternBlocks が空です");
  }

  const baseDate = parseDate(period.baseDate || period.from);
  const indexBase = getDayDiff(baseDate, date) + getCycleShiftOffset(date);
  const index = ((indexBase % pattern.length) + pattern.length) % pattern.length;
  return pattern[index];
}

function calculateManualSchedule(date, period) {
  const key = formatDateKey(date);
  const manual = (period.days || {})[key];

  if (manual) {
    return manual;
  }

  return { mode: period.defaultMode || "day", status: period.defaultStatus || "rest" };
}

function renderCalendar() {
  const year = currentMonth.getFullYear();
  ensureHolidayYears(year);
  const month = currentMonth.getMonth();
  const firstDate = new Date(year, month, 1);
  const lastDate = new Date(year, month + 1, 0);
  const calendarBody = document.getElementById("calendarBody");

  document.getElementById("monthTitle").textContent = `${year}年${month + 1}月`;
  calendarBody.innerHTML = "";

  const startOffset = getMondayBasedWeekday(firstDate);
  const calendarStart = new Date(year, month, 1 - startOffset);
  const cellCount = Math.ceil((startOffset + lastDate.getDate()) / 7) * 7;

  let row = document.createElement("tr");

  for (let i = 0; i < cellCount; i++) {
    const date = new Date(
      calendarStart.getFullYear(),
      calendarStart.getMonth(),
      calendarStart.getDate() + i
    );

    if (i > 0 && i % 7 === 0) {
      calendarBody.appendChild(row);
      row = document.createElement("tr");
    }

    row.appendChild(createDayCell(date, date.getMonth() === month));
  }

  calendarBody.appendChild(row);
  updateCurrentStatus();
}

function ensureHolidayYears(year) {
  for (const targetYear of [year - 1, year, year + 1]) {
    if (loadedHolidayYears.has(targetYear)) continue;
    Object.assign(config.holidays, JapaneseHolidays.getHolidayMapForYears([targetYear]));
    loadedHolidayYears.add(targetYear);
  }
}

function createDayCell(date, isCurrentMonth) {
  const schedule = getSchedule(date);
  const cell = document.createElement("td");

  cell.classList.add(isCurrentMonth ? (schedule.mode === "day" ? "day-mode" : "night-mode") : "other-month");

  if (isToday(date)) {
    cell.classList.add("today");
  }

  const dayNumber = createDiv("day-number", String(date.getDate()));
  applyDateColorClasses(dayNumber, date);
  cell.appendChild(dayNumber);
  cell.appendChild(createDiv("mode-label", getModeText(schedule.mode)));
  cell.appendChild(createDiv(schedule.status, getStatusText(schedule.status)));

  appendSmartInfo(cell, {
    text: schedule.note,
    shortClassName: "date-note",
    badgeClassName: "note-badge",
    icon: "📌",
    shortPrefix: "",
    label: "note"
  });

  appendSmartInfo(cell, {
    text: schedule.memo,
    shortClassName: "date-memo",
    badgeClassName: "memo-badge",
    icon: "📝",
    shortPrefix: "",
    label: "memo"
  });

  const holidayName = getHolidayName(date);
  appendSmartInfo(cell, {
    text: holidayName,
    shortClassName: "date-holiday-name",
    badgeClassName: "holiday-badge",
    icon: "🎌",
    shortPrefix: "祝 ",
    label: "祝日"
  });

  return cell;
}

function appendSmartInfo(cell, options) {
  const text = options.text || "";

  if (!text) {
    return;
  }

  const displayText = options.shortPrefix + text;
  const inlineElement = createDiv(options.shortClassName, displayText);
  cell.appendChild(inlineElement);

  if (!isOverflowing(inlineElement)) {
    return;
  }

  inlineElement.remove();

  const badge = createDiv(options.badgeClassName + " tooltip-badge", options.icon);
  badge.title = text;
  badge.dataset.tooltip = text;
  badge.setAttribute("aria-label", options.label + ": " + text);
  badge.tabIndex = 0;
  cell.appendChild(badge);
}

function isOverflowing(element) {
  return element.scrollWidth > element.clientWidth;
}

function applyDateColorClasses(element, date) {
  const day = date.getDay();

  if (day === 6) {
    element.classList.add("date-sat");
  }

  if (day === 0) {
    element.classList.add("date-sun");
  }

  if (isHoliday(date, resolvePeriod(getActivePeriod(date)))) {
    element.classList.add("date-holiday");
  }
}

function createDiv(className, text) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return div;
}

function getModeText(mode) {
  return isCompactView() ? (mode === "day" ? "🌞" : "🌙") : (mode === "day" ? "🌞昼" : "🌙夜");
}

function getStatusText(status) {
  return isCompactView() ? (status === "work" ? "仕" : "休") : (status === "work" ? "仕事" : "休み");
}

function getFullModeText(mode) {
  return mode === "day" ? "🌞昼" : "🌙夜";
}

function getFullStatusText(status) {
  return status === "work" ? "仕事" : "休み";
}

function isToday(date) {
  const today = new Date();
  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
}

function updateCurrentStatus() {
  const today = getSchedule(new Date());
  const nextWork = findNextDateByStatus("work");
  const nextRest = findNextDateByStatus("rest");
  const memoLine = today.memo ? `<br>今日のメモ: ${escapeHtml(today.memo)}` : "";

  document.getElementById("currentStatus").innerHTML =
    `現在: ${getFullModeText(today.mode)} / ${getFullStatusText(today.status)}<br>`
    + `次の仕事: ${formatDisplayDate(nextWork)}<br>`
    + `次の休み: ${formatDisplayDate(nextRest)}${memoLine}`;
}

function findNextDateByStatus(status) {
  const start = new Date();

  for (let i = 1; i <= 120; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);

    if (getSchedule(date).status === status) {
      return date;
    }
  }

  return null;
}

function formatDisplayDate(date) {
  return date ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}` : "不明";
}

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function showPreviousMonth() {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  renderCalendar();
}

function showNextMonth() {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  renderCalendar();
}
