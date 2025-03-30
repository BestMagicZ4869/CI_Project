require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const cors = require('cors');
const mammoth = require('mammoth');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const port = process.env.PORT || 3000;

// ตั้งค่า CORS
app.use(cors({ 
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// ตั้งค่า static files
app.use(express.static(path.join(__dirname, '../client')));
app.use(express.json({ limit: '15mb' }));

// เชื่อมต่อกับ Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-pro-latest",
  generationConfig: {
    temperature: 0.7,
    topP: 0.9
  }
});

// ตั้งค่าการอัปโหลดไฟล์
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error('ประเภทไฟล์ไม่รองรับ'));
  }
}).single('file');

// ข้อมูลที่ต้องการเทรน
const trainingData = {
  pdfs: [
    'FAQ สำหรับจัดทำ Chat bot เพจคณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น.pdf',
    'เอกสารการเข้ารับการศึกษา.pdf'
  ],
  images: [
    'ค่าธรรมเนียมการศึกษาป.ตรี-650x900.png',
    'ช่องทางการติดต่อสำหรับนักศึกษาปตรี.jpg'
  ],
  website: 'https://www.en.kku.ac.th/web/%E0%B8%87%E0%B8%B2%E0%B8%99%E0%B8%9A%E0%B8%A3%E0%B8%B4%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%A7%E0%B8%B4%E0%B8%8A%E0%B8%B2%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%81%E0%B8%A5%E0%B8%B0%E0%B8%A7%E0%B8%B4%E0%B8%88/#1523875822874-a039c957-3a3f'
};

// ฟังก์ชันอ่านเนื้อหาจากเว็บไซต์
async function scrapeWebsite(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    let content = '';
    
    // ปรับตามโครงสร้างเว็บไซต์จริง
    $('body').find('p, h1, h2, h3, li').each((i, elem) => {
      content += $(elem).text() + '\n';
    });
    
    return content;
  } catch (error) {
    console.error("Error scraping website:", error);
    return null;
  }
}

// ฟังก์ชันอ่านเอกสาร PDF
async function readPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(dataBuffer);
    return pdfData.text;
  } catch (error) {
    console.error("Error reading PDF:", error);
    return null;
  }
}

// ฟังก์ชันอ่านข้อความจากภาพ
async function extractTextFromImage(imagePath) {
  try {
    const visionModel = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
    const imageParts = [{
      inlineData: {
        data: fs.readFileSync(imagePath).toString('base64'),
        mimeType: 'image/' + path.extname(imagePath).slice(1)
      }
    }];

    const result = await visionModel.generateContent({
      contents: [{ 
        role: "user",
        parts: [
          { text: "อ่านข้อความทั้งหมดในภาพนี้และส่งกลับเป็นรูปแบบข้อความโครงสร้างที่ชัดเจน:" },
          ...imageParts
        ]
      }]
    });

    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Error extracting text from image:", error);
    return "ไม่สามารถอ่านข้อความจากภาพได้";
  }
}

// ฟังก์ชันเตรียมข้อมูลทั้งหมด
async function prepareTrainingData() {
  try {
    console.log("กำลังเตรียมข้อมูลสำหรับเทรน...");
    let allContent = '';

    // 1. อ่านข้อมูลจาก PDFs
    for (const pdfFile of trainingData.pdfs) {
      const pdfPath = path.join(__dirname, 'data', pdfFile);
      if (fs.existsSync(pdfPath)) {
        const content = await readPDF(pdfPath);
        allContent += `\n\nข้อมูลจาก ${pdfFile}:\n${content}`;
      }
    }

    // 2. อ่านข้อมูลจากรูปภาพ
    for (const imageFile of trainingData.images) {
      const imagePath = path.join(__dirname, 'data', imageFile);
      if (fs.existsSync(imagePath)) {
        const content = await extractTextFromImage(imagePath);
        allContent += `\n\nข้อมูลจาก ${imageFile}:\n${content}`;
      }
    }

    // 3. อ่านข้อมูลจากเว็บไซต์
    const webContent = await scrapeWebsite(trainingData.website);
    if (webContent) {
      allContent += `\n\nข้อมูลจากเว็บไซต์:\n${webContent}`;
    }

    console.log("เตรียมข้อมูลสำหรับเทรนเสร็จสิ้น");
    return allContent;
  } catch (error) {
    console.error("Error preparing training data:", error);
    throw error;
  }
}

// ฟังก์ชันประมวลผลไฟล์ที่อัปโหลด
async function processUploadedFile(file) {
  try {
    const filePath = file.path;
    const fileType = file.mimetype;
    let textContent = '';

    if (fileType.startsWith('image/')) {
      return {
        type: 'image',
        data: fs.readFileSync(filePath).toString('base64'),
        mimeType: fileType,
        text: await extractTextFromImage(filePath)
      };
    }
    else if (fileType === 'application/pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer);
      textContent = `เนื้อหา PDF:\n${pdfData.text}`;
    }
    else if (fileType.includes('wordprocessingml.document')) {
      const result = await mammoth.extractRawText({ path: filePath });
      textContent = `เนื้อหาเอกสาร:\n${result.value}`;
    }
    else if (fileType === 'text/plain') {
      textContent = `เนื้อหาไฟล์:\n${fs.readFileSync(filePath, 'utf8')}`;
    }

    fs.unlinkSync(filePath);
    return {
      type: 'text',
      content: textContent
    };
  } catch (error) {
    console.error("Error processing file:", error);
    throw error;
  }
}

// API Endpoint สำหรับการสนทนา
app.post('/chat', async (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ 
        error: "ข้อผิดพลาดในการอัปโหลดไฟล์",
        details: err.message 
      });
    }

    try {
      const trainedData = await prepareTrainingData();
      let userMessage = req.body.message || '';
      let fileContent = null;
      
      if (req.file) {
        fileContent = await processUploadedFile(req.file);
      }

      // สร้าง prompt สำหรับ Gemini
      const promptParts = [
        "คุณเป็นผู้ช่วยตอบคำถามสำหรับคณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น",
        "ข้อมูลอ้างอิงจากแหล่งข้อมูลทางการ:",
        trainedData,
        "",
        "คำถามหรือข้อความจากผู้ใช้:",
        userMessage || "(ไม่มีข้อความ, ผู้ใช้ส่งเฉพาะไฟล์)"
      ];

      // เพิ่มข้อมูลไฟล์ถ้ามี
      const parts = [{ text: promptParts.join("\n") }];
      
      if (fileContent) {
        if (fileContent.type === 'image') {
          parts.push({
            inlineData: {
              data: fileContent.data,
              mimeType: fileContent.mimeType
            }
          });
          parts[0].text += `\n\nข้อมูลจากภาพที่อัปโหลด:\n${fileContent.text}`;
        } else if (fileContent.type === 'text') {
          parts[0].text += `\n\nเนื้อหาไฟล์ที่อัปโหลด:\n${fileContent.content}`;
        }
      }

      const result = await model.generateContent({
        contents: [{ 
          role: "user",
          parts: parts
        }]
      });

      const response = await result.response;
      res.json({ response: response.text() });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ 
        error: "ข้อผิดพลาดในการประมวลผล",
        details: error.message 
      });
    }
  });
});

// สร้างโฟลเดอร์ที่จำเป็น
const directories = ['uploads', 'data'];
directories.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// เริ่มต้นเซิร์ฟเวอร์
app.listen(port, () => {
  console.log(`เซิร์ฟเวอร์ทำงานที่ http://localhost:${port}`);
  console.log("ระบบพร้อมใช้งาน โดยมีการเทรนข้อมูลจาก:");
  console.log("- ไฟล์ PDF: FAQ และเอกสารการรับเข้า");
  console.log("- ไฟล์ภาพ: ตารางค่าเทอมและช่องทางการติดต่อ");
  console.log("- เว็บไซต์คณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น");
});