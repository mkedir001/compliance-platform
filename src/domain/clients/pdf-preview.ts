import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";

/**
 * Bytes for an in-browser preview of a stored PDF. Browser PDF viewers (Chrome's PDFium) paint fillable form fields
 * on top of everything else on the page, so a signature drawn or stamped inside a field's box disappears. Flattening
 * turns the fields into ordinary page content, which keeps the signature visible. The stored original is never
 * touched and downloads still return it byte for byte. Any PDF that cannot be flattened is previewed as-is.
 */
function responseBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function previewPdfBytes(bytes: Uint8Array): Promise<ArrayBuffer> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    const form = pdf.getForm();
    if (!form.getFields().length) return responseBuffer(bytes);
    form.flatten();
    // flatten() removes the widgets but can leave dangling references in /Annots; drop them so every viewer opens it cleanly.
    for (const page of pdf.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots) continue;
      for (let index = annots.size() - 1; index >= 0; index -= 1) if (!(annots.lookup(index) instanceof PDFDict)) annots.remove(index);
    }
    return responseBuffer(await pdf.save());
  } catch {
    return responseBuffer(bytes);
  }
}
