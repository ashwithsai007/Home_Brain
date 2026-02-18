// src/app/api/chat/route.ts
import { NextRequest } from "next/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

import { initDb, db } from "@/lib/db";
import { sanitizeBrokerInput, restoreWithMap } from "@/lib/sanitize";
import { auditStoreRequest, auditStoreResponse } from "@/lib/privacyAudit";
import { buildCodeErrorPrompt } from "@/lib/codeErrorContext";

import { CouponAiClient } from "@/lib/couponAiClient";

export const runtime = "nodejs";

type Mode = "normal" | "code";
type Role = "user" | "assistant";
type Provider = "openai" | "claude";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

function pickOpenAIModel(requested?: string, mode: Mode = "normal") {
  const allow = new Set(["gpt-5-mini", "gpt-5.2", "gpt-4.1"]);
  if (requested && allow.has(requested)) return requested;
  return mode === "code" ? "gpt-5-mini" : "gpt-5-mini";
}

function pickClaudeModel(requested?: string) {
  const allow = new Set(["claude-sonnet-4-5-20250929", "claude-opus-4-1-20250805"]);
  if (requested && allow.has(requested)) return requested;
  return "claude-sonnet-4-5-20250929";
}

function systemPrompt(mode: Mode) {
  if (mode === "code") {
    return `You are a senior software engineer.
Format like ChatGPT/Claude:
- Start with a 1–2 sentence direct answer.
- Use short Markdown sections with headings (###).
- Use bullets for lists.
- Put code in fenced blocks with language tags.
- Keep it concise and practical.
Important:
- If context is minimal, ask targeted follow-up questions instead of guessing.
- Do not ask for full source code; only ask for the smallest surrounding lines.`;
  }

  return `You are a helpful assistant.
Format like ChatGPT/Claude:
- Start with a 1–2 sentence direct answer.
- Use short Markdown sections with headings (###).
- Use bullets for lists.
- Avoid long walls of text.
- When showing code, use fenced blocks with language tags.

If COUPON AI RESULTS are provided, use them as the primary source of truth for up-to-date deals/coupons.
When listing coupons/deals:
- include source URL per item
- do not invent codes
- if a code is missing, label it as “Deal (no code shown)” and include the URL.`;
}

function mergeMaps(...maps: Array<Record<string, string> | undefined>) {
  const out: Record<string, string> = {};
  for (const m of maps) {
    if (!m) continue;
    for (const k of Object.keys(m)) out[k] = m[k];
  }
  return out;
}

function toClaudeMessages(promptMessages: Array<{ role: string; content: string }>) {
  let system = "";
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of promptMessages) {
    if (m.role === "system") {
      system = m.content || system;
      continue;
    }
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content ?? "" });
    }
  }
  return { system, messages };
}

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timeout")), ms);

    const abort = () => {
      clearTimeout(t);
      reject(new Error("Aborted"));
    };

    try {
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
    } catch {}

    p.then((v) => {
      clearTimeout(t);
      try { signal?.removeEventListener("abort", abort); } catch {}
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      try { signal?.removeEventListener("abort", abort); } catch {}
      reject(e);
    });
  });
}

function formatCouponAiBlock(query: string, items: any[]) {
  const top = (items || []).slice(0, 12);

  const lines = top.map((it, idx) => {
    const title = it.title || it.description || "Offer";
    const url = it.url ? String(it.url) : "";
    const code = it.code ? String(it.code) : "";
    const verified = it.verified ? " (verified)" : "";
    const expires = it.expires ? `; expires: ${it.expires}` : "";
    const discount = it.discount ? ` — ${it.discount}` : "";

    const codePart = code ? `Code: ${code}` : "Deal (no code shown)";
    const urlPart = url ? `\n   ${url}` : "";

    return `${idx + 1}. ${title}${discount}${verified}${expires}\n   ${codePart}${urlPart}`;
  });

  return `COUPON AI RESULTS (query="${query}"):\n` + (lines.length ? lines.join("\n") : "(no results)");
}

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return Response.json({ error: "Use JSON body" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    const chatId = String((body as any).chatId || "").trim();
    const projectId = String((body as any).projectId || "").trim();
    const mode = (((body as any).mode === "code" ? "code" : "normal") as Mode);

    const provider = (((body as any).provider === "claude" ? "claude" : "openai") as Provider);
    const model =
      provider === "openai"
        ? pickOpenAIModel((body as any).model as string | undefined, mode)
        : pickClaudeModel((body as any).model as string | undefined);

    const webEnabled = (body as any).web === true;
    const userMessage = String((body as any).message || "");

    if (!chatId || !projectId) return Response.json({ error: "Missing chatId/projectId" }, { status: 400 });
    if (!userMessage.trim()) return Response.json({ error: "Empty message" }, { status: 400 });

    initDb();
    const d = db();

    const tsUser = Date.now();
    const auditRequestId = crypto.randomUUID();

    d.prepare(
      `INSERT INTO messages (id, chat_id, role, content, ts)
       VALUES (?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), chatId, "user", userMessage, tsUser);

    const base = mode === "code" ? buildCodeErrorPrompt(userMessage).extractedPrompt : userMessage;
    const broker = sanitizeBrokerInput(base, { mode });

    auditStoreRequest({
      id: auditRequestId,
      ts: tsUser,
      chatId,
      projectId,
      mode,
      provider,
      model,
      blocked: broker.blocked,
      blockReason: broker.reason,
      redactionsJson: JSON.stringify(broker.redactions || []),
      original: userMessage,
      sanitized: broker.sanitized,
      map: broker.map,
    });

    if (!broker.ok) return Response.json({ error: broker.reason || "Blocked input", blocked: true }, { status: 400 });

    const cleanOutbound = broker.sanitized.trim();
    if (!cleanOutbound) return Response.json({ error: "Empty message after sanitization" }, { status: 400 });

    // Load history (sanitized)
    const rows = d
      .prepare(
        `SELECT role, content
         FROM messages
         WHERE chat_id = ?
         ORDER BY ts ASC
         LIMIT 50`
      )
      .all(chatId) as { role: Role; content: string }[];

    const historyOut: Array<{ role: Role; content: string }> = [];
    const historyMaps: Record<string, string>[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const isLast = i === rows.length - 1;
      const isCurrentUser = isLast && r.role === "user";

      if (isCurrentUser) {
        historyOut.push({ role: "user", content: cleanOutbound });
        historyMaps.push(broker.map);
        continue;
      }

      const s = sanitizeBrokerInput(r.content, { mode });
      historyOut.push({ role: r.role, content: s.ok ? s.sanitized : "[BLOCKED_CONTENT]" });
      if (s.ok) historyMaps.push(s.map);
    }

    const restoreMap = mergeMaps(...historyMaps);

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        let fullSanitized = "";

        const enqueue = (s: string) => {
          if (!s) return;
          controller.enqueue(encoder.encode(s));
        };

        try {
          // --- coupon-ai context block
          let couponSystemInsert = "";
          if (webEnabled) {
            enqueue("*(Searching coupons…)*\n\n");

            try {
              const client = new CouponAiClient();
              const res = await withTimeout(client.search(cleanOutbound, { maxWaitMs: 20000, pollMs: 700 }), 25000, req.signal);

              if (res.ok) {
                couponSystemInsert = "\n\n" + formatCouponAiBlock(res.query, res.items) + "\n";
              } else {
                couponSystemInsert = `\n\nCOUPON AI RESULTS: (failed)\nReason: ${res.error || "unknown"}\n`;
              }
            } catch (e: unknown) {
              couponSystemInsert = `\n\nCOUPON AI RESULTS: (failed)\nReason: ${errMessage(e)}\n`;
            }
          }

          const promptMessages = [
            {
              role: "system" as const,
              content: systemPrompt(mode) + (couponSystemInsert ? "\n" + couponSystemInsert : ""),
            },
            ...historyOut.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          ];

          if (provider === "openai") {
            const resp = await openai.chat.completions.create(
              { model, messages: promptMessages, stream: true },
              { signal: req.signal }
            );

            for await (const part of resp) {
              if (req.signal?.aborted) break;
              const delta = part.choices?.[0]?.delta?.content ?? "";
              if (!delta) continue;
              fullSanitized += delta;
              enqueue(delta);
            }
          } else {
            const { system, messages } = toClaudeMessages(promptMessages);

            const claudeStream = await anthropic.messages.create({
              model,
              max_tokens: 1400,
              system,
              messages,
              stream: true,
            });

            const abortClaude = () => {
              try {
                const maybe = claudeStream as unknown as { controller?: { abort?: () => void } };
                maybe.controller?.abort?.();
              } catch {}
            };
            req.signal?.addEventListener("abort", abortClaude, { once: true });

            try {
              for await (const ev of claudeStream as unknown as AsyncIterable<unknown>) {
                if (req.signal?.aborted) break;
                const e = ev as any;
                if (e?.type === "content_block_delta" && e?.delta?.type === "text_delta") {
                  const delta = String(e.delta.text || "");
                  if (!delta) continue;
                  fullSanitized += delta;
                  enqueue(delta);
                }
              }
            } finally {
              try { req.signal?.removeEventListener("abort", abortClaude); } catch {}
            }
          }

          const tsAsst = Date.now();
          const restored = restoreWithMap(fullSanitized.trim(), restoreMap).trim();

          if (restored) {
            d.prepare(
              `INSERT INTO messages (id, chat_id, role, content, ts)
               VALUES (?, ?, ?, ?, ?)`
            ).run(crypto.randomUUID(), chatId, "assistant", restored, tsAsst);

            try {
              d.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`).run(tsAsst, chatId);
              d.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(tsAsst, projectId);
            } catch {}

            auditStoreResponse({
              id: crypto.randomUUID(),
              requestId: auditRequestId,
              ts: tsAsst,
              response: restored,
            });
          } else {
            enqueue("I couldn’t generate a response. Try again with Web off or a shorter query.");
          }

          if (req.signal?.aborted) enqueue("\n\n> *(stopped)*");
          controller.close();
        } catch (e: unknown) {
          if (req.signal?.aborted) {
            enqueue("\n\n> *(stopped)*");
            controller.close();
            return;
          }
          enqueue(`\n\n**Error:** ${errMessage(e)}`);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e: unknown) {
    return Response.json({ error: errMessage(e) }, { status: 500 });
  }
}