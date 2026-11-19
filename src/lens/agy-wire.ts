import { sanitizeDisplayText } from '../utils/sanitize.js';
import { tokenNumber } from './context.js';

export type WireValue = number | Uint8Array;

export function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 10 && offset < bytes.length; i++) {
    const b = bytes[offset++];
    value += (b & 127) * 2 ** (7 * i);
    if (b < 128) return [Number.isSafeInteger(value) ? value : NaN, offset];
  }
  throw new Error('Antigravity 元数据整数无效');
}

/** 仅返回指定字段，其他字段按 Protobuf 的类型和长度跳过。 */
function* values(bytes: Uint8Array, wanted: readonly number[]): Generator<[number, WireValue]> {
  let offset = 0;
  function varint(): number { const [value, end] = readVarint(bytes, offset); offset = end; return value; }
  while (offset < bytes.length) {
    const tag = varint(), field = Math.floor(tag / 8), kind = tag % 8;
    if (!(field > 0)) throw new Error('Antigravity 元数据字段无效');
    const keep = wanted.includes(field);
    if (kind === 0) {
      const value = varint();
      if (keep) yield [field, value];
      continue;
    }
    const length = kind === 2 ? varint() : kind === 1 ? 8 : kind === 5 ? 4 : NaN;
    if (!Number.isSafeInteger(length) || offset + length > bytes.length) throw new Error('Antigravity 元数据长度无效');
    if (keep && kind === 2) yield [field, bytes.subarray(offset, offset + length)];
    offset += length;
  }
}

export function fields(bytes: Uint8Array, wanted: readonly number[]): Map<number, WireValue> {
  return new Map(values(bytes, wanted));
}

export function nested(value: WireValue | undefined, wanted: readonly number[]): Map<number, WireValue> {
  return value instanceof Uint8Array ? fields(value, wanted) : new Map();
}

export function* messages(value: WireValue | undefined, field: number): Generator<Uint8Array> {
  if (value instanceof Uint8Array) for (const [, message] of values(value, [field])) {
    if (message instanceof Uint8Array) yield message;
  }
}

export function string(value: WireValue | undefined): string {
  return value instanceof Uint8Array && value.length <= 512 ? sanitizeDisplayText(Buffer.from(value).toString('utf8')).trim().slice(0, 200) : '';
}

export function timestamp(value: WireValue | undefined): string | undefined {
  const clock = nested(value, [1, 2]);
  const seconds = tokenNumber(clock.get(1)), nanos = tokenNumber(clock.get(2)) ?? 0;
  const epoch = seconds === null ? undefined : seconds * 1000 + Math.floor(nanos / 1e6);
  return epoch !== undefined && epoch > 0 && epoch <= 8.64e15 ? new Date(epoch).toISOString() : undefined;
}
