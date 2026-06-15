/**
 * Strip characters that break downstream HTTP requests when text flows
 * into headers or URL components. U+2028 / U+2029 (LINE SEPARATOR,
 * PARAGRAPH SEPARATOR) are common in copy-paste from Word, PDF, and
 * Google Docs, and Undici (Node's fetch) rejects them as non-ByteString
 * when they end up inside header values. NULL and other control chars
 * are stripped too — they have no place in human-readable input.
 */
export function sanitiseUserText(input: string): string {
  // U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR → newline.
  const lineSeparators = new RegExp("[\\u2028\\u2029]", "g");
  // NULL and other C0 control chars that aren't tab/newline/CR.
  const controlChars = new RegExp(
    "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]",
    "g",
  );
  // Zero-width and BOM-style invisibles.
  const zeroWidth = new RegExp(
    "[\\u200B-\\u200D\\uFEFF]",
    "g",
  );
  return input
    .replace(lineSeparators, "\n")
    .replace(controlChars, "")
    .replace(zeroWidth, "");
}
