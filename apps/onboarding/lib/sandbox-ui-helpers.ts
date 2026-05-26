export function stripCreds(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return url;
  }
}

export function repoBrowseUrl(cloneUrl: string | null): string | null {
  const clean = stripCreds(cloneUrl);
  if (!clean) return null;
  return clean.replace(/\.git$/, '');
}
