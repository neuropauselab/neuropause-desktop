/**
 * Mailer seam for account emails.
 *
 * IMPORTANT: `createLoggingMailer` does NOT send email — it logs the link. It
 * exists so the verification/reset flows are complete and testable without a
 * mail provider. Sending for real means implementing this interface against a
 * provider (SES / Postmark / SMTP) and wiring it in; the flows are unchanged.
 */
import type { Logger } from 'pino';

export interface Mailer {
  sendEmailVerification(email: string, verifyUrl: string): Promise<void>;
  sendPasswordReset(email: string, resetUrl: string): Promise<void>;
}

/** A mailer that logs the link instead of sending it. Development only. */
export function createLoggingMailer(logger: Pick<Logger, 'info'>): Mailer {
  return {
    async sendEmailVerification(email, verifyUrl) {
      logger.info({ email, verifyUrl }, '[dev mailer] email verification link (not sent)');
    },
    async sendPasswordReset(email, resetUrl) {
      logger.info({ email, resetUrl }, '[dev mailer] password reset link (not sent)');
    },
  };
}
