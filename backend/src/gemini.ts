import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

// GEMINI_API_KEYS (カンマ区切りまたは GEMINI_API_KEY_1..N)
const rawKeys = process.env.GEMINI_API_KEYS || '';
const parsedKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

// 個別キー環境変数からも回収
for (let i = 1; i <= 10; i++) {
  const k = process.env[`GEMINI_API_KEY_${i}`];
  if (k && !parsedKeys.includes(k.trim())) {
    parsedKeys.push(k.trim());
  }
}
if (process.env.GEMINI_API_KEY && !parsedKeys.includes(process.env.GEMINI_API_KEY.trim())) {
  parsedKeys.push(process.env.GEMINI_API_KEY.trim());
}

let currentKeyIndex = 0;

export function getGeminiClient(): { client: GoogleGenAI; keyIndex: number } | null {
  if (parsedKeys.length === 0) return null;
  const key = parsedKeys[currentKeyIndex % parsedKeys.length];
  currentKeyIndex = (currentKeyIndex + 1) % parsedKeys.length;
  return {
    client: new GoogleGenAI({ apiKey: key }),
    keyIndex: currentKeyIndex,
  };
}

export async function askGemini(prompt: string, systemInstruction?: string): Promise<string> {
  const instance = getGeminiClient();
  if (!instance) {
    return '【Gemini連携】APIキーが設定されていません。.env に GEMINI_API_KEY_1 などを登録してください。';
  }

  try {
    const response = await instance.client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: systemInstruction ? { systemInstruction } : undefined,
    });

    return response.text || '（応答がありませんでした）';
  } catch (err: any) {
    console.error('Gemini call error:', err);
    return `AI呼び出しエラー: ${err.message || '不明なエラー'}`;
  }
}
