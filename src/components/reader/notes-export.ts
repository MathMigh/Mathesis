export function resolveInitialNotes(storageKey: string) {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(storageKey) ?? "";
}

export function sanitizeFileStem(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\w\s-]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLocaleLowerCase("pt-BR") || "mathesis-notas"
  );
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(String(reader.result ?? ""));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Não consegui ler a gravação."));
    });
    reader.readAsDataURL(blob);
  });
}

export function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return (
    [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ""
  );
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const crcTable = Array.from({ length: 256 }, (_, tableIndex) => {
  let current = tableIndex;

  for (let bit = 0; bit < 8; bit += 1) {
    current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }

  return current >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function numberBytes(value: number, byteCount: 2 | 4) {
  const bytes = new Uint8Array(byteCount);
  const view = new DataView(bytes.buffer);

  if (byteCount === 2) {
    view.setUint16(0, value, true);
  } else {
    view.setUint32(0, value, true);
  }

  return bytes;
}

function concatBytes(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function createZipBlob(files: Array<{ name: string; text: string }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.text);
    const checksum = crc32(dataBytes);
    const localHeader = concatBytes([
      numberBytes(0x04034b50, 4),
      numberBytes(20, 2),
      numberBytes(0x0800, 2),
      numberBytes(0, 2),
      numberBytes(0, 2),
      numberBytes(0, 2),
      numberBytes(checksum, 4),
      numberBytes(dataBytes.length, 4),
      numberBytes(dataBytes.length, 4),
      numberBytes(nameBytes.length, 2),
      numberBytes(0, 2),
      nameBytes,
      dataBytes,
    ]);

    localParts.push(localHeader);

    centralParts.push(
      concatBytes([
        numberBytes(0x02014b50, 4),
        numberBytes(20, 2),
        numberBytes(20, 2),
        numberBytes(0x0800, 2),
        numberBytes(0, 2),
        numberBytes(0, 2),
        numberBytes(0, 2),
        numberBytes(checksum, 4),
        numberBytes(dataBytes.length, 4),
        numberBytes(dataBytes.length, 4),
        numberBytes(nameBytes.length, 2),
        numberBytes(0, 2),
        numberBytes(0, 2),
        numberBytes(0, 2),
        numberBytes(0, 2),
        numberBytes(0, 4),
        numberBytes(localOffset, 4),
        nameBytes,
      ]),
    );

    localOffset += localHeader.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const endRecord = concatBytes([
    numberBytes(0x06054b50, 4),
    numberBytes(0, 2),
    numberBytes(0, 2),
    numberBytes(files.length, 2),
    numberBytes(files.length, 2),
    numberBytes(centralDirectory.length, 4),
    numberBytes(localOffset, 4),
    numberBytes(0, 2),
  ]);

  return new Blob([concatBytes([...localParts, centralDirectory, endRecord])], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export function createDocxBlob(title: string, notes: string) {
  const paragraphs = notes
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph).replace(
          /\n/g,
          "</w:t><w:br/><w:t xml:space=\"preserve\">",
        )}</w:t></w:r></w:p>`,
    )
    .join("");

  return createZipBlob([
    {
      name: "[Content_Types].xml",
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    },
    {
      name: "word/document.xml",
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        "<w:body>" +
        `<w:p><w:r><w:t>${escapeXml(title)}</w:t></w:r></w:p>` +
        paragraphs +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
        "</w:body></w:document>",
    },
  ]);
}
