// src/app/api/projects/[projectId]/chats/route.ts
import { db, initDb } from "@/lib/db";

export const runtime = "nodejs";

function json(data: any, status = 200) {
  return Response.json(data, { status });
}

type CreateChatBody = {
  title?: string;
  provider?: string; // "openai" | "anthropic"
  model?: string;    // depends on provider
};

function normalizeProvider(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "openai";
  return s;
}

function normalizeModel(v: any, provider: string) {
  const s = String(v ?? "").trim();
  if (s) return s;

  // defaults
  if (provider === "anthropic") return "claude-3-5-sonnet-latest";
  return "gpt-5-mini";
}

function validate(provider: string, model: string) {
  const allowedProviders = new Set(["openai", "anthropic"]);
  if (!allowedProviders.has(provider)) {
    return { ok: false, error: `Invalid provider. Allowed: ${Array.from(allowedProviders).join(", ")}` };
  }

  const openaiModels = new Set(["gpt-5-mini", "gpt-5.2", "gpt-4.1"]);
  const anthropicModels = new Set(["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]);

  if (provider === "openai" && !openaiModels.has(model)) {
    return { ok: false, error: `Invalid OpenAI model.` };
  }
  if (provider === "anthropic" && !anthropicModels.has(model)) {
    return { ok: false, error: `Invalid Claude model.` };
  }

  return { ok: true, error: "" };
}

export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  try {
    initDb();

    const { projectId } = await ctx.params;
    const pid = String(projectId || "").trim();
    if (!pid) return json({ error: "Missing projectId" }, 400);

    const d = db();

    const project = d.prepare(`SELECT id FROM projects WHERE id = ?`).get(pid);
    if (!project) return json({ error: "Project not found" }, 404);

    const body = (await req.json().catch(() => ({}))) as CreateChatBody;

    const title = String(body?.title ?? "New chat").trim() || "New chat";
    const provider = normalizeProvider(body?.provider);
    const model = normalizeModel(body?.model, provider);

    const v = validate(provider, model);
    if (!v.ok) return json({ error: v.error }, 400);

    const t = Date.now();
    const chatId = crypto.randomUUID();

    d.prepare(
      `INSERT INTO chats (id, project_id, title, created_at, updated_at, provider, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(chatId, pid, title, t, t, provider, model);

    d.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(t, pid);

    return json(
      {
        chat: {
          id: chatId,
          project_id: pid,
          title,
          created_at: t,
          updated_at: t,
          provider,
          model,
        },
        messages: [],
      },
      201
    );
  } catch (e: any) {
    return json({ error: e?.message || "Failed to create chat" }, 500);
  }
}