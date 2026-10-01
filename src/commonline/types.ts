import type { MemoryEscalationPacket } from "../memory/types.js";

export type CommonLineMessageKind =
  | "message"
  | "reply"
  | "handoff"
  | "coordinator";

export interface CommonLineSender {
  kind: "bot";
  botId: string;
  botVersion: string;
  role: string;
}

export type CommonLineAddress =
  | { kind: "bot"; id: string }
  | { kind: "group"; id: string }
  | { kind: "coordinator"; id: "vessie" };

export interface CommonLinePayload {
  text: string;
  data?: unknown;
  memoryPacket?: MemoryEscalationPacket;
}

export interface CommonLineEnvelope {
  schema: "phibot.commonline.message.v1";
  messageId: string;
  threadId: string;
  kind: CommonLineMessageKind;
  sender: CommonLineSender;
  recipients: CommonLineAddress[];
  createdAt: string;
  replyTo?: string;
  handoffFrom?: string;
  payload: CommonLinePayload;
}

export interface CommonLineGroup {
  schema: "phibot.commonline.group.v1";
  groupId: string;
  name: string;
  ownerBotId: string;
  members: string[];
  createdAt: string;
  expiresAt: string;
}

export interface CreateGroupInput {
  name: string;
  members: string[];
  ttlMs?: number;
}

export interface CommonLineSendInput {
  to: string;
  text: string;
  data?: unknown;
  threadId?: string;
}

export interface CommonLineHandoffInput {
  to: string;
  text: string;
  memoryPacket?: MemoryEscalationPacket;
  data?: unknown;
  threadId?: string;
  handoffFrom?: string;
}

export interface CommonLineGroupSendInput {
  groupId: string;
  text: string;
  data?: unknown;
  threadId?: string;
}

export interface CommonLineCoordinatorInput {
  text: string;
  data?: unknown;
  memoryPacket?: MemoryEscalationPacket;
  threadId?: string;
}
