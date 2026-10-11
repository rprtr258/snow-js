// Animation containers for full-size, opaque rendered frames. Compression is
// supplied by native PNG or the bundled lossless WebP/AV1 encoders.
export type Bytes = Uint8Array;
export type FrameSpec = { width: number; height: number; count: number; delay: number; loop: boolean };
type PngChunk = { type: string; data: Uint8Array };
type Box = { type: string; start: number; end: number; data: Uint8Array };
type AvifFrameData = { payload: Uint8Array; config: Uint8Array; color: Uint8Array; header: Uint8Array; width: number; height: number };
export const ascii = (value: string) => Uint8Array.from(value, c => c.charCodeAt(0));
export const textAt = (bytes: Uint8Array, start: number, count = 4) => String.fromCharCode(...bytes.subarray(start, start + count));
export function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
const zeros = (n: number) => new Uint8Array(n);
export function uint(value: number, length = 4, little = false) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) { out[little ? i : length - i - 1] = value % 256; value = Math.floor(value / 256); }
  return out;
}
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let n = i; for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
export function pngChunk(type: string, data: Uint8Array) {
  const body = concat([ascii(type), data]);
  return concat([uint(data.length), body, uint(crc32(body))]);
}
export function pngChunks(bytes: Uint8Array) {
  if (!same(bytes.subarray(0, 8), PNG_SIGNATURE)) throw new Error("PNG encoder returned an invalid frame.");
  const chunks: PngChunk[] = [];
  for (let p = 8; p < bytes.length;) {
    if (p + 12 > bytes.length) throw new Error("Truncated PNG frame.");
    const length = view(bytes).getUint32(p), end = p + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG chunk.");
    const type = textAt(bytes, p + 4), data = bytes.subarray(p + 8, p + 8 + length);
    if (crc32(bytes.subarray(p + 4, p + 8 + length)) !== view(bytes).getUint32(end - 4)) throw new Error("Invalid PNG checksum.");
    chunks.push({ type, data }); p = end;
  }
  return chunks;
}
export class APNGMuxer {
  declare parts: Uint8Array[];
  declare size: number;
  declare frames: number;
  declare sequence: number;
  declare width: number;
  declare height: number;
  declare header: Uint8Array | null;
  declare count: number;
  declare loop: boolean;
  declare delay: number;
  declare finished: boolean;
  constructor({ width, height, count, delay, loop }: FrameSpec) {
    Object.assign(this, { width, height, count, delay, loop });
    this.parts = []; this.size = 0; this.frames = 0; this.sequence = 0;
  }
  push(bytes: Uint8Array) { this.parts.push(bytes); this.size += bytes.length; }
  add(bytes: Uint8Array) {
    const chunks = pngChunks(bytes), header = chunks.find(c => c.type === "IHDR")?.data;
    if (!header || header.length !== 13 || view(header).getUint32(0) !== this.width || view(header).getUint32(4) !== this.height || ![2, 6].includes(header[9]))
      throw new Error("PNG frame dimensions or color type are invalid.");
    if (!this.header) {
      this.header = header.slice(); this.push(PNG_SIGNATURE); this.push(pngChunk("IHDR", header));
      for (const chunk of chunks) if (["sRGB", "gAMA", "cHRM", "iCCP", "cICP"].includes(chunk.type)) this.push(pngChunk(chunk.type, chunk.data));
      this.push(pngChunk("acTL", concat([uint(this.count), uint(this.loop ? 0 : 1)])));
    } else if (!same(header, this.header)) throw new Error("PNG frame encoding changed within the animation.");
    const control = concat([uint(this.sequence++), uint(this.width), uint(this.height), zeros(8), uint(this.delay, 2), uint(1000, 2), new Uint8Array([0, 0])]);
    this.push(pngChunk("fcTL", control));
    const data = chunks.filter(c => c.type === "IDAT");
    if (!data.length) throw new Error("PNG frame has no image data.");
    for (const chunk of data) this.push(this.frames === 0 ? pngChunk("IDAT", chunk.data) : pngChunk("fdAT", concat([uint(this.sequence++), chunk.data])));
    this.frames++;
  }
  get byteLength() { return this.size + (this.finished ? 0 : 12); }
  finish() {
    if (this.frames !== this.count) throw new Error("Incomplete APNG animation.");
    if (!this.finished) { this.push(pngChunk("IEND", zeros(0))); this.finished = true; }
    return concat(this.parts);
  }
}

export function riffChunk(type: string, data: Uint8Array) {
  return concat([ascii(type), uint(data.length, 4, true), data, zeros(data.length & 1)]);
}
export function webpImageChunks(bytes: Uint8Array) {
  if (textAt(bytes, 0) !== "RIFF" || textAt(bytes, 8) !== "WEBP" || view(bytes).getUint32(4, true) + 8 !== bytes.length)
    throw new Error("WebP encoder returned an invalid frame.");
  const parts: Uint8Array[] = [];
  for (let p = 12; p < bytes.length;) {
    if (p + 8 > bytes.length) throw new Error("Truncated WebP frame.");
    const size = view(bytes).getUint32(p + 4, true), end = p + 8 + size + (size & 1), type = textAt(bytes, p);
    if (end > bytes.length) throw new Error("Truncated WebP chunk.");
    if (["VP8 ", "VP8L", "ALPH"].includes(type)) parts.push(bytes.subarray(p, end));
    p = end;
  }
  if (!parts.some(p => ["VP8 ", "VP8L"].includes(textAt(p, 0)))) throw new Error("WebP frame has no image data.");
  return concat(parts);
}
export class WebPMuxer {
  declare parts: Uint8Array[];
  declare size: number;
  declare frames: number;
  declare width: number;
  declare height: number;
  declare delay: number;
  declare count: number;
  constructor({ width, height, count, delay, loop }: FrameSpec) {
    Object.assign(this, { width, height, count, delay, loop });
    this.parts = [riffChunk("VP8X", concat([new Uint8Array([2, 0, 0, 0]), uint(width - 1, 3, true), uint(height - 1, 3, true)])),
      riffChunk("ANIM", concat([zeros(4), uint(loop ? 0 : 1, 2, true)]))];
    this.size = 12 + this.parts.reduce((n, p) => n + p.length, 0); this.frames = 0;
  }
  add(bytes: Uint8Array) {
    const header = concat([zeros(6), uint(this.width - 1, 3, true), uint(this.height - 1, 3, true), uint(this.delay, 3, true), new Uint8Array([2])]);
    const frame = riffChunk("ANMF", concat([header, webpImageChunks(bytes)]));
    this.parts.push(frame); this.size += frame.length; this.frames++;
  }
  get byteLength() { return this.size; }
  finish() {
    if (this.frames !== this.count) throw new Error("Incomplete WebP animation.");
    return concat([ascii("RIFF"), uint(this.size - 8, 4, true), ascii("WEBP"), ...this.parts]);
  }
}

export function boxes(bytes: Uint8Array, start = 0, end = bytes.length) {
  const result: Box[] = [];
  for (let p = start; p < end;) {
    if (p + 8 > end) throw new Error("Truncated AVIF box.");
    let size = view(bytes).getUint32(p), header = 8;
    if (size === 1) { if (p + 16 > end) throw new Error("Truncated AVIF box size."); size = view(bytes).getUint32(p + 8) * 4294967296 + view(bytes).getUint32(p + 12); header = 16; }
    if (!size) size = end - p;
    if (size < header || p + size > end) throw new Error("Invalid AVIF box size.");
    result.push({ type: textAt(bytes, p + 4), start: p, end: p + size, data: bytes.subarray(p + header, p + size) });
    p += size;
  }
  return result;
}
const box = (type: string, ...parts: Uint8Array[]) => { const data = concat(parts); return concat([uint(data.length + 8), ascii(type), data]); };
const fullBox = (type: string, version: number, flags: number, ...parts: Uint8Array[]) => box(type, new Uint8Array([version]), uint(flags, 3), ...parts);
const matrix = concat([uint(0x10000), zeros(12), uint(0x10000), zeros(12), uint(0x40000000)]);
const handler = () => fullBox("hdlr", 0, 0, zeros(4), ascii("pict"), zeros(12), ascii("dust\0"));
const infinity64 = new Uint8Array(8).fill(255);

export function avifFrame(bytes: Uint8Array): AvifFrameData {
  const top = boxes(bytes), meta = top.find(b => b.type === "meta");
  if (!meta) throw new Error("AVIF frame has no metadata.");
  const children = boxes(meta.data, 4), pitm = children.find(b => b.type === "pitm")?.data;
  if (!pitm) throw new Error("AVIF frame has no primary image.");
  const primary = pitm[0] === 0 ? view(pitm).getUint16(4) : view(pitm).getUint32(4);
  const iloc = children.find(b => b.type === "iloc")?.data;
  if (!iloc || iloc[0] > 2) throw new Error("Unsupported AVIF item locations.");
  let p = 4;
  const take = (n: number) => { let value = 0; for (let i = 0; i < n; i++) { if (p >= iloc.length) throw new Error("Truncated AVIF location."); value = value * 256 + iloc[p++]; } return value; };
  const sizes = take(1), offsetSize = sizes >> 4, lengthSize = sizes & 15;
  const second = take(1), baseSize = second >> 4, indexSize = iloc[0] ? second & 15 : 0;
  const count = take(iloc[0] < 2 ? 2 : 4), extents: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const id = take(iloc[0] < 2 ? 2 : 4), method = iloc[0] ? take(2) & 15 : 0, reference = take(2), base = take(baseSize), number = take(2);
    for (let j = 0; j < number; j++) {
      if (indexSize) take(indexSize);
      const offset = base + take(offsetSize), length = take(lengthSize);
      if (id === primary) {
        if (method || reference || offset + length > bytes.length) throw new Error("Unsupported AVIF frame extent.");
        extents.push(bytes.subarray(offset, offset + length));
      }
    }
  }
  const iprp = children.find(b => b.type === "iprp"), ipco = iprp && boxes(iprp.data).find(b => b.type === "ipco");
  const properties = ipco ? boxes(ipco.data) : [], get = (type: string) => properties.find(b => b.type === type)?.data;
  const config = get("av1C"), spatial = get("ispe"), color = get("colr");
  if (!extents.length || !config || !spatial || !color || properties.some(b => b.type === "auxC")) throw new Error("AVIF export expects an opaque single-image frame.");
  const payload = concat(extents), headers: Uint8Array[] = [];
  for (let pos = 0; pos < payload.length;) {
    const header = payload[pos++], type = (header >> 3) & 15;
    if (header & 4) pos++;
    if (!(header & 2)) throw new Error("AV1 frame lacks OBU lengths.");
    let length = 0, shift = 0, byte;
    do { if (pos >= payload.length || shift > 49) throw new Error("Invalid AV1 OBU length."); byte = payload[pos++]; length += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    if (pos + length > payload.length) throw new Error("Truncated AV1 OBU.");
    if (type === 1) headers.push(payload.subarray(pos, pos + length));
    pos += length;
  }
  if (headers.length !== 1) throw new Error("AVIF frame must contain one AV1 sequence header.");
  return { payload, config: config.slice(), color: color.slice(), header: headers[0].slice(), width: view(spatial).getUint32(4), height: view(spatial).getUint32(8) };
}

export class AVIFMuxer {
  declare frames: Uint8Array[];
  declare size: number;
  declare width: number;
  declare height: number;
  declare first: AvifFrameData | null;
  declare headerSize: number;
  declare count: number;
  declare delay: number;
  declare loop: boolean;
  constructor({ width, height, count, delay, loop }: FrameSpec) {
    Object.assign(this, { width, height, count, delay, loop }); this.frames = []; this.size = 0;
  }
  add(bytes: Uint8Array) {
    const frame = avifFrame(bytes);
    if (frame.width !== this.width || frame.height !== this.height) throw new Error("AVIF frame dimensions changed.");
    if (!this.first) this.first = frame;
    else if (!same(frame.config, this.first.config) || !same(frame.header, this.first.header) || !same(frame.color, this.first.color))
      throw new Error("AVIF encoder changed sequence configuration.");
    this.frames.push(frame.payload); this.size += frame.payload.length;
    if (!this.headerSize) this.headerSize = this.headers(0, new Uint32Array(this.count)).length;
  }
  headers(offset: number, sizes: ArrayLike<number>) {
    const { width, height, count, delay, loop } = this, duration = count * delay;
    const av1C = box("av1C", this.first!.config), colr = box("colr", this.first!.color);
    const ftyp = box("ftyp", ascii("avis"), zeros(4), ascii("avisavifmsf1mif1miafavio"));
    const properties = box("iprp", box("ipco", fullBox("ispe", 0, 0, uint(width), uint(height)), fullBox("pixi", 0, 0, new Uint8Array([3, 8, 8, 8])), av1C, colr),
      fullBox("ipma", 0, 0, uint(1), uint(1, 2), new Uint8Array([4, 1, 2, 0x83, 4])));
    const meta = fullBox("meta", 0, 0, handler(), fullBox("pitm", 0, 0, uint(1, 2)),
      fullBox("iloc", 0, 0, new Uint8Array([0x44, 0]), uint(1, 2), uint(1, 2), zeros(2), uint(1, 2), uint(offset), uint(this.first!.payload.length)),
      fullBox("iinf", 0, 0, uint(1, 2), fullBox("infe", 2, 0, uint(1, 2), zeros(2), ascii("av01Color\0"))), properties);
    const totalDuration = loop ? infinity64 : uint(duration, 8);
    const mvhd = fullBox("mvhd", 1, 0, zeros(16), uint(1000), totalDuration, uint(0x10000), uint(0x100, 2), zeros(10), matrix, zeros(24), uint(2));
    const tkhd = fullBox("tkhd", 1, 1, zeros(16), uint(1), zeros(4), totalDuration, zeros(16), matrix, uint(width * 65536), uint(height * 65536));
    const edit = box("edts", fullBox("elst", 1, loop ? 1 : 0, uint(1), uint(duration, 8), zeros(8), uint(1, 2), zeros(2)));
    const mdhd = fullBox("mdhd", 1, 0, zeros(16), uint(1000), uint(duration, 8), uint(0x55c4, 2), zeros(2));
    const compressor = zeros(32); compressor.set(ascii("\x04dust"));
    const description = box("av01", zeros(6), uint(1, 2), zeros(16), uint(width, 2), uint(height, 2), uint(0x480000), uint(0x480000), zeros(4), uint(1, 2), compressor, uint(24, 2), uint(0xffff, 2), av1C, colr, fullBox("ccst", 0, 0, uint(0xc0000000)));
    const sampleSizes = new Uint8Array(count * 4), sampleView = view(sampleSizes);
    for (let i = 0; i < sizes.length; i++) sampleView.setUint32(i * 4, sizes[i]!);
    const stbl = box("stbl", fullBox("stsd", 0, 0, uint(1), description), fullBox("stts", 0, 0, uint(1), uint(count), uint(delay)),
      fullBox("stsc", 0, 0, uint(1), uint(1), uint(count), uint(1)), fullBox("stsz", 0, 0, zeros(4), uint(count), sampleSizes), fullBox("stco", 0, 0, uint(1), uint(offset)));
    const minf = box("minf", fullBox("vmhd", 0, 1, zeros(8)), box("dinf", fullBox("dref", 0, 0, uint(1), fullBox("url ", 0, 1))), stbl);
    const moov = box("moov", mvhd, box("trak", tkhd, edit, box("mdia", mdhd, handler(), minf)));
    return concat([ftyp, meta, moov]);
  }
  get byteLength() { return (this.headerSize || 1600 + this.count * 4) + 8 + this.size; }
  finish() {
    if (this.frames.length !== this.count) throw new Error("Incomplete AVIF animation.");
    const header = this.headers(this.headerSize + 8, this.frames.map(f => f.length));
    return concat([header, uint(this.size + 8), ascii("mdat"), ...this.frames]);
  }
}
