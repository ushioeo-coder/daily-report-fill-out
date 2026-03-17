/**
 * マイグレーション修復スクリプト
 *
 * 状況:
 *   - 004_attendance_nightshift.sql: DBには適用済みだが schema_migrations に未記録
 *   - 005_paid_leave.sql: DBには適用済みだが schema_migrations に未記録
 *   → 002の適用後にスクリプト外で直接実行されたため未記録になっている
 *
 * このスクリプトは上記2ファイルを「適用済み」として登録し、
 *   その後 006_fix_time_constraints.sql を新規適用する。
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// .env.local 読み込み
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([^#\s][^=]*)=(.*)/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/\r$/, '').replace(/^['"](.*)['"]$/, '$1');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL が未設定です');
  process.exit(1);
}

async function repair() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    console.log('DB接続成功');

    // schema_migrations テーブルが存在するか確認
    const { rows: tables } = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'"
    );
    if (tables.length === 0) {
      console.error('schema_migrations テーブルが存在しません。先に migrate.js を実行してください。');
      process.exit(1);
    }

    // 既に記録されているバージョン一覧を取得
    const { rows: applied } = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(applied.map(r => r.version));
    console.log('適用済みとして記録されているマイグレーション:', [...appliedSet]);

    // DBに実際に適用されているが schema_migrations に未記録のファイル
    const toRecord = [
      '004_attendance_nightshift.sql',
      '005_paid_leave.sql',
    ];

    for (const version of toRecord) {
      if (appliedSet.has(version)) {
        console.log(`スキップ: ${version} は既に記録済み`);
      } else {
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
          [version]
        );
        console.log(`記録: ${version} を schema_migrations に追加しました`);
      }
    }

    // 006_fix_time_constraints.sql を適用
    const migrationFile = '006_fix_time_constraints.sql';
    if (appliedSet.has(migrationFile)) {
      console.log(`スキップ: ${migrationFile} は既に適用済み`);
    } else {
      const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', migrationFile);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(`適用中: ${migrationFile}`);
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [migrationFile]
      );
      console.log(`✓ 完了: ${migrationFile}`);
    }

  } catch (err) {
    console.error('エラー:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

repair();
