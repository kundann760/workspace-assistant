declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseOptions {
    pagerender?: (pageData: any) => Promise<string>;
    max?: number;
  }
  interface PdfParseResult {
    numpages: number;
    text: string;
  }
  function pdfParse(data: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
  export = pdfParse;
}
