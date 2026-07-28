// 公開回覆版本隨機選擇（spec.md 第 9 節、第 26 節單元測試項）。
// 從「已啟用」的公開回覆版本中均勻隨機選一則。
export interface PublicReplyVariant {
  id: string;
  message: string;
  enabled: boolean;
}

// randomFn：可注入的亂數來源（預設 Math.random），方便測試時決定選擇結果。
export function selectPublicReply(
  variants: PublicReplyVariant[],
  randomFn: () => number = Math.random,
): PublicReplyVariant | null {
  const enabled = variants.filter((v) => v.enabled);
  if (enabled.length === 0) return null;
  const index = Math.floor(randomFn() * enabled.length);
  // 夾在合法範圍內（防 randomFn 回傳 1 時越界）。
  const safeIndex = Math.min(index, enabled.length - 1);
  return enabled[safeIndex];
}
