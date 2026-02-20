declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    text: string;
  }
  function pdfParse(buffer: Buffer, options?: unknown): Promise<PDFData>;
  export = pdfParse;
}
