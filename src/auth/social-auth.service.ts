import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
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

//----------------------------Types--------------------------------------
/**
 * Normalised payload produced after verifying a social identity token.
 * Fields mirror what both Google and Apple provide in their JWTs.
 */
export interface TSocialVerifiedPayload {
  providerId: string; // Google sub / Apple sub
  email?: string; // may be absent on Apple with private relay
  firstName?: string;
  lastName?: string;
  image?: string; // Google profile picture URL
}

/**
 * Provider-specific config passed into findOrLinkUserByProvider to drive
 * the upsert logic without duplicating it for each provider.
 */
interface TSocialProviderConfig {
  provider: AuthProvider.Google | AuthProvider.Apple;
  providerIdField: 'googleId' | 'appleId';
  fcmToken?: string;
}

//--------------------------Service---------------------------------------
@Injectable()
export class SocialAuthService {
  private readonly googleClient: OAuth2Client;
  private readonly appleJwksUrl = 'https://appleid.apple.com/auth/keys';

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('google.webClientId'),
    );
  }

  //-----------------Token verification----------------------------------
  /**
   * Verifies a Google ID token using google-auth-library.
   * Validates the audience against GOOGLE_WEB_CLIENT_ID.
   */
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
      // Re-throw Nest exceptions as-is; wrap library errors
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new UnauthorizedException('Google ID token verification failed');
    }
  }

  /**
   * Verifies an Apple identity token (JWT) against Apple's public JWKS.
   * Validates audience against APPLE_BUNDLE_ID.
   */
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

  /**
   * Finds or creates a user for a social sign-in provider.
   *
   * Logic (mirrors original Express.js reference):
   * 1. Look up by providerId field (googleId / appleId).
   * 2. If not found, check whether a local/other-provider user exists with the
   *    same email — if so, link the provider to that account.
   * 3. If still not found, create a brand-new user.
   * 4. Always update fcmTokens ($set / add) and return the user.
   */
  private async findOrLinkUserByProvider(
    payload: TSocialVerifiedPayload,
    config: TSocialProviderConfig,
  ) {
    const { provider, providerIdField, fcmToken } = config;

    try {
      // 1. Look up by provider-specific ID
      let user =
        providerIdField === 'googleId'
          ? await this.userService.findByGoogleId(payload.providerId)
          : await this.userService.findByAppleId(payload.providerId);

      // isActive gate — applies on ALL lookup paths, including returning users
      if (user && !user.isActive) {
        throw new UnauthorizedException('Account is inactive');
      }

      if (!user && payload.email) {
        // 2. Cross-provider account linking by verified email
        user = await this.userService.findByEmail(payload.email);
        if (user) {
          // isActive gate on email-linked account too
          if (!user.isActive) {
            throw new UnauthorizedException('Account is inactive');
          }
          // Link the social provider to the existing account
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
        // 3. Create a brand-new user
        // Fallback name generation when the provider supplies no name
        const fallbackName = payload.email
          ? payload.email.split('@')[0]
          : `User${Date.now()}`;

        const firstName = payload.firstName ?? fallbackName;
        const lastName = payload.lastName ?? '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ');

        user = await this.userService.createUser({
          fullName,
          email: payload.email,
          // Set the provider-specific ID field explicitly
          googleId:
            providerIdField === 'googleId' ? payload.providerId : undefined,
          appleId:
            providerIdField === 'appleId' ? payload.providerId : undefined,
          picture: payload.image,
          authProvider: provider,
          isVerified: true, // social sign-in users are pre-verified
          isActive: true,
          role: Role.User,
        });
      }

      // 4. Update fcmTokens if a new token was supplied
      if (fcmToken) {
        const currentTokens: string[] = (user as any).fcmTokens ?? [];
        if (!currentTokens.includes(fcmToken)) {
          await this.userService.updateUserById(String(user._id), {
            fcmTokens: [...currentTokens, fcmToken],
          });
        }
      }

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

  /** Handles the full Google Sign-In flow: verify token → find/create user → sign JWT. */
  async handleGoogleAuthPayload(dto: GoogleAuthDto) {
    try {
      const payload = await this.verifyGoogleIdToken(dto.idToken);

      const user = await this.findOrLinkUserByProvider(payload, {
        provider: AuthProvider.Google,
        providerIdField: 'googleId',
        fcmToken: dto.fcmToken,
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

  /** Handles the full Apple Sign-In flow: verify token → find/create user → sign JWT. */
  async handleAppleAuthPayload(dto: AppleAuthDto) {
    try {
      const payload = await this.verifyAppleIdentityToken(dto.identityToken);

      // Apple only sends fullName on the very first sign-in.
      // Parse "First Last" or "First" into firstName / lastName.
      if (dto.fullName && !payload.firstName) {
        const parts = dto.fullName.trim().split(/\s+/);
        payload.firstName = parts[0];
        payload.lastName = parts.slice(1).join(' ') || undefined;
      }

      const user = await this.findOrLinkUserByProvider(payload, {
        provider: AuthProvider.Apple,
        providerIdField: 'appleId',
        fcmToken: dto.fcmToken,
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
