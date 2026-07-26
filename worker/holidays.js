const DATASET_KEY = "cao_20190522_0002";
const KNOWN_RESOURCE_ID = "d9ad35a5-6c9c-4127-bdbe-aa138fdffe42";
const METADATA_URL =
  `https://data.e-gov.go.jp/data/api/action/package_show?id=${DATASET_KEY}`;
const OFFICIAL_HOST = "www8.cao.go.jp";
const OFFICIAL_PATH = "/chosei/shukujitsu/syukujitsu.csv";
const PROVIDER = "e-Govデータポータル";
const MAX_ERROR_LENGTH = 500;

export async function syncOfficialHolidays(db, triggerType = "cron", fetchImpl = fetch) {
  if (!["cron", "manual"].includes(triggerType)) {
    throw new Error("祝日同期のtriggerTypeが不正です");
  }

  const syncId = crypto.randomUUID();
  let source = {
    datasetKey: DATASET_KEY,
    datasetId: null,
    resourceId: null,
    resourceUrl: null,
    sourceLastModified: null,
    sourceEtag: null,
    sourceSha256: null
  };

  try {
    const metadataResponse = await fetchImpl(METADATA_URL, {
      headers: { accept: "application/json" }
    });
    if (!metadataResponse.ok) {
      throw new Error(`e-Govメタデータ取得に失敗しました (${metadataResponse.status})`);
    }

    const metadata = await metadataResponse.json();
    if (!metadata.success || !metadata.result) {
      throw new Error("e-Govメタデータの形式が不正です");
    }

    const resource = selectOfficialCsvResource(metadata.result.resources || []);
    source = {
      ...source,
      datasetId: metadata.result.id || null,
      resourceId: resource.id || null,
      resourceUrl: resource.url,
      sourceLastModified: resource.last_modified || metadata.result.metadata_modified || null
    };

    const csvResponse = await fetchImpl(resource.url, {
      headers: { accept: "text/csv,*/*;q=0.1" }
    });
    if (!csvResponse.ok) {
      throw new Error(`内閣府の祝日CSV取得に失敗しました (${csvResponse.status})`);
    }

    const csvBytes = await csvResponse.arrayBuffer();
    source.sourceLastModified =
      csvResponse.headers.get("last-modified") || source.sourceLastModified;
    source.sourceEtag = csvResponse.headers.get("etag");
    source.sourceSha256 = await sha256(csvBytes);

    const holidays = parseOfficialHolidayCsv(csvBytes);
    if (holidays.length < 500) {
      throw new Error(`祝日CSVの件数が少なすぎます (${holidays.length}件)`);
    }

    const previous = await db.prepare(`
      SELECT source_sha256
      FROM holiday_sync_runs
      WHERE status IN ('updated', 'unchanged') AND source_sha256 IS NOT NULL
      ORDER BY checked_at DESC, rowid DESC
      LIMIT 1
    `).first();

    const common = {
      syncId,
      triggerType,
      source,
      rowCount: holidays.length,
      firstDate: holidays[0].date,
      lastDate: holidays.at(-1).date
    };

    if (previous?.source_sha256 === source.sourceSha256) {
      await insertSyncRun(db, { ...common, status: "unchanged" });
      return toSyncResult({ ...common, status: "unchanged" });
    }

    const statements = [
      syncRunStatement(db, { ...common, status: "updated" }),
      ...holidayUpsertStatements(db, holidays, syncId),
      db.prepare("DELETE FROM holidays WHERE source_sync_id != ?").bind(syncId)
    ];
    await db.batch(statements);
    return toSyncResult({ ...common, status: "updated" });
  } catch (error) {
    const message = String(error?.message || error).slice(0, MAX_ERROR_LENGTH);
    try {
      await insertSyncRun(db, {
        syncId,
        triggerType,
        status: "failed",
        source,
        rowCount: 0,
        firstDate: null,
        lastDate: null,
        errorMessage: message
      });
    } catch (recordError) {
      console.error("祝日同期エラーの記録にも失敗しました", recordError);
    }
    throw error;
  }
}

export function parseOfficialHolidayCsv(arrayBuffer) {
  let text;
  try {
    text = new TextDecoder("shift_jis", { fatal: true }).decode(arrayBuffer);
  } catch {
    text = new TextDecoder("utf-8", { fatal: true }).decode(arrayBuffer);
  }

  const rows = [];
  const seen = new Set();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let index = 1; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    const columns = parseCsvLine(lines[index]);
    if (columns.length < 2) {
      throw new Error(`祝日CSV ${index + 1}行目の形式が不正です`);
    }

    const date = normalizeDate(columns[0]);
    const name = columns.slice(1).join(",").trim();
    if (!date || !name) {
      throw new Error(`祝日CSV ${index + 1}行目の日付または名称が不正です`);
    }
    if (seen.has(date)) {
      throw new Error(`祝日CSVに日付の重複があります (${date})`);
    }
    seen.add(date);
    rows.push({ date, name });
  }

  return rows.sort((left, right) => left.date.localeCompare(right.date));
}

export async function loadOfficialHolidays(db, from, to) {
  const result = await db.prepare(`
    SELECT holiday_date, name
    FROM holidays
    WHERE holiday_date BETWEEN ? AND ?
    ORDER BY holiday_date
  `).bind(from, to).all();

  return Object.fromEntries(
    result.results.map(row => [row.holiday_date, row.name])
  );
}

export async function getHolidaySyncStatus(db) {
  const latest = await db.prepare(`
    SELECT
      sync_id, trigger_type, status, provider, dataset_key, dataset_id,
      resource_id, resource_url, source_last_modified, source_etag,
      source_sha256, row_count, first_date, last_date, error_message, checked_at
    FROM holiday_sync_runs
    ORDER BY checked_at DESC, rowid DESC
    LIMIT 1
  `).first();

  if (!latest) {
    return {
      status: "not_synced",
      provider: PROVIDER,
      datasetKey: DATASET_KEY
    };
  }
  return formatSyncRow(latest);
}

export async function getLatestOfficialHolidaySource(db) {
  const latest = await db.prepare(`
    SELECT
      sync_id, trigger_type, status, provider, dataset_key, dataset_id,
      resource_id, resource_url, source_last_modified, source_etag,
      source_sha256, row_count, first_date, last_date, error_message, checked_at
    FROM holiday_sync_runs
    WHERE status IN ('updated', 'unchanged')
    ORDER BY checked_at DESC, rowid DESC
    LIMIT 1
  `).first();

  return latest ? officialSourceFromSync(formatSyncRow(latest)) : null;
}

export function officialSourceFromSync(sync) {
  if (!sync || !["updated", "unchanged"].includes(sync.status)) return null;
  return {
    kind: "official",
    provider: sync.provider,
    datasetKey: sync.datasetKey,
    datasetId: sync.datasetId,
    resourceId: sync.resourceId,
    resourceUrl: sync.resourceUrl,
    sourceLastModified: sync.sourceLastModified,
    retrievedAt: sync.checkedAt,
    sha256: sync.sha256
  };
}

export const HOLIDAY_SOURCE = {
  provider: PROVIDER,
  datasetKey: DATASET_KEY,
  metadataUrl: METADATA_URL,
  knownResourceId: KNOWN_RESOURCE_ID
};

function selectOfficialCsvResource(resources) {
  const known = resources.find(item =>
    item.id === KNOWN_RESOURCE_ID && isOfficialCsvUrl(item.url)
  );
  if (known) return known;

  const discovered = resources.find(item =>
    String(item.format || "").toUpperCase() === "CSV" && isOfficialCsvUrl(item.url)
  );
  if (discovered) return discovered;

  throw new Error("e-Govメタデータから内閣府の祝日CSVを特定できません");
}

function isOfficialCsvUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === OFFICIAL_HOST
      && url.pathname === OFFICIAL_PATH;
  } catch {
    return false;
  }
}

function holidayUpsertStatements(db, holidays, syncId) {
  const chunkSize = 25;
  const statements = [];

  for (let offset = 0; offset < holidays.length; offset += chunkSize) {
    const chunk = holidays.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "(?, ?, ?)").join(", ");
    const values = chunk.flatMap(item => [item.date, item.name, syncId]);
    statements.push(db.prepare(`
      INSERT INTO holidays (holiday_date, name, source_sync_id)
      VALUES ${placeholders}
      ON CONFLICT(holiday_date) DO UPDATE SET
        name = excluded.name,
        source_sync_id = excluded.source_sync_id,
        updated_at = CURRENT_TIMESTAMP
    `).bind(...values));
  }
  return statements;
}

async function insertSyncRun(db, data) {
  await syncRunStatement(db, data).run();
}

function syncRunStatement(db, data) {
  return db.prepare(`
    INSERT INTO holiday_sync_runs (
      sync_id, trigger_type, status, provider, dataset_key, dataset_id,
      resource_id, resource_url, source_last_modified, source_etag,
      source_sha256, row_count, first_date, last_date, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.syncId,
    data.triggerType,
    data.status,
    PROVIDER,
    data.source.datasetKey,
    data.source.datasetId,
    data.source.resourceId,
    data.source.resourceUrl,
    data.source.sourceLastModified,
    data.source.sourceEtag,
    data.source.sourceSha256,
    data.rowCount,
    data.firstDate,
    data.lastDate,
    data.errorMessage || null
  );
}

function toSyncResult(data) {
  return {
    status: data.status,
    provider: PROVIDER,
    datasetKey: data.source.datasetKey,
    resourceId: data.source.resourceId,
    resourceUrl: data.source.resourceUrl,
    sourceLastModified: data.source.sourceLastModified,
    sha256: data.source.sourceSha256,
    rowCount: data.rowCount,
    firstDate: data.firstDate,
    lastDate: data.lastDate
  };
}

function formatSyncRow(row) {
  return {
    syncId: row.sync_id,
    triggerType: row.trigger_type,
    status: row.status,
    provider: row.provider,
    datasetKey: row.dataset_key,
    datasetId: row.dataset_id,
    resourceId: row.resource_id,
    resourceUrl: row.resource_url,
    sourceLastModified: row.source_last_modified,
    etag: row.source_etag,
    sha256: row.source_sha256,
    rowCount: row.row_count,
    firstDate: row.first_date,
    lastDate: row.last_date,
    error: row.error_message,
    checkedAt: row.checked_at
  };
}

async function sha256(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseCsvLine(line) {
  const columns = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      columns.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  columns.push(value);
  return columns;
}

function normalizeDate(value) {
  const match = String(value).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === date ? date : null;
}
