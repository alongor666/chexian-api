declare module 'jspdf-autotable' {
  const autoTable: any;
  export default autoTable;
}

declare module 'pptxgenjs' {
  class pptxgen {
    author: string;
    company: string;
    title: string;
    subject: string;
    layout: string;
    slides: pptxgen.Slide[];
    addSlide(): pptxgen.Slide;
    writeFile(options: { fileName: string }): Promise<void>;
  }

  namespace pptxgen {
    interface Slide {
      addText(text: string, options: any): void;
      addShape(type: string, options: any): void;
      addImage(options: any): void;
      addTable(rows: any[][], options: any): void;
      background?: any;
    }
  }

  export default pptxgen;
}
