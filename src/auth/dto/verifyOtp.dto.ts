import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeviceDto } from './device.dto';

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

  // Optional device block for push notifications.
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}
