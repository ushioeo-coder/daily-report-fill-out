# 引継ぎ書 — 日報管理システム

## ブランチ
- 開発ブランチ: `claude/create-handover-docs-EbnD5`
- リモートにpush済み

## プロジェクト概要
Next.js 16.1.6 (Turbopack) + ローカル PostgreSQL による日報管理Webアプリ。
PWA対応済み。Supabase互換のカスタムクエリビルダーでDB接続している。

## 技術スタック
- **フレームワーク**: Next.js 16.1.6 (App Router, Turbopack)
- **DB**: ローカル PostgreSQL (`daily_report` データベース)
- **DB接続**: `lib/supabase.ts` に独自のSupabase互換クエリビルダー（pg poolベース）
- **認証**: bcryptパスワードハッシュ + セッションCookie + middleware
- **起動**: `npm run dev` (localhost:3000)

## 現在の未解決問題: ブラウザからのログインが失敗する

### 症状
- ブラウザで http://localhost:3000/login にアクセスし、社員番号 `0001` / パスワード `password123` でログインすると「社員番号またはパスワードが正しくありません。」と表示される
- しかし、**curlでは同じリクエストが200で成功する**:
  ```bash
  curl -s -X POST http://localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"employee_id":"0001","password":"password123"}'
  ```

### これまでの調査・対応
1. **Supabaseクライアントの置換** (コミット `428e7f8`): 元々Supabase Cloud接続だったのを、ローカルPostgreSQL直接接続に置換。`lib/supabase.ts` にSupabase互換のクエリビルダーを実装
2. **シードデータ確認**: `supabase/migrations/002_seed.sql` にbcryptハッシュ付きユーザーデータあり。パスワード `password123` のハッシュ `$2b$10$2Mu22r.MlESOWQ/kVyKI4u5erceS8m52jWMzzIc/tCjfOyUD2F3vm`
3. **curlテスト**: サーバーサイドでは正常にログインできることを確認済み（200レスポンス）
4. **デバッグログ追加** (コミット `eb4aaa8`): `app/api/auth/login/route.ts` にデバッグログを追加。ブラウザからのリクエスト時にサーバーログでbcrypt比較結果やDB検索結果を出力する

### 考えられる原因候補
- ブラウザからのリクエストがサーバーに到達していない可能性（サーバーログに記録がなかった）
- 別のポート/プロセスにアクセスしている可能性
- Next.js middlewareの問題（proxy.ts警告が出ている）
- PostgreSQL接続プール問題（タイミング依存）

### 次にやるべきこと
1. **PostgreSQLを起動する**: 現在PostgreSQLが停止している
   ```bash
   sudo pg_ctlcluster 14 main start
   # または
   sudo service postgresql start
   ```
2. **Next.js開発サーバーを起動する**: 現在停止している
   ```bash
   cd /home/user/daily-report-fill-out && npm run dev > /tmp/nextjs.log 2>&1 &
   ```
3. **ブラウザからログインを試行し、サーバーログを確認する**:
   ```bash
   tail -f /tmp/nextjs.log
   ```
   `[LOGIN DEBUG]` プレフィックスでデバッグ情報が出力される
4. **ログの結果に応じて対応**:
   - ログに何も出ない → リクエストがサーバーに到達していない（URL/ポート確認）
   - `user found: false` → DBにユーザーがいない or PostgreSQL接続の問題
   - `bcryptResult: false` → パスワードハッシュの不一致（再シード必要）
   - `bcryptResult: true` → セッション作成で失敗している

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

### マイグレーション適用
```bash
psql -U app_user -d daily_report -f supabase/migrations/001_init.sql
psql -U app_user -d daily_report -f supabase/migrations/002_seed.sql
```

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
| `middleware.ts` | 認証チェックミドルウェア |
| `app/(auth)/login/page.tsx` | ログインページUI |
| `app/api/auth/login/route.ts` | ログインAPI（デバッグログ追加済み） |
| `app/api/auth/logout/route.ts` | ログアウトAPI |
| `app/(authenticated)/reports/` | 日報ページ |
| `app/(authenticated)/admin/` | 管理画面 |

## コミット履歴（新しい順）
1. `eb4aaa8` - debug: ログインAPIにデバッグログを追加
2. `428e7f8` - fix: Supabaseクライアントをローカル PostgreSQL 接続に置換
3. `d3bb263` - feat: パスワードリセット用デバッグAPIを追加
4. `23713b6` - fix: ミドルウェアでsw.jsとmanifest.jsonを認証リダイレクトから除外
5. `948824d` - feat: 初期ユーザー seed SQL 追加
6. `5ff67ec` - chore: supabase/.temp/ を .gitignore に追加
7. `24a0ffa` - feat: PWA対応
8. `61752d1` - feat: ユーザー管理機能追加
9. `8c50ea2` - feat: Excel出力 UI + ヘッダーナビゲーション追加
10. `2a36998` - feat: Excel出力 API 追加
11. `88905cb` - feat: 管理画面追加
12. `4b15251` - feat: 日報入力 UI + 認証済みレイアウト追加
13. `da86c78` - feat: 日報 CRUD API + 計算列ロジック追加
14. `e26318f` - feat: ログイン画面追加
15. `04c3828` - fix: SESSION_COOKIE を constants.ts に移動し Edge Runtime エラーを防止
16. `8a6ed85` - feat: 認証 API 追加
17. `4da5a3a` - feat: セッション管理追加
18. `52044e0` - feat: 定数・Supabase クライアント追加
19. `9696a94` - feat: Supabase マイグレーション SQL 追加
20. `42c471e` - feat: Next.js プロジェクト初期化

## 注意事項
- `lib/supabase.ts` のデバッグログは問題解決後に削除すること
- `app/api/auth/login/route.ts` のデバッグログも同様に削除すること
- Next.js 16 で `middleware` が非推奨になり `proxy` に移行推奨の警告が出ている（動作には影響なし）
- RLSポリシーはマイグレーションに含まれているが、ローカルPostgreSQLではRLSの設定確認が必要
