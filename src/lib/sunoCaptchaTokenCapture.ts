import { Request } from 'playwright';

export interface CaptchaResult {
  token: string;
  authorizationToken?: string;
}

export function extractCaptchaResult(request: Request): CaptchaResult {
  const payload = request.postDataJSON() as { token?: string | null };
  if (!payload?.token) {
    throw new Error('Suno generate request did not contain a captcha token');
  }

  const authorization = request.headers().authorization;
  return {
    token: payload.token,
    authorizationToken: authorization?.startsWith('Bearer ')
      ? authorization.replace('Bearer ', '')
      : undefined
  };
}
