// src/lib/couponAiClient.ts
export type CouponAiSearchItem = {
    title?: string;
    url?: string;
    description?: string;
    code?: string | null;
    discount?: string | null;
    verified?: boolean;
    expires?: string | null;
    source?: string;
  };
  
  export type CouponAiSearchResponse = {
    ok: boolean;
    query: string;
    items: CouponAiSearchItem[];
    raw?: any;
    error?: string;
  };
  
  type ClientOpts = {
    baseUrl?: string; // e.g. http://localhost:4100
    apiKey?: string;
    timeoutMs?: number;
  };
  
  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
  
  function joinUrl(base: string, path: string) {
    return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }
  
  async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      const text = await res.text().catch(() => "");
      const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
      return { res, text, json };
    } finally {
      clearTimeout(t);
    }
  }
  
  export class CouponAiClient {
    private baseUrl: string;
    private apiKey?: string;
    private timeoutMs: number;
  
    constructor(opts: ClientOpts = {}) {
      this.baseUrl = opts.baseUrl || process.env.COUPON_AI_BASE_URL || "http://localhost:4100";
      this.apiKey = opts.apiKey || process.env.COUPON_AI_API_KEY;
      this.timeoutMs = opts.timeoutMs ?? 15000;
    }
  
    private headers() {
      const h: Record<string, string> = { "Content-Type": "application/json" };
      if (this.apiKey) h["x-api-key"] = this.apiKey; // only used if coupon-ai requires it
      return h;
    }
  
    async health(): Promise<{ ok: boolean; status: number; body?: any }> {
      const url = joinUrl(this.baseUrl, "/health");
      const { res, json } = await fetchJson(url, { method: "GET", headers: this.headers() }, this.timeoutMs);
      return { ok: res.ok, status: res.status, body: json ?? null };
    }
  
    /**
     * Search coupons via coupon-ai.
     * Supports either:
     *  - immediate results: { items: [...] }
     *  - async job: { jobId: "..." } + poll /api/search/status/:jobId
     */
    async search(query: string, opts?: { maxWaitMs?: number; pollMs?: number }): Promise<CouponAiSearchResponse> {
      const q = String(query || "").trim();
      if (!q) return { ok: false, query: q, items: [], error: "Empty query" };
  
      const maxWaitMs = opts?.maxWaitMs ?? 20000;
      const pollMs = opts?.pollMs ?? 700;
  
      const url = joinUrl(this.baseUrl, `/api/search?query=${encodeURIComponent(q)}`);
  
      const { res, json, text } = await fetchJson(
        url,
        { method: "GET", headers: this.headers() },
        this.timeoutMs
      );
  
      if (!res.ok) {
        return { ok: false, query: q, items: [], error: `coupon-ai search failed (${res.status}): ${text || ""}`.trim() };
      }
  
      // Common shapes:
      // 1) { items: [...] }
      // 2) { results: [...] }
      // 3) { jobId: "..." }
      // 4) { data: { items: [...] } } etc.
      const immediateItems =
        (json?.items ?? json?.results ?? json?.data?.items ?? json?.data?.results) as CouponAiSearchItem[] | undefined;
  
      if (Array.isArray(immediateItems)) {
        return { ok: true, query: q, items: immediateItems, raw: json };
      }
  
      const jobId = json?.jobId || json?.id || json?.data?.jobId;
      if (!jobId) {
        // fallback: if response is weird but ok
        return { ok: true, query: q, items: [], raw: json };
      }
  
      // Poll job status
      const statusUrl = joinUrl(this.baseUrl, `/api/search/status/${encodeURIComponent(String(jobId))}`);
      const started = Date.now();
  
      while (Date.now() - started < maxWaitMs) {
        const st = await fetchJson(statusUrl, { method: "GET", headers: this.headers() }, this.timeoutMs);
        if (!st.res.ok) {
          return { ok: false, query: q, items: [], error: `status failed (${st.res.status})`, raw: st.json ?? st.text };
        }
  
        const done =
          st.json?.status === "completed" ||
          st.json?.status === "done" ||
          st.json?.done === true ||
          st.json?.complete === true;
  
        const items =
          (st.json?.items ?? st.json?.results ?? st.json?.data?.items ?? st.json?.data?.results) as CouponAiSearchItem[] | undefined;
  
        if (done && Array.isArray(items)) {
          return { ok: true, query: q, items, raw: st.json };
        }
  
        // sometimes items appear before done=true
        if (Array.isArray(items) && items.length) {
          return { ok: true, query: q, items, raw: st.json };
        }
  
        await sleep(pollMs);
      }
  
      return { ok: false, query: q, items: [], error: "Timed out waiting for coupon-ai job", raw: json };
    }
  }