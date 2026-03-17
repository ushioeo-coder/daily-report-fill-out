-- 有給付与記録テーブル
CREATE TABLE IF NOT EXISTS paid_leave_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_date    DATE NOT NULL,           -- 有給付与年月日
  granted_days  NUMERIC(4, 1) NOT NULL,  -- 付与日数（0.5刻みを想定）
  expiry_date   DATE NOT NULL,           -- 有効期限（労基法上の原則は付与から2年）
  note          TEXT,                    -- 備考
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_id での検索を高速化するインデックス
CREATE INDEX IF NOT EXISTS idx_paid_leave_grants_user_id
  ON paid_leave_grants(user_id);
