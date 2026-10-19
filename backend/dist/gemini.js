"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailableKeyCount = getAvailableKeyCount;
exports.askGemini = askGemini;
exports.chatWithGemini = chatWithGemini;
exports.runGeminiAgent = runGeminiAgent;
const genai_1 = require("@google/genai");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
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
const MODELS = [
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
];
function getAvailableKeyCount() {
    return parsedKeys.length;
}
// 複数のキーとモデルでフォールバックしながら実行する
async function askGemini(prompt, systemInstruction) {
    if (parsedKeys.length === 0) {
        return '【Gemini連携】APIキーが設定されていません。.env に GEMINI_API_KEY_1 などを登録してください。';
    }
    const models = MODELS;
    let lastError = null;
    // 登録されている全キーを順番に試行
    for (let attempt = 0; attempt < parsedKeys.length; attempt++) {
        const key = parsedKeys[currentKeyIndex % parsedKeys.length];
        currentKeyIndex = (currentKeyIndex + 1) % parsedKeys.length;
        for (const model of models) {
            try {
                const client = new genai_1.GoogleGenAI({ apiKey: key });
                const response = await client.models.generateContent({
                    model,
                    contents: prompt,
                    config: systemInstruction ? { systemInstruction } : undefined,
                });
                if (response.text) {
                    return response.text;
                }
            }
            catch (err) {
                lastError = err;
                // モデル非対応の場合は次のモデルへ、キーエラーの場合は次のキーへ
                console.warn(`[Gemini] Model ${model} failed with key index ${attempt}: ${err.message || err}`);
            }
        }
    }
    return `AI呼び出しエラー: すべてのAPIキーまたはモデルでの呼び出しに失敗しました (${lastError?.message || '不明なエラー'})`;
}
// AIタブ・チャット用の対話関数（履歴＋コンテキストJSON対応）
async function chatWithGemini(messages, contextData, systemInstruction) {
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
        'あなたは中学生向けワークスペース「asdfbase」のAIアシスタントです。コンテキスト情報 (JSON) を必要に応じて活用し、前置きや締めの挨拶を省いて要点だけを日本語で簡潔に答えてください。';
    return askGemini(fullPrompt, defaultInstruction);
}
// 一度成功したキーとモデルは、同じ会話の続きでも使い続ける (途中でモデルが変わると関数呼び出しの文脈が崩れるため)
async function generateWithFallback(contents, config, pinned) {
    const keys = parsedKeys.map((_, i) => parsedKeys[(currentKeyIndex + i) % parsedKeys.length]);
    currentKeyIndex = (currentKeyIndex + 1) % Math.max(parsedKeys.length, 1);
    const combos = pinned.model
        ? [pinned.key, ...keys.filter(k => k !== pinned.key)].map(key => ({ key, model: pinned.model }))
        : keys.flatMap(key => MODELS.map(model => ({ key, model })));
    let lastError = null;
    for (const c of combos) {
        try {
            const client = new genai_1.GoogleGenAI({ apiKey: c.key });
            const response = await client.models.generateContent({ model: c.model, contents, config });
            pinned.key = c.key;
            pinned.model = c.model;
            return response;
        }
        catch (err) {
            lastError = err;
            console.warn(`[Gemini agent] ${c.model} failed: ${err.message || err}`);
        }
    }
    throw new Error(lastError?.message || 'すべてのAPIキーまたはモデルでの呼び出しに失敗しました');
}
async function runGeminiAgent(input) {
    if (parsedKeys.length === 0) {
        return { text: '【Gemini連携】APIキーが設定されていません。', steps: [] };
    }
    const contents = [...input.history];
    const steps = [];
    const pinned = {};
    const config = {
        systemInstruction: input.systemInstruction,
        tools: input.tools.length > 0 ? [{ functionDeclarations: input.tools }] : undefined,
    };
    const maxSteps = input.maxSteps ?? 6;
    for (let round = 0; round <= maxSteps; round++) {
        // 上限に達したらツールなしで答えさせる
        const roundConfig = round === maxSteps ? { systemInstruction: input.systemInstruction } : config;
        const response = await generateWithFallback(contents, roundConfig, pinned);
        const calls = response.functionCalls || [];
        if (calls.length === 0) {
            return { text: response.text?.trim() || '(応答が空でした)', steps };
        }
        const modelContent = response.candidates?.[0]?.content;
        if (modelContent)
            contents.push(modelContent);
        const parts = [];
        for (const call of calls) {
            const { step, response: toolResponse } = await input.runTool(call.name || '', call.args || {});
            steps.push(step);
            parts.push({ functionResponse: { id: call.id, name: call.name, response: toolResponse } });
        }
        contents.push({ role: 'user', parts });
    }
    return { text: '(応答をまとめられませんでした)', steps };
}
