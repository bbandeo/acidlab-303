// ZIP sin compresión: los .seq son pequeños y se conservan byte por byte.
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function zipFiles(files: File[], name: string): Promise<File> {
  const local: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const file of files) {
    const data = await file.arrayBuffer();
    const filename = new TextEncoder().encode(file.name);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x800, true);
    header.setUint16(12, 33, true); // 1980-01-01 (fecha mínima DOS)
    header.setUint32(14, crc32(new Uint8Array(data)), true);
    header.setUint32(18, data.byteLength, true);
    header.setUint32(22, data.byteLength, true);
    header.setUint16(26, filename.length, true);
    const directory = new DataView(new ArrayBuffer(46));
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    new Uint8Array(directory.buffer).set(new Uint8Array(header.buffer, 4), 6);
    directory.setUint32(42, offset, true);
    local.push(header.buffer, filename, data);
    central.push(directory.buffer, filename);
    offset += 30 + filename.length + data.byteLength;
    centralSize += 46 + filename.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new File([...local, ...central, end.buffer], name, { type: "application/zip" });
}
