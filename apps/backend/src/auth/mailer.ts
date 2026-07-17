/**
 * Mailer seam for account emails.
 *
 * IMPORTANT: `createLoggingMailer` does NOT send email — it logs the link. It
 * exists so the verification/reset flows are complete and testable without a
 * mail provider. Sending for real means implementing this interface against a
 * provider (SES / Postmark / SMTP) and wiring it in; the flows are unchanged.
 */
import type { Logger } from 'pino';
import { loadEnv } from '../config/env';

export interface Mailer {
  sendEmailVerification(email: string, verifyUrl: string): Promise<void>;
  sendPasswordReset(email: string, resetUrl: string): Promise<void>;
}

/**
 * A mailer that logs the link instead of sending it. Development only.
 *
 * SECURITY: the verify/reset URLs embed a single-use token — logging the full URL
 * writes that credential to the log sink, where a reset link is enough to take over
 * an account. So the token-bearing URL is only ever logged OUTSIDE production; if this
 * mailer is wired as a fallback in production (no provider configured), the link is
 * redacted and only the recipient is recorded. Note this is NOT solved by pino's
 * `redact` config (config/logger.ts) — the token is embedded inside the URL string,
 * not a field it censors — so the correct fix is to not log the URL at all in prod.
 */
export function createLoggingMailer(logger: Pick<Logger, 'info'>): Mailer {
  const exposeLink = loadEnv().NODE_ENV !== 'production';
  return {
    async sendEmailVerification(email, verifyUrl) {
      logger.info(
        exposeLink ? { email, verifyUrl } : { email, verifyUrl: '[redacted]' },
        '[dev mailer] email verification link (not sent)',
      );
    },
    async sendPasswordReset(email, resetUrl) {
      logger.info(
        exposeLink ? { email, resetUrl } : { email, resetUrl: '[redacted]' },
        '[dev mailer] password reset link (not sent)',
      );
    },
  };
}
