import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { createRequire } from 'module';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const TESSERACT_LANG = 'eng';
const PDF_RENDER_PREFIX = process.platform === 'win32' ? 'pdftoppm.cmd' : 'pdftoppm';

let tesseractWorkerPromise = null;
let pdfParsePromise = null;

const getTesseractWorker = async () => {
    if (!tesseractWorkerPromise) {
        tesseractWorkerPromise = (async () => {
            const { createWorker } = await import('tesseract.js');
            const worker = await createWorker(TESSERACT_LANG);
            return worker;
        })();
    }

    return tesseractWorkerPromise;
};

const withSuppressedPdfWarnings = async (task) => {
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalEmitWarning = process.emitWarning;
    const originalStderrWrite = process.stderr.write;
    const warningPattern = /TT:\s*undefined function:\s*32/i;
    const warningFallbackPattern = /TT:\s*undefined function:\s*\d+/i;

    const suppress = (...args) => {
        const message = args.map((item) => String(item)).join(' ');
        if (warningPattern.test(message) || warningFallbackPattern.test(message)) {
            return;
        }

        originalWarn.apply(console, args);
    };

    const suppressError = (...args) => {
        const message = args.map((item) => String(item)).join(' ');
        if (warningPattern.test(message) || warningFallbackPattern.test(message)) {
            return;
        }

        originalError.apply(console, args);
    };

    const suppressEmitWarning = (warning, ...args) => {
        const message = typeof warning === 'string' ? warning : String(warning?.message || warning || '');
        if (warningPattern.test(message) || warningFallbackPattern.test(message)) {
            return;
        }

        return originalEmitWarning.call(process, warning, ...args);
    };

    const suppressStderrWrite = function (chunk, encoding, callback) {
        const message = String(chunk || '');
        if (warningPattern.test(message) || warningFallbackPattern.test(message)) {
            if (typeof callback === 'function') {
                callback();
            }
            return true;
        }

        return originalStderrWrite.call(this, chunk, encoding, callback);
    };

    console.warn = suppress;
    console.error = suppressError;
    process.emitWarning = suppressEmitWarning;
    process.stderr.write = suppressStderrWrite;

    try {
        return await task();
    } finally {
        console.warn = originalWarn;
        console.error = originalError;
        process.emitWarning = originalEmitWarning;
        process.stderr.write = originalStderrWrite;
    }
};

const getPdfParse = async () => {
    if (!pdfParsePromise) {
        pdfParsePromise = (async () => {
            try {
                const pdfJs = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
                if (pdfJs?.setVerbosityLevel && pdfJs?.VERBOSITY_LEVELS?.errors !== undefined) {
                    pdfJs.setVerbosityLevel(pdfJs.VERBOSITY_LEVELS.errors);
                }
            } catch {
                // Fall back to the package default if the internal build path changes.
            }

            const pdfParseModule = await import('pdf-parse');
            return pdfParseModule.default;
        })();
    }

    return pdfParsePromise;
};

export const decodeStoredDocument = (value, fallbackName = 'Document') => {
    if (!value || typeof value !== 'string') {
        return { name: fallbackName, content: '', mimeType: undefined };
    }

    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
            return {
                name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : fallbackName,
                content: parsed.content,
                mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : undefined,
            };
        }
    } catch {
        // Fallback to legacy string formats.
    }

    if (value.startsWith('data:')) {
        const mimeType = value.slice(5, value.indexOf(';')) || undefined;
        return { name: fallbackName, content: value, mimeType };
    }

    if (value.startsWith('http://') || value.startsWith('https://')) {
        const tail = value.split('/').pop() || fallbackName;
        return { name: tail, content: value, mimeType: undefined };
    }

    return { name: fallbackName, content: value, mimeType: undefined };
};

const decodeDataUrl = (value) => {
    if (!value.startsWith('data:')) return null;
    const commaIndex = value.indexOf(',');
    if (commaIndex < 0) return null;
    const metadata = value.slice(5, commaIndex);
    const payload = value.slice(commaIndex + 1);
    const mimeType = metadata.split(';')[0] || 'application/octet-stream';
    const isBase64 = metadata.includes(';base64');

    const buffer = isBase64
        ? Buffer.from(payload, 'base64')
        : Buffer.from(decodeURIComponent(payload), 'utf8');

    return { buffer, mimeType };
};

const fetchBinary = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch document: ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, mimeType: contentType };
};

const extractTextFromImageBuffer = async (buffer) => {
    if (!buffer || !buffer.length) return '';

    try {
        const worker = await getTesseractWorker();
        const result = await worker.recognize(buffer);
        return result?.data?.text || '';
    } catch {
        return '';
    }
};

const extractTextFromPdfBuffer = async (buffer) => {
    let parseText = '';
    try {
        const pdfParse = await getPdfParse();
        const parsed = await withSuppressedPdfWarnings(() => pdfParse(buffer));
        parseText = String(parsed?.text || '').trim();
        if (parseText) return parseText;
    } catch {
        // Fall back to OCR below.
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'intellitender-pdf-'));
    const inputPath = path.join(tempDir, 'source.pdf');
    const outputPrefix = path.join(tempDir, 'page');

    try {
        await fs.writeFile(inputPath, buffer);
        await execFile(PDF_RENDER_PREFIX, ['-png', inputPath, outputPrefix], {
            windowsHide: true,
            maxBuffer: 20 * 1024 * 1024,
        });

        const files = await fs.readdir(tempDir);
        const imagePaths = files
            .filter((name) => /^page-\d+\.png$/i.test(name))
            .sort((left, right) => {
                const leftMatch = Number(left.match(/page-(\d+)\.png/i)?.[1] || 0);
                const rightMatch = Number(right.match(/page-(\d+)\.png/i)?.[1] || 0);
                return leftMatch - rightMatch;
            })
            .map((name) => path.join(tempDir, name));

        if (!imagePaths.length) {
            return parseText;
        }

        const pageTexts = [];
        for (const imagePath of imagePaths) {
            const pageBuffer = await fs.readFile(imagePath);
            const pageText = String(await extractTextFromImageBuffer(pageBuffer) || '').trim();
            if (pageText) {
                pageTexts.push(pageText);
            }
        }

        const ocrText = pageTexts.join('\n\n').trim();
        return ocrText || parseText;
    } catch {
        return parseText;
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
};

export const extractTextFromBuffer = async (buffer, mimeType) => {
    if (!buffer || !buffer.length) return '';
    const normalizedMime = String(mimeType || '').toLowerCase();

    if (normalizedMime.includes('pdf')) {
        const pdfText = await extractTextFromPdfBuffer(buffer);
        if (pdfText) return pdfText;
    }

    if (normalizedMime.startsWith('image/')) {
        const ocrText = await extractTextFromImageBuffer(buffer);
        if (ocrText) return ocrText;
    }

    return buffer.toString('utf8');
};

export const extractTextFromContent = async (rawContent, mimeType, fallbackName = 'Document') => {
    if (!rawContent) return '';

    const decoded = decodeStoredDocument(rawContent, fallbackName);
    const content = decoded.content;
    const resolvedMimeType = mimeType || decoded.mimeType;

    if (content.startsWith('data:')) {
        const dataUrl = decodeDataUrl(content);
        if (!dataUrl) return '';
        return extractTextFromBuffer(dataUrl.buffer, resolvedMimeType || dataUrl.mimeType);
    }

    if (content.startsWith('http://') || content.startsWith('https://')) {
        const fetched = await fetchBinary(content);
        return extractTextFromBuffer(fetched.buffer, resolvedMimeType || fetched.mimeType);
    }

    return String(content || '');
};
