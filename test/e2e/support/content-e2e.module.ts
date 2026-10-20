import { Body, Controller, DynamicModule, Inject, Injectable, Module, Post } from '@nestjs/common';
import type { MediaStorage } from '../../../src/application/ports/media-storage.port';
import { AppModule } from '../../../src/presentation/http/app.module';

const MEDIA_STORAGE = Symbol('E2E_MEDIA_STORAGE');
const CONTENT_REPOSITORY = Symbol('E2E_CONTENT_REPOSITORY');
const E2E_TENANT_ID = '10000000-0000-4000-8000-000000000001';

interface ContentE2eRequest {
  readonly id: string;
  readonly title: string;
  readonly mediaKey: string;
}

interface ContentE2eRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly mediaReference: string;
}

interface ContentE2eRepository {
  save(tenantId: string, content: ContentE2eRecord): Promise<void>;
}

@Injectable()
class ContentE2eJourney {
  constructor(
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(CONTENT_REPOSITORY) private readonly repository: ContentE2eRepository,
  ) {}

  async create(input: ContentE2eRequest): Promise<ContentE2eRecord> {
    const media = await this.storage.store({
      key: input.mediaKey,
      body: Buffer.from('deterministic-media'),
      contentType: 'video/mp4',
    });
    const content = { id: input.id, tenantId: E2E_TENANT_ID, title: input.title, mediaReference: media.key };
    await this.repository.save(E2E_TENANT_ID, content);
    return content;
  }
}

@Controller('_test/content')
class ContentE2eController {
  constructor(private readonly journey: ContentE2eJourney) {}

  @Post()
  create(@Body() input: ContentE2eRequest): Promise<ContentE2eRecord> {
    return this.journey.create(input);
  }
}

@Module({})
class ContentE2eModule {}

export function createContentE2eModule(storage: MediaStorage, repository: ContentE2eRepository): DynamicModule {
  return {
    module: ContentE2eModule,
    imports: [AppModule],
    controllers: [ContentE2eController],
    providers: [
      ContentE2eJourney,
      { provide: MEDIA_STORAGE, useValue: storage },
      { provide: CONTENT_REPOSITORY, useValue: repository },
    ],
  };
}
