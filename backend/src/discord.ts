// Discord Bot 連携
// - 許可されたサーバー (DISCORD_GUILD_ID) 以外では一切動作しない
// - /setup で「この Discord チャンネル ⇔ asdfbase チャンネル」を連携
// - asdfbase → Discord: Bot がメッセージと画像を送信
// - Discord → asdfbase: メッセージと画像を取り込み (動画は送らず「(動画が送信されています)」表示)
import {
  Client,
  GatewayIntentBits,
  Options,
  Events,
  PermissionFlagsBits,
  ApplicationCommandOptionType,
  type Message as DiscordMessage,
  type ChatInputCommandInteraction,
  type TextBasedChannel,
} from 'discord.js';
import path from 'path';
import fs from 'fs';

export interface DiscordBinding {
  discordChannelId: string;
  asdfChannelId: number;
}

export interface DiscordDeps {
  getSetting: (key: string, fallback?: string) => Promise<string>;
  setSetting: (key: string, value: string) => Promise<void>;
  listAsdfChannels: () => Promise<{ id: number; name: string; type: string }[]>;
  // Discord から来たメッセージを asdfbase に保存・配信
  ingest: (asdfChannelId: number, username: string, content: string) => Promise<void>;
  // Discord の画像を保存して /uploads/... のパスを返す
  saveImage: (buf: Buffer) => Promise<string>;
  uploadDir: string;
  audit: (action: string, details: object) => void;
}

const BINDINGS_KEY = 'discord_bindings';
const VIDEO_NOTICE = '(動画が送信されています)';

let client: Client | null = null;
let deps: DiscordDeps | null = null;
let guildId = '';
let connected = false;
let lastError = '';
let intentWarning = '';
let bindingsCache: DiscordBinding[] | null = null;

async function getBindings(): Promise<DiscordBinding[]> {
  if (bindingsCache) return bindingsCache;
  try {
    const raw = await deps!.getSetting(BINDINGS_KEY, '[]');
    const parsed = JSON.parse(raw);
    bindingsCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    bindingsCache = [];
  }
  return bindingsCache!;
}

async function saveBindings(list: DiscordBinding[]) {
  bindingsCache = list;
  await deps!.setSetting(BINDINGS_KEY, JSON.stringify(list));
}

// Bot で Discord に同期している asdfbase チャンネル
export async function getBoundAsdfChannelIds(): Promise<number[]> {
  if (!client || !deps) return [];
  return [...new Set((await getBindings()).map(b => b.asdfChannelId))];
}

export function isDiscordBotConfigured() {
  return Boolean(client);
}

export async function getDiscordStatus() {
  const bindings = deps ? await getBindings() : [];
  const channels = deps ? await deps.listAsdfChannels() : [];
  return {
    enabled: Boolean(client),
    connected,
    botTag: client?.user?.tag || null,
    guildId,
    guildName: client?.guilds.cache.get(guildId)?.name || null,
    intentWarning,
    lastError,
    bindings: bindings.map(b => {
      const ch = client?.channels.cache.get(b.discordChannelId) as any;
      return {
        ...b,
        discordChannelName: ch?.name || b.discordChannelId,
        asdfChannelName: channels.find(c => c.id === b.asdfChannelId)?.name || String(b.asdfChannelId),
      };
    }),
  };
}

// /setup のチャンネル選択肢を asdfbase のチャンネル一覧で更新
export async function refreshDiscordCommands() {
  if (!client || !connected || !deps) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channels = (await deps.listAsdfChannels()).filter(c => c.type !== 'voice').slice(0, 25);
  try {
    await guild.commands.set([
      {
        name: 'setup',
        description: 'このチャンネルを asdfbase のチャンネルと同期します',
        defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
        options: [
          {
            name: 'channel',
            description: '同期する asdfbase のチャンネル',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: channels.map(c => ({ name: `#${c.name}`, value: String(c.id) })),
          },
        ],
      },
      {
        name: 'unsetup',
        description: 'このチャンネルの asdfbase 同期を解除します',
        defaultMemberPermissions: PermissionFlagsBits.ManageChannels,
      },
      {
        name: 'status',
        description: 'asdfbase との同期状態を表示します',
      },
    ]);
  } catch (err: any) {
    lastError = `コマンド登録失敗: ${err.message}`;
    console.error('[discord] command registration failed:', err.message);
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.guildId !== guildId) {
    await interaction.reply({ content: 'このサーバーでは利用できません。', ephemeral: true });
    return;
  }
  const bindings = await getBindings();

  if (interaction.commandName === 'setup') {
    const asdfChannelId = parseInt(interaction.options.getString('channel', true), 10);
    const channels = await deps!.listAsdfChannels();
    const target = channels.find(c => c.id === asdfChannelId);
    if (!target) {
      await interaction.reply({ content: 'asdfbase のチャンネルが見つかりません。', ephemeral: true });
      return;
    }
    const next = bindings.filter(b => b.discordChannelId !== interaction.channelId);
    next.push({ discordChannelId: interaction.channelId, asdfChannelId });
    await saveBindings(next);
    deps!.audit('discord_setup', {
      message: `Discord #${(interaction.channel as any)?.name || interaction.channelId} ⇔ asdfbase #${target.name} を同期設定`,
      discordUser: interaction.user.tag,
    });
    await interaction.reply(`✅ このチャンネルを asdfbase **#${target.name}** と同期しました。メッセージと画像が双方向に転送されます。`);
    return;
  }

  if (interaction.commandName === 'unsetup') {
    const next = bindings.filter(b => b.discordChannelId !== interaction.channelId);
    if (next.length === bindings.length) {
      await interaction.reply({ content: 'このチャンネルは同期されていません。', ephemeral: true });
      return;
    }
    await saveBindings(next);
    deps!.audit('discord_unsetup', {
      message: `Discord #${(interaction.channel as any)?.name || interaction.channelId} の同期を解除`,
      discordUser: interaction.user.tag,
    });
    await interaction.reply('🔌 asdfbase との同期を解除しました。');
    return;
  }

  if (interaction.commandName === 'status') {
    const status = await getDiscordStatus();
    const lines = status.bindings.length > 0
      ? status.bindings.map(b => `• <#${b.discordChannelId}> ⇔ asdfbase #${b.asdfChannelName}`).join('\n')
      : '同期中のチャンネルはありません。`/setup` で設定できます。';
    await interaction.reply({ content: `**asdfbase 同期状態**\n${lines}${status.intentWarning ? `\n⚠️ ${status.intentWarning}` : ''}`, ephemeral: true });
  }
}

function isVideo(att: { contentType?: string | null; name?: string | null }) {
  return (att.contentType || '').startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(att.name || '');
}

function isImage(att: { contentType?: string | null; name?: string | null }) {
  return (att.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(att.name || '');
}

async function handleDiscordMessage(msg: DiscordMessage) {
  if (msg.guildId !== guildId) return;
  if (msg.author.bot || msg.webhookId) return; // 自分の転送を再取り込みしない
  const bindings = await getBindings();
  const targets = bindings.filter(b => b.discordChannelId === msg.channelId);
  if (targets.length === 0) return;

  const name = `[Discord] ${msg.member?.displayName || msg.author.globalName || msg.author.username}`;
  const parts: string[] = [];
  const text = msg.cleanContent?.trim();
  if (text) parts.push(text);

  for (const att of msg.attachments.values()) {
    if (isVideo(att)) {
      parts.push(VIDEO_NOTICE);
    } else if (isImage(att) && att.size <= 15 * 1024 * 1024) {
      try {
        const res = await fetch(att.url, { signal: AbortSignal.timeout(15000) });
        const buf = Buffer.from(await res.arrayBuffer());
        const url = await deps!.saveImage(buf);
        parts.push(`![image](${url})`);
      } catch (err: any) {
        console.error('[discord] image download failed:', err.message);
        parts.push(`(画像の取り込みに失敗しました: ${att.name})`);
      }
    } else {
      parts.push(`(ファイルが送信されています: ${att.name})`);
    }
  }
  for (const sticker of msg.stickers.values()) parts.push(`(スタンプ: ${sticker.name})`);
  if (msg.embeds.some(e => e.video)) parts.push(VIDEO_NOTICE);
  if (parts.length === 0) return;

  for (const t of targets) {
    // 画像は1枚ずつ別メッセージにする (asdfbase のチャット表示に合わせる)
    for (const p of parts) await deps!.ingest(t.asdfChannelId, name, p);
  }
}

// asdfbase のメッセージを連携先の Discord チャンネルへ送信。送信先が1つでもあれば true
export async function relayToDiscordBot(asdfChannelId: number, username: string, content: string): Promise<boolean> {
  if (!client || !connected || !deps) return false;
  const targets = (await getBindings()).filter(b => b.asdfChannelId === asdfChannelId);
  if (targets.length === 0) return false;

  const files: string[] = [];
  const text = content.replace(/!\[[^\]]*\]\((\/uploads\/[^)\s]+)\)/g, (_m, p: string) => {
    const filePath = path.join(deps!.uploadDir, path.basename(p));
    if (fs.existsSync(filePath)) files.push(filePath);
    return '';
  }).trim();
  const isVideoMsg = /\.(mp4|mov|webm|mkv)(\?|$)/i.test(content);

  const body = isVideoMsg ? VIDEO_NOTICE : text;
  const payload = {
    content: `**${username}**${body ? `: ${body}` : ''}`.slice(0, 2000),
    files: isVideoMsg ? [] : files,
    allowedMentions: { parse: [] as never[] },
  };

  let sent = false;
  for (const t of targets) {
    try {
      const ch = (await client.channels.fetch(t.discordChannelId)) as TextBasedChannel | null;
      if (ch && 'send' in ch && (ch as any).guildId === guildId) {
        await (ch as any).send(payload);
        sent = true;
      }
    } catch (err: any) {
      lastError = `送信失敗: ${err.message}`;
      console.error('[discord] relay failed:', err.message);
    }
  }
  return sent;
}

function createClient(withMessageContent: boolean) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (withMessageContent) intents.push(GatewayIntentBits.MessageContent);
  return new Client({
    intents,
    // VPS のメモリ節約のためキャッシュを最小限に
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      PresenceManager: 0,
      ReactionManager: 0,
      GuildMemberManager: 100,
      UserManager: 200,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
      VoiceStateManager: 0,
    }),
  });
}

export async function startDiscordBot(d: DiscordDeps) {
  deps = d;
  const token = process.env.DISCORD_BOT_TOKEN || '';
  guildId = process.env.DISCORD_GUILD_ID || '';
  if (!token || !guildId) {
    console.log('[discord] DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set — bot disabled');
    return;
  }

  const boot = async (withMessageContent: boolean) => {
    const c = createClient(withMessageContent);
    client = c;

    c.once(Events.ClientReady, async ready => {
      connected = true;
      lastError = '';
      console.log(`[discord] logged in as ${ready.user.tag}`);
      if (!ready.guilds.cache.has(guildId)) {
        lastError = `許可されたサーバーに Bot が参加していません。招待URL: https://discord.com/oauth2/authorize?client_id=${ready.user.id}&scope=bot+applications.commands&permissions=117760&guild_id=${guildId}&disable_guild_select=true`;
      }
      await refreshDiscordCommands();
    });
    c.on(Events.ShardDisconnect, () => {
      connected = false;
    });
    c.on(Events.ShardResume, () => {
      connected = true;
    });
    c.on(Events.ShardReady, () => {
      connected = true;
    });
    c.on(Events.Error, err => {
      lastError = err.message;
      console.error('[discord] client error:', err.message);
    });
    c.on(Events.MessageCreate, m => {
      handleDiscordMessage(m).catch(err => console.error('[discord] message handling failed:', err));
    });
    c.on(Events.InteractionCreate, i => {
      if (i.isChatInputCommand()) {
        handleCommand(i).catch(err => console.error('[discord] command failed:', err));
      }
    });
    c.on(Events.GuildCreate, g => {
      if (g.id !== guildId) {
        console.warn(`[discord] joined unauthorized guild ${g.name} (${g.id}) — ignoring`);
        return;
      }
      // 後から招待された場合もここでコマンドを登録
      lastError = '';
      refreshDiscordCommands();
    });

    try {
      await c.login(token);
    } catch (err: any) {
      connected = false;
      client = null;
      try { c.destroy(); } catch (_) {}
      if (withMessageContent && /disallowed intents/i.test(err.message)) {
        intentWarning = 'Developer Portal で「MESSAGE CONTENT INTENT」が無効のため、Discord → asdfbase の本文が取り込めません';
        console.warn('[discord] MessageContent intent not allowed, retrying without it');
        return boot(false);
      }
      lastError = `ログイン失敗: ${err.message}`;
      console.error('[discord] login failed:', err.message);
    }
  };

  await boot(true);
}

