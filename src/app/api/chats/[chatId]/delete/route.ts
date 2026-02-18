// src/app/api/chats/[chatId]/delete/route.ts
import { NextRequest } from "next/server";
import { initDb, db } from "@/lib/db";

export const runtime = "nodejs";

function json(data: any, status = 200) {
  return Response.json(data, { status });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    initDb();
    const { chatId } = await ctx.params;
    const id = String(chatId || "").trim();
    if (!id) return json({ error: "Missing chatId" }, 400);

    const d = db();
    const row = d.prepare(`SELECT project_id FROM chats WHERE id = ?`).get(id) as any;
    if (!row) return json({ error: "Chat not found" }, 404);

    d.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(id);

    const info = d.prepare(`DELETE FROM chats WHERE id = ?`).run(id);
    if ((info.changes ?? 0) === 0) return json({ error: "Chat not found" }, 404);

    d.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(Date.now(), String(row.project_id));

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || "Delete failed" }, 500);
  }
}