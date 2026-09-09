import { IsOptional, IsString } from 'class-validator';

/**
 * POST /auth/logout
 *
 * deviceId is optional. Supplied, it removes exactly that device's push
 * registration; omitted, the cookie is cleared and the device list is left
 * untouched — matching the endpoint's previous behaviour.
 */
export class LogoutDto {
  @IsOptional()
  @IsString()
  deviceId?: string;
}
