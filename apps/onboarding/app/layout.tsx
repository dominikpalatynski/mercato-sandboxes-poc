import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Mercato Sandboxes',
  description: 'Self-hosted onboarding for Mercato dev sandboxes',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0b0d12] text-gray-100 antialiased">
        <header className="border-b border-white/10">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Mercato Sandboxes
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              {session ? (
                <>
                  <Link href="/dashboard" className="text-gray-300 hover:text-white">Dashboard</Link>
                  <span className="text-gray-500">{session.email}</span>
                  <form action="/api/logout" method="post">
                    <button
                      type="submit"
                      className="rounded border border-white/15 px-3 py-1 text-gray-200 hover:bg-white/5"
                    >
                      Log out
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login" className="text-gray-300 hover:text-white">Log in</Link>
                  <Link
                    href="/signup"
                    className="rounded bg-indigo-500 px-3 py-1 font-medium text-white hover:bg-indigo-400"
                  >
                    Sign up
                  </Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
