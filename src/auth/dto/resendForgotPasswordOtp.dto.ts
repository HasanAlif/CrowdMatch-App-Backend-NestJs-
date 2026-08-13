import { IsNotEmpty, IsString } from 'class-validator';

export class ResendForgotPasswordOtpDto {
  @IsNotEmpty()
  @IsString()
  token: string;
}
