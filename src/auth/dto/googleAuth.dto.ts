import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

// DTO for Google Sign-In (POST /auth/google).
export class GoogleAuthDto {
  // Google ID token obtained from the native Google Sign-In SDK.
  @IsNotEmpty()
  @IsString()
  idToken: string;

  // Optional FCM device token for push notifications.
  @IsOptional()
  @IsString()
  fcmToken?: string;
}
