-- 初期ユーザー作成
-- パスワード: password123 (本番運用前に必ず変更すること)
INSERT INTO users (employee_id, password_hash, role, name) VALUES
  ('0001', '$2b$10$2Mu22r.MlESOWQ/kVyKI4u5erceS8m52jWMzzIc/tCjfOyUD2F3vm', 'admin', '管理者'),
  ('0002', '$2b$10$2Mu22r.MlESOWQ/kVyKI4u5erceS8m52jWMzzIc/tCjfOyUD2F3vm', 'user',  'テストユーザー')
ON CONFLICT (employee_id) DO NOTHING;
