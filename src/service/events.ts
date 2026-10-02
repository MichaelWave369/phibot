import { randomUUID } from "node:crypto";
import type {
  PhiBotServiceEvent,
  PhiBotServiceEventType,
} from "./types.js";

export type ServiceEventListener = (event: PhiBotServiceEvent) => void;

export class ServiceEventBus {
  private readonly events: PhiBotServiceEvent[] = [];
  private readonly listeners = new Set<ServiceEventListener>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxHistory = 500,
  ) {
    if (!Number.isInteger(maxHistory) || maxHistory < 1) {
      throw new Error("Service event history limit must be a positive integer.");
    }
  }

  publish(
    type: PhiBotServiceEventType,
    fields: Omit<PhiBotServiceEvent, "schema" | "eventId" | "type" | "timestamp"> = {},
  ): PhiBotServiceEvent {
    const event: PhiBotServiceEvent = {
      schema: "phibot.service.event.v1",
      eventId: randomUUID(),
      type,
      timestamp: new Date(this.now()).toISOString(),
      ...fields,
    };

    this.events.push(event);
    while (this.events.length > this.maxHistory) this.events.shift();

    for (const listener of this.listeners) {
      listener(structuredClone(event));
    }

    return structuredClone(event);
  }

  subscribe(listener: ServiceEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  history(limit = this.maxHistory): PhiBotServiceEvent[] {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Service event history limit must be a positive integer.");
    }
    return this.events.slice(-limit).map((event) => structuredClone(event));
  }
}
