import { fetchText } from "@/lib/api";

/**
 * Opens the printable invoice in a new tab and starts the browser's print dialog (which can also "Save as PDF").
 * The tab is opened synchronously inside the click, then filled once the HTML has loaded, because
 * browsers block pop-ups that open after an await.
 */
export async function printInvoice(id: string): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Your browser blocked the print window. Allow pop-ups for this site and try again.");
  win.document.title = "Loading invoice…";
  try {
    const html = await fetchText(`/invoices/${id}/print`);
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    // give images/fonts a beat to lay out before the print dialog snapshots the page
    setTimeout(() => win.print(), 300);
  } catch (err) {
    win.close();
    throw err;
  }
}
