export type StoredDocument = {
  name: string;
  content: string;
  mimeType?: string;
};

export type StoredDocumentReference = {
  name: string;
  tenderId: string;
  docIndex: number;
  mimeType?: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function looksLikeMongoObjectId(value: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(value.trim());
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
    const tail = value.split("/").pop() || "Document";
    return {
      name: looksLikeMongoObjectId(tail) ? "Proposal document" : tail,
      content: value,
    };
  }

  if (looksLikeMongoObjectId(value)) {
    return {
      name: "Proposal document",
      content: "",
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

export function getStoredDocumentReference(value?: string | null): StoredDocumentReference | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isObjectRecord(parsed)) return null;

    const tenderId = typeof parsed.tenderId === "string" ? parsed.tenderId : "";
    const indexValue =
      typeof parsed.docIndex === "number"
        ? parsed.docIndex
        : Number.parseInt(String(parsed.docIndex ?? ""), 10);

    if (parsed.lazy !== true || !tenderId || Number.isNaN(indexValue) || indexValue < 0) {
      return null;
    }

    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : `Document ${indexValue + 1}`,
      tenderId,
      docIndex: indexValue,
      mimeType: typeof parsed.mimeType === "string" ? parsed.mimeType : undefined,
    };
  } catch {
    return null;
  }
}

export function getStoredDocumentUrl(value?: string | null): string | null {
  const decoded = decodeStoredDocument(value);
  const content = decoded?.content || "";
  if (content.startsWith("/api/")) {
    return `${API_BASE_URL}${content}`;
  }
  return content || null;
}
