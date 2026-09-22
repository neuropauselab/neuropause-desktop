import pino from 'pino';
import { loadEnv } from './env';

const isDev = loadEnv().NODE_ENV === 'development';

/**
 * Fields censored before anything is written.
 *
 * EXPORTED SO A TEST CAN ASSERT AGAINST THE SHIPPED LIST RATHER THAN A COPY OF IT. A test that
 * restated these strings would assert only that the test equals itself, and would stay green
 * if a path here were misspelled — which is the failure mode that matters, because a subtly
 * wrong redact path still looks correct in a config object while emitting the value.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'password',
  '*.password',
  'refreshToken',
  'accessToken',

  /*
   * POSTGRES ERROR FIELDS THAT CARRY ROW VALUES.
   *
   * Measured in NP-PILOT-FIRST-005 against a real Postgres 16: a constraint violation returns
   * `DETAIL: Failing row contains (...)` with THE ENTIRE ROW inlined, and a planted canary
   * came back in full. node-postgres surfaces that as `err.detail`, and the error middleware
   * logs `{ err, requestId }` wholesale — so a failed insert on `pilot_events` would have put
   * a participant's free-text feedback into a log line.
   *
   * THIS CORRECTS AN EARLIER CLAIM OF THIS PROGRAMME'S OWN: that participant free text "cannot
   * reach an application log line through any pilot path". That was true of the paths traced —
   * the pilot module logs nothing, the error handler never touches `req.body`, and a ZodError
   * renders `{ path, message }` without the offending value — and FALSE for this one. The
   * searched space had not included the database driver's error shape.
   *
   * Only the VALUE-BEARING fields are censored. `code`, `table`, `constraint`, `schema` and
   * `message` survive, so a log line still says what failed and where; what it no longer says
   * is what the row contained. Redaction that blinds the operator would trade one failure for
   * another.
   */
  'err.detail',
  'err.where',
  'err.internalQuery',
  'err.query',
  'err.hint',
  '*.detail',
  '*.where',
  '*.internalQuery',
  '*.query',
  '*.hint',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[redacted]',
  },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});
