// Build the hosted version with a local copy of PDF.js, without a runtime CDN.
import {mkdir,copyFile,readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname,join} from "node:path";
import {execFileSync} from "node:child_process";
const require=createRequire(import.meta.url);
const base=dirname(require.resolve("pdfjs-dist/package.json"));
execFileSync("python3",["tools/build.py"],{stdio:"inherit"});
await mkdir("dist/vendor",{recursive:true});
for(const f of ["pdf.min.mjs","pdf.worker.min.mjs"])await copyFile(join(base,"legacy/build",f),join("dist/vendor",f));
await copyFile(join(base,"LICENSE"),"dist/vendor/PDF-JS-LICENSE");
const html=await readFile("dist/index.html","utf8");
await writeFile("dist/index.html",html.replace('<html lang="ru">','<html lang="ru" data-pdf="true">'));
