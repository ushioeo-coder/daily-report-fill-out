/**
 * ExcelJS 共通スタイルユーティリティ
 * 複数のExcel出力エンドポイントで使い回すヘルパー・定数をまとめたモジュール。
 */
import type ExcelJS from "exceljs";

// ─── 汎用スタイル定数 ───────────────────────────────────────────
export const centerMiddle: Partial<ExcelJS.Alignment> = {
  horizontal: "center",
  vertical: "middle",
};

export const THIN_BORDER: Partial<ExcelJS.Border> = { style: "thin" };

/**
 * セルの四辺すべてに細線ボーダーを適用するオブジェクトを返す
 */
export function thinAllBorders(): Partial<ExcelJS.Borders> {
  return {
    top: THIN_BORDER,
    left: THIN_BORDER,
    bottom: THIN_BORDER,
    right: THIN_BORDER,
  };
}

/**
 * ARGB色コードからExcelJS用の塗りつぶし(Fill)オブジェクトを作る
 * @param argb - 例: "FFF2F2F2"
 */
export function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}
