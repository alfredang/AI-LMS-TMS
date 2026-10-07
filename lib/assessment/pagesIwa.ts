/**
 * Minimal reader for the iWork '13+ Pages format, used only to find the images
 * in a .pages bundle and the order they appear in the document.
 *
 * A .pages file is a zip; the document lives in Index/**\/*.iwa. Each .iwa is a
 * sequence of Snappy-compressed chunks holding protobuf "objects":
 *   varint(len) ArchiveInfo{1: id, 2: MessageInfo{1: type, 3: length}} payload…
 * Objects reference each other with TSP.Reference {1: id}.
 *
 * What we read (field numbers from the public iWork protobuf definitions):
 *   - TP.DocumentArchive (type 10000, object 1) field 4  → body TSWP.StorageArchive
 *   - TSWP.StorageArchive (2001) field 9 = attachment table: entries
 *       {1: character index, 2: ref → TSWP.DrawableAttachmentArchive (2003)}
 *   - TSWP.DrawableAttachmentArchive (2003) field 1      → the drawable
 *   - TSD.ImageArchive (3005) field 11                   → TSP.DataReference {1: data id}
 *   - TSP.PackageMetadata (11006, Metadata.iwa) field 4  → DataInfo {1: data id, 4: file name in Data/}
 *
 * An image inside a table cell or text box is attached to that cell's own
 * storage, not the body, so its position is found by walking references back
 * up the object graph to the body-level drawable that contains it.
 */

import type PizZip from 'pizzip';

interface Field { f: number; wire: number; num?: number; bytes?: Buffer }
interface IwaObject { type: number; payload: Buffer; file: string }

export interface PagesImage {
  dataId: number;
  /** Path inside the bundle, e.g. "Data/pasted-movie-39.png" */
  path: string;
}

const TYPE_DOCUMENT = 10000;
const TYPE_STORAGE = 2001;
const TYPE_DRAWABLE_ATTACHMENT = 2003;
const TYPE_IMAGE = 3005;
const TYPE_PACKAGE_METADATA = 11006;

// ── Decoding ──────────────────────────────────────────────────────────────────

function readVarint(b: Buffer, i: number): [number, number] {
  let result = 0;
  let mul = 1;
  for (;;) {
    if (i >= b.length) throw new Error('truncated varint');
    const x = b[i++];
    result += (x & 0x7f) * mul;
    if (x < 0x80) return [result, i];
    mul *= 128;
  }
}

/** Raw Snappy block (no framing, no CRC — as used by IWA). */
function snappyDecompress(b: Buffer): Buffer {
  const [size, start] = readVarint(b, 0);
  const out = Buffer.alloc(size);
  let o = 0;
  let i = start;
  while (i < b.length) {
    const tag = b[i++];
    const kind = tag & 3;
    if (kind === 0) {
      let len = tag >> 2;
      if (len >= 60) {
        const n = len - 59;
        len = b.readUIntLE(i, n);
        i += n;
      }
      len += 1;
      b.copy(out, o, i, i + len);
      o += len;
      i += len;
      continue;
    }
    let len: number;
    let offset: number;
    if (kind === 1) {
      len = ((tag >> 2) & 7) + 4;
      offset = ((tag >> 5) << 8) | b[i++];
    } else if (kind === 2) {
      len = (tag >> 2) + 1;
      offset = b.readUInt16LE(i);
      i += 2;
    } else {
      len = (tag >> 2) + 1;
      offset = b.readUInt32LE(i);
      i += 4;
    }
    if (offset === 0 || offset > o) throw new Error('bad snappy offset');
    for (let k = 0; k < len; k++, o++) out[o] = out[o - offset];
  }
  return out;
}

function decodeIwa(raw: Buffer): Buffer {
  const parts: Buffer[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== 0) throw new Error('unexpected IWA chunk header');
    const len = raw.readUIntLE(i + 1, 3);
    parts.push(snappyDecompress(raw.subarray(i + 4, i + 4 + len)));
    i += 4 + len;
  }
  return Buffer.concat(parts);
}

function parseFields(b: Buffer): Field[] {
  const out: Field[] = [];
  let i = 0;
  while (i < b.length) {
    const [key, j] = readVarint(b, i);
    i = j;
    const f = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      const [v, k] = readVarint(b, i);
      out.push({ f, wire, num: v });
      i = k;
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 2) {
      const [len, k] = readVarint(b, i);
      if (k + len > b.length) throw new Error('truncated field');
      out.push({ f, wire, bytes: b.subarray(k, k + len) });
      i = k + len;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return out;
}

function tryParse(b: Buffer): Field[] | null {
  try { return parseFields(b); } catch { return null; }
}

/** TSP.Reference / TSP.DataReference: a message whose only field is 1 (varint). */
function refId(b: Buffer | undefined): number | null {
  if (!b) return null;
  const fs = tryParse(b);
  return fs && fs.length === 1 && fs[0].f === 1 && fs[0].wire === 0 ? fs[0].num! : null;
}

function readObjects(bundle: PizZip): Map<number, IwaObject> {
  const objects = new Map<number, IwaObject>();
  for (const file of bundle.file(/^Index\/.+\.iwa$/)) {
    const data = decodeIwa(Buffer.from(file.asUint8Array()));
    let i = 0;
    while (i < data.length) {
      const [len, j] = readVarint(data, i);
      const info = parseFields(data.subarray(j, j + len));
      i = j + len;
      const id = info.find(x => x.f === 1)?.num;
      for (const mi of info.filter(x => x.f === 2)) {
        const m = parseFields(mi.bytes!);
        const type = m.find(x => x.f === 1)?.num ?? 0;
        const length = m.find(x => x.f === 3)?.num ?? 0;
        if (id !== undefined && !objects.has(id)) {
          objects.set(id, { type, payload: data.subarray(i, i + length), file: file.name });
        }
        i += length;
      }
    }
  }
  return objects;
}

/** Every object id referenced anywhere inside a payload, in byte order. */
function collectRefs(b: Buffer, objects: Map<number, IwaObject>, out: number[] = []): number[] {
  const fs = tryParse(b);
  if (!fs) return out;
  for (const x of fs) {
    if (x.wire !== 2 || !x.bytes?.length) continue;
    const id = refId(x.bytes);
    if (id !== null && objects.has(id)) out.push(id);
    else collectRefs(x.bytes, objects, out);
  }
  return out;
}

// ── Document order ────────────────────────────────────────────────────────────

/** attachment object id → character index, for one storage. */
function storageAttachments(storage: Buffer): Map<number, number> {
  const map = new Map<number, number>();
  for (const table of parseFields(storage).filter(x => x.f === 9)) {
    for (const entry of parseFields(table.bytes!).filter(x => x.f === 1)) {
      const ef = parseFields(entry.bytes!);
      const charIndex = ef.find(x => x.f === 1)?.num ?? 0;
      const ref = refId(ef.find(x => x.f === 2)?.bytes);
      if (ref !== null) map.set(ref, charIndex);
    }
  }
  return map;
}

/**
 * Images placed in the document (TSD.ImageArchive), in reading order.
 * Throws if the bundle is not an iWork '13+ document.
 */
export function listPagesImages(bundle: PizZip): PagesImage[] {
  const objects = readObjects(bundle);

  // Data id → file in Data/
  const dataFiles = new Map<number, string>();
  for (const obj of objects.values()) {
    if (obj.type !== TYPE_PACKAGE_METADATA) continue;
    for (const info of parseFields(obj.payload).filter(x => x.f === 4)) {
      const fs = parseFields(info.bytes!);
      const id = fs.find(x => x.f === 1)?.num;
      const name = (fs.find(x => x.f === 4)?.bytes || fs.find(x => x.f === 3)?.bytes)?.toString('utf8');
      if (id !== undefined && name) dataFiles.set(id, `Data/${name}`);
    }
  }

  const root = objects.get(1);
  if (!root || root.type !== TYPE_DOCUMENT) throw new Error('No Pages document archive');
  const bodyId = refId(parseFields(root.payload).find(x => x.f === 4)?.bytes);
  const body = bodyId !== null ? objects.get(bodyId) : undefined;
  if (!body || body.type !== TYPE_STORAGE) throw new Error('No Pages body text');

  // Character position of every attachment, in every storage.
  const attachmentIndex = new Map<number, number>();
  for (const obj of objects.values()) {
    if (obj.type !== TYPE_STORAGE) continue;
    for (const [ref, idx] of storageAttachments(obj.payload)) attachmentIndex.set(ref, idx);
  }
  const drawableOf = (attachmentId: number) =>
    refId(parseFields(objects.get(attachmentId)!.payload).find(x => x.f === 1)?.bytes);

  // Body-level drawables (inline images, tables, text boxes) → body position.
  const bodyDrawables = new Map<number, number>();
  for (const [att, idx] of storageAttachments(body.payload)) {
    if (objects.get(att)?.type !== TYPE_DRAWABLE_ATTACHMENT) continue;
    const d = drawableOf(att);
    if (d !== null) bodyDrawables.set(d, idx);
  }

  // Reverse reference graph (who points at whom), ignoring package metadata.
  const parents = new Map<number, number[]>();
  for (const [id, obj] of objects) {
    if (obj.type === TYPE_PACKAGE_METADATA) continue;
    for (const ref of collectRefs(obj.payload, objects)) {
      if (ref === id) continue;
      const list = parents.get(ref) || [];
      list.push(id);
      parents.set(ref, list);
    }
  }
  // The attachment that places each drawable, for its position inside its own storage.
  const attachmentOf = new Map<number, number>();
  for (const [id, obj] of objects) {
    if (obj.type !== TYPE_DRAWABLE_ATTACHMENT) continue;
    const d = drawableOf(id);
    if (d !== null) attachmentOf.set(d, id);
  }

  /** Body position of the top-level drawable containing `id` (BFS up the graph). */
  const bodyPosition = (id: number): number => {
    const seen = new Set([id]);
    let frontier = [id];
    while (frontier.length) {
      const next: number[] = [];
      for (const x of frontier) {
        const pos = bodyDrawables.get(x);
        if (pos !== undefined) return pos;
        for (const p of parents.get(x) || []) {
          if (!seen.has(p) && p !== bodyId) { seen.add(p); next.push(p); }
        }
      }
      frontier = next;
    }
    return Number.MAX_SAFE_INTEGER;
  };

  const images: (PagesImage & { key: [number, number, number] })[] = [];
  for (const [id, obj] of objects) {
    if (obj.type !== TYPE_IMAGE) continue;
    const dataId = refId(parseFields(obj.payload).find(x => x.f === 11)?.bytes);
    const path = dataId !== null ? dataFiles.get(dataId) : undefined;
    if (dataId === null || !path || !bundle.file(path)) continue;
    const att = attachmentOf.get(id);
    // Floating (unattached) images sort after inline ones.
    if (att === undefined) {
      images.push({ dataId, path, key: [Number.MAX_SAFE_INTEGER, 0, dataId] });
      continue;
    }
    images.push({ dataId, path, key: [bodyPosition(id), attachmentIndex.get(att) ?? 0, dataId] });
  }
  images.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
  return images.map(({ dataId, path }) => ({ dataId, path }));
}
