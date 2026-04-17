import type { StateDensity } from "@/domains/catalog/surface-model";

export interface StateMapStyle {
  count: number;
  intensity: number;
}

const STATE_CODE_BY_FIPS: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

export function getStateCodeFromFips(fips: string | number | undefined): string | undefined {
  if (fips === undefined) {
    return undefined;
  }

  const normalized = String(fips).padStart(2, "0");
  return STATE_CODE_BY_FIPS[normalized];
}

export function buildUsMapStateStyles(states: StateDensity[]): Record<string, StateMapStyle> {
  return Object.fromEntries(
    states.map((state) => [
      state.state,
      {
        count: state.count,
        intensity: state.intensity,
      },
    ]),
  );
}
