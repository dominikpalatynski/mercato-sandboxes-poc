'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { APP_SECTION_NAV_ITEMS, isAppSectionActive } from '@/lib/app-sections';

export function AuthenticatedNav(): React.ReactElement {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1">
      {APP_SECTION_NAV_ITEMS.map((item) => {
        const active = isAppSectionActive(pathname, item.href);
        return (
          <Button key={item.href} variant={active ? 'secondary' : 'ghost'} size="sm" asChild>
            <Link href={item.href} aria-current={active ? 'page' : undefined}>
              {item.label}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
