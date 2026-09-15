import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';

import { Match, MatchSchema } from './schemas/match.schema';
import { Vote, VoteSchema } from './schemas/vote.schema';
import {
  MatchCycleCheckpoint,
  MatchCycleCheckpointSchema,
} from './schemas/match-cycle-checkpoint.schema';
import { MatchedPair, MatchedPairSchema } from './schemas/matched-pair.schema';
import { User, UserSchema } from '../user/schemas/user.schema';

import { MatchingService } from './matching.service';
import { MatchingCron } from './matching.cron';
import { MatchingController } from './matching.controller';
import { NotificationModule } from '../notification/notification.module';
import { UserModule } from '../user/user.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    NotificationModule,
    UserModule,
    ActivityLogModule,

    MongooseModule.forFeature([
      { name: Match.name, schema: MatchSchema },
      { name: Vote.name, schema: VoteSchema },
      { name: MatchCycleCheckpoint.name, schema: MatchCycleCheckpointSchema },
      { name: MatchedPair.name, schema: MatchedPairSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [MatchingController],
  providers: [MatchingService, MatchingCron],
  exports: [MatchingService],
})
export class MatchingModule {}
