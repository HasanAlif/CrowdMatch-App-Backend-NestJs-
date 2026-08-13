import { IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyForgotPasswordOtpDto {
  @IsNotEmpty()
  @IsString()
  token: string;

  @IsNotEmpty()
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otp: string;
}
