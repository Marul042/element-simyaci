const GROQ_MODELS = new Set([
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b"
]);

const GEMINI_MODELS = new Set([
  "gemini-3.8-flash",
  "gemini-2.5-flash"
]);

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_PROMPT_LENGTH = 8000;
const MAX_MESSAGES = 20;

function isValidMessages(messages, allowedRoles) {
  return Array.isArray(messages) && messages.length > 0 && messages.length <= MAX_MESSAGES &&
    messages.every(message => allowedRoles.includes(message?.role) &&
      typeof message?.content === "string" && message.content.length > 0) &&
    messages.reduce((total, message) => total + message.content.length, 0) <= MAX_PROMPT_LENGTH;
}

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
    const upstreamHeaders = { "Content-Type": "application/json" };
    let upstreamBody;

    if (route.provider === "groq") {
      if (!GROQ_MODELS.has(body?.model) || !isValidMessages(body?.messages, ["system", "user", "assistant"])) {
        return jsonResponse({ error: "Invalid Groq request" }, 400, corsHeaders);
      }
      if (!env.GROQ_API_KEY) {
        return jsonResponse({ error: "Groq is not configured" }, 503, corsHeaders);
      }

      upstreamUrl = "https://api.groq.com/openai/v1/chat/completions";
      upstreamHeaders.Authorization = `Bearer ${env.GROQ_API_KEY}`;
      upstreamBody = {
        model: body.model,
        messages: body.messages,
        temperature: 0.3,
        max_completion_tokens: 500
      };
    } else {
      const contents = body?.contents;
      const validContents = Array.isArray(contents) && contents.length > 0 && contents.length <= MAX_MESSAGES &&
        contents.every(content => (!content?.role || ["user", "model"].includes(content.role)) &&
          Array.isArray(content?.parts) && content.parts.length === 1 &&
          typeof content.parts[0]?.text === "string" && content.parts[0].text.length > 0) &&
        contents.reduce((total, content) => total + content.parts[0].text.length, 0) <= MAX_PROMPT_LENGTH;
      if (!GEMINI_MODELS.has(route.model) || !validContents) {
        return jsonResponse({ error: "Invalid Gemini request" }, 400, corsHeaders);
      }
      if (!env.GEMINI_API_KEY) {
        return jsonResponse({ error: "Gemini is not configured" }, 503, corsHeaders);
      }

      upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.model)}:generateContent`;
      upstreamHeaders["x-goog-api-key"] = env.GEMINI_API_KEY;
      upstreamBody = {
        contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 500 }
      };
    }

    try {
      const upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify(upstreamBody)
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
      const details = error instanceof Error ? error.message : String(error);
      console.error("AI provider request failed", { provider: route.provider, error: details });
      return jsonResponse({ error: "AI provider request failed", details }, 502, corsHeaders);
    }
  }
};
