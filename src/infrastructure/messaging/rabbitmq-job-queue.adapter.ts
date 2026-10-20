import { once } from 'node:events';
import { connect, type Channel, type Connection, type ConsumeMessage } from 'amqplib';
import type { JobQueue, JobQueueSubscription, QueueFailureDisposition } from '../../application/ports/job-queue.port';

export class RabbitMqJobQueueAdapter implements JobQueue {
  constructor(private readonly channel: Channel) {}

  async dispatch(messageQueue: string, message: Record<string, unknown>): Promise<void> {
    const serialized = JSON.stringify(message);
    if (serialized === undefined) {
      throw new TypeError('Queue messages must be JSON serializable');
    }

    if (!this.channel.sendToQueue(messageQueue, Buffer.from(serialized))) {
      await once(this.channel, 'drain');
    }
  }

  async consume(
    messageQueue: string,
    handler: (message: unknown) => Promise<void>,
    failureDisposition: QueueFailureDisposition,
  ): Promise<JobQueueSubscription> {
    const consumer = await this.channel.consume(messageQueue, (delivery) => {
      if (delivery) {
        void this.handleDelivery(delivery, handler, failureDisposition);
      }
    }, { noAck: false });

    return {
      cancel: async () => {
        await this.channel.cancel(consumer.consumerTag);
      },
    };
  }

  private async handleDelivery(
    delivery: ConsumeMessage,
    handler: (message: unknown) => Promise<void>,
    failureDisposition: QueueFailureDisposition,
  ): Promise<void> {
    try {
      await handler(JSON.parse(delivery.content.toString()));
      this.channel.ack(delivery);
    } catch {
      this.channel.nack(delivery, false, failureDisposition === 'requeue');
    }
  }
}

export interface RabbitMqChannelConnection {
  readonly channel: Channel;
  close(): Promise<void>;
}

export async function connectRabbitMq(url: string): Promise<RabbitMqChannelConnection> {
  const connection: Connection = await connect(url);

  try {
    const channel = await connection.createChannel();
    return {
      channel,
      close: async () => {
        try {
          await channel.close();
        } finally {
          await connection.close();
        }
      },
    };
  } catch (error) {
    await connection.close();
    throw error;
  }
}
