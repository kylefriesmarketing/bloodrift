// Minimal JSON-Schema-subset validator — enough to gate the data contracts in CI.
// Supports: type, required, properties, items, enum, minimum, maximum, pattern,
// and $ref into the schema's $defs (by bare name).

export function validate(schema, data, defs, path = '$') {
  const errs = [];
  defs = defs || schema.$defs || {};
  check(schema, data, path, errs, defs);
  return errs;
}

function check(sch, val, path, errs, defs) {
  if (!sch) return;
  if (sch.$ref) {
    const target = defs[sch.$ref];
    if (!target) { errs.push(`${path}: unresolved $ref ${sch.$ref}`); return; }
    check(target, val, path, errs, defs);
    return;
  }
  if (sch.enum && !sch.enum.includes(val)) {
    errs.push(`${path}: value ${JSON.stringify(val)} not in enum [${sch.enum.join(', ')}]`);
    return;
  }
  if (sch.type) {
    const t = sch.type;
    const ok =
      t === 'object' ? (val !== null && typeof val === 'object' && !Array.isArray(val)) :
      t === 'array' ? Array.isArray(val) :
      t === 'string' ? typeof val === 'string' :
      t === 'integer' ? Number.isInteger(val) :
      t === 'number' ? typeof val === 'number' :
      t === 'boolean' ? typeof val === 'boolean' : true;
    if (!ok) { errs.push(`${path}: expected ${t}, got ${Array.isArray(val) ? 'array' : typeof val}`); return; }
  }
  if (typeof val === 'number') {
    if (sch.minimum !== undefined && val < sch.minimum) errs.push(`${path}: ${val} < minimum ${sch.minimum}`);
    if (sch.maximum !== undefined && val > sch.maximum) errs.push(`${path}: ${val} > maximum ${sch.maximum}`);
  }
  if (typeof val === 'string' && sch.pattern) {
    if (!new RegExp(sch.pattern).test(val)) errs.push(`${path}: "${val}" fails pattern ${sch.pattern}`);
  }
  if (sch.type === 'object' && val && typeof val === 'object') {
    for (const req of sch.required || []) {
      if (!(req in val)) errs.push(`${path}: missing required "${req}"`);
    }
    for (const [k, sub] of Object.entries(sch.properties || {})) {
      if (k in val) check(sub, val[k], `${path}.${k}`, errs, defs);
    }
  }
  if (sch.type === 'array' && Array.isArray(val) && sch.items) {
    val.forEach((v, idx) => check(sch.items, v, `${path}[${idx}]`, errs, defs));
  }
}
