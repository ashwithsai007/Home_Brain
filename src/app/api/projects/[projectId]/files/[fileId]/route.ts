import fs from "fs";
import { db, initDb } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ projectId: string; fileId: string }> }
) {
  initDb();
  const { projectId, fileId } = await ctx.params;
  const d = db();

  const row = d
    .prepare(`SELECT disk_path FROM files WHERE id = ? AND project_id = ?`)
    .get(fileId, projectId) as { disk_path?: string } | undefined;

  d.prepare(`DELETE FROM files WHERE id = ? AND project_id = ?`).run(fileId, projectId);
  d.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(Date.now(), projectId);

  if (row?.disk_path) {
    try {
      fs.unlinkSync(row.disk_path);
    } catch {}
  }

  return Response.json({ ok: true });
}