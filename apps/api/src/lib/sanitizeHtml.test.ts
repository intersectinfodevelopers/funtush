import { describe, it, expect } from "vitest";
import { sanitizeRichText, stripHtml } from "./sanitizeHtml";

describe("sanitizeRichText", () => {
  it("keeps normal editor formatting", () => {
    const html = '<h2>Tips</h2><p class="ql-align-center">Wear <strong>layers</strong> &amp; <em>boots</em>.</p><ul><li>One</li></ul><a href="https://example.com">link</a>';
    const out = sanitizeRichText(html);
    expect(out).toContain("<h2>Tips</h2>");
    expect(out).toContain('class="ql-align-center"');
    expect(out).toContain("<strong>layers</strong>");
    expect(out).toContain('href="https://example.com"');
  });

  it.each([
    ['<script>alert(1)</script><p>hi</p>', "<script"],
    ['<img src="x" onerror="alert(1)">', "onerror"],
    ['<a href="javascript:alert(1)">x</a>', "javascript:"],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', "javascript"],
    ['<a href="data:text/html,<script>alert(1)</script>">x</a>', "data:"],
    ['<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">', "data:"],
    ['<iframe src="https://evil.example"></iframe>', "iframe"],
    ['<object data="x"></object><embed src="x">', "object"],
    ['<form action="https://evil"><input name=x></form>', "<form"],
    ['<p style="background:url(javascript:alert(1))">x</p>', "style"],
    ['<svg onload=alert(1)><circle/></svg>', "svg"],
    ['<div onclick="alert(1)">x</div>', "onclick"],
    ['<p class="evil-class ql-align-left">x</p>', "evil-class"],
    ['<a href="//evil.example/x">x</a>', "//evil"],
  ])("neutralises %s", (payload, forbidden) => {
    expect(sanitizeRichText(payload).toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it("forces safe rel on links", () => {
    expect(sanitizeRichText('<a href="https://a.test" target="_blank">x</a>')).toContain('rel="noopener noreferrer nofollow"');
  });

  it("returns an empty string for non-strings instead of throwing", () => {
    for (const v of [undefined, null, 5, {}, ["<p>x</p>"]]) expect(sanitizeRichText(v)).toBe("");
  });
});

describe("stripHtml", () => {
  it("removes every tag but keeps the text", () => {
    expect(stripHtml("<b>Hello</b> <script>alert(1)</script>world")).toBe("Hello world");
    expect(stripHtml('"><img src=x onerror=alert(1)>')).not.toContain("onerror");
  });
});
