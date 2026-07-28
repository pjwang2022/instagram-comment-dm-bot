// 公開回覆留言（spec.md 第 9 節）。
// Graph API：POST /{comment-id}/replies?message=... 對某留言公開回覆。
import type { MetaCallResult, MetaClient } from './client';

export interface ReplyResult {
  id: string; // 回覆留言的 id
}

export function replyToComment(
  client: MetaClient,
  commentId: string,
  message: string,
): Promise<MetaCallResult<ReplyResult>> {
  return client.post<ReplyResult>(`${commentId}/replies`, { message });
}
