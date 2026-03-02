/**
 * PostgreSQL マイグレーションスクリプト
 * アプリ起動時に自動実行される (npm start)
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1|\.railway\.internal/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
}

async function connectWithRetry() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = createClient();
    try {
      await client.connect();
      console.log('データベースに接続しました');
      return client;
    } catch (err) {
      try { await client.end(); } catch (_) {}
      if (attempt < MAX_RETRIES) {
        console.log(`DB接続失敗 (${attempt}/${MAX_RETRIES}): ${err.message} — ${RETRY_DELAY_MS}ms後にリトライ...`);
        await sleep(RETRY_DELAY_MS);
      } else {
        throw err;
      }
    }
  }
}

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL が未設定のためマイグレーションをスキップします');
    return;
  }

  let client;
  try {
    client = await connectWithRetry();

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
    process.exit(1);
  } finally {
    if (client) {
      try { await client.end(); } catch (_) {}
    }
  }
}

migrate();
