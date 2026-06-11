import { NextRequest } from "next/server";
import { DEFAULT_SOUND_MODEL, sunoApi, type SunoGenerateOptions } from "@/lib/SunoApi";
import { getSunoGenerateOptions } from "@/lib/sunoGenerateRequest";
import { errorResponse, jsonResponse, optionsResponse } from "@/app/api/sunoProxyResponse";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function getCoverGenerateOptions(body: Record<string, unknown>): SunoGenerateOptions {
  const options = getSunoGenerateOptions(body) ?? {};
  return {
    ...options,
    task: 'cover',
    generation_type: 'SIMPLE_REMIX',
    override_fields: options.override_fields ?? ['prompt'],
    cover_clip_id: options.cover_clip_id ?? String(body.cover_clip_id),
    metadata: {
      ...(options.metadata ?? {}),
      is_remix: true
    }
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      prompt,
      title,
      model,
      wait_audio,
      make_instrumental
    } = body;
    if (!body.cover_clip_id) {
      return jsonResponse({ error: 'cover_clip_id is required' }, 400);
    }

    const audioInfo = await (await sunoApi()).cover_generate(
      prompt,
      title,
      Boolean(make_instrumental),
      model || DEFAULT_SOUND_MODEL,
      Boolean(wait_audio),
      getCoverGenerateOptions(body)
    );

    return jsonResponse(audioInfo);
  } catch (error: any) {
    console.error('Error generating cover:', error);
    return errorResponse(error);
  }
}

export async function OPTIONS() {
  return optionsResponse();
}
