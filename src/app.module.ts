import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { AdminModule } from './admin/admin.module';
import { CloudinaryModule } from './utils/cloudinary/cloudinary.module';
import { WebsiteContentModule } from './website-content/website-content.module';
import configuration from './config/configuration';
import { MessageModule } from './message/message.module';
import { MatchingModule } from './matching/matching.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
    }),

    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60000,
        limit: 100,
      },
    ]),

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('databaseUrl'),
        maxPoolSize: 20,
        minPoolSize: 5,
        socketTimeoutMS: 45_000,
        serverSelectionTimeoutMS: 10_000,
      }),
    }),

    AuthModule,
    UserModule,
    AdminModule,
    CloudinaryModule,
    WebsiteContentModule,
    MessageModule,
    MatchingModule,
    EventEmitterModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
