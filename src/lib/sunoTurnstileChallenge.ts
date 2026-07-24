import { Frame, Page } from 'playwright';

const TURNSTILE_FRAME_ORIGIN = 'https://challenges.cloudflare.com/';
const TURNSTILE_FRAME_URL_PART = '/turnstile/';
const TURNSTILE_FAILURE_RETRY_URL_PART = '/failure_retry/';
const TURNSTILE_WAIT_TIMEOUT_MS = 60_000;
const TURNSTILE_OUTCOME_TIMEOUT_MS = 30_000;
const TURNSTILE_POLL_INTERVAL_MS = 250;
const TURNSTILE_INTERACTIVE_WAIT_MS = 1_000;
const TURNSTILE_RETRY_DELAY_MS = 3_000;
const TURNSTILE_CLICK_DELAY_MS = 100;
const TURNSTILE_CHECKBOX_OFFSET_X = 20;
const TURNSTILE_MIN_WIDTH = 200;
const TURNSTILE_MIN_HEIGHT = 50;
const TURNSTILE_MAX_ATTEMPTS = 3;

interface TurnstileFrame {
  frame: Frame;
  height: number;
  url: string;
}

export async function solveTurnstileChallenges(
  page: Page,
  signal: AbortSignal,
  onClick: (attempt: number, retry: boolean) => void
): Promise<void> {
  for (let attempt = 1; attempt <= TURNSTILE_MAX_ATTEMPTS; attempt++) {
    const challenge = await waitForTurnstileFrame(page, signal, attempt > 1);
    if (!challenge) return;
    const frameBody = challenge.frame.locator('body');
    await frameBody.waitFor({ state: 'visible', timeout: TURNSTILE_WAIT_TIMEOUT_MS });
    if (!await waitForDuration(page, signal, TURNSTILE_INTERACTIVE_WAIT_MS)) return;
    await frameBody.click({
      force: true,
      delay: TURNSTILE_CLICK_DELAY_MS,
      position: {
        x: TURNSTILE_CHECKBOX_OFFSET_X,
        y: challenge.height / 2
      }
    });
    onClick(attempt, challenge.url.includes(TURNSTILE_FAILURE_RETRY_URL_PART));

    const retryRequired = await waitForTurnstileOutcome(page, challenge, signal);
    if (!retryRequired) return;
    if (attempt === TURNSTILE_MAX_ATTEMPTS) {
      throw new Error(`Cloudflare Turnstile failed after ${TURNSTILE_MAX_ATTEMPTS} attempts`);
    }
    if (!await waitForDuration(page, signal, TURNSTILE_RETRY_DELAY_MS)) return;
  }
}

async function waitForTurnstileFrame(
  page: Page,
  signal: AbortSignal,
  retryOnly: boolean
): Promise<TurnstileFrame | undefined> {
  const deadline = Date.now() + TURNSTILE_WAIT_TIMEOUT_MS;
  while (!signal.aborted && Date.now() < deadline) {
    const challenge = await findReadyTurnstileFrame(page, retryOnly);
    if (challenge) return challenge;
    if (!await waitForDuration(page, signal, TURNSTILE_POLL_INTERVAL_MS)) return undefined;
  }
  if (signal.aborted) return undefined;
  throw new Error('Timed out waiting for a visible Cloudflare Turnstile frame');
}

async function waitForTurnstileOutcome(
  page: Page,
  clicked: TurnstileFrame,
  signal: AbortSignal
): Promise<boolean> {
  const deadline = Date.now() + TURNSTILE_OUTCOME_TIMEOUT_MS;
  let challengeStarted = false;
  while (!signal.aborted && Date.now() < deadline) {
    const clickedReady = await readReadyTurnstileFrame(clicked.frame);
    if (!challengeStarted && (!clickedReady || clicked.frame.url() !== clicked.url)) {
      challengeStarted = true;
    }
    if (challengeStarted && await findReadyTurnstileFrame(page, true)) return true;
    if (!await waitForDuration(page, signal, TURNSTILE_POLL_INTERVAL_MS)) return false;
  }
  if (signal.aborted) return false;
  throw new Error('Cloudflare Turnstile did not produce a token or retry state');
}

async function findReadyTurnstileFrame(
  page: Page,
  retryOnly: boolean
): Promise<TurnstileFrame | undefined> {
  for (const frame of page.frames()) {
    if (!isTurnstileFrame(frame)) continue;
    const url = frame.url();
    if (retryOnly && !url.includes(TURNSTILE_FAILURE_RETRY_URL_PART)) continue;
    const challenge = await readReadyTurnstileFrame(frame);
    if (challenge) return challenge;
  }
  return undefined;
}

async function readReadyTurnstileFrame(frame: Frame): Promise<TurnstileFrame | undefined> {
  try {
    const box = await (await frame.frameElement()).boundingBox();
    if (box && box.width >= TURNSTILE_MIN_WIDTH && box.height >= TURNSTILE_MIN_HEIGHT) {
      return { frame, height: box.height, url: frame.url() };
    }
  } catch {
    // Turnstile replaces its frame while initializing; retry the active frame.
  }
  return undefined;
}

function isTurnstileFrame(frame: Frame): boolean {
  const url = frame.url();
  return url.startsWith(TURNSTILE_FRAME_ORIGIN) && url.includes(TURNSTILE_FRAME_URL_PART);
}

async function waitForDuration(page: Page, signal: AbortSignal, durationMs: number): Promise<boolean> {
  const deadline = Date.now() + durationMs;
  while (!signal.aborted && Date.now() < deadline) {
    await page.waitForTimeout(Math.min(TURNSTILE_POLL_INTERVAL_MS, deadline - Date.now()));
  }
  return !signal.aborted;
}
