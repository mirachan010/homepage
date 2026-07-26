import {
  calculateMonth,
  calculateSchedule,
  findNextStatus,
  getHolidayList,
  getTodayInTokyo
} from "./schedule.js";

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
    return getScheduleData(env.DB);
  }

  if (url.pathname.startsWith("/api/admin/") && env.ADMIN_ENABLED !== "true") {
    return json({ error: "Admin is disabled" }, 404);
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
        "/api/v1/month?year=2026&month=8",
        "/api/v1/holidays?year=2026"
      ]
    };
  } else if (url.pathname === "/api/v1/holidays") {
    const year = readInteger(url.searchParams, "year", 1949, 2099);
    result = { year, holidays: getHolidayList(year) };
  } else {
    const data = await loadCalculationData(db);
    const todayKey = getTodayInTokyo();

    if (url.pathname === "/api/v1/today") {
      result = { timezone: "Asia/Tokyo", schedule: calculateSchedule(todayKey, data) };
    } else if (url.pathname === "/api/v1/next-rest") {
      result = {
        timezone: "Asia/Tokyo",
        from: todayKey,
        schedule: findNextStatus(todayKey, "rest", data)
      };
    } else if (url.pathname === "/api/v1/status") {
      result = {
        timezone: "Asia/Tokyo",
        today: calculateSchedule(todayKey, data),
        nextWork: findNextStatus(todayKey, "work", data),
        nextRest: findNextStatus(todayKey, "rest", data)
      };
    } else if (url.pathname === "/api/v1/month") {
      const year = readInteger(url.searchParams, "year", 2000, 2099);
      const month = readInteger(url.searchParams, "month", 1, 12);
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

async function loadCalculationData(db) {
  const [patternsResult, periodsResult, exceptionsResult] = await db.batch([
    db.prepare("SELECT name, definition_json FROM schedule_patterns ORDER BY name"),
    db.prepare(`
      SELECT id, valid_from, pattern_name, base_date
      FROM schedule_periods
      ORDER BY valid_from, id
    `),
    db.prepare(`
      SELECT schedule_date, mode, status, cycle_shift
      FROM schedule_exceptions
      ORDER BY schedule_date
    `)
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
      shift: row.cycle_shift || undefined
    })
  ]));

  return { patterns, periods, exceptions };
}

async function getScheduleData(db) {
  const [patternsResult, periodsResult, exceptionsResult] = await db.batch([
    db.prepare("SELECT name, label, definition_json FROM schedule_patterns ORDER BY name"),
    db.prepare(`
      SELECT id, valid_from, pattern_name, base_date, note, created_at
      FROM schedule_periods
      ORDER BY valid_from, id
    `),
    db.prepare(`
      SELECT schedule_date, mode, status, cycle_shift, note, memo, updated_at
      FROM schedule_exceptions
      ORDER BY schedule_date
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
      shift: row.cycle_shift || undefined,
      note: row.note || undefined,
      memo: row.memo || undefined,
      updatedAt: row.updated_at
    });
  }

  return json({
    settings: { title: "みら勤務表", patterns, periods },
    exceptions
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

  const shift = Number(body.shift || 0);
  if (!Number.isInteger(shift) || shift < -31 || shift > 31) {
    throw new HttpError(400, "shift は -31〜31 の整数にしてください");
  }

  await db.prepare(`
    INSERT INTO schedule_exceptions
      (schedule_date, mode, status, cycle_shift, note, memo)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(schedule_date) DO UPDATE SET
      mode = excluded.mode,
      status = excluded.status,
      cycle_shift = excluded.cycle_shift,
      note = excluded.note,
      memo = excluded.memo,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    body.scheduleDate,
    body.mode || null,
    body.status || null,
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

function isPublicApiPath(pathname) {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
