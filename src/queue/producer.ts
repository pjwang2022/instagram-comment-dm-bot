// Queue Producer（spec.md 第 12.1 節）。Queue Message 只帶識別碼，不含任何機密。

export interface CommentEventMessage {
  webhookEventId: string;
  eventKey: string;
  instagramAccountId: string;
  instagramMediaId: string;
  instagramCommentId: string;
  // 'story_reply'＝限時動態回應（mid 存於 instagramCommentId、story id 存於 instagramMediaId）。
  // 省略或 'comments'＝留言事件（向後相容既有佇列中的訊息）。
  eventType?: 'comments' | 'story_reply';
}

export async function enqueueCommentEvent(
  queue: Queue<CommentEventMessage>,
  message: CommentEventMessage,
): Promise<void> {
  await queue.send(message);
}
