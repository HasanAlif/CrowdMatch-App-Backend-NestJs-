import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';

export const USER_STATUS_ACTIONS = ['block', 'unblock'] as const;
export type UserStatusAction = (typeof USER_STATUS_ACTIONS)[number];

export class UpdateUserStatusDto {
  @Transform(({ value }) =>
    String(value ?? '')
      .trim()
      .toLowerCase(),
  )
  @IsIn(USER_STATUS_ACTIONS, {
    message: `status must be one of: ${USER_STATUS_ACTIONS.join(', ')}`,
  })
  status: UserStatusAction;
}
