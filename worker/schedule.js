const DAY_MS = 86400000;
const SPECIAL_SCHEDULE_TYPES = {
  paid_leave: {
    status: "rest",
    cycleGroup: "work",
    label: "有給"
  },
  holiday_work: {
    status: "work",
    cycleGroup: "rest",
    label: "休出"
  }
};

export function calculateSchedule(dateKey, data) {
  const period = resolvePeriod(dateKey, data);
  const exception = data.exceptions[dateKey] || {};
  let base;

  if (period.type === "weekday") {
    base = calculateWeekday(dateKey, period, data);
  } else if (period.type === "cycle") {
    base = calculateCycle(dateKey, period, data.exceptions);
  } else {
    base = calculateManual(dateKey, period);
  }

  const mode = exception.mode || base.mode || "day";
  const specialType = SPECIAL_SCHEDULE_TYPES[exception.type];
  const status = specialType?.status || exception.status || base.status || "rest";
  const type = specialType
    ? exception.type
    : (status === "work" ? "regular_work" : "regular_rest");
  const cycleGroup = specialType?.cycleGroup || status;
  const label = specialType?.label
    || (status === "work" ? (mode === "night" ? "夜勤" : "昼勤") : "休み");
  const holiday = data.holidays?.[dateKey] || getHolidayName(dateKey);
  const note = exception.note || base.note || "";
  const memo = exception.memo || base.memo || "";

  return {
    date: dateKey,
    weekday: getWeekday(dateKey),
    mode,
    modeLabel: mode === "night" ? "夜" : "昼",
    status,
    statusLabel: status === "work" ? "仕事" : "休み",
    type,
    cycleGroup,
    label,
    holiday: holiday || null,
    ...(note ? { note } : {}),
    ...(memo ? { memo } : {})
  };
}

export function calculateMonth(year, month, data) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];

  for (let day = 1; day <= lastDay; day++) {
    days.push(calculateSchedule(formatDate(year, month, day), data));
  }

  return days;
}

export function calculateRange(fromDateKey, days, data) {
  const start = parseDate(fromDateKey);
  const schedule = [];

  for (let offset = 0; offset < days; offset++) {
    const date = new Date(start.getTime() + offset * DAY_MS);
    schedule.push(calculateSchedule(formatDateObject(date), data));
  }

  return schedule;
}

export function findNextStatus(startDateKey, status, data, maxDays = 366) {
  const start = parseDate(startDateKey);

  for (let offset = 1; offset <= maxDays; offset++) {
    const dateKey = formatDateObject(new Date(start.getTime() + offset * DAY_MS));
    const schedule = calculateSchedule(dateKey, data);
    if (schedule.status === status) {
      return { ...schedule, daysUntil: offset };
    }
  }

  return null;
}

export function getHolidayList(year) {
  return [...getHolidays(year)]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, name]) => ({ date, name }));
}

export function getTodayInTokyo(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function resolvePeriod(dateKey, data) {
  const periods = [...data.periods].sort((a, b) =>
    a.from.localeCompare(b.from) || a.id - b.id
  );
  let active = periods[0];

  for (const period of periods) {
    if (period.from <= dateKey) active = period;
    else break;
  }

  if (!active) throw new Error("勤務期間が設定されていません");
  const pattern = data.patterns[active.pattern];
  if (!pattern) throw new Error(`勤務パターン ${active.pattern} が見つかりません`);

  return { ...pattern, ...active, baseCycleShift: data.baseCycleShift || 0 };
}

function calculateWeekday(dateKey, period, data) {
  const workdays = period.workdays || [1, 2, 3, 4, 5];
  const day = parseDate(dateKey).getUTCDay();
  const holiday = data.holidays?.[dateKey]
    || getHolidayName(dateKey)
    || period.holidays?.[dateKey];
  return {
    mode: period.mode || "day",
    status: workdays.includes(day) && !holiday ? "work" : "rest"
  };
}

function calculateCycle(dateKey, period, exceptions) {
  const pattern = [];
  for (const block of period.patternBlocks || []) {
    for (let index = 0; index < Number(block.days || 0); index++) {
      pattern.push({ mode: block.mode, status: block.status });
    }
  }

  if (pattern.length === 0) throw new Error("周期パターンが空です");

  const baseDate = period.baseDate || period.from;
  const shift = Number(period.baseCycleShift || 0) + Object.entries(exceptions)
    .filter(([exceptionDate, item]) =>
      exceptionDate <= dateKey && Number.isInteger(item.shift)
    )
    .reduce((total, [, item]) => total + item.shift, 0);
  const rawIndex = dayDiff(baseDate, dateKey) + shift;
  const index = ((rawIndex % pattern.length) + pattern.length) % pattern.length;
  return pattern[index];
}

function calculateManual(dateKey, period) {
  return period.days?.[dateKey] || {
    mode: period.defaultMode || "day",
    status: period.defaultStatus || "rest"
  };
}

function getHolidayName(dateKey) {
  return getHolidays(Number(dateKey.slice(0, 4))).get(dateKey) || "";
}

function getWeekday(dateKey) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][parseDate(dateKey).getUTCDay()];
}

function dayDiff(from, to) {
  return Math.floor((parseDate(to) - parseDate(from)) / DAY_MS);
}

function parseDate(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`);
}

function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDateObject(date) {
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function getHolidays(year) {
  const holidays = new Map();
  addNationalHolidays(holidays, year);
  addCitizensHolidays(holidays, year);
  addSubstituteHolidays(holidays, year);
  return holidays;
}

function addHoliday(map, year, month, day, name) {
  map.set(formatDate(year, month, day), name);
}

function nthMonday(year, month, nth) {
  const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((8 - firstDay) % 7) + (nth - 1) * 7;
}

function vernalEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function addNationalHolidays(map, year) {
  addHoliday(map, year, 1, 1, "元日");

  if (year >= 2000) addHoliday(map, year, 1, nthMonday(year, 1, 2), "成人の日");
  else if (year >= 1949) addHoliday(map, year, 1, 15, "成人の日");

  if (year >= 2020) addHoliday(map, year, 2, 23, "天皇誕生日");
  else if (year >= 1989 && year <= 2018) addHoliday(map, year, 12, 23, "天皇誕生日");

  if (year >= 1967) addHoliday(map, year, 2, 11, "建国記念の日");
  addHoliday(map, year, 3, vernalEquinoxDay(year), "春分の日");

  if (year >= 2007) addHoliday(map, year, 4, 29, "昭和の日");
  else if (year >= 1989) addHoliday(map, year, 4, 29, "みどりの日");
  else addHoliday(map, year, 4, 29, "天皇誕生日");

  addHoliday(map, year, 5, 3, "憲法記念日");
  if (year >= 2007) addHoliday(map, year, 5, 4, "みどりの日");
  addHoliday(map, year, 5, 5, "こどもの日");

  if (year >= 1996) {
    addHoliday(map, year, 7, year >= 2003 ? nthMonday(year, 7, 3) : 20, "海の日");
  }
  if (year >= 2016) addHoliday(map, year, 8, 11, "山の日");
  if (year >= 2003) addHoliday(map, year, 9, nthMonday(year, 9, 3), "敬老の日");
  else if (year >= 1966) addHoliday(map, year, 9, 15, "敬老の日");
  addHoliday(map, year, 9, autumnalEquinoxDay(year), "秋分の日");
  if (year >= 2000) addHoliday(map, year, 10, nthMonday(year, 10, 2), "スポーツの日");
  else if (year >= 1966) addHoliday(map, year, 10, 10, "体育の日");
  addHoliday(map, year, 11, 3, "文化の日");
  addHoliday(map, year, 11, 23, "勤労感謝の日");

  const special = {
    1959: [["04-10", "皇太子明仁親王の結婚の儀"]],
    1989: [["02-24", "昭和天皇の大喪の礼"]],
    1990: [["11-12", "即位礼正殿の儀"]],
    1993: [["06-09", "皇太子徳仁親王の結婚の儀"]],
    2019: [["05-01", "天皇の即位の日"], ["10-22", "即位礼正殿の儀"]]
  };
  for (const [date, name] of special[year] || []) {
    map.set(`${year}-${date}`, name);
  }

  applyOlympicOverrides(map, year);
}

function applyOlympicOverrides(map, year) {
  if (year === 2020) {
    map.delete("2020-07-20");
    map.delete("2020-08-11");
    map.delete("2020-10-12");
    addHoliday(map, 2020, 7, 23, "海の日");
    addHoliday(map, 2020, 7, 24, "スポーツの日");
    addHoliday(map, 2020, 8, 10, "山の日");
  } else if (year === 2021) {
    map.delete("2021-07-19");
    map.delete("2021-08-11");
    map.delete("2021-10-11");
    addHoliday(map, 2021, 7, 22, "海の日");
    addHoliday(map, 2021, 7, 23, "スポーツの日");
    addHoliday(map, 2021, 8, 8, "山の日");
  }
}

function addCitizensHolidays(map, year) {
  if (year < 1986) return;
  const date = new Date(Date.UTC(year, 0, 2));
  const end = new Date(Date.UTC(year, 11, 30));

  while (date <= end) {
    const previous = new Date(date.getTime() - DAY_MS);
    const next = new Date(date.getTime() + DAY_MS);
    const key = formatDateObject(date);
    if (!map.has(key) && map.has(formatDateObject(previous)) && map.has(formatDateObject(next))) {
      map.set(key, "国民の休日");
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
}

function addSubstituteHolidays(map, year) {
  if (year < 1973) return;

  for (const key of [...map.keys()].sort()) {
    const date = parseDate(key);
    if (date.getUTCDay() !== 0) continue;

    do {
      date.setUTCDate(date.getUTCDate() + 1);
    } while (year >= 2007 && map.has(formatDateObject(date)));

    const substitute = formatDateObject(date);
    if (!map.has(substitute)) map.set(substitute, "振替休日");
  }
}
