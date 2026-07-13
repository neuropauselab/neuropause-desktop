/**
 * P6.1 — SigV4 signer, asserted against the official AWS `aws-sig-v4-test-suite` `get-vanilla` vector.
 * Each intermediate (signing key, canonical-request hash, final signature, Authorization header) is checked
 * so a regression localizes to the exact step.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signRequest, signingKey, amzDate, canonicalQuery, payloadHash, type AwsCredentials } from './awsSigv4';

const CREDS: AwsCredentials = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

describe('SigV4 — the official get-vanilla vector', () => {
  it('derives the exact signing key', () => {
    expect(signingKey(CREDS.secretAccessKey, '20150830', 'us-east-1', 'service').toString('hex')).toBe(
      '938127b5336810ddb6a5d6af445fcac9e371f9ed418ed386b022aed82901be75',
    );
  });

  it('produces the exact canonical-request hash, signature, and Authorization header', () => {
    const signed = signRequest(CREDS, {
      method: 'GET',
      host: 'example.amazonaws.com',
      path: '/',
      query: '',
      headers: {},
      body: '',
      region: 'us-east-1',
      service: 'service',
      now: '2015-08-30T12:36:00.000Z',
    });
    // Intermediate: SHA-256 of the canonical request.
    const creqHash = createHash('sha256').update(signed.canonicalRequest, 'utf8').digest('hex');
    expect(creqHash).toBe('bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63');
    // Final signature.
    expect(signed.signature).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
    // The full Authorization header (exact spacing/commas).
    expect(signed.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
    expect(signed.headers['X-Amz-Date']).toBe('20150830T123600Z');
  });

  it('signs and includes a session token when present', () => {
    const signed = signRequest({ ...CREDS, sessionToken: 'TEMP-TOKEN' }, {
      method: 'GET', host: 'example.amazonaws.com', path: '/', headers: {}, body: '', region: 'us-east-1', service: 'service', now: '2015-08-30T12:36:00.000Z',
    });
    expect(signed.headers['X-Amz-Security-Token']).toBe('TEMP-TOKEN');
    // The security token is a signed header, so it appears in SignedHeaders.
    expect(signed.headers.Authorization).toContain('x-amz-security-token');
  });

  it('helpers: amzDate, canonicalQuery (sorted + encoded), payloadHash (empty constant)', () => {
    expect(amzDate('2015-08-30T12:36:00.000Z')).toBe('20150830T123600Z');
    expect(canonicalQuery({ b: '2', a: '1 space' })).toBe('a=1%20space&b=2');
    expect(payloadHash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
