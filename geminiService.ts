import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Summarizes action logs and suggests reflection questions.
 */
export const getReviewInsight = async (logs: string[], dreams: string[]) => {
  if (logs.length === 0) return "No activity logged this period.";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `User Logs: ${JSON.stringify(logs)} \nDreams: ${JSON.stringify(dreams)}`,
      config: {
        systemInstruction: "You are a concise analytical assistant. Summarize the user's progress based on their action logs and provide 3 neutral, reflective questions to help them evaluate their efforts towards their dreams. No motivational fluff.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: "A two-sentence summary of efforts." },
            questions: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "3 reflective questions."
            }
          },
          required: ["summary", "questions"]
        }
      }
    });

    // Extract text safely from GenerateContentResponse
    const text = response.text;
    if (!text) return null;
    return JSON.parse(text.trim());
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
};
