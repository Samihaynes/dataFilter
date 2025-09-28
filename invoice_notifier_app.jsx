/*
Invoice Notifier - Single-file React component (Tailwind)

What this delivers (frontend):
- Upload an Excel/ODS/CSV file.
- Parse it in the browser using SheetJS (xlsx).
- Expect columns: ClientName, Email, InvoiceNumber, InvoiceDate, Amount, Paid (optional).
- Calculates days-since-invoice and flags invoices older than 30 days as OVERDUE.
- Allows previewing the overdue clients and sending notifications by calling a backend API endpoint (/api/send-reminders).

Notes & setup:
1) This is a frontend React component. To actually send emails you'll need a small backend (example included below in comments) that accepts POST /api/send-reminders with a JSON payload `[{email, name, invoiceNumber, daysOverdue, amount}]` and uses an SMTP provider (e.g. Gmail/SendGrid/MailGun) to send emails.

2) Packages required (frontend):
   - react, react-dom
   - xlsx (SheetJS) -> npm i xlsx
   - date-fns (optional, for date handling) -> npm i date-fns
   - Tailwind CSS for styling (optional but recommended)

3) Minimal example backend (Node/Express + nodemailer) is described at the bottom of this file in comments.

Usage:
- Drop your Excel file. The parser will try to find columns by common names (case-insensitive) and compute overdue = invoiceDate + 30 days < today.
- Mark rows as "Excluded" if you don't want to notify.
- Click "Send reminders" to POST to your backend with the list of overdue invoices.

Limitations & security:
- Frontend does not send emails by itself.
- Make sure your backend authenticates requests and rate-limits email sending.

*/

import React, { useState } from 'react';
import { read, utils } from 'xlsx';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';

export default function InvoiceNotifierApp() {
  const [rows, setRows] = useState([]);
  const [overdueOnly, setOverdueOnly] = useState(true);
  const [sending, setSending] = useState(false);
  const [messageTemplate, setMessageTemplate] = useState(
    `Bonjour {{name}},\n\nNotre système indique que la facture #{{invoice}} d'un montant de {{amount}} est en retard de {{days}} jours. Merci de régulariser votre paiement dès que possible.\n\nCordialement,\nVotre entreprise`
  );
  const [feedback, setFeedback] = useState('');

  function normalizeHeader(h) {
    return h ? h.toString().trim().toLowerCase() : '';
  }

  function mapColumns(headers) {
    // return mapping of expected fields to column names
    const normalized = headers.map(normalizeHeader);
    const map = {};
    const options = {
      name: ['client', 'clientname', 'name', 'customer'],
      email: ['email', 'e-mail', 'mail'],
      invoice: ['invoice', 'invoice#', 'invoicenumber', 'ref', 'facture', 'facture#'],
      date: ['date', 'invoicedate', 'datefacture', 'facturedate', 'date de facture'],
      amount: ['amount', 'montant', 'total', 'balance'],
      paid: ['paid', 'status', 'etat', 'paiement']
    };
    Object.entries(options).forEach(([field, names]) => {
      const idx = normalized.findIndex(h => names.some(n => h.includes(n)));
      if (idx >= 0) map[field] = headers[idx];
    });
    return map;
  }

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target.result;
        const workbook = read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = utils.sheet_to_json(sheet, { defval: '' });
        if (json.length === 0) {
          setFeedback('Aucune ligne trouvée dans le fichier.');
          return;
        }
        const headers = Object.keys(json[0]);
        const colMap = mapColumns(headers);
        // map rows
        const parsed = json.map((r, i) => {
          const rawDate = r[colMap.date] ?? r['InvoiceDate'] ?? r['Date'];
          let parsedDate = null;
          if (rawDate) {
            // try Date parsing
            if (rawDate instanceof Date) parsedDate = rawDate;
            else {
              // try ISO or numeric
              const s = rawDate.toString();
              const num = Number(s);
              if (!Number.isNaN(num)) {
                // Excel serial? try converting
                // But SheetJS usually converts to JS date when cell is date
                parsedDate = new Date((num - 25569) * 86400 * 1000);
              } else {
                const tryISO = Date.parse(s);
                if (!Number.isNaN(tryISO)) parsedDate = new Date(tryISO);
              }
            }
          }
          const amountCell = r[colMap.amount] ?? r['Amount'] ?? r['Montant'] ?? '';
          const invoiceNumber = r[colMap.invoice] ?? r['Invoice'] ?? r['Facture'] ?? '';
          const clientName = r[colMap.name] ?? r['Client'] ?? '';
          const email = r[colMap.email] ?? r['Email'] ?? '';
          const paid = r[colMap.paid] ?? '';

          const today = new Date();
          let days = null;
          let overdue = false;
          if (parsedDate) {
            days = differenceInCalendarDays(today, parsedDate);
            overdue = days > 30 && !(paid && paid.toString().toLowerCase().startsWith('y'));
          }

          return {
            id: i + 1,
            clientName,
            email,
            invoiceNumber,
            invoiceDate: parsedDate ? format(parsedDate, 'yyyy-MM-dd') : '',
            rawInvoiceDate: parsedDate,
            amount: amountCell,
            paid,
            days,
            overdue,
            excluded: false,
          };
        });
        setRows(parsed);
        setFeedback(`${parsed.length} lignes importées.`);
      } catch (err) {
        console.error(err);
        setFeedback('Erreur lors de la lecture du fichier: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(f);
  }

  function toggleExclude(id) {
    setRows(r => r.map(x => x.id === id ? { ...x, excluded: !x.excluded } : x));
  }

  function selectAllOverdue(exclude=false) {
    setRows(r => r.map(x => x.overdue ? { ...x, excluded: exclude } : x));
  }

  async function sendReminders() {
    const toSend = rows.filter(r => r.overdue && !r.excluded && r.email);
    if (toSend.length === 0) {
      setFeedback('Aucun destinataire éligible à l'envoi.');
      return;
    }
    setSending(true);
    setFeedback('Envoi en cours...');
    try {
      const payload = toSend.map(x => ({
        email: x.email,
        name: x.clientName,
        invoice: x.invoiceNumber,
        amount: x.amount,
        days: x.days,
        message: messageTemplate
          .replace('{{name}}', x.clientName)
          .replace('{{invoice}}', x.invoiceNumber)
          .replace('{{amount}}', x.amount)
          .replace('{{days}}', x.days)
      }));

      const resp = await fetch('/api/send-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || 'Erreur serveur');
      setFeedback(`Envoi terminé. ${json.sent || 0} messages envoyés.`);
    } catch (err) {
      console.error(err);
      setFeedback('Erreur lors de l\'envoi: ' + err.message);
    } finally {
      setSending(false);
    }
  }

  const displayRows = overdueOnly ? rows.filter(r => r.overdue) : rows;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Invoice Notifier</h1>

      <div className="mb-4">
        <label className="block mb-2">Importer fichier Excel/ODS/CSV</label>
        <input type="file" accept=".xlsx,.xls,.csv,.ods" onChange={handleFile} />
      </div>

      <div className="mb-4">
        <label className="block mb-2">Message template ({{name}}, {{invoice}}, {{amount}}, {{days}})</label>
        <textarea value={messageTemplate} onChange={e => setMessageTemplate(e.target.value)} rows={4} className="w-full p-2 border rounded" />
      </div>

      <div className="flex items-center gap-4 mb-4">
        <label className="inline-flex items-center">
          <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} className="mr-2" />
          Afficher seulement les retards (>30 jours)
        </label>
        <button className="px-3 py-1 bg-gray-200 rounded" onClick={() => selectAllOverdue(false)}>Inclure tous</button>
        <button className="px-3 py-1 bg-gray-200 rounded" onClick={() => selectAllOverdue(true)}>Exclure tous</button>
      </div>

      <div className="mb-4">{feedback}</div>

      <div className="overflow-x-auto">
        <table className="w-full table-auto border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">#</th>
              <th className="p-2">Client</th>
              <th className="p-2">Email</th>
              <th className="p-2">Facture</th>
              <th className="p-2">Date</th>
              <th className="p-2">Montant</th>
              <th className="p-2">Jours</th>
              <th className="p-2">Exclure</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map(r => (
              <tr key={r.id} className={`border-b ${r.overdue ? 'bg-red-50' : ''}`}>
                <td className="p-2">{r.id}</td>
                <td className="p-2">{r.clientName}</td>
                <td className="p-2">{r.email}</td>
                <td className="p-2">{r.invoiceNumber}</td>
                <td className="p-2">{r.invoiceDate}</td>
                <td className="p-2">{r.amount}</td>
                <td className="p-2">{r.days ?? ''}</td>
                <td className="p-2"><input type="checkbox" checked={r.excluded} onChange={() => toggleExclude(r.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <button className="px-4 py-2 bg-blue-600 text-white rounded mr-2" onClick={sendReminders} disabled={sending}>{sending ? 'Envoi...' : 'Envoyer les rappels'}</button>
        <button className="px-4 py-2 bg-gray-200 rounded" onClick={() => {
          // export filtered list
          const data = rows.filter(r => r.overdue && !r.excluded).map(r => ({client: r.clientName, email: r.email, invoice: r.invoiceNumber, days: r.days, amount: r.amount}));
          const ws = utils.json_to_sheet(data);
          const wb = utils.book_new();
          utils.book_append_sheet(wb, ws, 'overdue');
          const wbout = utils.write(wb, { bookType: 'xlsx', type: 'array' });
          const blob = new Blob([wbout], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'overdue.xlsx';
          a.click();
          URL.revokeObjectURL(url);
        }}>Exporter les retards (.xlsx)</button>
      </div>
    </div>
  );
}

/*
--- Example Node/Express backend (minimal) ---

// Install: npm i express nodemailer body-parser

const express = require('express');
const nodemailer = require('nodemailer');
const app = express();
app.use(express.json());

// configure transporter (use env vars!)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

app.post('/api/send-reminders', async (req, res) => {
  const items = req.body.items || [];
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Invalid payload' });
  let sent = 0;
  for (const it of items) {
    try {
      await transporter.sendMail({
        from: 'no-reply@yourcompany.com',
        to: it.email,
        subject: `Rappel de paiement - facture ${it.invoice}`,
        text: it.message
      });
      sent++;
    } catch (err) {
      console.error('Mail error', err);
    }
  }
  res.json({ sent });
});

app.listen(3000, () => console.log('API running on :3000'));

Security: protect this endpoint (API key, auth) and don't expose it publicly. Rate-limit email sending.

*/
