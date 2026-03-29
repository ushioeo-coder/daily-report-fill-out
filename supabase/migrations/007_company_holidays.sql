-- 法定休日管理テーブル
-- 管理者が設定した法定休日の日付を保存する
-- ※ アクセス制御はAPIルート側（getSession）で実施しているため、RLSポリシーは不要
CREATE TABLE IF NOT EXISTS company_holidays (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date  DATE NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- holiday_date での検索を高速化するインデックス
CREATE INDEX IF NOT EXISTS idx_company_holidays_date
  ON company_holidays(holiday_date);
