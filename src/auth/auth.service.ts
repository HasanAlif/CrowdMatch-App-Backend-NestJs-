import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { UserService } from '../user/user.service';
import { OtpService } from './otp.service';
import { MailService } from './mail.service';
import { SmsService } from './sms.service';

import { RegisterWithEmailDto } from './dto/registerUser.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verifyOtp.dto';
import { ResendOtpDto } from './dto/resendOtp.dto';
import { ForgotPasswordDto } from './dto/forgotPassword.dto';
import { ResendForgotPasswordOtpDto } from './dto/resendForgotPasswordOtp.dto';
import { VerifyForgotPasswordOtpDto } from './dto/verifyForgotPasswordOtp.dto';
import { ResetPasswordDto } from './dto/resetPassword.dto';
import { RegisterWithPhoneDto } from './dto/registerPhone.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly smsService: SmsService,
    private readonly configService: ConfigService,
  ) {}

  async registerWithEmail(dto: RegisterWithEmailDto) {
    try {
      const existing = await this.userService.findByEmail(dto.email);
      if (existing) {
        if (existing.isVerified) {
          throw new ConflictException('Email is already registered');
        }
      }

      const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);

      const otp = this.otpService.generateOtp();
      const hashedOtp = await this.otpService.hashOtp(otp);
      const otpExpiry = this.otpService.getExpiryDate();

      if (existing) {
        await this.userService.updateUserById(String(existing._id), {
          fullName: dto.fullName,
          password: hashedPassword,
          otp: hashedOtp,
          otpExpiry,
        });
      } else {
        await this.userService.createUser({
          fullName: dto.fullName,
          email: dto.email,
          password: hashedPassword,
          otp: hashedOtp,
          otpExpiry,
          isVerified: false,
          isActive: true,
        });
      }

      await this.mailService.sendOtpEmail(dto.email, otp);

      return {
        success: true,
        message: 'Please check your email for OTP verification',
        data: { email: dto.email },
      };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      const err = error as Error;
      throw new InternalServerErrorException({
        success: false,
        message: 'Registration failed',
        error: err.message,
      });
    }
  }

  async registerWithPhoneNumber(dto: RegisterWithPhoneDto) {
    try {
      const existing = await this.userService.findByPhone(dto.phone);
      if (existing) {
        throw new ConflictException('Phone number is already registered');
      }

      const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);

      const otp = this.otpService.generateOtp();
      const hashedOtp = await this.otpService.hashOtp(otp);
      const otpExpiry = this.otpService.getExpiryDate();

      await this.userService.createUser({
        fullName: dto.fullName,
        phoneNumber: dto.phone,
        password: hashedPassword,
        otp: hashedOtp,
        otpExpiry,
        isVerified: false,
        isActive: true,
      });

      await this.smsService.sendOtpSms(dto.phone, otp);

      return {
        success: true,
        message: 'OTP sent to your phone number',
        data: { phone: dto.phone },
      };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      const err = error as Error;
      throw new InternalServerErrorException({
        success: false,
        message: 'Phone registration failed',
        error: err.message,
      });
    }
  }

  async verifyOtp(dto: VerifyOtpDto) {
    try {
      if (dto.email && dto.phone) {
        throw new BadRequestException(
          'Provide either email or phone, not both',
        );
      }

      let user;
      if (dto.email) {
        user = await this.userService.findByEmail(dto.email);
      } else if (dto.phone) {
        user = await this.userService.findByPhone(dto.phone);
      }

      if (!user) {
        throw new BadRequestException(
          'No account found with this email or phone',
        );
      }

      if (user.isVerified) {
        throw new BadRequestException('Account is already verified');
      }

      if (!user.otp || !user.otpExpiry) {
        throw new BadRequestException(
          'No OTP found. Please request a new one via /auth/resend-otp',
        );
      }

      if (new Date() > user.otpExpiry) {
        throw new BadRequestException(
          'OTP has expired. Please request a new one via /auth/resend-otp',
        );
      }

      const isMatch = await this.otpService.compareOtp(dto.otp, user.otp);
      if (!isMatch) {
        throw new BadRequestException('Invalid OTP');
      }
      const updatedUser = await this.userService.updateUserById(
        String(user._id),
        { isVerified: true },
        ['otp', 'otpExpiry'],
      );

      const payload = { sub: updatedUser!._id, role: updatedUser!.role };
      const accessToken = await this.jwtService.signAsync(payload);

      return {
        success: true,
        message: 'OTP verified successfully',
        data: {
          accessToken,
          user: {
            id: updatedUser!._id,
            fullName: updatedUser!.fullName,
            email: updatedUser!.email,
            role: updatedUser!.role,
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
        message: 'OTP verification failed',
        error: err.message,
      });
    }
  }

  async resendOtp(dto: ResendOtpDto) {
    try {
      if (dto.email && dto.phone) {
        throw new BadRequestException(
          'Provide either email or phone, not both',
        );
      }

      let user;
      if (dto.email) {
        user = await this.userService.findByEmail(dto.email);
      } else if (dto.phone) {
        user = await this.userService.findByPhone(dto.phone);
      }

      if (!user) {
        throw new BadRequestException(
          'No account found with this email or phone',
        );
      }

      if (user.isVerified) {
        throw new BadRequestException('Account is already verified');
      }

      const otp = this.otpService.generateOtp();
      const hashedOtp = await this.otpService.hashOtp(otp);
      const otpExpiry = this.otpService.getExpiryDate();

      await this.userService.updateUserById(String(user._id), {
        otp: hashedOtp,
        otpExpiry,
      });

      if (user.email && dto.email && user.email === dto.email) {
        await this.mailService.sendOtpEmail(user.email, otp);
        return {
          success: true,
          message: 'OTP resent to your email',
          data: { email: user.email },
        };
      } else if (
        user.phoneNumber &&
        dto.phone &&
        user.phoneNumber === dto.phone
      ) {
        await this.smsService.sendOtpSms(user.phoneNumber, otp);
        return {
          success: true,
          message: 'OTP resent to your phone',
          data: { phone: user.phoneNumber },
        };
      } else {
        throw new InternalServerErrorException({
          success: false,
          message: 'Unable to deliver OTP to your contact method',
        });
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      const err = error as Error;
      throw new InternalServerErrorException({
        success: false,
        message: 'Failed to resend OTP',
        error: err.message,
      });
    }
  }

  async login(loginDto: LoginDto) {
    try {
      const user = await this.userService.findByEmail(loginDto.email);
      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      if (!user.isVerified) {
        throw new UnauthorizedException('Please verify your account first');
      }
      if (!user.isActive) {
        throw new UnauthorizedException('Account is inactive');
      }

      if (!user.password) {
        throw new UnauthorizedException(
          'This account uses social sign-in. Please sign in with Google or Apple.',
        );
      }

      const isMatch = await bcrypt.compare(loginDto.password, user.password);
      if (!isMatch) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const payload = { sub: user._id, role: user.role };
      const accessToken = await this.jwtService.signAsync(payload);

      return {
        success: true,
        message: 'Login successful',
        data: {
          accessToken,
          user: {
            id: user._id,
            fullName: user.fullName,
            email: user.email,
            role: user.role,
          },
        },
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      const err = error as Error;
      throw new InternalServerErrorException({
        success: false,
        message: 'Login failed',
        error: err.message,
      });
    }
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    try {
      const user = await this.userService.findByEmail(dto.email);
      if (!user || !user.isActive || !user.isVerified) {
        throw new BadRequestException('User not found');
      }
      const otp = this.otpService.generateOtp();
      const hashedOtp = await this.otpService.hashOtp(otp);
      const otpExpiry = this.otpService.getExpiryDate();

      await this.userService.updateUserById(String(user._id), {
        otp: hashedOtp,
        otpExpiry,
      });

      await this.mailService.sendPasswordResetOtpEmail(user.email!, otp);

      const otpSecret = this.configService.get<string>('jwt.otpSecret');
      const otpExpiresIn =
        this.configService.get<JwtSignOptions['expiresIn']>('jwt.otpExpiresIn');
      const token = this.jwtService.sign(
        { email: user.email },
        {
          secret: otpSecret,
          expiresIn: otpExpiresIn,
        },
      );

      return { token };
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
        message: 'Forgot password request failed',
        error: err.message,
      });
    }
  }

  async resendForgotPasswordOtp(dto: ResendForgotPasswordOtpDto) {
    try {
      const otpSecret = this.configService.get<string>('jwt.otpSecret');

      let decoded: { email: string };
      try {
        decoded = this.jwtService.verify<{ email: string }>(dto.token, {
          secret: otpSecret,
        });
      } catch {
        throw new UnauthorizedException(
          'Invalid or expired token. Please call /auth/forgot-password to restart.',
        );
      }

      const user = await this.userService.findByEmail(decoded.email);
      if (!user || !user.isActive || !user.isVerified) {
        throw new BadRequestException('User not found');
      }

      const otp = this.otpService.generateOtp();
      const hashedOtp = await this.otpService.hashOtp(otp);
      const otpExpiry = this.otpService.getExpiryDate();

      await this.userService.updateUserById(String(user._id), {
        otp: hashedOtp,
        otpExpiry,
      });

      await this.mailService.sendPasswordResetOtpEmail(user.email!, otp);

      return null;
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
        message: 'Resend OTP failed',
        error: err.message,
      });
    }
  }

  async verifyForgotPasswordOtp(dto: VerifyForgotPasswordOtpDto) {
    try {
      const otpSecret = this.configService.get<string>('jwt.otpSecret');
      const otpExpiresIn =
        this.configService.get<JwtSignOptions['expiresIn']>('jwt.otpExpiresIn');

      let decoded: { email: string };
      try {
        decoded = this.jwtService.verify<{ email: string }>(dto.token, {
          secret: otpSecret,
        });
      } catch {
        throw new UnauthorizedException(
          'Invalid or expired token. Please call /auth/forgot-password to restart.',
        );
      }

      const user = await this.userService.findByEmail(decoded.email);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (!user.otp || !user.otpExpiry) {
        throw new BadRequestException('OTP expired, please request a new one');
      }
      if (new Date() > user.otpExpiry) {
        throw new BadRequestException('OTP expired, please request a new one');
      }

      const isMatch = await this.otpService.compareOtp(dto.otp, user.otp);
      if (!isMatch) {
        throw new BadRequestException('Invalid OTP');
      }

      await this.userService.updateUserById(String(user._id), {}, [
        'otp',
        'otpExpiry',
      ]);

      const resetPasswordToken = this.jwtService.sign(
        { email: user.email, isResetPassword: true },
        { secret: otpSecret, expiresIn: otpExpiresIn },
      );

      return { resetPasswordToken };
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
        message: 'OTP verification failed',
        error: err.message,
      });
    }
  }

  async resetPassword(dto: ResetPasswordDto) {
    try {
      const otpSecret = this.configService.get<string>('jwt.otpSecret');

      let decoded: { email: string; isResetPassword?: boolean };
      try {
        decoded = this.jwtService.verify<{
          email: string;
          isResetPassword?: boolean;
        }>(dto.resetPasswordToken, { secret: otpSecret });
      } catch {
        throw new UnauthorizedException('Invalid or expired reset token.');
      }

      if (!decoded.isResetPassword) {
        throw new UnauthorizedException('Invalid reset token');
      }

      const user = await this.userService.findByEmail(decoded.email);
      if (!user || !user.isActive) {
        throw new BadRequestException('User not found');
      }

      const hashedPassword = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);

      await this.userService.updateUserById(String(user._id), {
        password: hashedPassword,
      });

      return null;
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
        message: 'Password reset failed',
        error: err.message,
      });
    }
  }
}
