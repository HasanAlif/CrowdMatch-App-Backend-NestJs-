import { IsBoolean, IsOptional } from 'class-validator';

// PATCH /user/notification-preferences
export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  isNotifyNewMatches?: boolean;

  @IsOptional()
  @IsBoolean()
  isNotifyActivityReminders?: boolean;
}
