const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

// ฟังก์ชันอ่านและประมวลผลเอกสาร
async function processDocuments() {
  const documents = [];
  
  // ประมวลผล FAQ PDF
  const faqPdf = await pdf(fs.readFileSync(path.join(__dirname, 'FAQ สำหรับจัดทำ Chat bot เพจคณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น.pdf')));
  const faqEntries = extractQnAFromPdf(faqPdf.text);
  
  // ประมวลผลเอกสารการเข้ารับการศึกษา
  const admissionDoc = await pdf(fs.readFileSync(path.join(__dirname, 'เอกสารการเข้ารับการศึกษา.pdf')));
  const admissionEntries = extractQnAFromPdf(admissionDoc.text);
  
  // รวมข้อมูลทั้งหมด
  return [...faqEntries, ...admissionEntries];
}

// ฟังก์ชันแยก Q&A จาก PDF
function extractQnAFromPdf(text) {
  // ใช้ Regular Expression เพื่อแยกข้อมูลจากตารางใน PDF
  const qnaRegex = /\|(\d+)\|(.+?)\|(.+?)\|(.+?)\|/gs;
  const matches = [...text.matchAll(qnaRegex)];
  
  return matches.map(match => ({
    text: `Q: ${match[3].trim()}\nA: ${match[4].trim()}`,
    metadata: {
      source: 'official_document',
      category: match[2].trim(),
      question_id: parseInt(match[1])
    }
  }));
}

module.exports = { processDocuments };