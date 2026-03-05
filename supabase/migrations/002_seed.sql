-- 初期管理者ユーザー作成
-- ┌──────────────────────────────────────────────────────┐
-- │  ⚠ 初期パスワード: password123                       │
-- │  本番デプロイ後、最初のログインで必ずパスワードを変更！  │
-- │  ON CONFLICT DO NOTHING により既存ユーザーには影響なし  │
-- └──────────────────────────────────────────────────────┘
INSERT INTO users (employee_id, password_hash, role, name) VALUES
  ('0001', '$2b$10$ub8pXkd4K02eOwwkJy.uLOm9ODhmjHy8gqAH4W2sdXDjGQb/4BJ/i', 'admin', '管理者')
ON CONFLICT (employee_id) DO NOTHING;
