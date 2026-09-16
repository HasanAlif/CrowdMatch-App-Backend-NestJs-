import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { UserService } from 'src/user/user.service';
import { AuthProvider, Role } from 'src/user/user.types';
import { User } from 'src/user/schemas/user.schema';
import { GoogleAuthDto } from 'src/auth/dto/googleAuth.dto';
import { AppleAuthDto } from 'src/auth/dto/appleAuth.dto';
import { resolveDevice, ResolvedDevice } from 'src/auth/dto/device.dto';
import { ActivityLogService } from 'src/activity-log/activity-log.service';
import { loginDenialMessage } from 'src/auth/auth-copy';

export interface TSocialVerifiedPayload {
  providerId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  image?: string;
}

interface TSocialProviderConfig {
  provider: AuthProvider.Google | AuthProvider.Apple;
  providerIdField: 'googleId' | 'appleId';
  device?: ResolvedDevice | null;
}

@Injectable()
export class SocialAuthService {
  private readonly googleClient: OAuth2Client;
  private readonly appleJwksUrl = 'https://appleid.apple.com/auth/keys';

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional()
    private readonly activityLog?: ActivityLogService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('google.webClientId'),
    );
  }

  async verifyGoogleIdToken(idToken: string): Promise<TSocialVerifiedPayload> {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.configService.get<string>('google.webClientId'),
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.sub) {
        throw new UnauthorizedException('Invalid Google ID token payload');
      }

      return {
        providerId: payload.sub,
        email: payload.email,
        firstName: payload.given_name,
        lastName: payload.family_name,
        image: payload.picture,
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new UnauthorizedException('Google ID token verification failed');
    }
  }

  async verifyAppleIdentityToken(
    identityToken: string,
  ): Promise<TSocialVerifiedPayload> {
    try {
      const JWKS = createRemoteJWKSet(new URL(this.appleJwksUrl));
      const bundleId = this.configService.get<string>('apple.bundleId') ?? '';

      const { payload } = await jwtVerify(identityToken, JWKS, {
        issuer: 'https://appleid.apple.com',
        audience: bundleId,
      });

      if (!payload.sub) {
        throw new UnauthorizedException('Invalid Apple identity token payload');
      }

      return {
        providerId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new UnauthorizedException(
        'Apple identity token verification failed',
      );
    }
  }

  private async findOrLinkUserByProvider(
    payload: TSocialVerifiedPayload,
    config: TSocialProviderConfig,
  ) {
    const { provider, providerIdField, device } = config;

    try {
      let user =
        providerIdField === 'googleId'
          ? await this.userService.findByGoogleId(payload.providerId)
          : await this.userService.findByAppleId(payload.providerId);

      if (user) {
        const denial = loginDenialMessage(user.accountStatus, user.isActive);
        if (denial) {
          throw new UnauthorizedException(denial);
        }
      }

      if (!user && payload.email) {
        user = await this.userService.findByEmail(payload.email);
        if (user) {
          const denial = loginDenialMessage(user.accountStatus, user.isActive);
          if (denial) {
            throw new UnauthorizedException(denial);
          }
          const linkData: Partial<User> = {
            authProvider: provider,
            googleId:
              providerIdField === 'googleId' ? payload.providerId : undefined,
            appleId:
              providerIdField === 'appleId' ? payload.providerId : undefined,
          };
          if (payload.image && !user.picture) {
            linkData.picture = payload.image;
          }
          user = await this.userService.updateUserById(
            String(user._id),
            linkData,
          );
        }
      }

      if (!user) {
        const fallbackName = payload.email
          ? payload.email.split('@')[0]
          : `User${Date.now()}`;

        const firstName = payload.firstName ?? fallbackName;
        const lastName = payload.lastName ?? '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ');

        user = await this.userService.createUser({
          fullName,
          email: payload.email,
          googleId:
            providerIdField === 'googleId' ? payload.providerId : undefined,
          appleId:
            providerIdField === 'appleId' ? payload.providerId : undefined,
          picture: payload.image,
          authProvider: provider,
          isVerified: true,
          isActive: true,
          role: Role.User,
        });

        try {
          this.activityLog?.recordUserJoined(user.fullName, String(user._id));
        } catch {
          // already logged inside the activity-log service
        }
      }

      await this.userService.captureDeviceSafely(
        String(user._id),
        device ?? null,
      );

      return user;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      const err = error as Error;
      throw new InternalServerErrorException({
        success: false,
        message: 'Failed to process social sign-in',
        error: err.message,
      });
    }
  }

  async handleGoogleAuthPayload(dto: GoogleAuthDto) {
    try {
      const payload = await this.verifyGoogleIdToken(dto.idToken);

      const user = await this.findOrLinkUserByProvider(payload, {
        provider: AuthProvider.Google,
        providerIdField: 'googleId',
        device: resolveDevice(dto.device),
      });

      const jwtPayload = { sub: user._id, role: user.role };
      const accessToken = await this.jwtService.signAsync(jwtPayload);

      return {
        success: true,
        message: 'Google sign-in successful',
        data: {
          accessToken,
          user: {
            id: String(user._id),
            fullName: user.fullName,
            email: user.email,
            phoneNumber: user.phoneNumber,
            role: user.role,
          },
        },
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      const err = error as Error;
      throw new InternalServerErrorException({
        success: false,
        message: 'Google sign-in failed',
        error: err.message,
      });
    }
  }

  async handleAppleAuthPayload(dto: AppleAuthDto) {
    try {
      const payload = await this.verifyAppleIdentityToken(dto.identityToken);

      if (dto.fullName && !payload.firstName) {
        const parts = dto.fullName.trim().split(/\s+/);
        payload.firstName = parts[0];
        payload.lastName = parts.slice(1).join(' ') || undefined;
      }

      const user = await this.findOrLinkUserByProvider(payload, {
        provider: AuthProvider.Apple,
        providerIdField: 'appleId',
        device: resolveDevice(dto.device),
      });

      const jwtPayload = { sub: user._id, role: user.role };
      const accessToken = await this.jwtService.signAsync(jwtPayload);

      return {
        success: true,
        message: 'Apple sign-in successful',
        data: {
          accessToken,
          user: {
            id: String(user._id),
            fullName: user.fullName,
            email: user.email,
            phoneNumber: user.phoneNumber,
            role: user.role,
          },
        },
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      const err = error as Error;
      throw new InternalServerErrorException({
        success: false,
        message: 'Apple sign-in failed',
        error: err.message,
      });
    }
  }
}
