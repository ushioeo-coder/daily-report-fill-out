-- =============================================================
-- 日報アプリ 初期マイグレーション
-- =============================================================

-- -------------------------
-- 1. テーブル作成
-- -------------------------

CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   char(4)     UNIQUE NOT NULL,
  password_hash text        NOT NULL,
  role          text        NOT NULL DEFAULT 'user'
                            CHECK (role IN ('user', 'admin')),
  name          text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily_reports (
  id          uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date date      NOT NULL,
  start_time  smallint  NULL CHECK (start_time BETWEEN 0 AND 1439),
  end_time    smallint  NULL CHECK (end_time   BETWEEN 0 AND 1439),
  note        text      NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, report_date)
);

CREATE TABLE sessions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text        UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -------------------------
-- 2. インデックス
-- -------------------------

-- セッショントークンの検索高速化 (UNIQUE で自動作成されるが明示)
-- daily_reports の日付範囲検索
CREATE INDEX idx_daily_reports_user_date ON daily_reports (user_id, report_date);
-- 期限切れセッション削除用
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

-- -------------------------
-- 3. updated_at 自動更新トリガー
-- -------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON daily_reports
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- -------------------------
-- 4. 30日編集制限トリガー
--    (API Route 側でも同じチェックを行う二重防御)
-- -------------------------

CREATE OR REPLACE FUNCTION check_edit_window()
RETURNS TRIGGER AS $$
BEGIN
  -- service_role key でのアクセス、または admin ロールはスキップ
  IF current_setting('app.current_user_role', true) = 'admin' THEN
    RETURN NEW;
  END IF;

  -- 30日を超えた日付のレコードは更新不可
  IF OLD.report_date < CURRENT_DATE - INTERVAL '30 days' THEN
    RAISE EXCEPTION 'Cannot edit reports older than 30 days';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_edit_window
  BEFORE UPDATE ON daily_reports
  FOR EACH ROW
  EXECUTE FUNCTION check_edit_window();

-- -------------------------
-- 5. RLS (保険的設定)
--    実運用では service_role key でアクセスするため RLS はバイパスされる。
--    Supabase Dashboard 等からの直接操作時の安全弁。
-- -------------------------

ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_own_reports" ON daily_reports
  FOR ALL
  USING (
    user_id = current_setting('app.current_user_id', true)::uuid
    OR current_setting('app.current_user_role', true) = 'admin'
  )
  WITH CHECK (
    user_id = current_setting('app.current_user_id', true)::uuid
    OR current_setting('app.current_user_role', true) = 'admin'
  );

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_own_profile" ON users
  FOR SELECT
  USING (
    id = current_setting('app.current_user_id', true)::uuid
    OR current_setting('app.current_user_role', true) = 'admin'
  );

-- sessions は API Route 経由のみアクセスするため RLS は不要
-- (service_role key でバイパスされる前提)
