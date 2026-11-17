/** /dev/ui — reference sheet for the shared components. Not linked from the app. */
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  Input,
  Page,
  RatingBadge,
  Section,
  StatusBadge,
  Textarea,
} from "@/components/ui";

export default function UiReference() {
  return (
    <Page title="UI reference" back={{ href: "/", label: "Home" }} footer={<Button variant="primary" size="lg" full>Send to customer</Button>}>
      <div className="flex flex-col gap-8">
        <Section title="Buttons">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Delete</Button>
            <Button disabled>Disabled</Button>
            <ButtonLink href="/">Link</ButtonLink>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large (tap)</Button>
          </div>
        </Section>
        <Section title="Ratings">
          <div className="flex flex-wrap gap-2">
            <RatingBadge rating="needs_attention" />
            <RatingBadge rating="monitor" />
            <RatingBadge rating="good" />
            <RatingBadge rating="needs_attention" size="md" />
          </div>
        </Section>
        <Section title="Statuses & badges">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="recording" />
            <StatusBadge status="processing" />
            <StatusBadge status="ready_for_review" />
            <StatusBadge status="sent" />
            <StatusBadge status="failed" />
            <Badge tone="blue">Updated</Badge>
            <Badge tone="blue">New</Badge>
            <Badge tone="amber">Unsent changes</Badge>
          </div>
        </Section>
        <Section title="Fields">
          <Card className="flex flex-col gap-4 p-4">
            <Field label="Customer name" htmlFor="c">
              <Input id="c" placeholder="Jane Doe" />
            </Field>
            <Field label="VIN" htmlFor="v" error="VIN must be 17 characters, no I, O or Q.">
              <Input id="v" aria-invalid defaultValue="1HGCM82633A00435" />
            </Field>
            <Field label="Note" htmlFor="n" hint="Only what you said.">
              <Textarea id="n" defaultValue="The inner edge is worn." />
            </Field>
          </Card>
        </Section>
        <Section title="Empty state">
          <EmptyState title="No inspections yet">Tap New inspection to start.</EmptyState>
        </Section>
      </div>
    </Page>
  );
}
