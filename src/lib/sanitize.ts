// src/lib/sanitize.ts

export type Redaction = { label: string; category: string; original?: string };

export type SanitizeResult = {
  ok: boolean;
  reason: string;
  sanitized: string;
  redactions: Redaction[];
  blocked: boolean;
};

export type BrokerResult = {
  ok: boolean;
  blocked: boolean;
  reason: string;
  sanitized: string;
  redactions: Redaction[];
  map: Record<string, string>; // placeholder -> original
};

function makeRedactor() {
  const redactions: Redaction[] = [];
  const counts = new Map<string, number>();
  const map: Record<string, string> = {};

  const add = (category: string, original: string) => {
    const n = (counts.get(category) ?? 0) + 1;
    counts.set(category, n);

    const label = `${category.toUpperCase()}_${n}`;
    const token = `[${label}]`;

    map[token] = original;
    redactions.push({ label, category, original });

    return token;
  };

  return { redactions, add, map };
}

/** Luhn check for credit card candidates */
function luhnValid(num: string) {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;

    let v = n;
    if (alt) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * BLOCK only very high-risk content:
 * - SSNs
 * - Credit card numbers (Luhn validated)
 * - Private key blocks
 */
function detectHardBlockers(text: string): { blocked: boolean; reason: string } {
  const ssn = /\b\d{3}-\d{2}-\d{4}\b/;
  if (ssn.test(text)) return { blocked: true, reason: "Contains SSN. Remove it before sending." };

  const ccCandidates = text.match(/\b(?:\d[ -]*?){13,19}\b/g) || [];
  for (const cand of ccCandidates) {
    const digits = cand.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
      return { blocked: true, reason: "Contains a credit card number. Remove it before sending." };
    }
  }

  const pk =
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(text) ||
    /-----BEGIN PRIVATE KEY-----/i.test(text);
  if (pk) return { blocked: true, reason: "Contains a private key block. Do not paste private keys." };

  return { blocked: false, reason: "" };
}

/**
 * Reversible sanitization (broker):
 * - replace (do NOT block) API keys/tokens/passwords/emails/phones/IPs/etc.
 * - block only SSN/CC/private-key-blocks
 */
export function sanitizeBrokerInput(
  raw: string,
  opts?: { mode?: "normal" | "code"; trimLongCode?: boolean }
): BrokerResult {
  const original = String(raw ?? "").replace(/\u0000/g, "");

  const blocker = detectHardBlockers(original);
  if (blocker.blocked) {
    return {
      ok: false,
      blocked: true,
      reason: blocker.reason,
      sanitized: "",
      redactions: [],
      map: {},
    };
  }

  const { redactions, add, map } = makeRedactor();
  let text = original;

  // Optional: trim huge pastes in code mode (still reversible)
  if (opts?.mode === "code" && opts?.trimLongCode !== false) {
    const lines = text.split("\n");
    if (lines.length > 260) {
      const head = lines.slice(0, 120);
      const tail = lines.slice(-120);
      text = [...head, "\n/* ... trimmed for privacy ... */\n", ...tail].join("\n");
    }
  }

  // ---- Secrets/tokens: replace (NOT block) ----
  text = text.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, (m) => add("api_key", m)); // OpenAI-ish
  text = text.replace(/\bsk_live_[A-Za-z0-9]{10,}\b/g, (m) => add("api_key", m)); // Stripe
  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, (m) => add("aws_key", m));
  text = text.replace(/\bASIA[0-9A-Z]{16}\b/g, (m) => add("aws_key", m));
  text = text.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, (m) => add("token", m));
  text = text.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, (m) => add("token", m));
  text = text.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, (m) => add("token", m));
  text = text.replace(/\bBearer\s+[A-Za-z0-9._-]{25,}\b/gi, (m) => add("token", m));
  text = text.replace(
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
    (m) => add("token", m)
  );

  // password=..., token: ..., api_key: ... (replace just the value)
  text = text.replace(
    /\b(password|passwd|pwd|token|secret|apikey|api_key)\s*[:=]\s*(['"]?)([^'"\s]+)\2/gi,
    (_full, k, _q, v) => `${k}=${add("secret_value", String(v))}`
  );

  // ---- PII: replace ----
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (m) => add("email", m));

  // Phone (US-style; good default)
  text = text.replace(
    /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    (m) => add("phone", m)
  );

  text = text.replace(
    /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    (m) => add("ip", m)
  );

  // ---- Internal identifiers ----
  text = text.replace(/\bINC\d{6,}\b/gi, (m) => add("ticket", m));
  text = text.replace(/\bCHG\d{6,}\b/gi, (m) => add("change", m));
  text = text.replace(/\bTASK\d{6,}\b/gi, (m) => add("task", m));
  text = text.replace(/\bJIRA-\d+\b/gi, (m) => add("jira", m));
  text = text.replace(/\b(?:[a-zA-Z0-9-]+\.)+(?:local|corp|internal)\b/gi, (m) =>
    add("hostname", m)
  );

  // Optional name masking
  text = text.replace(
    /\b(my name is|i am|i'm|name)\s*[:\-]?\s+([A-Z][a-z]{1,30})(\s+[A-Z][a-z]{1,30})?\b/g,
    (full) => add("name", full)
  );

  // Code-mode: mask all string literals (often internal URLs / business data)
  if (opts?.mode === "code") {
    text = text.replace(/`([^`\\]|\\.)*`/g, (m) => add("string", m));
    text = text.replace(/"([^"\\]|\\.)*"/g, (m) => add("string", m));
    text = text.replace(/'([^'\\]|\\.)*'/g, (m) => add("string", m));
  }

  return {
    ok: true,
    blocked: false,
    reason: "",
    sanitized: text,
    redactions,
    map,
  };
}

/** Restore placeholders to originals for UI display */
export function restoreWithMap(text: string, map: Record<string, string>) {
  let out = String(text ?? "");
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const k of keys) out = out.split(k).join(map[k]);
  return out;
}

/* ============================================================
   Legacy one-way sanitizer (kept for compatibility elsewhere)
   ============================================================ */

function detectSecret(raw: string) {
  const text = raw ?? "";
  const secretPatterns: RegExp[] = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /-----BEGIN PRIVATE KEY-----/i,
    /\bsk-[A-Za-z0-9]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bASIA[0-9A-Z]{16}\b/,
    /\bghp_[A-Za-z0-9]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    /\bBearer\s+[A-Za-z0-9._-]{25,}\b/i,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/,
  ];
  return secretPatterns.some((re) => re.test(text));
}

export function sanitizeInput(raw: string): SanitizeResult {
  const original = String(raw ?? "").replace(/\u0000/g, "");
  const blocked = detectSecret(original);

  const redactions: Redaction[] = [];
  const counts = new Map<string, number>();
  const add = (category: string) => {
    const n = (counts.get(category) ?? 0) + 1;
    counts.set(category, n);
    const label = `${category.toUpperCase()}_${n}`;
    redactions.push({ label, category });
    return `[${label}]`;
  };

  let text = original;

  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => add("email"));

  // ✅ FIXED (clean phone regex)
  text = text.replace(
    /\b(?:\+?1[-.\s]?)?(?:$begin:math:text$\\d\{3\}$end:math:text$|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    () => add("phone")
  );

  text = text.replace(
    /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    () => add("ip")
  );

  text = text.replace(/\bINC\d{6,}\b/gi, () => add("ticket"));
  text = text.replace(/\bCHG\d{6,}\b/gi, () => add("change"));
  text = text.replace(/\bTASK\d{6,}\b/gi, () => add("task"));
  text = text.replace(/\bJIRA-\d+\b/gi, () => add("jira"));
  text = text.replace(/\b(?:[a-zA-Z0-9-]+\.)+(?:local|corp|internal)\b/gi, () => add("hostname"));

  return {
    ok: !blocked,
    reason: blocked ? "Detected what looks like a secret/private key/token. Remove it before sending." : "",
    sanitized: text,
    redactions,
    blocked,
  };
}

export function sanitizeOutput(raw: string): { sanitized: string; redactions: Redaction[] } {
  const { sanitized, redactions } = sanitizeInput(raw);
  return { sanitized, redactions };
}