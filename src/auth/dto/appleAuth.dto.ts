import {
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeviceDto } from './device.dto';

// DTO for Apple Sign-In (POST /auth/apple).
export class AppleAuthDto {
  // Apple identity token (JWT) from Sign in with Apple.
  @IsNotEmpty()
  @IsString()
  identityToken: string;

  // User's display name — Apple only provides this on the *first* sign-in.
  // Shape: "First Last" or just "First".
  @IsOptional()
  @IsString()
  fullName?: string;

  // Optional device block for push notifications. Replaces the former flat
  // `fcmToken` field — see GoogleAuthDto.
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}
