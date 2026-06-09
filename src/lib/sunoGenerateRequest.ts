import type {
  SunoGenerateMetadata,
  SunoGenerateOptions
} from '@/lib/SunoApi';

type MetadataKey = keyof SunoGenerateMetadata;

const METADATA_KEYS: MetadataKey[] = [
  'web_client_pathname',
  'is_max_mode',
  'is_mumble',
  'user_tier',
  'create_session_token',
  'disable_volume_normalization',
  'control_sliders',
  'vocal_gender',
  'lyrics_model'
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
  const requestMetadata = body.metadata;

  if (requestMetadata && typeof requestMetadata === 'object') {
    copyDefinedMetadata(metadata, requestMetadata as Record<string, unknown>);
  }

  copyDefinedMetadata(metadata, body);

  if (Object.keys(metadata).length === 0) {
    return undefined;
  }

  return { metadata };
}
