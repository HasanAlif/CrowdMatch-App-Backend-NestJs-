import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('mail.host'),
      port: this.configService.get<number>('mail.port'),
      secure: false,
      auth: {
        user: this.configService.get<string>('mail.user'),
        pass: this.configService.get<string>('mail.pass'),
      },
    });
  }

  async sendOtpEmail(to: string, otp: string): Promise<void> {
    const from = this.configService.get<string>('mail.from');
    const expiryMinutes =
      this.configService.get<number>('otp.expiresInMinutes') ?? 5;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f5f5f0;font-family:Arial,Helvetica,sans-serif;">

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#f5f5f0;padding:32px 0;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;background-color:#ffffff;
                      border-radius:12px;overflow:hidden;
                      box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Golden header band -->
          <tr>
            <td style="background-color:#F5B301;padding:36px 40px;text-align:center;">
              <p style="margin:0 0 8px 0;font-size:32px;">🔐</p>
              <h1 style="margin:0;color:#1a1200;font-size:24px;font-weight:700;
                         line-height:1.3;letter-spacing:-0.3px;">
                Verify your email
              </h1>
            </td>
          </tr>

          <!-- Gold accent divider -->
          <tr><td style="height:4px;background-color:#F2A900;"></td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px 0;color:#374151;font-size:16px;line-height:1.6;text-align:center;">
                Use the verification code below to complete your registration.
                <br>This code will expire in <strong>${expiryMinutes} minutes</strong>.
              </p>
              
              <div style="font-size:42px;font-weight:700;letter-spacing:12px;color:#1a1200;text-align:center;padding:24px;background-color:#fff8e6;border:2px dashed #F5B301;border-radius:8px;margin:32px 0;">
                ${otp}
              </div>

              <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;text-align:center;">
                If you didn't request this code, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Gold divider -->
          <tr><td style="height:1px;background-color:#F5B301;margin:0 40px;"></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
                This is a transactional message from SwapMess.<br>
                Please do not reply directly to this email.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>

</body>
</html>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: 'Your OTP verification code',
        html,
        text: `Your OTP code is: ${otp}. It expires in ${expiryMinutes} minutes.`,
      });
    } catch (error) {
      const err = error as Error;
      throw new InternalServerErrorException({
        success: false,
        message: 'Failed to send OTP email',
        error: err.message,
      });
    }
  }

  async sendPasswordResetOtpEmail(to: string, otp: string): Promise<void> {
    const from = this.configService.get<string>('mail.from');
    const expiryMinutes =
      this.configService.get<number>('otp.expiresInMinutes') ?? 5;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f5f5f0;font-family:Arial,Helvetica,sans-serif;">

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#f5f5f0;padding:32px 0;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;background-color:#ffffff;
                      border-radius:12px;overflow:hidden;
                      box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Golden header band -->
          <tr>
            <td style="background-color:#F5B301;padding:36px 40px;text-align:center;">
              <p style="margin:0 0 8px 0;font-size:32px;">🔑</p>
              <h1 style="margin:0;color:#1a1200;font-size:24px;font-weight:700;
                         line-height:1.3;letter-spacing:-0.3px;">
                Reset your password
              </h1>
            </td>
          </tr>

          <!-- Gold accent divider -->
          <tr><td style="height:4px;background-color:#F2A900;"></td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px 0;color:#374151;font-size:16px;line-height:1.6;text-align:center;">
                Use the verification code below to reset your password.
                <br>This code will expire in <strong>${expiryMinutes} minutes</strong>.
              </p>
              
              <div style="font-size:42px;font-weight:700;letter-spacing:12px;color:#1a1200;text-align:center;padding:24px;background-color:#fff8e6;border:2px dashed #F5B301;border-radius:8px;margin:32px 0;">
                ${otp}
              </div>

              <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;text-align:center;">
                If you didn't request a password reset, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Gold divider -->
          <tr><td style="height:1px;background-color:#F5B301;margin:0 40px;"></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
                This is a transactional message from SwapMess.<br>
                Please do not reply directly to this email.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>

</body>
</html>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: 'Your password reset code',
        html,
        text: `Your password reset code is: ${otp}. It expires in ${expiryMinutes} minutes.`,
      });
    } catch (error) {
      const err = error as Error;
      throw new InternalServerErrorException({
        success: false,
        message: 'Failed to send password reset email',
        error: err.message,
      });
    }
  }

  async sendEventApprovedEmail(
    to: string | undefined | null,
    opts: { userName: string; category: string; eventId: string },
  ): Promise<void> {
    if (!to) {
      this.logger.log(
        `No email on file for event ${opts.eventId} submitter — skipping approval email.`,
      );
      return;
    }

    const from = this.configService.get<string>('mail.from');
    const { userName, category } = opts;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f5f5f0;font-family:Arial,Helvetica,sans-serif;">

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#f5f5f0;padding:32px 0;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;background-color:#ffffff;
                      border-radius:12px;overflow:hidden;
                      box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Golden header band -->
          <tr>
            <td style="background-color:#F5B301;padding:36px 40px;text-align:center;">
              <p style="margin:0 0 8px 0;font-size:32px;">🎉</p>
              <h1 style="margin:0;color:#1a1200;font-size:24px;font-weight:700;
                         line-height:1.3;letter-spacing:-0.3px;">
                Your ${category} event is now live!
              </h1>
            </td>
          </tr>

          <!-- Gold accent divider -->
          <tr><td style="height:4px;background-color:#F2A900;"></td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px 0;color:#111827;font-size:16px;line-height:1.6;">
                Hi <strong>${userName}</strong>,
              </p>
              <p style="margin:0 0 16px 0;color:#374151;font-size:16px;line-height:1.6;">
                Great news — your <strong>${category}</strong> event has been reviewed and
                <strong style="color:#c88000;">approved</strong> by our admin team. It is
                now publicly visible on the platform for the entire community to see.
              </p>
              <p style="margin:0 0 32px 0;color:#374151;font-size:16px;line-height:1.6;">
                Thank you for sharing this moment with us. Wishing you a truly beautiful simcha!
              </p>
            </td>
          </tr>

          <!-- Gold divider -->
          <tr><td style="height:1px;background-color:#F5B301;margin:0 40px;"></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
                This is a transactional message from SwapMess.<br>
                Please do not reply directly to this email.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>

</body>
</html>
    `;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: `Your ${category} event is approved and now live! 🎉`,
        html,
        text: `Hi ${userName}, your ${category} event has been approved and is now publicly visible. Visit SwapMess to see it.`,
      });
      this.logger.log(`Approval email sent to ${to} for event ${opts.eventId}`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to send approval email to ${to} for event ${opts.eventId}`,
        err.stack,
      );
    }
  }
}
