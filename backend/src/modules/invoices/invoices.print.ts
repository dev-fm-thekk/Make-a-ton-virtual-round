// Server-rendered, print-ready invoice (A4). Everything dynamic is HTML-escaped: names, addresses and descriptions
// come from users and must never become markup.

export const COMPANY = { name: "Brightloop Software", tagline: "Subscription billing" };

export const escapeHtml = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface PrintableInvoice {
  number: string | null;
  status: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  billTo: { name: string; email: string; taxId: string | null; address: Record<string, string> | null };
  subscriptionNumber: string;
  paymentTermName: string | null;
  lines: { description: string; quantity: number; unitPrice: string; discountAmount: string; taxRatePercent: string; taxAmount: string; lineTotal: string }[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balance: string;
  notes: string | null;
}

function fmt(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

const dateFmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export function renderInvoiceHtml(inv: PrintableInvoice): string {
  const m = (v: string) => escapeHtml(fmt(v, inv.currency));
  const a = inv.billTo.address;
  const address = a ? [a.line1, a.line2, [a.city, a.state, a.postalCode].filter(Boolean).join(", "), a.country].filter(Boolean).map(escapeHtml).join("<br>") : "";
  const hasDiscount = Number(inv.discountTotal) > 0;
  const draft = inv.status === "DRAFT" || inv.status === "CANCELLED";

  const rows = inv.lines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.description)}</td>
        <td class="n">${escapeHtml(l.quantity)}</td>
        <td class="n">${m(l.unitPrice)}</td>
        ${hasDiscount ? `<td class="n">${Number(l.discountAmount) ? "−" + m(l.discountAmount) : ""}</td>` : ""}
        <td class="n">${Number(l.taxRatePercent)}%</td>
        <td class="n">${m(l.lineTotal)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${escapeHtml(inv.number ?? "(draft)")}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #14161a; margin: 0; padding: 24px; position: relative; }
  .wrap { max-width: 800px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #14161a; padding-bottom: 16px; }
  h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
  .muted { color: #5d6573; }
  .meta { text-align: right; }
  .meta strong { font-size: 18px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #5d6573; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #5d6573; border-bottom: 1px solid #c9ced6; padding: 8px 6px; }
  td { padding: 10px 6px; border-bottom: 1px solid #eceef2; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  th.n { text-align: right; }
  .totals { margin: 16px 0 0 auto; width: 300px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 6px; }
  .totals .grand { border-top: 2px solid #14161a; margin-top: 4px; padding-top: 8px; font-size: 16px; font-weight: 700; }
  .totals .due { background: #f1f3f6; font-weight: 700; }
  .status { display: inline-block; border: 1px solid currentColor; border-radius: 4px; padding: 1px 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  .PAID { color: #15803d; } .CONFIRMED { color: #b45309; } .DRAFT, .CANCELLED { color: #5d6573; }
  .watermark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-size: 110px; font-weight: 800; color: rgba(20,22,26,.07); transform: rotate(-20deg); pointer-events: none; }
  footer { margin-top: 32px; font-size: 12px; color: #5d6573; border-top: 1px solid #eceef2; padding-top: 12px; }
  @media print { body { padding: 0; } }
</style></head>
<body>
${draft ? `<div class="watermark">${escapeHtml(inv.status)}</div>` : ""}
<div class="wrap">
  <header>
    <div><h1>${escapeHtml(COMPANY.name)}</h1><div class="muted">${escapeHtml(COMPANY.tagline)}</div></div>
    <div class="meta">
      <div class="muted">Invoice</div>
      <strong>${escapeHtml(inv.number ?? "Draft")}</strong><br>
      <span class="status ${escapeHtml(inv.status)}">${escapeHtml(inv.status)}</span>
    </div>
  </header>

  <div class="grid">
    <div>
      <h2>Bill to</h2>
      <strong>${escapeHtml(inv.billTo.name)}</strong><br>
      ${address ? address + "<br>" : ""}
      ${escapeHtml(inv.billTo.email)}
      ${inv.billTo.taxId ? `<br><span class="muted">Tax ID:</span> ${escapeHtml(inv.billTo.taxId)}` : ""}
    </div>
    <div>
      <h2>Details</h2>
      <div><span class="muted">Issued:</span> ${escapeHtml(dateFmt(inv.issueDate))}</div>
      <div><span class="muted">Due:</span> ${escapeHtml(dateFmt(inv.dueDate))}${inv.paymentTermName ? ` <span class="muted">(${escapeHtml(inv.paymentTermName)})</span>` : ""}</div>
      <div><span class="muted">Period:</span> ${escapeHtml(dateFmt(inv.periodStart))} – ${escapeHtml(dateFmt(inv.periodEnd))}</div>
      <div><span class="muted">Subscription:</span> ${escapeHtml(inv.subscriptionNumber)}</div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th>Description</th><th class="n">Qty</th><th class="n">Unit price</th>${hasDiscount ? '<th class="n">Discount</th>' : ""}<th class="n">Tax</th><th class="n">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div><span>Subtotal</span><span>${m(inv.subtotal)}</span></div>
    ${hasDiscount ? `<div><span>Discount</span><span>−${m(inv.discountTotal)}</span></div>` : ""}
    <div><span>Tax</span><span>${m(inv.taxTotal)}</span></div>
    <div class="grand"><span>Total</span><span>${m(inv.total)}</span></div>
    ${Number(inv.amountPaid) > 0 ? `<div><span>Paid</span><span>−${m(inv.amountPaid)}</span></div>` : ""}
    <div class="due"><span>Amount due</span><span>${m(inv.balance)}</span></div>
  </div>

  ${inv.notes ? `<footer><strong>Notes</strong><br>${escapeHtml(inv.notes).replace(/\n/g, "<br>")}</footer>` : ""}
  <footer>Thank you for your business. Please quote the invoice number with your payment.</footer>
</div>
</body></html>`;
}
