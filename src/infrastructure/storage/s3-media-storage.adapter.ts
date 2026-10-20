import { PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { MediaReference, MediaStorage, MediaStorageInput } from '../../application/ports/media-storage.port';

export class S3MediaStorageAdapter implements MediaStorage {
  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    private readonly bucket: string,
  ) {}

  async store(input: MediaStorageInput): Promise<MediaReference> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      Body: input.body instanceof Uint8Array ? input.body : Readable.from(input.body),
      ContentType: input.contentType,
    }));

    return { key: input.key };
  }
}

export function createS3Client(config: Pick<S3ClientConfig, 'region' | 'endpoint'>): S3Client {
  return new S3Client({
    ...config,
    forcePathStyle: Boolean(config.endpoint),
  });
}
