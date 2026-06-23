import { BrowserContext, Page, Response } from 'playwright';
import { decode as msgpackDecode, ExtensionCodec } from '@msgpack/msgpack';

interface HcaptchaEntity {
  entity_uri?: string;
  coords?: [number, number];
  size?: [number, number];
}

interface HcaptchaTask {
  datapoint_uri?: string;
  entities?: HcaptchaEntity[];
}

interface HcaptchaGetcaptchaResponse {
  success?: boolean;
  request_type?: string;
  tasklist?: HcaptchaTask[];
  c?: { type?: string; req?: string };
}

export interface HcaptchaDragDropChallenge {
  backgroundUri: string;
  entities: Required<HcaptchaEntity>[];
}

interface HcaptchaProtocolLogger {
  info(message: string): void;
  warn(message: string): void;
}

const hcaptchaCodec = new ExtensionCodec();
hcaptchaCodec.register({
  type: 18,
  encode: (input: unknown) => input instanceof Uint8Array ? input : null,
  decode: (data: Uint8Array) => data
});

export class HcaptchaDragDropProtocolStore {
  private challenge?: HcaptchaDragDropChallenge;

  constructor(private readonly logger?: HcaptchaProtocolLogger) {}

  public attach(page: Page): void {
    page.on('response', (response) => {
      if (!isInspectableResponse(response)) {
        return;
      }
      this.capture(response).catch(() => undefined);
    });
  }

  public getChallenge(): HcaptchaDragDropChallenge | undefined {
    return this.challenge;
  }

  private async capture(response: Response): Promise<void> {
    const data = await decodeGetcaptchaResponse(response);
    this.logSummary(response, data);
    const challenge = toDragDropChallenge(data);
    if (challenge) {
      this.challenge = challenge;
      this.logger?.info(
        `SunoCaptchaSolver: cached image_drag_drop protocol challenge ${JSON.stringify(summarizeDragDropChallenge(challenge))}`
      );
    }
  }

  private logSummary(response: Response, data: unknown): void {
    this.logger?.info(
      `SunoCaptchaSolver: hCaptcha protocol response ${response.status()} ${response.url()} ${JSON.stringify(summarizeProtocolData(data))}`
    );
  }
}

export async function renderDragDropChallengeImage(
  context: BrowserContext,
  challenge: HcaptchaDragDropChallenge
): Promise<string> {
  const page = await context.newPage();
  try {
    await page.setContent(createDragDropHtml(challenge), { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    const image = await page.locator('#captcha-composite').screenshot({ timeout: 10_000 });
    return image.toString('base64');
  } finally {
    await page.close();
  }
}

async function decodeGetcaptchaResponse(response: Response): Promise<unknown> {
  const body = await response.body();
  const text = body.toString('utf8');
  if (text.startsWith('{') || text.startsWith('[')) {
    return JSON.parse(text);
  }
  return msgpackDecode(body, { extensionCodec: hcaptchaCodec });
}

function toDragDropChallenge(data: unknown): HcaptchaDragDropChallenge | undefined {
  if (!isGetcaptchaResponse(data) || data.request_type !== 'image_drag_drop') {
    return undefined;
  }

  const task = data.tasklist?.find((item) => item.datapoint_uri && item.entities?.length);
  const entities = task?.entities
    ?.filter(isCompleteEntity)
    .sort((left, right) => left.coords[1] - right.coords[1]);
  if (!task?.datapoint_uri || !entities?.length) {
    return undefined;
  }
  return { backgroundUri: task.datapoint_uri, entities };
}

function isGetcaptchaResponse(value: unknown): value is HcaptchaGetcaptchaResponse {
  return Boolean(value && typeof value === 'object');
}

function isInspectableResponse(response: Response): boolean {
  const url = response.url();
  return url.includes('/getcaptcha/') || url.includes('/checkcaptcha/') || url.includes('/siteverify');
}

function summarizeProtocolData(data: unknown): Record<string, unknown> {
  if (!isGetcaptchaResponse(data)) {
    return { dataType: typeof data };
  }
  return {
    success: data.success,
    requestType: data.request_type,
    cType: data.c?.type,
    hasCReq: Boolean(data.c?.req),
    taskCount: data.tasklist?.length ?? 0,
    tasks: data.tasklist?.map(summarizeTask)
  };
}

function summarizeTask(task: HcaptchaTask): Record<string, unknown> {
  return {
    hasDatapointUri: Boolean(task.datapoint_uri),
    entityCount: task.entities?.length ?? 0,
    entities: task.entities?.map((entity) => ({
      hasEntityUri: Boolean(entity.entity_uri),
      coords: entity.coords,
      size: entity.size
    }))
  };
}

function summarizeDragDropChallenge(challenge: HcaptchaDragDropChallenge): Record<string, unknown> {
  return {
    hasBackgroundUri: Boolean(challenge.backgroundUri),
    entityCount: challenge.entities.length,
    entities: challenge.entities.map((entity) => ({
      coords: entity.coords,
      size: entity.size,
      hasEntityUri: Boolean(entity.entity_uri)
    }))
  };
}

function isCompleteEntity(entity: HcaptchaEntity): entity is Required<HcaptchaEntity> {
  return Boolean(
    entity.entity_uri &&
    Array.isArray(entity.coords) &&
    Array.isArray(entity.size)
  );
}

function createDragDropHtml(challenge: HcaptchaDragDropChallenge): string {
  const frame = computeFrame(challenge);
  const entities = challenge.entities.map((entity) => createEntityHtml(entity)).join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
body { margin: 0; background: transparent; }
#captcha-composite {
  position: relative;
  width: ${frame.width}px;
  height: ${frame.height}px;
  overflow: hidden;
  background: #f5f5f5;
}
.background {
  position: absolute;
  left: 0;
  top: 0;
  width: ${frame.backgroundWidth}px;
  height: ${frame.height}px;
}
.entity {
  position: absolute;
  object-fit: contain;
}
</style>
</head>
<body>
<div id="captcha-composite">
  <img class="background" src="${escapeHtml(challenge.backgroundUri)}">
  ${entities}
</div>
</body>
</html>`;
}

function computeFrame(challenge: HcaptchaDragDropChallenge) {
  let width = 0;
  let height = 0;
  for (const entity of challenge.entities) {
    width = Math.max(width, entity.coords[0] + entity.size[0]);
    height = Math.max(height, entity.coords[1] + entity.size[1]);
  }
  return {
    width,
    height,
    backgroundWidth: Math.min(...challenge.entities.map((entity) => entity.coords[0]))
  };
}

function createEntityHtml(entity: Required<HcaptchaEntity>): string {
  return `<img class="entity" src="${escapeHtml(entity.entity_uri)}" style="left:${entity.coords[0]}px;top:${entity.coords[1]}px;width:${entity.size[0]}px;height:${entity.size[1]}px;">`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
