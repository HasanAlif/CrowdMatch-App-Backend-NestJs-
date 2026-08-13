import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { Match } from 'src/utils/match.decorator';

export class ResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  resetPasswordToken: string;

  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;

  @IsNotEmpty()
  @MinLength(6)
  @Match('newPassword')
  confirmNewPassword: string;
}
