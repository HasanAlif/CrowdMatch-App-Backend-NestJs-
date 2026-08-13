import { Body, Controller, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SocialAuthService } from './social-auth.service';
import { RegisterWithEmailDto } from './dto/registerUser.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verifyOtp.dto';
import { ResendOtpDto } from './dto/resendOtp.dto';
import { ForgotPasswordDto } from './dto/forgotPassword.dto';
import { ResendForgotPasswordOtpDto } from './dto/resendForgotPasswordOtp.dto';
import { VerifyForgotPasswordOtpDto } from './dto/verifyForgotPasswordOtp.dto';
import { ResetPasswordDto } from './dto/resetPassword.dto';
import { GoogleAuthDto } from './dto/googleAuth.dto';
import { AppleAuthDto } from './dto/appleAuth.dto';
import { RegisterWithPhoneDto } from './dto/registerPhone.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly socialAuthService: SocialAuthService,
  ) {}

  //--------------- Registration----------------------
  // POST /auth/register — create user with email, send OTP, no JWT yet
  @Post('register')
  @Throttle({ global: { ttl: 60000, limit: 10 } })
  registerWithEmail(@Body() dto: RegisterWithEmailDto) {
    return this.authService.registerWithEmail(dto);
  }

  // POST /auth/register/phone — create user with phone, send OTP via SMS, no JWT yet
  @Post('register/phone')
  @Throttle({ global: { ttl: 60000, limit: 10 } })
  registerWithPhoneNumber(@Body() dto: RegisterWithPhoneDto) {
    return this.authService.registerWithPhoneNumber(dto);
  }

  //--------------- OTP flows---------------------------
  // POST /auth/verify-otp — verify OTP (email or phone), issue JWT on success
  @Post('verify-otp')
  @Throttle({ global: { ttl: 60000, limit: 5 } })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await this.authService.verifyOtp(dto);
    if (result.success && result.data?.accessToken) {
      res.cookie('accessToken', result.data.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
    return result;
  }

  // POST /auth/resend-otp — regenerate + resend OTP (email or SMS)
  @Post('resend-otp')
  @Throttle({ global: { ttl: 60000, limit: 5 } })
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  //----------------------------Login-----------------------
  // POST /auth/login — email + password login (requires isVerified + isActive)
  @Post('login')
  @Throttle({ global: { ttl: 60000, limit: 10 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: any) {
    const result = await this.authService.login(dto);
    if (result.success && result.data?.accessToken) {
      res.cookie('accessToken', result.data.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
    return result;
  }

  // POST /auth/logout — clear the auth cookie
  @Post('logout')
  logout(@Res({ passthrough: true }) res: any) {
    res.clearCookie('accessToken');
    return { success: true, message: 'Logged out successfully' };
  }

  //----------------------------Social sign-in-------------------------
  // POST /auth/google — verify Google ID token, find/create user, issue JWT
  @Post('google')
  @Throttle({ global: { ttl: 60000, limit: 20 } })
  googleSignIn(@Body() dto: GoogleAuthDto) {
    return this.socialAuthService.handleGoogleAuthPayload(dto);
  }

  // POST /auth/apple — verify Apple identity token, find/create user, issue JWT
  @Post('apple')
  @Throttle({ global: { ttl: 60000, limit: 20 } })
  appleSignIn(@Body() dto: AppleAuthDto) {
    return this.socialAuthService.handleAppleAuthPayload(dto);
  }

  //----------------------------Forgot-password flow-----------------------

  // POST /auth/forgot-password — send OTP to email, return session token
  @Post('forgot-password')
  @Throttle({ global: { ttl: 60000, limit: 5 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const result = await this.authService.forgotPassword(dto);
    return {
      success: true,
      message: 'OTP sent to your email',
      data: { token: result.token },
    };
  }

  // POST /auth/resend-forgot-password-otp — resend a fresh OTP using the session token
  @Post('resend-forgot-password-otp')
  @Throttle({ global: { ttl: 60000, limit: 5 } })
  async resendForgotPasswordOtp(@Body() dto: ResendForgotPasswordOtpDto) {
    await this.authService.resendForgotPasswordOtp(dto);
    return {
      success: true,
      message: 'OTP resent to your email',
      data: null,
    };
  }

  // POST /auth/verify-forgot-password-otp — verify OTP, return reset-password token
  @Post('verify-forgot-password-otp')
  @Throttle({ global: { ttl: 60000, limit: 5 } })
  async verifyForgotPasswordOtp(@Body() dto: VerifyForgotPasswordOtpDto) {
    const result = await this.authService.verifyForgotPasswordOtp(dto);
    return {
      success: true,
      message: 'OTP verified successfully',
      data: { resetPasswordToken: result.resetPasswordToken },
    };
  }

  // POST /auth/reset-password — set new password using reset-password token
  @Post('reset-password')
  @Throttle({ global: { ttl: 60000, limit: 5 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return {
      success: true,
      message: 'Password reset successful',
      data: null,
    };
  }
}
