import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import path from "path";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 分 (0–1439) → Excel のシリアル時刻 (日の端数) に変換。
 * 例: 480分 (8:00) → 0.3333...
 */
function minutesToExcelTime(minutes: number): number {
  return minutes / 1440;
}

/**
 * POST /api/reports/export
 * body: { user_id, year, month }
 *
 * admin のみ: 指定ユーザーの月報を Excel テンプレートに書き込んでダウンロード
 * user_id が "all" の場合は、全ユーザー分のシートを作成して一括ダウンロード
 *
 * テンプレート: templates/日報ひな形.xlsx の「ひな型」シートを使用
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { user_id, year, month } = body ?? {};

  if (!user_id || typeof year !== "number" || typeof month !== "number") {
    return NextResponse.json(
      { error: "user_id, year, month は必須です。" },
      { status: 400 }
    );
  }

  if (typeof user_id !== "string" || (user_id !== "all" && !UUID_RE.test(user_id))) {
    return NextResponse.json(
      { error: "user_id の形式が不正です。" },
      { status: 400 }
    );
  }

  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return NextResponse.json(
      { error: "year は 1900〜2100 の整数で指定してください。" },
      { status: 400 }
    );
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json(
      { error: "month は 1〜12 の整数で指定してください。" },
      { status: 400 }
    );
  }

  // 対象ユーザー取得
  let usersToExport: { id: string; name: string }[] = [];
  if (user_id === "all") {
    const { data: allUsers, error: usersError } = await supabase
      .from("users")
      .select("id, name")
      .order("employee_id", { ascending: true });

    if (usersError || !allUsers || allUsers.length === 0) {
      return NextResponse.json(
        { error: "ユーザーの取得に失敗しました。" },
        { status: 500 }
      );
    }
    usersToExport = allUsers;
  } else {
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, name")
      .eq("id", user_id)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません。" },
        { status: 404 }
      );
    }
    usersToExport = [user];
  }

  // 対象月の日報取得 (対象ユーザー全員分を一度に取得)
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const userIds = usersToExport.map(u => u.id);
  // UUIDの配列を渡すため in() クエリか、OR条件などを使う。ここではローカルSupabaseモジュールがinをサポートしていない可能性を考慮する場合は手動フィルタだが、通常対応しているはず。
  // 万一 in() がエラーになる場合は、Supabaseクライアントから取得。
  const { data: reports, error: reportsError } = await supabase
    .from("daily_reports")
    .select("user_id, report_date, start_time, site_arrival_time, work_start_time, work_end_time, return_time, end_time, note")
    .gte("report_date", from)
    .lte("report_date", to)
    .order("report_date", { ascending: true });
  // Note: if user_id !== "all", we could strictly filter by user_id, but doing it in memory is also very fast since it's just 1 month data

  if (reportsError) {
    console.error("[export] DB error:", reportsError);
    return NextResponse.json(
      { error: "日報の取得に失敗しました。" },
      { status: 500 }
    );
  }

  // ユーザーID -> { 日付文字列 -> レポート } のマップ作成
  const userReportMap = new Map<string, Map<string, any>>();
  for (const uid of userIds) {
    userReportMap.set(uid, new Map());
  }

  if (reports) {
    for (const r of reports) {
      if (!userReportMap.has(r.user_id)) continue;
      const rd = r.report_date;
      const dateKey = rd instanceof Date ? rd.toISOString().slice(0, 10) : String(rd).slice(0, 10);
      userReportMap.get(r.user_id)!.set(dateKey, r);
    }
  }

  // テンプレート読込
  const wb = new ExcelJS.Workbook();
  const templatePath = path.join(process.cwd(), "templates", "日報ひな形.xlsx");
  try {
    await wb.xlsx.readFile(templatePath);
  } catch {
    return NextResponse.json(
      { error: "Excel テンプレートの読み込みに失敗しました。" },
      { status: 500 }
    );
  }

  const src = wb.getWorksheet("ひな型");
  if (!src) {
    return NextResponse.json(
      { error: "テンプレートに「ひな型」シートが見つかりません。" },
      { status: 500 }
    );
  }

  const DATA_START_ROW = 10;
  const COL_MAP: [string, string][] = [
    ["E", "start_time"],
    ["F", "site_arrival_time"],
    ["G", "work_start_time"],
    ["H", "work_end_time"],
    ["I", "return_time"],
    ["J", "end_time"],
  ];

  // シートの作成とデータ書き込み
  let userCount = 1;
  for (const user of usersToExport) {
    let safeName = user.name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31); // Excelのシート名制約(31文字・使用不可文字)に対応

    // シート名被り対策
    let finalSheetName = safeName;
    let dupIndex = 1;
    while (wb.getWorksheet(finalSheetName)) {
      finalSheetName = `${safeName.substring(0, 28)}_${dupIndex}`;
      dupIndex++;
    }

    const dest = wb.addWorksheet(finalSheetName);

    // Copy properties, pageSetup, views
    dest.properties = src.properties;
    dest.pageSetup = src.pageSetup;
    dest.views = src.views;

    // Copy column styles & widths
    dest.columns = src.columns.map(c => ({ width: c.width, style: c.style, hidden: c.hidden }));

    // Copy rows and cells
    src.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const destRow = dest.getRow(rowNumber);
      destRow.height = row.height;
      destRow.hidden = row.hidden;

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const destCell = dest.getCell(rowNumber, colNumber);
        destCell.value = cell.value;
        destCell.style = cell.style;
        destCell.dataValidation = cell.dataValidation;
      });
    });

    // Copy merges
    const srcMerges = (src as any)._merges;
    if (srcMerges) {
      for (const merge of Object.values(srcMerges)) {
        if ((merge as any).model) {
          const m = (merge as any).model;
          dest.mergeCells(m.top, m.left, m.bottom, m.right);
        } else if (typeof merge === 'string') {
          dest.mergeCells(merge);
        } else {
          const m = merge as any;
          if (m.top && m.left && m.bottom && m.right) {
            dest.mergeCells(m.top, m.left, m.bottom, m.right);
          }
        }
      }
    }

    // ユーザー別のデータを書き込む
    dest.getCell("B3").value = year;
    dest.getCell("E3").value = month;
    dest.getCell("J4").value = user.name;

    const reportsForUser = userReportMap.get(user.id)!;

    for (let day = 1; day <= lastDay; day++) {
      const rowNum = DATA_START_ROW + day - 1;
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const d = new Date(dateStr + "T00:00:00");
      const isSunday = d.getDay() === 0;

      // 日付と区分（B列、C列）の背景色を動的に設定。日曜は青、それ以外は白（透明）
      const destRow = dest.getRow(rowNum);
      const targetCols = ["B", "C"]; // ご要望の青色対象列はB,C列のみ

      for (let c = 1; c <= 13; c++) {
        const destCell = destRow.getCell(c);
        // B, C 列は日曜なら青、それ以外は色付けをリセット
        // 他の列も固定の色がついている可能性があるためリセット
        if (isSunday && (c === 2 || c === 3)) { // B=2, C=3
          destCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF00B0F0" }, // テンプレートで使われていた青色
          };
        } else {
          // 動的に白（あるいは色なし）に戻す
          destCell.fill = {
            type: "pattern",
            pattern: "none",
          };
        }
      }

      const report = reportsForUser.get(dateStr);
      if (!report) continue;

      for (const [col, field] of COL_MAP) {
        const val = report[field];
        if (val == null || typeof val !== "number") continue;
        const cell = dest.getCell(`${col}${rowNum}`);
        cell.value = val / 1440;
      }
    }
    userCount++;
  }

  // 元のひな型シートを削除
  wb.removeWorksheet(src.id);

  // =====================================================================
  // JSZip 処理 (K15数式修正、NaN対策など)
  // 新テンプレートではE〜Jが空セルのためt="s"の置換は不要
  // =====================================================================

  const rawBuffer = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(rawBuffer);

  // NaN 対策および条件付き書式の徹底排除
  for (const zipEntryName of Object.keys(zip.files)) {
    if (!/xl\/worksheets\/sheet\d+\.xml$/.test(zipEntryName)) continue;
    let xml = await zip.files[zipEntryName].async("string");

    // NaN を 0 に置換
    if (xml.includes("<v>NaN</v>")) {
      xml = xml.replace(/<v>NaN<\/v>/g, "<v>0</v>");
    }

    // ひな形に残存している「条件付き書式」の設定タグをすべて削除し、
    // プログラムで動的に塗った色指定だけが確実に有効になるようにする
    xml = xml.replace(/<conditionalFormatting[^>]*>[\s\S]*?<\/conditionalFormatting>/gi, "");

    zip.file(zipEntryName, xml);
  }

  const buffer = await zip.generateAsync({ type: "arraybuffer" });

  const fileName = user_id === "all"
    ? `日報_全ユーザー_${year}年${String(month).padStart(2, "0")}月.xlsx`
    : `日報_${usersToExport[0].name}_${year}年${String(month).padStart(2, "0")}月.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
