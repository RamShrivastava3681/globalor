import { TABLES, scanTable, updateItemConditional, getItem } from "../db/client.js";
import { nowISO } from "./helpers.js";
import { sendReminderEmail } from "./email.js";
import { config } from "../config.js";
import type { Invoice, Debtor, Profile, ReminderEntry } from "../types/index.js";

/** Statuses that are still owed money and can be reminded. */
const OPEN_STATUSES = new Set(["approved", "advanced", "funded", "overdue"]);

/**
 * One overdue-reminder sweep: for every open invoice past its due date whose
 * debtor has an email, send a reminder and stamp `last_overdue_reminder_date`
 * so it only ever goes out once per day. Fire-and-forget emails — a send
 * failure never blocks the sweep or rolls back the stamp.
 */
export async function runOverdueReminderSweep(): Promise<{
  reminded: number;
  skipped: number;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const invoices = await scanTable<Invoice>(TABLES.INVOICES);
  let reminded = 0;
  let skipped = 0;

  const candidates = invoices.filter(
    (inv) =>
      OPEN_STATUSES.has(inv.status) &&
      inv.due_date &&
      inv.due_date < today &&
      inv.noa_status !== "not_sent" &&
      inv.last_overdue_reminder_date !== today &&
      inv.debtor_id,
  );

  for (const inv of candidates) {
    try {
      const debtor = inv.debtor_id
        ? await getItem(TABLES.DEBTORS, { id: inv.debtor_id }) as Debtor | undefined
        : undefined;
      if (!debtor?.contact_email) {
        skipped += 1;
        continue;
      }
      const client = inv.client_id
        ? await getItem(TABLES.PROFILES, { id: inv.client_id }) as Profile | undefined
        : undefined;

      const daysOverdue = Math.max(
        1,
        Math.round((new Date(today).getTime() - new Date(inv.due_date!).getTime()) / 86400000),
      );
      const invoiceUrl = `${config.appUrl}/noa/${inv.noa_token}`;

      const entry: ReminderEntry = {
        sent_at: nowISO(),
        type: "overdue",
        to: debtor.contact_email,
        note: `Overdue by ${daysOverdue} day${daysOverdue === 1 ? "" : "s"}`,
      };
      const log = [...(inv.reminder_log ?? []), entry];

      // Conditional stamp FIRST: `#lod <> :today` closes the multi-instance
      // race — exactly one sweep wins each invoice per day, so the email can
      // never go out twice for the same daily tick. A null result means
      // another instance already stamped today — skip the email.
      const stamped = await updateItemConditional(
        TABLES.INVOICES,
        { id: inv.id },
        {
          last_overdue_reminder_date: today,
          reminder_log: log,
          updated_at: nowISO(),
        },
        "#lod <> :today",
        { "#lod": "last_overdue_reminder_date" },
        { ":today": today },
      );
      if (!stamped) {
        skipped += 1;
        continue;
      }

      // Fire-and-forget (guide invariant 6): a failed email never rolls back
      // the stamp — the debtor is reminded at most once per day regardless.
      await sendReminderEmail({
        to: debtor.contact_email,
        debtorName: debtor.name,
        debtorContactName: debtor.contact_name ?? null,
        invoiceNumber: inv.invoice_number,
        amount: inv.amount,
        dueDate: inv.due_date,
        daysOverdue,
        companyName: client?.company_name || "A client",
        invoiceUrl,
      });
      reminded += 1;
    } catch (err) {
      console.error(`   ⚠️ Overdue reminder failed for ${inv.invoice_number}:`, err);
      skipped += 1;
    }
  }

  return { reminded, skipped };
}
