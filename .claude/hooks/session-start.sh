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
