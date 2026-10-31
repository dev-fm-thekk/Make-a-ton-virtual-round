export interface Tax {
  id: string;
  name: string;
  ratePercent: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  attribute: string;
  value: string;
  extraPrice: string;
  isActive: boolean;
}

export type ProductType = "SERVICE" | "GOODS";

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  salesPrice: string;
  costPrice: string;
  notes: string | null;
  taxId: string | null;
  tax: Tax | null;
  variants: ProductVariant[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTerm {
  id: string;
  name: string;
  dueDays: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name: string;
  type: ProductType;
  salesPrice: string;
  costPrice: string;
  notes?: string | null;
  taxId?: string | null;
  isActive: boolean;
}
