import { Request } from 'playwright';

export interface CaptchaResult {
  token: string;
  authorizationToken?: string;
  browserIdentity: CaptchaBrowserIdentity;
}

export interface CaptchaBrowserIdentity {
  userAgent: string;
  secChUa?: string;
  secChUaMobile?: string;
  secChUaPlatform?: string;
}

export class MissingCaptchaTokenError extends Error {
  constructor() {
    super('Suno generate request did not contain a captcha token');
    this.name = 'MissingCaptchaTokenError';
  }
}

export class MissingBrowserIdentityError extends Error {
  constructor() {
    super('Suno generate request did not contain a browser user-agent');
    this.name = 'MissingBrowserIdentityError';
  }
}

export function extractCaptchaResult(request: Request): CaptchaResult {
  const payload = request.postDataJSON() as { token?: string | null };
  if (!payload?.token) {
    throw new MissingCaptchaTokenError();
  }

  const headers = request.headers();
  const authorization = headers.authorization;
  if (!headers['user-agent']) {
    throw new MissingBrowserIdentityError();
  }
  return {
    token: payload.token,
    authorizationToken: authorization?.startsWith('Bearer ')
      ? authorization.replace('Bearer ', '')
      : undefined,
    browserIdentity: {
      userAgent: headers['user-agent'],
      secChUa: headers['sec-ch-ua'],
      secChUaMobile: headers['sec-ch-ua-mobile'],
      secChUaPlatform: headers['sec-ch-ua-platform']
    }
  };
}
