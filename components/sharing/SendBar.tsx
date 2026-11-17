"use client";
/**
 * Bottom bar for the inspection editor (plan §10): "Send to customer", which
 * becomes "Send update" after the first send. Disabled with a list of reasons
 * when send_report() would refuse. Once sent, shows the customer link with
 * Copy and a QR code.
 *
 * Mount it in <Page footer={…}> and pass the polled InspectionDetail plus the
 * SWR mutate, so the page refreshes after a send.
 */
import { useState } from "react";
import { Button } from "@/components/ui";
import { apiSend } from "@/lib/fetcher";
import { sendBlockers } from "@/lib/sharing/sendReadiness";
import type { SendResponse } from "@/lib/sharing/types";
import type { InspectionDetail } from "@/lib/types/api";
import { QrCode } from "./QrCode";

export function SendBar({ detail, onSent }: { detail: InspectionDetail; onSent?: () => void | Promise<unknown> }) {
  const id = detail.inspection.id;
  const sentBefore = detail.sending.latest_version !== null;
  const blockers = sendBlockers(detail);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState<SendResponse | null>(null);
  const [showLink, setShowLink] = useState(false);

  const shareUrl = justSent?.shareUrl ?? detail.sending.share_url;
  const linkOpen = showLink;

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await apiSend<SendResponse>(`/api/inspections/${id}/send`, "POST");
      setJustSent(res);
      setShowLink(true);
      await onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {justSent ? (
        <p role="status" className="text-sm font-medium text-green-fg">
          {justSent.version_number === 1 ? "Sent to customer." : `Update sent as version ${justSent.version_number}.`}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-fg">
          {error}
        </p>
      ) : null}

      {blockers.length > 0 && !sending ? (
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted" aria-label="Why you can't send yet">
          {blockers.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}

      {shareUrl && linkOpen ? <ShareLink url={shareUrl} /> : null}

      <div className="flex items-center gap-2">
        {shareUrl ? (
          <Button size="lg" onClick={() => setShowLink((v) => !v)} aria-expanded={linkOpen}>
            {linkOpen ? "Hide link" : "Customer link"}
          </Button>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          onClick={send}
          disabled={sending || blockers.length > 0}
        >
          {sending ? "Sending…" : sentBefore ? "Send update" : "Send to customer"}
        </Button>
      </div>
      {detail.sending.latest_version && !justSent ? (
        <p className="text-xs text-subtle">
          Version {detail.sending.latest_version.version_number} sent
          {detail.sending.unsent_changes ? " · You have unsent changes" : ""}
        </p>
      ) : null}
    </div>
  );
}

function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      // Clipboard needs a secure context; the URL stays selectable below.
      setCopied("fail");
    }
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center">
      <QrCode value={url} size={128} className="shrink-0 self-center" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium">Customer link</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Customer link"
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-sm"
          />
          <Button onClick={copy}>{copied === "ok" ? "Copied" : "Copy"}</Button>
        </div>
        {copied === "fail" ? <p className="text-xs text-muted">Couldn&apos;t copy. Select the link and copy it.</p> : null}
        <a href={url} target="_blank" rel="noreferrer" className="self-start text-sm text-link hover:underline">
          Open customer view
        </a>
      </div>
    </div>
  );
}
