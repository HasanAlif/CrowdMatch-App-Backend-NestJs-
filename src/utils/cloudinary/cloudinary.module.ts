import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CloudinaryConfigService } from './cloudinary.config';
import { CloudinaryService } from './cloudinary.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [CloudinaryConfigService, CloudinaryService],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}
