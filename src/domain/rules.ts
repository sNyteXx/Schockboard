import type { RuleProfile } from "@/domain/types";

export const SCHOCK_RULE_PROFILE: RuleProfile = {
  title: "Schockfreunde Hausprofil",
  alias: {
    general: "General",
    schockAus: "Schock Aus",
  },
  overview:
    "13 Deckel, zwei Hälften und bei Bedarf ein Finale. Das Profil folgt weitgehend den Schockfreunde-Regeln, nutzt aber 'General' statt 'Jennie'.",
  ranking: [
    "Schock Aus beendet die Halbzeit sofort.",
    "General ist höher als Schock doof.",
    "Bei gleichem Wurf gilt Mit ist Shit.",
    "Straßen und General müssen auf Hand gewürfelt werden.",
  ],
  toggles: [
    {
      id: "einkaufen",
      label: "Einkaufen",
      description: "Ausgeschiedene Spieler können wieder Deckel aufnehmen, wenn sie den Durchgang verlieren.",
      enabled: true,
    },
    {
      id: "sechsen-drehen",
      label: "Sechsen drehen",
      description: "Zwei oder drei Sechsen in einem Wurf dürfen zu Einsen gedreht werden, sofern ein Folgewurf möglich bleibt.",
      enabled: true,
    },
    {
      id: "laden",
      label: "Laden",
      description: "Zu Beginn eines Abends kann optional geladen werden; das ist hier dokumentiert, aber nicht automatisiert.",
      enabled: true,
    },
  ],
};
