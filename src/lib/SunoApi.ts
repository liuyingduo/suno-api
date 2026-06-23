import axios, { AxiosInstance } from 'axios';
import pino from 'pino';
import { sleep } from '@/lib/utils';
import * as cookie from 'cookie';
import { randomUUID } from 'node:crypto';
import { ensureLoaded, getAccountById, pickAccount, updateAccountCookie } from '@/lib/accountStore';
import { recordRequest } from '@/lib/requestMonitor';
import { SunoCaptchaSolver } from '@/lib/sunoCaptchaSolver';
import { createBrowserUserAgent } from '@/lib/browserFingerprint';

// sunoApi instance caching
const globalForSunoApi = global as unknown as { sunoApiCache?: Map<string, SunoApi> };
export const cache = globalForSunoApi.sunoApiCache || new Map<string, SunoApi>();
globalForSunoApi.sunoApiCache = cache;

const logger = pino();
export const DEFAULT_MODEL = 'chirp-auk-turbo';
export const DEFAULT_SOUND_MODEL = 'chirp-fenix';

export interface AudioInfo {
  id: string; // Unique identifier for the audio
  title?: string; // Title of the audio
  image_url?: string; // URL of the image associated with the audio
  lyric?: string; // Lyrics of the audio
  audio_url?: string; // URL of the audio file
  video_url?: string; // URL of the video associated with the audio
  created_at: string; // Date and time when the audio was created
  model_name: string; // Name of the model used for audio generation
  gpt_description_prompt?: string; // Prompt for GPT description
  prompt?: string; // Prompt for audio generation
  status: string; // Status
  type?: string;
  tags?: string; // Genre of music.
  negative_tags?: string; // Negative tags of music.
  duration?: string; // Duration of the audio
  error_message?: string; // Error message if any
}

export interface SunoControlSliders {
  weirdness_constraint?: number;
  style_weight?: number;
}

export interface SunoSoundConfigs {
  user_tempo?: number;
  user_key?: string;
  user_loop?: boolean;
}

export interface SunoGenerateMetadata {
  web_client_pathname?: string;
  is_max_mode?: boolean;
  is_mumble?: boolean;
  is_remix?: boolean;
  create_mode?: string;
  user_tier?: string;
  create_session_token?: string;
  disable_volume_normalization?: boolean;
  control_sliders?: SunoControlSliders;
  sound_configs?: SunoSoundConfigs;
  vocal_gender?: string;
  lyrics_model?: string;
}

export interface SunoGenerateOptions {
  task?: string;
  generation_type?: string;
  gpt_description_prompt?: string;
  user_uploaded_images_b64?: string[] | string | null;
  override_fields?: string[];
  cover_clip_id?: string | null;
  cover_start_s?: number | null;
  cover_end_s?: number | null;
  persona_id?: string | null;
  artist_clip_id?: string | null;
  artist_start_s?: number | null;
  artist_end_s?: number | null;
  continue_clip_id?: string | null;
  continued_aligned_prompt?: string | null;
  continue_at?: number | null;
  transaction_uuid?: string;
  token_provider?: number | null;
  metadata?: SunoGenerateMetadata;
}

export interface SunoUploadAudioRequest {
  extension: string;
  upload_type?: string;
}

export interface SunoUploadAudioResponse {
  id: string;
  url: string;
  fields: Record<string, string>;
  is_file_uploaded: boolean;
}

export interface SunoUploadFinishRequest {
  upload_type?: string;
  upload_filename: string;
}

export interface PromptSuggestionsResponse {
  prompts: string[];
  lyrics_prompts: string[];
  tags: string[];
  is_pending_personalization: boolean;
}

export interface PromptUpsampleRequest {
  original_tags: string;
  is_instrumental: boolean;
}

export interface PromptUpsampleResponse {
  upsampled: string;
  request_id: string;
}

const OPTIONAL_METADATA_KEYS: Array<keyof SunoGenerateMetadata> = [
  'web_client_pathname',
  'is_max_mode',
  'is_mumble',
  'is_remix',
  'create_mode',
  'user_tier',
  'create_session_token',
  'disable_volume_normalization',
  'control_sliders',
  'sound_configs',
  'vocal_gender',
  'lyrics_model'
];

const OPTIONAL_GENERATE_KEYS: Array<keyof SunoGenerateOptions> = [
  'task',
  'generation_type',
  'gpt_description_prompt',
  'user_uploaded_images_b64',
  'override_fields',
  'cover_clip_id',
  'cover_start_s',
  'cover_end_s',
  'persona_id',
  'artist_clip_id',
  'artist_start_s',
  'artist_end_s',
  'continue_clip_id',
  'continued_aligned_prompt',
  'continue_at',
  'transaction_uuid',
  'token_provider'
];

function mergeDefinedMetadata(
  target: Record<string, unknown>,
  source?: SunoGenerateMetadata
) {
  if (!source) {
    return;
  }

  for (const key of OPTIONAL_METADATA_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

function mergeDefinedGenerateOptions(
  target: Record<string, unknown>,
  source?: SunoGenerateOptions
) {
  if (!source) {
    return;
  }

  for (const key of OPTIONAL_GENERATE_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

interface PersonaResponse {
  persona: {
    id: string;
    name: string;
    description: string;
    image_s3_id: string;
    root_clip_id: string;
    clip: any; // You can define a more specific type if needed
    user_display_name: string;
    user_handle: string;
    user_image_url: string;
    persona_clips: Array<{
      clip: any; // You can define a more specific type if needed
    }>;
    is_suno_persona: boolean;
    is_trashed: boolean;
    is_owned: boolean;
    is_public: boolean;
    is_public_approved: boolean;
    is_loved: boolean;
    upvote_count: number;
    clip_count: number;
  };
  total_results: number;
  current_page: number;
  is_following: boolean;
}

class SunoApi {
  private static BASE_URL: string = 'https://studio-api-prod.suno.com';
  private static CLERK_BASE_URL: string = 'https://auth.suno.com';
  private static CLERK_VERSION = '5.117.0';

  private readonly client: AxiosInstance;
  private sid?: string;
  private currentToken?: string;
  private deviceId?: string;
  private userAgent?: string;
  private cookies: Record<string, string | undefined>;
  private accountId?: string;

  constructor(cookies: string, accountId?: string) {
    this.accountId = accountId;
    this.userAgent = createBrowserUserAgent();
    this.cookies = cookie.parse(cookies);
    this.deviceId = this.cookies.ajs_anonymous_id || randomUUID();
    this.client = axios.create({
      withCredentials: true,
      headers: {
        'Affiliate-Id': 'undefined',
        'Device-Id': `"${this.deviceId}"`,
        'x-suno-client': 'Android prerelease-4nt180t 1.0.42',
        'X-Requested-With': 'com.suno.android',
        'sec-ch-ua': '"Chromium";v="130", "Android WebView";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'User-Agent': this.userAgent
      }
    });
    this.client.interceptors.request.use(config => {
      if (this.currentToken && !config.headers.Authorization && !this.isClerkRequest(config.url))
        config.headers.Authorization = `Bearer ${this.currentToken}`;
      config.headers.Cookie = this.serializeCookies();
      return config;
    });
    this.client.interceptors.response.use(async resp => {
      const setCookieHeader = resp.headers['set-cookie'];
      if (Array.isArray(setCookieHeader)) {
        const changed = this.mergeSetCookies(setCookieHeader);
        if (changed && this.accountId && this.isClerkClientRequest(resp.config.url)) {
          await updateAccountCookie(this.accountId, this.serializeCookies());
        }
      }
      return resp;
    })
  }

  public async init(): Promise<SunoApi> {
    //await this.getClerkLatestVersion();
    await this.refreshAuth();
    await this.keepAlive();
    return this;
  }

  /**
   * Get the clerk package latest version id.
   * This method is commented because we are now using a hard-coded Clerk version, hence this method is not needed.
   
  private async getClerkLatestVersion() {
    // URL to get clerk version ID
    const getClerkVersionUrl = `${SunoApi.JSDELIVR_BASE_URL}/v1/package/npm/@clerk/clerk-js`;
    // Get clerk version ID
    const versionListResponse = await this.client.get(getClerkVersionUrl);
    if (!versionListResponse?.data?.['tags']['latest']) {
      throw new Error(
        'Failed to get clerk version info, Please try again later'
      );
    }
    // Save clerk version ID for auth
    SunoApi.clerkVersion = versionListResponse?.data?.['tags']['latest'];
  }
  */

  /**
   * Get the session ID and save it for later use.
   */
  public async refreshAuth() {
    logger.info('Getting the session ID');
    const getSessionUrl = this.buildClerkUrl('/v1/client');
    const sessionResponse = await this.client.get(getSessionUrl, {
      headers: { Authorization: this.cookies.__client }
    });
    if (!sessionResponse?.data?.response?.last_active_session_id) {
      throw new Error(
        'Failed to get session id, you may need to update the SUNO_COOKIE'
      );
    }
    const sessionId = sessionResponse.data.response.last_active_session_id;
    this.sid = sessionId;
    this.currentToken = this.extractSessionJwt(sessionResponse.data, sessionId);
    if (!this.currentToken) {
      throw new Error('Failed to get auth token, you may need to update the SUNO_COOKIE');
    }
    logger.info('Initial token extracted from /v1/client response');
  }

  /**
   * Keep the session alive.
   * @param isWait Indicates if the method should wait for the session to be fully renewed before returning.
   */
  public async keepAlive(isWait?: boolean): Promise<void> {
    if (!this.sid) {
      throw new Error('Session ID is not set. Cannot renew token.');
    }
    logger.info('KeepAlive...\n');
    const touchUrl = this.buildClerkUrl(`/v1/client/sessions/${this.sid}/touch`);
    const touchResponse = await this.client.post(touchUrl, undefined, {
      headers: {
        accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://suno.com',
        referer: 'https://suno.com/'
      }
    });
    const newToken = this.extractSessionJwt(touchResponse.data, this.sid);
    if (!newToken) {
      throw new Error('Failed to refresh token');
    }
    if (isWait) {
      await sleep(1, 2);
    }
    // Update Authorization field in request header with the new JWT token
    this.currentToken = newToken;
  }

  private buildClerkUrl(pathname: string): string {
    const url = new URL(pathname, SunoApi.CLERK_BASE_URL);
    url.searchParams.set('__clerk_api_version', '2025-11-10');
    url.searchParams.set('_clerk_js_version', SunoApi.CLERK_VERSION);
    return url.toString();
  }

  private serializeCookies(): string {
    return Object.entries(this.cookies)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => cookie.serialize(key, value as string))
      .join('; ');
  }

  private mergeSetCookies(setCookieHeaders: string[]): boolean {
    let changed = false;
    for (const header of setCookieHeaders) {
      const pair = this.parseSetCookiePair(header);
      if (!pair) continue;
      if (this.cookies[pair.name] !== pair.value) {
        this.cookies[pair.name] = pair.value;
        changed = true;
      }
    }
    return changed;
  }

  private parseSetCookiePair(setCookieHeader: string): { name: string; value: string } | undefined {
    const firstPart = setCookieHeader.split(';', 1)[0];
    const separatorIndex = firstPart.indexOf('=');
    if (separatorIndex <= 0) {
      return undefined;
    }
    return {
      name: firstPart.slice(0, separatorIndex),
      value: firstPart.slice(separatorIndex + 1)
    };
  }

  private isClerkRequest(url?: string): boolean {
    return Boolean(url?.startsWith(SunoApi.CLERK_BASE_URL));
  }

  private isClerkClientRequest(url?: string): boolean {
    if (!url?.startsWith(SunoApi.CLERK_BASE_URL)) {
      return false;
    }
    return new URL(url).pathname === '/v1/client';
  }

  private extractSessionJwt(data: any, sessionId: string): string | undefined {
    const activeSession = data?.response?.id === sessionId
      ? data.response
      : this.findSessionById(data?.response?.sessions ?? data?.client?.sessions, sessionId);
    return activeSession?.last_active_token?.jwt;
  }

  private findSessionById(sessions: any, sessionId: string): any {
    if (!Array.isArray(sessions)) {
      return undefined;
    }
    return sessions.find((session: any) => session?.id === sessionId);
  }

  /**
   * Get the session token (not to be confused with session ID) and save it for later use.
   */
  private async getSessionToken() {
    const tokenResponse = await this.client.post(
      `${SunoApi.BASE_URL}/api/user/create_session_id/`,
      {
        session_properties: JSON.stringify({ deviceId: this.deviceId }),
        session_type: 1
      }
    );
    return tokenResponse.data.session_id;
  }

  private async getCaptchaToken(browserToken: string): Promise<string | null> {
    try {
      const checkResp = await this.client.post(
        `${SunoApi.BASE_URL}/api/c/check`,
        { ctype: 'generation' },
        { headers: { 'browser-token': browserToken } }
      );
      const checkToken = checkResp.data?.token ?? null;
      if (checkToken) {
        logger.info('Pre-check captcha token: ' + checkToken);
        return checkToken;
      }
      if (!checkResp.data?.required) {
        return null;
      }
    } catch {
      logger.warn('Pre-check failed, trying browser captcha flow');
    }

    const solver = new SunoCaptchaSolver({
      cookies: this.cookies,
      userAgent: this.userAgent as string,
      currentToken: this.currentToken
    });
    const result = await solver.solve();
    if (result.authorizationToken) {
      this.currentToken = result.authorizationToken;
    }
    return result.token;
  }

  private createBrowserToken(): string {
    const payload = Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64');
    return JSON.stringify({ token: payload });
  }

  private async requestRawSuno(
    action: string,
    method: 'GET' | 'POST',
    pathname: string,
    data?: object
  ): Promise<object> {
    await this.keepAlive(false);
    const startTime = Date.now();
    try {
      const response = await this.client.request({
        method,
        url: `${SunoApi.BASE_URL}${pathname}`,
        data,
        timeout: 10000,
        headers: { 'browser-token': this.createBrowserToken() }
      });
      await recordRequest(action, this.accountId, true, Date.now() - startTime);
      return response.data;
    } catch (e: any) {
      await recordRequest(action, this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  public async createAudioUpload(
    request: SunoUploadAudioRequest
  ): Promise<SunoUploadAudioResponse> {
    await this.keepAlive(false);
    const startTime = Date.now();
    try {
      const response = await this.client.post(
        `${SunoApi.BASE_URL}/api/uploads/audio/`,
        {
          extension: request.extension,
          upload_type: request.upload_type || 'file_upload'
        },
        {
          timeout: 10000,
          headers: { 'browser-token': this.createBrowserToken() }
        }
      );
      await recordRequest('create_audio_upload', this.accountId, true, Date.now() - startTime);
      return response.data;
    } catch (e: any) {
      await recordRequest('create_audio_upload', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  public async finishAudioUpload(
    uploadId: string,
    request: SunoUploadFinishRequest
  ): Promise<object> {
    await this.keepAlive(false);
    const startTime = Date.now();
    try {
      const response = await this.client.post(
        `${SunoApi.BASE_URL}/api/uploads/audio/${uploadId}/upload-finish/`,
        {
          upload_type: request.upload_type || 'file_upload',
          upload_filename: request.upload_filename
        },
        {
          timeout: 10000,
          headers: { 'browser-token': this.createBrowserToken() }
        }
      );
      await recordRequest('finish_audio_upload', this.accountId, true, Date.now() - startTime);
      return response.data;
    } catch (e: any) {
      await recordRequest('finish_audio_upload', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  public async getAudioUpload(uploadId: string): Promise<object> {
    return this.requestRawSuno('get_audio_upload', 'GET', `/api/uploads/audio/${uploadId}/`);
  }

  public async initializeUploadClip(uploadId: string, body: object): Promise<object> {
    return this.requestRawSuno(
      'initialize_upload_clip',
      'POST',
      `/api/uploads/audio/${uploadId}/initialize-clip/`,
      body
    );
  }

  public async setClipMetadata(clipId: string, body: object): Promise<object> {
    return this.requestRawSuno(
      'set_clip_metadata',
      'POST',
      `/api/gen/${clipId}/set_metadata/`,
      body
    );
  }

  public async setAudioDescription(clipId: string, body: object): Promise<object> {
    return this.requestRawSuno(
      'set_audio_description',
      'POST',
      `/api/gen/${clipId}/set_audio_description`,
      body
    );
  }

  public async getWaveformAggregates(clipId: string): Promise<object> {
    return this.requestRawSuno(
      'get_waveform_aggregates',
      'GET',
      `/api/gen/${clipId}/waveform-aggregates`
    );
  }

  public async getPromptSuggestions(): Promise<PromptSuggestionsResponse> {
    return this.requestRawSuno(
      'get_prompt_suggestions',
      'GET',
      '/api/prompts/suggestions'
    ) as Promise<PromptSuggestionsResponse>;
  }

  public async upsamplePrompt(
    request: PromptUpsampleRequest
  ): Promise<PromptUpsampleResponse> {
    return this.requestRawSuno(
      'upsample_prompt',
      'POST',
      '/api/prompts/upsample',
      request
    ) as Promise<PromptUpsampleResponse>;
  }

  /**
   * Generate a song based on the prompt.
   * @param prompt The text prompt to generate audio from.
   * @param make_instrumental Indicates if the generated audio should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @returns
   */
  public async generate(
    prompt: string,
    make_instrumental: boolean = false,
    model?: string,
    wait_audio: boolean = false,
    options?: SunoGenerateOptions,
    custom?: {
      tags?: string;
      title?: string;
      negative_tags?: string;
    }
  ): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const startTime = Date.now();
    try {
      const isCustom = custom !== undefined;
      const audios = await this.generateSongs(
        prompt,
        isCustom,
        custom?.tags,
        custom?.title,
        make_instrumental,
        model,
        wait_audio,
        custom?.negative_tags,
        options?.task,
        undefined,
        undefined,
        options
      );
      const costTime = Date.now() - startTime;
      logger.info('Generate Response:\n' + JSON.stringify(audios, null, 2));
      logger.info('Cost time: ' + costTime);
      await recordRequest('generate', this.accountId, true, costTime);
      return audios;
    } catch (e: any) {
      await recordRequest('generate', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  /**
   * Calls the concatenate endpoint for a clip to generate the whole song.
   * @param clip_id The ID of the audio clip to concatenate.
   * @returns A promise that resolves to an AudioInfo object representing the concatenated audio.
   * @throws Error if the response status is not 200.
   */
  public async concatenate(clip_id: string): Promise<AudioInfo> {
    await this.keepAlive(false);
    const payload: any = { clip_id: clip_id };
    const startTime = Date.now();
    try {
      const response = await this.client.post(
        `${SunoApi.BASE_URL}/api/generate/concat/v2/`,
        payload,
        {
          timeout: 10000 // 10 seconds timeout
        }
      );
      if (response.status !== 200) {
        throw new Error('Error response:' + response.statusText);
      }
      await recordRequest('concatenate', this.accountId, true, Date.now() - startTime);
      return response.data;
    } catch (e: any) {
      await recordRequest('concatenate', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  /**
   * Generates custom audio based on provided parameters.
   *
   * @param prompt The text prompt to generate audio from.
   * @param tags Tags to categorize the generated audio.
   * @param title The title for the generated audio.
   * @param make_instrumental Indicates if the generated audio should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @param negative_tags Negative tags that should not be included in the generated audio.
   * @returns A promise that resolves to an array of AudioInfo objects representing the generated audios.
   */
  public async custom_generate(
    prompt: string,
    tags: string,
    title: string,
    make_instrumental: boolean = false,
    model?: string,
    wait_audio: boolean = false,
    negative_tags?: string,
    options?: SunoGenerateOptions
  ): Promise<AudioInfo[]> {
    const startTime = Date.now();
    try {
      const audios = await this.generateSongs(
        prompt,
        true,
        tags,
        title,
        make_instrumental,
        model,
        wait_audio,
        negative_tags,
        options?.task,
        undefined,
        undefined,
        options
      );
      const costTime = Date.now() - startTime;
      logger.info(
        'Custom Generate Response:\n' + JSON.stringify(audios, null, 2)
      );
      logger.info('Cost time: ' + costTime);
      await recordRequest('custom_generate', this.accountId, true, costTime);
      return audios;
    } catch (e: any) {
      await recordRequest('custom_generate', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  public async cover_generate(
    prompt: string,
    title: string,
    make_instrumental: boolean = false,
    model?: string,
    wait_audio: boolean = false,
    options?: SunoGenerateOptions
  ): Promise<AudioInfo[]> {
    const startTime = Date.now();
    try {
      const audios = await this.generateSongs(
        prompt,
        true,
        undefined,
        title,
        make_instrumental,
        model,
        wait_audio,
        undefined,
        options?.task,
        undefined,
        undefined,
        options
      );
      const costTime = Date.now() - startTime;
      logger.info('Cover Generate Response:\n' + JSON.stringify(audios, null, 2));
      logger.info('Cost time: ' + costTime);
      await recordRequest('cover_generate', this.accountId, true, costTime);
      return audios;
    } catch (e: any) {
      await recordRequest('cover_generate', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  /**
   * Generates songs based on the provided parameters.
   *
   * @param prompt The text prompt to generate songs from.
   * @param isCustom Indicates if the generation should consider custom parameters like tags and title.
   * @param tags Optional tags to categorize the song, used only if isCustom is true.
   * @param title Optional title for the song, used only if isCustom is true.
   * @param make_instrumental Indicates if the generated song should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @param negative_tags Negative tags that should not be included in the generated audio.
   * @param task Optional indication of what to do. Enter 'extend' if extending an audio, otherwise specify null.
   * @param continue_clip_id 
   * @returns A promise that resolves to an array of AudioInfo objects representing the generated songs.
   */
  private async generateSongs(
    prompt: string,
    isCustom: boolean,
    tags?: string,
    title?: string,
    make_instrumental?: boolean,
    model?: string,
    wait_audio: boolean = false,
    negative_tags?: string,
    task?: string,
    continue_clip_id?: string,
    continue_at?: number,
    options?: SunoGenerateOptions
  ): Promise<AudioInfo[]> {
    await this.keepAlive();
    const browserToken = this.createBrowserToken();
    const captchaToken = await this.getCaptchaToken(browserToken);
    const payload: any = {
      make_instrumental: make_instrumental,
      mv: model || DEFAULT_MODEL,
      prompt: '',
      generation_type: options?.generation_type || 'TEXT',
      continue_at: continue_at,
      continue_clip_id: continue_clip_id,
      continued_aligned_prompt: null,
      task: task,
      token: captchaToken,
      token_provider: null,
      transaction_uuid: randomUUID(),
      user_uploaded_images_b64: null,
      cover_clip_id: null,
      cover_start_s: null,
      cover_end_s: null,
      persona_id: null,
      artist_clip_id: null,
      artist_start_s: null,
      artist_end_s: null,
      override_fields: [],
      metadata: {
        web_client_pathname: '/create',
        is_max_mode: false,
        create_mode: isCustom ? 'custom' : 'simple',
        disable_volume_normalization: false,
        lyrics_model: 'default'
      }
    };
    mergeDefinedGenerateOptions(payload, options);
    mergeDefinedMetadata(payload.metadata, options?.metadata);
    if (isCustom) {
      if (tags !== undefined) {
        payload.tags = tags;
      }
      if (title !== undefined) {
        payload.title = title;
      }
      if (negative_tags !== undefined) {
        payload.negative_tags = negative_tags;
      }
      payload.prompt = prompt;
      if (options?.gpt_description_prompt !== undefined) {
        payload.gpt_description_prompt = options.gpt_description_prompt;
      }
    } else if (
      options?.gpt_description_prompt === undefined &&
      prompt !== ''
    ) {
      payload.gpt_description_prompt = prompt;
    }
    logger.info(
      'generateSongs payload:\n' +
        JSON.stringify(
          {
            prompt: prompt,
            isCustom: isCustom,
            tags: tags,
            title: title,
            make_instrumental: make_instrumental,
            wait_audio: wait_audio,
            negative_tags: negative_tags,
            payload: payload
          },
          null,
          2
        )
    );
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/generate/v2-web/`,
      payload,
      {
        timeout: 10000, // 10 seconds timeout
        headers: { 'browser-token': browserToken }
      }
    );
    if (response.status !== 200) {
      throw new Error('Error response:' + response.statusText);
    }
    const songIds = response.data.clips.map((audio: any) => audio.id);
    //Want to wait for music file generation
    if (wait_audio) {
      const startTime = Date.now();
      let lastResponse: AudioInfo[] = [];
      await sleep(5, 5);
      while (Date.now() - startTime < 100000) {
        const response = await this.get(songIds);
        const allCompleted = response.every(
          (audio) => audio.status === 'streaming' || audio.status === 'complete'
        );
        const allError = response.every((audio) => audio.status === 'error');
        if (allCompleted || allError) {
          return response;
        }
        lastResponse = response;
        await sleep(3, 6);
        await this.keepAlive(true);
      }
      return lastResponse;
    } else {
      return response.data.clips.map((audio: any) => ({
        id: audio.id,
        title: audio.title,
        image_url: audio.image_url,
        lyric: audio.metadata.prompt,
        audio_url: audio.audio_url,
        video_url: audio.video_url,
        created_at: audio.created_at,
        model_name: audio.model_name,
        status: audio.status,
        gpt_description_prompt: audio.metadata.gpt_description_prompt,
        prompt: audio.metadata.prompt,
        type: audio.metadata.type,
        tags: audio.metadata.tags,
        negative_tags: audio.metadata.negative_tags,
        duration: audio.metadata.duration
      }));
    }
  }

  /**
   * Generates lyrics based on a given prompt.
   * @param prompt The prompt for generating lyrics.
   * @returns The generated lyrics text.
   */
  public async generateLyrics(prompt: string): Promise<string> {
    await this.keepAlive(false);
    const startTime = Date.now();
    try {
      // Initiate lyrics generation
      const generateResponse = await this.client.post(
        `${SunoApi.BASE_URL}/api/generate/lyrics/`,
        { prompt }
      );
      const generateId = generateResponse.data.id;

      // Poll for lyrics completion
      let lyricsResponse = await this.client.get(
        `${SunoApi.BASE_URL}/api/generate/lyrics/${generateId}`
      );
      while (lyricsResponse?.data?.status !== 'complete') {
        await sleep(2); // Wait for 2 seconds before polling again
        lyricsResponse = await this.client.get(
          `${SunoApi.BASE_URL}/api/generate/lyrics/${generateId}`
        );
      }

      await recordRequest('generate_lyrics', this.accountId, true, Date.now() - startTime);
      // Return the generated lyrics text
      return lyricsResponse.data;
    } catch (e: any) {
      await recordRequest('generate_lyrics', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  /**
   * Extends an existing audio clip by generating additional content based on the provided prompt.
   *
   * @param audioId The ID of the audio clip to extend.
   * @param prompt The prompt for generating additional content.
   * @param continueAt Extend a new clip from a song at mm:ss(e.g. 00:30). Default extends from the end of the song.
   * @param tags Style of Music.
   * @param title Title of the song.
   * @returns A promise that resolves to an AudioInfo object representing the extended audio clip.
   */
  public async extendAudio(
    audioId: string,
    prompt: string = '',
    continueAt: number,
    tags: string = '',
    negative_tags: string = '',
    title: string = '',
    model?: string,
    wait_audio?: boolean,
    options?: SunoGenerateOptions
  ): Promise<AudioInfo[]> {
    const startTime = Date.now();
    try {
      const result = await this.generateSongs(prompt, true, tags, title, false, model, wait_audio, negative_tags, 'extend', audioId, continueAt, options);
      await recordRequest('extend_audio', this.accountId, true, Date.now() - startTime);
      return result;
    } catch (e: any) {
      await recordRequest('extend_audio', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  /**
   * Generate stems for a song.
   * @param song_id The ID of the song to generate stems for.
   * @returns A promise that resolves to an AudioInfo object representing the generated stems.
   */
  public async generateStems(song_id: string): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const startTime = Date.now();
    try {
      const response = await this.client.post(
        `${SunoApi.BASE_URL}/api/edit/stems/${song_id}`, {}
      );
      console.log('generateStems response:\n', response?.data);
      const result = response.data.clips.map((clip: any) => ({
        id: clip.id,
        status: clip.status,
        created_at: clip.created_at,
        title: clip.title,
        stem_from_id: clip.metadata.stem_from_id,
        duration: clip.metadata.duration
      }));
      await recordRequest('generate_stems', this.accountId, true, Date.now() - startTime);
      return result;
    } catch (e: any) {
      await recordRequest('generate_stems', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }


  /**
   * Get the lyric alignment for a song.
   * @param song_id The ID of the song to get the lyric alignment for.
   * @returns A promise that resolves to an object containing the lyric alignment.
   */
  public async getLyricAlignment(song_id: string): Promise<object> {
    await this.keepAlive(false);
    const startTime = Date.now();
    try {
      const response = await this.client.get(`${SunoApi.BASE_URL}/api/gen/${song_id}/aligned_lyrics/v2/`);
      console.log(`getLyricAlignment ~ response:`, response.data);
      const result = response.data?.aligned_words.map((transcribedWord: any) => ({
        word: transcribedWord.word,
        start_s: transcribedWord.start_s,
        end_s: transcribedWord.end_s,
        success: transcribedWord.success,
        p_align: transcribedWord.p_align
      }));
      await recordRequest('get_aligned_lyrics', this.accountId, true, Date.now() - startTime);
      return result;
    } catch (e: any) {
      await recordRequest('get_aligned_lyrics', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  /**
   * Processes the lyrics (prompt) from the audio metadata into a more readable format.
   * @param prompt The original lyrics text.
   * @returns The processed lyrics text.
   */
  private parseLyrics(prompt: string): string {
    // Assuming the original lyrics are separated by a specific delimiter (e.g., newline), we can convert it into a more readable format.
    // The implementation here can be adjusted according to the actual lyrics format.
    // For example, if the lyrics exist as continuous text, it might be necessary to split them based on specific markers (such as periods, commas, etc.).
    // The following implementation assumes that the lyrics are already separated by newlines.

    // Split the lyrics using newline and ensure to remove empty lines.
    const lines = prompt.split('\n').filter((line) => line.trim() !== '');

    // Reassemble the processed lyrics lines into a single string, separated by newlines between each line.
    // Additional formatting logic can be added here, such as adding specific markers or handling special lines.
    return lines.join('\n');
  }

  /**
   * Retrieves audio information for the given song IDs.
   * @param songIds An optional array of song IDs to retrieve information for.
   * @param page An optional page number to retrieve audio information from.
   * @returns A promise that resolves to an array of AudioInfo objects.
   */
  public async get(
    songIds?: string[],
    page?: string | null
  ): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const browserToken = JSON.stringify({ token: Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64') });
    const url = `${SunoApi.BASE_URL}/api/feed/v3`;
    const body: any = {};
    if (songIds && songIds.length > 0) {
      body.filters = { ids: { presence: 'True', clipIds: songIds } };
      body.limit = songIds.length;
    } else if (page) {
      body.page = page;
    }
    logger.info('Get audio status: ' + url + ' body: ' + JSON.stringify(body));
    const _getStartTime = Date.now();
    let _getResponse: any;
    try {
      _getResponse = await this.client.post(url, body, {
        timeout: 10000,
        headers: { 'browser-token': browserToken }
      });
    } catch (e: any) {
      await recordRequest('get', this.accountId, false, Date.now() - _getStartTime, e?.message);
      throw e;
    }
    await recordRequest('get', this.accountId, true, Date.now() - _getStartTime);
    const response = _getResponse;
    const audios = response.data.clips;

    return audios.map((audio: any) => ({
      id: audio.id,
      title: audio.title,
      image_url: audio.image_url,
      lyric: audio.metadata.prompt
        ? this.parseLyrics(audio.metadata.prompt)
        : '',
      audio_url: audio.audio_url,
      video_url: audio.video_url,
      created_at: audio.created_at,
      model_name: audio.model_name,
      status: audio.status,
      gpt_description_prompt: audio.metadata.gpt_description_prompt,
      prompt: audio.metadata.prompt,
      type: audio.metadata.type,
      tags: audio.metadata.tags,
      duration: audio.metadata.duration,
      error_message: audio.metadata.error_message
    }));
  }

  /**
   * Retrieves information for a specific audio clip.
   * @param clipId The ID of the audio clip to retrieve information for.
   * @returns A promise that resolves to an object containing the audio clip information.
   */
  public async getClip(clipId: string): Promise<object> {
    await this.keepAlive(false);
    const startTime = Date.now();
    try {
      const response = await this.client.get(
        `${SunoApi.BASE_URL}/api/clip/${clipId}`
      );
      await recordRequest('get_clip', this.accountId, true, Date.now() - startTime);
      return response.data;
    } catch (e: any) {
      await recordRequest('get_clip', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  public async get_credits(): Promise<object> {
    await this.keepAlive(false);
    const startTime = Date.now();
    try {
      const response = await this.client.get(
        `${SunoApi.BASE_URL}/api/billing/info/`
      );
      await recordRequest('get_credits', this.accountId, true, Date.now() - startTime);
      return {
        credits_left: response.data.total_credits_left,
        period: response.data.period,
        monthly_limit: response.data.monthly_limit,
        monthly_usage: response.data.monthly_usage
      };
    } catch (e: any) {
      await recordRequest('get_credits', this.accountId, false, Date.now() - startTime, e?.message);
      throw e;
    }
  }

  public async getModels(): Promise<any[]> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/billing/info/`
    );
    return response.data.models ?? [];
  }

  public async getPersonaPaginated(personaId: string, page: number = 1): Promise<PersonaResponse> {
    await this.keepAlive(false);
    
    const url = `${SunoApi.BASE_URL}/api/persona/get-persona-paginated/${personaId}/?page=${page}`;
    
    logger.info(`Fetching persona data: ${url}`);
    
    const response = await this.client.get(url, {
      timeout: 10000 // 10 seconds timeout
    });

    if (response.status !== 200) {
      throw new Error('Error response: ' + response.statusText);
    }

    return response.data;
  }
}

export const sunoApi = async (accountId?: string) => {
  await ensureLoaded();
  const account = accountId ? await getAccountById(accountId) : await pickAccount();
  if (!account) {
    throw new Error(
      accountId
        ? `账号 ${accountId} 不存在。`
        : '未配置账号，请先通过管理页面 /admin 或 POST /api/accounts 接口添加账号。'
    );
  }

  const cached = cache.get(account.id);
  if (cached) return cached;

  const instance = await new SunoApi(account.cookie, account.id).init();
  cache.set(account.id, instance);
  return instance;
};
