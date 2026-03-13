/**
 * Strip all HTML tags from a string, returning only the text content.
 * Useful for cleaning up rich text from Canvas API responses.
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}
