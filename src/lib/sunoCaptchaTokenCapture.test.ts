import assert from 'node:assert/strict';
import test from 'node:test';
import { Request } from 'playwright';
import { extractCaptchaResult, MissingCaptchaTokenError } from './sunoCaptchaTokenCapture';

function createRequest(token: string | null, authorization?: string): Request {
  return {
    postDataJSON: () => ({ token }),
    headers: () => ({ authorization })
  } as unknown as Request;
}

test('rejects a captured generate request without a captcha token', () => {
  assert.throws(() => extractCaptchaResult(createRequest(null)), MissingCaptchaTokenError);
});

test('returns a non-empty captcha token and bearer authorization', () => {
  assert.deepEqual(extractCaptchaResult(createRequest('captcha-token', 'Bearer session-token')), {
    token: 'captcha-token',
    authorizationToken: 'session-token'
  });
});
