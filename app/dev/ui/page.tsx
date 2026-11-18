"use client";
/** /dev/ui — reference sheet for the shared components (shadcn/ui + app pieces). Not linked from the app. */
import Link from "next/link";
import { Car, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog, EmptyState, Field, Page, RatingBadge, Section, StatusBadge } from "@/components/app";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export default function UiReference() {
  return (
    <Page
      title="UI reference"
      back={{ href: "/", label: "Home" }}
      footer={
        <Button size="lg" className="w-full">
          Send to customer
        </Button>
      }
    >
      <div className="flex flex-col gap-8">
        <Section title="Buttons">
          <div className="flex flex-wrap gap-2">
            <Button>
              <Plus /> Primary
            </Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">
              <Trash2 /> Destructive
            </Button>
            <Button variant="destructive-solid">Confirm delete</Button>
            <Button disabled>Disabled</Button>
            <Button asChild variant="link">
              <Link href="/">Link</Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm">
              Small
            </Button>
            <Button variant="outline">Default</Button>
            <Button variant="outline" size="lg">
              Large (tap)
            </Button>
          </div>
        </Section>
        <Section title="Ratings">
          <div className="flex flex-wrap gap-2">
            <RatingBadge rating="needs_attention" />
            <RatingBadge rating="monitor" />
            <RatingBadge rating="good" />
            <RatingBadge rating="needs_attention" size="lg" />
          </div>
        </Section>
        <Section title="Statuses & badges">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="recording" />
            <StatusBadge status="processing" />
            <StatusBadge status="ready_for_review" />
            <StatusBadge status="sent" />
            <StatusBadge status="failed" />
            <Badge variant="blue">Updated</Badge>
            <Badge variant="amber">Unsent changes</Badge>
            <Badge variant="outline">Outline</Badge>
          </div>
        </Section>
        <Section title="Fields">
          <Card>
            <CardHeader>
              <CardTitle>Customer and vehicle</CardTitle>
              <CardDescription>Each field saves when it loses focus.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field label="Customer name" htmlFor="c">
                <Input id="c" placeholder="Jane Doe" />
              </Field>
              <Field label="VIN" htmlFor="v" error="VIN must be 17 characters, no I, O or Q.">
                <Input id="v" aria-invalid defaultValue="1HGCM82633A00435" />
              </Field>
              <Field label="Note" htmlFor="n" hint="Only what you said.">
                <Textarea id="n" defaultValue="The inner edge is worn." />
              </Field>
            </CardContent>
          </Card>
        </Section>
        <Section title="Alerts">
          <Alert>
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>Neutral information.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load inspections</AlertTitle>
            <AlertDescription>Network error.</AlertDescription>
          </Alert>
        </Section>
        <Section title="Confirm dialog">
          <ConfirmDialog
            trigger={<Button variant="destructive">Delete line</Button>}
            title="Delete this line?"
            description="It and its clips will be removed from the report."
            confirmLabel="Delete line"
            onConfirm={() => undefined}
          />
        </Section>
        <Section title="Loading">
          <div className="flex flex-col gap-2">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </Section>
        <Section title="Empty state">
          <EmptyState title="No inspections yet" icon={<Car />}>
            Tap New inspection to start.
          </EmptyState>
        </Section>
      </div>
    </Page>
  );
}
