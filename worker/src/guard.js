/**
 * Request guards for hpt-worker.
 *
 * These are storage-agnostic on purpose: they don't know how teams, PINs or
 * responses are stored, so they can be dropped in front of the existing
 * handler without needing to understand it first.
 *
 * Fixes three things found by probing the live Worker on 2026-09-01:
 *
 *   1. CORS was `Access-Control-Allow-Origin: *` on every route, so any
 *      website could call /save and write into any team code.
 *   2. /ai proxied to the Anthropic API with no authentication at all —
 *      an empty POST from an arbitrary Origin came back with Anthropic's own
 *      validation error and a request_id, proving the key was attached.
 *   3. No rate limiting anywhere. Twelve rapid requests, twelve 200s.
 */

/* ── CORS ──────────────────────────────────────────────────────────────── */

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean);
}

/**
 * CORS headers for this request, or an empty object when the Origin isn't
 * allowed. Returning nothing is deliberate — the browser then blocks the
 * response, rather than us returning a header that permits it.
 *
 * Requests with no Origin at all (curl, server-to-server) are not blocked
 * here; CORS is a browser mechanism and pretending otherwise gives false
 * comfort. Route-level auth is what actually protects an endpoint.
 */
export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  if (!allowedOrigins(env).includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

/** Answer a CORS preflight. Returns null when this isn't one. */
export function handlePreflight(request, env) {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

/** Attach CORS headers to a response built elsewhere. */
export function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/* ── Rate limiting ─────────────────────────────────────────────────────── */

/**
 * Fixed-window rate limit backed by KV.
 *
 * KV is eventually consistent, so this leaks a little under concurrent bursts
 * from the same client — it will not hold against a determined attacker. It is
 * here to stop runaway loops and casual abuse, which is the actual risk during
 * a pilot. For a real limit, use Cloudflare Rate Limiting rules (dashboard,
 * enforced at the edge before the Worker runs) or a Durable Object.
 *
 * @returns {Promise<boolean>} true when the request is over the limit.
 */
export async function isRateLimited(env, bucket, { limit, windowSeconds }) {
  if (!env.HPT_KV) return false; // fail open — never break the survey over this
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `rl:${bucket}:${window}`;
  try {
    const current = parseInt((await env.HPT_KV.get(key)) || "0", 10);
    if (current >= limit) return true;
    await env.HPT_KV.put(key, String(current + 1), {
      expirationTtl: Math.max(60, windowSeconds * 2),
    });
    return false;
  } catch {
    return false;
  }
}

/** Client IP, for rate-limit bucketing. */
export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

export function tooManyRequests(request, env) {
  return new Response(
    JSON.stringify({ error: "För många förfrågningar. Försök igen om en stund." }),
    {
      status: 429,
      headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
    }
  );
}

/* ── /ai gate ──────────────────────────────────────────────────────────── */

/**
 * The AI endpoints (workshop generation and chat) are only ever used from
 * HPT_resultat.html, which already requires a team code and PIN to show
 * results at all. So /ai should require the same credential rather than being
 * open to the world.
 *
 * A shared secret is not an option here: the caller is a public web page, so
 * any secret it holds is readable in devtools. Reusing the PIN the leader has
 * already entered is the credential that actually exists.
 *
 * WIRING THIS UP: the deployed Worker already validates team+PIN for
 * /results. Import that function here and call it instead of the throw below —
 * do not write a second implementation, or the two will drift.
 */
export async function requireTeamPin(env, team, pin, verifyPin) {
  if (typeof verifyPin !== "function") {
    throw new Error(
      "guard.requireTeamPin: pass the Worker's existing PIN check as verifyPin"
    );
  }
  if (!team || !pin) return false;
  return await verifyPin(env, team, pin);
}

export function unauthorized(request, env, message) {
  return new Response(
    JSON.stringify({ error: message || "Teamkod och PIN krävs.", pin: true }),
    {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
    }
  );
}

/* ── Minimum-N ─────────────────────────────────────────────────────────── */

/**
 * True when a result set is too small to show without making individual
 * answers derivable. The client enforces this too, but a client-side gate is
 * a courtesy, not a control — anyone can call the Worker directly.
 */
export function belowMinN(env, n) {
  const min = parseInt(env.MIN_N || "4", 10);
  return typeof n === "number" && n > 0 && n < min;
}

export function minNResponse(request, env, n) {
  const min = parseInt(env.MIN_N || "4", 10);
  return new Response(
    JSON.stringify({
      n,
      withheld: true,
      minN: min,
      error: `Teamet har ${n} av ${min} svar. Resultatet visas när minst ${min} personer har svarat.`,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
    }
  );
}
