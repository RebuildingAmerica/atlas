export const typographyScale = {
  displayLarge: {
    className: "type-display-large",
    sizeRem: "3",
  },
  displayMedium: {
    className: "type-display-medium",
    sizeRem: "2.5",
  },
  displaySmall: {
    className: "type-display-small",
    sizeRem: "2.25",
  },
  headlineLarge: {
    className: "type-headline-large",
    sizeRem: "2",
  },
  headlineMedium: {
    className: "type-headline-medium",
    sizeRem: "1.75",
  },
  headlineSmall: {
    className: "type-headline-small",
    sizeRem: "1.5",
  },
  titleLarge: {
    className: "type-title-large",
    sizeRem: "1.375",
  },
  titleMedium: {
    className: "type-title-medium",
    sizeRem: "1",
  },
  titleSmall: {
    className: "type-title-small",
    sizeRem: "0.875",
  },
  bodyLarge: {
    className: "type-body-large",
    sizeRem: "1",
  },
  bodyMedium: {
    className: "type-body-medium",
    sizeRem: "0.875",
  },
  bodySmall: {
    className: "type-body-small",
    sizeRem: "0.75",
  },
  labelLarge: {
    className: "type-label-large",
    sizeRem: "0.875",
  },
  labelMedium: {
    className: "type-label-medium",
    sizeRem: "0.75",
  },
  labelSmall: {
    className: "type-label-small",
    sizeRem: "0.6875",
  },
} as const;

export type TypographyRole = keyof typeof typographyScale;

export function getTypographyClass(role: TypographyRole): string {
  return typographyScale[role].className;
}
