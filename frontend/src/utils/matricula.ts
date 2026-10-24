/** Keep detection aligned with the viewer host accepted by the import endpoint. */
export function isMatriculaUrl(value: string): boolean {
  try {
    const input = value.trim();
    if (/[\u0000-\u001f\\]/.test(input)) return false;
    const url = new URL(input);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      ["", "80", "443"].includes(url.port) &&
      url.hostname === "data.matricula-online.eu"
    );
  } catch {
    return false;
  }
}
