export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export interface Customer {
  id: string;
  name: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  taxId: string | null;
  billingAddress: Address | null;
  /** Internal staff notes. Never sent to the customer themselves. */
  notes?: string | null;
  hasPortalAccess: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerListItem extends Customer {
  activeSubscriptions: number;
}

export interface CustomerDetail extends Customer {
  subscriptionsByStatus: Record<string, number>;
  outstandingBalance: string;
  overdueBalance: string;
}

export interface CustomerInput {
  name: string;
  companyName?: string | null;
  email: string;
  phone?: string | null;
  taxId?: string | null;
  billingAddress?: Address | null;
  notes?: string | null;
}
