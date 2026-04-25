import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy • Mercato Sandboxes',
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 py-6">
      <header className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          Legal
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          Privacy Policy
        </h1>
        <p className="text-sm text-muted-foreground">
          Last updated: 2026-04-25
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">What we collect</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          When you sign up we collect your email address, first and last
          name, and (optionally) the company you work for. Our reverse proxy
          and application servers also log request metadata including IP
          addresses and timestamps, which are retained for short-term
          security and debugging.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">How we use it</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          We use this information solely to provision your workspaces, to
          authenticate you, and — if needed — to contact you about the
          service. We do not profile you, run analytics on your behaviour,
          or share your data with advertisers.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Retention &amp; deletion</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          When your account is deleted, your personal data is removed from
          our database and any sandboxes you provisioned are destroyed.
          Request server logs are rotated within a few days.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">No third-party sharing</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          We do not sell, rent, or transfer your personal data to third
          parties. The only data leaving the service is what you yourself
          send when you use AI agents inside a workspace with your own API
          keys; in that case the AI provider&apos;s privacy policy applies.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Contact</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          For privacy questions or deletion requests, reach out via the Open
          Mercato community channels.
        </p>
      </section>
    </article>
  );
}
