CREATE INDEX idx_schedule_exceptions_shift_date
  ON schedule_exceptions(schedule_date)
  WHERE cycle_shift != 0;
