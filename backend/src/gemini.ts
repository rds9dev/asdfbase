import { GoogleGenAI, FunctionCallingConfigMode, type Content, type FunctionDeclaration, type GenerateContentResponse } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

export type ModelMode = 'fast' | 'thinking';

export interface ModelSpec {
  id: string;
  name: string;
  fallbacks: string[];
  rpmLimit: number;
  tpmLimit: number;
  rpdLimit: number;
}

export const MODEL_SPECS: Record<ModelMode, ModelSpec> = {
  fast: {
    id: 'gemini-3.5-flash-lite',
    name: '高速モード (gemini-3.5-flash-lite)',
    fallbacks: ['gemini-flash-lite-latest', 'gemini-2.0-flash', 'gemini-1.5-flash'],
    rpmLimit: 30,
    tpmLimit: 10_000_000,
    rpdLimit: 1500,
  },
  thinking: {
    id: 'gemini-3.8-flash',
    name: '思考モード (gemini-3.8-flash)',
    fallbacks: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'],
    rpmLimit: 15,
    tpmLimit: 3_000_000,
    rpdLimit: 1500,
  },
};

const TOTAL_SLOTS = 5;

// APIキーの取得とスロット割り当て (1..5)
function loadSlotKeys(): (string | null)[] {
  const slots: (string | null)[] = [null, null, null, null, null];
  const leftoverKeys: string[] = [];

  const rawKeys = process.env.GEMINI_API_KEYS || '';
  rawKeys.split(',').map(k => k.trim()).filter(Boolean).forEach(k => leftoverKeys.push(k));

  for (let i = 1; i <= TOTAL_SLOTS; i++) {
    const k = (process.env[`GEMINI_API_KEY_${i}`] || '').trim();
    if (k) {
      slots[i - 1] = k;
    }
  }

  if (process.env.GEMINI_API_KEY && !leftoverKeys.includes(process.env.GEMINI_API_KEY.trim())) {
    leftoverKeys.push(process.env.GEMINI_API_KEY.trim());
  }

  // 空いているスロットに残りのキーを補充
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (!slots[i] && leftoverKeys.length > 0) {
      const nextKey = leftoverKeys.shift();
      if (nextKey) slots[i] = nextKey;
    }
  }

  return slots;
}

const slotKeys = loadSlotKeys();

export function getAvailableKeyCount(): number {
  return slotKeys.filter(Boolean).length;
}

// ---------------- レートリミット & 利用量トラッカー ----------------
interface WindowRecord {
  timestamp: number;
  tokens: number;
}

interface SlotModelUsage {
  window: WindowRecord[]; // 直近60秒
  todayRequests: number;  // 本日PT
  todayTokens: number;
  ptDate: string;         // YYYY-MM-DD (America/Los_Angeles)
}

function getPtDateString(d = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// 次回 PT 午前0時 (リセット時刻) の計算
function getNextPtResetTime(): { iso: string; msUntilReset: number; label: string } {
  const now = new Date();
  const ptString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const ptDate = new Date(ptString);

  const nextPt = new Date(ptDate);
  nextPt.setHours(24, 0, 0, 0); // 翌日 00:00:00 PT
  const diffMs = nextPt.getTime() - ptDate.getTime();

  const resetDate = new Date(now.getTime() + diffMs);
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);

  return {
    iso: resetDate.toISOString(),
    msUntilReset: Math.max(0, diffMs),
    label: `${hours}時間${minutes}分後 (PT 0:00 / JST ${resetDate.getHours().toString().padStart(2, '0')}:${resetDate.getMinutes().toString().padStart(2, '0')})`,
  };
}

// 各スロット × 各モデルの利用統計 (メモリ保持)
const usageTracker: Record<number, Record<ModelMode, SlotModelUsage>> = {
  0: { fast: createEmptyUsage(), thinking: createEmptyUsage() },
  1: { fast: createEmptyUsage(), thinking: createEmptyUsage() },
  2: { fast: createEmptyUsage(), thinking: createEmptyUsage() },
  3: { fast: createEmptyUsage(), thinking: createEmptyUsage() },
  4: { fast: createEmptyUsage(), thinking: createEmptyUsage() },
};

function createEmptyUsage(): SlotModelUsage {
  return {
    window: [],
    todayRequests: 0,
    todayTokens: 0,
    ptDate: getPtDateString(),
  };
}

function cleanAndResetUsage(usage: SlotModelUsage, now = Date.now()) {
  const todayPt = getPtDateString(new Date(now));
  if (usage.ptDate !== todayPt) {
    usage.ptDate = todayPt;
    usage.todayRequests = 0;
    usage.todayTokens = 0;
  }
  const cutoff = now - 60_000;
  usage.window = usage.window.filter(r => r.timestamp > cutoff);
}

let lastRotatedSlotIndex = 0;

// 最適なスロットの選択 (ローテーション & リミット回避)
export function pickSlot(mode: ModelMode): { slotIndex: number; key: string } | null {
  const now = Date.now();
  const spec = MODEL_SPECS[mode];

  // キーが設定されているスロットのインデックス一覧
  const validSlotIndices: number[] = [];
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (slotKeys[i]) validSlotIndices.push(i);
  }
  if (validSlotIndices.length === 0) return null;

  // ラウンドロビン順に空きを探索
  for (let attempt = 0; attempt < validSlotIndices.length; attempt++) {
    const candidateIdx = validSlotIndices[(lastRotatedSlotIndex + attempt) % validSlotIndices.length];
    const usage = usageTracker[candidateIdx][mode];
    cleanAndResetUsage(usage, now);

    const currentRpm = usage.window.length;
    const currentTpm = usage.window.reduce((acc, r) => acc + r.tokens, 0);
    const currentRpd = usage.todayRequests;

    if (currentRpm < spec.rpmLimit && currentTpm < spec.tpmLimit && currentRpd < spec.rpdLimit) {
      lastRotatedSlotIndex = (lastRotatedSlotIndex + attempt + 1) % validSlotIndices.length;
      return { slotIndex: candidateIdx, key: slotKeys[candidateIdx]! };
    }
  }

  // 全てが何らかの制限に近い場合は、もっとも利用が少ないスロットをフォールバック
  let bestIdx = validSlotIndices[0];
  let minRpm = 999999;
  for (const idx of validSlotIndices) {
    const u = usageTracker[idx][mode];
    cleanAndResetUsage(u, now);
    if (u.window.length < minRpm) {
      minRpm = u.window.length;
      bestIdx = idx;
    }
  }
  return { slotIndex: bestIdx, key: slotKeys[bestIdx]! };
}

// 利用実績の記録
export function recordUsage(slotIndex: number, mode: ModelMode, tokens: number) {
  const now = Date.now();
  const usage = usageTracker[slotIndex]?.[mode];
  if (!usage) return;
  cleanAndResetUsage(usage, now);
  usage.window.push({ timestamp: now, tokens: Math.max(tokens, 1) });
  usage.todayRequests += 1;
  usage.todayTokens += Math.max(tokens, 1);
}

// 利用状況まとめの取得
export function getAiUsageStats() {
  const now = Date.now();
  const resetInfo = getNextPtResetTime();
  const activeKeys = getAvailableKeyCount();

  const slots = [];
  let totalFastRpd = 0;
  let totalThinkingRpd = 0;

  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const fast = usageTracker[i].fast;
    const thinking = usageTracker[i].thinking;
    cleanAndResetUsage(fast, now);
    cleanAndResetUsage(thinking, now);

    totalFastRpd += fast.todayRequests;
    totalThinkingRpd += thinking.todayRequests;

    slots.push({
      slot: i + 1,
      hasKey: Boolean(slotKeys[i]),
      keyMasked: slotKeys[i] ? `${slotKeys[i]!.slice(0, 4)}...${slotKeys[i]!.slice(-4)}` : '未設定',
      fast: {
        rpm: fast.window.length,
        rpmLimit: MODEL_SPECS.fast.rpmLimit,
        tpm: fast.window.reduce((acc, r) => acc + r.tokens, 0),
        tpmLimit: MODEL_SPECS.fast.tpmLimit,
        rpd: fast.todayRequests,
        rpdLimit: MODEL_SPECS.fast.rpdLimit,
      },
      thinking: {
        rpm: thinking.window.length,
        rpmLimit: MODEL_SPECS.thinking.rpmLimit,
        tpm: thinking.window.reduce((acc, r) => acc + r.tokens, 0),
        tpmLimit: MODEL_SPECS.thinking.tpmLimit,
        rpd: thinking.todayRequests,
        rpdLimit: MODEL_SPECS.thinking.rpdLimit,
      },
    });
  }

  const maxDailyCapacity = Math.max(activeKeys, 1) * 1500;

  return {
    totalSlots: TOTAL_SLOTS,
    configuredKeys: activeKeys,
    resetTime: resetInfo,
    dailySummary: {
      fast: { used: totalFastRpd, max: maxDailyCapacity, remaining: Math.max(0, maxDailyCapacity - totalFastRpd) },
      thinking: { used: totalThinkingRpd, max: maxDailyCapacity, remaining: Math.max(0, maxDailyCapacity - totalThinkingRpd) },
    },
    slots,
  };
}

// ---------------- 会話履歴の自動圧縮 (効率化) ----------------
export function compactHistory(history: Content[], maxRecentTurns = 6): Content[] {
  if (history.length <= maxRecentTurns) return history;

  const recent = history.slice(-maxRecentTurns);
  const older = history.slice(0, -maxRecentTurns);

  const summarySnippets: string[] = [];
  for (const item of older) {
    const textPart = item.parts?.map(p => ('text' in p ? p.text : '')).join(' ') || '';
    if (textPart.trim()) {
      const roleLabel = item.role === 'model' ? 'AI' : 'User';
      summarySnippets.push(`- ${roleLabel}: ${textPart.slice(0, 200).replace(/\n+/g, ' ')}`);
    }
  }

  const compactedOlderText = [
    '【以前の会話の要点・経緯サマリー】',
    summarySnippets.slice(-10).join('\n'),
    '（※文脈を保ったまま上記を踏まえて回答を続けてください）'
  ].join('\n');

  const summaryContent: Content = {
    role: 'user',
    parts: [{ text: compactedOlderText }],
  };

  return [summaryContent, ...recent];
}

// ---------------- Gemini API 呼出 ----------------
export async function askGemini(prompt: string, systemInstruction?: string, mode: ModelMode = 'fast'): Promise<string> {
  const chosen = pickSlot(mode);
  if (!chosen) {
    return '【Gemini連携】APIキーが設定されていません。.env に GEMINI_API_KEY_1 などを登録してください。';
  }

  const spec = MODEL_SPECS[mode];
  const models = [spec.id, ...spec.fallbacks];
  let lastError: any = null;

  for (const model of models) {
    try {
      const client = new GoogleGenAI({ apiKey: chosen.key });
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: systemInstruction ? { systemInstruction } : undefined,
      });

      const tokens = response.usageMetadata?.totalTokenCount || Math.ceil((prompt.length + (response.text?.length || 0)) / 2);
      recordUsage(chosen.slotIndex, mode, tokens);

      if (response.text) {
        return response.text;
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`[Gemini askGemini] Slot ${chosen.slotIndex + 1} Model ${model} failed: ${err.message || err}`);
    }
  }

  return `AI呼び出しエラー: すべてのAPIキーまたはモデルでの呼び出しに失敗しました (${lastError?.message || '不明なエラー'})`;
}

export async function chatWithGemini(
  messages: { role: 'user' | 'model'; content: string }[],
  contextData?: any,
  systemInstruction?: string,
  mode: ModelMode = 'fast'
): Promise<string> {
  if (getAvailableKeyCount() === 0) {
    return '【Gemini連携】APIキーが設定されていません。';
  }

  let fullPrompt = '';
  if (contextData) {
    fullPrompt += `【現在のシステムコンテキスト情報 (JSON)】\n\`\`\`json\n${JSON.stringify(contextData, null, 2)}\n\`\`\`\n\n`;
  }

  fullPrompt += '【これまでの会話】\n';
  const recentMessages = messages.slice(-12);
  for (const m of recentMessages) {
    fullPrompt += `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}\n`;
  }
  fullPrompt += 'AIとしての返答:';

  const defaultInstruction = systemInstruction || 
    'あなたは中学生向けワークスペース「asdfbase」のAIアシスタントです。コンテキスト情報 (JSON) を必要に応じて活用し、前置きや締めの挨拶を省いて要点だけを日本語で簡潔に答えてください。';

  return askGemini(fullPrompt, defaultInstruction, mode);
}

// ---------------- ツールを使う AI (関数呼び出し) ----------------
export interface AgentStep {
  name: string;
  label: string;
  ok: boolean;
  write: boolean;
}

export interface AgentInput {
  history: Content[];
  systemInstruction: string;
  tools: FunctionDeclaration[];
  runTool: (name: string, args: any) => Promise<{ step: AgentStep; response: Record<string, unknown> }>;
  maxSteps?: number;
  forceFirstTool?: string;
  mode?: ModelMode;
}

async function generateWithFallback(
  contents: Content[],
  config: object,
  pinned: { slotIndex?: number; key?: string; model?: string },
  mode: ModelMode
): Promise<GenerateContentResponse> {
  const spec = MODEL_SPECS[mode];
  const models = [spec.id, ...spec.fallbacks];

  let chosenSlot = pinned.key && pinned.slotIndex !== undefined
    ? { slotIndex: pinned.slotIndex, key: pinned.key }
    : pickSlot(mode);

  if (!chosenSlot) {
    throw new Error('APIキーが設定されていません');
  }

  let lastError: any = null;

  for (const model of (pinned.model ? [pinned.model, ...models.filter(m => m !== pinned.model)] : models)) {
    try {
      const client = new GoogleGenAI({ apiKey: chosenSlot.key });
      const response = await client.models.generateContent({ model, contents, config });

      pinned.slotIndex = chosenSlot.slotIndex;
      pinned.key = chosenSlot.key;
      pinned.model = model;

      const tokens = response.usageMetadata?.totalTokenCount || 800;
      recordUsage(chosenSlot.slotIndex, mode, tokens);

      return response;
    } catch (err: any) {
      lastError = err;
      console.warn(`[Gemini agent] Slot ${chosenSlot.slotIndex + 1} Model ${model} failed: ${err.message || err}`);
    }
  }

  throw new Error(lastError?.message || 'すべてのAPIキーまたはモデルでの呼び出しに失敗しました');
}

export async function runGeminiAgent(input: AgentInput): Promise<{ text: string; steps: AgentStep[]; modelUsed?: string }> {
  if (getAvailableKeyCount() === 0) {
    return { text: '【Gemini連携】APIキーが設定されていません。', steps: [] };
  }

  const mode = input.mode || 'fast';
  // 履歴の自動効率化 (過去メッセージのサマリー圧縮)
  const contents: Content[] = compactHistory(input.history, 8);
  const steps: AgentStep[] = [];
  const pinned: { slotIndex?: number; key?: string; model?: string } = {};
  const config = {
    systemInstruction: input.systemInstruction,
    tools: input.tools.length > 0 ? [{ functionDeclarations: input.tools }] : undefined,
  };
  const maxSteps = input.maxSteps ?? 6;

  for (let round = 0; round <= maxSteps; round++) {
    const roundConfig = round === maxSteps
      ? { systemInstruction: input.systemInstruction }
      : round === 0 && input.forceFirstTool && input.tools.some(t => t.name === input.forceFirstTool)
        ? { ...config, toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [input.forceFirstTool] } } }
        : config;

    const response = await generateWithFallback(contents, roundConfig, pinned, mode);
    const calls = response.functionCalls || [];
    if (calls.length === 0) {
      return { text: response.text?.trim() || '(応答が空でした)', steps, modelUsed: pinned.model };
    }
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);
    const parts: NonNullable<Content['parts']> = [];
    for (const call of calls) {
      const { step, response: toolResponse } = await input.runTool(call.name || '', call.args || {});
      steps.push(step);
      parts.push({ functionResponse: { id: call.id, name: call.name, response: toolResponse } });
    }
    contents.push({ role: 'user', parts });
  }

  return { text: '(応答をまとめられませんでした)', steps, modelUsed: pinned.model };
}
