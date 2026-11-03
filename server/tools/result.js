// MCP tool results in the shape every wrangler tool returns: the JSON as text
// (what an agent reads) plus structuredContent; an error is plain text.
export function okResult(structuredContent, lead) {
  const json = JSON.stringify(structuredContent, null, 2);
  return { content: [{ type: 'text', text: lead ? `${lead}\n${json}` : json }], structuredContent };
}

export function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export const NO_IDENTITY = 'This request carried no session identity (no session), so there is no session to act for.';
