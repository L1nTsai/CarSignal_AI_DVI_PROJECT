import { describe, expect, it } from "vitest";
import { AbortedError, TransportError, UploadQueue, type Transport } from "./uploadQueue";

/** Fake server: tracks which numbers it holds; scripted failures per call. */
function fakeTransport() {
  const server = new Set<number>();
  const log: string[] = [];
  const failures: (TransportError | null)[] = []; // consumed per upload call
  let gate: { n: number; release: () => void; signal: AbortSignal } | null = null;
  let holdNext = false;

  const t: Transport = {
    async upload(n, _blob, _mime, onProgress, signal) {
      log.push(`up${n}`);
      if (holdNext) {
        holdNext = false;
        await new Promise<void>((resolve, reject) => {
          gate = { n, release: resolve, signal };
          signal.addEventListener("abort", () => reject(new AbortedError()));
        });
      }
      const f = failures.shift();
      if (f) throw f;
      if (server.has(n)) throw new TransportError(`Part ${n} is already uploaded`, 409, "already_uploaded");
      if (n !== server.size + 1) throw new TransportError(`Expected part ${server.size + 1}`, 409);
      onProgress(1);
      server.add(n);
    },
    async remove(n) {
      log.push(`del${n}`);
      server.delete(n);
    },
  };
  return {
    t,
    server,
    log,
    failures,
    hold: () => (holdNext = true),
    gate: () => gate,
  };
}

const blob = () => new Blob(["x"]);
const fastQueue = (t: Transport) => new UploadQueue(t, { sleep: async () => {}, maxRetries: 3 });

describe("UploadQueue", () => {
  it("uploads pieces one at a time, in order", async () => {
    const f = fakeTransport();
    const q = fastQueue(f.t);
    q.add(blob(), "video/mp4", 1000);
    q.add(blob(), "video/mp4", 1000);
    q.add(blob(), "video/mp4", 1000);
    expect(await q.waitIdle()).toBe(true);
    expect(f.log).toEqual(["up1", "up2", "up3"]);
    expect(q.getPieces().map((p) => p.state)).toEqual(["uploaded", "uploaded", "uploaded"]);
  });

  it("retries network errors, then succeeds", async () => {
    const f = fakeTransport();
    f.failures.push(new TransportError("offline", 0), new TransportError("bad gateway", 502));
    const q = fastQueue(f.t);
    q.add(blob(), "video/mp4", 1000);
    expect(await q.waitIdle()).toBe(true);
    expect(f.log).toEqual(["up1", "up1", "up1"]);
  });

  it("fails after max retries and stops the queue until retryFailed", async () => {
    const f = fakeTransport();
    for (let i = 0; i < 4; i++) f.failures.push(new TransportError("offline", 0));
    const q = fastQueue(f.t);
    q.add(blob(), "video/mp4", 1000);
    q.add(blob(), "video/mp4", 1000);
    expect(await q.waitIdle()).toBe(false);
    expect(q.getPieces().map((p) => p.state)).toEqual(["failed", "queued"]);
    expect(f.log).toEqual(["up1", "up1", "up1", "up1"]); // piece 2 never sent

    q.retryFailed();
    expect(await q.waitIdle()).toBe(true);
    expect([...f.server]).toEqual([1, 2]);
  });

  it("does not retry other 4xx errors", async () => {
    const f = fakeTransport();
    f.failures.push(new TransportError("Recording has already finished", 409, "not_recording"));
    const q = fastQueue(f.t);
    q.add(blob(), "video/mp4", 1000);
    expect(await q.waitIdle()).toBe(false);
    expect(f.log).toEqual(["up1"]);
    expect(q.failureMessage).toBe("Recording has already finished");
  });

  it("retake of an unsent piece just forgets it and reuses its number", async () => {
    const f = fakeTransport();
    f.hold();
    const q = fastQueue(f.t);
    q.add(blob(), "video/mp4", 1000); // 1, held in flight
    q.add(blob(), "video/mp4", 1000); // 2, queued
    expect(q.retakeLast()).toBe(2);
    expect(q.nextNumber).toBe(2);
    f.gate()!.release();
    expect(await q.waitIdle()).toBe(true);
    expect(f.log).toEqual(["up1"]);
  });

  it("retake of an uploaded piece deletes it on the server before the replacement", async () => {
    const f = fakeTransport();
    const q = fastQueue(f.t);
    q.add(blob(), "video/mp4", 1000);
    q.add(blob(), "video/mp4", 1000);
    await q.waitIdle();
    q.retakeLast();
    q.add(blob(), "video/mp4", 1500);
    expect(await q.waitIdle()).toBe(true);
    expect(f.log).toEqual(["up1", "up2", "del2", "up2"]);
    expect(q.getPieces().map((p) => p.durationMs)).toEqual([1000, 1500]);
  });

  it("retake of an in-flight piece aborts it and deletes it on the server", async () => {
    const f = fakeTransport();
    f.hold();
    const q = fastQueue(f.t);
    q.add(blob(), "video/mp4", 1000);
    await Promise.resolve();
    expect(f.gate()?.n).toBe(1);
    q.retakeLast();
    expect(await q.waitIdle()).toBe(true);
    expect(f.log).toEqual(["up1", "del1"]);
    expect(q.getPieces()).toEqual([]);
  });

  it("on 'already uploaded', deletes the server copy and re-uploads", async () => {
    const f = fakeTransport();
    f.server.add(1); // e.g. a lost response from an earlier attempt
    const q = fastQueue(f.t);
    q.add(blob(), "video/mp4", 1000);
    expect(await q.waitIdle()).toBe(true);
    expect(f.log).toEqual(["up1", "del1", "up1"]);
  });

  it("seeded pieces continue numbering; seeded deletes run first", async () => {
    const f = fakeTransport();
    f.server.add(1).add(2).add(3);
    const q = fastQueue(f.t);
    q.seed([
      { n: 1, durationMs: null, mimeType: "video/mp4" },
      { n: 2, durationMs: 2000, mimeType: "video/mp4" },
    ]);
    q.seedDeletes([3]);
    q.add(blob(), "video/mp4", 1000);
    expect(await q.waitIdle()).toBe(true);
    expect(f.log).toEqual(["del3", "up3"]);
    expect(q.getPieces().map((p) => p.n)).toEqual([1, 2, 3]);
  });

  it("waitIdle resolves true immediately when there is nothing to do", async () => {
    const q = fastQueue(fakeTransport().t);
    expect(await q.waitIdle()).toBe(true);
  });
});
