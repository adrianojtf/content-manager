export type QueueFailureDisposition = 'requeue' | 'reject';

export interface JobQueueSubscription {
  cancel(): Promise<void>;
}

export interface JobQueue {
  dispatch(messageQueue: string, message: Record<string, unknown>): Promise<void>;
  consume(
    messageQueue: string,
    handler: (message: unknown) => Promise<void>,
    failureDisposition: QueueFailureDisposition,
  ): Promise<JobQueueSubscription>;
}
