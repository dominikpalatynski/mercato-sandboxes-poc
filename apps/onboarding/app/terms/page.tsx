import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service • Mercato Sandboxes',
};

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 py-6">
      <header className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          Legal
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          Terms of Service
        </h1>
        <p className="text-sm text-muted-foreground">
          Last updated: 2026-04-25
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. The service</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Mercato Sandboxes is a proof-of-concept service that provisions
          on-demand developer environments based on the open-source
          <a
            href="https://hackon.openmercato.com"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 font-medium text-foreground underline-offset-4 hover:underline"
          >
            Open Mercato
          </a>{' '}
          stack. Each workspace is intended for learning AI-assisted
          engineering with state-of-the-art coding agents. The service is
          provided as-is, without warranties or guarantees of availability.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. Acceptable use</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          You agree not to use the service for unlawful activity, to send
          spam, to mine cryptocurrency, to host third-party production
          workloads, or to attempt to compromise the underlying
          infrastructure or other tenants. We may suspend or delete any
          workspace that violates these rules without notice.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. No SLA, no warranty</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This is a POC. There is no uptime commitment, no support guarantee,
          and no compensation if your workspace is unavailable, slow, or
          deleted. Do not store anything you cannot afford to lose. By using
          the service you accept these limitations.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Data &amp; ephemerality</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Workspaces are ephemeral and may be wiped or recycled at any time
          for capacity, maintenance, or cost reasons. Push your work to a
          remote git repository regularly. Account data (email, name,
          company) is retained until you request deletion.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Contact</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          For questions about these terms, the project maintainers can be
          reached via the Open Mercato community channels.
        </p>
      </section>
    </article>
  );
}
