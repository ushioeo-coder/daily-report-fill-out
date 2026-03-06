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
    console.error("[export] DB error:", reportsError);
    return NextResponse.json(
      { error: "日報の取得に失敗しました。" },
      { status: 500 }
    );
  }

  console.log(`[export] user=${user.name} year=${year} month=${month} reports=${reports?.length ?? 0}`);
  if (reports && reports.length > 0) {
    const first = reports[0];
    console.log(`[export] first report: date=${String(first.report_date).slice(0, 10)} start=${first.start_time} end=${first.end_time} site=${first.site_arrival_time}`);
  }

  // 日付→レポートのマップ作成
  // pg ライブラリは date 型を JavaScript Date オブジェクトとして返すことがある。
  // String(date) では "Sun Mar 01 ..." になるため toISOString() を使って確実に YYYY-MM-DD に変換する。
  const reportMap = new Map<string, (typeof reports)[0]>();
  for (const r of reports) {
    const rd = r.report_date;
    const key =
      rd instanceof Date
        ? rd.toISOString().slice(0, 10)
        : String(rd).slice(0, 10);
    reportMap.set(key, r);
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

  // 年月・氏名だけ設定。値やスタイルはJSZip側で一括設定する。  
  // ExcelJSは各セルのスタイルを正しく再生成できないため。

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

  // バッファ生成
  const rawBuffer = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(rawBuffer);

  // =====================================================================
  // JSZip で styles.xml と worksheet.xml を直接処理
  // ExcelJSの具体的なバグ: t="s"(共有文字列)型セルへの値書き込み時から、fillが失われる。
  // このためJSZipでstyles.xmlを直接操作し、blue fill専用スタイルIDを動的生成して適用する。
  // =====================================================================

  // --- styles.xml の解析とブルーフィルドIDの確認 ---
  let stylesXml = await zip.files["xl/styles.xml"].async("string");

  // fills セクションを解析してblue fill(FF00B0F0)のIDを探す
  let blueFillId: number;
  {
    const fillsContentMatch = stylesXml.match(/<fills count="\d+">([\s\S]*?)<\/fills>/);
    const fillsContent = fillsContentMatch ? fillsContentMatch[1] : "";
    const fillItems = [...fillsContent.matchAll(/<fill>([\s\S]*?)<\/fill>/g)];
    const foundIdx = fillItems.findIndex((m) => /FF00B0F0/.test(m[0]));
    if (foundIdx !== -1) {
      blueFillId = foundIdx;
    } else {
      // blue fillを追加
      const newBlue = '<fill><patternFill patternType="solid"><fgColor rgb="FF00B0F0"/><bgColor indexed="64"/></patternFill></fill>';
      const countMatch = stylesXml.match(/<fills count="(\d+)">/);
      const oldCount = countMatch ? parseInt(countMatch[1]) : 0;
      blueFillId = oldCount;
      stylesXml = stylesXml
        .replace(/<fills count="\d+">/, `<fills count="${oldCount + 1}">`)
        .replace("</fills>", `${newBlue}</fills>`);
    }
  }

  // cellXfs エントリーを配列に展間
  const cellXfsContent = (stylesXml.match(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/) ?? [])[1] ?? "";
  const xfEntries: string[] = [];
  for (const m of cellXfsContent.matchAll(/<xf ([^>]+)(?:\s*\/>|>([\s\S]*?)<\/xf>)/g)) {
    xfEntries.push(m[0]);
  }

  // time numFmtId を取得 (styles.xmlの numFmts セクションから)
  let timeFmtId: number | undefined;
  {
    const numFmtsMatch = stylesXml.match(/<numFmts count="\d+">([\s\S]*?)<\/numFmts>/);
    if (numFmtsMatch) {
      for (const m of numFmtsMatch[1].matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]+)"/g)) {
        if (m[2].includes("h:mm") || m[2].includes("h]:mm")) {
          timeFmtId = parseInt(m[1]);
          break;
        }
      }
    }
  }

  // blueバリアントスタイルのキャッシュ
  const blueStyleCache: Record<number, number> = {};
  function createBlueVariant(origId: number): number {
    if (blueStyleCache[origId] !== undefined) return blueStyleCache[origId];
    const orig = xfEntries[origId];
    if (!orig) return origId;
    let xf = orig.replace(/fillId="\d+"/, `fillId="${blueFillId}"`);
    xf = xf.includes("applyFill=")
      ? xf.replace(/applyFill="\d+"/, 'applyFill="1"')
      : xf.replace("<xf ", '<xf applyFill="1" ');
    const newId = xfEntries.length;
    xfEntries.push(xf);
    blueStyleCache[origId] = newId;
    return newId;
  }

  // timeNumFmtバリアントスタイルのキャッシュ (J列の大豢小数を修正)
  const numFmtStyleCache: Record<number, number> = {};
  function createTimeNumFmtVariant(origId: number): number {
    if (!timeFmtId || numFmtStyleCache[origId] !== undefined) return numFmtStyleCache[origId] ?? origId;
    const orig = xfEntries[origId];
    if (!orig) return origId;
    let xf = orig.replace(/numFmtId="\d+"/, `numFmtId="${timeFmtId}"`);
    if (!xf.includes("applyNumberFormat=")) xf = xf.replace("<xf ", '<xf applyNumberFormat="1" ');
    const newId = xfEntries.length;
    xfEntries.push(xf);
    numFmtStyleCache[origId] = newId;
    return newId;
  }

  // --- worksheet XML の処理 ---
  const DATA_START_ROW = 15;
  const colsEM = ["E", "F", "G", "H", "I", "J", "K", "L", "M"];
  const COL_MAP: [string, keyof (typeof reports)[0]][] = [
    ["E", "start_time"],
    ["F", "site_arrival_time"],
    ["G", "work_start_time"],
    ["H", "work_end_time"],
    ["I", "return_time"],
    ["J", "end_time"],
  ];

  let totalReplacements = 0;
  for (const zipEntryName of Object.keys(zip.files)) {
    if (!/xl\/worksheets\/sheet\d+\.xml$/.test(zipEntryName)) continue;

    let xml = await zip.files[zipEntryName].async("string");
    console.log(`[export] processing sheet: ${zipEntryName} (xml length: ${xml.length})`);

    for (let day = 1; day <= 31; day++) {
      const rowNum = DATA_START_ROW + day - 1;
      let isSunday = false;
      if (day <= lastDay) {
        const d = new Date(year, month - 1, day);
        isSunday = d.getDay() === 0;
      }

      // E〜M列の背景色 → 日曜ならblueバリアントスタイルに更新
      if (isSunday) {
        for (const c of colsEM) {
          const reSt = new RegExp(`(<c r="${c}${rowNum}"[^>]*?)\\bs="(\\d+)"`);
          const cm = xml.match(reSt);
          if (cm) {
            const newSt = createBlueVariant(parseInt(cm[2]));
            xml = xml.replace(reSt, `$1s="${newSt}"`);
          }
        }
      }

      // J列のnumFmt修正 (平日末日)
      if (!isSunday && day <= lastDay) {
        const reJ = new RegExp(`(<c r="J${rowNum}"[^>]*?)\\bs="(\\d+)"`);
        const jm = xml.match(reJ);
        if (jm) {
          const newSt = createTimeNumFmtVariant(parseInt(jm[2]));
          xml = xml.replace(reJ, `$1s="${newSt}"`);
        }
      }

      if (day > lastDay) continue;
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const report = reportMap.get(dateStr);
      if (!report) continue;

      for (const [col, field] of COL_MAP) {
        const val = report[field];
        if (val == null || typeof val !== "number") continue;
        const excelTime = val / 1440;
        const cellRef = `${col}${rowNum}`;
        const reBefore = new RegExp(`<c r="${cellRef}"([^>]*)\\st="s"([^>]*)><v>[^<]*<\/v><\/c>`);
        if (reBefore.test(xml)) {
          xml = xml.replace(reBefore, `<c r="${cellRef}"$1$2><v>${excelTime}</v></c>`);
          continue;
        }
        const reAlt = new RegExp(`<c r="${cellRef}"([^>]*)t="s"([^>]*)><v>[^<]*<\/v><\/c>`);
        if (reAlt.test(xml)) {
          xml = xml.replace(reAlt, `<c r="${cellRef}"$1$2><v>${excelTime}</v></c>`);
          continue;
        }
        const reNum = new RegExp(`(<c r="${cellRef}"[^>]*>)<v>[^<]*<\/v>(<\/c>)`);
        if (reNum.test(xml)) xml = xml.replace(reNum, `$1<v>${excelTime}</v>$2`);
      }
    }

    if (xml.includes("<v>NaN</v>")) xml = xml.replace(/<v>NaN<\/v>/g, "<v>0</v>");
    xml = xml.replace(
      /(<c r="K15"[^>]*><f[^>]*>)F15-E15\+J15-I15(<\/f>)/,
      "$1F15-E15+J15-H15$2"
    );

    zip.file(zipEntryName, xml);
    console.log(`[export] sheet ${zipEntryName}: replacements done`);
  }

  // styles.xml を更新した xfEntries で再記述
  stylesXml = stylesXml.replace(
    /<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/,
    `<cellXfs count="${xfEntries.length}">${xfEntries.join("")}</cellXfs>`
  );
  zip.file("xl/styles.xml", stylesXml);

  console.log(`[export] all done, returning buffer`);

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
