/**
 * Bootstrap a tenant. Until public signup ships, this is how the first
 * tenants get into the system.
 *
 * Usage:
 *   pnpm tsx scripts/create-tenant.ts "Tenant Name" NG owner@example.com
 *
 * Country codes: NG | UK | CA | AE | XK | US
 */

import { createTenant } from "@/lib/tenant/create";
import { isSupportedTenantCountry } from "@/lib/tenant/country";

const [, , name, country, email] = process.argv;

if (!name || !country || !email) {
  console.error(
    'usage: pnpm tsx scripts/create-tenant.ts "Tenant Name" NG owner@example.com',
  );
  process.exit(1);
}

if (!isSupportedTenantCountry(country)) {
  console.error(`Unsupported country: ${country}. Use NG / UK / CA / AE / XK / US.`);
  process.exit(1);
}

createTenant({ name, countryCode: country, ownerEmail: email })
  .then((res) => {
    console.log(
      `[create-tenant] ok tenant=${res.tenantId} owner=${res.ownerUserId} country=${country}`,
    );
  })
  .catch((err) => {
    console.error("[create-tenant] failed:", err);
    process.exit(1);
  });
