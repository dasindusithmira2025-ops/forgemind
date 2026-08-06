export type ProductStatus = 'Available' | 'Early Access' | 'Private Beta' | 'In Development';

export type Platform = 'Windows' | 'macOS' | 'Linux' | 'Web' | 'Cloud';

export interface ProductDownload {
  platform: Platform;
  version: string;
  architecture: string;
  fileSize: string;
  releaseDate: string;
  downloadUrl?: string;
  checksumSha256: string;
  minOsVersion: string;
  releaseNotesUrl?: string;
  available: boolean;
}

export interface ProductFeature {
  title: string;
  description: string;
  iconName?: string;
  highlight?: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  category: string;
  status: ProductStatus;
  isFlagship?: boolean;
  shortDescription: string;
  fullDescription: string;
  targetAudience: string[];
  capabilities: ProductFeature[];
  platforms: Platform[];
  downloads?: ProductDownload[];
  heroVisualType: 'paralith-system';
  faqs: { question: string; answer: string }[];
  primaryCtaText: string;
  secondaryCtaText?: string;
}

export interface NavLink {
  label: string;
  href: string;
  badge?: string;
  external?: boolean;
  description?: string;
}

/** One destination inside a navigation panel. */
export interface NavPanelItem {
  label: string;
  href: string;
  description: string;
}

/**
 * The right-hand column of a navigation panel: a still of the thing the branch
 * is about, one line about it, and the single action it hands off to. A picture
 * of the product beats a table of claims about it.
 */
export interface NavPanelPlate {
  image: string;
  /** Empty when the image is the company mark, which the wordmark already names. */
  imageAlt: string;
  /** `cover` fills the plate (screenshots); `contain` sits inside it (the mark). */
  fit: 'cover' | 'contain';
  caption: string;
  statement: string;
  cta: { label: string; href: string };
}

export type NavItem =
  | { kind: 'link'; label: string; href: string; description: string }
  | {
      kind: 'menu';
      /** Stable id, used to wire the trigger to its panel for assistive tech. */
      id: string;
      label: string;
      /** Where the trigger points when the panel is bypassed (mobile, no JS). */
      href: string;
      items: NavPanelItem[];
      plate: NavPanelPlate;
    };

export interface CareerRole {
  id: string;
  title: string;
  department: string;
  location: string;
  type: string;
  experience: string;
  description: string;
  requirements: string[];
  responsibilities: string[];
  status: 'Open' | 'Closed';
}

export interface SecurityPrinciple {
  title: string;
  description: string;
  iconName: string;
}

export interface CompanyPrinciple {
  title: string;
  subtitle: string;
  description: string;
}

export interface ContactSubmission {
  name: string;
  email: string;
  category: 'product-support' | 'business' | 'partnership' | 'security' | 'careers' | 'press' | 'general';
  company?: string;
  message: string;
  websiteHoneypot?: string;
}
