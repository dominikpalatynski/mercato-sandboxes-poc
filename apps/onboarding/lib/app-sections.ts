export interface AppSectionNavItem {
  href: '/dashboard' | '/billing';
  label: 'Dashboard' | 'Billing';
}

export const APP_SECTION_NAV_ITEMS: readonly AppSectionNavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/billing', label: 'Billing' },
];

export function isAppSectionActive(
  pathname: string | null | undefined,
  href: AppSectionNavItem['href'],
): boolean {
  if (!pathname) {
    return false;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
