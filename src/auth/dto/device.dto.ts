import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DevicePlatform } from '../../user/user.types';

export class DeviceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fcmToken?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  deviceId?: string;

  @IsOptional()
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
  deviceId?: string;
  platform?: DevicePlatform;
  deviceName?: string;
}

export function resolveDevice(device?: DeviceDto): ResolvedDevice | null {
  if (!device?.fcmToken) return null;
  return {
    fcmToken: device.fcmToken,
    deviceId: device.deviceId,
    platform: device.platform,
    deviceName: device.deviceName,
  };
}
