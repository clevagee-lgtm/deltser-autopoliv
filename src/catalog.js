function readCatalog(csv) {
  return csv.trim().split(/\r?\n/).slice(1).map(line => {
    const [model, arc, bar, radius, flow] = line.split(",");
    return {model, arc: Number(arc), bar: Number(bar), radius: Number(radius), flow: Number(flow)};
  });
}
