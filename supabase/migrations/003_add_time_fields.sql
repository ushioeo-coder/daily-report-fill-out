-- =============================================================
-- 時間入力項目の追加
-- 出社時間(start_time), 退勤時間(end_time) に加え、
-- 現場到着時間, 作業開始時間, 作業終了時間, 帰社時間 の4列を追加
-- =============================================================

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS site_arrival_time smallint NULL CHECK (site_arrival_time BETWEEN 0 AND 1439),
  ADD COLUMN IF NOT EXISTS work_start_time   smallint NULL CHECK (work_start_time   BETWEEN 0 AND 1439),
  ADD COLUMN IF NOT EXISTS work_end_time     smallint NULL CHECK (work_end_time     BETWEEN 0 AND 1439),
  ADD COLUMN IF NOT EXISTS return_time       smallint NULL CHECK (return_time       BETWEEN 0 AND 1439);
