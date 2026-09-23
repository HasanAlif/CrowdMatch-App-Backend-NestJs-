import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminUserService } from './admin-user.service';
import { AdminVotingService } from './admin-voting.service';
import { AdminMatchService } from './admin-match.service';
import { UserModule } from 'src/user/user.module';
import { AuthModule } from 'src/auth/auth.module';
import { NotificationModule } from 'src/notification/notification.module';
import { ActivityLogModule } from 'src/activity-log/activity-log.module';
import { Vote, VoteSchema } from 'src/matching/schemas/vote.schema';
import { Report, ReportSchema } from 'src/message/schemas/report.schema';

@Module({
  imports: [
    UserModule,
    AuthModule,
    NotificationModule,
    ActivityLogModule,

    MongooseModule.forFeature([
      { name: Vote.name, schema: VoteSchema },
      { name: Report.name, schema: ReportSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminDashboardService,
    AdminUserService,
    AdminVotingService,
    AdminMatchService,
  ],
})
export class AdminModule {}
