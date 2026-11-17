/**
 * Supabase Storage helpers (service-role, server-only). Never import from a
 * client component. Paths are built with lib/paths.ts.
 *
 * Files are never overwritten (upsert: false): every re-cut gets a new path.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { env } from "./env";

const g = globalThis as unknown as { __carsignalSupabase?: SupabaseClient };

export function supabase(): SupabaseClient {
  if (!g.__carsignalSupabase) {
    g.__carsignalSupabase = createClient(env().SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return g.__carsignalSupabase;
}

function bucket() {
  return supabase().storage.from(env().STORAGE_BUCKET);
}

/** Authenticated REST URL for an object (used by the media proxy and streaming uploads). */
export function objectUrl(path: string): string {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  return `${env().SUPABASE_URL}/storage/v1/object/authenticated/${env().STORAGE_BUCKET}/${enc}`;
}

function objectWriteUrl(path: string): string {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  return `${env().SUPABASE_URL}/storage/v1/object/${env().STORAGE_BUCKET}/${enc}`;
}

function authHeaders(): Record<string, string> {
  const key = env().SUPABASE_SERVICE_ROLE_KEY;
  return { authorization: `Bearer ${key}`, apikey: key };
}

/**
 * Stream a request body (or any web ReadableStream) straight into Storage
 * without buffering the whole file. Use for segment uploads.
 */
export async function uploadStream(
  path: string,
  body: ReadableStream<Uint8Array>,
  contentType: string,
  contentLength?: number,
): Promise<void> {
  const headers: Record<string, string> = {
    ...authHeaders(),
    "content-type": contentType,
    "x-upsert": "false",
  };
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  const res = await fetch(objectWriteUrl(path), {
    method: "POST",
    headers,
    body,
    // Required by Node's fetch for streaming request bodies.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!res.ok) throw new Error(`Storage upload failed for ${path}: ${res.status} ${await res.text()}`);
}

/** Upload a local file (worker: stitched video, clips, frames). Streams from disk. */
export async function uploadFile(path: string, localPath: string, contentType: string): Promise<void> {
  const { size } = await stat(localPath);
  const nodeStream = createReadStream(localPath);
  const { Readable } = await import("node:stream");
  const web = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  await uploadStream(path, web, contentType, size);
}

/** Download an object to a local file (worker). */
export async function downloadToFile(path: string, localPath: string): Promise<void> {
  const res = await fetch(objectUrl(path), { headers: authHeaders() });
  if (!res.ok || !res.body) throw new Error(`Storage download failed for ${path}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(localPath, buf);
}

/** Delete specific objects. Missing objects are ignored. */
export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await bucket().remove(paths.slice(i, i + 500));
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }
}

/** Recursively list every object path under a prefix (e.g. `${inspectionId}`). */
export async function listAll(prefix: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket().list(dir, { limit: 1000, offset });
      if (error) throw new Error(`Storage list failed for ${dir}: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const entry of data) {
        const full = dir ? `${dir}/${entry.name}` : entry.name;
        // Folders have no id in Supabase's list response.
        if (entry.id === null) await walk(full);
        else out.push(full);
      }
      if (data.length < 1000) break;
    }
  };
  await walk(prefix.replace(/\/+$/, ""));
  return out;
}

/** Delete everything under `{inspectionId}/` (used by DELETE /api/inspections/[id]). */
export async function removePrefix(prefix: string): Promise<void> {
  await removeObjects(await listAll(prefix));
}

export { authHeaders as storageAuthHeaders };
