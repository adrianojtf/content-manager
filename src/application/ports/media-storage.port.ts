export interface MediaStorageInput {
  readonly key: string;
  readonly body: AsyncIterable<Uint8Array> | Uint8Array;
  readonly contentType?: string;
}

export interface MediaReference {
  readonly key: string;
}

export interface MediaStorage {
  store(input: MediaStorageInput): Promise<MediaReference>;
}
