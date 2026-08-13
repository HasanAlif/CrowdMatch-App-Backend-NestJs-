import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';

@Injectable()
export class SmsService {
  private client: Twilio;
  private fromNumber: string;

  constructor(private readonly configService: ConfigService) {
    const accountSid =
      this.configService.get<string>('twilio.accountSid') ?? '';
    const authToken = this.configService.get<string>('twilio.authToken') ?? '';
    this.fromNumber =
      this.configService.get<string>('twilio.phoneNumber') ?? '';

    this.client = new Twilio(accountSid, authToken);
  }

  async sendOtpSms(toPhoneNumber: string, otp: string): Promise<void> {
    const expiryMinutes =
      this.configService.get<number>('otp.expiresInMinutes') ?? 5;

    try {
      await this.client.messages.create({
        body: `Your verification code is: ${otp}. It expires in ${expiryMinutes} minutes. Do not share it with anyone.`,
        from: this.fromNumber,
        to: toPhoneNumber,
      });
    } catch (error) {
      const err = error as Error;
      throw new InternalServerErrorException({
        success: false,
        message: 'Failed to send OTP SMS',
        error: err.message,
      });
    }
  }
}
