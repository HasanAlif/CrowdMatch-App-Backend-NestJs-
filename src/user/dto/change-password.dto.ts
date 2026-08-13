import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { Match } from '../../utils/match.decorator';

export class ChangePasswordDto {
  @IsNotEmpty()
  @IsString()
  oldPassword: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6, { message: 'New password must be at least 6 characters' })
  newPassword: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @Match('newPassword', { message: 'Passwords do not match' })
  confirmNewPassword: string;
}
