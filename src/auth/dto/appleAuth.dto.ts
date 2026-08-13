import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

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

  // Optional FCM device token for push notifications.
  @IsOptional()
  @IsString()
  fcmToken?: string;
}
