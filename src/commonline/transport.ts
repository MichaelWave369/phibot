import type { CommonLineEnvelope } from "./types.js";

export interface CommonLineTransport {
  publish(message: CommonLineEnvelope): Promise<void>;
  get(messageId: string): Promise<CommonLineEnvelope | undefined>;
  listThread(threadId: string): Promise<CommonLineEnvelope[]>;
  listForBot(botId: string): Promise<CommonLineEnvelope[]>;
}

function compareMessages(
  a: CommonLineEnvelope,
  b: CommonLineEnvelope,
): number {
  if (a.replyTo === b.messageId) return 1;
  if (b.replyTo === a.messageId) return -1;
  if (a.handoffFrom === b.messageId) return 1;
  if (b.handoffFrom === a.messageId) return -1;

  return (
    Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
    a.messageId.localeCompare(b.messageId)
  );
}

export class MemoryCommonLineTransport implements CommonLineTransport {
  private readonly messages = new Map<string, CommonLineEnvelope>();

  async publish(message: CommonLineEnvelope): Promise<void> {
    if (this.messages.has(message.messageId)) {
      throw new Error(`Message already exists: ${message.messageId}`);
    }
    this.messages.set(message.messageId, structuredClone(message));
  }

  async get(messageId: string): Promise<CommonLineEnvelope | undefined> {
    const message = this.messages.get(messageId);
    return message ? structuredClone(message) : undefined;
  }

  async listThread(threadId: string): Promise<CommonLineEnvelope[]> {
    return [...this.messages.values()]
      .filter((message) => message.threadId === threadId)
      .sort(compareMessages)
      .map((message) => structuredClone(message));
  }

  async listForBot(botId: string): Promise<CommonLineEnvelope[]> {
    return [...this.messages.values()]
      .filter((message) =>
        message.recipients.some(
          (recipient) => recipient.kind === "bot" && recipient.id === botId,
        ),
      )
      .sort(compareMessages)
      .map((message) => structuredClone(message));
  }
}

export { compareMessages };
