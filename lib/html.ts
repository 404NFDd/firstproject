export function escapeHtml(text: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }
  return text.replace(/[&<>"']/g, (character) => entities[character])
}
