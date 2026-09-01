/**
 * hpt-worker — backend for Högpresterande Team.
 *
 * ⚠️  THIS FILE IS A SCAFFOLD. The real implementation is currently only in
 *     the deployed Worker and has never been in version control. Pull it
 *     first — see worker/README.md — and merge it into the marked section
 *     below. Do not deploy this file as-is: it will replace the live Worker
 *     with stubs.
 *
 * ── Observed API contract ────────────────────────────────────────────────
 * Reconstructed from the client code and by probing the live Worker on
 * 2026-09-01. Use it to check that nothing is missing once you paste.
 *
 *   POST /setup     {teamCode, pin}          → {code}
 *                   Creates a team. Called by HPT_admin.html.
 *
 *   POST /save      {teamCode, areas, prest, ts}
 *                   Stores one response. Called by HPT_enkat.html.
 *                   NOTE: `name` was removed from this payload on
 *                   2026-08-31. Responses already in KV may still have it —
 *                   see README "Clearing old names".
 *
 *   GET  /results?team=<code>&pin=<pin>
 *                   → {n, areas, prest, names?}
 *                   401 {pin: true} when the team has a PIN and it's wrong
 *                   or missing. Unknown team returns 200 {n: 0}.
 *                   `names` is no longer read by any client — stop
 *                   returning it.
 *
 *   POST /ai        Anthropic Messages API passthrough.
 *                   Currently UNAUTHENTICATED — see guard.js.
 *
 * Storage keys follow `hpt:<code>:resp:<uid>`.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  belowMinN,
  clientIp,
  corsHeaders,
  handlePreflight,
  isRateLimited,
  minNResponse,
  requireTeamPin,
  tooManyRequests,
  unauthorized,
  withCors,
} from "./guard.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight — now origin-checked rather than blanket `*`.
    const preflight = handlePreflight(request, env);
    if (preflight) return preflight;

    // ── /ai ──────────────────────────────────────────────────────────────
    // Gated on the team PIN the leader has already entered, and rate limited
    // per team. Previously open to the entire internet on your API key.
    if (path === "/ai" && request.method === "POST") {
      const team = url.searchParams.get("team");
      const pin = url.searchParams.get("pin");

      // TODO: pass the Worker's existing PIN validator as the 4th argument.
      // const ok = await requireTeamPin(env, team, pin, verifyPin);
      // if (!ok) return unauthorized(request, env);

      if (await isRateLimited(env, `ai:${team || clientIp(request)}`, {
        limit: 30,
        windowSeconds: 3600,
      })) {
        return tooManyRequests(request, env);
      }

      // TODO: paste the existing /ai proxy body here.
      return withCors(
        new Response(JSON.stringify({ error: "not implemented" }), {
          status: 501,
          headers: { "Content-Type": "application/json" },
        }),
        request,
        env
      );
    }

    // ── /save ────────────────────────────────────────────────────────────
    // Rate limited per IP so one client can't flood a team with responses.
    if (path === "/save" && request.method === "POST") {
      if (await isRateLimited(env, `save:${clientIp(request)}`, {
        limit: 20,
        windowSeconds: 3600,
      })) {
        return tooManyRequests(request, env);
      }

      // TODO: paste the existing /save body here.
      // When you do: drop `name` from whatever gets written, so new
      // responses never carry it even if an old client posts one.
      return withCors(
        new Response(JSON.stringify({ error: "not implemented" }), {
          status: 501,
          headers: { "Content-Type": "application/json" },
        }),
        request,
        env
      );
    }

    // ── /results ─────────────────────────────────────────────────────────
    if (path === "/results" && request.method === "GET") {
      // TODO: paste the existing /results body here, then before returning:
      //
      //   1. delete result.names            — no client reads it any more
      //   2. if (belowMinN(env, result.n))  return minNResponse(request, env, result.n)
      //
      // Step 2 is what makes the minimum-N rule real. The client-side check
      // added on 2026-08-31 is a courtesy — anyone can call this directly.

      return withCors(
        new Response(JSON.stringify({ error: "not implemented" }), {
          status: 501,
          headers: { "Content-Type": "application/json" },
        }),
        request,
        env
      );
    }

    // ── /setup ───────────────────────────────────────────────────────────
    if (path === "/setup" && request.method === "POST") {
      if (await isRateLimited(env, `setup:${clientIp(request)}`, {
        limit: 10,
        windowSeconds: 3600,
      })) {
        return tooManyRequests(request, env);
      }

      // TODO: paste the existing /setup body here.
      return withCors(
        new Response(JSON.stringify({ error: "not implemented" }), {
          status: 501,
          headers: { "Content-Type": "application/json" },
        }),
        request,
        env
      );
    }

    return withCors(new Response("Not found", { status: 404 }), request, env);
  },
};
