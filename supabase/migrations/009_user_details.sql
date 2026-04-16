-- 009: usersテーブルに入社日と所属部署を追加
-- 有給休暇管理簿のExcel出力で使用する項目

ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT DEFAULT '';
