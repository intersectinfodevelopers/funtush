import sanitizeHtml from "sanitize-html";

/**
 * Rich text (blog posts) is stored as HTML and later rendered on public sites,
 * so anything an agency user submits is untrusted. This keeps the formatting a
 * rich-text editor produces and drops everything executable: scripts, event
 * handlers (onerror=…), javascript:/data: URLs, iframes/objects/forms, inline
 * styles and unknown attributes.
 */
const RICH_TEXT: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "sub", "sup",
    "h1", "h2", "h3", "h4", "blockquote", "pre", "code",
    "ul", "ol", "li", "a", "img", "span", "div",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    // Quill marks alignment/indent/size with ql-* classes and nothing else.
    "*": ["class"],
  },
  allowedClasses: { "*": [/^ql-[a-z0-9-]+$/] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    // A user link must never be able to reach back into the opener page.
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: "noopener noreferrer nofollow", ...(attribs.target ? { target: "_blank" } : {}) } }),
  },
};

export function sanitizeRichText(html: unknown): string {
  if (typeof html !== "string") return "";
  const clean = sanitizeHtml(html, RICH_TEXT);
  // Content pasted from Word/a web page often carries non-breaking spaces (U+00A0) between every
  // word instead of real spaces. A run of NBSP-joined text has no spot to line-break at, so it
  // overflows its container on the page instead of wrapping. Safe to do on the sanitized string:
  // U+00A0 never appears inside tag syntax, only in text content.
  return clean.replace(/ /g, " ");
}

/** For fields that must be plain text (titles, tags): strip every tag, keep the text. */
export function stripHtml(text: unknown): string {
  return typeof text === "string" ? sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }).trim() : "";
}
