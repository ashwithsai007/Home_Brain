// src/app/api/chats/[chatId]/route.ts
import { NextRequest } from "next/server";
import { initDb, db } from "@/lib/db";

export const runtime = "nodejs";

function json(data: any, status = 200) {
  return Response.json(data, { status });
}

async function getChatId(ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  return String(chatId || "").trim();
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    initDb();
    const chatId = await getChatId(ctx);
    if (!chatId) return json({ error: "Missing chatId" }, 400);

    const d = db();

    const chat = d
      .prepare(
        `SELECT id, project_id, title, created_at, updated_at,
                COALESCE(provider, 'openai') as provider,
                COALESCE(model, 'gpt-5-mini') as model
         FROM chats
         WHERE id = ?`
      )
      .get(chatId) as any;

    if (!chat) return json({ error: "Chat not found" }, 404);

    let messages: any[] = [];
    try {
      messages = d
        .prepare(
          `SELECT id, role, content, ts
           FROM messages
           WHERE chat_id = ?
           ORDER BY ts ASC`
        )
        .all(chatId) as any[];
    } catch {
      messages = [];
    }

    return json({ chat, messages });
  } catch (e: any) {
    return json({ error: e?.message || "Failed to load chat" }, 500);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    initDb();
    const chatId = await getChatId(ctx);
    if (!chatId) return json({ error: "Missing chatId" }, 400);

    const body = await req.json().catch(() => ({}));

    const titleRaw = body?.title;
    const providerRaw = body?.provider;
    const modelRaw = body?.model;

    const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
    const provider = typeof providerRaw === "string" ? providerRaw.trim() : "";
    const model = typeof modelRaw === "string" ? modelRaw.trim() : "";

    const hasTitle = typeof titleRaw === "string";
    const hasProvider = typeof providerRaw === "string";
    const hasModel = typeof modelRaw === "string";

    if (!hasTitle && !hasProvider && !hasModel) {
      return json({ error: "Nothing to update" }, 400);
    }

    // validate provider/model if provided
    const allowedProviders = new Set(["openai", "anthropic"]);
    if (hasProvider && provider && !allowedProviders.has(provider)) {
      return json({ error: `Invalid provider. Allowed: ${Array.from(allowedProviders).join(", ")}` }, 400);
    }

    const allowedModels = new Set([
      // OpenAI
      "gpt-5-mini", "gpt-5.2", "gpt-4.1",
      // Claude (examples you can adjust later)
      "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"
    ]);
    if (hasModel && model && !allowedModels.has(model)) {
      return json({ error: `Invalid model. Allowed list is controlled by server.` }, 400);
    }

    if (hasTitle && !title) return json({ error: "Missing title" }, 400);

    const d = db();
    const t = Date.now();

    // Ensure chat exists + get project_id
    const row = d
      .prepare(`SELECT id, project_id FROM chats WHERE id = ?`)
      .get(chatId) as any;

    if (!row) return json({ error: "Chat not found" }, 404);

    // Build update
    const sets: string[] = [];
    const vals: any[] = [];

    if (hasTitle) {
      sets.push("title = ?");
      vals.push(title);
    }
    if (hasProvider) {
      sets.push("provider = ?");
      vals.push(provider || "openai");
    }
    if (hasModel) {
      sets.push("model = ?");
      vals.push(model || "gpt-5-mini");
    }

    sets.push("updated_at = ?");
    vals.push(t);

    vals.push(chatId);

    const sql = `UPDATE chats SET ${sets.join(", ")} WHERE id = ?`;
    const info = d.prepare(sql).run(...vals);

    if ((info.changes ?? 0) === 0) return json({ error: "Chat not found" }, 404);

    // bump project updated_at
    try {
      d.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(t, String(row.project_id));
    } catch {}

    // return updated fields
    const updated = d
      .prepare(
        `SELECT id, project_id, title, created_at, updated_at,
                COALESCE(provider, 'openai') as provider,
                COALESCE(model, 'gpt-5-mini') as model
         FROM chats WHERE id = ?`
      )
      .get(chatId);

    return json({ ok: true, chat: updated });
  } catch (e: any) {
    return json({ error: e?.message || "Update failed" }, 500);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    initDb();
    const chatId = await getChatId(ctx);
    if (!chatId) return json({ error: "Missing chatId" }, 400);

    const d = db();

    const row = d
      .prepare(`SELECT project_id FROM chats WHERE id = ?`)
      .get(chatId) as any;

    try {
      d.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(chatId);
    } catch {}

    const info = d.prepare(`DELETE FROM chats WHERE id = ?`).run(chatId);
    if ((info.changes ?? 0) === 0) return json({ error: "Chat not found" }, 404);

    try {
      if (row?.project_id) {
        d.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(Date.now(), String(row.project_id));
      }
    } catch {}

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || "Delete failed" }, 500);
  }
}