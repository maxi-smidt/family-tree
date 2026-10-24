/** Match Matricula itself and its subdomains, never lookalike hosts. */
export function isMatriculaUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      (url.hostname === "matricula-online.eu" ||
        url.hostname.endsWith(".matricula-online.eu"))
    );
  } catch {
    return false;
  }
}
