import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

// GEMINI_API_KEYS (カンマ区切りまたは GEMINI_API_KEY_1..N)
const rawKeys = process.env.GEMINI_API_KEYS || '';
const parsedKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

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

export function getAvailableKeyCount(): number {
  return parsedKeys.length;
}

// 複数のキーとモデルでフォールバックしながら実行する
export async function askGemini(prompt: string, systemInstruction?: string): Promise<string> {
  if (parsedKeys.length === 0) {
    return '【Gemini連携】APIキーが設定されていません。.env に GEMINI_API_KEY_1 などを登録してください。';
  }

  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];
  let lastError: any = null;

  // 登録されている全キーを順番に試行
  for (let attempt = 0; attempt < parsedKeys.length; attempt++) {
    const key = parsedKeys[currentKeyIndex % parsedKeys.length];
    currentKeyIndex = (currentKeyIndex + 1) % parsedKeys.length;

    for (const model of models) {
      try {
        const client = new GoogleGenAI({ apiKey: key });
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: systemInstruction ? { systemInstruction } : undefined,
        });

        if (response.text) {
          return response.text;
        }
      } catch (err: any) {
        lastError = err;
        // モデル非対応の場合は次のモデルへ、キーエラーの場合は次のキーへ
        console.warn(`[Gemini] Model ${model} failed with key index ${attempt}: ${err.message || err}`);
      }
    }
  }

  return `AI呼び出しエラー: すべてのAPIキーまたはモデルでの呼び出しに失敗しました (${lastError?.message || '不明なエラー'})`;
}

// AIタブ・チャット用の対話関数（履歴＋コンテキストJSON対応）
export async function chatWithGemini(
  messages: { role: 'user' | 'model'; content: string }[],
  contextData?: any,
  systemInstruction?: string
): Promise<string> {
  if (parsedKeys.length === 0) {
    return '【Gemini連携】APIキーが設定されていません。';
  }

  let fullPrompt = '';
  if (contextData) {
    fullPrompt += `【現在のシステムコンテキスト情報 (JSON)】\n\`\`\`json\n${JSON.stringify(contextData, null, 2)}\n\`\`\`\n\n`;
  }

  fullPrompt += '【これまでの会話】\n';
  for (const m of messages) {
    fullPrompt += `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}\n`;
  }
  fullPrompt += 'AIとしての返答:';

  const defaultInstruction = systemInstruction || 
    'あなたは学生向けワークスペース「asdfbase」の優秀で親切なAIアシスタントです。提供されたコンテキスト情報も活用し、簡潔かつ分かりやすく日本語で回答してください。';

  return askGemini(fullPrompt, defaultInstruction);
}
