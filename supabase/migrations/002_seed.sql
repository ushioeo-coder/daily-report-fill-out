-- 初期管理者ユーザー作成
-- ┌──────────────────────────────────────────────────────┐
-- │  ⚠ 初期パスワード: password123                       │
-- │  本番デプロイ後、最初のログインで必ずパスワードを変更！  │
-- │  ON CONFLICT DO NOTHING により既存ユーザーには影響なし  │
-- └──────────────────────────────────────────────────────┘
INSERT INTO users (employee_id, password_hash, role, name) VALUES
  ('0001', '$2b$10$2Mu22r.MlESOWQ/kVyKI4u5erceS8m52jWMzzIc/tCjfOyUD2F3vm', 'admin', '管理者')
ON CONFLICT (employee_id) DO NOTHING;
