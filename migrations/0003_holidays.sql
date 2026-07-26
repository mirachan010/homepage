CREATE TABLE holidays (
  holiday_date TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_sync_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE holiday_sync_runs (
  sync_id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('cron', 'manual')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('updated', 'unchanged', 'failed')
  ),
  provider TEXT NOT NULL DEFAULT 'e-Govデータポータル',
  dataset_key TEXT NOT NULL,
  dataset_id TEXT,
  resource_id TEXT,
  resource_url TEXT,
  source_last_modified TEXT,
  source_etag TEXT,
  source_sha256 TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  first_date TEXT,
  last_date TEXT,
  error_message TEXT,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_holiday_sync_runs_checked_at
  ON holiday_sync_runs(checked_at DESC);
