import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Session } from "./session-types";
import { WorkflowError } from "./validation";
import { normalizeMessages } from "./messages";

export const dataDirectory = () => process.env.WORKFLOW_DATA_DIR || path.join(process.cwd(), "local-output");
const sessionDirectory = () => path.join(dataDirectory(), "sessions");
export function sessionId(id: unknown): string {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new WorkflowError("Invalid session ID.");
  return id;
}
export async function saveSession(session: Session) {
  session.messages = normalizeMessages(session.messages);
  await mkdir(sessionDirectory(), { recursive: true });
  session.updatedAt = new Date().toISOString();
  const filename = path.join(sessionDirectory(), `${sessionId(session.id)}.json`);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(session, null, 2));
  await rename(temporary, filename);
}
export async function createSession(): Promise<Session> {
  const now = new Date().toISOString();
  const session: Session = { id: randomUUID(), createdAt: now, updatedAt: now, messages: [], preferences: {}, variants: [], events: [] };
  await saveSession(session);
  return session;
}
export async function loadSession(id: string): Promise<Session> {
  try {
    const session: Session = JSON.parse(await readFile(path.join(sessionDirectory(), `${sessionId(id)}.json`), "utf8"));
    session.messages = normalizeMessages(session.messages);
    return session;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new WorkflowError("Session not found.", 404);
    throw error;
  }
}
export async function listSessions() {
  await mkdir(sessionDirectory(), { recursive: true });
  const files = await readdir(sessionDirectory());
  const sessions = await Promise.all(files.filter(name => name.endsWith(".json")).map(name => loadSession(name.slice(0, -5))));
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, updatedAt, research }) => ({ id, updatedAt, title: research?.sources[0]?.title || "New session" }));
}
// Single-process local PoC: reject overlapping turns, including other browser tabs.
const globals = globalThis as typeof globalThis & { workflowLocks?: Set<string> };
const locks = globals.workflowLocks ??= new Set<string>();
export function lockSession(id: string) {
  sessionId(id);
  if (locks.has(id)) throw new WorkflowError("This session is busy. Wait for the current turn to finish.", 409);
  locks.add(id);
  return () => { locks.delete(id); };
}
