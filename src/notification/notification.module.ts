import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import {
  BroadcastHistory,
  BroadcastHistorySchema,
} from './schemas/broadcast-history.schema';
import { User, UserSchema } from '../user/schemas/user.schema';
import { Match, MatchSchema } from '../matching/schemas/match.schema';
import { Vote, VoteSchema } from '../matching/schemas/vote.schema';

import { FirebaseService } from './firebase.service';
import { NotificationService } from './notification.service';
import { NotificationReadService } from './notification-read.service';
import { NotificationTriggerService } from './notification-trigger.service';
import { NotificationController } from './notification.controller';
import { NotificationCron } from './notification.cron';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    ActivityLogModule,
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: BroadcastHistory.name, schema: BroadcastHistorySchema },
      { name: User.name, schema: UserSchema },
      { name: Match.name, schema: MatchSchema },
      { name: Vote.name, schema: VoteSchema },
    ]),
  ],
  controllers: [NotificationController],
  providers: [
    FirebaseService,
    NotificationService,
    NotificationReadService,
    NotificationTriggerService,
    NotificationCron,
  ],
  exports: [NotificationService, NotificationTriggerService],
})
export class NotificationModule {}
