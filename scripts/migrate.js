/**
 * PostgreSQL マイグレーションスクリプト
 * アプリ起動時に自動実行される (npm start)
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;
const CONNECTION_TIMEOUT_MS = 10000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDatabaseUrl() {
  // マイグレーションには DIRECT_URL (Supabase直接接続) を優先。
  // なければ DATABASE_URL (pooler 経由) を使用。
  return process.env.DIRECT_URL || process.env.DATABASE_URL;
}

function maskUrl(url) {
  try {
    const u = new URL(url);
    u.password = '***';
    return u.toString();
  } catch {
    return '(invalid URL)';
  }
}

function createClient(url) {
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  return new Client({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
}

async function connectWithRetry(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = createClient(url);
    try {
      await client.connect();
      console.log('データベースに接続しました');
      return client;
    } catch (err) {
      try { await client.end(); } catch (_) {}
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt; // exponential-ish backoff
        console.log(`DB接続失敗 (${attempt}/${MAX_RETRIES}): ${err.message} — ${delay}ms後にリトライ...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

async function migrate() {
  const url = getDatabaseUrl();
  if (!url) {
    console.log('DATABASE_URL が未設定のためマイグレーションをスキップします');
    return;
  }

  console.log(`マイグレーション接続先: ${maskUrl(url)}`);

  let client;
  try {
    client = await connectWithRetry(url);

    // マイグレーション管理テーブル
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [file]
      );

      if (rows.length > 0) {
        console.log(`スキップ: ${file} (適用済み)`);
        continue;
      }

      console.log(`適用中: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [file]
      );
      console.log(`完了: ${file}`);
    }

    console.log('マイグレーション完了');
  } catch (err) {
    console.error('マイグレーションエラー:', err.message);
    // テーブルが既に Supabase に存在する場合、接続失敗でもサーバー起動を続行する。
    // 致命的な接続障害の場合はアプリ側 (pg.Pool) で再度エラーになるが、
    // 一時的な接続不安定ならサーバー起動後に回復する可能性がある。
    console.log('⚠ マイグレーションに失敗しましたが、サーバー起動を続行します');
  } finally {
    if (client) {
      try { await client.end(); } catch (_) {}
    }
  }
}

migrate();
