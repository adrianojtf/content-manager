import { DynamicModule, Module } from '@nestjs/common';
import { ListSocialPublications } from '../../../src/application/social/list-social-publications';
import { SocialPublicationsController } from '../../../src/presentation/http/social-publications.controller';

@Module({})
class SocialPublicationsE2eModule {}

export function createSocialPublicationsE2eModule(useCase: Pick<ListSocialPublications, 'execute'>): DynamicModule {
  return {
    module: SocialPublicationsE2eModule,
    controllers: [SocialPublicationsController],
    providers: [{ provide: ListSocialPublications, useValue: useCase }],
  };
}
