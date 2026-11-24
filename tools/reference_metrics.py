"""Inspect a local engineer PDF. Print anonymous measurements, never copy the drawing."""
import argparse
import json
import math
import re
from statistics import median

import fitz


def rgb(color):
    return tuple(round(v, 2) for v in color or ())


def measure(page):
    sectors, circles, strip_count = [], [], 0
    black_paths = set()
    drip_parts = []
    for d in page.get_drawings():
        items = d["items"]
        if d["type"] == "s":
            # The reference exports stroke drip runs twice along the same geometry.
            signature = tuple(tuple(str(v) for v in item) for item in items)
            if rgb(d["color"]) == (0, 0, 0):
                black_paths.add(signature)
            elif d["dashes"] != "[] 0" and signature in black_paths:
                drip_parts.append(d)
        if rgb(d["fill"]) != (0, .46, .76) or d["fill_opacity"] != .25:
            continue
        sectors.append(d)
        curves = [it for it in items if it[0] == "c"]
        if not curves:
            strip_count += 1
            continue
        if items[0][0] == "l":
            centre = items[0][1]
            radius = abs(items[0][2] - centre)
        elif len(curves) == 4:
            a, b, c = [curve[1] for curve in curves[:3]]
            u, v = b-a, c-a
            det = 2*(u.x*v.y-u.y*v.x)
            if abs(det)<1e-6:
                continue
            centre = a+fitz.Point((abs(u)**2*v.y-abs(v)**2*u.y)/det,
                                  (u.x*abs(v)**2-v.x*abs(u)**2)/det)
            radius = abs(a-centre)
        else:
            continue
        if radius <= 0:
            continue
        # CCW/CW independent sum of the short arc between successive Bezier endpoints.
        angle = 0
        for _, a, _, _, b in curves:
            u, v = a - centre, b - centre
            angle += math.degrees(math.atan2(abs(u.x*v.y-u.y*v.x), u.x*v.x+u.y*v.y))
        circles.append((centre, radius, angle))
    ratios = []
    for i,(centre,radius,_) in enumerate(circles):
        if len(circles)>1:
            ratios.append(min(abs(centre-other[0]) for j,other in enumerate(circles) if j!=i)/radius)
    lines = page.get_text().splitlines()
    zones=[]
    for i,line in enumerate(lines[:-5]):
        if line in ('Дождевание','Капельная') and re.fullmatch(r'\d+шт',lines[i+1]) and lines[i+2].endswith('л/мин'):
            zones.append(dict(kind=line, consumers=int(lines[i+1][:-2]), flow=float(lines[i+2][:-5].replace(',','.'))))
    return dict(footprints=len(sectors),straight_shapes=strip_count,drip=bool(drip_parts),
                curved_drip=any(any(it[0]=='c' for it in d['items']) for d in drip_parts),
                radial=len(circles),near_quarter=sum(80<=a<=100 for _,_,a in circles),
                near_half=sum(170<=a<=190 for _,_,a in circles),
                near_full=sum(a>=350 for _,_,a in circles),
                median_spacing_ratio=round(median(ratios),2) if ratios else None,zones=zones)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf')
    args=parser.parse_args()
    with fitz.open(args.pdf) as document:
        print(json.dumps([measure(page) for page in document],ensure_ascii=False,indent=2))
