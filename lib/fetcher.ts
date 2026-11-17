/**
 * SWR fetcher for the JSON API. Throws an Error carrying the API's
 * `{ error }` message and the HTTP status. Safe in client components.
 */
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new ApiRequestError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

/** JSON request helper for mutations (POST/PATCH/DELETE). */
export async function apiSend<T = unknown>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {}
    throw new ApiRequestError(msg, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
