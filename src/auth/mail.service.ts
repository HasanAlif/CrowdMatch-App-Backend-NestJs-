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

  private buildEmailShell(
    headerEmoji: string,
    headerTitle: string,
    bodyHtml: string,
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f5f5f0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

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

          <!-- Brand gradient header band -->
          <!-- background-color is the solid fallback for clients that ignore CSS gradients (e.g. older Outlook) -->
          <tr>
            <td style="background-color:#E8187A;background-image:linear-gradient(90deg,#E8187A,#FF4D9D);padding:36px 40px;text-align:center;">
              <p style="margin:0 0 8px 0;font-size:32px;">${headerEmoji}</p>
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;
                         font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                         line-height:1.3;letter-spacing:-0.3px;">
                ${headerTitle}
              </h1>
            </td>
          </tr>

          <!-- Pink accent divider -->
          <tr><td style="height:4px;background-color:#E8187A;"></td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Pink divider -->
          <tr><td style="height:1px;background-color:#E8187A;margin:0 40px;"></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;
                        font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
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
  }

  async sendOtpEmail(to: string, otp: string): Promise<void> {
    const from = this.configService.get<string>('mail.from');
    const expiryMinutes =
      this.configService.get<number>('otp.expiresInMinutes') ?? 5;

    const bodyHtml = `
      <p style="margin:0 0 16px 0;color:#374151;font-size:16px;line-height:1.6;text-align:center;
                font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Use the verification code below to complete your registration.
        <br>This code will expire in <strong>${expiryMinutes} minutes</strong>.
      </p>

      <div style="font-size:42px;font-weight:700;letter-spacing:12px;color:#111827;text-align:center;
                  padding:24px;background-color:#FDECF3;border:2px dashed #E8187A;
                  border-radius:8px;margin:32px 0;">
        ${otp}
      </div>

      <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;text-align:center;
                font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        If you didn't request this code, you can safely ignore this email.
      </p>
    `;

    const html = this.buildEmailShell('🔐', 'Verify your email', bodyHtml);

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

    const bodyHtml = `
      <p style="margin:0 0 16px 0;color:#374151;font-size:16px;line-height:1.6;text-align:center;
                font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Use the verification code below to reset your password.
        <br>This code will expire in <strong>${expiryMinutes} minutes</strong>.
      </p>

      <div style="font-size:42px;font-weight:700;letter-spacing:12px;color:#111827;text-align:center;
                  padding:24px;background-color:#FDECF3;border:2px dashed #E8187A;
                  border-radius:8px;margin:32px 0;">
        ${otp}
      </div>

      <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;text-align:center;
                font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        If you didn't request a password reset, you can safely ignore this email.
      </p>
    `;

    const html = this.buildEmailShell('🔑', 'Reset your password', bodyHtml);

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
}
