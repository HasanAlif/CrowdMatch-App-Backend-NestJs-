import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio, RestException } from 'twilio';

function validateAlphaSenderId(id: string): string | null {
  if (!id || id.trim().length === 0) {
    return 'TWILIO_ALPHA_SENDER_ID must not be empty.';
  }
  if (id.length > 11) {
    return `TWILIO_ALPHA_SENDER_ID "${id}" is ${id.length} chars — Twilio requires ≤11 characters.`;
  }
  if (!/[a-zA-Z]/.test(id)) {
    return `TWILIO_ALPHA_SENDER_ID "${id}" contains no letters — all-digit or all-symbol sender IDs are not permitted as alphanumeric IDs.`;
  }
  return null;
}

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);

  private readonly client: Twilio;

  private readonly from: string;

  private readonly usingAlphaSender: boolean;

  constructor(private readonly configService: ConfigService) {
    const accountSid =
      this.configService.get<string>('twilio.accountSid') ?? '';
    const apiKey = this.configService.get<string>('twilio.apiKey');
    const apiSecret = this.configService.get<string>('twilio.apiSecret');
    const authToken = this.configService.get<string>('twilio.authToken') ?? '';

    if (apiKey && apiSecret) {
      this.client = new Twilio(apiKey, apiSecret, { accountSid });
    } else {
      this.client = new Twilio(accountSid, authToken);
    }

    const phoneNumber = this.configService.get<string>('twilio.phoneNumber');

    if (phoneNumber) {
      this.from = phoneNumber;
      this.usingAlphaSender = false;
    } else {
      this.from =
        this.configService.get<string>('twilio.alphaSenderId') ?? 'CrowdMatch';
      this.usingAlphaSender = true;
    }
  }

  onModuleInit(): void {
    if (this.usingAlphaSender) {
      const validationError = validateAlphaSenderId(this.from);
      if (validationError) {
        throw new Error(
          `[SmsService] Invalid alphanumeric sender ID — ${validationError} ` +
            `Set a valid TWILIO_ALPHA_SENDER_ID (≤11 chars, must contain at least one letter) ` +
            `or set TWILIO_PHONE_NUMBER to use a real E.164 number instead.`,
        );
      }
      this.logger.log(`[Twilio] Using alphanumeric sender ID: "${this.from}"`);
    } else {
      this.logger.log(`[Twilio] Using phone number as sender: ${this.from}`);
    }
  }

  async sendOtpSms(toPhoneNumber: string, otp: string): Promise<void> {
    const expiryMinutes =
      this.configService.get<number>('otp.expiresInMinutes') ?? 5;

    const body = `Your verification code is: ${otp}. It expires in ${expiryMinutes} minutes. Do not share it with anyone.`;

    try {
      const message = await this.client.messages.create({
        body,
        from: this.from,
        to: toPhoneNumber,
      });

      this.logger.log(
        `[Twilio] SMS accepted for ${toPhoneNumber} — SID: ${message.sid}, status: ${message.status}`,
      );
    } catch (error) {
      if (error instanceof RestException) {
        const { status, code, message: twilioMessage } = error;

        if (code === 21612) {
          this.logger.error(
            `[Twilio] The sender "${this.from}" is not a valid or SMS-capable number/sender ID ` +
              `registered on this Twilio account. ` +
              `If using an alphanumeric sender, ensure the Alphanumeric Sender ID feature is enabled ` +
              `on your account and that the destination country supports it. ` +
              `Twilio error ${code} (HTTP ${status}): ${twilioMessage}`,
          );
        } else if (code === 21408 || code === 21215) {
          this.logger.error(
            `[Twilio] Destination country or number not permitted. ` +
              `Alphanumeric senders are unsupported in some regions (e.g. US, Canada) — ` +
              `set TWILIO_PHONE_NUMBER to use a real E.164 number for broader reach. ` +
              `Twilio error ${code} (HTTP ${status}): ${twilioMessage}`,
          );
        } else if (status === 401) {
          this.logger.error(
            `[Twilio] Authentication failed (HTTP 401). ` +
              `Check TWILIO_ACCOUNT_SID and TWILIO_API_KEY/TWILIO_API_SECRET. ` +
              `Twilio error ${code}: ${twilioMessage}`,
          );
        } else if (status === 429) {
          this.logger.error(
            `[Twilio] Rate limit exceeded (HTTP 429). ` +
              `Twilio error ${code}: ${twilioMessage}`,
          );
        } else {
          this.logger.error(
            `[Twilio] API error sending SMS to ${toPhoneNumber}. ` +
              `Twilio error ${code} (HTTP ${status}): ${twilioMessage}`,
          );
        }

        throw new InternalServerErrorException({
          success: false,
          message: 'Failed to send OTP SMS',
          error: twilioMessage,
        });
      }
      const err = error as Error;
      this.logger.error(
        `[Twilio] Unexpected error sending SMS to ${toPhoneNumber}: ${err.message}`,
      );
      throw new InternalServerErrorException({
        success: false,
        message: 'Failed to send OTP SMS',
        error: err.message,
      });
    }
  }
}
