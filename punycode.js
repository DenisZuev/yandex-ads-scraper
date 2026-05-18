'use strict';

const maxInt = 2147483647;
const base = 36;
const tMin = 1;
const tMax = 26;
const skew = 38;
const damp = 700;
const initialBias = 72;
const initialN = 128;
const delimiter = '-';
const regexPunycode = /^xn--/;
const regexNonASCII = /[^\0-\x7F]/;
const regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g;
const baseMinusTMin = base - tMin;
const floor = Math.floor;

function error(type) {
  throw new RangeError({
    overflow: 'Overflow: input needs wider integers to process',
    'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
    'invalid-input': 'Invalid input'
  }[type]);
}

function map(array, callback) {
  const result = [];
  let length = array.length;
  while (length--) result[length] = callback(array[length]);
  return result;
}

function mapDomain(domain, callback) {
  const parts = domain.split('@');
  let result = '';
  if (parts.length > 1) { result = parts[0] + '@'; domain = parts[1]; }
  domain = domain.replace(regexSeparators, '\x2E');
  const labels = domain.split('.');
  return result + map(labels, callback).join('.');
}

function basicToDigit(codePoint) {
  if (codePoint >= 0x30 && codePoint < 0x3A) return 26 + (codePoint - 0x30);
  if (codePoint >= 0x41 && codePoint < 0x5B) return codePoint - 0x41;
  if (codePoint >= 0x61 && codePoint < 0x7B) return codePoint - 0x61;
  return base;
}

function adapt(delta, numPoints, firstTime) {
  let k = 0;
  delta = firstTime ? floor(delta / damp) : delta >> 1;
  delta += floor(delta / numPoints);
  for (; delta > baseMinusTMin * tMax >> 1; k += base) delta = floor(delta / baseMinusTMin);
  return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
}

function decode(input) {
  const output = [];
  const inputLength = input.length;
  let i = 0, n = initialN, bias = initialBias;
  let basic = input.lastIndexOf(delimiter);
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; ++j) {
    if (input.charCodeAt(j) >= 0x80) error('not-basic');
    output.push(input.charCodeAt(j));
  }
  for (let index = basic > 0 ? basic + 1 : 0; index < inputLength;) {
    const oldi = i;
    for (let w = 1, k = base;; k += base) {
      if (index >= inputLength) error('invalid-input');
      const digit = basicToDigit(input.charCodeAt(index++));
      if (digit >= base) error('invalid-input');
      if (digit > floor((maxInt - i) / w)) error('overflow');
      i += digit * w;
      const t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
      if (digit < t) break;
      if (w > floor(maxInt / (base - t))) error('overflow');
      w *= base - t;
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi == 0);
    if (floor(i / out) > maxInt - n) error('overflow');
    n += floor(i / out);
    i %= out;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

function toUnicode(input) {
  return mapDomain(input, function(string) {
    return regexPunycode.test(string)
      ? decode(string.slice(4).toLowerCase())
      : string;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toUnicode, decode, encode: null };
} else if (typeof globalThis !== 'undefined') {
  globalThis.toUnicode = toUnicode;
}
