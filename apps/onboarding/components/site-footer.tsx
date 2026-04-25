import Link from 'next/link';

import { getSession } from '@/lib/auth';

export async function SiteFooter() {
  const session = await getSession();

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
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
          {session ? (
            <Link
              href="/dashboard"
              className="hover:text-foreground hover:underline underline-offset-4"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="hover:text-foreground hover:underline underline-offset-4"
            >
              Log in
            </Link>
          )}
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
  );
}
