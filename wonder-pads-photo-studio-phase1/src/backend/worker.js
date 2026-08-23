// Cloudflare Worker entry point.
//
// This project was previously a pure static-asset deployment (no custom
// Worker script) — this file's only job beyond serving those assets is
// proxying RMBG-1.4 model downloads from Hugging Face.
//
// Why this exists: the browser downloads the background-removal model
// directly from huggingface.co client-side. On this deployment specifically,
// that cross-origin request was being blocked ("No 'Access-Control-Allow-
// Origin' header"), even though the model is public and the same request
// works fine from many other origins. Rather than depend on a third
// party's CORS behavior for a specific *.workers.dev origin, this Worker
// fetches the model SERVER-SIDE (server-to-server requests are never
// subject to browser CORS) and hands it back to the browser as same-origin
// content — so the browser never talks to huggingface.co directly at all.
//
// See src/utils/bgRemovalWorker.js for the client side of this (env.remoteHost).

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/hf-proxy/')) {
      const targetPath = url.pathname.slice('/hf-proxy/'.length);
      const targetUrl = `https://huggingface.co/${targetPath}${url.search}`;
      const upstream = await fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        redirect: 'follow',
      });
      // Same-origin response to the browser — no CORS headers needed,
      // since this is no longer a cross-origin request from its perspective.
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
      });
    }

    // Everything else: serve the built app exactly as before.
    return env.ASSETS.fetch(request);
  },
};
