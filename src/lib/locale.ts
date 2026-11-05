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
