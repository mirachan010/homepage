ALTER TABLE schedule_exceptions
ADD COLUMN schedule_type TEXT
CHECK (
  schedule_type IS NULL
  OR schedule_type IN ('paid_leave', 'holiday_work')
);

UPDATE schedule_exceptions
SET schedule_type = 'paid_leave'
WHERE schedule_type IS NULL
  AND note LIKE '%有給%';

UPDATE schedule_exceptions
SET schedule_type = 'holiday_work'
WHERE schedule_type IS NULL
  AND (note LIKE '%休日出勤%' OR note LIKE '%休出%');
