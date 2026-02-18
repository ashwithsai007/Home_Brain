import { NextRequest } from "next/server";
import { initDb, db } from "@/lib/db";
import { projectFilesDir, rmrf } from "@/lib/storage";

function json(data: any, status = 200) {
  return Response.json(data, { status });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ projectId: string }> }
) {
  try {
    initDb();
    const { projectId } = await ctx.params;

    const d = db();

    d.prepare(
      `DELETE FROM messages
       WHERE chat_id IN (SELECT id FROM chats WHERE project_id = ?)`
    ).run(projectId);

    d.prepare(`DELETE FROM chats WHERE project_id = ?`).run(projectId);

    // optional table
    try {
      d.prepare(`DELETE FROM files WHERE project_id = ?`).run(projectId);
    } catch {
      // ignore
    }

    const info = d.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    if ((info.changes ?? 0) === 0) return json({ error: "Project not found" }, 404);

    rmrf(projectFilesDir(projectId));

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || "Delete failed" }, 500);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ projectId: string }> }
) {
  try {
    initDb();
    const { projectId } = await ctx.params;

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    if (!name) return json({ error: "Missing name" }, 400);

    const d = db();
    d.prepare(`UPDATE projects SET name = ?, updated_at = ? WHERE id = ?`).run(
      name,
      Date.now(),
      projectId
    );

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || "Update failed" }, 500);
  }
}