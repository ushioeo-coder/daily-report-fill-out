# 日報アプリ 実装引継ぎ指示書

## ブランチ

```
claude/daily-report-app-W7jYo
```

## リポジトリ現状

Next.js プロジェクト未作成。以下のファイルのみ存在:

```
docs/design.md          ← 設計メモ (全方針が記載済み)
templates/README.md     ← テンプレ配置手順
templates/日報ひな形.xlsx ← Excel出力用テンプレート (72KB, アップロード済み)
```

## 設計メモの場所

**`docs/design.md` を必ず最初に読むこと。** 以下が全て記載されている:

- DBテーブル設計 (users / daily_reports / sessions) — 型・制約まで確定
- Supabase RLS 方針 (疑似SQL付き)
- 30日編集制限の実装方針 (APIチェック + DBトリガー二重防御)
- 計算列をuserに返さないAPI設計 (server-only / role分岐)
- Excel出力の実装方針 (ExcelJS + テンプレ読込→書込)
- ディレクトリ構成

## 確定要件 (変更不可)

- 社員番号4桁 + パスワードでログイン
- セッション: 最終操作から7日維持
- user: 自分の入力列のみ閲覧/編集、過去30日まで編集可
- admin: 全閲覧/編集可、計算列閲覧可、Excel出力可
- 計算列は user に UI/API ともに一切返さない
- 計算は DB に保存せず表示時に算出
- 休憩120分、所定480分 (将来変更可 → 定数化)
- 時刻は分 (0–1439) で保存
- Supabase Auth は使わない (独自認証)
- Excel出力は `templates/日報ひな形.xlsx` を必ず使用

## 技術スタック

| 層 | 技術 |
|---|---|
| フロント | Next.js (App Router) |
| バックエンド | Next.js API Routes (Route Handlers) |
| DB | Supabase (PostgreSQL) |
| 認証 | 独自 (bcrypt + session token + cookie) |
| Excel | ExcelJS |
| デプロイ | Vercel |

## 実装順序

| # | タスク | 補足 |
|---|---|---|
| 1 | Next.js プロジェクト初期化 | `create-next-app` → 依存追加 (exceljs, bcrypt, @supabase/supabase-js, server-only) |
| 2 | Supabase マイグレーション SQL | `supabase/migrations/001_init.sql` — DDL, RLS, トリガー全て `docs/design.md` に記載済み |
| 3 | 定数・Supabase クライアント | `lib/constants.ts`, `lib/supabase.ts` |
| 4 | セッション管理 | `lib/session.ts` + `middleware.ts` (cookie検証 + expires_at延長) |
| 5 | 認証 API | `app/api/auth/login/route.ts`, `logout/route.ts` |
| 6 | ログイン画面 | `app/(auth)/login/page.tsx` |
| 7 | 日報 CRUD API | `app/api/reports/route.ts` — role分岐・30日チェック・計算列付与 |
| 8 | 日報 UI (user) | `app/(app)/reports/page.tsx` |
| 9 | 管理画面 (admin) | `app/(app)/admin/reports/page.tsx` |
| 10 | Excel出力 API | `app/api/reports/export/route.ts` |
| 11 | Excel出力 UI (admin) | `app/(app)/admin/export/page.tsx` |

## 注意事項

- `lib/calc.ts` は `import "server-only"` を必ず付ける
- Supabase へは service_role key でアクセス (RLS バイパス)
- `.env.local` に `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` が必要
- Excel テンプレのセル位置はテンプレ実物を読んでから決定すること (設計メモのA-Fは仮)
