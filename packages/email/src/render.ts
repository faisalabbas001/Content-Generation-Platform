/**
 * Replaces all {{variable}} placeholders in a template string with values.
 *
 * Missing variables are left as {{variable}} rather than removed silently —
 * this makes bugs visible in the rendered output instead of hiding them.
 *
 * Safe: no eval, no external dependency, works with Arabic RTL text.
 */
export function renderTemplate(
  template: string,
  values: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const val = values[key]
    return val !== undefined && val !== null ? String(val) : match
  })
}

/**
 * Renders all three fields of a template row at once.
 * Returns the rendered subject, title, and body_html.
 */
export function renderAll(
  tpl: { subject: string; title: string; body_html: string },
  values: Record<string, unknown>,
): { subject: string; title: string; body_html: string } {
  return {
    subject:  renderTemplate(tpl.subject, values),
    title:    renderTemplate(tpl.title, values),
    body_html: renderTemplate(tpl.body_html, values),
  }
}
