import path from "path";
import fs from "fs";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export function dataDir() {
  return requireEnv("HOME_BRAIN_DATA_DIR");
}

export function filesRootDir() {
  // Store uploads under HOME_BRAIN_DATA_DIR/files
  return path.join(dataDir(), "files");
}

export function projectFilesDir(projectId: string) {
  return path.join(filesRootDir(), projectId);
}

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

export function rmrf(p: string) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}