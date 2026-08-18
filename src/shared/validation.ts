// 共用驗證工具。

export function isValidHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export type MatchType = 'contains_any' | 'exact_any' | 'all_comments';
export const VALID_MATCH_TYPES: MatchType[] = ['contains_any', 'exact_any', 'all_comments'];

export interface ActivationCheckInput {
  automationExists: boolean;
  matchType: string;
  keywordCount: number;
  publicReplyEnabled: boolean;
  privateReplyEnabled: boolean;
  openingDm: string | null;
  buttonUrl: string | null;
  tokenHealthy: boolean;
  emergencyStop: boolean;
  // 綁定的媒體是限時動態：沒有公開回覆，私訊是唯一動作。
  isStory?: boolean;
}

// 啟用前驗證（spec.md 第 16.10 節）。回傳錯誤原因清單（空 = 可啟用）。
export function validateActivation(input: ActivationCheckInput): string[] {
  const errors: string[] = [];

  if (!input.automationExists) errors.push('automation_not_found');
  if (input.matchType !== 'all_comments' && input.keywordCount < 1) {
    errors.push('keywords_required');
  }
  if (input.isStory) {
    // 限動自動化沒有公開回覆，私訊是唯一動作，必須啟用。
    if (!input.privateReplyEnabled) errors.push('private_reply_required_for_story');
  } else if (!input.publicReplyEnabled && !input.privateReplyEnabled) {
    errors.push('at_least_one_reply_required');
  }
  if (input.privateReplyEnabled && (!input.openingDm || input.openingDm.trim() === '')) {
    errors.push('opening_dm_required');
  }
  // 有填 buttonUrl 時必須為有效 HTTPS。
  if (input.buttonUrl && !isValidHttpsUrl(input.buttonUrl)) {
    errors.push('button_url_invalid');
  }
  if (!input.tokenHealthy) errors.push('token_unhealthy');
  if (input.emergencyStop) errors.push('emergency_stop_active');

  return errors;
}
