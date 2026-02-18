import fs from "fs";
import path from "path";
import { dataDir, db, initDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  initDb();
  const { projectId } = await ctx.params;
  const d = db();

  const files = d
    .prepare(`SELECT id, name, mime, size, created_at FROM files WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId);

  return Response.json({ files });
}

export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  initDb();
  const { projectId } = await ctx.params;
  const d = db();

  const form = await req.formData();
  const incoming = form.getAll("files").filter(Boolean) as File[];

  if (incoming.length === 0) {
    return Response.json({ error: "No files uploaded" }, { status: 400 });
  }

  const saved: any[] = [];
  for (const f of incoming) {
    const buf = Buffer.from(await f.arrayBuffer());
    const id = crypto.randomUUID();
    const dir = path.join(dataDir(), "files", projectId);
    fs.mkdirSync(dir, { recursive: true });

    const safeName = f.name.replaceAll("/", "_");
    const diskPath = path.join(dir, `${id}-${safeName}`);
    fs.writeFileSync(diskPath, buf);

    const createdAt = Date.now();
    d.prepare(
      `INSERT INTO files (id, project_id, name, mime, size, disk_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, f.name, f.type || "application/octet-stream", f.size, diskPath, createdAt);

    d.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(createdAt, projectId);

    saved.push({ id, name: f.name, mime: f.type, size: f.size, created_at: createdAt });
  }

  return Response.json({ saved });
}