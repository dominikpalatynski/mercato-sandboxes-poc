import Link from 'next/link';

import { getSession } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

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
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard">Dashboard</Link>
              </Button>
              <span className="hidden text-muted-foreground sm:inline">
                {session.email}
              </span>
              <form action="/api/logout" method="post">
                <Button type="submit" variant="outline" size="sm">
                  Log out
                </Button>
              </form>
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
