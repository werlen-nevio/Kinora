export class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Der Inhalt ist grösser als ${limit} Bytes.`);
    this.name = "BodyTooLargeError";
  }
}

/**
 * Liest den Inhalt einer Anfrage höchstens bis zum Limit. `request.json()` und
 * `request.formData()` laden alles in den Speicher, bevor sich die Grösse prüfen lässt.
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
