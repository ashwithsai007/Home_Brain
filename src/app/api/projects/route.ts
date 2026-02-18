import { NextRequest } from "next/server";
import { initDb, db } from "@/lib/db";

function json(data: any, status = 200) {
  return Response.json(data, { status });
}

export async function GET(_req: NextRequest) {
  try {
    initDb();
    const d = db();

    const projects = d
      .prepare(`SELECT id, name, created_at, updated_at FROM projects ORDER BY updated_at DESC`)
      .all() as any[];

    const chats = d
      .prepare(
        `SELECT id, project_id, title, created_at, updated_at
         FROM chats
         ORDER BY updated_at DESC`
      )
      .all() as any[];

    const chatsByProject = new Map<string, any[]>();
    for (const c of chats) {
      const pid = String(c.project_id);
      if (!chatsByProject.has(pid)) chatsByProject.set(pid, []);
      chatsByProject.get(pid)!.push(c);
    }

    const out = projects.map((p) => ({
      ...p,
      chats: chatsByProject.get(String(p.id)) ?? [],
    }));

    return json({ projects: out });
  } catch (e: any) {
    return json({ error: e?.message || "Failed to load projects" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    initDb();
    const d = db();

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim() || "Personal";

    const id = crypto.randomUUID();
    const ts = Date.now();

    d.prepare(
      `INSERT INTO projects (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run(id, name, ts, ts);

    return json({ project: { id, name, created_at: ts, updated_at: ts } }, 201);
  } catch (e: any) {
    return json({ error: e?.message || "Failed to create project" }, 500);
  }
}