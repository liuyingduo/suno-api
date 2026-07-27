import os from 'node:os';
import UserAgent from 'user-agents';

export function createBrowserUserAgent(): string {
  const configured = process.env.BROWSER_USER_AGENT;
  if (configured) {
    return configured;
  }

  if (process.platform === 'win32') {
    return new UserAgent({ deviceCategory: 'desktop', platform: 'Win32' }).random().toString();
  }

  if (process.platform === 'darwin') {
    return new UserAgent({ deviceCategory: 'desktop', platform: 'MacIntel' }).random().toString();
  }

  return `Mozilla/5.0 (X11; Linux ${os.arch() === 'arm64' ? 'aarch64' : 'x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`;
}

export function createMatchingChromiumUserAgent(
  browserVersion: string,
  platform: NodeJS.Platform = process.platform,
  architecture: string = os.arch()
): string {
  if (!/^\d+(?:\.\d+){3}$/.test(browserVersion)) {
    throw new Error(`Unsupported Chromium version: ${browserVersion}`);
  }

  const platformToken = platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : `X11; Linux ${architecture === 'arm64' ? 'aarch64' : 'x86_64'}`;
  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${browserVersion} Safari/537.36`;
}
