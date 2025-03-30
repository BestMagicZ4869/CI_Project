require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const cors = require('cors');
const mammoth = require('mammoth');

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
  model: "gemini-2.5-pro-exp-03-25",
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

// ข้อมูลทรัพยากรของคณะวิศวกรรมศาสตร์
const kkuResources = {
  "admission": [
    {
      "title": "ระบบรับสมัครนักศึกษา",
      "url": "https://www.admissions.kku.ac.th"
    },
    {
      "title": "เว็บไซต์คณะวิศวกรรมศาสตร์",
      "url": "https://www.en.kku.ac.th"
    }
  ],
  "tuition": [
    {
      "title": "ค่าธรรมเนียมการศึกษาปริญญาตรี",
      "url": "https://www.en.kku.ac.th/web/tuition-fees"
    }
  ],
  "curriculum": [
    {
      "title": "หลักสูตรวิศวกรรมศาสตร์",
      "url": "https://www.en.kku.ac.th/web/curriculum"
    }
  ]
};

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
        mimeType: fileType
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

    // ลบไฟล์ชั่วคราวหลังจากประมวลผล
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
      let userMessage = req.body.message || '';
      let fileContent = null;
      
      // ประมวลผลไฟล์ที่อัปโหลด (ถ้ามี)
      if (req.file) {
        fileContent = await processUploadedFile(req.file);
      }

      // สร้าง prompt สำหรับ Gemini
      const promptParts = [
        "คุณเป็นผู้ช่วยตอบคำถามสำหรับคณะวิศวกรรมศาสตร์ มหาวิทยาลัยขอนแก่น",
        "กรุณาตอบคำถามต่อไปนี้อย่างถูกต้องและกระชับ:",
        "",
        "คำถามหรือข้อความจากผู้ใช้:",
        userMessage || "(ไม่มีข้อความ, ผู้ใช้ส่งเฉพาะไฟล์)",
        "",
        "คำตอบ:"
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
        } else if (fileContent.type === 'text') {
          parts[0].text += `\n\nเนื้อหาไฟล์ที่อัปโหลด:\n${fileContent.content}`;
        }
      }

      // ส่งไปยัง Gemini API
      const result = await model.generateContent({
        contents: [{ 
          role: "user",
          parts: parts
        }],
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_ONLY_HIGH"
          }
        ]
      });

      const response = await result.response;
      let responseText = response.text();

      // เพิ่มลิงก์ทรัพยากรที่เกี่ยวข้อง (ถ้ามี)
      const relevantResources = findRelevantResources(userMessage);
      if (relevantResources.length > 0) {
        responseText += "\n\nแหล่งข้อมูลเพิ่มเติม:\n";
        responseText += relevantResources.map(r => `- [${r.title}](${r.url})`).join("\n");
      }

      res.json({ 
        response: responseText
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ 
        error: "ข้อผิดพลาดในการประมวลผล",
        details: error.message 
      });
    }
  });
});

// ฟังก์ชันค้นหาทรัพยากรที่เกี่ยวข้อง
function findRelevantResources(query) {
  if (!query) return [];
  
  const lowerQuery = query.toLowerCase();
  const resources = [];
  
  // ค้นหาตามหมวดหมู่
  if (lowerQuery.includes('สมัคร') || lowerQuery.includes('รับเข้า')) {
    resources.push(...kkuResources.admission);
  }
  
  if (lowerQuery.includes('ค่าเทอม') || lowerQuery.includes('ค่าธรรมเนียม')) {
    resources.push(...kkuResources.tuition);
  }
  
  if (lowerQuery.includes('หลักสูตร') || lowerQuery.includes('วิชา')) {
    resources.push(...kkuResources.curriculum);
  }
  
  // ลบรายการที่ซ้ำกัน
  return [...new Map(resources.map(item => [item.url, item])).values()];
}

// API Endpoint สำหรับข้อมูลพื้นฐาน
app.get('/api/resources', (req, res) => {
  res.json({
    resources: kkuResources,
    last_updated: new Date().toISOString()
  });
});

// สร้างโฟลเดอร์ uploads ถ้ายังไม่มี
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// เริ่มต้นเซิร์ฟเวอร์
app.listen(port, () => {
  console.log(`เซิร์ฟเวอร์ทำงานที่ http://localhost:${port}`);
  console.log("ระบบพร้อมใช้งาน (โหมดไม่ใช้ Vector Database)");
});