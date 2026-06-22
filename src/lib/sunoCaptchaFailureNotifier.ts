import { FeishuNotifier } from '@/lib/feishuNotifier';

interface NotifyCaptchaFailureInput {
  error: unknown;
  feishuNotifier: FeishuNotifier;
  formatError: (error: unknown) => string;
}

export async function notifyCaptchaFailure(input: NotifyCaptchaFailureInput): Promise<void> {
  if (!input.feishuNotifier.enabled) {
    return;
  }

  const text = `Error: ${input.formatError(input.error)}`;

  await input.feishuNotifier.notify({
    title: 'SunoCaptchaSolver failed',
    text
  });
}
