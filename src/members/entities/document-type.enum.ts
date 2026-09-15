export enum DocumentType {
  CONSENT_FORM = 'consent_form',
  MEDICAL_REPORT = 'medical_report',
  ID_PROOF = 'id_proof',
  PHOTO = 'photo',
  AGREEMENT = 'agreement',
}

/**
 * All valid document type values for validation and DRY iteration.
 */
export const DOCUMENT_TYPE_VALUES: readonly DocumentType[] = Object.values(
  DocumentType,
);