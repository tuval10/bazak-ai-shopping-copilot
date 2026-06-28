import { MASTRA_BASE_URL } from "@/lib/mastra-client";

/** One remembered preference, parsed from the working-memory markdown. */
export interface ProfileField {
  label: string;
  value: string;
}

/**
 * Parse the working-memory markdown (`- Label: value` lines) into the filled fields
 * only — blank template rows are dropped, so the view shows just what's actually
 * remembered (US-7.4). Pure + exported for unit tests.
 */
export function parseProfile(markdown: string | null): ProfileField[] {
  if (!markdown) return [];
  const fields: ProfileField[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\s*[-*]\s*([^:]+):\s*(.*)$/);
    if (!match) continue;
    const label = match[1]!.trim();
    const value = match[2]!.trim();
    if (value) fields.push({ label, value });
  }
  return fields;
}

const PROFILE_URL = `${MASTRA_BASE_URL}/profile`;

/** Read remembered preferences (US-7.4). Returns the parsed fields; never throws. */
export async function getProfile(fetcher: typeof fetch = fetch): Promise<ProfileField[]> {
  const res = await fetcher(PROFILE_URL, { method: "GET" });
  if (!res.ok) throw new Error(`profile GET ${res.status}`);
  const body = (await res.json()) as { profile?: string | null };
  return parseProfile(body.profile ?? null);
}

/** Reset/clear remembered preferences (US-7.4). */
export async function resetProfile(fetcher: typeof fetch = fetch): Promise<void> {
  const res = await fetcher(PROFILE_URL, { method: "DELETE" });
  if (!res.ok) throw new Error(`profile DELETE ${res.status}`);
}
