import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/validation";
import { centerMiddle, solidFill, thinAllBorders } from "@/lib/excel-styles";

// ─── 有給管理簿固有のスタイル定数 ────────────────────────────────
const HEADER_BG = "FFF2F2F2";
const LEAVE_BG = "FFB4C6E7";
const HOLIDAY_WORK_BG = "FFFCE4D6";
const FURIKYU_BG = "FFE2EFDA";
const ABSENT_BG = "FFFFC7CE";
const NONEXISTENT_DAY_BG = "FFD9D9D9";

// 年間休日日数（会社規程値）
const ANNUAL_HOLIDAYS = 105;

// 出勤区分 → Excelシンボル変換マップ
const SYMBOL_MAP: Record<string, string> = {
  出勤: "出",
  欠勤: "欠",
  休日: "/",
  有給: "有",
  振休: "振",
  休日出勤: "休出",
};

// シンボルごとの背景色
const SYMBOL_FILL: Record<string, string> = {
  有: LEAVE_BG,
  休出: HOLIDAY_WORK_BG,
  振: FURIKYU_BG,
  欠: ABSENT_BG,
};

type GrantRow = {
  id: string;
  user_id: string;
  grant_date: string | Date;
  granted_days: number | string;
  expiry_date: string | Date;
  note?: string | null;
};

type UserRow = {
  id: string;
  name: string;
  department?: string;
  hire_date?: string | Date | null;
};

type ReportRow = {
  report_date: string | Date;
  attendance_type: string | null;
};

function toDateStr(d: string | Date): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/**
 * 有給休暇管理簿のワークシートを生成する
 */
function buildLeaveSheet(
  wb: ExcelJS.Workbook,
  user: UserRow,
  grant: GrantRow,
  carryoverDays: number,
  reports: ReportRow[],
  holidaySet: Set<string>,
) {
  const grantDate = new Date(grant.grant_date);
  const expiryDate = new Date(grant.expiry_date);
  const grantedDays = Number(grant.granted_days);
  const startMonth = grantDate.getMonth(); // 0-indexed
  const startYear = grantDate.getFullYear();

  // 年度表示（例: "2025~2026"）
  const endYear = startMonth === 0 ? startYear : startYear + 1;
  const fiscalYearLabel =
    startMonth === 0 ? `${startYear}` : `${startYear}~${endYear}`;

  const sheetName = `${user.name}(${startYear}.${startMonth + 1}~)`.slice(0, 31);
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: {
        left: 0.25, right: 0.25,
        top: 0.4,   bottom: 0.4,
        header: 0,  footer: 0,
      },
    },
  });

  // 日報データをマップ化 (YYYY-MM-DD → attendance_type)
  const reportsMap = new Map<string, string>();
  for (const r of reports) {
    const dateStr = toDateStr(r.report_date);
    if (r.attendance_type) {
      reportsMap.set(dateStr, r.attendance_type);
    }
  }

  // ─── 列幅設定 ──────────────────────────────────────────────────
  // A=spacer, B=月, C=取得, D=残日数, E~AI=1日~31日, AJ=spacer, AK=出勤日数
  // ※日付列は最低3.5以上ないと結合セル内の日本語テキストが######になる
  const columns: Partial<ExcelJS.Column>[] = [
    { width: 3.5 }, // A: spacer
    { width: 5.5 }, // B: 月
    { width: 7 },   // C: 取得
    { width: 7.5 }, // D: 残日数
  ];
  for (let i = 0; i < 31; i++) columns.push({ width: 4.0 }); // E~AI: 1日~31日
  columns.push({ width: 2.5 }); // AJ: spacer
  columns.push({ width: 7 });   // AK: 出勤日数
  ws.columns = columns;

  const font10 = { name: "Meiryo UI", size: 10 };
  const font8 = { name: "Meiryo UI", size: 8 };
  const font14 = { name: "Meiryo UI", size: 14 };

  // ─── Row 1: タイトル ───────────────────────────────────────────
  ws.mergeCells("A1:AK1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "個人別年次有給休暇管理簿";
  titleCell.font = { ...font14 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 54;

  // Row 2: spacer
  ws.getRow(2).height = 20;

  // ─── Row 3: 社員情報 ──────────────────────────────────────────
  ws.getRow(3).height = 42;
  ws.getCell("B3").value = "所属";
  ws.getCell("B3").font = font10;
  ws.getCell("C3").value = user.department || "";
  ws.getCell("C3").font = font10;
  ws.getCell("H3").value = "氏名";
  ws.getCell("H3").font = font10;
  ws.getCell("J3").value = user.name;
  ws.getCell("J3").font = font10;
  // 年間休日日数: 氏名と年度表示の間の余白に配置
  ws.mergeCells("W3:Z3");
  ws.getCell("W3").value = "年間休日日数";
  ws.getCell("W3").font = font8;
  ws.getCell("W3").alignment = centerMiddle;
  ws.mergeCells("AA3:AB3");
  ws.getCell("AA3").value = ANNUAL_HOLIDAYS;
  ws.getCell("AA3").font = font10;
  ws.getCell("AA3").alignment = centerMiddle;
  ws.getCell("AC3").value = "日";
  ws.getCell("AC3").font = font10;
  // 年度表示
  ws.mergeCells("AD3:AH3");
  ws.getCell("AD3").value = fiscalYearLabel;
  ws.getCell("AD3").font = font10;
  ws.getCell("AD3").alignment = centerMiddle;
  ws.getCell("AI3").value = "年度";
  ws.getCell("AI3").font = font10;

  // Row 4: spacer
  ws.getRow(4).height = 14;

  // ─── Row 5-6: 有給付与情報 ────────────────────────────────────
  ws.getRow(5).height = 42;
  ws.getRow(6).height = 42;

  // 入社日
  ws.mergeCells("B5:C5");
  ws.getCell("B5").value = "入社日";
  ws.getCell("B5").font = font10;
  ws.getCell("B5").alignment = centerMiddle;
  ws.getCell("B5").border = thinAllBorders();

  ws.mergeCells("D5:F5");
  if (user.hire_date) {
    ws.getCell("D5").value = new Date(user.hire_date);
    ws.getCell("D5").numFmt = "yyyy/mm/dd";
  }
  ws.getCell("D5").font = font10;
  ws.getCell("D5").alignment = centerMiddle;
  ws.getCell("D5").border = thinAllBorders();

  // 基準日(付与日)
  ws.mergeCells("B6:C6");
  ws.getCell("B6").value = "基準日(付与日)";
  ws.getCell("B6").font = font8;
  ws.getCell("B6").alignment = centerMiddle;
  ws.getCell("B6").border = thinAllBorders();

  ws.mergeCells("D6:F6");
  ws.getCell("D6").value = grantDate;
  ws.getCell("D6").numFmt = "yyyy/mm/dd";
  ws.getCell("D6").font = font10;
  ws.getCell("D6").alignment = centerMiddle;
  ws.getCell("D6").border = thinAllBorders();

  // 有効期間
  ws.mergeCells("G5:J6");
  ws.getCell("G5").value = "有効期間";
  ws.getCell("G5").font = font10;
  ws.getCell("G5").alignment = centerMiddle;
  ws.getCell("G5").border = thinAllBorders();

  // 有効期間の日付テキスト
  const grantMonth = grantDate.getMonth() + 1;
  const grantDay = grantDate.getDate();
  ws.mergeCells("K5:R5");
  ws.getCell("K5").value = ` ${grantDate.getFullYear()} 年  ${grantMonth}月  ${grantDay}日(基準日) `;
  ws.getCell("K5").font = font10;
  ws.getCell("K5").alignment = centerMiddle;
  ws.getCell("K5").border = thinAllBorders();

  ws.mergeCells("K6:R6");
  const expMonth = expiryDate.getMonth() + 1;
  const expDay = expiryDate.getDate();
  ws.getCell("K6").value = `～ ${expiryDate.getFullYear()}年  ${expMonth}月  ${expDay}日`;
  ws.getCell("K6").font = font10;
  ws.getCell("K6").alignment = centerMiddle;
  ws.getCell("K6").border = thinAllBorders();

  // 前年度繰越日数
  ws.mergeCells("S5:V5");
  ws.getCell("S5").value = "前年度繰越日数";
  ws.getCell("S5").font = font10;
  ws.getCell("S5").alignment = centerMiddle;
  ws.getCell("S5").border = thinAllBorders();

  ws.mergeCells("W5:Y5");
  ws.getCell("W5").value = carryoverDays;
  ws.getCell("W5").font = font10;
  ws.getCell("W5").alignment = centerMiddle;
  ws.getCell("W5").border = thinAllBorders();

  // 今年度付与日数
  ws.mergeCells("S6:V6");
  ws.getCell("S6").value = "今年度付与日数";
  ws.getCell("S6").font = font10;
  ws.getCell("S6").alignment = centerMiddle;
  ws.getCell("S6").border = thinAllBorders();

  ws.mergeCells("W6:Y6");
  ws.getCell("W6").value = grantedDays;
  ws.getCell("W6").font = font10;
  ws.getCell("W6").alignment = centerMiddle;
  ws.getCell("W6").border = thinAllBorders();

  // 合計日数
  ws.mergeCells("Z5:AC6");
  ws.getCell("Z5").value = "合計日数";
  ws.getCell("Z5").font = font10;
  ws.getCell("Z5").alignment = centerMiddle;
  ws.getCell("Z5").border = thinAllBorders();

  ws.mergeCells("AD5:AI6");
  ws.getCell("AD5").value = { formula: "W5+W6" };
  ws.getCell("AD5").font = { ...font14, bold: true };
  ws.getCell("AD5").alignment = centerMiddle;
  ws.getCell("AD5").border = thinAllBorders();

  // Row 7: spacer
  ws.getRow(7).height = 14;

  // ─── Row 8: ヘッダー行 ────────────────────────────────────────
  ws.getRow(8).height = 46;

  const headerCells: [string, string][] = [
    ["B8", "月"],
    ["C8", "取得"],
    ["D8", "残日数"],
  ];
  for (let d = 1; d <= 31; d++) {
    const colNum = 4 + d; // E=5, F=6, ..., AI=35
    const cell = ws.getCell(8, colNum);
    cell.value = `${d}日`;
    cell.font = font8;
    cell.alignment = centerMiddle;
    cell.fill = solidFill(HEADER_BG);
    cell.border = thinAllBorders();
  }

  ws.getCell("AK8").value = "出勤日数";
  ws.getCell("AK8").font = font8;
  ws.getCell("AK8").alignment = centerMiddle;
  ws.getCell("AK8").fill = solidFill(HEADER_BG);
  ws.getCell("AK8").border = thinAllBorders();

  for (const [ref, label] of headerCells) {
    const cell = ws.getCell(ref);
    cell.value = label;
    cell.font = font10;
    cell.alignment = centerMiddle;
    cell.fill = solidFill(HEADER_BG);
    cell.border = thinAllBorders();
  }

  // ─── Rows 9-20: 12ヶ月分データ ────────────────────────────────
  for (let mi = 0; mi < 12; mi++) {
    const rowNum = 9 + mi;
    ws.getRow(rowNum).height = 46;

    const monthIndex = (startMonth + mi) % 12;
    const yearOfMonth = startYear + Math.floor((startMonth + mi) / 12);
    const daysInMonth = new Date(yearOfMonth, monthIndex + 1, 0).getDate();

    // B列: 月名
    const cellB = ws.getCell(rowNum, 2);
    cellB.value = `${monthIndex + 1}月`;
    cellB.font = font10;
    cellB.alignment = centerMiddle;
    cellB.border = thinAllBorders();

    let leaveCount = 0;
    let workCount = 0;

    for (let day = 1; day <= 31; day++) {
      const colNum = 4 + day;
      const cell = ws.getCell(rowNum, colNum);
      cell.font = font8;
      cell.alignment = centerMiddle;
      cell.border = thinAllBorders();

      if (day > daysInMonth) {
        cell.fill = solidFill(NONEXISTENT_DAY_BG);
        continue;
      }

      const mm = String(monthIndex + 1).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      const dateStr = `${yearOfMonth}-${mm}-${dd}`;
      const dayOfWeek = new Date(yearOfMonth, monthIndex, day).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const attendanceType = reportsMap.get(dateStr);

      if (attendanceType) {
        // 日報が登録されている日だけシンボルを表示する
        // attendance_type '休日' → "/" は SYMBOL_MAP 経由で変換される
        const symbol = SYMBOL_MAP[attendanceType] || "";
        cell.value = symbol;
        if (SYMBOL_FILL[symbol]) cell.fill = solidFill(SYMBOL_FILL[symbol]);
        if (attendanceType === "有給") leaveCount++;
        if (attendanceType === "出勤" || attendanceType === "休日出勤") workCount++;
      }
      // 日報未入力の日は空欄のまま（"/" を自動挿入しない）
    }

    // C列: 有給取得日数
    const cellC = ws.getCell(rowNum, 3);
    cellC.value = leaveCount;
    cellC.font = font10;
    cellC.alignment = centerMiddle;
    cellC.border = thinAllBorders();

    // D列: 残日数（数式）
    const cellD = ws.getCell(rowNum, 4);
    cellD.value = mi === 0
      ? { formula: "AD5-C9" }
      : { formula: `D${rowNum - 1}-C${rowNum}` };
    cellD.font = font10;
    cellD.alignment = centerMiddle;
    cellD.border = thinAllBorders();

    // AK列: 出勤日数
    const cellAK = ws.getCell(rowNum, 37); // AK=37
    cellAK.value = workCount;
    cellAK.font = font10;
    cellAK.alignment = centerMiddle;
    cellAK.border = thinAllBorders();
  }

  // Row 21: spacer
  ws.getRow(21).height = 14;

  // ─── Rows 22-24: 凡例 ─────────────────────────────────────────
  ws.getRow(22).height = 36;
  ws.getRow(23).height = 36;
  ws.getRow(24).height = 36;

  // ─── 凡例: 行全体を1つのセルに結合してテキストが切れないようにする ─
  ws.getCell("B22").value = "(記入記号)";
  ws.getCell("B22").font = font10;

  // 23行目: B〜AI列（日付列全体）を1つに結合
  ws.mergeCells("B23:AI23");
  ws.getCell("B23").value =
    "有：年次有給休暇取得日          〇：計画的年休付与予定日";
  ws.getCell("B23").font = font10;

  // 24行目: B〜AI列（日付列全体）を1つに結合
  ws.mergeCells("B24:AI24");
  ws.getCell("B24").value =
    "/ ：土日祝、会社所定休日          特：特別休暇          欠：欠勤          休出：休日出勤          出：出勤          振：振替休日";
  ws.getCell("B24").font = font10;
}

/**
 * POST /api/reports/export-leave
 * 管理者のみ: 年次有給休暇管理簿をExcel出力
 * body: { user_id: string, grant_id: string }
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
  const { user_id, grant_id } = body ?? {};

  if (!user_id || !UUID_RE.test(user_id)) {
    return NextResponse.json(
      { error: "有効な user_id が必要です。" },
      { status: 400 },
    );
  }
  if (!grant_id || !UUID_RE.test(grant_id)) {
    return NextResponse.json(
      { error: "有効な grant_id が必要です。" },
      { status: 400 },
    );
  }

  // ─── user / grant / 全付与 を並列取得 ─────────────────────────
  const [userResult, grantResult, prevGrantsResult] = await Promise.all([
    supabase
      .from("users")
      .select("id, name, department, hire_date")
      .eq("id", user_id)
      .single(),
    supabase
      .from("paid_leave_grants")
      .select("id, user_id, grant_date, granted_days, expiry_date, note")
      .eq("id", grant_id)
      .eq("user_id", user_id)
      .single(),
    supabase
      .from("paid_leave_grants")
      .select("id, grant_date, granted_days, expiry_date")
      .eq("user_id", user_id)
      .order("grant_date", { ascending: true }),
  ]);

  if (userResult.error || !userResult.data) {
    return NextResponse.json(
      { error: "ユーザーが見つかりません。" },
      { status: 404 },
    );
  }
  if (grantResult.error || !grantResult.data) {
    return NextResponse.json(
      { error: "有給付与情報が見つかりません。" },
      { status: 404 },
    );
  }

  const user = userResult.data as UserRow;
  const grant = grantResult.data as GrantRow;

  // ─── 期間計算 ──────────────────────────────────────────────────
  const grantDate = new Date(grant.grant_date);
  const grantDateStr = toDateStr(grantDate);
  const startMonth = grantDate.getMonth();
  const startYear = grantDate.getFullYear();

  const periodStart = `${startYear}-${String(startMonth + 1).padStart(2, "0")}-01`;
  const endMonthIndex = (startMonth + 11) % 12;
  const endYear = startYear + Math.floor((startMonth + 11) / 12);
  const endLastDay = new Date(endYear, endMonthIndex + 1, 0).getDate();
  const periodEnd = `${endYear}-${String(endMonthIndex + 1).padStart(2, "0")}-${endLastDay}`;

  // ─── 前年度繰越の対象付与を特定 ───────────────────────────────
  type PrevGrantRow = {
    id: string;
    grant_date: string | Date;
    granted_days: number | string;
    expiry_date: string | Date;
  };
  const prevGrantRows = (
    Array.isArray(prevGrantsResult.data) ? prevGrantsResult.data : []
  ) as PrevGrantRow[];

  const overlappingPrev = prevGrantRows.find((g) => {
    const gd = toDateStr(g.grant_date);
    const exp = toDateStr(g.expiry_date);
    return gd < grantDateStr && exp >= grantDateStr;
  });

  // ─── 日報・休日・前回有給使用数 を並列取得 ─────────────────────
  const prevUsedQuery = overlappingPrev
    ? supabase
        .from("daily_reports")
        .select("id")
        .eq("user_id", user_id)
        .eq("attendance_type", "有給")
        .gte("report_date", toDateStr(overlappingPrev.grant_date))
        .lt("report_date", grantDateStr)
    : Promise.resolve({ data: [] as { id: string }[], error: null });

  const [reportsResult, holidaysResult, prevUsedResult] = await Promise.all([
    supabase
      .from("daily_reports")
      .select("report_date, attendance_type")
      .eq("user_id", user_id)
      .gte("report_date", periodStart)
      .lte("report_date", periodEnd),
    supabase
      .from("company_holidays")
      .select("holiday_date")
      .gte("holiday_date", periodStart)
      .lte("holiday_date", periodEnd),
    prevUsedQuery,
  ]);

  if (reportsResult.error) {
    return NextResponse.json(
      { error: "日報データの取得に失敗しました。" },
      { status: 500 },
    );
  }

  // ─── 繰越日数の算出 ────────────────────────────────────────────
  let carryoverDays = 0;
  if (overlappingPrev) {
    const prevUsed = Array.isArray(prevUsedResult.data)
      ? prevUsedResult.data.length
      : 0;
    carryoverDays = Math.max(0, Number(overlappingPrev.granted_days) - prevUsed);
  }

  // ─── 休日セットの構築 ──────────────────────────────────────────
  const holidaySet = new Set<string>();
  if (Array.isArray(holidaysResult.data)) {
    for (const h of holidaysResult.data as { holiday_date: string | Date }[]) {
      holidaySet.add(toDateStr(h.holiday_date));
    }
  }

  const reports = (reportsResult.data as ReportRow[]) || [];

  // ─── Excel生成・レスポンス ─────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  buildLeaveSheet(wb, user, grant, carryoverDays, reports, holidaySet);

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `有給休暇管理簿_${user.name}_${startYear}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
