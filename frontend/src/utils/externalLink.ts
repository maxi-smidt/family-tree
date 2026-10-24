/** Only absolute web links may become clickable attachment destinations. */
export function externalLinkHref(value: string): string | undefined {
  const url = value.trim();
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname || parsed.username || parsed.password)
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}
