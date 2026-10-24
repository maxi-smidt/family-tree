import { describe, expect, it } from "vitest";
import { isMatriculaUrl } from "./matricula";

describe("isMatriculaUrl", () => {
  it.each([
    "https://data.matricula-online.eu/de/oesterreich/wien/book/?pg=13",
    "  https://data.matricula-online.eu/de/oesterreich/book/  ",
    "http://data.matricula-online.eu/",
    "https://data.matricula-online.eu:443/de/book/",
  ])("recognizes %s", (url) => {
    expect(isMatriculaUrl(url)).toBe(true);
  });

  it.each([
    "",
    "not a URL",
    "https://example.com/?url=matricula-online.eu",
    "https://matricula-online.eu.example.com/",
    "https://fakematricula-online.eu/",
    "https://matricula-online.eu@example.com/",
    "https://user:password@data.matricula-online.eu/",
    "javascript://matricula-online.eu/",
    "ftp://data.matricula-online.eu/",
    "https://matricula-online.eu/",
    "https://www.matricula-online.eu/",
    "https://img.data.matricula-online.eu/image/scan/",
    "https://data.matricula-online.eu:8000/de/book/",
    "https://data.matricula-online.eu\\de\\book",
    "https://data.matricula-online.eu/bo\tok",
  ])("rejects %s", (url) => {
    expect(isMatriculaUrl(url)).toBe(false);
  });
});
