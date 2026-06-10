import { NextResponse, NextRequest } from "next/server";
import { DEFAULT_SOUND_MODEL, sunoApi, type SunoGenerateOptions } from "@/lib/SunoApi";
import { getSunoGenerateOptions } from "@/lib/sunoGenerateRequest";
import { corsHeaders } from "@/lib/utils";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function applySoundConfigs(
  options: SunoGenerateOptions | undefined,
  body: Record<string, unknown>
): SunoGenerateOptions {
  const metadata = { ...(options?.metadata ?? {}) };
  const soundConfigs = {
    ...(metadata.sound_configs ?? {})
  };

  if (body.tempo !== undefined) {
    soundConfigs.user_tempo = Number(body.tempo);
  }
  if (body.user_tempo !== undefined) {
    soundConfigs.user_tempo = Number(body.user_tempo);
  }
  if (body.key !== undefined) {
    soundConfigs.user_key = String(body.key);
  }
  if (body.user_key !== undefined) {
    soundConfigs.user_key = String(body.user_key);
  }
  if (body.loop !== undefined) {
    soundConfigs.user_loop = Boolean(body.loop);
  }
  if (body.user_loop !== undefined) {
    soundConfigs.user_loop = Boolean(body.user_loop);
  }

  return {
    task: 'sound',
    metadata: {
      ...metadata,
      create_mode: 'custom',
      sound_configs: soundConfigs
    }
  };
}

export async function POST(req: NextRequest) {
  if (req.method !== 'POST') {
    return new NextResponse('Method Not Allowed', {
      headers: {
        Allow: 'POST',
        ...corsHeaders
      },
      status: 405
    });
  }

  try {
    const body = await req.json();
    const {
      tags,
      title,
      model,
      wait_audio,
      negative_tags
    } = body;
    const options = applySoundConfigs(getSunoGenerateOptions(body), body);
    const audioInfo = await (await sunoApi()).custom_generate(
      '',
      tags,
      title,
      true,
      model || DEFAULT_SOUND_MODEL,
      Boolean(wait_audio),
      negative_tags,
      options
    );

    return new NextResponse(JSON.stringify(audioInfo), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (error: any) {
    console.error('Error generating sound:', error);
    return new NextResponse(JSON.stringify({
      error: error.response?.data?.detail || error.toString()
    }), {
      status: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders
  });
}
