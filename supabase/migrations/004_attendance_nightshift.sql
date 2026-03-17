-- 出勤区分の列を追加（NULL = 未入力）
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS attendance_type VARCHAR(10) DEFAULT NULL;

-- 出勤区分は所定の値のみ許容
ALTER TABLE daily_reports
  ADD CONSTRAINT check_attendance_type CHECK (
    attendance_type IS NULL OR attendance_type IN (
      '出勤', '欠勤', '休日', '有給', '振休', '休日出勤'
    )
  );

-- 時刻フィールドのsmallintはそのまま使用する
-- (PostgreSQL smallint max = 32767。アプリ側バリデーションを0〜2879に拡張することで夜勤対応。)
