/**
 * Hidden speech-pass tags. The model appends `[[books:yes]]` when the lord's
 * words should change the ledger and `[[books:no]]` when they are only talk.
 * The player never sees the tag; the engine reads it to decide whether a books
 * pass runs. Spelling is forgiving (yes/no, true/false, either bracket style).
 */
const BOOKS_TAG =
  /\[\[\s*books\s*:\s*(yes|no|true|false)\s*\]\]|<<\s*books\s*:\s*(yes|no|true|false)\s*>>|\[\s*BOOKS\s*:\s*(yes|no|true|false)\s*\]/gi;

export type BooksTag = { text: string; books?: boolean };

/** Remove every books tag. The last one read wins when the model wrote more than one. */
export function stripBooksTag(text: string): BooksTag {
  let books: boolean | undefined;
  const cleaned = text
    .replace(BOOKS_TAG, (_m, a: string, b: string, c: string) => {
      const word = (a || b || c || "").toLowerCase();
      books = word === "yes" || word === "true";
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: cleaned, books };
}

/** True when the text still carries a books tag (for tests and log notes). */
export function hasBooksTag(text: string): boolean {
  BOOKS_TAG.lastIndex = 0;
  const found = BOOKS_TAG.test(text);
  BOOKS_TAG.lastIndex = 0;
  return found;
}
