import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';

import {
  DEFAULT_PHONE_COUNTRY,
  detectCountry,
  maskPhone,
  normalizeToE164,
} from 'src/utils/phone.util';

const DELIVERY_CHECK_DELAY_MS = 8000;

interface TwilioLikeError {
  code?: number;
  status?: number;
  message?: string;
}

function isTwilioError(error: unknown): error is TwilioLikeError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as TwilioLikeError;
  return (
    typeof candidate.code === 'number' || typeof candidate.status === 'number'
  );
}

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);

  private readonly client: Twilio;

  private readonly fromNumber: string;

  private readonly messagingServiceSid: string;

  private readonly defaultCountry: string;

  private readonly alphaSenderId: string;

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

    this.fromNumber =
      this.configService.get<string>('twilio.phoneNumber')?.trim() ?? '';
    this.messagingServiceSid =
      this.configService.get<string>('twilio.messagingServiceSid')?.trim() ??
      '';
    this.defaultCountry =
      this.configService.get<string>('twilio.defaultCountry') ??
      DEFAULT_PHONE_COUNTRY;
    this.alphaSenderId =
      this.configService.get<string>('twilio.alphaSenderId')?.trim() ?? '';
  }

  onModuleInit(): void {
    if (!this.messagingServiceSid && !this.fromNumber) {
      throw new Error(
        '[SmsService] No SMS sender configured. Set TWILIO_PHONE_NUMBER to an ' +
          'E.164 number owned by this account, or TWILIO_MESSAGING_SERVICE_SID ' +
          'to a Messaging Service.',
      );
    }

    if (this.messagingServiceSid) {
      this.logger.log(
        `[Twilio] Sending via Messaging Service ${this.messagingServiceSid}`,
      );
    } else {
      this.logger.log(`[Twilio] Sending from number ${this.fromNumber}`);
    }

    if (this.alphaSenderId) {
      this.logger.warn(
        `[Twilio] TWILIO_ALPHA_SENDER_ID ("${this.alphaSenderId}") is set but is ` +
          'IGNORED. Alphanumeric Sender IDs must be pre-registered on the account ' +
          'and are not used by this service. Unset it to silence this warning.',
      );
    }

    this.logger.log(
      `[Twilio] Default region for local-format numbers: ${this.defaultCountry}`,
    );
  }

  async sendOtpSms(toPhoneNumber: string, otp: string): Promise<void> {
    const expiryMinutes =
      this.configService.get<number>('otp.expiresInMinutes') ?? 5;

    const to = normalizeToE164(toPhoneNumber, this.defaultCountry);

    if (!to) {
      this.logger.error(
        `[Twilio] Cannot send OTP — "${maskPhone(toPhoneNumber)}" is not a valid ` +
          `phone number (default region ${this.defaultCountry}).`,
      );
      throw new InternalServerErrorException({
        success: false,
        message: 'Failed to send OTP SMS',
        error: 'Invalid destination phone number',
      });
    }

    const iso = detectCountry(to, this.defaultCountry) ?? 'unknown';
    const body = `Your verification code is: ${otp}. It expires in ${expiryMinutes} minutes. Do not share it with anyone.`;

    try {
      const message = await this.client.messages.create(
        this.messagingServiceSid
          ? { body, messagingServiceSid: this.messagingServiceSid, to }
          : { body, from: this.fromNumber, to },
      );

      this.logger.log(
        `[Twilio] Message ${message.sid} accepted with status "${message.status}" ` +
          `for ${maskPhone(to)} [country=${iso}] — not yet delivered`,
      );

      this.scheduleDeliveryCheck(message.sid, maskPhone(to), iso);
    } catch (error) {
      this.logTwilioFailure(error, maskPhone(to), iso);

      const reason = isTwilioError(error)
        ? (error.message ?? 'Twilio request failed')
        : ((error as Error).message ?? 'Twilio request failed');

      throw new InternalServerErrorException({
        success: false,
        message: 'Failed to send OTP SMS',
        error: reason,
      });
    }
  }

  private scheduleDeliveryCheck(
    sid: string,
    maskedTo: string,
    iso: string,
  ): void {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const fetched = await this.client.messages(sid).fetch();

          if (fetched.status === 'failed' || fetched.status === 'undelivered') {
            this.logger.warn(
              `[Twilio] Message ${sid} to ${maskedTo} [country=${iso}] ended as ` +
                `"${fetched.status}" — errorCode=${fetched.errorCode ?? 'none'}, ` +
                `errorMessage=${fetched.errorMessage ?? 'none'}`,
            );
          } else {
            this.logger.log(
              `[Twilio] Message ${sid} to ${maskedTo} [country=${iso}] status is ` +
                `"${fetched.status}"`,
            );
          }
        } catch (error) {
          const err = error as Error;
          this.logger.warn(
            `[Twilio] Could not re-fetch message ${sid} for delivery status: ${err.message}`,
          );
        }
      })();
    }, DELIVERY_CHECK_DELAY_MS);

    // Do not hold the process open purely for this check.
    timer.unref?.();
  }

  private logTwilioFailure(
    error: unknown,
    maskedTo: string,
    iso: string,
  ): void {
    if (!isTwilioError(error)) {
      const err = error as Error;
      this.logger.error(
        `[Twilio] Unexpected error sending SMS to ${maskedTo} [country=${iso}]: ${err.message}`,
      );
      return;
    }

    const { code, status, message: twilioMessage } = error;
    const suffix = `Twilio error ${code ?? 'n/a'} (HTTP ${status ?? 'n/a'}): ${twilioMessage ?? 'no message'}`;
    const sender = this.messagingServiceSid || this.fromNumber;

    switch (code) {
      case 21408:
        this.logger.error(
          `[Twilio] Geo Permissions are OFF for country "${iso}" — Twilio refused to ` +
            `send to ${maskedTo}. Enable "${iso}" under Console > Messaging > Settings > ` +
            `Geo Permissions, then retry. ${suffix}`,
        );
        return;

      case 21612:
        this.logger.error(
          `[Twilio] Sender "${sender}" cannot reach the destination network for ` +
            `${maskedTo} [country=${iso}]. ` +
            (iso === 'BD'
              ? 'In Bangladesh, GrameenPhone, Robi and Teletalk require a ' +
                'pre-registered alphanumeric Sender ID and will reject a US long ' +
                'code; Banglalink and smaller networks do accept it. '
              : '') +
            suffix,
        );
        return;

      case 21211:
        this.logger.error(
          `[Twilio] Invalid destination number ${maskedTo} [country=${iso}]. ${suffix}`,
        );
        return;

      case 21606:
        this.logger.error(
          `[Twilio] Sender "${sender}" is not SMS-capable or is not owned by this ` +
            `account. ${suffix}`,
        );
        return;

      case 21610:
        this.logger.error(
          `[Twilio] Recipient ${maskedTo} [country=${iso}] has opted out (STOP). ` +
            `They must text START to resume. ${suffix}`,
        );
        return;

      default:
        break;
    }

    if (status === 401) {
      this.logger.error(
        `[Twilio] Authentication failed (HTTP 401). Check TWILIO_ACCOUNT_SID and ` +
          `TWILIO_API_KEY/TWILIO_API_SECRET. ${suffix}`,
      );
      return;
    }

    if (status === 429) {
      this.logger.error(`[Twilio] Rate limit exceeded (HTTP 429). ${suffix}`);
      return;
    }

    this.logger.error(
      `[Twilio] Failed to send SMS to ${maskedTo} [country=${iso}]. ${suffix}`,
    );
  }
}
