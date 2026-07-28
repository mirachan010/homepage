import {
  calculateMonth,
  calculateRange,
  calculateSchedule,
  findNextStatus,
  getHolidayList,
  getTodayInTokyo
} from "./schedule.js";
import {
  getHolidaySyncStatus,
  getLatestOfficialHolidaySource,
  loadOfficialHolidays,
  officialSourceFromSync,
  syncOfficialHolidays
} from "./holidays.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const PUBLIC_API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=60, s-maxage=300",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Accept",
  "access-control-max-age": "86400",
  "x-api-version": "1"
};

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      const message = status === 500 ? "Internal server error" : error.message;
      if (isPublicApiPath(new URL(request.url).pathname)) {
        return publicError(status === 500 ? "internal_error" : "invalid_request", message, status);
      }
      return json({ error: message }, status);
    }
  },

  async scheduled(controller, env, context) {
    context.waitUntil(
      syncOfficialHolidays(env.DB, "cron").catch(error => {
        console.error("祝日の定期同期に失敗しました", error);
      })
    );
  }
};

async function route(request, env) {
  const url = new URL(request.url);

  if (isPublicApiPath(url.pathname)) {
    return routePublicApi(request, url, env.DB);
  }

  if (url.pathname.startsWith("/shift/edit/") && env.ADMIN_ENABLED !== "true") {
    return new Response("Not found", { status: 404 });
  }

  if (url.pathname === "/api/schedule" && request.method === "GET") {
    const { from, to } = readScheduleRange(url.searchParams);
    return getScheduleData(env.DB, from, to);
  }

  if (url.pathname.startsWith("/api/admin/") && env.ADMIN_ENABLED !== "true") {
    return json({ error: "Admin is disabled" }, 404);
  }

  if (url.pathname === "/api/admin/config" && request.method === "GET") {
    return getAdminConfig(env.DB);
  }

  if (url.pathname === "/api/admin/holidays/status" && request.method === "GET") {
    return json(await getHolidaySyncStatus(env.DB));
  }

  if (url.pathname === "/api/admin/holidays/sync" && request.method === "POST") {
    return json(await syncOfficialHolidays(env.DB, "manual"));
  }

  if (url.pathname.startsWith("/api/admin/exceptions/") && request.method === "GET") {
    return getAdminException(url.pathname.split("/").pop(), env.DB);
  }

  if (url.pathname === "/api/admin/patterns" && request.method === "POST") {
    return savePattern(request, env.DB);
  }

  if (url.pathname === "/api/admin/periods" && request.method === "POST") {
    return addPeriod(request, env.DB);
  }

  if (url.pathname === "/api/admin/exceptions" && request.method === "POST") {
    return saveException(request, env.DB);
  }

  if (url.pathname.startsWith("/api/admin/exceptions/") && request.method === "DELETE") {
    return deleteException(url.pathname.split("/").pop(), env.DB);
  }

  if (url.pathname.startsWith("/api/")) {
    return json({ error: "Not found" }, 404);
  }

  return env.ASSETS.fetch(request);
}

async function routePublicApi(request, url, db) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: PUBLIC_API_HEADERS });
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    return publicError("method_not_allowed", "GETのみ利用できます", 405, {
      allow: "GET, HEAD, OPTIONS"
    });
  }

  let result;
  if (url.pathname === "/api/v1/" || url.pathname === "/api/v1") {
    result = {
      version: "v1",
      timezone: "Asia/Tokyo",
      endpoints: [
        "/api/v1/status",
        "/api/v1/today",
        "/api/v1/next-rest",
        "/api/v1/schedule?from=2026-07-28&days=14",
        "/api/v1/month?year=2026&month=8",
        "/api/v1/holidays?year=2026"
      ]
    };
  } else if (url.pathname === "/api/v1/holidays") {
    const year = readInteger(url.searchParams, "year", 1949, 2099);
    result = await getHolidayYearData(db, year);
  } else if (url.pathname === "/api/v1/schedule") {
    const from = url.searchParams.get("from");
    requireDate(from, "from");
    const days = readInteger(url.searchParams, "days", 1, 400);
    const to = addDays(from, days - 1);
    const data = await loadCalculationData(db, from, to);
    result = {
      timezone: "Asia/Tokyo",
      range: { from, to, days },
      days: calculateRange(from, days, data)
    };
  } else {
    const todayKey = getTodayInTokyo();

    if (url.pathname === "/api/v1/today") {
      const data = await loadCalculationData(db, todayKey, todayKey);
      result = { timezone: "Asia/Tokyo", schedule: calculateSchedule(todayKey, data) };
    } else if (url.pathname === "/api/v1/next-rest") {
      const data = await loadCalculationData(db, todayKey, addDays(todayKey, 366));
      result = {
        timezone: "Asia/Tokyo",
        from: todayKey,
        schedule: findNextStatus(todayKey, "rest", data)
      };
    } else if (url.pathname === "/api/v1/status") {
      const data = await loadCalculationData(db, todayKey, addDays(todayKey, 366));
      result = {
        timezone: "Asia/Tokyo",
        today: calculateSchedule(todayKey, data),
        nextWork: findNextStatus(todayKey, "work", data),
        nextRest: findNextStatus(todayKey, "rest", data)
      };
    } else if (url.pathname === "/api/v1/month") {
      const year = readInteger(url.searchParams, "year", 2000, 2099);
      const month = readInteger(url.searchParams, "month", 1, 12);
      const from = `${year}-${String(month).padStart(2, "0")}-01`;
      const to = monthEnd(year, month);
      const data = await loadCalculationData(db, from, to);
      result = {
        timezone: "Asia/Tokyo",
        year,
        month,
        days: calculateMonth(year, month, data)
      };
    } else {
      return publicError("not_found", "APIが見つかりません", 404);
    }
  }

  return publicJson(result, 200, request.method === "HEAD");
}

async function loadCalculationData(db, from, to) {
  const [patternsResult, periodsResult, exceptionsResult, shiftResult, holidaysResult] = await db.batch([
    db.prepare("SELECT name, definition_json FROM schedule_patterns ORDER BY name"),
    db.prepare(`
      SELECT id, valid_from, pattern_name, base_date
      FROM schedule_periods
      WHERE id = COALESCE(
        (
          SELECT id FROM schedule_periods
          WHERE valid_from <= ?
          ORDER BY valid_from DESC, id DESC
          LIMIT 1
        ),
        (
          SELECT id FROM schedule_periods
          ORDER BY valid_from, id
          LIMIT 1
        )
      )
      OR (valid_from > ? AND valid_from <= ?)
      ORDER BY valid_from, id
    `).bind(from, from, to),
    db.prepare(`
      SELECT schedule_date, mode, status, schedule_type, cycle_shift, note, memo
      FROM schedule_exceptions
      WHERE schedule_date BETWEEN ? AND ?
      ORDER BY schedule_date
    `).bind(from, to),
    db.prepare(`
      SELECT COALESCE(SUM(cycle_shift), 0) AS total
      FROM schedule_exceptions
      WHERE cycle_shift != 0 AND schedule_date < ?
    `).bind(from),
    db.prepare(`
      SELECT holiday_date, name
      FROM holidays
      WHERE holiday_date BETWEEN ? AND ?
      ORDER BY holiday_date
    `).bind(from, to)
  ]);

  const patterns = Object.fromEntries(patternsResult.results.map(row => [
    row.name,
    JSON.parse(row.definition_json)
  ]));
  const periods = periodsResult.results.map(row => ({
    id: row.id,
    from: row.valid_from,
    pattern: row.pattern_name,
    baseDate: row.base_date
  }));
  const exceptions = Object.fromEntries(exceptionsResult.results.map(row => [
    row.schedule_date,
    compact({
      mode: row.mode,
      status: row.status,
      type: row.schedule_type,
      shift: row.cycle_shift || undefined,
      note: row.note || undefined,
      memo: row.memo || undefined
    })
  ]));
  const holidays = Object.fromEntries(holidaysResult.results.map(row => [
    row.holiday_date,
    row.name
  ]));

  return {
    patterns,
    periods,
    exceptions,
    holidays,
    baseCycleShift: Number(shiftResult.results[0]?.total || 0)
  };
}

async function getScheduleData(db, from, to) {
  const [
    patternsResult,
    periodsResult,
    exceptionsResult,
    shiftResult,
    holidaysResult,
    holidaySyncResult
  ] = await db.batch([
    db.prepare("SELECT name, label, definition_json FROM schedule_patterns ORDER BY name"),
    db.prepare(`
      SELECT id, valid_from, pattern_name, base_date, note, created_at
      FROM schedule_periods
      WHERE id = COALESCE(
        (
          SELECT id FROM schedule_periods
          WHERE valid_from <= ?
          ORDER BY valid_from DESC, id DESC
          LIMIT 1
        ),
        (
          SELECT id FROM schedule_periods
          ORDER BY valid_from, id
          LIMIT 1
        )
      )
      OR (valid_from > ? AND valid_from <= ?)
      ORDER BY valid_from, id
    `).bind(from, from, to),
    db.prepare(`
      SELECT schedule_date, mode, status, schedule_type, cycle_shift, note, memo, updated_at
      FROM schedule_exceptions
      WHERE schedule_date BETWEEN ? AND ?
      ORDER BY schedule_date
    `).bind(from, to),
    db.prepare(`
      SELECT COALESCE(SUM(cycle_shift), 0) AS total
      FROM schedule_exceptions
      WHERE cycle_shift != 0 AND schedule_date < ?
    `).bind(from),
    db.prepare(`
      SELECT holiday_date, name
      FROM holidays
      WHERE holiday_date BETWEEN ? AND ?
      ORDER BY holiday_date
    `).bind(from, to),
    db.prepare(`
      SELECT
        status, provider, dataset_key, dataset_id, resource_id, resource_url,
        source_last_modified, source_sha256, checked_at
      FROM holiday_sync_runs
      WHERE status IN ('updated', 'unchanged')
      ORDER BY checked_at DESC, rowid DESC
      LIMIT 1
    `)
  ]);

  const patterns = {};
  for (const row of patternsResult.results) {
    patterns[row.name] = {
      ...JSON.parse(row.definition_json),
      label: row.label
    };
  }

  const periods = periodsResult.results.map(row => ({
    id: row.id,
    from: row.valid_from,
    pattern: row.pattern_name,
    baseDate: row.base_date,
    note: row.note,
    createdAt: row.created_at
  }));

  const exceptions = {};
  for (const row of exceptionsResult.results) {
    exceptions[row.schedule_date] = compact({
      mode: row.mode,
      status: row.status,
      type: row.schedule_type,
      shift: row.cycle_shift || undefined,
      note: row.note || undefined,
      memo: row.memo || undefined,
      updatedAt: row.updated_at
    });
  }
  const holidays = Object.fromEntries(holidaysResult.results.map(row => [
    row.holiday_date,
    row.name
  ]));
  const syncRow = holidaySyncResult.results[0];
  const holidaySource = syncRow ? officialSourceFromSync({
    status: syncRow.status,
    provider: syncRow.provider,
    datasetKey: syncRow.dataset_key,
    datasetId: syncRow.dataset_id,
    resourceId: syncRow.resource_id,
    resourceUrl: syncRow.resource_url,
    sourceLastModified: syncRow.source_last_modified,
    checkedAt: syncRow.checked_at,
    sha256: syncRow.source_sha256
  }) : null;

  return json({
    settings: {
      title: "みら勤務表",
      patterns,
      periods,
      baseCycleShift: Number(shiftResult.results[0]?.total || 0)
    },
    exceptions,
    holidays,
    holidaySource,
    range: { from, to }
  });
}

async function getHolidayYearData(db, year) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [official, sync] = await Promise.all([
    loadOfficialHolidays(db, from, to),
    getLatestOfficialHolidaySource(db)
  ]);
  const officialEntries = Object.entries(official);

  if (officialEntries.length > 0) {
    return {
      year,
      provisional: false,
      source: sync,
      holidays: officialEntries.map(([date, name]) => ({ date, name }))
    };
  }

  return {
    year,
    provisional: true,
    source: {
      kind: "calculated",
      provider: "mirachan.net組み込み規則",
      note: "公式CSV未掲載のため暫定値。正式公表後に自動で置き換わります"
    },
    holidays: getHolidayList(year)
  };
}

async function getAdminConfig(db) {
  const [patternsResult, periodsResult] = await db.batch([
    db.prepare("SELECT name, label, definition_json FROM schedule_patterns ORDER BY name"),
    db.prepare(`
      SELECT id, valid_from, pattern_name, base_date, note, created_at
      FROM schedule_periods
      ORDER BY valid_from, id
    `)
  ]);

  const patterns = Object.fromEntries(patternsResult.results.map(row => [
    row.name,
    { ...JSON.parse(row.definition_json), label: row.label }
  ]));
  const periods = periodsResult.results.map(row => ({
    id: row.id,
    from: row.valid_from,
    pattern: row.pattern_name,
    baseDate: row.base_date,
    note: row.note,
    createdAt: row.created_at
  }));
  return json({ settings: { title: "みら勤務表", patterns, periods } });
}

async function getAdminException(date, db) {
  requireDate(date, "date");
  const row = await db.prepare(`
    SELECT schedule_date, mode, status, schedule_type, cycle_shift, note, memo, updated_at
    FROM schedule_exceptions
    WHERE schedule_date = ?
    LIMIT 1
  `).bind(date).first();

  if (!row) return json({ date, exception: null });
  return json({
    date,
    exception: compact({
      mode: row.mode,
      status: row.status,
      type: row.schedule_type,
      shift: row.cycle_shift || undefined,
      note: row.note || undefined,
      memo: row.memo || undefined,
      updatedAt: row.updated_at
    })
  });
}

async function savePattern(request, db) {
  const body = await readJson(request);
  requireText(body.name, "name");
  requireText(body.label, "label");

  const definition = body.definition;
  if (!definition || !["cycle", "weekday", "manual"].includes(definition.type)) {
    throw new HttpError(400, "definition.type が不正です");
  }

  await db.prepare(`
    INSERT INTO schedule_patterns (name, label, definition_json)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      label = excluded.label,
      definition_json = excluded.definition_json,
      updated_at = CURRENT_TIMESTAMP
  `).bind(body.name, body.label, JSON.stringify(definition)).run();

  return json({ ok: true });
}

async function addPeriod(request, db) {
  const body = await readJson(request);
  requireDate(body.validFrom, "validFrom");
  requireText(body.patternName, "patternName");
  if (body.baseDate) requireDate(body.baseDate, "baseDate");

  await db.prepare(`
    INSERT INTO schedule_periods (valid_from, pattern_name, base_date, note)
    VALUES (?, ?, ?, ?)
  `).bind(
    body.validFrom,
    body.patternName,
    body.baseDate || null,
    body.note || ""
  ).run();

  return json({ ok: true }, 201);
}

async function saveException(request, db) {
  const body = await readJson(request);
  requireDate(body.scheduleDate, "scheduleDate");

  if (body.mode && !["day", "night"].includes(body.mode)) {
    throw new HttpError(400, "mode が不正です");
  }
  if (body.status && !["work", "rest"].includes(body.status)) {
    throw new HttpError(400, "status が不正です");
  }
  if (body.type && !["paid_leave", "holiday_work"].includes(body.type)) {
    throw new HttpError(400, "type が不正です");
  }

  const shift = Number(body.shift || 0);
  if (!Number.isInteger(shift) || shift < -31 || shift > 31) {
    throw new HttpError(400, "shift は -31〜31 の整数にしてください");
  }

  const status = body.type === "paid_leave"
    ? "rest"
    : (body.type === "holiday_work" ? "work" : (body.status || null));

  await db.prepare(`
    INSERT INTO schedule_exceptions
      (schedule_date, mode, status, schedule_type, cycle_shift, note, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(schedule_date) DO UPDATE SET
      mode = excluded.mode,
      status = excluded.status,
      schedule_type = excluded.schedule_type,
      cycle_shift = excluded.cycle_shift,
      note = excluded.note,
      memo = excluded.memo,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    body.scheduleDate,
    body.mode || null,
    status,
    body.type || null,
    shift,
    body.note || "",
    body.memo || ""
  ).run();

  return json({ ok: true });
}

async function deleteException(date, db) {
  requireDate(date, "date");
  await db.prepare("DELETE FROM schedule_exceptions WHERE schedule_date = ?")
    .bind(date)
    .run();
  return json({ ok: true });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "JSONを読み取れません");
  }
}

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${name} は必須です`);
  }
}

function requireDate(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${name} は YYYY-MM-DD 形式にしてください`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${name} は実在する日付にしてください`);
  }
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== "")
  );
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function publicJson(data, status = 200, omitBody = false, extraHeaders = {}) {
  return new Response(omitBody ? null : JSON.stringify(data), {
    status,
    headers: { ...PUBLIC_API_HEADERS, ...extraHeaders }
  });
}

function publicError(code, message, status, extraHeaders = {}) {
  return publicJson({ error: { code, message } }, status, false, extraHeaders);
}

function readInteger(searchParams, name, minimum, maximum) {
  const value = searchParams.get(name);
  if (!value || !/^\d+$/.test(value)) {
    throw new HttpError(400, `${name} は必須の整数です`);
  }

  const number = Number(value);
  if (number < minimum || number > maximum) {
    throw new HttpError(400, `${name} は ${minimum}〜${maximum} にしてください`);
  }
  return number;
}

function readScheduleRange(searchParams) {
  const today = getTodayInTokyo();
  const from = searchParams.get("from") || addDays(today, -45);
  const to = searchParams.get("to") || addDays(today, 150);
  requireDate(from, "from");
  requireDate(to, "to");

  const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000;
  if (days < 0 || days > 400) {
    throw new HttpError(400, "取得範囲は400日以内にしてください");
  }
  return { from, to };
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthEnd(year, month) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function isPublicApiPath(pathname) {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
