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
import { Check, Copy, ExternalLink, Link2, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiSend } from "@/lib/fetcher";
import { sendBlockers } from "@/lib/sharing/sendReadiness";
import type { SendResponse } from "@/lib/sharing/types";
import type { InspectionDetail } from "@/lib/types/api";
import { QrCode } from "@/components/shared/QrCode";

/** Send state shared by the bottom bar (phones) and the header actions (laptop studio). */
function useSend(detail: InspectionDetail, onSent?: () => void | Promise<unknown>) {
  const id = detail.inspection.id;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState<SendResponse | null>(null);
  const [showLink, setShowLink] = useState(false);

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

  return {
    send,
    sending,
    error,
    justSent,
    showLink,
    setShowLink,
    blockers: sendBlockers(detail),
    sentBefore: detail.sending.latest_version !== null,
    shareUrl: justSent?.shareUrl ?? detail.sending.share_url,
  };
}

export function SendBar({ detail, onSent }: { detail: InspectionDetail; onSent?: () => void | Promise<unknown> }) {
  const { send, sending, error, justSent, showLink, setShowLink, blockers, sentBefore, shareUrl } = useSend(detail, onSent);
  const linkOpen = showLink;

  return (
    <div className="flex flex-col gap-3">
      {justSent ? (
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-green-fg">
          <Check className="size-4" />
          {justSent.version_number === 1 ? "Sent to customer." : `Update sent as version ${justSent.version_number}.`}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {blockers.length > 0 && !sending ? (
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted-foreground" aria-label="Why you can't send yet">
          {blockers.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}

      {shareUrl && linkOpen ? <ShareLink url={shareUrl} /> : null}

      <div className="flex items-center gap-2">
        {shareUrl ? (
          <Button variant="outline" size="lg" onClick={() => setShowLink((v) => !v)} aria-expanded={linkOpen}>
            <Link2 />
            {linkOpen ? "Hide link" : "Customer link"}
          </Button>
        ) : null}
        <Button
          size="lg"
          className="flex-1"
          onClick={send}
          disabled={sending || blockers.length > 0}
        >
          <Send />
          {sending ? "Sending…" : sentBefore ? "Send update" : "Send to customer"}
        </Button>
      </div>
      {detail.sending.latest_version && !justSent ? (
        <p className="text-xs text-muted-foreground">
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
    <div className="flex flex-col gap-4 rounded-xl bg-muted/60 p-4 ring-1 ring-foreground/10 sm:flex-row sm:items-center">
      <QrCode value={url} size={128} className="shrink-0 self-center" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium">Customer link</p>
        <div className="flex gap-2">
          <Input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Customer link"
            className="min-w-0 flex-1 bg-background font-mono md:text-sm"
          />
          <Button variant="outline" onClick={copy}>
            {copied === "ok" ? <Check /> : <Copy />}
            {copied === "ok" ? "Copied" : "Copy"}
          </Button>
        </div>
        {copied === "fail" ? <p className="text-xs text-muted-foreground">Couldn&apos;t copy. Select the link and copy it.</p> : null}
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-sm text-link hover:underline">
          Open customer view <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  );
}

/**
 * Header version for the laptop studio: "Customer link" (opens the link, QR
 * and Copy in a popover) and "Send update". When sending isn't possible yet,
 * hovering the disabled button lists why.
 */
export function SendActions({ detail, onSent }: { detail: InspectionDetail; onSent?: () => void | Promise<unknown> }) {
  const { send, sending, error, justSent, showLink, setShowLink, blockers, sentBefore, shareUrl } = useSend(detail, onSent);
  const blocked = blockers.length > 0;

  const sendButton = (
    <Button size="sm" onClick={send} disabled={sending || blocked}>
      <Send />
      {sending ? (
        "Sending…"
      ) : sentBefore ? (
        <>
          Send<span className="max-sm:hidden"> update</span>
        </>
      ) : (
        <>
          Send<span className="max-sm:hidden"> to customer</span>
        </>
      )}
    </Button>
  );

  return (
    <>
      <div className="flex items-center gap-2">
        {error ? (
          <span role="alert" className="max-w-64 truncate text-xs text-destructive" title={error}>
            {error}
          </span>
        ) : justSent ? (
          <span role="status" className="flex items-center gap-1 text-xs font-medium text-green-fg">
            <Check className="size-3.5" />
            {justSent.version_number === 1 ? "Sent" : `Sent as version ${justSent.version_number}`}
          </span>
        ) : null}
        {shareUrl ? (
          <Popover open={showLink} onOpenChange={setShowLink}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Customer link">
                <Link2 />
                <span className="max-sm:hidden">Customer link</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[440px] p-0">
              <ShareLink url={shareUrl} />
            </PopoverContent>
          </Popover>
        ) : null}
        {blocked && !sending ? (
          <Popover>
            <PopoverTrigger asChild>
              {/* A disabled button swallows taps, so the wrapper takes them (and shows the reasons on touch screens). */}
              <span role="button" tabIndex={0} aria-label="Why can't I send yet?" className="rounded-md">
                <span className="pointer-events-none block">{sendButton}</span>
              </span>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 text-sm">
              <p className="mb-1 font-medium">Can&apos;t send yet</p>
              <ul className="list-disc pl-4">
                {blockers.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        ) : (
          sendButton
        )}
      </div>
    </>
  );
}
