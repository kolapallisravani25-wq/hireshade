export type JobType = "discover-jobs" | "verify-vacancy" | "tailor-resume" | "submit-application" | "classify-email";

export type QueueMessage<T = unknown> = {
  id: string;
  type: JobType;
  candidateId: string;
  createdAt: string;
  payload: T;
  attempt: number;
};

export interface JobQueue {
  publish<T>(message: QueueMessage<T>): Promise<void>;
}
