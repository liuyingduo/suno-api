import axios, { AxiosInstance } from 'axios';

const CREATE_TASK_URL = 'https://api.yescaptcha.com/createTask';
const GET_TASK_RESULT_URL = 'https://api.yescaptcha.com/getTaskResult';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 3_000;

export interface YesCaptchaPoint {
  x: number;
  y: number;
}

export type YesCaptchaAction =
  | { type: 'click'; point: YesCaptchaPoint }
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

  public async solveHcaptchaByImage(
    imageBase64: string,
    question: string
  ): Promise<YesCaptchaAction[]> {
    const created = await this.createTask({
      type: 'HCaptchaClassification',
      image: imageBase64,
      question
    });
    const result = created.status === 'ready' ? created : await this.waitForResult(created.taskId);
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

    const rawPoints = solution?.coordinates ?? solution?.pointJson;
    if (rawPoints?.length) {
      return rawPoints.map((point) => ({ type: 'click', point: this.toPoint([point.x, point.y]) }));
    }

    if (solution?.top_k?.length) {
      return solution.top_k.map((index) => ({ type: 'click', point: this.indexToGridPoint(index) }));
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

  private indexToGridPoint(index: number): YesCaptchaPoint {
    const col = index % 3;
    const row = Math.floor(index / 3);
    return {
      x: col * 100 + 50,
      y: row * 100 + 50
    };
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
