import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { DevicePlatform } from '../../user/user.types';

export class DeviceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fcmToken?: string;

  @ValidateIf((o: DeviceDto) => o.fcmToken !== undefined)
  @IsNotEmpty({ message: 'deviceId is required when fcmToken is provided' })
  @IsString()
  deviceId?: string;

  @ValidateIf((o: DeviceDto) => o.fcmToken !== undefined)
  @IsNotEmpty({ message: 'platform is required when fcmToken is provided' })
  @IsEnum(DevicePlatform, {
    message: 'platform must be one of: android, ios, web',
  })
  platform?: DevicePlatform;

  @IsOptional()
  @IsString()
  deviceName?: string;
}

export interface ResolvedDevice {
  fcmToken: string;
  deviceId: string;
  platform: DevicePlatform;
  deviceName?: string;
}

export function resolveDevice(device?: DeviceDto): ResolvedDevice | null {
  if (!device?.fcmToken || !device.deviceId || !device.platform) return null;
  return {
    fcmToken: device.fcmToken,
    deviceId: device.deviceId,
    platform: device.platform,
    deviceName: device.deviceName,
  };
}
