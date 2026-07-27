import assert from 'node:assert/strict';
import test from 'node:test';
import { Request } from 'playwright';
import {
  extractCaptchaResult,
  MissingBrowserIdentityError,
  MissingCaptchaTokenError
} from './sunoCaptchaTokenCapture';

function createRequest(token: string | null, authorization?: string, userAgent?: string): Request {
  return {
    postDataJSON: () => ({ token }),
    headers: () => ({
      authorization,
      'user-agent': userAgent,
      'sec-ch-ua': '"Chromium";v="148"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Linux"'
    })
  } as unknown as Request;
}

test('rejects a captured generate request without a captcha token', () => {
  assert.throws(() => extractCaptchaResult(createRequest(null)), MissingCaptchaTokenError);
});

test('returns a non-empty captcha token and bearer authorization', () => {
  assert.deepEqual(extractCaptchaResult(createRequest(
    'captcha-token',
    'Bearer session-token',
    'Chrome/148'
  )), {
    token: 'captcha-token',
    authorizationToken: 'session-token',
    browserIdentity: {
      userAgent: 'Chrome/148',
      secChUa: '"Chromium";v="148"',
      secChUaMobile: '?0',
      secChUaPlatform: '"Linux"'
    }
  });
});

test('rejects a captured token without browser identity', () => {
  assert.throws(
    () => extractCaptchaResult(createRequest('captcha-token')),
    MissingBrowserIdentityError
  );
});
