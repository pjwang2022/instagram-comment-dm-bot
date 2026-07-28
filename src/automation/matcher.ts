// 關鍵字比對引擎（spec.md 第 8.1 節）。作用於「已正規化」的留言與關鍵字。
import { normalizeCommentText } from './normalizer';

export type MatchType = 'contains_any' | 'exact_any' | 'all_comments';

export interface MatchResult {
  matched: boolean;
  matchedKeyword: string | null;
}

// normalizedComment：已用 normalizeCommentText 處理過的留言。
// normalizedKeywords：資料庫存的 normalized_keyword 清單（已正規化）。
export function matchKeywords(
  normalizedComment: string,
  normalizedKeywords: string[],
  matchType: MatchType,
): MatchResult {
  if (matchType === 'all_comments') {
    return { matched: true, matchedKeyword: null };
  }

  for (const keyword of normalizedKeywords) {
    if (!keyword) continue;
    if (matchType === 'contains_any' && normalizedComment.includes(keyword)) {
      return { matched: true, matchedKeyword: keyword };
    }
    if (matchType === 'exact_any' && normalizedComment === keyword) {
      return { matched: true, matchedKeyword: keyword };
    }
  }

  return { matched: false, matchedKeyword: null };
}

// 便利函式：直接吃原始留言，內部先正規化再比對。
export function matchRawComment(
  rawComment: string,
  normalizedKeywords: string[],
  matchType: MatchType,
): MatchResult {
  return matchKeywords(normalizeCommentText(rawComment), normalizedKeywords, matchType);
}
