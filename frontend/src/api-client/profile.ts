import { type Profile, profileSchema } from "@bazak/shared";
import { MASTRA_BASE_URL } from "@/lib/mastra-client";

/** One remembered preference, parsed from the working-memory payload. */
export interface ProfileField {
  label: string;
  value: string;
}

/**
 * Ordered field → human label map, mirroring `profileSchema` (the shared seam).
 * The order here is the order the fields render in the panel.
 */
const FIELD_LABELS: Array<[keyof Profile, string]> = [
  ["name", "Name"],
  ["budget", "Budget"],
  ["preferredCategories", "Preferred categories"],
  ["preferredBrands", "Preferred brands"],
  ["dislikes", "Dislikes"],
  ["notes", "Notes"],
];

/**
 * Parse the raw working-memory payload into the filled fields only (US-7.4), so the
 * view shows just what's actually remembered. Pure + exported for unit tests.
 *
 * Structured working memory (`schema: profileSchema`) is stored as a JSON object, so
 * that's the canonical format. A `- Label: value` markdown payload is still accepted
 * as a fallback (older template-based working memory). Empty fields are dropped.
 */
export function parseProfile(raw: string | null): ProfileField[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return parseJsonProfile(trimmed) ?? parseMarkdownProfile(trimmed);
}

/** Canonical path: a JSON object shaped by `profileSchema`. Returns null if not JSON. */
function parseJsonProfile(raw: string): ProfileField[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) return null;
  const profile = parsed.data;
  const fields: ProfileField[] = [];
  for (const [key, label] of FIELD_LABELS) {
    const v = profile[key];
    const value = (Array.isArray(v) ? v.join(", ") : (v ?? "")).trim();
    if (value) fields.push({ label, value });
  }
  return fields;
}

/** Fallback path: a `- Label: value` markdown working-memory template. */
function parseMarkdownProfile(raw: string): ProfileField[] {
  const fields: ProfileField[] = [];
  for (const line of raw.split("\n")) {
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
