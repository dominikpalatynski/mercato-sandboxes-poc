import Link from 'next/link';

import { getSession } from '@/lib/auth';
import { AuthenticatedNav } from '@/components/authenticated-nav';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { AccountMenu } from '@/components/account-menu';

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="group flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
          aria-label="Open Mercato Sandboxes — home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/openmercato-signet.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-[7px]"
          />
          <span className="text-lg font-bold tracking-tight text-foreground">
            Sandboxes
          </span>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          {session ? (
            <>
              <AuthenticatedNav />
              <AccountMenu email={session.email} />
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/login">Log in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/signup">Sign up</Link>
              </Button>
            </>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
