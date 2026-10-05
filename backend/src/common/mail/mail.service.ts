import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/**
 * Sends email over SMTP. Built for a Google account with an app password, so
 * the defaults are Gmail's: `smtp.gmail.com` on port 465 with TLS.
 *
 *   SMTP_USER       the Google account that sends, for example reports@rothenhall.com
 *   SMTP_PASSWORD   an app password for that account, never the account password
 *   SMTP_HOST       default smtp.gmail.com
 *   SMTP_PORT       default 465 (TLS). Use 587 for STARTTLS
 *   MAIL_FROM       default "Rothenhall <SMTP_USER>". Gmail only allows addresses that
 *                   belong to the account or are verified aliases of it
 *   MAIL_REPLY_TO   optional, where replies go
 *   MAIL_BCC        optional, a copy of every report, for the team
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport?: Transporter;

  get enabled(): boolean {
    return Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
  }

  async send(mail: Mail): Promise<void> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Email is not set up yet');
    }
    try {
      await this.connection().sendMail({
        from: process.env.MAIL_FROM || `Rothenhall <${process.env.SMTP_USER}>`,
        replyTo: process.env.MAIL_REPLY_TO || undefined,
        bcc: process.env.MAIL_BCC || undefined,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments,
      });
    } catch (error) {
      this.logger.error(`Sending email failed: ${(error as Error).message}`);
      throw new BadGatewayException(
        'We could not send the email. Please try again in a moment.',
      );
    }
  }

  private connection(): Transporter {
    if (!this.transport) {
      const port = Number(process.env.SMTP_PORT ?? 465);
      this.transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
        port,
        secure: process.env.SMTP_SECURE
          ? process.env.SMTP_SECURE === 'true'
          : port === 465,
        auth: {
          user: process.env.SMTP_USER,
          // Google shows app passwords in groups with spaces. They are not part of it.
          pass: (process.env.SMTP_PASSWORD ?? '').replace(/\s+/g, ''),
        },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 25_000,
      });
    }
    return this.transport;
  }
}
