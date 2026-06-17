/**
 * JSON.stringify the body, then escape every non-ASCII codepoint as
 * a \uXXXX sequence so the bytes on the wire are pure ASCII. Undici
 * (Node's fetch) sometimes routes the body through ByteString
 * validation, which rejects U+2028 / U+2029 and any other non-Latin-1
 * char. JSON parsers on the other side reconstruct the same logical
 * string, so semantics are preserved.
 *
 * Use this in every AI client where the body may contain copy-pasted
 * user text. Idempotent; cheap to run on every call.
 */
export function asciiSafeJsonStringify(value: unknown): string {
  const escapeNonAscii = new RegExp(
    "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\uFFFF]",
    "g",
  );
  return JSON.stringify(value).replace(
    escapeNonAscii,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

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
