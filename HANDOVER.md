# 引継ぎ書 — 日報管理システム

## ブランチ
- 開発ブランチ: `claude/debug-login-401-error-v9NE8`
- リモートにpush済み

## プロジェクト概要
Next.js 16.1.6 (Turbopack) + ローカル PostgreSQL による日報管理Webアプリ。
PWA対応済み。Supabase互換のカスタムクエリビルダーでDB接続している。

## 技術スタック
- **フレームワーク**: Next.js 16.1.6 (App Router, Turbopack)
- **DB**: ローカル PostgreSQL (`daily_report` データベース)
- **DB接続**: `lib/supabase.ts` に独自のSupabase互換クエリビルダー（pg poolベース）
- **認証**: bcryptパスワードハッシュ + セッションCookie + proxy.ts（ミドルウェア）
- **起動**: `npm run dev` (localhost:3000)

## 現在の状態（2026-02-24 時点）

**正常動作中。** ブラウザからのログインが可能な状態。

- PostgreSQL 起動済み、`daily_report` DB に初期ユーザー2名が登録されている
- 社員番号 `0001`（管理者）/ `0002`（一般）でログイン可能（パスワード: `password123`）
- デバッグログはすべて削除済み

## 解決済み問題: ブラウザからのログインが401エラーになる

### 症状（解決前）
- ブラウザで http://localhost:3000/login にアクセスし、社員番号 `0001` / パスワード `password123` でログインすると「社員番号またはパスワードが正しくありません。」と表示される
- curlでは同じリクエストが200で成功していた

### 根本原因
seed データ (`supabase/migrations/002_seed.sql`) が PostgreSQL に未適用のため、
`users` テーブルにユーザーが存在せず、`single()` が `PGRST116` を返してパスワード比較がスキップされ 401 を返していた。

### 対応内容（コミット `174f0ef`）
1. **PostgreSQL セットアップ**: `app_user` 作成、`daily_report` DB 作成
2. **マイグレーション適用**:
   ```bash
   psql -U app_user -d daily_report -f supabase/migrations/001_init.sql
   psql -U app_user -d daily_report -f supabase/migrations/002_seed.sql
   ```
3. **デバッグログ削除**: `app/api/auth/login/route.ts` の `[LOGIN DEBUG]` ログを削除
4. **middleware.ts → proxy.ts に移行**: Next.js 16 の推奨に従い `export` 関数名を `middleware` → `proxy` に変更

## 今後のタスク

### 優先度: 高
- [x] ~~デバッグAPI を削除する~~ → 削除済み
- [ ] **初期パスワードの変更**: 本番デプロイ後、社員番号 `0001` のパスワードを即座に変更すること

### 優先度: 中
- [ ] **アプリ全体の動作テスト**: 日報入力・一覧表示・admin 画面・Excel 出力を手動確認する
- [ ] **定数の確認**: `lib/constants.ts` の `BREAK_MINUTES`、`STANDARD_MINUTES` の値を要件と照合する

### 優先度: 低
- [ ] **セッション有効期限の確認**: 現在7日間。要件に合わせて調整する

## DB 環境セットアップ手順

次のセッションで DB をゼロからセットアップする場合の手順:

```bash
# 1. PostgreSQL を起動
sudo service postgresql start

# 2. DB ユーザー・データベースを作成（初回のみ）
sudo -u postgres psql -c "CREATE USER app_user WITH PASSWORD 'app_password';"
sudo -u postgres psql -c "CREATE DATABASE daily_report OWNER app_user;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE daily_report TO app_user;"

# 3. マイグレーション適用
psql -U app_user -d daily_report -f supabase/migrations/001_init.sql
psql -U app_user -d daily_report -f supabase/migrations/002_seed.sql

# 4. Next.js 開発サーバー起動
npm run dev
```

## DB構成

### テーブル
- `users`: id(uuid), employee_id(char4), password_hash, role, name, created_at
- `daily_reports`: id(uuid), user_id, report_date, start_time, end_time, note, created_at, updated_at
- `sessions`: id(uuid), user_id, token, expires_at, created_at

### 初期ユーザー
| employee_id | name         | role  | パスワード    |
|-------------|-------------|-------|--------------|
| 0001        | 管理者       | admin | password123  |
| 0002        | テストユーザー | user  | password123  |

## 環境変数 (.env.local)
```
DATABASE_URL=postgresql://app_user:app_password@localhost:5432/daily_report
```

## 主要ファイル
| パス | 説明 |
|------|------|
| `lib/supabase.ts` | Supabase互換クエリビルダー（ローカルPostgreSQL接続） |
| `lib/session.ts` | セッション管理（作成・検証・削除） |
| `lib/constants.ts` | 定数（SESSION_COOKIE名、TTL等） |
| `proxy.ts` | 認証チェックミドルウェア（旧 middleware.ts） |
| `app/(auth)/login/page.tsx` | ログインページUI |
| `app/api/auth/login/route.ts` | ログインAPI |
| `app/api/auth/logout/route.ts` | ログアウトAPI |
| `scripts/migrate.js` | マイグレーション自動実行スクリプト |
| `app/(authenticated)/reports/` | 日報ページ |
| `app/(authenticated)/admin/` | 管理画面 |

## コミット履歴（新しい順）
1. `174f0ef` - fix: ブラウザログイン401エラーを解消
2. `9bedc95` - docs: 引継ぎ書 (HANDOVER.md) を作成
3. `eb4aaa8` - debug: ログインAPIにデバッグログを追加
4. `428e7f8` - fix: Supabaseクライアントをローカル PostgreSQL 接続に置換
5. `d3bb263` - feat: パスワードリセット用デバッグAPIを追加
6. `23713b6` - fix: ミドルウェアでsw.jsとmanifest.jsonを認証リダイレクトから除外
7. `948824d` - feat: 初期ユーザー seed SQL 追加
8. `5ff67ec` - chore: supabase/.temp/ を .gitignore に追加
9. `24a0ffa` - feat: PWA対応
10. `61752d1` - feat: ユーザー管理機能追加
11. `8c50ea2` - feat: Excel出力 UI + ヘッダーナビゲーション追加
12. `2a36998` - feat: Excel出力 API 追加
13. `88905cb` - feat: 管理画面追加
14. `4b15251` - feat: 日報入力 UI + 認証済みレイアウト追加
15. `da86c78` - feat: 日報 CRUD API + 計算列ロジック追加
16. `e26318f` - feat: ログイン画面追加
17. `04c3828` - fix: SESSION_COOKIE を constants.ts に移動し Edge Runtime エラーを防止
18. `8a6ed85` - feat: 認証 API 追加
19. `4da5a3a` - feat: セッション管理追加
20. `52044e0` - feat: 定数・Supabase クライアント追加
21. `9696a94` - feat: Supabase マイグレーション SQL 追加
22. `42c471e` - feat: Next.js プロジェクト初期化

## 本番デプロイ手順 (Railway + Supabase)

### 構成
```
Railway (Next.js アプリ ~$5/月)  →  Supabase Free (PostgreSQL DB $0/月)
                                     ✓ 自動日次バックアップ (7日保持)
```

### Step 1: Supabase プロジェクト作成
1. https://supabase.com でアカウント作成
2. 新規プロジェクトを作成（リージョン: Northeast Asia (Tokyo) 推奨）
3. **Settings → Database → Connection string** から接続文字列を取得:
   ```
   postgresql://postgres.[project-ref]:[password]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres
   ```
   ※ "Display connection pooler" を ON にし、Mode は "Transaction" を選択

### Step 2: Railway デプロイ
1. https://railway.app でアカウント作成
2. **New Project → Deploy from GitHub repo** でこのリポジトリを接続
3. **Variables** で以下を設定:
   ```
   DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres
   NODE_ENV=production
   ```
4. **Settings → Networking → Generate Domain** でURLを発行
5. デプロイが走り、`npm run build`（マイグレーション自動実行）→ `npm start` で起動

### Step 3: 初回ログイン
1. 発行されたURLにアクセス
2. 社員番号 `0001` / パスワード `password123` でログイン
3. **⚠ 即座にパスワードを変更すること**

### バックアップについて
- Supabase無料枠は **日次自動バックアップ（7日間保持）** が含まれる
- 復元はSupabaseダッシュボードの **Settings → Database → Backups** から実行
- アプリのバグでデータが消えても最大1日分の損失で済む

### コスト目安
| サービス | 月額 |
|---------|------|
| Railway | ~$5 (使用量課金) |
| Supabase Free | $0 |
| **合計** | **~$5/月** |

## 注意事項
- デバッグAPI (`app/api/debug-reset-password/`) は削除済み
- Next.js 16 で `middleware` が非推奨になり `proxy` に移行済み（`proxy.ts`）
- RLSポリシーはマイグレーションに含まれているが、ローカルPostgreSQLではRLSの設定確認が必要
- QueryBuilderにフィルタなしDELETE/UPDATEの安全弁を追加済み（`lib/supabase.ts`）
