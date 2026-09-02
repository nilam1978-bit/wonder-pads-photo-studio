// Direct browser → Gemini API integration.
// Uses gemini-2.5-flash-image (Nano Banana) for image editing with a reference image.
// Free tier: https://aistudio.google.com/apikey
//
// SECURITY NOTE: Cloudflare proxy mode is preferred for deployed use. If no proxy URL
// is configured, the optional fallback stores a Gemini key in browser localStorage;
// anyone opening DevTools could read that key. Use browser-key mode only for private
// local testing and rotate the key in Google AI Studio when needed.

(function () {
  const KEY_STORAGE = 'wp_gemini_key';
  const getProxyUrl = () => String(window.WP_GEMINI_PROXY_URL || '').replace(/\/+$/, '');
  const hasProxy = () => !!getProxyUrl();
  const proxyPost = async (route, body) => {
    const response = await fetch(`${getProxyUrl()}${route}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body || {}) });
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(payload.error || `Gemini proxy HTTP ${response.status}`);
    return payload;
  };
  const NAMING_MODEL_STORAGE = 'wp_gemini_naming_model';
  const NAMING_MODEL_CHECKED_STORAGE = 'wp_gemini_naming_model_checked';
  const NAMING_MODEL_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
  const IMAGE_MODEL = 'gemini-2.5-flash-image';
  const IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;
  // Ordered fallbacks; live models.list remains the source of truth and can replace this list.
  const NAMING_MODEL_PREFERENCE = ['gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.1-flash-lite','gemini-3-flash-preview','gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-pro'];

  const getKey = () => localStorage.getItem(KEY_STORAGE) || '';
  const setKey = (k) => {
    if (k && k.trim()) localStorage.setItem(KEY_STORAGE, k.trim());
    else localStorage.removeItem(KEY_STORAGE);
  };
  const hasKey = () => !!getKey() || hasProxy();

  function normalizeModel(model) {
    const base = model?.baseModelId || model?.name || '';
    return String(base).replace(/^models\//, '');
  }

  function isNamingModel(model) {
    const id = normalizeModel(model).toLowerCase();
    const methods = model?.supportedGenerationMethods || model?.supportedActions || [];
    const supportsGenerate = methods.includes('generateContent');
    const excluded = /image|live|tts|audio|video|embedding|embed|veo|lyria|robotics|computer|deep-research|omni/i.test(id);
    return Boolean(id && supportsGenerate && !excluded && /gemini/i.test(id));
  }

  function chooseNamingCandidates(models) {
    const usable = models.filter(isNamingModel);
    const byId = new Map(usable.map(model => [normalizeModel(model), model]));
    const orderedIds = [...NAMING_MODEL_PREFERENCE.filter(id => byId.has(id)), ...usable.map(normalizeModel).filter(id => !NAMING_MODEL_PREFERENCE.includes(id)).sort((a,b) => b.localeCompare(a, undefined, {numeric:true}))];
    const checkedAt = Date.now();
    const candidates = orderedIds.map(id => {
      const source = byId.get(id);
      return { model:id, displayName:source?.displayName || id, checkedAt, source:'Google models.list' };
    });
    if (!candidates.length) throw new Error('No supported Gemini text-and-image naming model is available for this key.');
    return candidates;
  }

  async function listNamingModels(key) {
    if (hasProxy()) {
      const proxyPayload = await proxyPost('/models', {});
      return proxyPayload.models || [];
    }
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key) + '&pageSize=1000');
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { const errorJson = await response.json(); detail = errorJson?.error?.message || detail; } catch (_) {}
      throw new Error(detail);
    }
    return chooseNamingCandidates((await response.json()).models || []);
  }

  async function discoverNamingModels({force=false} = {}) {
    const key = getKey();
    if (!key && !hasProxy()) throw new Error('NO_KEY');
    const cachedModel = localStorage.getItem(NAMING_MODEL_STORAGE) || '';
    const checkedAt = Number(localStorage.getItem(NAMING_MODEL_CHECKED_STORAGE) || 0);
    if (!force && cachedModel && Date.now() - checkedAt < NAMING_MODEL_CHECK_INTERVAL) {
      return [{ model:cachedModel, displayName:cachedModel, checkedAt, source:'cached model check' }];
    }
    const candidates = await listNamingModels(key);
    localStorage.setItem(NAMING_MODEL_STORAGE, candidates[0].model);
    localStorage.setItem(NAMING_MODEL_CHECKED_STORAGE, String(candidates[0].checkedAt));
    return candidates;
  }

  async function discoverNamingModel(options) {
    const candidates = await discoverNamingModels(options);
    return candidates[0];
  }

  const getNamingModel = (options) => discoverNamingModel(options);

  const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

  async function generateNaming({prompt, dataUrl}) {
    const key = getKey();
    if (!key && !hasProxy()) throw new Error('NO_KEY');
    const base64 = String(dataUrl || '').split(',')[1] || '';
    if (hasProxy()) {
      const candidates = await discoverNamingModels();
      let lastError = null;
      for (const candidate of candidates.slice(0, 4)) {
        try { return await proxyPost('/naming', {prompt, dataUrl, model:candidate.model}); }
        catch (error) { lastError = error; }
      }
      throw lastError || new Error('Gemini proxy naming failed.');
    }
    if (!base64) throw new Error('Gemini could not read the compressed fabric image.');
    let candidates = await discoverNamingModels();
    let lastError = null;
    for (let pass = 0; pass < 2; pass += 1) {
      for (const modelInfo of candidates.slice(0, 4)) {
        for (let retry = 0; retry < 3; retry += 1) {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelInfo.model}:generateContent?key=${encodeURIComponent(key)}`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt},{inlineData:{mimeType:'image/jpeg',data:base64}}]}],generationConfig:{responseMimeType:'application/json'}}),
          });
          if (response.ok) {
            const json = await response.json();
            const text = (((json.candidates || [])[0] || {}).content || {}).parts?.map(part => part.text || '').join('') || '';
            localStorage.setItem(NAMING_MODEL_STORAGE, modelInfo.model);
            return {text, model:modelInfo};
          }
          let detail = `HTTP ${response.status}`;
          try { const errorJson = await response.json(); detail = errorJson?.error?.message || detail; } catch (_) {}
          if (response.status === 401 || response.status === 403) throw new Error('BAD_KEY: ' + detail);
          if ([429,500,502,503,504].includes(response.status)) {
            lastError = new Error(`BUSY ${modelInfo.model}: ${detail}`);
            if (retry < 2) { await wait(1200 * Math.pow(2, retry)); continue; }
            break;
          }
          lastError = new Error(`MODEL ${modelInfo.model}: ${detail}`);
          if (![400,404,410].includes(response.status)) throw lastError;
          break;
        }
      }
      candidates = await discoverNamingModels({force:true});
    }
    throw lastError || new Error('Gemini naming model unavailable.');
  }

  // Convert a data URL or blob URL to { mimeType, data (base64 no prefix) }
  async function toInlineData(src) {
    let blob;
    if (src.startsWith('data:')) {
      const res = await fetch(src);
      blob = await res.blob();
    } else {
      // relative/absolute path (e.g. assets/product-upload.jpg)
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Failed to fetch reference image (${res.status})`);
      blob = await res.blob();
    }
    const buf = await blob.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return { mimeType: blob.type || 'image/jpeg', data: btoa(bin) };
  }

  // Build the text prompt from a preset + variation seed
  function buildPrompt(preset, variationLabel) {
    const productDescriptor =
      'the reusable cloth sanitary pad shown in the reference image';
    const filled = preset.prompt.replace(/\{PRODUCT\}/g, productDescriptor);

    const preservation =
      'CRITICAL: Preserve the exact shape, color, print pattern, proportions, ' +
      'stitching detail, and snap button of the product from the reference image. ' +
      'Do NOT redesign, restyle, or reinterpret the product itself. Only replace ' +
      'the background/scene and match the scene\'s lighting and shadow to the product.';

    const sceneParams = [
      `Camera angle: ${preset.angle}.`,
      `Lighting: ${preset.lighting} at ${preset.lightingIntensity}% intensity.`,
      `Prop density: ${preset.propDensity}% (0 = minimal, 100 = rich).`,
      `Aspect ratio: ${preset.aspect}.`,
    ].join(' ');

    const varNote = variationLabel
      ? ` Variation ${variationLabel}: subtle change in composition, prop placement, and light angle while keeping the same overall scene direction.`
      : '';

    const negative = preset.negative
      ? ` Avoid: ${preset.negative}.`
      : '';

    return `${filled}\n\n${sceneParams}${varNote}${negative}\n\n${preservation}`;
  }

  // Generate ONE image via Gemini
  async function generateOne(preset, referenceSrc, variationLabel, signal) {
    const key = getKey();
    if (!key && !hasProxy()) throw new Error('NO_KEY');

    const refImg = await toInlineData(referenceSrc);
    const prompt = buildPrompt(preset, variationLabel);

    if (hasProxy()) {
      const proxyPayload = await proxyPost('/image', {prompt, dataUrl:`data:${refImg.mimeType};base64,${refImg.data}`, mimeType:refImg.mimeType, model:IMAGE_MODEL});
      if (!proxyPayload.dataUrl) throw new Error('Gemini proxy returned no image.');
      return proxyPayload.dataUrl;
    }

    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: refImg }
        ]
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        temperature: 0.9,
      }
    };

    const res = await fetch(`${IMAGE_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err && err.error && err.error.message) msg = err.error.message;
      } catch (e) {}
      if (res.status === 401 || res.status === 403) msg = 'BAD_KEY: ' + msg;
      if (res.status === 429) {
        // Free-tier is 0 for image models as of 2026 — surface a helpful message.
        if (/free_tier|limit: 0/i.test(msg)) {
          msg = 'BILLING_REQUIRED: Gemini image generation no longer has a free tier. Enable billing at https://aistudio.google.com/apikey (roughly $0.04 per image, ~$0.15 per 4-shot batch). Set a low budget cap in Google Cloud to be safe.';
        } else {
          msg = 'RATE_LIMIT: ' + msg;
        }
      }
      throw new Error(msg);
    }

    const json = await res.json();

    // Extract the first inline image part
    const parts = ((((json.candidates || [])[0] || {}).content || {}).parts) || [];
    for (const p of parts) {
      if (p.inlineData && p.inlineData.data) {
        const mime = p.inlineData.mimeType || 'image/png';
        return `data:${mime};base64,${p.inlineData.data}`;
      }
    }

    // If we got here, the model refused or returned text only
    const textPart = parts.find(p => p.text);
    const finishReason = ((json.candidates || [])[0] || {}).finishReason;
    if (finishReason === 'SAFETY') throw new Error('SAFETY_BLOCK: Google\'s safety filter blocked this image. Try a different preset or a more neutral product shot.');
    throw new Error('NO_IMAGE: The model returned no image. ' + (textPart ? textPart.text.slice(0,200) : 'Reason: ' + (finishReason||'unknown')));
  }

  // Generate N variations in parallel, calling onProgress(index, resultOrError)
  async function generateBatch({ preset, referenceSrc, count, onProgress, signal }) {
    const labels = Array.from({ length: count }, (_, i) => `${i+1} of ${count}`);
    const promises = labels.map((label, i) =>
      generateOne(preset, referenceSrc, label, signal)
        .then(src => {
          onProgress && onProgress(i, { ok: true, src });
          return { ok: true, src };
        })
        .catch(err => {
          onProgress && onProgress(i, { ok: false, error: err.message });
          return { ok: false, error: err.message };
        })
    );
    return Promise.all(promises);
  }

  window.WPGemini = { getKey, setKey, hasKey, generateBatch, generateOne, generateNaming, getNamingModel, discoverNamingModel, buildPrompt };
})();
