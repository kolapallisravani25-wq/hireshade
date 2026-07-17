import type { JobQueue, QueueMessage } from "./types";

export class MemoryQueue implements JobQueue {
  readonly messages: QueueMessage[] = [];
  async publish<T>(message: QueueMessage<T>): Promise<void> {
    this.messages.push(message as QueueMessage);
  }
}
