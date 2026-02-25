#!/bin/bash
set -euo pipefail

# Web環境のみで実行
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# PostgreSQL を起動（停止していても safe に実行）
sudo service postgresql start 2>/dev/null || true

# PostgreSQL が起動するまで待機（最大10秒）
for i in $(seq 1 10); do
  if sudo service postgresql status 2>/dev/null | grep -q "online"; then
    break
  fi
  sleep 1
done

# npm 依存パッケージをインストール
cd "${CLAUDE_PROJECT_DIR}"
npm install

# DB ユーザー・データベースのセットアップ（初回のみ・冪等）
sudo -u postgres psql -c "CREATE USER app_user WITH PASSWORD 'app_password';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE daily_report OWNER app_user;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE daily_report TO app_user;" 2>/dev/null || true

# マイグレーション適用（users テーブルが未存在の場合のみ）
TABLES_EXIST=$(PGPASSWORD=app_password psql -h localhost -U app_user -d daily_report \
  -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='users';" 2>/dev/null || echo "0")

if [ "${TABLES_EXIST}" = "0" ]; then
  echo "マイグレーションを適用中..."
  PGPASSWORD=app_password psql -h localhost -U app_user -d daily_report \
    -f "${CLAUDE_PROJECT_DIR}/supabase/migrations/001_init.sql"
  PGPASSWORD=app_password psql -h localhost -U app_user -d daily_report \
    -f "${CLAUDE_PROJECT_DIR}/supabase/migrations/002_seed.sql"
  echo "マイグレーション完了"
else
  echo "DBは既にセットアップ済みです"
fi

# Next.js 開発サーバーを起動（既に起動している場合はスキップ）
if ! curl -s -o /dev/null -f http://localhost:3000 2>/dev/null; then
  nohup npm run dev > /tmp/nextjs-dev.log 2>&1 &
  echo "Next.js 開発サーバーをバックグラウンドで起動しました (http://localhost:3000)"
  # サーバーが起動するまで待機（最大30秒）
  for i in $(seq 1 30); do
    if curl -s -o /dev/null -f http://localhost:3000 2>/dev/null; then
      echo "Next.js サーバーが起動しました"
      break
    fi
    sleep 1
  done
else
  echo "Next.js サーバーはすでに起動しています"
fi
