// 公開回覆留言（spec.md 第 9 節）。
// Graph API：IG 用 POST /{comment-id}/replies；FB 粉專用 POST /{comment-id}/comments
//（兩平台「回覆某則留言」的端點不同名，其餘行為一致）。
import type { MetaCallResult, MetaClient } from './client';

export interface ReplyResult {
  id: string; // 回覆留言的 id
}

export function replyToComment(
  client: MetaClient,
  commentId: string,
  message: string,
  platform: 'instagram' | 'facebook' = 'instagram',
): Promise<MetaCallResult<ReplyResult>> {
  const path = platform === 'facebook' ? `${commentId}/comments` : `${commentId}/replies`;
  return client.post<ReplyResult>(path, { message });
}
