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

// ตรวจสอบ API Key
if (!process.env.GEMINI_API_KEY) {
  console.error("ไม่พบ API Key! กรุณาตั้งค่าในไฟล์ .env");
  process.exit(1);
}

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
const visionModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro-exp-03-25" });
const textModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro-exp-03-25" });

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

// ข้อมูลที่เทรนไว้
const trainedData = {
  images: {
    "tuition": {
      path: path.join(__dirname, 'data', 'ค่าธรรมเนียมการศึกษาป.ตรี-650x900.png'),
      mimeType: 'image/png',
      description: "ตารางค่าธรรมเนียมการศึกษาคณะวิศวกรรมศาสตร์ มข."
    },
    "contact": {
      path: path.join(__dirname, 'data', 'ช่องทางการติดต่อสำหรับนักศึกษาปตรี.jpg'),
      mimeType: 'image/jpeg',
      description: "ช่องทางการติดต่อคณะวิศวกรรมศาสตร์ มข."
    }
  },
  documents: {
    "faq": {
      path: path.join(__dirname, 'data', 'FAQ สำหรับจัดทำ Chat bot เพจคณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น.pdf'),
      type: 'pdf'
    },
    "admission": {
      path: path.join(__dirname, 'data', 'เอกสารการเข้ารับการศึกษา.pdf'),
      type: 'pdf'
    }
  },
  website: "https://www.en.kku.ac.th/web/%E0%B8%87%E0%B8%B2%E0%B8%99%E0%B8%9A%E0%B8%A3%E0%B8%B4%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%A7%E0%B8%B4%E0%B8%8A%E0%B8%B2%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%81%E0%B8%A5%E0%B8%B0%E0%B8%A7%E0%B8%B4%E0%B8%88/#1523875822874-a039c957-3a3f"
};

// ฟังก์ชันอ่านเนื้อหาจากเว็บไซต์
async function scrapeWebsite(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // ปรับแต่งตามโครงสร้างเว็บไซต์จริง
    let content = '';
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

// ฟังก์ชันวิเคราะห์ภาพ
async function analyzeImage(imagePath, mimeType, question = "") {
  try {
    const imageParts = [{
      inlineData: {
        data: fs.readFileSync(imagePath).toString('base64'),
        mimeType: mimeType
      }
    }];

    const prompt = question 
      ? `จากภาพนี้: ${question} (ตอบอย่างละเอียดและถูกต้อง)` 
      : "อธิบายเนื้อหาภาพนี้อย่างละเอียด";

    const result = await visionModel.generateContent({
      contents: [{ 
        role: "user",
        parts: [
          { text: prompt },
          ...imageParts
        ]
      }]
    });

    return (await result.response).text();
  } catch (error) {
    console.error("Error analyzing image:", error);
    throw error;
  }
}

// ฟังก์ชันเตรียมข้อมูลทั้งหมด
async function prepareAllData() {
  try {
    console.log("เริ่มเตรียมข้อมูลทั้งหมด...");
    
    // 1. ข้อมูลจากรูปภาพ
    const imageData = {};
    for (const [key, img] of Object.entries(trainedData.images)) {
      if (fs.existsSync(img.path)) {
        imageData[key] = {
          description: img.description,
          content: await analyzeImage(img.path, img.mimeType)
        };
      }
    }
    
    // 2. ข้อมูลจากเอกสาร PDF
    const documentData = {};
    for (const [key, doc] of Object.entries(trainedData.documents)) {
      if (fs.existsSync(doc.path)) {
        documentData[key] = {
          type: doc.type,
          content: await readPDF(doc.path)
        };
      }
    }
    
    // 3. ข้อมูลจากเว็บไซต์
    const websiteData = await scrapeWebsite(trainedData.website);
    
    console.log("เตรียมข้อมูลเสร็จสิ้น");
    return { imageData, documentData, websiteData };
  } catch (error) {
    console.error("Error preparing data:", error);
    throw error;
  }
}

// API Endpoint สำหรับถามคำถาม
app.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: "กรุณาระบุคำถาม" });
    }

    const allData = await prepareAllData();
    const context = `
      ข้อมูลจากรูปภาพ:
      ${JSON.stringify(allData.imageData)}
      
      ข้อมูลจากเอกสาร:
      ${JSON.stringify(allData.documentData)}
      
      ข้อมูลจากเว็บไซต์:
      ${allData.websiteData}
    `;

    const result = await textModel.generateContent({
      contents: [{
        role: "user",
        parts: [
          { text: "คุณเป็นผู้ช่วยตอบคำถามสำหรับคณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น" },
          { text: "กรุณาตอบคำถามต่อไปนี้โดยอ้างอิงจากข้อมูลด้านล่าง:" },
          { text: `คำถาม: ${question}` },
          { text: "ข้อมูลอ้างอิง:\n" + context }
        ]
      }]
    });

    const response = (await result.response).text();
    
    res.json({
      question: question,
      answer: response,
      sources: Object.keys(allData.imageData).concat(Object.keys(allData.documentData), ['website'])
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ 
      error: "ข้อผิดพลาดในการประมวลผล",
      details: error.message 
    });
  }
});

// API สำหรับอัปโหลดไฟล์และถามคำถาม
app.post('/ask-upload', upload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "กรุณาอัปโหลดไฟล์" });
  }

  try {
    const { question } = req.body;
    const filePath = req.file.path;
    const fileType = req.file.mimetype;
    let content = '';

    if (fileType.startsWith('image/')) {
      content = await analyzeImage(filePath, fileType, question);
    } else if (fileType === 'application/pdf') {
      content = await readPDF(filePath);
    }

    // ลบไฟล์ชั่วคราว
    fs.unlinkSync(filePath);

    res.json({
      question: question,
      content: content
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ 
      error: "ข้อผิดพลาดในการประมวลผลไฟล์",
      details: error.message 
    });
  }
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
app.listen(port, async () => {
  console.log(`เซิร์ฟเวอร์ทำงานที่ http://localhost:${port}`);
  console.log("กำลังเตรียมข้อมูลเริ่มต้น...");
  
  try {
    await prepareAllData();
    console.log("ระบบพร้อมใช้งาน");
  } catch (error) {
    console.error("เกิดข้อผิดพลาดขณะเตรียมข้อมูล:", error);
  }
});