import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';

export class VerifyOtpDto {
  @ValidateIf((o) => !o.phone || o.email !== undefined)
  @IsNotEmpty()
  @IsEmail()
  email?: string;

  @ValidateIf((o) => !o.email || o.phone !== undefined)
  @IsNotEmpty()
  @IsString()
  phone?: string;

  @IsNotEmpty()
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otp: string;
}
