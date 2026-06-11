import { NextRequest } from "next/server";
import { sunoApi } from "@/lib/SunoApi";
import { getSunoGenerateModeRequest } from "@/lib/sunoGenerateRequest";
import { errorResponse, jsonResponse, optionsResponse } from "@/app/api/sunoProxyResponse";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const request = getSunoGenerateModeRequest(body);
    const audioInfo = await (await sunoApi()).generate(
      request.prompt,
      request.make_instrumental,
      request.model,
      request.wait_audio,
      request.options,
      {
        tags: request.tags,
        title: request.title,
        negative_tags: request.negative_tags
      }
    );

    return jsonResponse(audioInfo);
  } catch (error: any) {
    console.error('Error generating custom audio:', error);
    return errorResponse(error);
  }
}

export async function OPTIONS() {
  return optionsResponse();
}
