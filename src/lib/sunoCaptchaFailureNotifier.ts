import { FeishuNotifier } from '@/lib/feishuNotifier';

interface NotifyCaptchaFailureInput {
  error: unknown;
  feishuNotifier: FeishuNotifier;
  formatError: (error: unknown) => string;
  htmlPath: string;
  jsonPath: string;
  screenshotPath: string;
  viewportScreenshotPath: string;
  videoPath?: string;
}

export async function notifyCaptchaFailure(input: NotifyCaptchaFailureInput): Promise<void> {
  if (!input.feishuNotifier.enabled) {
    return;
  }

  const text = [
    `Error: ${input.formatError(input.error)}`,
    `Viewport screenshot: ${input.viewportScreenshotPath}`,
    `Screenshot: ${input.screenshotPath}`,
    `HTML: ${input.htmlPath}`,
    `Diagnostics: ${input.jsonPath}`,
    input.videoPath ? `Recording: ${input.videoPath}` : undefined
  ].filter((line) => line !== undefined).join('\n');

  await input.feishuNotifier.notify({
    title: 'SunoCaptchaSolver failed',
    text,
    imagePath: input.viewportScreenshotPath
  });
}
