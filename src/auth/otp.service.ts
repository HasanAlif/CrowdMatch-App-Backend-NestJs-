import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';

@Injectable()
export class OtpService {
  private readonly SALT_ROUNDS = 10;

  constructor(private readonly configService: ConfigService) {}

  generateOtp(): string {
    let otp = '';
    for (let i = 0; i < 6; i++) {
      otp += randomInt(0, 10).toString();
    }
    return otp;
  }

  async hashOtp(otp: string): Promise<string> {
    return await bcrypt.hash(otp, this.SALT_ROUNDS);
  }

  async compareOtp(otp: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(otp, hash);
  }

  getExpiryDate(): Date {
    const minutes = this.configService.get<number>('otp.expiresInMinutes') ?? 5;
    return new Date(Date.now() + minutes * 60 * 1000);
  }
}
