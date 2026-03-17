-- =============================================================
-- 時刻フィールドの CHECK 制約を夜勤対応に拡張
-- 変更前: BETWEEN 0 AND 1439 (23:59まで)
-- 変更後: BETWEEN 0 AND 2879 (47:59まで)
--
-- 背景: Chunk 2（夜勤対応）でアプリ側バリデーションを 2879 に
--       拡張したが、DB 側の制約が 1439 のままだったため、
--       25:00 以降の値を保存すると CHECK 違反エラーになっていた。
--
-- PostgreSQL の自動命名規則: {テーブル名}_{列名}_check
-- =============================================================

-- 旧制約（0〜1439）を削除
ALTER TABLE daily_reports
  DROP CONSTRAINT IF EXISTS daily_reports_start_time_check,
  DROP CONSTRAINT IF EXISTS daily_reports_end_time_check,
  DROP CONSTRAINT IF EXISTS daily_reports_site_arrival_time_check,
  DROP CONSTRAINT IF EXISTS daily_reports_work_start_time_check,
  DROP CONSTRAINT IF EXISTS daily_reports_work_end_time_check,
  DROP CONSTRAINT IF EXISTS daily_reports_return_time_check;

-- 新制約（0〜2879: 最大 47:59 まで対応）を追加
ALTER TABLE daily_reports
  ADD CONSTRAINT daily_reports_start_time_check
    CHECK (start_time BETWEEN 0 AND 2879),
  ADD CONSTRAINT daily_reports_end_time_check
    CHECK (end_time BETWEEN 0 AND 2879),
  ADD CONSTRAINT daily_reports_site_arrival_time_check
    CHECK (site_arrival_time BETWEEN 0 AND 2879),
  ADD CONSTRAINT daily_reports_work_start_time_check
    CHECK (work_start_time BETWEEN 0 AND 2879),
  ADD CONSTRAINT daily_reports_work_end_time_check
    CHECK (work_end_time BETWEEN 0 AND 2879),
  ADD CONSTRAINT daily_reports_return_time_check
    CHECK (return_time BETWEEN 0 AND 2879);
