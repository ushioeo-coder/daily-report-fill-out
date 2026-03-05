-- =============================================================
-- 日報アプリ カラム追加マイグレーション
-- daily_reports テーブルに 4つの打刻カラムを追加
-- =============================================================

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS site_arrival_time smallint NULL
    CHECK (site_arrival_time BETWEEN 0 AND 1439),
  ADD COLUMN IF NOT EXISTS work_start_time   smallint NULL
    CHECK (work_start_time BETWEEN 0 AND 1439),
  ADD COLUMN IF NOT EXISTS work_end_time     smallint NULL
    CHECK (work_end_time BETWEEN 0 AND 1439),
  ADD COLUMN IF NOT EXISTS return_time       smallint NULL
    CHECK (return_time BETWEEN 0 AND 1439);
