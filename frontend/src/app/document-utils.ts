export type StoredDocument = {
  name: string;
  content: string;
  mimeType?: string;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function encodeFileToStoredDocument(file: File): Promise<string> {
  const content = await readFileAsDataUrl(file);

  return JSON.stringify({
    name: file.name,
    content,
    mimeType: file.type || undefined,
  });
}

export async function encodeFilesToStoredDocuments(files: FileList | File[]): Promise<string[]> {
  return Promise.all(Array.from(files).map((file) => encodeFileToStoredDocument(file)));
}

export function decodeStoredDocument(value?: string | null): StoredDocument | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (isObjectRecord(parsed) && typeof parsed.content === "string") {
      return {
        name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : "Document",
        content: parsed.content,
        mimeType: typeof parsed.mimeType === "string" ? parsed.mimeType : undefined,
      };
    }
  } catch {
    // Fall back to older string-only storage.
  }

  if (value.startsWith("data:")) {
    const mimeType = value.slice(5, value.indexOf(";"));
    return {
      name: mimeType === "application/pdf" ? "Document.pdf" : "Document",
      content: value,
      mimeType,
    };
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return {
      name: value.split("/").pop() || "Document",
      content: value,
    };
  }

  return {
    name: value,
    content: "",
  };
}

export function getStoredDocumentName(value?: string | null, fallback = "Document"): string {
  return decodeStoredDocument(value)?.name || fallback;
}

export function getStoredDocumentUrl(value?: string | null): string | null {
  const decoded = decodeStoredDocument(value);
  return decoded?.content || null;
}
