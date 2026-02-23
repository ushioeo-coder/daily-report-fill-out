# 日報アプリ 設計メモ

## 0. 前提

| 項目 | 値 |
|---|---|
| 休憩時間 (分) | `120` (env: `BREAK_MINUTES`) |
| 所定労働時間 (分) | `480` (env: `STANDARD_MINUTES`) |
| 時刻の保存形式 | 整数 0–1439 (0:00=0, 23:59=1439) |
| 編集可能範囲 | 当日から過去30日 |
| セッション維持 | 最終操作から7日 |
| Excelテンプレート原本 | `C:\Users\sakurai\ﾌﾟﾛｼﾞｪｸﾄ\日報\` (ローカルPC) |
| Excelテンプレート配置先 | `templates/日報ひな形.xlsx` (リポジトリ管理) |

---

## 1. DBテーブル設計

### `users`

| column | type | note |
|---|---|---|
| id | `uuid` PK default `gen_random_uuid()` | Supabase auth と紐づけない独自管理 |
| employee_id | `char(4)` UNIQUE NOT NULL | 社員番号 (ログインID) |
| password_hash | `text` NOT NULL | bcrypt ハッシュ |
| role | `text` NOT NULL CHECK (`role` in ('user','admin')) default `'user'` | |
| name | `text` NOT NULL | 表示名 |
| created_at | `timestamptz` default `now()` | |

### `daily_reports`

| column | type | note |
|---|---|---|
| id | `uuid` PK default `gen_random_uuid()` | |
| user_id | `uuid` FK → users.id NOT NULL | |
| report_date | `date` NOT NULL | |
| start_time | `smallint` NULL | 出勤 (分) |
| end_time | `smallint` NULL | 退勤 (分) |
| note | `text` NULL | 備考 |
| created_at | `timestamptz` default `now()` | |
| updated_at | `timestamptz` default `now()` | |

- **UNIQUE** `(user_id, report_date)` — 1人1日1レコード
- CHECK: `start_time BETWEEN 0 AND 1439`
- CHECK: `end_time BETWEEN 0 AND 1439`

### `sessions`

| column | type | note |
|---|---|---|
| id | `uuid` PK default `gen_random_uuid()` | |
| user_id | `uuid` FK → users.id NOT NULL | |
| token | `text` UNIQUE NOT NULL | crypto random hex |
| expires_at | `timestamptz` NOT NULL | 最終操作+7日、操作ごとに延長 |
| created_at | `timestamptz` default `now()` | |

> Supabase Auth を使わず JWT/cookie を自前発行する設計。
> 理由: 社員番号4桁ログインは Supabase Auth のメール/電話認証と合わない。

---

## 2. Supabase RLS 方針

RLS は**保険的に設定**する。主なアクセス制御は API Route (Next.js Server) 側で行い、
Supabase にはサービスロールキーでアクセスする。

ただし万一の直接アクセスに備え、以下を設定:

```sql
-- daily_reports: user は自分の行のみ
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_own_reports" ON daily_reports
  FOR ALL
  USING (
    user_id = current_setting('app.current_user_id')::uuid
    OR current_setting('app.current_user_role') = 'admin'
  )
  WITH CHECK (
    user_id = current_setting('app.current_user_id')::uuid
    OR current_setting('app.current_user_role') = 'admin'
  );

-- users: 自分のレコードのみ参照可 (admin は全員)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_own_profile" ON users
  FOR SELECT
  USING (
    id = current_setting('app.current_user_id')::uuid
    OR current_setting('app.current_user_role') = 'admin'
  );
```

> 実運用では API Route からは **service_role key** を使うため RLS はバイパスされる。
> RLS は Supabase Dashboard 等からの直接操作時の安全弁。

---

## 3. 30日編集制限 — DB側実装方針

### 方針: API Route で制御 + DB CHECK 制約で二重防御

```sql
-- daily_reports に UPDATE 用のトリガー
CREATE OR REPLACE FUNCTION check_edit_window()
RETURNS TRIGGER AS $$
BEGIN
  -- admin はスキップ (session 変数で判定)
  IF current_setting('app.current_user_role', true) = 'admin' THEN
    RETURN NEW;
  END IF;

  -- 30日を超えた日付のレコードは更新不可
  IF OLD.report_date < CURRENT_DATE - INTERVAL '30 days' THEN
    RAISE EXCEPTION 'Cannot edit reports older than 30 days';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_edit_window
  BEFORE UPDATE ON daily_reports
  FOR EACH ROW
  EXECUTE FUNCTION check_edit_window();
```

API Route 側でも同じ日付チェックを行う（早期リジェクト）:

```typescript
// API Route 内
if (role !== "admin") {
  const cutoff = subDays(new Date(), 30);
  if (reportDate < cutoff) {
    return NextResponse.json({ error: "編集期限を過ぎています" }, { status: 403 });
  }
}
```

---

## 4. 計算列を user に返さない API 設計方針

### 計算列の定義

| 列名 | 計算式 |
|---|---|
| 実労働時間 (分) | `end_time - start_time - BREAK_MINUTES` |
| 残業時間 (分) | `MAX(実労働時間 - STANDARD_MINUTES, 0)` |

### 方針

```
Client  →  GET /api/reports?from=...&to=...
                ↓
        API Route (server)
                ↓
        1. DB から生データ取得 (start_time, end_time, note ...)
        2. role 判定
           - user  → 生データのみ返却 (計算しない)
           - admin → 生データ + 計算列を付与して返却
```

**具体実装:**

```typescript
// lib/calc.ts — サーバー側のみ (client にバンドルしない)
export function computeDerivedColumns(report: RawReport) {
  const worked = report.end_time - report.start_time - BREAK_MINUTES;
  const overtime = Math.max(worked - STANDARD_MINUTES, 0);
  return { actualWorkMinutes: worked, overtimeMinutes: overtime };
}

// app/api/reports/route.ts
const reports = await fetchReports(userId, from, to);

if (session.role === "admin") {
  return NextResponse.json(
    reports.map((r) => ({ ...r, ...computeDerivedColumns(r) }))
  );
}
// user: 計算列なし
return NextResponse.json(reports);
```

- `lib/calc.ts` は **server-only** パッケージでガード (`import "server-only"`)
- DB に VIEW を作らない — 計算パラメータ (休憩120分等) を将来変更しやすくするため
- admin 画面のフロント側の型に `actualWorkMinutes`, `overtimeMinutes` を含める
- user 画面の型にはこれらを含めない → TypeScript で静的に漏れを防止

---

## 5. Excel出力 実装方針

### テンプレート管理

```
/templates/日報ひな形.xlsx   ← 管理者が配置・差替え
```

リポジトリにコミットし Vercel にデプロイされる。
テンプレート差替え = コミット＆デプロイ で反映。

### 処理フロー

```
admin が UI で期間・対象ユーザーを選択
        ↓
POST /api/reports/export  { userIds, from, to }
        ↓
API Route (server)
  1. テンプレ読込: fs.readFileSync("templates/日報ひな形.xlsx")
  2. ExcelJS (or xlsx-populate) でワークブック解析
  3. DB からデータ取得 + 計算列算出
  4. テンプレのセルにデータ書込み
  5. バッファを生成 → Response として返却
        ↓
ブラウザで .xlsx ダウンロード
```

### ライブラリ選定

| ライブラリ | 理由 |
|---|---|
| **ExcelJS** | テンプレートの書式・罫線を保持したまま値を書き込める。ストリーム対応。 |

### コード概要

```typescript
// app/api/reports/export/route.ts
import ExcelJS from "exceljs";
import path from "path";
import { computeDerivedColumns } from "@/lib/calc";

export async function POST(req: Request) {
  // admin のみ
  const session = await getSession(req);
  if (session.role !== "admin") return new Response(null, { status: 403 });

  const { userIds, from, to } = await req.json();

  // テンプレ読込
  const wb = new ExcelJS.Workbook();
  const templatePath = path.join(process.cwd(), "templates", "日報ひな形.xlsx");
  await wb.xlsx.readFile(templatePath);

  const ws = wb.getWorksheet(1);

  // データ取得・書込
  const reports = await fetchReportsForExport(userIds, from, to);
  let row = 2; // ヘッダー行の次から (テンプレ依存)
  for (const r of reports) {
    const derived = computeDerivedColumns(r);
    ws.getCell(`A${row}`).value = r.report_date;
    ws.getCell(`B${row}`).value = formatTime(r.start_time);
    ws.getCell(`C${row}`).value = formatTime(r.end_time);
    ws.getCell(`D${row}`).value = derived.actualWorkMinutes;
    ws.getCell(`E${row}`).value = derived.overtimeMinutes;
    ws.getCell(`F${row}`).value = r.note;
    row++;
  }

  // バッファ化 → レスポンス
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="daily_report_${from}_${to}.xlsx"`,
    },
  });
}
```

---

## ディレクトリ構成 (想定)

```
/
├── app/
│   ├── (auth)/login/page.tsx        # ログイン画面
│   ├── (app)/
│   │   ├── reports/page.tsx         # user: 日報一覧/入力
│   │   └── admin/
│   │       ├── reports/page.tsx     # admin: 全社員日報閲覧
│   │       └── export/page.tsx      # admin: Excel出力
│   └── api/
│       ├── auth/login/route.ts
│       ├── auth/logout/route.ts
│       ├── reports/route.ts         # GET/POST/PUT
│       └── reports/export/route.ts  # POST (admin)
├── lib/
│   ├── supabase.ts                  # Supabase client (service_role)
│   ├── session.ts                   # セッション管理
│   ├── calc.ts                      # 計算列 (server-only)
│   └── constants.ts                 # BREAK_MINUTES, STANDARD_MINUTES
├── templates/
│   └── 日報ひな形.xlsx              # Excelテンプレート
├── supabase/
│   └── migrations/
│       └── 001_init.sql             # DDL + RLS + トリガー
└── middleware.ts                     # セッション検証・expires_at 延長
```
