export enum ContentType {
  ABOUT_US = 'about-us',
  PRIVACY_POLICY = 'privacy-policy',
  TERMS_AND_CONDITIONS = 'terms-and-conditions',
}

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  [ContentType.ABOUT_US]: 'About Us',
  [ContentType.PRIVACY_POLICY]: 'Privacy Policy',
  [ContentType.TERMS_AND_CONDITIONS]: 'Terms & Conditions',
};

export function getContentTypeLabel(type: ContentType): string {
  return CONTENT_TYPE_LABELS[type];
}
