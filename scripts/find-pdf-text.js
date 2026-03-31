const fs = require('fs');
const PDFParser = require("pdf2json");

let pdfParser = new PDFParser();

pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError));
pdfParser.on("pdfParser_dataReady", pdfData => {
    // pdf2json coordinates are based on PDF units natively scaled by a factor mapping to standard standard layout
    let targets = ['student', 'course', 'date']; // lowercase search

    const pages = pdfData.formImage.Pages;
    pages.forEach(page => {
        page.Texts.forEach(text => {
            const raw = decodeURIComponent(text.R[0].T).toLowerCase();
            
            targets.forEach(t => {
                if (raw.includes(t)) {
                     console.log(`Matched '${raw}': X=${text.x}, Y=${text.y}, w=${text.w}`);
                }
            });
        });
    });
});

pdfParser.loadPDF('public/certificate_template/Certificate Template.pdf');
