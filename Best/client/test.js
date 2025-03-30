// test.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
  try {
    const API_KEY = "AIzaSyBi3vkr-oH8wWsg7-Mfg7UQ46wf3GnfVmo"; // Replace with your actual key
    const genAI = new GoogleGenerativeAI(API_KEY);
    
    // Use the correct model name from your available models
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-pro-002", // Updated to latest stable Flash model
      // model: "gemini-1.5-pro-002", // Alternative if you need more capability
      apiVersion: "v1beta" // Required API version
    });

    console.log("Sending request to Gemini...");
    const result = await model.generateContent({
      contents: [{
        parts: [{
          text: "Hello! How are you today?"
        }]
      }]
    });

    const response = await result.response;
    console.log("✅ Successful Response:");
    console.log(response.text());
    
  } catch (error) {
    console.error("❌ Error Details:");
    console.error("- Message:", error.message);
    if (error.stack) {
      console.error("- Stack:", error.stack.split("\n")[0]);
    }
    console.error("\nℹ️ Available models in your project:");
    console.error("- gemini-1.5-flash-002 (recommended)");
    console.error("- gemini-1.5-pro-002");
    console.error("- gemini-1.5-flash-latest");
    console.error("- gemini-1.5-pro-latest");
  }
}

testGemini();