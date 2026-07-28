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
