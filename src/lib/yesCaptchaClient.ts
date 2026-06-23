import axios, { AxiosInstance } from 'axios';
import pino from 'pino';

const CREATE_TASK_URL = 'https://api.yescaptcha.com/createTask';
const GET_TASK_RESULT_URL = 'https://api.yescaptcha.com/getTaskResult';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 3_000;
const logger = pino();

export interface YesCaptchaPoint {
  x: number;
  y: number;
}

export type YesCaptchaAction =
  | { type: 'click'; point: YesCaptchaPoint }
  | { type: 'clickTile'; index: number }
  | { type: 'drag'; start: YesCaptchaPoint; end: YesCaptchaPoint };

interface CreateTaskResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  taskId?: string;
  status?: 'processing' | 'ready';
  solution?: YesCaptchaSolution;
}

interface TaskResultResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  status?: 'processing' | 'ready';
  solution?: YesCaptchaSolution;
}

interface YesCaptchaDragBox {
  start: [number, number];
  end: [number, number];
}

interface YesCaptchaSolution {
  type?: string;
  box?: Array<string | number | YesCaptchaDragBox>;
  objects?: Array<boolean | number>;
  top_k?: number[];
  coordinates?: YesCaptchaPoint[];
  pointJson?: YesCaptchaPoint[];
  gRecaptchaResponse?: string;
  token?: string;
}

export class YesCaptchaClient {
  private readonly client: AxiosInstance;

  constructor(private readonly clientKey: string) {
    if (!clientKey) {
      throw new Error('YESCAPTCHA_KEY is required to solve hCaptcha');
    }
    this.client = axios.create({ timeout: 30_000 });
  }

  public async solveHcaptchaByImages(
    queries: string[],
    question: string
  ): Promise<YesCaptchaAction[]> {
    logger.info(
      `YesCaptchaClient: creating HCaptchaClassification task with ${queries.length} queries, question: ${question}`
    );
    return this.solveHcaptchaClassification({
      type: 'HCaptchaClassification',
      queries,
      question
    });
  }

  public async solveHcaptchaByScreenshot(
    imageBase64: string,
    question: string
  ): Promise<YesCaptchaAction[]> {
    logger.info(
      `YesCaptchaClient: creating HCaptchaClassification screenshot task, question: ${question}`
    );
    return this.solveHcaptchaClassification({
      type: 'HCaptchaClassification',
      queries: `data:image/png;base64,${imageBase64}`,
      question
    });
  }

  private async solveHcaptchaClassification(task: Record<string, unknown>): Promise<YesCaptchaAction[]> {
    const created = await this.createTask(task);
    const result = created.status === 'ready' ? created : await this.waitForResult(created.taskId);
    logger.info(`YesCaptchaClient: HCaptchaClassification solution ${JSON.stringify(result.solution)}`);
    const actions = this.extractActions(result.solution);
    if (actions.length === 0) {
      throw new Error('YesCaptcha returned no hCaptcha actions');
    }
    return actions;
  }

  private async createTask(task: Record<string, unknown>): Promise<CreateTaskResponse> {
    const response = await this.client.post<CreateTaskResponse>(CREATE_TASK_URL, {
      clientKey: this.clientKey,
      task
    });
    this.assertSuccess(response.data);
    if (response.data.status !== 'ready' && !response.data.taskId) {
      throw new Error('YesCaptcha createTask did not return taskId');
    }
    return response.data;
  }

  private async waitForResult(taskId?: string): Promise<TaskResultResponse> {
    if (!taskId) {
      throw new Error('YesCaptcha taskId is required');
    }
    const startTime = Date.now();
    while (Date.now() - startTime < DEFAULT_TIMEOUT_MS) {
      await this.delay(DEFAULT_INTERVAL_MS);
      const response = await this.client.post<TaskResultResponse>(GET_TASK_RESULT_URL, {
        clientKey: this.clientKey,
        taskId
      });
      this.assertSuccess(response.data);
      if (response.data.status === 'ready') {
        return response.data;
      }
    }
    throw new Error(`YesCaptcha task timed out: ${taskId}`);
  }

  private extractActions(solution?: YesCaptchaSolution): YesCaptchaAction[] {
    if (solution?.type === 'drag' && solution.box?.length) {
      return solution.box
        .filter(this.isDragBox)
        .map((box) => ({
          type: 'drag',
          start: this.toPoint(box.start),
          end: this.toPoint(box.end)
        }));
    }

    const boxPoints = this.extractBoxPoints(solution?.box);
    if (boxPoints.length) {
      return boxPoints.map((point) => ({ type: 'click', point }));
    }

    const objectIndexes = this.extractObjectIndexes(solution?.objects);
    if (objectIndexes.length) {
      return objectIndexes.map((index) => ({ type: 'clickTile', index }));
    }

    const rawPoints = solution?.coordinates ?? solution?.pointJson;
    if (rawPoints?.length) {
      return rawPoints.map((point) => ({ type: 'click', point: this.toPoint([point.x, point.y]) }));
    }

    if (solution?.top_k?.length) {
      return solution.top_k.map((index) => ({ type: 'clickTile', index }));
    }
    return [];
  }

  private extractBoxPoints(box?: YesCaptchaSolution['box']): YesCaptchaPoint[] {
    if (!box?.length || typeof box[0] === 'object') {
      return [];
    }
    const points: YesCaptchaPoint[] = [];
    for (let index = 0; index < box.length; index += 2) {
      const x = Number(box[index]);
      const y = Number(box[index + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        points.push({ x, y });
      }
    }
    return points;
  }

  private extractObjectIndexes(objects?: Array<boolean | number>): number[] {
    const indexes: number[] = [];
    if (!objects?.length) {
      return indexes;
    }
    for (let index = 0; index < objects.length; index++) {
      const value = objects[index];
      if (value === true || value === 1) {
        indexes.push(index);
      }
    }
    return indexes;
  }

  private toPoint(value: [number, number]): YesCaptchaPoint {
    return { x: Number(value[0]), y: Number(value[1]) };
  }

  private isDragBox(value: unknown): value is YesCaptchaDragBox {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const box = value as YesCaptchaDragBox;
    return Array.isArray(box.start) && Array.isArray(box.end);
  }

  private assertSuccess(response: { errorId: number; errorCode?: string; errorDescription?: string }) {
    if (response.errorId === 0) {
      return;
    }
    throw new Error(
      `YesCaptcha error ${response.errorCode ?? response.errorId}: ${response.errorDescription ?? 'unknown error'}`
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
