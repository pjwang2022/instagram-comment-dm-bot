// Private Reply DM（spec.md 第 10 節）。
// Graph API：POST /{ig-account-id}/messages，message 帶文字與一個外部連結按鈕（button template）。
// - 留言：recipient.comment_id 指定要私訊的留言。
// - 限動回應：回應已開啟 24 小時訊息窗，recipient.id 直接指定回應者 IGSID。
import type { MetaCallResult, MetaClient } from './client';

export interface PrivateReplyInput {
  instagramAccountId: string;
  commentId?: string;
  recipientId?: string;
  text: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
}

export interface PrivateReplyResult {
  recipient_id?: string;
  message_id?: string;
}

export function sendPrivateReply(
  client: MetaClient,
  input: PrivateReplyInput,
): Promise<MetaCallResult<PrivateReplyResult>> {
  const recipient = JSON.stringify(
    input.recipientId ? { id: input.recipientId } : { comment_id: input.commentId },
  );

  // 有按鈕文字與網址 → 用 button template；否則純文字訊息。
  let message: string;
  if (input.buttonText && input.buttonUrl) {
    message = JSON.stringify({
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: input.text,
          buttons: [{ type: 'web_url', url: input.buttonUrl, title: input.buttonText }],
        },
      },
    });
  } else {
    message = JSON.stringify({ text: input.text });
  }

  return client.post<PrivateReplyResult>(`${input.instagramAccountId}/messages`, {
    recipient,
    message,
  });
}
