import { NextResponse } from "next/server";
import { corsHeaders } from "@/lib/utils";

export function jsonResponse(data: unknown, status: number = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}

export function errorResponse(error: any) {
  return jsonResponse(
    { error: error.response?.data?.detail || error.toString() },
    error.response?.status || 500
  );
}

export function optionsResponse() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders
  });
}
