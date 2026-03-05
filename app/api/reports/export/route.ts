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
 *
 * テンプレート: templates/日報ひな形.xlsx の「作業員配布用」シートを使用
 *   - B8: 年, E8: 月, J9: 氏名
 *   - Row 15〜45: 日付行
 *   - E列: ①出社, F列: ②現場到着, G列: ③作業開始,
 *     H列: ④作業終了, I列: ⑤帰社, J列: ⑥退勤
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

  if (typeof user_id !== "string" || !UUID_RE.test(user_id)) {
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
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("name")
    .eq("id", user_id)
    .single();

  if (userError || !user) {
    return NextResponse.json(
      { error: "ユーザーが見つかりません。" },
      { status: 404 }
    );
  }

  // 対象月の日報取得
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const { data: reports, error: reportsError } = await supabase
    .from("daily_reports")
    .select("report_date, start_time, site_arrival_time, work_start_time, work_end_time, return_time, end_time, note")
    .eq("user_id", user_id)
    .gte("report_date", from)
    .lte("report_date", to)
    .order("report_date", { ascending: true });

  if (reportsError) {
    return NextResponse.json(
      { error: "日報の取得に失敗しました。" },
      { status: 500 }
    );
  }

  // 日付→レポートのマップ作成
  const reportMap = new Map<string, (typeof reports)[0]>();
  for (const r of reports) {
    reportMap.set(String(r.report_date).slice(0, 10), r);
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

  const ws = wb.getWorksheet("作業員配布用");
  if (!ws) {
    return NextResponse.json(
      { error: "テンプレートに「作業員配布用」シートが見つかりません。" },
      { status: 500 }
    );
  }

  // 年月・氏名を設定
  ws.getCell("B8").value = year;
  ws.getCell("E8").value = month;
  ws.getCell("J9").value = user.name;

  // 日報データ書込み (Row 15 = 1日目)
  const DATA_START_ROW = 15;

  /**
   * セルに値を書き込む際、元のスタイル (numFmt, font, border 等) を保持する。
   * ExcelJS は .value = で直接代入するとスタイルが消えるケースがあるため、
   * 退避→書込み→再適用する。
   */
  function setCellValue(
    sheet: ExcelJS.Worksheet,
    rowNum: number,
    colNum: number,
    value: number
  ) {
    const cell = sheet.getCell(rowNum, colNum);
    const savedStyle = { ...cell.style };
    cell.value = value;
    cell.style = savedStyle;
  }

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const report = reportMap.get(dateStr);
    const row = DATA_START_ROW + day - 1;

    if (report?.start_time != null) {
      setCellValue(ws, row, 5, minutesToExcelTime(report.start_time)); // E列: ①出社
    }
    if (report?.site_arrival_time != null) {
      setCellValue(ws, row, 6, minutesToExcelTime(report.site_arrival_time)); // F列: ②現場到着
    }
    if (report?.work_start_time != null) {
      setCellValue(ws, row, 7, minutesToExcelTime(report.work_start_time)); // G列: ③作業開始
    }
    if (report?.work_end_time != null) {
      setCellValue(ws, row, 8, minutesToExcelTime(report.work_end_time)); // H列: ④作業終了
    }
    if (report?.return_time != null) {
      setCellValue(ws, row, 9, minutesToExcelTime(report.return_time)); // I列: ⑤帰社
    }
    if (report?.end_time != null) {
      setCellValue(ws, row, 10, minutesToExcelTime(report.end_time)); // J列: ⑥退勤
    }
  }

  // 不要なシートを削除 (作業員配布用のみ残す)
  const sheetsToRemove: string[] = [];
  wb.eachSheet((sheet) => {
    if (sheet.name !== "作業員配布用") {
      sheetsToRemove.push(sheet.name);
    }
  });
  for (const name of sheetsToRemove) {
    const sheet = wb.getWorksheet(name);
    if (sheet) wb.removeWorksheet(sheet.id);
  }

  // バッファ生成 → NaN 修正
  // ExcelJS は共有数式のキャッシュ値 (#VALUE! 等) を正しく保持できず、
  // <v>NaN</v> として書き出してしまう既知の問題がある。
  // JSZip で後処理し、NaN を 0 に置換して Excel の再計算に委ねる。
  const rawBuffer = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(rawBuffer);
  for (const name of Object.keys(zip.files)) {
    if (/xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      let xml = await zip.files[name].async("string");
      if (xml.includes("<v>NaN</v>")) {
        xml = xml.replace(/<v>NaN<\/v>/g, "<v>0</v>");
        zip.file(name, xml);
      }
    }
  }
  const buffer = await zip.generateAsync({ type: "arraybuffer" });

  const fileName = `日報_${user.name}_${year}年${String(month).padStart(2, "0")}月.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
