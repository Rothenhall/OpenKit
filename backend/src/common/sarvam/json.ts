/**
 * Pulls a JSON object out of a model reply. Handles reasoning blocks,
 * markdown fences and stray prose around the object.
 */
export function extractJson<T>(reply: string): T {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Model reply contained no JSON object');
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

/** Removes reasoning blocks so only the spoken text remains. */
export function stripReasoning(reply: string): string {
  return reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
