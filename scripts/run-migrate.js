/**
 * .env.local を読み込んでからマイグレーションを実行するラッパー。
 * 本番では Next.js が自動で .env.local を読むが、スタンドアロン実行時はこのファイルを使う。
 */
const fs = require('fs');
const path = require('path');

// .env.local を手動で読み込む
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    // コメント行・空行はスキップ
    const match = line.match(/^([^#\s][^=]*)=(.*)/);
    if (match) {
      const key = match[1].trim();
      // 前後の引用符を除去、末尾の\rを除去（Windows改行対策）
      const val = match[2].trim().replace(/\r$/, '').replace(/^['"](.*)['"]$/, '$1');
      if (!process.env[key]) { // 既に設定済みの場合は上書きしない
        process.env[key] = val;
      }
    }
  }
  console.log('✓ .env.local を読み込みました');
} else {
  console.log('⚠ .env.local が見つかりません');
}

// マイグレーション実行
require('./migrate.js');
