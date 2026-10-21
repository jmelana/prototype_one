// ---- Built-in country groups ----------------------------------------------
// Plain data so membership can be maintained without touching the UI.
// Codes are ISO 3166-1 alpha-2 as used by Finnhub; "EU" is Finnhub's code for
// Euro Area / European Union aggregate releases.
// Last reviewed: October 2026.
const PREDEFINED_GROUPS = [
  {
    id: "g20",
    name: "G20",
    description: "Top 20 economies",
    // 19 countries + the European Union. The African Union (a member since 2023)
    // has no country code and publishes no calendar events, so it is not listed.
    members: ["AR", "AU", "BR", "CA", "CN", "FR", "DE", "IN", "ID", "IT", "JP", "KR",
              "MX", "RU", "SA", "ZA", "TR", "GB", "US", "EU"],
  },
  {
    id: "g7",
    name: "G7",
    description: "Group of Seven",
    members: ["CA", "FR", "DE", "IT", "JP", "GB", "US"],
  },
  {
    id: "eurozone",
    name: "Eurozone",
    description: "Euro area members + aggregate",
    // 21 euro countries (Bulgaria joined 1 Jan 2026) plus Euro Area aggregate data.
    members: ["AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT",
              "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES", "EU"],
  },
  {
    id: "majors",
    name: "Majors",
    description: "Major currency economies",
    members: ["US", "EU", "GB", "JP", "CA", "AU", "NZ", "CH"],
  },
];

// Region used to section the country picker. Unlisted codes fall under "Other".
const COUNTRY_REGIONS = {
  "North America": ["US", "CA"],
  "Europe": ["EU", "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
             "HU", "IS", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO",
             "SK", "SI", "ES", "SE", "CH", "GB", "RS", "BA", "MK", "ME", "AL", "XK", "MD",
             "UA", "BY", "RU", "TR"],
  "Asia": ["CN", "JP", "KR", "IN", "ID", "SG", "TW", "HK", "MO", "TH", "PH", "MY", "VN",
           "MM", "KH", "LK", "PK", "BD", "MV", "MN", "NP"],
  "Oceania": ["AU", "NZ", "FJ"],
  "Latin America": ["MX", "BR", "AR", "CL", "CO", "PE", "UY", "PY", "BO", "EC", "VE", "CR",
                    "PA", "GT", "SV", "DO"],
  "Middle East": ["SA", "AE", "IL", "KW", "BH", "QA", "OM", "JO", "LB", "PS"],
  "Africa": ["ZA", "EG", "NG", "KE", "GH", "MA", "TN", "DZ", "LY", "ET", "TZ", "UG", "RW",
             "BI", "MW", "ZM", "ZW", "BW", "NA", "AO", "MU", "SC", "SN", "GN", "LR", "CV",
             "CG", "MG"],
  "Central Asia & Caucasus": ["KZ", "UZ", "KG", "TJ", "GE", "AM", "AZ"],
  "Global": ["WW"],
};
