import { describe, expect, it } from "vitest";
import { renderInvoiceEmail } from "./invoices.mail.js";
import { escapeHtml, renderInvoiceHtml, type PrintableInvoice } from "./invoices.print.js";
import { paymentState } from "./derive.js";

const base: PrintableInvoice = {
  number: "INV-2026-000042",
  status: "CONFIRMED",
  currency: "INR",
  issueDate: "2026-03-01",
  dueDate: "2026-03-16",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  billTo: { name: "Acme Retail", email: "billing@acme.test", taxId: "29ABCDE1234F1Z5", address: { line1: "12 Market Road", city: "Pune", postalCode: "411001", country: "India" } },
  subscriptionNumber: "SUB-2026-000007",
  paymentTermName: "Net 15",
  lines: [{ description: "CRM Suite (Brand: Odoo)", quantity: 2, unitPrice: "1560.00", discountAmount: "0.00", taxRatePercent: "18.00", taxAmount: "561.60", lineTotal: "3681.60" }],
  subtotal: "3120.00",
  discountTotal: "0.00",
  taxTotal: "561.60",
  total: "3681.60",
  amountPaid: "0.00",
  balance: "3681.60",
  notes: null,
};

describe("escapeHtml", () => {
  it("neutralises markup and quotes", () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">&`)).toBe("&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("renderInvoiceHtml", () => {
  it("shows the essentials", () => {
    const html = renderInvoiceHtml(base);
    for (const t of ["INV-2026-000042", "Acme Retail", "SUB-2026-000007", "Net 15", "29ABCDE1234F1Z5", "Amount due"]) expect(html).toContain(t);
    expect(html).not.toContain("watermark\">"); // issued invoices carry no watermark
  });
  it("never lets user-supplied text become markup", () => {
    const evil = `<script>alert(1)</script>`;
    const html = renderInvoiceHtml({ ...base, billTo: { ...base.billTo, name: evil, address: { line1: evil, city: evil, postalCode: "1", country: "x" } }, lines: [{ ...base.lines[0]!, description: evil }], notes: evil });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("adds a DRAFT / CANCELLED watermark", () => {
    expect(renderInvoiceHtml({ ...base, status: "DRAFT", number: null })).toContain('class="watermark">DRAFT');
    expect(renderInvoiceHtml({ ...base, status: "CANCELLED" })).toContain('class="watermark">CANCELLED');
  });
  it("shows the discount column and total only when there is a discount", () => {
    expect(renderInvoiceHtml(base)).not.toContain("<th class=\"n\">Discount</th>");
    const withDiscount = renderInvoiceHtml({ ...base, discountTotal: "100.00", lines: [{ ...base.lines[0]!, discountAmount: "100.00" }] });
    expect(withDiscount).toContain('<th class="n">Discount</th>');
  });
});

describe("renderInvoiceEmail", () => {
  const input = { number: "INV-1", customerName: "<b>Priya</b>", total: "100.00", balance: "40.00", currency: "INR", dueDate: "2026-03-16", status: "CONFIRMED", link: "https://app.test/my/invoices/1" };
  it("escapes values in HTML and states the amount due", () => {
    const m = renderInvoiceEmail(input);
    expect(m.subject).toContain("INV-1");
    expect(m.html).not.toContain("<b>Priya</b>");
    expect(m.html).toContain("&lt;b&gt;Priya&lt;/b&gt;");
    expect(m.text).toContain("https://app.test/my/invoices/1");
  });
  it("turns into a receipt once paid", () => {
    const m = renderInvoiceEmail({ ...input, status: "PAID", balance: "0.00" });
    expect(m.subject).toMatch(/^Receipt/);
    expect(m.text).toContain("paid in full");
  });
});

describe("paymentState", () => {
  const today = new Date("2026-06-15");
  it("derives overdue from the due date, never from stored state", () => {
    expect(paymentState("CONFIRMED", new Date("2026-06-14"), today)).toBe("overdue");
    expect(paymentState("CONFIRMED", new Date("2026-06-15"), today)).toBe("outstanding"); // due today is not late yet
    expect(paymentState("PAID", new Date("2020-01-01"), today)).toBe("paid");
    expect(paymentState("DRAFT", new Date("2020-01-01"), today)).toBe("draft");
    expect(paymentState("CANCELLED", new Date("2020-01-01"), today)).toBe("cancelled");
  });
});
