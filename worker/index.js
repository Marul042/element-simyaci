const GROQ_MODELS = new Set([
  "openai/gpt-oss-120b",
  "llama3-70b-8192",
  "llama3-8b-8192"
]);

const GEMINI_MODELS = new Set([
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash"
]);

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_PROMPT_LENGTH = 8000;

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function getRoute(pathname) {
  if (pathname === "/api/groq") return { provider: "groq" };

  const match = pathname.match(/^\/api\/gemini\/([^/]+)$/);
  if (!match) return null;

  try {
    return { provider: "gemini", model: decodeURIComponent(match[1]) };
  } catch (error) {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowedOrigins = (env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
    if (!origin || !allowedOrigins.includes(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const route = getRoute(new URL(request.url).pathname);

    if (request.method === "OPTIONS") {
      return route
        ? new Response(null, { status: 204, headers: corsHeaders })
        : jsonResponse({ error: "Not found" }, 404, corsHeaders);
    }
    if (!route) return jsonResponse({ error: "Not found" }, 404, corsHeaders);
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, { ...corsHeaders, Allow: "POST, OPTIONS" });
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return jsonResponse({ error: "Content-Type must be application/json" }, 415, corsHeaders);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return jsonResponse({ error: "Request is too large" }, 413, corsHeaders);
    }

    const requestText = await request.text();
    if (new TextEncoder().encode(requestText).byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse({ error: "Request is too large" }, 413, corsHeaders);
    }

    let body;
    try {
      body = JSON.parse(requestText);
    } catch (error) {
      return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    let upstreamUrl;
    let upstreamHeaders = { "Content-Type": "application/json" };
    let upstreamBody;

    if (route.provider === "groq") {
      const prompt = body?.messages?.[0]?.content;
      if (!GROQ_MODELS.has(body?.model) || body?.messages?.length !== 1 || body.messages[0]?.role !== "user" ||
          typeof prompt !== "string" || prompt.length > MAX_PROMPT_LENGTH) {
        return jsonResponse({ error: "Invalid Groq request" }, 400, corsHeaders);
      }
      if (!env.GROQ_API_KEY) {
        return jsonResponse({ error: "Groq is not configured" }, 503, corsHeaders);
      }

      upstreamUrl = "https://api.groq.com/openai/v1/chat/completions";
      upstreamHeaders.Authorization = `Bearer ${env.GROQ_API_KEY}`;
      upstreamBody = {
        model: body.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500
      };
    } else {
      const prompt = body?.contents?.[0]?.parts?.[0]?.text;
      if (!GEMINI_MODELS.has(route.model) || body?.contents?.length !== 1 ||
          body.contents[0]?.parts?.length !== 1 || typeof prompt !== "string" || prompt.length > MAX_PROMPT_LENGTH) {
        return jsonResponse({ error: "Invalid Gemini request" }, 400, corsHeaders);
      }
      if (!env.GEMINI_API_KEY) {
        return jsonResponse({ error: "Gemini is not configured" }, 503, corsHeaders);
      }

      upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
      upstreamBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 500 }
      };
    }

    try {
      const upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify(upstreamBody),
        redirect: "error"
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          "Content-Type": upstream.headers.get("Content-Type") || "application/json",
          "Cache-Control": "no-store"
        }
      });
    } catch (error) {
      return jsonResponse({ error: "AI provider request failed" }, 502, corsHeaders);
    }
  }
};
