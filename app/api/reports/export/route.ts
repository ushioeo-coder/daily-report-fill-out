import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { computeDerivedColumns } from "@/lib/calc";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 分 (0–2879) → Excel のシリアル時刻（日の端数）に変換。例: 480分(8:00) → 0.333… */
function minutesToExcelTime(minutes: number): number {
  return minutes / 1440;
}

const DAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

// ─── スタイル定数 ────────────────────────────────────────────────────────────
const HEADER_BG   = "FF4472C4"; // 列ヘッダー：青
const SUNDAY_BG   = "FFFFD7D7"; // 日曜行：薄赤
const SATURDAY_BG = "FFD7E8FF"; // 土曜行：薄青
const WEEKDAY_BG  = "FFFFFFFF"; // 平日行：白
const SUMMARY_BG  = "FFE2EFDA"; // 合計行：薄緑
const COUNT_BG    = "FFD9E1F2"; // 区分カウント行：薄紫
const GRAY_BG     = "FFD9D9D9"; // 当月外の日：グレー

const centerMiddle: Partial<ExcelJS.Alignment> = {
  horizontal: "center",
  vertical: "middle",
};
const THIN_BORDER: Partial<ExcelJS.Border> = { style: "thin" };
const MEDIUM_BORDER: Partial<ExcelJS.Border> = { style: "medium" };

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function thinAllBorders(): Partial<ExcelJS.Borders> {
  return { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };
}

/**
 * 1ユーザー分のワークシートを ExcelJS workbook に追加する。
 * テンプレートファイルには依存せず、すべてコードで生成する。
 *
 * 列レイアウト:
 *   A:日  B:曜  C:出勤区分
 *   D:①出社  E:②現場到着  F:③作業開始  G:④作業終了  H:⑤帰社  I:⑥退勤
 *   J:移動・社内作業  K:現場作業  L:残業  M:深夜勤務  N:休日出勤
 *   O:備考
 */
type PaidLeaveInfo = {
  total_granted: number;
  used_days: number;
  remaining_days: number;
};

function buildSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  userName: string,
  year: number,
  month: number,
  reportsMap: Map<string, Record<string, unknown>>,
  paidLeave?: PaidLeaveInfo
) {
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const lastDay = new Date(year, month, 0).getDate();

  // ─── 列幅 ────────────────────────────────────────────────────────────────
  ws.columns = [
    { width: 4.5 },  // A: 日
    { width: 4 },    // B: 曜
    { width: 10 },   // C: 出勤区分
    { width: 12 },   // D: ①出社        ─┐
    { width: 12 },   // E: ②現場到着      │
    { width: 12 },   // F: ③作業開始      │ D〜N すべて幅12で統一
    { width: 12 },   // G: ④作業終了      │ （折返しなしで表示できるサイズ）
    { width: 12 },   // H: ⑤帰社          │
    { width: 12 },   // I: ⑥退勤          │
    { width: 12 },   // J: 移動社内        │
    { width: 12 },   // K: 現場作業        │
    { width: 12 },   // L: 残業            │
    { width: 12 },   // M: 深夜勤務        │
    { width: 12 },   // N: 休日出勤      ─┘
    { width: 22 },   // O: 備考（D〜N を広げた分を吸収）
  ];

  // ─── Row 1: タイトル ────────────────────────────────────────────────────
  ws.mergeCells("A1:O1");
  const title = ws.getCell("A1");
  title.value = `${year}年 ${month}月分　日報`;
  title.font = { bold: true, size: 16, color: { argb: "FF1F3864" } };
  title.alignment = { ...centerMiddle };
  title.fill = solidFill("FFD6E4F0");
  ws.getRow(1).height = 32;

  // ─── Row 2: 社員名 ──────────────────────────────────────────────────────
  ws.mergeCells("A2:C2");
  ws.getCell("A2").value = "社員名";
  ws.getCell("A2").font = { bold: true, size: 10 };
  ws.getCell("A2").alignment = centerMiddle;
  ws.getCell("A2").fill = solidFill(COUNT_BG);
  ws.getCell("A2").border = thinAllBorders();

  ws.mergeCells("D2:O2");
  ws.getCell("D2").value = userName;
  ws.getCell("D2").font = { bold: true, size: 12 };
  ws.getCell("D2").alignment = { horizontal: "left", vertical: "middle" };
  ws.getCell("D2").border = thinAllBorders();
  ws.getRow(2).height = 24;

  // ─── Row 3: 空行 ────────────────────────────────────────────────────────
  ws.getRow(3).height = 8;

  // ─── Row 4: 列ヘッダー ──────────────────────────────────────────────────
  // ヘッダーラベル: \n（折返し）を除去し、長い名称は短縮
  // 「移動・社内作業」→「移動社内」に短縮（幅12でも折返しなく表示できるよう）
  const headerLabels = [
    "日", "曜", "出勤区分",
    "①出社", "②現場到着", "③作業開始", "④作業終了", "⑤帰社", "⑥退勤",
    "移動社内", "現場作業", "残業",
    "深夜勤務", "休日出勤", "備考",
  ];
  const headerRow = ws.getRow(4);
  headerRow.height = 24; // 折返しなしになったため40→24に削減
  headerLabels.forEach((label, i) => {
    const col = i + 1;
    const cell = headerRow.getCell(col);
    cell.value = label;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = solidFill(HEADER_BG);
    cell.alignment = { ...centerMiddle, wrapText: false }; // 折返しOFF
    // I列右・J列左は太線で「入力欄 / 集計欄」の境界を強調
    cell.border = {
      top:    THIN_BORDER,
      left:   col === 10 ? MEDIUM_BORDER : THIN_BORDER,
      bottom: THIN_BORDER,
      right:  col === 9  ? MEDIUM_BORDER : THIN_BORDER,
    };
  });

  // ─── Rows 5〜35: データ行（1〜31日） ────────────────────────────────────
  const DATA_START = 5;

  // 合計・区分カウント用
  let sumTravel = 0, sumSite = 0, sumOvertime = 0, sumDeepNight = 0, sumHoliday = 0;
  const atCount: Record<string, number> = {
    "出勤": 0, "欠勤": 0, "休日": 0, "有給": 0, "振休": 0, "休日出勤": 0,
  };

  for (let day = 1; day <= 31; day++) {
    const rowNum = DATA_START + day - 1;
    const dataRow = ws.getRow(rowNum);
    dataRow.height = 22; // 18pt → 22pt に増量して見やすく

    // 当月に存在しない日（例：2月の30・31日）
    if (day > lastDay) {
      for (let c = 1; c <= 15; c++) {
        const cell = dataRow.getCell(c);
        cell.fill = solidFill(GRAY_BG);
        cell.border = {
          top:    { style: "thin", color: { argb: "FFBFBFBF" } },
          // I列右・J列左は太線で区切り強調
          left:   c === 10
            ? MEDIUM_BORDER
            : { style: "thin", color: { argb: "FFBFBFBF" } },
          bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
          right:  c === 9
            ? MEDIUM_BORDER
            : { style: "thin", color: { argb: "FFBFBFBF" } },
        };
      }
      continue;
    }

    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const d = new Date(dateStr + "T00:00:00");
    const dow = d.getDay(); // 0=日, 6=土
    const isSun = dow === 0;
    const isSat = dow === 6;
    const bgColor = isSun ? SUNDAY_BG : isSat ? SATURDAY_BG : WEEKDAY_BG;

    const report = reportsMap.get(dateStr) ?? null;
    const derived = report ? computeDerivedColumns(report as Parameters<typeof computeDerivedColumns>[0]) : null;

    // 集計値に加算
    if (derived) {
      sumTravel    += derived.travel_office_minutes ?? 0;
      sumSite      += derived.site_work_minutes     ?? 0;
      sumOvertime  += derived.overtime_minutes      ?? 0;
      sumDeepNight += derived.deep_night_minutes    ?? 0;
      sumHoliday   += derived.holiday_work_minutes  ?? 0;
      const at = (report as Record<string, unknown>)?.attendance_type as string | null;
      if (at && at in atCount) atCount[at]++;
    }

    /** セルに値・スタイルを一括設定するヘルパー */
    const setCell = (
      col: number,
      value: ExcelJS.CellValue,
      opts?: { numFmt?: string; align?: Partial<ExcelJS.Alignment>; font?: Partial<ExcelJS.Font> }
    ) => {
      const cell = dataRow.getCell(col);
      cell.value = value ?? null;
      cell.fill = solidFill(bgColor);
      // I列(9)右・J列(10)左は太線で「入力欄 / 集計欄」の境界を強調
      cell.border = {
        top:    { style: "thin", color: { argb: "FFBFBFBF" } },
        left:   col === 10
          ? MEDIUM_BORDER
          : { style: "thin", color: { argb: "FFBFBFBF" } },
        bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
        right:  col === 9
          ? MEDIUM_BORDER
          : { style: "thin", color: { argb: "FFBFBFBF" } },
      };
      cell.alignment = opts?.align ?? centerMiddle;
      if (opts?.numFmt) cell.numFmt = opts.numFmt;
      if (opts?.font)   cell.font   = opts.font;
    };

    // A: 日
    setCell(1, day);

    // B: 曜
    setCell(2, DAYS_JA[dow], {
      font: isSun
        ? { bold: true, color: { argb: "FFCC0000" } }
        : isSat
        ? { bold: true, color: { argb: "FF0070C0" } }
        : undefined,
    });

    if (!report) {
      // データなし → 日・曜以外は空欄
      for (let c = 3; c <= 15; c++) setCell(c, null);
      continue;
    }

    const r = report as Record<string, unknown>;

    // C: 出勤区分
    setCell(3, (r.attendance_type as string) ?? null);

    // D〜I: 時刻（分 → Excel 時刻）
    const timeKeys = [
      "start_time", "site_arrival_time", "work_start_time",
      "work_end_time", "return_time", "end_time",
    ];
    timeKeys.forEach((key, idx) => {
      const val = r[key];
      setCell(
        4 + idx,
        val != null ? minutesToExcelTime(val as number) : null,
        { numFmt: "h:mm" }
      );
    });

    // J: 移動・社内作業
    setCell(10,
      (derived?.travel_office_minutes ?? 0) > 0
        ? minutesToExcelTime(derived!.travel_office_minutes!)
        : null,
      { numFmt: "[h]:mm" }
    );
    // K: 現場作業
    setCell(11,
      (derived?.site_work_minutes ?? 0) > 0
        ? minutesToExcelTime(derived!.site_work_minutes!)
        : null,
      { numFmt: "[h]:mm" }
    );
    // L: 残業
    setCell(12,
      (derived?.overtime_minutes ?? 0) > 0
        ? minutesToExcelTime(derived!.overtime_minutes!)
        : null,
      { numFmt: "[h]:mm" }
    );
    // M: 深夜勤務
    setCell(13,
      (derived?.deep_night_minutes ?? 0) > 0
        ? minutesToExcelTime(derived!.deep_night_minutes!)
        : null,
      { numFmt: "[h]:mm" }
    );
    // N: 休日出勤
    setCell(14,
      (derived?.holiday_work_minutes ?? 0) > 0
        ? minutesToExcelTime(derived!.holiday_work_minutes!)
        : null,
      { numFmt: "[h]:mm" }
    );
    // O: 備考（左揃え）
    setCell(15, (r.note as string) ?? null, {
      align: { horizontal: "left", vertical: "middle" },
    });
  }

  // ─── 合計行 ─────────────────────────────────────────────────────────────
  const SUM_ROW = DATA_START + 31; // 36行目
  const sumRow = ws.getRow(SUM_ROW);
  sumRow.height = 26; // 22pt → 26pt に増量

  ws.mergeCells(`A${SUM_ROW}:I${SUM_ROW}`);
  const sumLabel = sumRow.getCell(1);
  sumLabel.value = "月　合　計";
  sumLabel.font = { bold: true, size: 11, color: { argb: "FF1F3864" } };
  sumLabel.fill = solidFill(SUMMARY_BG);
  sumLabel.alignment = centerMiddle;
  sumLabel.border = {
    top: MEDIUM_BORDER, left: MEDIUM_BORDER,
    // I列（マージ末尾）の右も太線で区切り強調
    bottom: MEDIUM_BORDER, right: MEDIUM_BORDER,
  };

  const writeSumCell = (col: number, minutes: number, isLast = false) => {
    const cell = sumRow.getCell(col);
    cell.value = minutes > 0 ? minutesToExcelTime(minutes) : null;
    cell.numFmt = "[h]:mm";
    cell.font = { bold: true, size: 11 };
    cell.fill = solidFill(SUMMARY_BG);
    cell.alignment = centerMiddle;
    cell.border = {
      top: MEDIUM_BORDER,
      // J列(10)左は太線
      left: col === 10 ? MEDIUM_BORDER : THIN_BORDER,
      bottom: MEDIUM_BORDER,
      right: isLast ? MEDIUM_BORDER : THIN_BORDER,
    };
  };

  writeSumCell(10, sumTravel);
  writeSumCell(11, sumSite);
  writeSumCell(12, sumOvertime);
  writeSumCell(13, sumDeepNight);
  writeSumCell(14, sumHoliday);

  // O列（備考）の合計セル（空）
  const lastSumCell = sumRow.getCell(15);
  lastSumCell.fill = solidFill(SUMMARY_BG);
  lastSumCell.border = {
    top: MEDIUM_BORDER, left: THIN_BORDER,
    bottom: MEDIUM_BORDER, right: MEDIUM_BORDER,
  };

  // ─── 出勤区分別カウント行 ─────────────────────────────────────────────
  const COUNT_ROW = SUM_ROW + 2; // 38行目
  const countRow = ws.getRow(COUNT_ROW);
  countRow.height = 22; // 20pt → 22pt に増量

  ws.mergeCells(`A${COUNT_ROW}:B${COUNT_ROW}`);
  const countLabel = countRow.getCell(1);
  countLabel.value = "区分別"; // "出勤区分別" は文字が見切れるため短縮
  countLabel.font = { bold: true, size: 10 };
  countLabel.alignment = centerMiddle;
  countLabel.fill = solidFill(COUNT_BG);
  countLabel.border = thinAllBorders();

  const countTypes: [string, number][] = [
    ["出勤",    atCount["出勤"]],
    ["欠勤",    atCount["欠勤"]],
    ["休日",    atCount["休日"]],
    ["有給",    atCount["有給"]],
    ["振休",    atCount["振休"]],
    ["休日出勤",atCount["休日出勤"]],
  ];
  // C〜N列に ラベル | 件数 を2列ペアで並べる
  countTypes.forEach(([label, count], i) => {
    const labelCol = 3 + i * 2;
    const valueCol = labelCol + 1;

    const lc = countRow.getCell(labelCol);
    lc.value = label;
    lc.font = { bold: true, size: 10 };
    lc.alignment = centerMiddle;
    lc.fill = solidFill(COUNT_BG);
    lc.border = thinAllBorders();

    const vc = countRow.getCell(valueCol);
    vc.value = count;
    vc.alignment = centerMiddle;
    vc.border = thinAllBorders();
  });

  // ─── O列（備考列の余白）に有給残日数を表示 ────────────────────────────
  // 合計行のO・空行37・区分カウント行のOを縦結合して有給残日数バッジとして使用
  if (paidLeave && paidLeave.total_granted > 0) {
    // SUM_ROW〜COUNT_ROW の O列を縦結合（3行分）
    ws.mergeCells(`O${SUM_ROW}:O${COUNT_ROW}`);
    const plCell = sumRow.getCell(15); // mergeCells後は先頭セルに値を入れる

    const remaining = paidLeave.remaining_days;
    const bgArgb =
      remaining === 0 ? "FFFFD7D7" :   // 赤系（残0日）
      remaining <= 3  ? "FFFFF2CC" :   // 黄系（残3日以下）
                        "FFE2EFDA";    // 緑系（余裕あり）
    const textArgb =
      remaining === 0 ? "FFCC0000" :
      remaining <= 3  ? "FF7F6000" :
                        "FF375623";

    plCell.value =
      `有給残 ${remaining}日\n` +
      `(付与${paidLeave.total_granted}日 / 取得${paidLeave.used_days}日)`;
    plCell.font = { bold: true, size: 11, color: { argb: textArgb } };
    plCell.fill = solidFill(bgArgb);
    plCell.alignment = { ...centerMiddle, wrapText: true };
    plCell.border = {
      top: MEDIUM_BORDER, left: THIN_BORDER,
      bottom: MEDIUM_BORDER, right: MEDIUM_BORDER,
    };
  }
}

// ─── API ハンドラー ──────────────────────────────────────────────────────────

/**
 * POST /api/reports/export
 * body: { user_id, year, month }
 *
 * admin のみ: 指定ユーザーの月報を Excel で生成してダウンロード。
 * user_id が "all" の場合は全ユーザー分を1ファイルに（シート別）まとめる。
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

  // ─── 対象ユーザー取得 ─────────────────────────────────────────────────
  let usersToExport: { id: string; name: string }[] = [];

  if (user_id === "all") {
    const { data: allUsers, error } = await supabase
      .from("users")
      .select("id, name")
      .order("employee_id", { ascending: true });
    if (error || !allUsers?.length) {
      return NextResponse.json(
        { error: "ユーザーの取得に失敗しました。" },
        { status: 500 }
      );
    }
    usersToExport = allUsers;
  } else {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name")
      .eq("id", user_id)
      .single();
    if (error || !user) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません。" },
        { status: 404 }
      );
    }
    usersToExport = [user];
  }

  // ─── 対象月の日報を一括取得 ───────────────────────────────────────────
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to   = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const { data: reports, error: reportsError } = await supabase
    .from("daily_reports")
    .select(
      "user_id, report_date, attendance_type, " +
      "start_time, site_arrival_time, work_start_time, work_end_time, return_time, end_time, note"
    )
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

  // ユーザーID → { 日付文字列 → レポート } のマップを作成
  const userIds = new Set(usersToExport.map((u) => u.id));
  const userReportMap = new Map<string, Map<string, Record<string, unknown>>>();
  for (const uid of userIds) userReportMap.set(uid, new Map());

  for (const r of reports ?? []) {
    if (!userReportMap.has(r.user_id)) continue;
    const rd = r.report_date;
    const dateKey =
      rd instanceof Date ? rd.toISOString().slice(0, 10) : String(rd).slice(0, 10);
    userReportMap.get(r.user_id)!.set(dateKey, r as Record<string, unknown>);
  }

  // ─── 有給残日数を全対象ユーザー分まとめて取得（FIFO方式） ────────────
  // カスタムクライアントは .in() 未対応のため、ユーザーごとに並列クエリを実行
  const userIdList = usersToExport.map((u) => u.id);

  const [grantsResults, usedResults] = await Promise.all([
    Promise.all(
      userIdList.map((uid) =>
        supabase
          .from("paid_leave_grants")
          .select("user_id, granted_days, expiry_date")
          .eq("user_id", uid)
          .order("expiry_date", { ascending: true })
      )
    ),
    Promise.all(
      userIdList.map((uid) =>
        supabase
          .from("daily_reports")
          .select("user_id")
          .eq("user_id", uid)
          .eq("attendance_type", "有給")
      )
    ),
  ]);

  const allGrants  = grantsResults.flatMap((r) => (r.data ?? []) as { user_id: string; granted_days: number | string; expiry_date: string | Date }[]);
  const allUsedRows = usedResults.flatMap((r)  => (r.data ?? []) as { user_id: string }[]);

  const todayStr = new Date().toISOString().split("T")[0];
  const userPaidLeaveMap = new Map<string, PaidLeaveInfo>();

  for (const uid of userIdList) {
    // 有効期限の古い順にソートされたバケツを作成
    const grants = allGrants
      .filter((g) => g.user_id === uid)
      .sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime());

    const rawUsed = allUsedRows.filter((r) => r.user_id === uid).length;

    const buckets = grants.map((g) => ({
      expiryStr: new Date(g.expiry_date).toISOString().slice(0, 10),
      granted:   Number(g.granted_days),
      remaining: Number(g.granted_days),
    }));

    // FIFO: 古い付与から順に消化を割り当て
    let leftover = rawUsed;
    for (const b of buckets) {
      if (leftover <= 0) break;
      const deduct = Math.min(leftover, b.remaining);
      b.remaining -= deduct;
      leftover -= deduct;
    }

    const validBuckets  = buckets.filter((b) => b.expiryStr >= todayStr);
    const totalGranted  = validBuckets.reduce((s, b) => s + b.granted, 0);
    const remainingDays = validBuckets.reduce((s, b) => s + b.remaining, 0);

    userPaidLeaveMap.set(uid, {
      total_granted:  totalGranted,
      used_days:      totalGranted - remainingDays,
      remaining_days: remainingDays,
    });
  }

  // ─── Excel を生成 ─────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator  = "日報システム";
  wb.created  = new Date();
  wb.modified = new Date();

  for (const user of usersToExport) {
    // Excel のシート名制約（31文字以内・使用不可文字を除去）に対応
    let safeName = user.name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
    let finalName = safeName;
    let dup = 1;
    while (wb.getWorksheet(finalName)) {
      finalName = `${safeName.substring(0, 28)}_${dup++}`;
    }

    buildSheet(
      wb, finalName, user.name, year, month,
      userReportMap.get(user.id)!,
      userPaidLeaveMap.get(user.id)
    );
  }

  // ─── バッファ出力 ─────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();

  const fileName =
    user_id === "all"
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
