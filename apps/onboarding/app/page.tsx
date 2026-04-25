import Link from 'next/link';
import { ArrowRight, Sparkles, Bot, Code2 } from 'lucide-react';

import { getSession } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default async function Home() {
  const session = await getSession();

  return (
    <div className="space-y-24 pb-16">
      {/* Hero */}
      <section className="relative isolate overflow-hidden pt-12 sm:pt-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 mx-auto h-[600px] w-[600px] -translate-y-1/2 rounded-full opacity-25 blur-3xl"
          style={{
            background:
              'conic-gradient(from 90deg at 50% 50%, #B4F372, #EEFB63, #BC9AFF, #B4F372)',
          }}
        />
        <div className="mx-auto max-w-4xl space-y-8 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            Open Mercato • Developer Sandboxes
          </p>
          <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight md:text-7xl">
            <span className="bg-brand-gradient bg-clip-text text-transparent">
              Learn AI-Assisted
            </span>
            <br />
            <span className="text-foreground">Engineering</span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Industry-standard developer sandboxes for working with
            state-of-the-art coding agents on large-scale projects built on
            Open Mercato.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            {session ? (
              <Button size="lg" asChild>
                <Link href="/dashboard">
                  Open dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button size="lg" asChild>
                  <Link href="/signup">
                    Get started — Sign up
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/login">I have an account</Link>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Live console mock */}
        <div className="mx-auto mt-16 max-w-2xl">
          <div className="overflow-hidden rounded-card border border-border bg-card shadow-card">
            <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#EEFB63]" />
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <span className="ml-3 font-mono text-xs text-muted-foreground">
                ~/sandbox
              </span>
            </div>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-sm leading-6 text-foreground">
              <span className="text-muted-foreground">$</span>{' '}
              <span className="text-foreground">npx</span>{' '}
              <span className="text-accent">create-mercato-app</span>{' '}
              <span className="text-muted-foreground">my-store</span>
              {'\n'}
              <span className="text-muted-foreground">
                ✓ provisioning workspace
              </span>
              {'\n'}
              <span className="text-muted-foreground">
                ✓ pre-installing opencode, codex, claude
              </span>
              {'\n'}
              <span className="text-primary">
                ↳ ready in 2m 41s — open in vscode ▍
              </span>
            </pre>
          </div>
        </div>
      </section>

      {/* What's inside */}
      <section className="space-y-8">
        <div className="space-y-2 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            What&apos;s inside
          </p>
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Everything pre-wired, nothing to install
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <Sparkles className="mb-2 h-5 w-5 text-primary" />
              <CardTitle className="text-xl">
                Pre-warmed Mercato sandboxes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Each signup gets a fresh Open Mercato dev environment in a
                Coder workspace. Postgres, Redis, code-server — all running.
              </CardDescription>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Bot className="mb-2 h-5 w-5 text-primary" />
              <CardTitle className="text-xl">
                AI agents at your fingertips
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                opencode, codex, and claude code CLIs are pre-installed in
                every workspace. Bring your OpenAI / Anthropic key and start
                prompting.
              </CardDescription>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Code2 className="mb-2 h-5 w-5 text-primary" />
              <CardTitle className="text-xl">
                Browser-based VS Code
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Open the workspace in a tab. Edit files, run commands, watch
                the splash screen build your app — no local setup.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border pt-8">
        <div className="flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <p>© 2026 Mercato Sandboxes • POC</p>
          <nav className="flex items-center gap-4">
            <Link
              href="/terms"
              className="hover:text-foreground hover:underline underline-offset-4"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="hover:text-foreground hover:underline underline-offset-4"
            >
              Privacy
            </Link>
            <Link
              href="/login"
              className="hover:text-foreground hover:underline underline-offset-4"
            >
              Log in
            </Link>
          </nav>
          <p>
            Powered by{' '}
            <a
              href="https://hackon.openmercato.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground hover:underline underline-offset-4"
            >
              Open Mercato
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
