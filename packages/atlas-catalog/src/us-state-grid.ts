export interface StateGridCell {
  code: string;
  name: string;
  row: number;
  col: number;
}

export const US_STATE_GRID: StateGridCell[] = [
  { code: "WA", name: "Washington", row: 0, col: 0 },
  { code: "ID", name: "Idaho", row: 0, col: 1 },
  { code: "MT", name: "Montana", row: 0, col: 2 },
  { code: "ND", name: "North Dakota", row: 0, col: 4 },
  { code: "MN", name: "Minnesota", row: 0, col: 5 },
  { code: "WI", name: "Wisconsin", row: 0, col: 6 },
  { code: "MI", name: "Michigan", row: 0, col: 7 },
  { code: "NY", name: "New York", row: 0, col: 8 },
  { code: "VT", name: "Vermont", row: 0, col: 9 },
  { code: "NH", name: "New Hampshire", row: 0, col: 10 },
  { code: "ME", name: "Maine", row: 0, col: 11 },
  { code: "OR", name: "Oregon", row: 1, col: 0 },
  { code: "NV", name: "Nevada", row: 1, col: 1 },
  { code: "WY", name: "Wyoming", row: 1, col: 2 },
  { code: "SD", name: "South Dakota", row: 1, col: 4 },
  { code: "IA", name: "Iowa", row: 1, col: 5 },
  { code: "IL", name: "Illinois", row: 1, col: 6 },
  { code: "IN", name: "Indiana", row: 1, col: 7 },
  { code: "OH", name: "Ohio", row: 1, col: 8 },
  { code: "PA", name: "Pennsylvania", row: 1, col: 9 },
  { code: "NJ", name: "New Jersey", row: 1, col: 10 },
  { code: "MA", name: "Massachusetts", row: 1, col: 11 },
  { code: "CA", name: "California", row: 2, col: 0 },
  { code: "UT", name: "Utah", row: 2, col: 1 },
  { code: "CO", name: "Colorado", row: 2, col: 2 },
  { code: "NE", name: "Nebraska", row: 2, col: 4 },
  { code: "MO", name: "Missouri", row: 2, col: 5 },
  { code: "KY", name: "Kentucky", row: 2, col: 6 },
  { code: "WV", name: "West Virginia", row: 2, col: 7 },
  { code: "VA", name: "Virginia", row: 2, col: 8 },
  { code: "MD", name: "Maryland", row: 2, col: 9 },
  { code: "CT", name: "Connecticut", row: 2, col: 10 },
  { code: "RI", name: "Rhode Island", row: 2, col: 11 },
  { code: "AZ", name: "Arizona", row: 3, col: 1 },
  { code: "NM", name: "New Mexico", row: 3, col: 2 },
  { code: "KS", name: "Kansas", row: 3, col: 4 },
  { code: "AR", name: "Arkansas", row: 3, col: 5 },
  { code: "TN", name: "Tennessee", row: 3, col: 6 },
  { code: "NC", name: "North Carolina", row: 3, col: 7 },
  { code: "SC", name: "South Carolina", row: 3, col: 8 },
  { code: "DE", name: "Delaware", row: 3, col: 9 },
  { code: "DC", name: "District of Columbia", row: 3, col: 10 },
  { code: "OK", name: "Oklahoma", row: 4, col: 4 },
  { code: "LA", name: "Louisiana", row: 4, col: 5 },
  { code: "MS", name: "Mississippi", row: 4, col: 6 },
  { code: "AL", name: "Alabama", row: 4, col: 7 },
  { code: "GA", name: "Georgia", row: 4, col: 8 },
  { code: "TX", name: "Texas", row: 5, col: 3 },
  { code: "FL", name: "Florida", row: 5, col: 9 },
  { code: "AK", name: "Alaska", row: 6, col: 0 },
  { code: "HI", name: "Hawaii", row: 6, col: 1 },
];

export const STATE_NAME_BY_CODE = Object.fromEntries(
  US_STATE_GRID.map((state) => [state.code, state.name]),
) as Record<string, string>;
