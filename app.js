// app.js - parses Excel/CSV via SheetJS, computes overdue (> daysLimit), previews and posts to send.php
const fileInput = document.getElementById('fileInput');
const parseBtn = document.getElementById('parseBtn');
const previewArea = document.getElementById('previewArea');
const resultsTableBody = document.querySelector('#resultsTable tbody');
const stats = document.getElementById('stats');
const sendBtn = document.getElementById('sendBtn');
const exportBtn = document.getElementById('exportBtn');
const feedback = document.getElementById('feedback');


let parsedRows = []; // objects {client,email,invoice,invoiceDate,amount,days,overdue,excluded}


function parseDateMaybe(val){
if(!val) return null;
// try JS date
if(val instanceof Date && !isNaN(val)) return val;
// Excel sometimes gives numbers -> handled by SheetJS as numbers representing dates if option cellDates
// fallback parse
const d = new Date(val);
if(!isNaN(d)) return d;
// try dd/mm/yyyy common format
const parts = val.toString().match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
if(parts){
const day = parseInt(parts[1],10), month = parseInt(parts[2],10)-1, year = parseInt(parts[3],10);
return new Date(year < 100 ? 2000+year : year, month, day);
}
return null;
}


function clearPreview(){
resultsTableBody.innerHTML = '';
stats.textContent = '';
feedback.textContent = '';
}


parseBtn.addEventListener('click', async ()=>{
clearPreview();
const f = fileInput.files[0];
if(!f){ feedback.textContent = 'Choisissez un fichier .xlsx ou .csv'; return; }
const daysLimit = Number(document.getElementById('daysLimit').value) || 30;


const data = await f.arrayBuffer();
const wb = XLSX.read(data, {type:'array', cellDates:true});
const ws = wb.Sheets[wb.SheetNames[0]];
const json = XLSX.utils.sheet_to_json(ws, {defval:''});
if(!json || json.length === 0){ feedback.textContent='Fichier vide ou non lisible'; return; }


// try to detect column names
const header = Object.keys(json[0]).map(h=>h.toString().toLowerCase());
function findKey(keys){
for(const k of header){
for(const candidate of keys){ if(k.includes(candidate)) return Object.keys(json[0]).find(x=>x.toLowerCase()===k); }
}
return null;
}
const map = {
client: findKey(['client','name','customer','societe','client']),
email: findKey(['email','mail']),
invoice: findKey(['invoice','facture','ref']),
date: findKey(['date','invoicedate','datefacture','facture']),
amount: findKey(['amount','montant','total','balance'])
};



parsedRows = json.map((r,i)=>{
    const rawDate = r[map.date] ?? r['Date'] ?? '';
    const dt = parseDateMaybe(rawDate);
    const today = new Date();
    const days = dt ? Math.floor((today - dt)/(1000*60*60*24)) : null;
    const overdue = days !== null && days > daysLimit;
    return {
    id: i+1,
    client: r[map.client] ?? r['Client'] ?? '',
    email: r[map.email] ?? r['Email'] ?? '',
    invoice: r[map.invoice] ?? r['Invoice'] ?? '',
    invoiceDate: dt ? dt.toISOString().slice(0,10) : (rawDate||''),
    amount: r[map.amount] ?? r['Amount'] ?? '',
    days, overdue, excluded:false
    };
    });
    
    
    // filter overdue
    const overdueList = parsedRows.filter(x=>x.overdue);
    previewArea.classList.remove('hidden');
    stats.textContent = `${overdueList.length} factures en retard (> ${daysLimit} jours)`;
    
    
    // populate table
    resultsTableBody.innerHTML = '';
    overdueList.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
    <td>${r.id}</td>
    <td>${r.client}</td>
    <td>${r.email}</td>
    <td>${r.invoice}</td>
    <td>${r.invoiceDate}</td>
    <td>${r.amount}</td>
    <td>${r.days ?? ''}</td>
    <td><input type="checkbox" data-id="${r.id}" /></td>
    `;
    resultsTableBody.appendChild(tr);
    });
    
    
    });
    
    
    // toggle excluded from table
    resultsTableBody.addEventListener('change', (e)=>{
    const cb = e.target.closest('input[type=checkbox]');
    if(!cb) return;
    const id = Number(cb.dataset.id);
    const row = parsedRows.find(x=>x.id===id);
    if(row) row.excluded = cb.checked;
    });
    
    
    sendBtn.addEventListener('click', async ()=>{
    const toSend = parsedRows.filter(r=>r.overdue && !r.excluded && r.email);
    if(toSend.length===0){ feedback.textContent='Aucun destinataire à envoyer.'; return; }
    sendBtn.disabled = true; feedback.textContent='Envoi en cours...';
    try{
    const resp = await fetch('send.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:toSend})});
    const json = await resp.json();
    if(json.success){ feedback.textContent = `Envoi terminé. ${json.sent} emails envoyés.`; }
    else feedback.textContent = 'Erreur lors de l\'envoi: '+(json.error||'unknown');
    }catch(err){ feedback.textContent = 'Erreur réseau: '+err.message; }
    finally{ sendBtn.disabled=false; }
    });
    
    
    // export overdue to xlsx
    exportBtn.addEventListener('click', ()=>{
    const toExport = parsedRows.filter(r=>r.overdue && !r.excluded).map(r=>({client:r.client,email:r.email,invoice:r.invoice,date:r.invoiceDate,amount:r.amount,days:r.days}));
    if(toExport.length===0){ feedback.textContent='Rien à exporter.'; return; }
    const ws = XLSX.utils.json_to_sheet(toExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'overdue');
    XLSX.writeFile(wb, 'overdue.xlsx');
    });