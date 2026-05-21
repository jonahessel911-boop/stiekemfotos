/** Vaste creditpakketten voor /platform/2 (geen korting, geen deals). */

export type Platform2CreditPackageId = "p2_100" | "p2_350" | "p2_1000";

export type Platform2CreditPackage = {
  credits: number;
  priceEurCents: number;
  title: string;
  priceLabel: string;
};

export const PLATFORM2_CREDIT_PACKAGES: Record<Platform2CreditPackageId, Platform2CreditPackage> = {
  p2_100: {
    credits: 100,
    priceEurCents: 1000,
    title: "100 credits",
    priceLabel: "€10,00",
  },
  p2_350: {
    credits: 350,
    priceEurCents: 2999,
    title: "350 credits",
    priceLabel: "€29,99",
  },
  p2_1000: {
    credits: 1000,
    priceEurCents: 9900,
    title: "1000 credits",
    priceLabel: "€99,00",
  },
};

export const PLATFORM2_CREDIT_PACKAGE_LIST = (
  Object.entries(PLATFORM2_CREDIT_PACKAGES) as Array<[Platform2CreditPackageId, Platform2CreditPackage]>
).map(([id, pkg]) => ({ id, ...pkg }));

export function isPlatform2CreditPackageId(id: string): id is Platform2CreditPackageId {
  return id in PLATFORM2_CREDIT_PACKAGES;
}
