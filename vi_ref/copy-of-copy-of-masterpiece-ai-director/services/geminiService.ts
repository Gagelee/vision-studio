
import { GoogleGenAI, Type } from "@google/genai";
import { Message, Story, Shot, AspectRatio } from "../types";

/**
 * World-class Gemini API Service for Masterpiece AI.
 * Uses specific model versions as per guidelines for optimal performance.
 */

// Initialize the Gemini client using the environment's API_KEY
const getAi = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Sends messages to Gemini 3 Flash to help the user refine their story vision.
 * Supports image references through the inlineData part structure.
 */
export async function sendDirectorMessage(
  history: Message[],
  currentContext: Story | null,
  newMessage: string
): Promise<string> {
  const ai = getAi();
  
  // Map our Message type to Gemini's history structure
  const contents = history.map(m => {
    const parts: any[] = [{ text: m.text || (m.role === 'user' ? "User reference" : "Director's feedback") }];
    
    // Process attachments as inlineData parts
    if (m.attachments) {
      m.attachments.forEach(att => {
        if (att.data) {
          // Extract base64 data by removing the data URL prefix if present
          const base64Data = att.data.includes(',') ? att.data.split(',')[1] : att.data;
          parts.push({
            inlineData: {
              mimeType: att.type,
              data: base64Data
            }
          });
        }
      });
    }
    
    return {
      role: m.role === 'model' ? 'model' : 'user',
      parts
    };
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents,
    config: {
      systemInstruction: `You are a world-class cinematic director and visual architect. 
      Help the Auteur refine their story vision, visual style, and narrative scaffolding.
      Use professional film terminology. Be evocative but concise.
      Project Context: ${currentContext ? JSON.stringify({ title: currentContext.title, logline: currentContext.logline }) : 'A new creative journey.'}`
    }
  });

  return response.text || "The vision is becoming clear. How shall we proceed?";
}

/**
 * Generates a full Story object from a narrative prompt.
 * Uses Gemini 3 Pro with structured JSON output for complex scaffolding.
 */
export async function generateScaffold(intent: string): Promise<Story> {
  const ai = getAi();
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `Translate the following cinematic intent into a structured story scaffold: "${intent}". 
    Define a title, logline, style guide, characters, locations, and at least 2 key sequences with multiple shots each.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          logline: { type: Type.STRING },
          intent: { type: Type.STRING },
          styleGuide: { type: Type.STRING, description: "Lighting, color palette, mood, and visual signature." },
          characters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ['id', 'name', 'description']
            }
          },
          locations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ['id', 'name', 'description']
            }
          },
          sequences: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                context: { type: Type.STRING, description: "Narrative goal of this sequence" },
                shots: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      description: { type: Type.STRING, description: "Visual frame description" },
                      duration: { type: Type.NUMBER },
                      cameraMovement: { type: Type.STRING }
                    },
                    required: ['id', 'description', 'duration']
                  }
                }
              },
              required: ['id', 'title', 'context', 'shots']
            }
          }
        },
        required: ['title', 'logline', 'intent', 'styleGuide', 'characters', 'locations', 'sequences']
      }
    }
  });

  const storyData = JSON.parse(response.text || '{}');
  
  return {
    ...storyData,
    id: `proj-${Date.now()}`,
    createdAt: Date.now(),
    aspectRatio: '16:9'
  };
}

/**
 * Creates a story scaffold based on a dialogue history.
 */
export async function generateScaffoldFromChat(history: Message[]): Promise<Story> {
  const narrativeSummary = history.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n');
  return generateScaffold(narrativeSummary);
}

/**
 * Generates a cinematic shot image using Gemini 2.5 Flash Image.
 * Maps aspect ratios to supported Gemini API formats.
 */
export async function generateShotImage(
  shot: Shot, 
  styleGuide: string, 
  aspectRatio: AspectRatio
): Promise<string | null> {
  const ai = getAi();
  
  // Normalize aspect ratios for Gemini API (Supports 1:1, 3:4, 4:3, 9:16, 16:9)
  let geminiRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" = "16:9";
  if (aspectRatio === "16:9") geminiRatio = "16:9";
  else if (aspectRatio === "9:16") geminiRatio = "9:16";
  else if (aspectRatio === "1:1") geminiRatio = "1:1";
  else if (aspectRatio === "4:5") geminiRatio = "3:4"; 

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        { text: `A professional cinematic film still. 
        Description: ${shot.description}. 
        Atmosphere: ${styleGuide}. 
        Camera: ${shot.cameraMovement || 'Static, professional frame'}.
        Photorealistic, 8k, anamorphic lighting, movie set quality.` }
      ]
    },
    config: {
      imageConfig: {
        aspectRatio: geminiRatio
      }
    }
  });

  // Iterate through candidates and parts to find the generated image
  for (const candidate of response.candidates || []) {
    for (const part of candidate.content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }

  return null;
}
