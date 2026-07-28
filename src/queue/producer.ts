// Queue Producer（spec.md 第 12.1 節）。Queue Message 只帶識別碼，不含任何機密。

export interface CommentEventMessage {
  webhookEventId: string;
  eventKey: string;
  instagramAccountId: string;
  instagramMediaId: string;
  instagramCommentId: string;
}

export async function enqueueCommentEvent(
  queue: Queue<CommentEventMessage>,
  message: CommentEventMessage,
): Promise<void> {
  await queue.send(message);
}
