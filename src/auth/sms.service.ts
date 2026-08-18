import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

interface SmsToSendResponse {
  success: boolean;
  message?: string;
  status?: string;
  failed_reason?: string | null;
  internal_failed_reason?: string | null;
}

const FAILURE_STATUSES = new Set(['REJECTED', 'FAILED']);

const SUCCESS_STATUSES = new Set(['DONE', 'SCHEDULED', 'PENDING']);

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly apiKey: string;
  private readonly senderId: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('smsto.apiKey') ?? '';
    this.senderId = this.configService.get<string>('smsto.senderId') ?? 'SMSto';
  }

  async sendOtpSms(toPhoneNumber: string, otp: string): Promise<void> {
    const expiryMinutes =
      this.configService.get<number>('otp.expiresInMinutes') ?? 5;

    const messageBody = `Your verification code is: ${otp}. It expires in ${expiryMinutes} minutes. Do not share it with anyone.`;

    try {
      const response = await axios.post<SmsToSendResponse>(
        'https://api.sms.to/sms/send',
        {
          to: toPhoneNumber,
          message: messageBody,
          sender_id: this.senderId,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const data = response.data;

      if (data.success === false) {
        const reason = data.message ?? 'sms.to returned success: false';
        this.logger.error(
          `[sms.to] Message rejected by API (success=false): ${reason}`,
        );
        throw new InternalServerErrorException({
          success: false,
          message: 'Failed to send OTP SMS',
          error: reason,
        });
      }

      if (data.status && FAILURE_STATUSES.has(data.status)) {
        const reason =
          data.failed_reason ??
          data.internal_failed_reason ??
          `sms.to message status: ${data.status}`;
        this.logger.error(
          `[sms.to] Message status indicates failure: ${data.status} — ${reason}`,
        );
        throw new InternalServerErrorException({
          success: false,
          message: 'Failed to send OTP SMS',
          error: reason,
        });
      }

      const acceptedStatus = data.status ?? 'unknown';
      if (
        !SUCCESS_STATUSES.has(acceptedStatus) &&
        acceptedStatus !== 'unknown'
      ) {
        this.logger.warn(
          `[sms.to] Unexpected message status: ${acceptedStatus}. Treating as accepted.`,
        );
      } else {
        this.logger.log(
          `[sms.to] SMS accepted for ${toPhoneNumber} — status: ${acceptedStatus}`,
        );
      }
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      const axiosErr = error as AxiosError<{
        message?: string;
        error?: string;
      }>;

      if (axiosErr.isAxiosError) {
        const statusCode = axiosErr.response?.status;
        const responseBody = axiosErr.response?.data;
        const apiMessage =
          responseBody?.message ?? responseBody?.error ?? axiosErr.message;

        if (statusCode === 401 || statusCode === 403 || statusCode === 412) {
          this.logger.error(
            `[sms.to] Authentication error (HTTP ${statusCode}): invalid API key or insufficient permissions. ` +
              `Check SMS_TO_API_KEY in your .env. Response: ${JSON.stringify(responseBody)}`,
          );
        } else if (statusCode === 422) {
          this.logger.error(
            `[sms.to] Validation error (HTTP 422): likely invalid phone number format or missing field. ` +
              `Response: ${JSON.stringify(responseBody)}`,
          );
        } else if (statusCode === 402) {
          this.logger.error(
            `[sms.to] Insufficient balance (HTTP 402): top up your sms.to account. ` +
              `Response: ${JSON.stringify(responseBody)}`,
          );
        } else {
          this.logger.error(
            `[sms.to] HTTP error ${statusCode ?? 'network'}: ${apiMessage}`,
          );
        }

        throw new InternalServerErrorException({
          success: false,
          message: 'Failed to send OTP SMS',
          error: apiMessage,
        });
      }

      const err = error as Error;
      this.logger.error(`[sms.to] Unexpected error: ${err.message}`);
      throw new InternalServerErrorException({
        success: false,
        message: 'Failed to send OTP SMS',
        error: err.message,
      });
    }
  }
}
