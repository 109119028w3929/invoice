/*
Offline Invoice App (React)
Single-file App component + helper code.

Features implemented:
- IndexedDB master data (items) and invoices storage (using small wrapper)
- Add/edit/delete items in master data
- Dropdown selection of items when creating invoice (auto-fill price)
- Auto-calculation (qty x price -> line total, subtotal, grand total)
- Auto-generate invoice numbers (prefix + incremental + date)
- Store invoices offline in IndexedDB (persist between sessions)
- Export/Import JSON and CSV
- Import Excel (CSV) mapping via simple column mapping UI
- Search/filter by customer/name/date range/invoice number
- Dashboard: total invoices, revenue, monthly/yearly summaries
- Print via window.print()
- PDF export via jsPDF (requires jspdf dependency)
- PWA hooks (service worker registration stub)

Dependencies you should install when creating a project:
- react, react-dom
- jspdf (for PDF export)
- file-saver (optional, for CSV export)
- tailwindcss (optional, for styling)

How to use: create a React app (Vite/CRA), add this file as App.jsx, install dependencies.

This file focuses on functionality. Styling uses Tailwind-like classes; adapt to your CSS.
*/

import React, { useEffect, useState, useRef } from "react";
import { jsPDF } from "jspdf";
import './App.css';
import stampSignImage from './image/stamp_sign.png';


/* ---------- Simple IndexedDB wrapper ---------- */
function openDB(dbName = "invoice_app", version = 2) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("items")) {
        const items = db.createObjectStore("items", { keyPath: "id", autoIncrement: true });
        items.createIndex("name", "name", { unique: false });
      }
      if (!db.objectStoreNames.contains("invoices")) {
        const inv = db.createObjectStore("invoices", { keyPath: "id", autoIncrement: true });
        inv.createIndex("invoiceNumber", "invoiceNumber", { unique: true });
        inv.createIndex("date", "date", { unique: false });
        inv.createIndex("customerName", "customer.name", { unique: false });
      }
      if (!db.objectStoreNames.contains("customers")) {
        const customers = db.createObjectStore("customers", { keyPath: "id", autoIncrement: true });
        customers.createIndex("name", "name", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction([store], "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction([store], "readwrite");
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbAdd(store, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction([store], "readwrite");
    const req = tx.objectStore(store).add(value);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbDelete(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction([store], "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res(true);
    req.onerror = () => rej(req.error);
  });
}
async function idbGetAll(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction([store], "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}

/* ---------- Helpers ---------- */
function formatCurrency(num, currency = "INR") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(num);
  } catch (e) {
    return num.toFixed(2);
  }
}

function csvEscape(val) {
  if (val == null) return "";
  const s = String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/* ---------- Number to Words Converter ---------- */
function numberToWords(num) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  function convertHundreds(n) {
    let result = '';
    if (n > 99) {
      result += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n > 19) {
      result += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0) {
      result += ones[n] + ' ';
    }
    return result.trim();
  }
  
  if (num === 0) return 'Zero';
  
  const numStr = num.toString();
  const parts = numStr.split('.');
  let integerPart = parseInt(parts[0], 10);
  const decimalPart = parts[1] ? parseInt(parts[1].substring(0, 2), 10) : 0;
  
  let words = '';
  
  if (integerPart >= 10000000) {
    const crores = Math.floor(integerPart / 10000000);
    words += convertHundreds(crores) + 'Crore ';
    integerPart %= 10000000;
  }
  if (integerPart >= 100000) {
    const lakhs = Math.floor(integerPart / 100000);
    words += convertHundreds(lakhs) + 'Lakh ';
    integerPart %= 100000;
  }
  if (integerPart >= 1000) {
    const thousands = Math.floor(integerPart / 1000);
    words += convertHundreds(thousands) + 'Thousand ';
    integerPart %= 1000;
  }
  if (integerPart > 0) {
    words += convertHundreds(integerPart);
  }
  
  words = words.trim() + ' Rupees';
  
  if (decimalPart > 0) {
    words += ' and ' + convertHundreds(decimalPart) + 'Paise';
  }
  
  return words.trim() + ' Only';
}

/* ---------- Date Formatter ---------- */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

/* ---------- Default bank / seller details ---------- */
const DEFAULT_SELLER = {
  businessName: "Yogiraj Men's Wear",
  owner: "Yogesh Vasudev Shetty",
  address: "3 Gumph Ashram ,Majaswadi,Trishul building,Jogeshwari - East, Mumbai - 4000603",
  contact: "Mob: 9967777884 | 8652241919",
  panNo: "ABCDE1234F", // Add your PAN number here, e.g., "ABCDE1234F"
  bank: {
    name: "PUNJAB NATIONAL BANK",
    accountName: "MR. YOGESH VASUDEV SHETTY",
    accountNo: "52702413000290",
    ifsc: "PUNB0527010",
    upi: "yogesh@upi"
  }
};

/* ---------- App ---------- */
export default function App() {
  const [items, setItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [seller, setSeller] = useState(DEFAULT_SELLER);
  const [filter, setFilter] = useState({ q: "", from: "", to: "", invoiceNumber: "" });
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  useEffect(() => {
    (async () => {
      const its = await idbGetAll("items");
      const invs = await idbGetAll("invoices");
      const custs = await idbGetAll("customers");
      setItems(its);
      setInvoices(invs.sort((a, b) => new Date(b.date) - new Date(a.date)));
      setCustomers(custs);
      // ensure a basic invoice counter in meta
      const ctr = await idbGet("meta", "invoice_counter");
      if (!ctr) await idbPut("meta", { key: "invoice_counter", value: 1 });
    })();
  }, []);

  async function addItem(item) {
    const id = await idbAdd("items", item);
    item.id = id;
    setItems(prev => [...prev, item]);
  }
  async function updateItem(item) {
    await idbPut("items", item);
    setItems(prev => prev.map(p => p.id === item.id ? item : p));
  }
  async function deleteItem(id) {
    await idbDelete("items", id);
    setItems(prev => prev.filter(p => p.id !== id));
  }

  async function addCustomer(customer) {
    const id = await idbAdd("customers", customer);
    customer.id = id;
    setCustomers(prev => [...prev, customer]);
  }
  async function updateCustomer(customer) {
    await idbPut("customers", customer);
    setCustomers(prev => prev.map(p => p.id === customer.id ? customer : p));
  }
  async function deleteCustomer(id) {
    await idbDelete("customers", id);
    setCustomers(prev => prev.filter(p => p.id !== id));
  }

  async function saveInvoice(invoice, editId) {
    if (editId) {
      // Find the existing invoice to preserve its invoiceNumber
      const existingInvoice = invoices.find(i => i.id === editId);
      if (existingInvoice) {
        invoice.invoiceNumber = existingInvoice.invoiceNumber;
      }
      invoice.id = editId;
      await idbPut("invoices", invoice);
      setInvoices(prev => prev.map(i => i.id === editId ? invoice : i));
      return invoice;
    }
    // generate invoice number
    // Structure: YG-YYYYMMDD-####
    // - YG: Business prefix (Yogiraj)
    // - YYYYMMDD: Date in format Year(4)Month(2)Day(2), e.g., 20251213 for Dec 13, 2025
    // - ####: Sequential counter (4 digits, zero-padded), increments for each new invoice
    // Example: YG-20251213-0004 means: Yogiraj invoice, dated Dec 13, 2025, invoice #4
    const meta = await idbGet("meta", "invoice_counter");
    const counter = (meta && meta.value) ? meta.value : 1;
    const date = new Date(invoice.date || Date.now());
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const invoiceNumber = `YG-${yyyy}${mm}${dd}-${String(counter).padStart(4, "0")}`;
    invoice.invoiceNumber = invoiceNumber;
    const id = await idbAdd("invoices", invoice);
    invoice.id = id;
    setInvoices(prev => [invoice, ...prev]);
    await idbPut("meta", { key: "invoice_counter", value: counter + 1 });
    return invoice;
  }

  async function deleteInvoice(id) {
    await idbDelete("invoices", id);
    setInvoices(prev => prev.filter(i => i.id !== id));
  }

  function filteredInvoices() {
    let res = invoices;
    if (filter.q) res = res.filter(inv => (inv.customer?.name || "").toLowerCase().includes(filter.q.toLowerCase()));
    if (filter.invoiceNumber) res = res.filter(inv => (inv.invoiceNumber || "").includes(filter.invoiceNumber));
    if (filter.from) res = res.filter(inv => new Date(inv.date) >= new Date(filter.from));
    if (filter.to) res = res.filter(inv => new Date(inv.date) <= new Date(filter.to));
    return res;
  }

  return (
    <div className="app-container">
      {/* Header Section */}
      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">Invoice Generator</h1>
          <p className="app-subtitle">Professional Invoice Management System — Yogiraj Men's Wear</p>
          <div className="header-stats">
            <div className="stat-item">
              <span className="stat-number">{invoices.length}</span>
              <span className="stat-label">Total Invoices</span>
            </div>
            <div className="stat-item">
              <span className="stat-number">₹{invoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0)}</span>
              <span className="stat-label">Total Revenue</span>
            </div>
            <div className="stat-item">
              <span className="stat-number">{items.length}</span>
              <span className="stat-label">Items</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="main-content">
        {/* Top Row - Create Invoice and Master Data */}
        <div className="content-row">
          <section className="card invoice-form-section">
            <h2 className="card-title">📝 Create Invoice</h2>
            <InvoiceForm items={items} customers={customers} addItem={addItem} saveInvoice={saveInvoice} seller={seller} setSelectedInvoice={setSelectedInvoice} updateItem={updateItem} />
          </section>

          <aside className="card master-data-section">
            <h3 className="card-title">📦 Master Data (Items)</h3>
            <MasterData items={items} onAdd={addItem} onUpdate={updateItem} onDelete={deleteItem} />
            <h3 className="card-title mt-4">👥 Master Data (Customers)</h3>
            <CustomerMasterData customers={customers} onAdd={addCustomer} onUpdate={updateCustomer} onDelete={deleteCustomer} />
            <div className="dashboard-section">
              <Dashboard invoices={invoices} />
            </div>
          </aside>
        </div>

        {/* Bottom Row - Invoice Management */}
        <section className="card invoice-management-section">
          <h3 className="card-title">📋 Invoice Management</h3>
          
          {/* Search and Filter Section */}
          <div className="search-filter-section">
            <div className="search-filters">
              <div className="form-group">
                <label className="form-label">Search Customer</label>
                <input 
                  placeholder="Enter customer name..." 
                  value={filter.q} 
                  onChange={e => setFilter({ ...filter, q: e.target.value })} 
                  className="form-input" 
                />
              </div>
              <div className="form-group">
                <label className="form-label">From Date</label>
                <input 
                  type="date" 
                  value={filter.from} 
                  onChange={e => setFilter({ ...filter, from: e.target.value })} 
                  className="form-input" 
                />
              </div>
              <div className="form-group">
                <label className="form-label">To Date</label>
                <input 
                  type="date" 
                  value={filter.to} 
                  onChange={e => setFilter({ ...filter, to: e.target.value })} 
                  className="form-input" 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Invoice Number</label>
                <input 
                  placeholder="Enter invoice number..." 
                  value={filter.invoiceNumber} 
                  onChange={e => setFilter({ ...filter, invoiceNumber: e.target.value })} 
                  className="form-input" 
                />
              </div>
            </div>
          </div>

          {/* Invoice List Section */}
          <div className="invoice-list-section">
            <InvoiceList invoices={filteredInvoices()} onEdit={(inv) => { setSelectedInvoice(inv); window.scrollTo({ top: 0, behavior: 'smooth' }) }} onDelete={deleteInvoice} seller={seller} />
          </div>

          {/* Import/Export Section */}
          <div className="import-export-section">
            <ImportExport invoices={invoices} setInvoices={setInvoices} />
          </div>
        </section>
      </main>
    </div>
  );
}

/* ---------- MasterData component ---------- */
function MasterData({ items, onAdd, onUpdate, onDelete }) {
  const [form, setForm] = useState({ name: "", price: 0, sku: "" });
  const [editing, setEditing] = useState(null);

  function submit(e) {
    e.preventDefault();
    if (editing) {
      onUpdate({ ...editing, ...form });
      setEditing(null);
    } else {
      onAdd({ ...form });
    }
    setForm({ name: "", price: 0, sku: "" });
  }

  function startEdit(item) {
    setEditing(item);
    setForm({ name: item.name, price: item.price, sku: item.sku });
  }

  return (
    <div>
      <form onSubmit={submit} className="grid grid-cols-4 gap-2 items-end">
        <div className="form-group">
          <label className="form-label">Name</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="form-input" />
        </div>
        <div className="form-group">
          <label className="form-label">SKU</label>
          <input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="form-input" />
        </div>
        <div className="form-group">
          <label className="form-label">Price</label>
          <input type="number" value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value || 0) })} className="form-input" />
        </div>
        <div className="form-group">
          <button className="btn btn-primary">{editing ? 'Update' : 'Add'}</button>
        </div>
      </form>

      <div className="mt-4 max-h-48 overflow-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>SKU</th><th>Price</th><th>Actions</th></tr></thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id}>
                <td>{it.name}</td>
                <td>{it.sku}</td>
                <td>₹{it.price}</td>
                <td className="text-right">
                  <button onClick={() => startEdit(it)} className="btn btn-sm btn-secondary mr-2">Edit</button>
                  <button onClick={() => onDelete(it.id)} className="btn btn-sm btn-danger">Delete</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-gray-500">No items yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- CustomerMasterData component ---------- */
function CustomerMasterData({ customers, onAdd, onUpdate, onDelete }) {
  const [form, setForm] = useState({ name: "", contact: "", address: "" });
  const [editing, setEditing] = useState(null);

  function submit(e) {
    e.preventDefault();
    if (editing) {
      onUpdate({ ...editing, ...form });
      setEditing(null);
    } else {
      onAdd({ ...form });
    }
    setForm({ name: "", contact: "", address: "" });
  }

  function startEdit(customer) {
    setEditing(customer);
    setForm({ name: customer.name, contact: customer.contact, address: customer.address });
  }

  return (
    <div>
      <form onSubmit={submit} className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <div className="form-group">
            <label className="form-label">Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="form-input" />
          </div>
          <div className="form-group">
            <label className="form-label">Contact</label>
            <input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} className="form-input" />
          </div>
          <div className="form-group">
            <button className="btn btn-primary">{editing ? 'Update' : 'Add'}</button>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Address</label>
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="form-input" />
        </div>
      </form>

      <div className="mt-4 max-h-48 overflow-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Contact</th><th>Address</th><th>Actions</th></tr></thead>
          <tbody>
            {customers.map(cust => (
              <tr key={cust.id}>
                <td>{cust.name}</td>
                <td>{cust.contact}</td>
                <td>{cust.address}</td>
                <td className="text-right">
                  <button onClick={() => startEdit(cust)} className="btn btn-sm btn-secondary mr-2">Edit</button>
                  <button onClick={() => onDelete(cust.id)} className="btn btn-sm btn-danger">Delete</button>
                </td>
              </tr>
            ))}
            {customers.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-gray-500">No customers yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- InvoiceForm component ---------- */
function InvoiceForm({ items, customers, addItem, saveInvoice, seller, setSelectedInvoice, updateItem }) {
  const emptyLine = { itemId: null, description: "", qty: 1, price: 0, total: 0 };
  const [customer, setCustomer] = useState({ name: "", address: "", contact: "" });
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([{ ...emptyLine }]);
  const [paymentTerms, setPaymentTerms] = useState("Due on receipt");
  const [currency, setCurrency] = useState("INR");
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [showPanNo, setShowPanNo] = useState(false);

  // Removed the problematic useEffect that was causing infinite re-renders
  // Calculation is now handled directly in updateLine function

  function addLine() { setLines(prev => [...prev, { ...emptyLine }]); }
  function removeLine(idx) { setLines(prev => prev.filter((_, i) => i !== idx)); }

  function updateLine(idx, patch) {
    setLines(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...patch };
      // Always recalculate total when updating a line
      copy[idx].total = (Number(copy[idx].qty) || 0) * (Number(copy[idx].price) || 0);
      return copy;
    });
  }

  function autoFillFromItem(idx, itemId) {
    const it = items.find(i => i.id === Number(itemId));
    if (!it) return;
    updateLine(idx, { itemId: it.id, description: it.name, price: it.price });
  }

  function subtotal() {
    return lines.reduce((s, l) => s + (Number(l.total) || 0), 0);
  }
  function grandTotal() {
    return subtotal(); // no taxes by default - extend if needed
  }

  // Function to get consolidated preview
  function getConsolidatedPreview() {
    return consolidateItems(lines);
  }

  // Function to consolidate duplicate items
  function consolidateItems(items) {
    const consolidated = {};

    items.forEach(item => {
      const key = item.description?.toLowerCase().trim();
      if (!key) return;

      if (consolidated[key]) {
        // Item already exists, add quantities and recalculate
        consolidated[key].qty += Number(item.qty) || 0;
        consolidated[key].total = consolidated[key].qty * consolidated[key].price;
      } else {
        // New item
        consolidated[key] = {
          description: item.description,
          qty: Number(item.qty) || 0,
          price: Number(item.price) || 0,
          total: (Number(item.qty) || 0) * (Number(item.price) || 0),
          itemId: item.itemId
        };
      }
    });

    return Object.values(consolidated);
  }

  async function submit(e) {
    e.preventDefault();

    // Consolidate duplicate items before saving
    const consolidatedLines = consolidateItems(lines);

    const invoice = {
      date, customer, paymentTerms, currency,
      lines: consolidatedLines,
      subtotal: consolidatedLines.reduce((s, l) => s + (Number(l.total) || 0), 0),
      total: consolidatedLines.reduce((s, l) => s + (Number(l.total) || 0), 0),
      seller,
showPanNo, // Store the checkbox state with the invoice
      createdAt: new Date().toISOString()
    };
    const saved = await saveInvoice(invoice, editingInvoiceId);
    window.alert('Saved: ' + saved.invoiceNumber);
    // reset form
    setCustomer({ name: "", address: "", contact: "" });
    setLines([{ ...emptyLine }]);
setShowPanNo(false); // Reset checkbox state
    setEditingInvoiceId(null);
  }

  // load selected invoice editing via global selection
  useEffect(() => {
    // listen to a custom event for editing
    function handler(e) {
      const inv = e.detail;
      if (!inv) return;
      setCustomer(inv.customer || { name: '', address: '', contact: '' });
      setDate(inv.date ? inv.date.split('T')[0] : new Date().toISOString().slice(0, 10));
      setLines(inv.lines.map(l => ({ itemId: l.itemId, description: l.description, qty: l.qty, price: l.price, total: l.total })));
setShowPanNo(inv.showPanNo || false); // Restore showPanNo state from saved invoice
      setEditingInvoiceId(inv.id);
    }
    window.addEventListener('editInvoice', handler);
    return () => window.removeEventListener('editInvoice', handler);
  }, []);

  // quick add item from invoice form
  async function quickAddItem() {
    const name = window.prompt('New item name');
    if (!name) return;
    const price = parseFloat(window.prompt('Price', '0') || '0');
    const sku = window.prompt('SKU', '');
    const item = { name, price, sku };
    await addItem(item);
    window.alert('Item added. Select it in the dropdown.');
  }

  return (
    <div>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="form-group">
            <label className="form-label">Customer name</label>
            <select 
              value={customer.name} 
              onChange={e => {
                const selectedCustomer = customers.find(c => c.name === e.target.value);
                if (selectedCustomer) {
                  setCustomer({ name: selectedCustomer.name, address: selectedCustomer.address, contact: selectedCustomer.contact });
                } else {
                  setCustomer({ ...customer, name: e.target.value });
                }
              }}
              className="form-input"
            >
              <option value="">-- Select Customer --</option>
              {customers.map(cust => (
                <option key={cust.id} value={cust.name}>{cust.name}</option>
              ))}
            </select>
            <input 
              value={customer.name} 
              onChange={e => setCustomer({ ...customer, name: e.target.value })} 
              className="form-input mt-2" 
              placeholder="Or enter new customer name"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Contact</label>
            <input value={customer.contact} onChange={e => setCustomer({ ...customer, contact: e.target.value })} className="form-input" />
          </div>
          <div className="form-group">
            <label className="form-label">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="form-input" />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Address</label>
          <input value={customer.address} onChange={e => setCustomer({ ...customer, address: e.target.value })} className="form-input" />
        </div>

        <div className="form-group">
          <label className="form-label flex items-center">
            <input 
              type="checkbox" 
              checked={showPanNo} 
              onChange={e => setShowPanNo(e.target.checked)} 
              className="mr-2"
            />
            Show PAN No in PDF
          </label>
        </div>

        <div className="overflow-auto">
          <table className="invoice-table">
            <thead>
              <tr><th>Item</th><th>Description</th><th>Qty</th><th>Price</th><th>Total</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {lines.map((ln, idx) => {
                // Check if this item has duplicates
                const hasDuplicates = lines.filter(l =>
                  l.description?.toLowerCase().trim() === ln.description?.toLowerCase().trim() &&
                  l.description?.trim() !== ''
                ).length > 1;

                return (
                  <tr key={idx} className={hasDuplicates ? "bg-yellow-50 border-l-4 border-yellow-400" : ""}>
                    <td>
                      <select value={ln.itemId || ""} onChange={e => autoFillFromItem(idx, e.target.value)} className="form-input">
                        <option value="">-- select --</option>
                        {items.map(it => <option key={it.id} value={it.id}>{it.name} — {it.sku || ''}</option>)}
                      </select>
                      <div className="mt-1">
                        <button type="button" onClick={quickAddItem} className="btn btn-sm btn-secondary">+ Add Item</button>
                      </div>
                    </td>
                    <td>
                      <input value={ln.description} onChange={e => updateLine(idx, { description: e.target.value })} className="form-input" />
                      {hasDuplicates && (
                        <div className="text-xs text-yellow-600 mt-1">
                          ⚠️ Duplicate item - will be consolidated
                        </div>
                      )}
                    </td>
                    <td>
                      <input type="number" value={ln.qty} onChange={e => updateLine(idx, { qty: Number(e.target.value) })} className="form-input w-20" />
                    </td>
                    <td>
                      <input type="number" value={ln.price} onChange={e => updateLine(idx, { price: Number(e.target.value) })} className="form-input w-24" />
                    </td>
                    <td>₹{ln.total}</td>
                    <td>
                      <button type="button" onClick={() => removeLine(idx)} className="btn btn-sm btn-danger">Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-4 flex gap-2 flex-wrap">
            <button type="button" onClick={addLine} className="btn btn-secondary">Add Row</button>
            <button type="button" onClick={() => {
              const consolidated = getConsolidatedPreview();
              if (consolidated.length !== lines.length) {
                const confirmConsolidate = window.confirm(`Found ${lines.length - consolidated.length} duplicate items that will be consolidated. Continue?`);
                if (confirmConsolidate) {
                  setLines(consolidated);
                }
              } else {
                window.alert('No duplicate items found to consolidate.');
              }
            }} className="btn btn-secondary">Consolidate Items</button>
            <button type="submit" className="btn btn-success">Save Invoice</button>
            <button type="button" onClick={() => printCurrentInvoice({ customer, date, lines, subtotal: subtotal(), total: grandTotal(), invoiceNumber: '' }, seller, showPanNo)} className="btn btn-primary">Print</button>
            <PdfButton seller={seller} customer={customer} date={date} lines={lines} subtotal={subtotal()} total={grandTotal()} showPanNo={showPanNo} invoiceNumber="" />
          </div>
        </div>

        <div className="text-right p-4 bg-gray-50 rounded-lg">
          <div className="text-lg mb-2">Subtotal: ₹{subtotal()}</div>
          <div className="text-xl font-bold">Total: ₹{grandTotal()}</div>
        </div>
      </form>
    </div>
  );
}

/* ---------- InvoiceList ---------- */
function InvoiceList({ invoices, onEdit, onDelete, seller }) {
  function sendEdit(inv) {
    // emit global event to populate invoice form
    window.dispatchEvent(new CustomEvent('editInvoice', { detail: inv }));
  }

  return (
    <div>
      <table className="table">
        <thead><tr><th>Invoice #</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Actions</th></tr></thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id}>
              <td className="font-semibold">{inv.invoiceNumber}</td>
              <td>{new Date(inv.date || inv.createdAt).toLocaleDateString()}</td>
              <td>{inv.customer?.name}</td>
              <td>{inv.lines?.length}</td>
              <td className="font-semibold">₹{inv.total}</td>
              <td className="text-right">
                <button onClick={() => { sendEdit(inv); onEdit(inv); }} className="btn btn-sm btn-secondary mr-1">Edit</button>
                <button onClick={() => printInvoice(inv, seller)} className="btn btn-sm btn-primary mr-1">Print</button>
<button onClick={() => exportInvoicePDF(inv, seller)} className="btn btn-sm btn-primary mr-1">PDF</button>
                <button onClick={() => exportInvoiceCSV(inv, seller)} className="btn btn-sm btn-secondary mr-1">CSV</button>
                <button onClick={() => onDelete(inv.id)} className="btn btn-sm btn-danger">Delete</button>
              </td>
            </tr>
          ))}
          {invoices.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-gray-500">No invoices</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Print / Export helpers ---------- */
function printInvoice(inv, seller, showPanNo = false) {
// Use showPanNo from invoice if saved, otherwise use passed parameter
  const shouldShowPanNo = inv.showPanNo !== undefined ? inv.showPanNo : showPanNo;
  // Use seller from invoice if available, otherwise use passed seller
  const effectiveSeller = inv.seller || seller;
  
  const w = window.open('', '_blank');
  const html = renderInvoiceHtml(inv, effectiveSeller, shouldShowPanNo);
  w.document.write(html);
w.document.title = `Invoice ${inv.invoiceNumber || ''}`;
  w.document.close();
// Wait a bit for document to load before printing
  setTimeout(() => {
  w.focus();
  w.print();
}, 100);
}

async function exportInvoicePDF(inv, seller, showPanNo = false) {
  // Use showPanNo from invoice if saved, otherwise use passed parameter
  const shouldShowPanNo = inv.showPanNo !== undefined ? inv.showPanNo : showPanNo;
  // Use seller from invoice if available, otherwise use passed seller
  const effectiveSeller = inv.seller || seller;
  
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const tableStartX = margin;
  const tableWidth = pageWidth - (2 * margin);

  // Set up fonts and colors
  doc.setFont('helvetica');

  let y = 50;
  
  // Load stamp image for PDF
  const loadStampImage = () => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataURL = canvas.toDataURL('image/png');
        resolve(dataURL);
      };
      img.onerror = reject;
      img.src = stampSignImage;
    });
  };

  // Helper function to draw table borders
  function drawTableBorders(startX, startY, rowHeight, numRows, colWidths) {
    const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
    let currentX = startX;
    
    // Draw outer border
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1);
    doc.rect(startX, startY, totalWidth, rowHeight * numRows);
    
    // Draw vertical lines
    for (let i = 0; i < colWidths.length - 1; i++) {
      currentX += colWidths[i];
      doc.line(currentX, startY, currentX, startY + (rowHeight * numRows));
    }
    
    // Draw horizontal lines
    for (let i = 1; i < numRows; i++) {
      doc.line(startX, startY + (rowHeight * i), startX + totalWidth, startY + (rowHeight * i));
    }
  }

  // Left side - Name, Brand and Address
  doc.setFontSize(22);
  doc.setTextColor(45, 90, 39); // Dark green
  doc.setFont('helvetica', 'bold');
  doc.text(effectiveSeller.owner, margin, y);

  y += 25;
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(effectiveSeller.businessName, margin, y);

  y += 20;
  doc.setFontSize(10);
  doc.setTextColor(51, 51, 51);
  doc.setFont('helvetica', 'normal');
  const addressLines = doc.splitTextToSize(effectiveSeller.address, 250);
  doc.text(addressLines, margin, y);
  y += addressLines.length * 12;

  // Right side - Invoice and Date
  const rightX = pageWidth - margin - 150;
  y = 50;
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text('Invoice', rightX, y, { align: 'right' });

  y += 20;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(inv.invoiceNumber || '', rightX, y, { align: 'right' });

  y += 20;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const formattedDate = formatDate(inv.date);
  doc.text(formattedDate, rightX, y, { align: 'right' });

  // Customer Name and Address below seller info
  y = Math.max(y, 140);
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text('Customer Name:', margin, y);

  y += 15;
  doc.setFont('helvetica', 'normal');
  doc.text(inv.customer?.name || '', margin, y);

  if (inv.customer?.address) {
    y += 15;
    doc.text(inv.customer.address, margin, y);
  }

  y += 30;

  // Table setup - adjust column widths to fit page width
  const totalColWidth = pageWidth - (2 * margin); // Total available width
  const colWidths = [60, 200, 60, 80, 80]; // Sr. No, Description, Qty, Amount, Total
  const sumColWidths = colWidths.reduce((sum, w) => sum + w, 0);
  // Scale columns if needed to fit page width
  const scaleFactor = sumColWidths > totalColWidth ? totalColWidth / sumColWidths : 1;
  const adjustedColWidths = colWidths.map(w => w * scaleFactor);
  const actualTableWidth = adjustedColWidths.reduce((sum, w) => sum + w, 0);
  
  const rowHeight = 20;
  const headerRowHeight = 25;
  const numDataRows = Math.max(inv.lines?.length || 0, 1);
  const numEmptyRows = 12;
  const totalRows = 1 + numDataRows + numEmptyRows; // Header + data + empty rows

  // Table Header with background
  doc.setFillColor(240, 240, 240);
  doc.rect(tableStartX, y - headerRowHeight, actualTableWidth, headerRowHeight, 'F');
  
  // Draw header borders
  drawTableBorders(tableStartX, y - headerRowHeight, headerRowHeight, 1, adjustedColWidths);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  
  let colX = tableStartX + 5;
  doc.text('Sr. No', colX, y - 5, { align: 'center' });
  colX += adjustedColWidths[0];
  doc.text('Description', colX + 5, y - 5, { align: 'left' });
  colX += adjustedColWidths[1];
  doc.text('Qty', colX, y - 5, { align: 'center' });
  colX += adjustedColWidths[2];
  doc.text('Amount', colX, y - 5, { align: 'right' });
  colX += adjustedColWidths[3];
  doc.text('Total', colX, y - 5, { align: 'right' });

  y += 5;

  // Draw full table borders including data and empty rows
  drawTableBorders(tableStartX, y - headerRowHeight, rowHeight, totalRows, adjustedColWidths);

  // Table Content
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  (inv.lines || []).forEach((line, index) => {
    colX = tableStartX + 5;
    doc.text(String(index + 1), colX, y, { align: 'center' });
    colX += adjustedColWidths[0];
    const descLines = doc.splitTextToSize(line.description || '', adjustedColWidths[1] - 10);
    doc.text(descLines, colX + 5, y, { align: 'left' });
    colX += adjustedColWidths[1];
    doc.text(String(line.qty), colX, y, { align: 'center' });
    colX += adjustedColWidths[2];
    doc.text(`₹${line.price}`, colX, y, { align: 'right' });
    colX += adjustedColWidths[3];
    doc.text(`₹${line.total}`, colX, y, { align: 'right' });
    y += rowHeight;
  });

  // Add empty rows
  for (let i = 0; i < numEmptyRows; i++) {
    y += rowHeight;
  }

  y += 20;

  // Totals Section - Amount in Words on left, Totals on right
  const totalQty = (inv.lines || []).reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  const totalAmount = Number(inv.total) || 0;
  
  // Amount in Words on left
  const amountInWords = numberToWords(totalAmount);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(85, 85, 85);
  const amountWordsY = y;
  doc.text(`Amount in Words: ${amountInWords}`, margin, y);

  // PAN No on left, below Amount in Words (if enabled)
  // Use effectiveSeller.panNo or fallback to DEFAULT_SELLER.panNo
  const effectivePanNo = (effectiveSeller && effectiveSeller.panNo) || DEFAULT_SELLER.panNo;
  if (shouldShowPanNo && effectivePanNo) {
    y += 15;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`Pan No: ${effectivePanNo}`, margin, y);
  }

  // Totals on right (aligned with Amount in Words line)
  const totalsX = pageWidth - margin;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(`Total Qty: ${totalQty}`, totalsX - 150, amountWordsY, { align: 'right' });
  doc.text(`Total Amount: ₹${totalAmount}`, totalsX, amountWordsY, { align: 'right' });

  // Move y to the bottom of this section (accounting for PAN No if shown)
  y = Math.max(y, amountWordsY) + 25;

  // Bank Details Section
  doc.setFillColor(249, 249, 249);
  doc.rect(margin, y - 10, actualTableWidth, 70, 'F');
  doc.setDrawColor(221, 221, 221);
  doc.setLineWidth(1);
  doc.rect(margin, y - 10, actualTableWidth, 70);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Bank Details:', margin + 10, y);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(effectiveSeller.bank.accountName, margin + 10, y + 15);
  doc.text(effectiveSeller.bank.name, margin + 10, y + 30);
  doc.text(`Account No: ${effectiveSeller.bank.accountNo}`, margin + 10, y + 45);
  doc.text(`IFSC Code: ${effectiveSeller.bank.ifsc}`, margin + 10, y + 60);

  // Add stamp image at bottom right
  try {
    const stampDataURL = await loadStampImage();
    const stampWidth = 100;
    const stampHeight = 100;
    const stampX = pageWidth - stampWidth - 40;
    const stampY = pageHeight - stampHeight - 40;
    
    doc.addImage(stampDataURL, 'PNG', stampX, stampY, stampWidth, stampHeight);
  } catch (error) {
    console.error('Error adding stamp image to PDF:', error);
  }

  // Save the PDF
  doc.save(`${inv.invoiceNumber || 'invoice'}.pdf`);
}

function printCurrentInvoice(inv, seller, showPanNo = false) {
  const w = window.open('', '_blank');
  const html = renderInvoiceHtml(inv, seller, showPanNo);
  w.document.write(html);
w.document.title = `Invoice ${inv.invoiceNumber || ''}`;
  w.document.close();
// Wait a bit for document to load before printing
  setTimeout(() => {
  w.focus();
  w.print();
}, 100);
}

function renderInvoiceHtml(inv, seller, showPanNo = false) {
  const rows = inv.lines.map((l, index) =>
    `<tr>
      <td style="text-align:center">${index + 1}</td>
      <td style="text-align:left">${escapeHtml(l.description)}</td>
      <td style="text-align:center">${l.qty}</td>
      <td style="text-align:right">₹${l.price}</td>
      <td style="text-align:right">₹${l.total}</td>
    </tr>`
  ).join('');

  // Add empty rows to match the reference image format
  const emptyRows = Array(12).fill(0).map(() =>
    `<tr>
      <td style="text-align:center"></td>
      <td style="text-align:left"></td>
      <td style="text-align:center"></td>
      <td style="text-align:right"></td>
      <td style="text-align:right"></td>
    </tr>`
  ).join('');

  const totalQty = inv.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  const totalAmount = inv.lines.reduce((sum, l) => sum + (Number(l.total) || 0), 0);
  const amountInWords = numberToWords(totalAmount);
  const formattedDate = formatDate(inv.date);
// Get PAN number from seller or fallback to DEFAULT_SELLER
  const panNo = (seller && seller.panNo) || DEFAULT_SELLER.panNo;
  const panNoDisplay = showPanNo && panNo ? `Pan No: ${escapeHtml(panNo)}` : '';

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Invoice ${inv.invoiceNumber}</title>
    <style>
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        margin: 0;
        padding: 20px;
        background: white;
        color: #333;
      }
      .invoice-container {
        max-width: 800px;
        margin: 0 auto;
        background: white;
      }
      .invoice-header {
        margin-bottom: 30px;
        padding-bottom: 15px;
      }
      .invoice-header-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 20px;
      }
      .invoice-left {
        flex: 1;
      }
      .invoice-right {
        flex: 1;
        text-align: right;
      }
      .invoice-title {
        font-size: 2.2rem;
        font-weight: 700;
        color: #2d5a27;
        margin: 0 0 8px 0;
        text-transform: uppercase;
      }
      .invoice-business-name {
        font-size: 1.5rem;
        font-weight: 600;
        color: #000;
        margin: 0 0 12px 0;
      }
      .invoice-address {
        font-size: 0.95rem;
        color: #333;
        margin: 0 0 8px 0;
      }
      .invoice-contact {
        font-size: 0.95rem;
        color: #333;
        margin: 0;
      }
      .invoice-label {
        font-size: 1.1rem;
        font-weight: 600;
        color: #000;
        margin: 0 0 5px 0;
      }
      .invoice-number {
        font-size: 1rem;
        font-weight: 700;
        color: #000;
        margin: 0 0 10px 0;
      }
      .invoice-date-value {
        font-size: 0.95rem;
        color: #333;
        margin: 0;
      }
      .invoice-customer-section {
        margin-top: 20px;
        font-size: 0.95rem;
      }
      .invoice-customer-label {
        font-weight: 600;
        margin-bottom: 5px;
      }
      .invoice-table {
        width: 100%;
        border-collapse: collapse;
        margin: 20px 0;
        border: 1px solid #000;
      }
      .invoice-table th {
        background: #f0f0f0;
        color: #000;
        padding: 12px 8px;
        text-align: center;
        font-weight: 600;
        border: 1px solid #000;
        font-size: 0.9rem;
      }
      .invoice-table td {
        padding: 10px 8px;
        border: 1px solid #000;
        text-align: center;
        font-size: 0.9rem;
      }
      .invoice-table td:first-child {
        text-align: center;
      }
      .invoice-table td:nth-child(2) {
        text-align: left;
      }
      .invoice-table td:nth-child(3) {
        text-align: center;
      }
      .invoice-table td:nth-child(4) {
        text-align: right;
      }
      .invoice-table td:last-child {
        text-align: right;
      }
      .invoice-totals {
        margin-top: 20px;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        font-size: 1rem;
      }
      .invoice-total-qty {
        margin-right: 20px;
        font-weight: 600;
      }
      .invoice-total-amount {
        font-weight: 700;
        font-size: 1.1rem;
      }
      .invoice-amount-words {
        margin-top: 10px;
        font-size: 0.95rem;
        font-style: italic;
        color: #555;
      }
      .invoice-bank-details {
        margin-top: 30px;
        padding: 15px;
        background: #f9f9f9;
        border: 1px solid #ddd;
      }
      .invoice-bank-title {
        font-size: 1.1rem;
        font-weight: 600;
        color: #000;
        margin: 0 0 10px 0;
      }
      .invoice-bank-info {
        font-size: 0.95rem;
        color: #333;
        line-height: 1.5;
      }
      .pan-section {
        margin-top: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .pan-label {
        font-size: 0.95rem;
        font-weight: 600;
      }
      .invoice-stamp {
        position: absolute;
        bottom: 40px;
        right: 40px;
        width: 120px;
        height: 120px;
        z-index: 10;
      }
      .invoice-container {
        position: relative;
      }
      @media print {
        body { 
margin: 0; 
padding: 20px;
          background: white;
}
        .invoice-container { 
max-width: 100%;
          margin: 0;
        }
        @page {
          margin: 0.5cm;
          size: A4;
        }
        /* Ensure proper page breaks */
        .invoice-container {
          page-break-inside: avoid;
        }
        .invoice-table {
          page-break-inside: avoid;
}
      }
    </style>
  </head>
  <body>
<script>
      // Set document title to prevent showing URL
      document.title = 'Invoice ${escapeHtml(inv.invoiceNumber || '')}';
      // Prevent browser from showing URL and date in print
      window.onbeforeprint = function() {
        document.title = 'Invoice ${escapeHtml(inv.invoiceNumber || '')}';
      };
    </script>
    <div class="invoice-container">
      <div class="invoice-header">
        <div class="invoice-header-top">
          <div class="invoice-left">
            <div class="invoice-title">${escapeHtml(seller.owner)}</div>
            <div class="invoice-business-name">${escapeHtml(seller.businessName)}</div>
            <div class="invoice-address">${escapeHtml(seller.address)}</div>
          </div>
          <div class="invoice-right">
            <div class="invoice-label">Invoice</div>
            <div class="invoice-number">${escapeHtml(inv.invoiceNumber || '')}</div>
            <div class="invoice-date-value">${escapeHtml(formattedDate)}</div>
          </div>
        </div>
        <div class="invoice-customer-section">
          <div class="invoice-customer-label">Customer Name:</div>
          <div>${escapeHtml(inv.customer?.name || '')}</div>
          ${inv.customer?.address ? `<div style="margin-top: 5px;">${escapeHtml(inv.customer.address)}</div>` : ''}
        </div>
      </div>
      
      <table class="invoice-table">
        <thead>
          <tr>
            <th>Sr. No</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Amount</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          ${emptyRows}
        </tbody>
      </table>
      
      <div class="pan-section">
        <div class="pan-label">${panNoDisplay}</div>
        <div class="invoice-totals">
          <div class="invoice-total-qty">Total Qty: ${totalQty}</div>
          <div class="invoice-total-amount">Total Amount: ₹${totalAmount}</div>
        </div>
      </div>
      <div class="invoice-amount-words">
        Amount in Words: ${escapeHtml(amountInWords)}
      </div>
      
      <div class="invoice-bank-details">
        <div class="invoice-bank-title">Bank Details:</div>
        <div class="invoice-bank-info">
          ${escapeHtml(seller.bank.accountName)}<br>
          ${escapeHtml(seller.bank.name)}<br>
          Account No: ${escapeHtml(seller.bank.accountNo)}<br>
          IFSC Code: ${escapeHtml(seller.bank.ifsc)}
        </div>
      </div>
      <img src="${stampSignImage}" alt="Stamp" class="invoice-stamp" />
    </div>
  </body>
  </html>`;
}

function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function exportInvoiceCSV(inv, seller) {
  const csvRows = [];

  // Use seller from invoice if available, otherwise use passed seller
  const effectiveSeller = inv.seller || seller;
  
  // Check if PAN No should be shown (from saved invoice or default to showing if PAN exists)
  const shouldShowPanNo = inv.showPanNo !== undefined ? inv.showPanNo : true; // Default to true for CSV
  const panNo = (effectiveSeller && effectiveSeller.panNo) || DEFAULT_SELLER.panNo;

  // Invoice Header - matching the reference image format
  csvRows.push([effectiveSeller.owner]);
  csvRows.push([effectiveSeller.businessName]);
  csvRows.push([effectiveSeller.address]);
  csvRows.push([effectiveSeller.contact]);
  csvRows.push(['']);

  // Invoice Details - matching the reference layout
  csvRows.push(['Name:', inv.customer?.name || '', '', 'Date:', inv.date || '']);
  csvRows.push(['']);

  // Table Header
  csvRows.push(['Sr. No', 'Description', 'Qty', 'Amount', 'Total']);

  // Invoice Lines
  inv.lines.forEach((line, index) => {
    csvRows.push([
      index + 1,
      line.description || '',
      line.qty || 0,
      line.price || 0,
      line.total || 0
    ]);
  });

  // Empty rows for additional items (like in the reference image)
  for (let i = 0; i < 12; i++) {
    csvRows.push(['', '', '', '', '']);
  }

  csvRows.push(['']);

  // Totals section - matching the reference format
  const totalQty = inv.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  const totalAmount = inv.lines.reduce((sum, l) => sum + (Number(l.total) || 0), 0);

  // Pan No section with totals - include PAN number if available
  const panNoValue = (shouldShowPanNo && panNo) ? panNo : '';
  csvRows.push(['Pan No', panNoValue, '', 'Total Qty:', totalQty]);
  csvRows.push(['', '', '', 'Total Amount:', totalAmount]);
  csvRows.push(['']);

  // Bank Details
  csvRows.push(['Bank Details:']);
  csvRows.push([effectiveSeller.bank.accountName]);
  csvRows.push([effectiveSeller.bank.name]);
  csvRows.push([`Account No: ${effectiveSeller.bank.accountNo}`]);
  csvRows.push([`IFSC Code: ${effectiveSeller.bank.ifsc}`]);

  // Convert to CSV format
  const csvContent = csvRows.map(row =>
    row.map(cell => csvEscape(cell)).join(',')
  ).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${inv.invoiceNumber || 'invoice'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Import/Export component ---------- */
function ImportExport({ invoices, setInvoices }) {
  const [exportDateRange, setExportDateRange] = useState({ from: '', to: '' });
  const [showExportOptions, setShowExportOptions] = useState(false);

  async function exportJSON() {
    // Enhanced JSON structure with proper formatting matching the reference image
    const exportData = {
      exportInfo: {
        exportedAt: new Date().toISOString(),
        totalInvoices: invoices.length,
        totalRevenue: invoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0),
        version: '2.0',
        format: 'invoice-generator-format'
      },
      invoices: invoices.map(inv => {
        const totalQty = inv.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
        const totalAmount = inv.lines.reduce((sum, l) => sum + (Number(l.total) || 0), 0);

        return {
          invoiceNumber: inv.invoiceNumber,
          date: inv.date,
          customer: {
            name: inv.customer?.name || '',
            address: inv.customer?.address || '',
            contact: inv.customer?.contact || ''
          },
          seller: {
            businessName: inv.seller?.businessName || '',
            owner: inv.seller?.owner || '',
            address: inv.seller?.address || '',
            contact: inv.seller?.contact || '',
            bank: {
              accountName: inv.seller?.bank?.accountName || '',
              name: inv.seller?.bank?.name || '',
              accountNo: inv.seller?.bank?.accountNo || '',
              ifsc: inv.seller?.bank?.ifsc || ''
            }
          },
          items: inv.lines.map((line, index) => ({
            srNo: index + 1,
            description: line.description || '',
            qty: Number(line.qty) || 0,
            price: Number(line.price) || 0,
            total: Number(line.total) || 0
          })),
          summary: {
            totalQty: totalQty,
            totalAmount: totalAmount,
            subtotal: Number(inv.subtotal) || totalAmount,
            grandTotal: Number(inv.total) || totalAmount
          },
          panNumber: '', // Empty field as shown in reference
          createdAt: inv.createdAt
        };
      })
    };

    const text = JSON.stringify(exportData, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoices_export_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function filterInvoicesByDateRange(invoices, from, to) {
    if (!from && !to) return invoices;

    return invoices.filter(inv => {
      const invDate = new Date(inv.date || inv.createdAt);
      if (from && invDate < new Date(from)) return false;
      if (to && invDate > new Date(to)) return false;
      return true;
    });
  }

  async function exportCSVAll() {
    if (!invoices.length) { window.alert('No invoices'); return; }

    // Filter invoices by date range if specified
    const filteredInvoices = filterInvoicesByDateRange(invoices, exportDateRange.from, exportDateRange.to);

    if (!filteredInvoices.length) {
      window.alert('No invoices found in the selected date range');
      return;
    }

    // Create unified CSV with all invoice calculations in one table
    const csvRows = [];

    // Header section
    const sellerData = DEFAULT_SELLER;
    csvRows.push(['INVOICE SUMMARY REPORT']);
    csvRows.push([sellerData.owner]);
    csvRows.push([sellerData.businessName]);
    csvRows.push([sellerData.address]);
    csvRows.push([sellerData.contact]);
    csvRows.push(['']);

    // Export info
    const dateRangeText = exportDateRange.from && exportDateRange.to
      ? `Date Range: ${exportDateRange.from} to ${exportDateRange.to}`
      : exportDateRange.from
        ? `From: ${exportDateRange.from}`
        : exportDateRange.to
          ? `To: ${exportDateRange.to}`
          : 'All Invoices';

    csvRows.push([dateRangeText]);
    csvRows.push([`Total Invoices: ${filteredInvoices.length}`]);
    csvRows.push([`Export Date: ${new Date().toLocaleDateString()}`]);
    csvRows.push(['']);

    // Unified table header
    csvRows.push(['Invoice #', 'Date', 'Customer Name', 'Item Description', 'Qty', 'Unit Price', 'Line Total', 'Invoice Total']);

    // Process all invoices into unified table
    let grandTotal = 0;
    filteredInvoices.forEach(inv => {
      const invoiceTotal = inv.lines.reduce((sum, l) => sum + (Number(l.total) || 0), 0);
      grandTotal += invoiceTotal;

      inv.lines.forEach((line, index) => {
        csvRows.push([
          inv.invoiceNumber || '', // Show invoice number for every line item
          inv.date || '',
          inv.customer?.name || '',
          line.description || '',
          line.qty || 0,
          line.price || 0,
          line.total || 0,
          invoiceTotal
        ]);
      });

      // Add empty row after each invoice for better readability
      csvRows.push(['', '', '', '', '', '', '', '']);
    });

    csvRows.push(['']);

    // Summary section
    csvRows.push(['SUMMARY']);
    csvRows.push(['Total Invoices:', filteredInvoices.length]);
    csvRows.push(['Grand Total Revenue:', grandTotal]);
    csvRows.push(['']);

    // Bank Details
    csvRows.push(['BANK DETAILS']);
    csvRows.push([sellerData.bank.accountName]);
    csvRows.push([sellerData.bank.name]);
    csvRows.push([`Account No: ${sellerData.bank.accountNo}`]);
    csvRows.push([`IFSC Code: ${sellerData.bank.ifsc}`]);

    // Convert to CSV format
    const csvContent = csvRows.map(row =>
      row.map(cell => csvEscape(cell)).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const filename = exportDateRange.from && exportDateRange.to
      ? `invoices_${exportDateRange.from}_to_${exportDateRange.to}.csv`
      : exportDateRange.from
        ? `invoices_from_${exportDateRange.from}.csv`
        : exportDateRange.to
          ? `invoices_to_${exportDateRange.to}.csv`
          : `all_invoices_${new Date().toISOString().split('T')[0]}.csv`;

    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    // Reset export options
    setShowExportOptions(false);
    setExportDateRange({ from: '', to: '' });
  }

  async function exportPDFAll() {
    if (!invoices.length) { window.alert('No invoices'); return; }

    // Filter invoices by date range if specified
    const filteredInvoices = filterInvoicesByDateRange(invoices, exportDateRange.from, exportDateRange.to);

    if (!filteredInvoices.length) {
      window.alert('No invoices found in the selected date range');
      return;
    }

    // Create new PDF document
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    // Set up fonts and colors
    doc.setFont('helvetica');

    let y = 50;

    // Header Section
    doc.setFontSize(24);
    doc.setTextColor(45, 90, 39);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE SUMMARY REPORT', 40, y);
    y += 35;

    const sellerData = DEFAULT_SELLER;
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(sellerData.owner, 40, y);
    y += 25;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(sellerData.businessName, 40, y);
    y += 20;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);
    doc.text(sellerData.address, 40, y);
    y += 15;
    doc.text(sellerData.contact, 40, y);
    y += 35;

    // Export info
    const dateRangeText = exportDateRange.from && exportDateRange.to
      ? `Date Range: ${exportDateRange.from} to ${exportDateRange.to}`
      : exportDateRange.from
        ? `From: ${exportDateRange.from}`
        : exportDateRange.to
          ? `To: ${exportDateRange.to}`
          : 'All Invoices';

    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(dateRangeText, 40, y);
    y += 20;
    doc.text(`Total Invoices: ${filteredInvoices.length}`, 40, y);
    y += 20;
    doc.text(`Export Date: ${new Date().toLocaleDateString()}`, 40, y);
    y += 40;

    // Table Header with optimized column widths and proper margins
// Adjusted widths: Invoice # (100), Date (80), Customer (85), Description (100), Qty (35), Unit Price (65), Line Total (65), Invoice Total (65)
    const colWidths = [100, 80, 85, 100, 35, 65, 65, 65]; // Define column widths
    const colPositions = [30, 130, 210, 295, 395, 430, 495, 560]; // Define column positions
    const tableWidth = 595; // Total table width (adjusted)
    const rowHeight = 18; // Define consistent row height

    // Draw header background
    doc.setFillColor(102, 126, 234);
    doc.rect(30, y - 8, tableWidth, rowHeight, 'F');

    // Draw header border
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(30, y - 8, tableWidth, rowHeight);

    // Draw vertical lines for header
    colPositions.forEach((pos, i) => {
      if (i > 0) {
        doc.line(pos, y - 8, pos, y - 8 + rowHeight);
      }
    });

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');

    // Header text with proper alignment
    doc.text('Invoice #', colPositions[0] + 3, y + 2);
    doc.text('Date', colPositions[1] + 3, y + 2);
    doc.text('Customer', colPositions[2] + 3, y + 2);
    doc.text('Item Description', colPositions[3] + 3, y + 2);
    doc.text('Qty', colPositions[4] + 3, y + 2);
    doc.text('Unit Price', colPositions[5] + 3, y + 2);
    doc.text('Line Total', colPositions[6] + 3, y + 2);
    doc.text('Invoice Total', colPositions[7] + 3, y + 2);

    y += rowHeight + 2;

    // Table Content
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    let grandTotal = 0;

    filteredInvoices.forEach(inv => {
      const invoiceTotal = inv.lines.reduce((sum, l) => sum + (Number(l.total) || 0), 0);
      grandTotal += invoiceTotal;

      inv.lines.forEach((line, index) => {
        // Check if we need a new page
        if (y > 700) {
          doc.addPage();
          y = 50;
        }

        // Format date properly
        let formattedDate = '';
        if (inv.date) {
          try {
            const dateObj = new Date(inv.date);
            if (!isNaN(dateObj.getTime())) {
              const year = dateObj.getFullYear();
              const month = String(dateObj.getMonth() + 1).padStart(2, '0');
              const day = String(dateObj.getDate()).padStart(2, '0');
              formattedDate = `${year}-${month}-${day}`;
            } else {
              formattedDate = inv.date.substring(0, 10) || '';
            }
          } catch (e) {
            formattedDate = inv.date.substring(0, 10) || '';
          }
        }

        // Prepare data for each column with proper formatting
        const invoiceNum = inv.invoiceNumber || '';
        const customer = (inv.customer?.name || '').substring(0, 12);
        const description = (line.description || '').substring(0, 18);
        const qty = String(line.qty || 0);
        const unitPrice = `${line.price || 0}`;
        const lineTotal = `${line.total || 0}`;
        const invoiceTotalStr = `${invoiceTotal}`;

        // Draw row background (alternating colors for better readability)
        if (index % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(30, y - 6, tableWidth, rowHeight, 'F');
        }

        // Draw row border
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.rect(30, y - 6, tableWidth, rowHeight);

        // Draw vertical lines for each column
        colPositions.forEach((pos, i) => {
          if (i > 0) {
            doc.line(pos, y - 6, pos, y - 6 + rowHeight);
          }
        });

        // Display data in each column with proper alignment
// Use splitTextToSize for longer text to prevent overflow
        const invoiceNumLines = doc.splitTextToSize(invoiceNum, colWidths[0] - 6);
        const dateLines = doc.splitTextToSize(formattedDate, colWidths[1] - 6);
        doc.text(invoiceNumLines, colPositions[0] + 3, y + 2);
        doc.text(dateLines, colPositions[1] + 3, y + 2);
        doc.text(customer, colPositions[2] + 3, y + 2);
        doc.text(description, colPositions[3] + 3, y + 2);
        doc.text(qty, colPositions[4] + 3, y + 2);
        doc.text(unitPrice, colPositions[5] + 3, y + 2);
        doc.text(lineTotal, colPositions[6] + 3, y + 2);
        doc.text(invoiceTotalStr, colPositions[7] + 3, y + 2);

        y += rowHeight;
      });
    });

    y += 20;

    // Summary Section
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('SUMMARY', 40, y);
    y += 25;

    doc.setFontSize(11);
    doc.text(`Total Invoices: ${filteredInvoices.length}`, 40, y);
    y += 20;
    doc.text(`Grand Total Revenue: ${grandTotal}`, 40, y);
    y += 40;

    // Bank Details Section
    doc.setFillColor(249, 249, 249);
    doc.rect(40, y - 10, 510, 80, 'F');

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('BANK DETAILS:', 50, y);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(sellerData.bank.accountName, 50, y + 20);
    doc.text(sellerData.bank.name, 50, y + 35);
    doc.text(`Account No: ${sellerData.bank.accountNo}`, 50, y + 50);
    doc.text(`IFSC Code: ${sellerData.bank.ifsc}`, 50, y + 65);

    // Save the PDF
    const filename = exportDateRange.from && exportDateRange.to
      ? `invoice_summary_${exportDateRange.from}_to_${exportDateRange.to}.pdf`
      : exportDateRange.from
        ? `invoice_summary_from_${exportDateRange.from}.pdf`
        : exportDateRange.to
          ? `invoice_summary_to_${exportDateRange.to}.pdf`
          : `invoice_summary_all_${new Date().toISOString().split('T')[0]}.pdf`;

    doc.save(filename);

    // Reset export options
    setShowExportOptions(false);
    setExportDateRange({ from: '', to: '' });
  }

  async function importJSON(e) {
    const f = e.target.files[0]; if (!f) return; const text = await f.text();
    try {
      const data = JSON.parse(text);

      // Handle both old format (array) and new format (object with invoices array)
      let invoicesToImport = [];

      if (Array.isArray(data)) {
        // Old format - direct array of invoices
        invoicesToImport = data;
      } else if (data.invoices && Array.isArray(data.invoices)) {
        // New format - object with invoices array
        invoicesToImport = data.invoices;
      } else {
        throw new Error('Invalid JSON format');
      }

      // Process and store invoices
      for (const inv of invoicesToImport) {
        // Ensure the invoice has all required fields
        const processedInvoice = {
          invoiceNumber: inv.invoiceNumber || `IMP-${Date.now()}`,
          date: inv.date || new Date().toISOString().split('T')[0],
          customer: {
            name: inv.customer?.name || '',
            address: inv.customer?.address || '',
            contact: inv.customer?.contact || ''
          },
          seller: inv.seller || DEFAULT_SELLER,
          lines: inv.lines || inv.items || [],
          subtotal: inv.subtotal || inv.summary?.subtotal || 0,
          total: inv.total || inv.summary?.grandTotal || inv.summary?.totalAmount || 0,
          paymentTerms: inv.paymentTerms || 'Due on receipt',
          currency: inv.currency || 'INR',
          createdAt: inv.createdAt || new Date().toISOString()
        };

        await idbAdd('invoices', processedInvoice);
      }

      const invs = await idbGetAll('invoices');
      setInvoices(invs.sort((a, b) => new Date(b.date) - new Date(a.date)));
      window.alert(`Successfully imported ${invoicesToImport.length} invoices`);
    } catch (err) {
      window.alert('Import failed: ' + err.message);
      console.error('Import error:', err);
    }
  }

  async function importCSV(e) {
    const f = e.target.files[0]; if (!f) return; const text = await f.text();

    try {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const invoices = [];
      let currentInvoice = null;
      let isInTable = false;
      let tableStartIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        const row = lines[i].split(',').map(cell => cell.replace(/^"|"$/g, '')); // Remove quotes

        // Check if this is the start of a new invoice (owner name)
        if (row[0] === DEFAULT_SELLER.owner || (row[0] && !isInTable && !currentInvoice)) {
          if (currentInvoice) {
            invoices.push(currentInvoice);
          }
          currentInvoice = {
            invoiceNumber: `IMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            date: new Date().toISOString().split('T')[0],
            customer: { name: '', address: '', contact: '' },
            seller: DEFAULT_SELLER,
            lines: [],
            subtotal: 0,
            total: 0,
            paymentTerms: 'Due on receipt',
            currency: 'INR',
            createdAt: new Date().toISOString()
          };
          isInTable = false;
          tableStartIndex = -1;
        }

        // Check for customer name and date
        if (currentInvoice && row[0] === 'Name:' && row[1]) {
          currentInvoice.customer.name = row[1];
          if (row[3] === 'Date:' && row[4]) {
            currentInvoice.date = row[4];
          }
        }

        // Check for table header
        if (currentInvoice && row[0] === 'Sr. No' && row[1] === 'Description') {
          isInTable = true;
          tableStartIndex = i;
          continue;
        }

        // Process table rows
        if (currentInvoice && isInTable && tableStartIndex > -1) {
          const srNo = parseInt(row[0]);
          if (!isNaN(srNo) && srNo > 0 && row[1]) {
            const line = {
              description: row[1],
              qty: Number(row[2]) || 0,
              price: Number(row[3]) || 0,
              total: Number(row[4]) || 0
            };
            currentInvoice.lines.push(line);
          }

          // Check for totals section
          if (row[0] === 'Pan No' || (row[3] === 'Total Qty:' && row[4])) {
            isInTable = false;
            if (row[3] === 'Total Qty:') {
              const totalQty = Number(row[4]) || 0;
              // Find total amount in next row
              if (i + 1 < lines.length) {
                const nextRow = lines[i + 1].split(',').map(cell => cell.replace(/^"|"$/g, ''));
                if (nextRow[3] === 'Total Amo:' && nextRow[4]) {
                  currentInvoice.total = Number(nextRow[4]) || 0;
                  currentInvoice.subtotal = currentInvoice.total;
                }
              }
            }
          }
        }
      }

      // Add the last invoice
      if (currentInvoice) {
        invoices.push(currentInvoice);
      }

      // Store invoices
      for (const inv of invoices) {
        await idbAdd('invoices', inv);
      }

      const invs = await idbGetAll('invoices');
      setInvoices(invs.sort((a, b) => new Date(b.date) - new Date(a.date)));
      window.alert(`Successfully imported ${invoices.length} invoices from CSV`);
    } catch (err) {
      window.alert('CSV import failed: ' + err.message);
      console.error('CSV import error:', err);
    }
  }

  return (
    <div className="mt-4">
      <h4 className="card-title">Export / Import</h4>

      {/* Export Options */}
      <div className="mb-4">
        <div className="flex gap-2 items-center flex-wrap mb-3">
          <button onClick={exportJSON} className="btn btn-secondary">Export JSON</button>
          <button
            onClick={() => setShowExportOptions(!showExportOptions)}
            className="btn btn-primary"
          >
            Export CSV {showExportOptions ? '▼' : '▶'}
          </button>
          <label className="btn btn-secondary cursor-pointer">Import JSON<input type="file" accept="application/json" onChange={importJSON} className="hidden" /></label>
          <label className="btn btn-secondary cursor-pointer">Import CSV<input type="file" accept=".csv,text/csv" onChange={importCSV} className="hidden" /></label>
        </div>

        {/* CSV Export Options */}
        {showExportOptions && (
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <h5 className="font-semibold text-gray-700 mb-3">CSV Export Options</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="form-group">
                <label className="form-label">From Date (Optional)</label>
                <input
                  type="date"
                  value={exportDateRange.from}
                  onChange={e => setExportDateRange({ ...exportDateRange, from: e.target.value })}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">To Date (Optional)</label>
                <input
                  type="date"
                  value={exportDateRange.to}
                  onChange={e => setExportDateRange({ ...exportDateRange, to: e.target.value })}
                  className="form-input"
                />
              </div>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={exportCSVAll} className="btn btn-success">
                Export CSV {exportDateRange.from || exportDateRange.to ? '(Filtered)' : '(All)'}
              </button>
              <button onClick={exportPDFAll} className="btn btn-primary">
                Export PDF {exportDateRange.from || exportDateRange.to ? '(Filtered)' : '(All)'}
              </button>
              <button
                onClick={() => {
                  setExportDateRange({ from: '', to: '' });
                  setShowExportOptions(false);
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
            <div className="mt-2 text-sm text-gray-600">
              {exportDateRange.from || exportDateRange.to ?
                `Will export invoices ${exportDateRange.from ? `from ${exportDateRange.from}` : ''} ${exportDateRange.from && exportDateRange.to ? 'to' : ''} ${exportDateRange.to ? exportDateRange.to : ''} in unified table format` :
                'Will export all invoices in a unified table format (CSV & PDF)'
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Dashboard ---------- */
function Dashboard({ invoices }) {
  const totalInvoices = invoices.length;
  const totalRevenue = invoices.reduce((s, i) => s + (Number(i.total) || 0), 0);
  // monthly summary
  const byMonth = {};
  invoices.forEach(i => {
    const d = new Date(i.date || i.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = { cnt: 0, revenue: 0 };
    byMonth[key].cnt++; byMonth[key].revenue += Number(i.total) || 0;
  });
  const months = Object.keys(byMonth).sort().reverse();

  return (
    <div className="mt-4 text-sm">
      <div className="p-3 bg-blue-50 rounded-lg mb-3">
        <div className="font-semibold text-blue-800">Total invoices: {totalInvoices}</div>
        <div className="font-semibold text-blue-800">Total revenue: ₹{totalRevenue}</div>
      </div>
      <div className="mt-2"><strong>Recent months</strong></div>
      <div className="max-h-40 overflow-auto">
        <ul className="space-y-1">
          {months.map(m => <li key={m} className="text-sm">{m}: {byMonth[m].cnt} invoices, ₹{byMonth[m].revenue}</li>)}
          {months.length === 0 && <li className="text-gray-500">No data</li>}
        </ul>
      </div>
    </div>
  );
}

/* ---------- PDF button (requires jsPDF) ---------- */
function PdfButton({ seller, customer, date, lines, subtotal, total, showPanNo = false, invoiceNumber = '' }) {
  async function makePdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    const tableStartX = margin;
    const tableWidth = pageWidth - (2 * margin);

    // Set up fonts and colors
    doc.setFont('helvetica');

    let y = 50;
    
    // Load stamp image for PDF
    const loadStampImage = () => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataURL = canvas.toDataURL('image/png');
          resolve(dataURL);
        };
        img.onerror = reject;
        img.src = stampSignImage;
      });
    };

    // Helper function to draw table borders
    function drawTableBorders(startX, startY, rowHeight, numRows, colWidths) {
      const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
      let currentX = startX;
      
      // Draw outer border
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(1);
      doc.rect(startX, startY, totalWidth, rowHeight * numRows);
      
      // Draw vertical lines
      for (let i = 0; i < colWidths.length - 1; i++) {
        currentX += colWidths[i];
        doc.line(currentX, startY, currentX, startY + (rowHeight * numRows));
      }
      
      // Draw horizontal lines
      for (let i = 1; i < numRows; i++) {
        doc.line(startX, startY + (rowHeight * i), startX + totalWidth, startY + (rowHeight * i));
      }
    }

    // Left side - Name, Brand and Address
    doc.setFontSize(22);
    doc.setTextColor(45, 90, 39); // Dark green
    doc.setFont('helvetica', 'bold');
    doc.text(seller.owner, margin, y);

    y += 25;
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(seller.businessName, margin, y);

    y += 20;
    doc.setFontSize(10);
    doc.setTextColor(51, 51, 51);
    doc.setFont('helvetica', 'normal');
const addressLines = doc.splitTextToSize(seller.address, 250);
    doc.text(addressLines, margin, y);
y += addressLines.length * 12;

    // Right side - Invoice and Date
const rightX = pageWidth - margin - 150;
    y = 50;
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('Invoice', rightX, y, { align: 'right' });

    y += 20;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(invoiceNumber || '', rightX, y, { align: 'right' });

    y += 20;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const formattedDate = formatDate(date);
    doc.text(formattedDate, rightX, y, { align: 'right' });

    // Customer Name and Address below seller info
    y = Math.max(y, 140);
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('Customer Name:', margin, y);

    y += 15;
    doc.setFont('helvetica', 'normal');
    doc.text(customer.name || '', margin, y);

    if (customer.address) {
      y += 15;
      doc.text(customer.address, margin, y);
    }

    y += 30;

    // Table setup - adjust column widths to fit page width
    const totalColWidth = pageWidth - (2 * margin); // Total available width
    const colWidths = [60, 200, 60, 80, 80]; // Sr. No, Description, Qty, Amount, Total
    const sumColWidths = colWidths.reduce((sum, w) => sum + w, 0);
    // Scale columns if needed to fit page width
    const scaleFactor = sumColWidths > totalColWidth ? totalColWidth / sumColWidths : 1;
    const adjustedColWidths = colWidths.map(w => w * scaleFactor);
    const actualTableWidth = adjustedColWidths.reduce((sum, w) => sum + w, 0);
    
    const rowHeight = 20;
    const headerRowHeight = 25;
    const numDataRows = Math.max(lines.length, 1);
    const numEmptyRows = 12;
    const totalRows = 1 + numDataRows + numEmptyRows; // Header + data + empty rows

    // Table Header with background
    doc.setFillColor(240, 240, 240);
    doc.rect(tableStartX, y - headerRowHeight, actualTableWidth, headerRowHeight, 'F');

    // Draw header borders
    drawTableBorders(tableStartX, y - headerRowHeight, headerRowHeight, 1, adjustedColWidths);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');

let colX = tableStartX + 5;
    doc.text('Sr. No', colX, y - 5, { align: 'center' });
colX += adjustedColWidths[0];
    doc.text('Description', colX + 5, y - 5, { align: 'left' });
colX += adjustedColWidths[1];
    doc.text('Qty', colX, y - 5, { align: 'center' });
colX += adjustedColWidths[2];
    doc.text('Amount', colX, y - 5, { align: 'right' });
colX += adjustedColWidths[3];
    doc.text('Total', colX, y - 5, { align: 'right' });

    y += 5;

    // Draw full table borders including data and empty rows
    drawTableBorders(tableStartX, y - headerRowHeight, rowHeight, totalRows, adjustedColWidths);

    // Table Content
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    lines.forEach((line, index) => {
colX = tableStartX + 5;
      doc.text(String(index + 1), colX, y, { align: 'center' });
      colX += adjustedColWidths[0];
      const descLines = doc.splitTextToSize(line.description || '', adjustedColWidths[1] - 10);
      doc.text(descLines, colX + 5, y, { align: 'left' });
colX += adjustedColWidths[1];
      doc.text(String(line.qty), colX, y, { align: 'center' });
colX += adjustedColWidths[2];
      doc.text(`₹${line.price}`, colX, y, { align: 'right' });
colX += adjustedColWidths[3];
      doc.text(`₹${line.total}`, colX, y, { align: 'right' });
      y += rowHeight;
    });

    // Add empty rows
    for (let i = 0; i < numEmptyRows; i++) {
      y += rowHeight;
    }

    y += 20;

    // Totals Section - Amount in Words on left, Totals on right
    const totalQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);

// Amount in Words on left
    const amountInWords = numberToWords(total);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(85, 85, 85);
    const amountWordsY = y;
    doc.text(`Amount in Words: ${amountInWords}`, margin, y);

    // PAN No on left, below Amount in Words (if enabled)
    // Use seller.panNo or fallback to DEFAULT_SELLER.panNo
    const panNo = (seller && seller.panNo) || DEFAULT_SELLER.panNo;
    if (showPanNo && panNo) {
      y += 15;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
      doc.text(`Pan No: ${panNo}`, margin, y);
    }

    // Totals on right (aligned with Amount in Words line)
    const totalsX = pageWidth - margin;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`Total Qty: ${totalQty}`, totalsX - 150, amountWordsY, { align: 'right' });
    doc.text(`Total Amount: ₹${total}`, totalsX, amountWordsY, { align: 'right' });

    // Move y to the bottom of this section (accounting for PAN No if shown)
    y = Math.max(y, amountWordsY) + 25;

    // Bank Details Section
    doc.setFillColor(249, 249, 249);
    doc.rect(margin, y - 10, actualTableWidth, 70, 'F');
doc.setDrawColor(221, 221, 221);
    doc.setLineWidth(1);
    doc.rect(margin, y - 10, actualTableWidth, 70);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Bank Details:', margin + 10, y);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(seller.bank.accountName, margin + 10, y + 15);
    doc.text(seller.bank.name, margin + 10, y + 30);
    doc.text(`Account No: ${seller.bank.accountNo}`, margin + 10, y + 45);
    doc.text(`IFSC Code: ${seller.bank.ifsc}`, margin + 10, y + 60);

    // Add stamp image at bottom right
    try {
      const stampDataURL = await loadStampImage();
            const stampWidth = 100;
      const stampHeight = 100;
      const stampX = pageWidth - stampWidth - 40;
      const stampY = pageHeight - stampHeight - 40;
      
      doc.addImage(stampDataURL, 'PNG', stampX, stampY, stampWidth, stampHeight);
    } catch (error) {
      console.error('Error adding stamp image to PDF:', error);
    }

    // Save the PDF
    doc.save('invoice.pdf');
  }

  return <button type="button" onClick={makePdf} className="btn btn-primary">Export PDF</button>;
}
