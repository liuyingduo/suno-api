import type {
  SunoGenerateMetadata,
  SunoGenerateOptions
} from '@/lib/SunoApi';

type MetadataKey = keyof SunoGenerateMetadata;
type GenerateOptionKey = keyof Omit<SunoGenerateOptions, 'metadata'>;

const METADATA_KEYS: MetadataKey[] = [
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

const GENERATE_OPTION_KEYS: GenerateOptionKey[] = [
  'task',
  'generation_type',
  'gpt_description_prompt',
  'override_fields',
  'cover_clip_id',
  'cover_start_s',
  'cover_end_s',
  'persona_id',
  'artist_clip_id',
  'artist_start_s',
  'artist_end_s'
];

function copyDefinedMetadata(
  target: SunoGenerateMetadata,
  source: Record<string, unknown>
) {
  for (const key of METADATA_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = value as never;
    }
  }
}

export function getSunoGenerateOptions(
  body: Record<string, unknown>
): SunoGenerateOptions | undefined {
  const metadata: SunoGenerateMetadata = {};
  const options: SunoGenerateOptions = {};
  const requestMetadata = body.metadata;

  if (requestMetadata && typeof requestMetadata === 'object') {
    copyDefinedMetadata(metadata, requestMetadata as Record<string, unknown>);
  }

  copyDefinedMetadata(metadata, body);

  for (const key of GENERATE_OPTION_KEYS) {
    const value = body[key];
    if (value !== undefined) {
      options[key] = value as never;
    }
  }

  if (Object.keys(metadata).length > 0) {
    options.metadata = metadata;
  }

  if (Object.keys(options).length === 0) {
    return undefined;
  }

  return options;
}
