/**
 * P6.1 — AWS transport guards: SigV4 signing-scope derivation (regional / GovCloud / global) and the
 * SSRF / credential-exfiltration hard stop in `AwsClient.send` (a request to a non-AWS host is refused BEFORE
 * any credential is attached, so the Authorization header + assumed-role session token can never leave AWS).
 */
import { describe, expect, it } from 'vitest';
import { AwsClient, deriveScope, isAwsHost } from './awsClient';
import type { RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined };
const creds = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', sessionToken: 'FQoGZXIvSESSION' };

describe('deriveScope', () => {
  it('derives service + region from a regional host', () => {
    expect(deriveScope('ec2.us-east-1.amazonaws.com')).toEqual({ service: 'ec2', region: 'us-east-1' });
    expect(deriveScope('rds.ap-southeast-2.amazonaws.com')).toEqual({ service: 'rds', region: 'ap-southeast-2' });
  });
  it('handles GovCloud regions (the 4-segment region slug)', () => {
    expect(deriveScope('ec2.us-gov-west-1.amazonaws.com')).toEqual({ service: 'ec2', region: 'us-gov-west-1' });
  });
  it('signs global services against us-east-1', () => {
    expect(deriveScope('iam.amazonaws.com')).toEqual({ service: 'iam', region: 'us-east-1' });
    expect(deriveScope('cloudfront.amazonaws.com')).toEqual({ service: 'cloudfront', region: 'us-east-1' });
  });
});

describe('isAwsHost', () => {
  it('accepts amazonaws.com endpoints (incl. China) and rejects everything else', () => {
    expect(isAwsHost('ec2.us-east-1.amazonaws.com')).toBe(true);
    expect(isAwsHost('s3.amazonaws.com')).toBe(true);
    expect(isAwsHost('ec2.cn-north-1.amazonaws.com.cn')).toBe(true);
    expect(isAwsHost('ec2.evil.com')).toBe(false);
    expect(isAwsHost('ec2.evil.amazonaws.com.attacker.com')).toBe(false);
    expect(isAwsHost('amazonaws.com.evil.com')).toBe(false);
  });
});

describe('AwsClient.send — SSRF hard stop', () => {
  it('refuses to sign a request to a non-AWS host (no credential leaves the app)', async () => {
    const client = new AwsClient(creds, gate);
    // A crafted region `evil.com/x` collapses the host to `ec2.evil.com` (path carries the rest).
    await expect(client.send({ method: 'GET', url: 'https://ec2.evil.com/x.amazonaws.com/' })).rejects.toThrow(/non-AWS host/);
  });
  it('the refusal happens before any network call for a bare attacker host too', async () => {
    const client = new AwsClient(creds, gate);
    await expect(client.send({ method: 'POST', url: 'https://attacker.example/', body: 'x' })).rejects.toThrow(/non-AWS host/);
  });
});
