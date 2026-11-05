export const DEFAULT_LANGUAGE = "de-DE";
export const DEFAULT_REGION = "CH";

export const SUPPORTED_LANGUAGES = [
  { code: "de-DE", label: "Deutsch" },
  { code: "en-US", label: "English" },
  { code: "fr-FR", label: "Français" },
  { code: "it-IT", label: "Italiano" },
] as const;

export const SUPPORTED_REGIONS = [
  { code: "CH", label: "Schweiz" },
  { code: "DE", label: "Deutschland" },
  { code: "AT", label: "Österreich" },
  { code: "FR", label: "Frankreich" },
  { code: "IT", label: "Italien" },
  { code: "US", label: "USA" },
  { code: "GB", label: "Grossbritannien" },
] as const;

const REGION_NAMES: Record<string, string> = { CH: "die Schweiz", DE: "Deutschland", AT: "Österreich", FR: "Frankreich", IT: "Italien", US: "die USA", GB: "Grossbritannien" };

/** Für Sätze mit «für», also «für die Schweiz». */
export function regionName(region: string): string {
  return REGION_NAMES[region] ?? region;
}
