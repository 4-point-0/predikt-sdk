/**
 * RFC 8785 (JCS) canonical JSON for plain JSON values: object keys sorted by UTF-16 code units,
 * no whitespace, ECMAScript number and string serialization. Rejects anything that is not plain
 * JSON (non-finite numbers, lone surrogates, class instances) instead of guessing.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    if (/[\uD800-\uDFFF]/u.test(value)) throw new TypeError('Invalid Unicode in canonical JSON input');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite number in canonical JSON input');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${canonicalJson(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Canonical JSON input must be plain JSON');
}

/**
 * An object literal or JSON.parse result, also from another realm (e.g. `fetch` results inside a
 * jest or `vm` sandbox), whose `Object.prototype` is not this realm's.
 */
function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}
