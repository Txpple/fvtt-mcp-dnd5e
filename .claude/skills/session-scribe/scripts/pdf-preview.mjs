#!/usr/bin/env node
// pdf-preview.mjs — look at every page of a rendered PDF before it ships.
//
// Headless Edge/Chrome print PDFs but will not rasterise one, and the Browser pane has no PDF viewer,
// so this writes a self-contained page-grid viewer: the PDF inlined as base64, drawn with pdf.js
// (cdnjs) into numbered canvases.
//
//   node pdf-preview.mjs <file.pdf> [out.html] [--cols 2] [--width 306]
//
// Serve the folder over localhost (the pane runs scripts for http, not for file:// outside the
// project) and open it in the Browser pane:
//
//   python -m http.server 8765 --bind 127.0.0.1      (from the out.html folder, as a background task)
//   → http://127.0.0.1:8765/<out.html>, wait for <body data-done="1">, then screenshot and scroll.
//
// What to look for: a heading alone at a page foot, a picture pushed off its section, a table or
// entry split across pages, a near-empty page. Stop the server when done.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : dflt;
};
const cols = Number(opt('--cols', '2'));
const width = Number(opt('--width', '306'));
const [pdf, outArg] = args;
if (!pdf) {
  console.error('usage: node pdf-preview.mjs <file.pdf> [out.html] [--cols 2] [--width 306]');
  process.exit(2);
}
const out = outArg ?? path.join(path.dirname(pdf), path.basename(pdf, '.pdf') + '.preview.html');

const b64 = fs.readFileSync(pdf).toString('base64');
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
fs.writeFileSync(
  out,
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>loading</title><style>
body{margin:0;background:#666;font-family:sans-serif}
#g{display:grid;grid-template-columns:repeat(${cols},${width}px);gap:8px;padding:6px}
.pg{background:#fff;position:relative}.pg canvas{display:block;width:${width}px;height:auto}
.pg span{position:absolute;top:2px;right:4px;font-size:14px;color:#c00;font-weight:bold}</style>
<script src="${PDFJS}/pdf.min.js"></script></head><body><div id="g"></div><script>
pdfjsLib.GlobalWorkerOptions.workerSrc='${PDFJS}/pdf.worker.min.js';
const raw=atob("${b64}");const u=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);
(async()=>{const doc=await pdfjsLib.getDocument({data:u}).promise;document.title='pages:'+doc.numPages;
for(let n=1;n<=doc.numPages;n++){const pg=await doc.getPage(n);const vp=pg.getViewport({scale:1.5});
const d=document.createElement('div');d.className='pg';const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
d.appendChild(c);const s=document.createElement('span');s.textContent=n;d.appendChild(s);document.getElementById('g').appendChild(d);
await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;}
document.body.setAttribute('data-done','1');})();</script></body></html>`
);
console.log(
  `wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB) — serve its folder and open it in the Browser pane`
);
