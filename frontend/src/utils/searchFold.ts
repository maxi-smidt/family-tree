/** Folding used by document search (#1122): lower-case, umlauts to their
 *  two-letter spelling (`ä` = `ae`) and accents removed. Mirrors
 *  `fold()` in the backend's `services/documents/text_search.py`, so words
 *  the server reports as matched can be found again in the full text. */

const REPLACEMENTS: [string, string][] = [
  ["ä", "ae"],
  ["ö", "oe"],
  ["ü", "ue"],
  ["ß", "ss"],
  ["æ", "ae"],
  ["œ", "oe"],
];
const FROM =
  "àáâãåāăąèéêëēĕėęěìíîïĩīĭįòóôõøōŏőùúûũūŭůűųýÿçćĉċčñńňśšźżžďđťłľĺŕř";
const TO = "aaaaaaaaeeeeeeeeeiiiiiiiioooooooouuuuuuuuuyycccccnnnsszzzddtlllrr";
const TABLE = new Map([...FROM].map((char, i) => [char, TO[i]]));

export function foldForSearch(value: string): string {
  let folded = value.toLowerCase();
  for (const [source, target] of REPLACEMENTS)
    folded = folded.split(source).join(target);
  return [...folded].map((char) => TABLE.get(char) ?? char).join("");
}

/** Letters and digits, like the backend's `[^\W_]+`. */
export const SEARCH_WORD = /[\p{L}\p{N}]+/gu;
