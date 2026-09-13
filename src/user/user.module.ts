import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { CounterSchema, COUNTER_MODEL_NAME } from './schemas/counter.schema';
import {
  Notification,
  NotificationSchema,
} from '../notification/schemas/notification.schema';
import { Match, MatchSchema } from '../matching/schemas/match.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: COUNTER_MODEL_NAME, schema: CounterSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: Match.name, schema: MatchSchema },
    ]),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService, MongooseModule],
})
export class UserModule {}
