"""Compare a registered source/engineer PDF pair using the service's colour detector."""
import argparse
import json
import subprocess
from pathlib import Path

import fitz
from PIL import Image

from reference_metrics import rgb


def raster(page, size, mode):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    return im.convert(mode).resize(size, Image.Resampling.BOX)


def compare(source, project):
    if source.rect != project.rect or source.rotation or project.rotation:
        raise ValueError('Use registered pages with matching frames and zero rotation')
    size = tuple(round(v * 420 / max(source.rect.width, source.rect.height))
                 for v in (source.rect.width, source.rect.height))
    pixels = raster(source, size, 'RGBA')
    root = Path(__file__).resolve().parents[1]
    # The classifier is shared with the app. The baseline intentionally isolates colour recognition.
    node = """const fs=require('node:fs'),vm=require('node:vm');
const ctx=vm.createContext({}); vm.runInContext(fs.readFileSync('src/recognition.js','utf8'),ctx);
const map=ctx.detectRegions(fs.readFileSync(0),Number(process.argv[1]),Number(process.argv[2]));
process.stdout.write(Buffer.from(Uint8Array.from(map.ids,id=>map.regions[id]?.kind||0)));"""
    result = subprocess.run(['node','-e',node,*map(str,size)],input=pixels.tobytes(),
                            stdout=subprocess.PIPE,cwd=root,check=True)
    with fitz.open() as doc:
        mask = doc.new_page(width=source.rect.width, height=source.rect.height)
        for drawing in project.get_drawings():
            if rgb(drawing['fill']) != (0,.46,.76) or drawing['fill_opacity'] != .25:
                continue
            shape = mask.new_shape()
            for kind,*args in drawing['items']:
                if kind == 'l': shape.draw_line(*args)
                elif kind == 'c': shape.draw_bezier(*args)
                elif kind == 're': shape.draw_rect(args[0])
                else: raise ValueError(f'Unexpected footprint path: {kind}')
            shape.finish(color=None,fill=(0,0,0));shape.commit()
        wet = raster(mask,size,'L').tobytes()
    counts = [0]*5
    if len(wet)!=len(result.stdout): raise ValueError('Unmatched grid sizes')
    for value, predicted in zip(wet,result.stdout):
        if value<128: counts[predicted]+=1
    return dict(wet=sum(counts),lawn=counts[1],outside_lawn=result.stdout.count(1)-counts[1],planting=counts[2],other=sum(counts)-sum(counts[1:3]))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source');parser.add_argument('project')
    args=parser.parse_args()
    with fitz.open(args.source) as s, fitz.open(args.project) as p:
        print(json.dumps(compare(s[0],p[0])))
