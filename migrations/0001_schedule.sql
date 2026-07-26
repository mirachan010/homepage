CREATE TABLE schedule_patterns (
  name TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schedule_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  valid_from TEXT NOT NULL,
  pattern_name TEXT NOT NULL REFERENCES schedule_patterns(name),
  base_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_schedule_periods_valid_from
  ON schedule_periods(valid_from);

CREATE TABLE schedule_exceptions (
  schedule_date TEXT PRIMARY KEY,
  mode TEXT CHECK (mode IS NULL OR mode IN ('day', 'night')),
  status TEXT CHECK (status IS NULL OR status IN ('work', 'rest')),
  cycle_shift INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_schedule_exceptions_date
  ON schedule_exceptions(schedule_date);

INSERT INTO schedule_patterns (name, label, definition_json)
VALUES (
  'continuous3',
  '連操3日単位',
  '{"type":"cycle","patternBlocks":[{"mode":"night","status":"rest","days":3},{"mode":"night","status":"work","days":3},{"mode":"night","status":"rest","days":3},{"mode":"night","status":"work","days":3},{"mode":"day","status":"rest","days":3},{"mode":"day","status":"work","days":3},{"mode":"day","status":"rest","days":3},{"mode":"day","status":"work","days":3}]}'
);

INSERT INTO schedule_patterns (name, label, definition_json)
VALUES (
  'weekday',
  '平常勤務',
  '{"type":"weekday","mode":"day","workdays":[1,2,3,4,5]}'
);

INSERT INTO schedule_periods (valid_from, pattern_name, base_date, note)
VALUES ('2026-04-24', 'continuous3', '2026-04-24', 'JSONから移行');

INSERT INTO schedule_exceptions
  (schedule_date, mode, status, cycle_shift, note, memo)
VALUES
  ('2026-05-18', NULL, 'work', 0, '休日出勤', '帰りに買い物'),
  ('2026-07-14', NULL, 'rest', 0, '有給', '旅行'),
  ('2026-07-15', NULL, 'rest', 0, '有給', '旅行'),
  ('2026-07-16', NULL, 'rest', 0, '有給', '旅行'),
  ('2026-08-03', NULL, NULL, 1, 'シフトズレ', ''),
  ('2026-08-18', NULL, NULL, 0, '', '予定だけ書く例');
