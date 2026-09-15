import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ActivityLogService } from './activity-log.service';
import { ActivityLog, ActivityLogSchema } from './schemas/activity-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ActivityLog.name, schema: ActivityLogSchema },
    ]),
  ],
  providers: [ActivityLogService],
  exports: [ActivityLogService, MongooseModule],
})
export class ActivityLogModule {}
