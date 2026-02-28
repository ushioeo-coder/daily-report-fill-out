/**
 * Neon (PostgreSQL) マイグレーションスクリプト
 * Vercel ビルド時に自動実行される
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL が未設定のためマイグレーションをスキップします');
    return;
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    console.log('データベースに接続しました');

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
    await client.end();
  }
}

migrate();
