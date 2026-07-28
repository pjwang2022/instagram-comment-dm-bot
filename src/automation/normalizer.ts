// 留言文字正規化（spec.md 第 8.2 節）。比對前用，不修改原始留言。
// 步驟：全形英數/空白轉半形 → 轉小寫 → 連續空白合併 → 移除前後空白。
// 保留中文與 Emoji（只轉換 U+FF01–U+FF5E 的全形 ASCII 與全形空白 U+3000）。

export function normalizeCommentText(input: string): string {
  // 全形 ASCII（U+FF01–U+FF5E）轉半形：偏移 0xFEE0。
  let s = input.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  // 全形空白（U+3000）轉半形空白。
  s = s.replace(/\u3000/g, ' ');
  // 英文字母轉小寫（中文、Emoji 不受影響）。
  s = s.toLowerCase();
  // 連續空白（含 tab/換行）合併為單一半形空白。
  s = s.replace(/\s+/g, ' ');
  // 移除前後空白。
  return s.trim();
}
