// Chunking avoids argument limits when encoding full recordings or documents.
export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(parts.join(''));
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
