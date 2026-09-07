// Cloudflare Worker entry point for Wonder Pads Studio.
// It serves the website and proxies the public RMBG model files so the
// browser never needs a cross-origin request to huggingface.co.

const MODEL_PREFIX = '/hf-proxy/';
const MODEL_HOST = 'https://huggingface.co/';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(MODEL_PREFIX)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }

      const targetPath = url.pathname.slice(MODEL_PREFIX.length);
      if (!targetPath || targetPath.includes('..')) {
        return new Response('Invalid model path', { status: 400 });
      }

      const targetUrl = new URL(targetPath + url.search, MODEL_HOST);
      const headers = new Headers();
      const range = request.headers.get('Range');
      const accept = request.headers.get('Accept');
      if (range) headers.set('Range', range);
      if (accept) headers.set('Accept', accept);

      try {
        const upstream = await fetch(targetUrl, {
          method: request.method,
          headers,
          redirect: 'follow',
        });
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.set('Access-Control-Allow-Origin', url.origin);
        responseHeaders.set('Vary', 'Origin');
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      } catch (error) {
        return Response.json(
          { error: 'The background-removal model could not be downloaded.', detail: error?.message || String(error) },
          { status: 502 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
