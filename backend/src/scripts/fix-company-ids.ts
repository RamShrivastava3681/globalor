import { scanTable, updateItem, putItem, TABLES } from "../db/client.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { config } from "../config.js";
import type { User, Profile, Invoice, Company } from "../types/index.js";

async function run() {
  console.log("Starting company_id fix migration...");

  const users = await scanTable<User>(TABLES.USERS);
  const profiles = await scanTable<Profile>(TABLES.PROFILES);
  const companies = await scanTable<Company>(TABLES.COMPANIES);
  const invoices = await scanTable<Invoice>(TABLES.INVOICES);

  const profileMap = new Map<string, Profile>(profiles.map(p => [p.id, p]));
  const companyByName = new Map<string, Company>(companies.map(c => [c.name.toLowerCase().trim(), c]));

  let usersUpdated = 0;
  let invoicesUpdated = 0;

  for (const user of users) {
    // Skip the true super admin
    if (user.email === config.admin.email) continue;

    // Only fix users with no company_id
    if (user.company_id) continue;

    const profile = profileMap.get(user.id);
    if (!profile || !profile.company_name) {
      console.warn(`User ${user.id} (${user.email}) has no profile or company_name. Skipping.`);
      continue;
    }

    const companyNameKey = profile.company_name.toLowerCase().trim();
    let company = companyByName.get(companyNameKey);

    if (!company) {
      const companyId = generateId();
      company = {
        id: companyId,
        name: profile.company_name,
        email: user.email,
        phone: null,
        address: null,
        settings: null,
        created_at: nowISO(),
        updated_at: nowISO()
      };
      await putItem(TABLES.COMPANIES, company as any);
      companyByName.set(companyNameKey, company);
      console.log(`Created new company ${company.name} with ID ${companyId}`);
    }

    const companyId = company.id;

    // Update User
    await updateItem(TABLES.USERS, { id: user.id }, { company_id: companyId });
    // Update Profile
    await updateItem(TABLES.PROFILES, { id: user.id }, { company_id: companyId });
    usersUpdated++;
    console.log(`Updated user ${user.email} with company_id ${companyId}`);

    // Update any invoices created by this user that don't match the new company_id
    const userInvoices = invoices.filter(inv => inv.client_id === user.id);
    for (const inv of userInvoices) {
      if (inv.company_id !== companyId) {
        await updateItem(TABLES.INVOICES, { id: inv.id }, { company_id: companyId });
        invoicesUpdated++;
        console.log(`Updated invoice ${inv.id} (${inv.invoice_number}) with new company_id ${companyId}`);
      }
    }
  }

  console.log(`Migration complete. Updated ${usersUpdated} users and ${invoicesUpdated} invoices.`);
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
