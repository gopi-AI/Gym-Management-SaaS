export enum ConsentType {
  GDPR = 'gdpr',
  MARKETING = 'marketing',
  PHOTO_WAIVER = 'photo_waiver',
  TERMS = 'terms',
  HEALTH_DISCLOSURE = 'health_disclosure',
}

/**
 * All valid consent type values for validation and DRY iteration.
 */
export const CONSENT_TYPE_VALUES: readonly ConsentType[] = Object.values(
  ConsentType,
);