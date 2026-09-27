import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DevicePlatform } from '../../user/user.types';

const blankToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class DeviceDto {
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @IsNotEmpty()
  fcmToken?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @IsNotEmpty()
  deviceId?: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsEnum(DevicePlatform, {
    message: 'platform must be one of: android, ios, web',
  })
  platform?: DevicePlatform;

  @IsOptional()
  @Transform(blankToUndefined)
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
