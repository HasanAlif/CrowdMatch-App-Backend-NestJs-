import {
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeviceDto } from './device.dto';

// DTO for Google Sign-In (POST /auth/google).
export class GoogleAuthDto {
  // Google ID token obtained from the native Google Sign-In SDK.
  @IsNotEmpty()
  @IsString()
  idToken: string;

  // Optional device block for push notifications.
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}
