const form = document.getElementById("invoiceForm");

const fields = [
  "seller",
  "gstin",
  "sellerAddress",
  "buyer",
  "buyerGstin",
  "buyerAddress",
  "state",
  "place",
  "date",
  "description",
  "hsn",
  "qty",
  "rate",
  "gstRate",
  "discount",
  "notes",
];

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(value);

function getValues() {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      document.getElementById(field)?.value.trim() ?? "",
    ])
  );
}

function calculateInvoice() {
  const qty = Number(document.getElementById("qty").value) || 0;
  const rate = Number(document.getElementById("rate").value) || 0;
  const discount = Number(document.getElementById("discount").value) || 0;
  const gstRate = Number(document.getElementById("gstRate").value) || 0;

  const taxable = Math.max(0, qty * rate - discount);
  const tax = (taxable * gstRate) / 100;

  const place = document.getElementById("place").value;
  const inter = place === "inter";

  const cgst = inter ? 0 : tax / 2;
  const sgst = inter ? 0 : tax / 2;
  const igst = inter ? tax : 0;
  const total = taxable + tax;

  document.getElementById("sumTaxable").textContent = money(taxable);
  document.getElementById("sumCgst").textContent = money(cgst);
  document.getElementById("sumSgst").textContent = money(sgst);
  document.getElementById("sumIgst").textContent = money(igst);
  document.getElementById("sumTotal").textContent = money(total);

  document.getElementById("cgstRow").hidden = inter;
  document.getElementById("sgstRow").hidden = inter;
  document.getElementById("igstRow").hidden = !inter;

  return { qty, rate, discount, gstRate, taxable, tax, cgst, sgst, igst, total, inter };
}

function saveInvoice(status) {
  const values = getValues();
  const calculations = calculateInvoice();

  const invoice = {
    ...values,
    ...calculations,
    id: `INV-${Date.now()}`,
    status,
    createdAt: new Date().toISOString(),
  };

  const savedInvoices = JSON.parse(
    localStorage.getItem("vittasetu_invoices") || "[]"
  );

  savedInvoices.push(invoice);
  localStorage.setItem("vittasetu_invoices", JSON.stringify(savedInvoices));

  return invoice;
}

// Recalculate whenever an item or GST field changes.
["qty", "rate", "discount", "gstRate", "place"].forEach((id) => {
  document.getElementById(id).addEventListener("input", calculateInvoice);
  document.getElementById(id).addEventListener("change", calculateInvoice);
});

// Generate Invoice
form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!form.reportValidity()) return;

  const invoice = saveInvoice("Generated");
  showInvoicePreview(invoice);
});

// Save Draft
document.getElementById("saveDraft").addEventListener("click", () => {
  saveInvoice("Draft");
  alert("Draft saved successfully!");
});

// Set today's date as the default invoice date.
document.getElementById("date").value = new Date()
  .toISOString()
  .split("T")[0];

// Initial calculation
calculateInvoice();

const formPage = document.getElementById("invoiceForm");
const previewPage = document.getElementById("invoicePreviewPage");
const previewContent = document.getElementById("invoicePreviewContent");

function showInvoicePreview(invoice) {
  formPage.closest("section").hidden = true;
  previewPage.hidden = false;

  const money = (value) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
    }).format(Number(value) || 0);

  previewContent.innerHTML = `
    <div class="invoice-preview">
      <h2>TAX INVOICE</h2>
      <p><strong>Invoice ID:</strong> ${invoice.id}</p>
      <p><strong>Date:</strong> ${invoice.date}</p>

      <div class="preview-details">
        <div>
          <h3>Seller</h3>
          <p>${invoice.seller}</p>
          <p>${invoice.sellerAddress}</p>
          <p>GSTIN: ${invoice.gstin || "—"}</p>
        </div>

        <div>
          <h3>Bill To</h3>
          <p>${invoice.buyer}</p>
          <p>${invoice.buyerAddress}</p>
          <p>GSTIN: ${invoice.buyerGstin || "—"}</p>
          <p>State: ${invoice.state || "—"}</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>HSN/SAC</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Taxable</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${invoice.description}</td>
            <td>${invoice.hsn || "—"}</td>
            <td>${invoice.qty}</td>
            <td>${money(invoice.rate)}</td>
            <td>${money(invoice.taxable)}</td>
          </tr>
        </tbody>
      </table>

      <p>CGST: ${money(invoice.cgst)}</p>
      <p>SGST: ${money(invoice.sgst)}</p>
      <p>IGST: ${money(invoice.igst)}</p>
      <p class="preview-total">Total: ${money(invoice.total)}</p>

      ${invoice.notes ? `<p><strong>Notes:</strong> ${invoice.notes}</p>` : ""}
    </div>
  `;
}

document.getElementById("backToForm").addEventListener("click", () => {
  previewPage.hidden = true;
  formPage.closest("section").hidden = false;
});

document.getElementById("downloadPdf").addEventListener("click", () => {
  const element = document.getElementById("invoicePreviewContent");

  if (typeof html2pdf === "undefined") {
    alert("PDF library did not load. Check your internet connection.");
    return;
  }

  html2pdf()
    .set({
      margin: 10,
      filename: "invoice.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    })
    .from(element)
    .save();
});