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
