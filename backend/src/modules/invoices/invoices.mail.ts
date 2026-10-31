import { escapeHtml } from "./invoices.print.js";

export interface InvoiceEmailInput {
  number: string;
  customerName: string;
  total: string;
  balance: string;
  currency: string;
  dueDate: string;
  status: string;
  link: string;
}

const fmt = (v: string, currency: string) => {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(v));
  } catch {
    return `${currency} ${v}`;
  }
};

/** Plain-text + HTML bodies. Every interpolated value is escaped in the HTML part. */
export function renderInvoiceEmail(i: InvoiceEmailInput): { subject: string; text: string; html: string } {
  const paid = i.status === "PAID";
  const total = fmt(i.total, i.currency);
  const due = fmt(i.balance, i.currency);
  const subject = paid ? `Receipt for invoice ${i.number}` : `Invoice ${i.number} – ${due} due ${i.dueDate}`;

  const text = [
    `Hi ${i.customerName},`,
    "",
    paid ? `Thank you: invoice ${i.number} (${total}) is paid in full.` : `Invoice ${i.number} for ${total} is ready. Amount due: ${due} by ${i.dueDate}.`,
    "",
    `View or print it here: ${i.link}`,
    "",
    "Please quote the invoice number with your payment.",
  ].join("\n");

  const html =
    `<p>Hi ${escapeHtml(i.customerName)},</p>` +
    (paid
      ? `<p>Thank you: invoice <strong>${escapeHtml(i.number)}</strong> (${escapeHtml(total)}) is paid in full.</p>`
      : `<p>Invoice <strong>${escapeHtml(i.number)}</strong> for ${escapeHtml(total)} is ready.<br>Amount due: <strong>${escapeHtml(due)}</strong> by ${escapeHtml(i.dueDate)}.</p>`) +
    `<p><a href="${escapeHtml(i.link)}">View or print the invoice</a></p><p>Please quote the invoice number with your payment.</p>`;

  return { subject, text, html };
}
