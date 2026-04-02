-- =============================================================
-- 30日編集制限トリガーを削除
--
-- 背景: API Route 側で30日制限チェックを「無制限化のため撤廃」したが、
--       DB トリガー (trg_check_edit_window) が残ったままだったため、
--       初回保存（INSERT）は成功するが再保存（ON CONFLICT DO UPDATE）で
--       30日以上前の日付のレコードが更新できず 500 エラーになっていた。
-- =============================================================

DROP TRIGGER IF EXISTS trg_check_edit_window ON daily_reports;
DROP FUNCTION IF EXISTS check_edit_window();
