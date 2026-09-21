import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandStatePanel } from "@/components/brand/brand-state";
import { BRAND, BRAND_ROUTES } from "@/components/brand/brand";

export default function NotFound() {
  return (
    <BrandStatePanel
      code="404"
      title="We couldn't find that page"
      description="The link may be out of date, or the page may have moved."
    >
      <Button asChild>
        <Link href={BRAND_ROUTES.home}>Back to {BRAND.name}</Link>
      </Button>
    </BrandStatePanel>
  );
}
