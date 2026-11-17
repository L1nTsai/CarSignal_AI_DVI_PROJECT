/**
 * Browser Transport for UploadQueue: XHR (for upload progress) to
 * POST /api/inspections/[id]/segments?n= and DELETE .../segments/[n].
 */
import { AbortedError, TransportError, type Transport } from "@/lib/recorder/uploadQueue";

function parseError(status: number, text: string): TransportError {
  try {
    const body = JSON.parse(text);
    if (body?.error) return new TransportError(body.error, status, body.code);
  } catch {}
  return new TransportError(`Upload failed (${status})`, status);
}

export function createSegmentTransport(inspectionId: string): Transport {
  const base = `/api/inspections/${inspectionId}/segments`;
  return {
    upload(n, blob, mimeType, onProgress, signal) {
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${base}?n=${n}`);
        xhr.setRequestHeader("content-type", mimeType);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(parseError(xhr.status, xhr.responseText)));
        xhr.onerror = () => reject(new TransportError("Network error", 0));
        xhr.ontimeout = () => reject(new TransportError("Timed out", 0));
        xhr.onabort = () => reject(new AbortedError());
        if (signal.aborted) return reject(new AbortedError());
        signal.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(blob);
      });
    },

    async remove(n) {
      let res: Response;
      try {
        res = await fetch(`${base}/${n}`, { method: "DELETE" });
      } catch {
        throw new TransportError("Network error", 0);
      }
      if (res.ok || res.status === 404) return;
      throw parseError(res.status, await res.text());
    },
  };
}
