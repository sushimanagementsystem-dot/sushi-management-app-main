const XLSX = require('xlsx');
const p = 'C:/Users/Admin/Downloads/PRODUCT PLAN EMAIL GROUPS UPDATED2.xlsx';
const wb = XLSX.readFile(p, { cellStyles: true });
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log('== SHEET', name, 'rows:', rows.length);
  rows.forEach((r, i) => console.log(i + 1, JSON.stringify(r)));
}
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    const c = ws[k];
    if (c.s && c.s.fgColor && c.s.fgColor.rgb && /FFFF/i.test(c.s.fgColor.rgb)) console.log('YELLOW', name, k, c.v);
  }
}
