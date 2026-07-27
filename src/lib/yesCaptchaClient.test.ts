import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosInstance } from 'axios';
import { YesCaptchaClient } from './yesCaptchaClient';

test('creates a TurnstileTaskProxyless task and returns its token', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const client = createClient(
    {
      errorId: 0,
      status: 'ready',
      solution: { token: 'turnstile-token' }
    },
    requests
  );

  const token = await new YesCaptchaClient('client-key', client).solveTurnstile(
    'https://suno.com/create',
    'website-key'
  );

  assert.equal(token, 'turnstile-token');
  assert.deepEqual(requests, [
    {
      url: 'https://api.yescaptcha.com/createTask',
      body: {
        clientKey: 'client-key',
        task: {
          type: 'TurnstileTaskProxyless',
          websiteURL: 'https://suno.com/create',
          websiteKey: 'website-key'
        }
      }
    }
  ]);
});

test('rejects a ready Turnstile task without a token', async () => {
  const client = createClient(
    { errorId: 0, status: 'ready', solution: {} },
    []
  );
  await assert.rejects(
    () =>
      new YesCaptchaClient('client-key', client).solveTurnstile(
        'https://suno.com/create',
        'website-key'
      ),
    /no Turnstile token/
  );
});

function createClient(
  response: unknown,
  requests: Array<{ url: string; body: unknown }>
): AxiosInstance {
  return {
    post: async (url: string, body: unknown) => {
      requests.push({ url, body });
      return { data: response };
    }
  } as unknown as AxiosInstance;
}
