const DECIMALS = 6;
const SCALE = 10n ** BigInt(DECIMALS);

/**
 * Decimal pUSD or shares → 6-decimal base units: `toBaseUnits("2.5")` → `"2500000"`.
 * Throws on more than 6 decimal places instead of rounding.
 */
export function toBaseUnits(amount: string | number): string {
  const text = typeof amount === 'number' ? String(amount) : amount.trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (!match[2] && !match[3])) {
    throw new RangeError(`Invalid decimal amount: "${amount}"`);
  }
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > DECIMALS) {
    throw new RangeError(`"${amount}" has more than ${DECIMALS} decimal places`);
  }
  const units = BigInt(whole || '0') * SCALE + BigInt(fraction.padEnd(DECIMALS, '0'));
  return (sign && units !== 0n ? '-' : '') + units.toString();
}

/** 6-decimal base units → decimal string: `fromBaseUnits("2500000")` → `"2.5"`. */
export function fromBaseUnits(units: string | bigint): string {
  if (typeof units === 'string' && !/^-?\d+$/.test(units.trim())) {
    throw new RangeError(`Invalid base-unit amount: "${units}"`);
  }
  let value = typeof units === 'bigint' ? units : BigInt(units.trim());
  const negative = value < 0n;
  if (negative) value = -value;
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
