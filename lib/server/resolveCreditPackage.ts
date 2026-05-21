import {
  buildCreditPackagesRecord,
  type CreditPackageId,
} from "@/lib/credit-packages";
import {
  PLATFORM2_CREDIT_PACKAGES,
  type Platform2CreditPackageId,
  isPlatform2CreditPackageId,
} from "@/lib/platform2-credit-packages";

export type StripeCreditPackage = {
  credits: number;
  priceEurCents: number;
  title: string;
};

const MAIN_PACKAGES = buildCreditPackagesRecord();

export type AnyCreditPackageId = CreditPackageId | Platform2CreditPackageId;

export function resolveStripeCreditPackage(
  packageId: string
): StripeCreditPackage | null {
  if (packageId in MAIN_PACKAGES) {
    return MAIN_PACKAGES[packageId as CreditPackageId];
  }
  if (isPlatform2CreditPackageId(packageId)) {
    const p = PLATFORM2_CREDIT_PACKAGES[packageId];
    return { credits: p.credits, priceEurCents: p.priceEurCents, title: p.title };
  }
  return null;
}
