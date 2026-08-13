import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from 'src/auth/auth.module';
import { WebsiteContentController } from './website-content.controller';
import { WebsiteContentService } from './website-content.service';
import {
  WebsiteContent,
  WebsiteContentSchema,
} from './schemas/website-content.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WebsiteContent.name, schema: WebsiteContentSchema },
    ]),
    AuthModule, // provides JwtService (AuthGuard) and Reflector (RolesGuard)
  ],
  controllers: [WebsiteContentController],
  providers: [WebsiteContentService],
})
export class WebsiteContentModule {}
