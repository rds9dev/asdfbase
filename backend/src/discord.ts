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
  Partials,
  PermissionFlagsBits,
  ApplicationCommandOptionType,
  type Message as DiscordMessage,
  type PartialMessage,
  type ChatInputCommandInteraction,
  type TextBasedChannel,
  type ApplicationCommandDataResolvable,
} from 'discord.js';
import path from 'path';
import fs from 'fs';

export interface DiscordBinding {
  discordChannelId: string;
  asdfChannelId: number;
}

export interface DiscordIngestMeta {
  avatarUrl: string | null;
  discordChannelId: string;
  // 本文 (テキスト部分) のときだけ。あとで Discord 側の編集を反映するのに使う
  discordMessageId: string | null;
  replyToDiscordMsgId?: string | null;
}

// asdfbase → Discord に Bot が送ったメッセージ
export interface RelayedMessage {
  discordChannelId: string;
  discordMessageId: string;
}

export interface DiscordVoiceChannelInfo {
  guildName: string;
  channelName: string;
  channelId: string;
  members: { id: string; name: string; avatarUrl: string | null }[];
}

export interface DiscordDeps {
  getSetting: (key: string, fallback?: string) => Promise<string>;
  setSetting: (key: string, value: string) => Promise<void>;
  listAsdfChannels: () => Promise<{ id: number; name: string; type: string }[]>;
  // Discord から来たメッセージを asdfbase に保存・配信
  ingest: (asdfChannelId: number, username: string, content: string, meta: DiscordIngestMeta) => Promise<void>;
  // Discord 側でメッセージが編集された
  ingestEdit: (discordMessageId: string, content: string) => Promise<void>;
  // Discord 側でメッセージが削除された (取り消し線反映)
  ingestDelete?: (discordMessageId: string) => Promise<void>;
  // Discord 側でリアクション追加/削除
  ingestReaction?: (discordMessageId: string, emoji: string, discordUserId: string, action: 'add' | 'remove') => Promise<void>;
  // ピン留め一覧の同期
  syncPinsForChannel?: (discordChannelId: string, pinnedDiscordMsgIds: string[]) => Promise<void>;
  // Discord 側の入力中イベント
  onTyping?: (asdfChannelId: number, discordUserId: string, username: string) => void;
  // Discord の VC 参加状態の更新
  onVoiceStatusUpdate?: (vcs: DiscordVoiceChannelInfo[]) => void;
  // 重要通知 (@everyone / @here)
  notifyImportant?: (title: string, body: string) => void;
  // Discord の画像を保存して /uploads/... のパスを返す
  saveImage: (buf: Buffer) => Promise<string>;
  // Discord のファイルを保存して /uploads/... のパスを返す
  saveFile?: (buf: Buffer, originalName: string) => Promise<string>;
  // Discord のアイコンを (名前が同じなら使い回して) 保存し /uploads/... のパスを返す
  saveAvatar: (key: string, url: string) => Promise<string | null>;
  uploadDir: string;
  audit: (action: string, details: object) => void;
}

const BINDINGS_KEY = 'discord_bindings';
const VIDEO_NOTICE = '(動画が送信されています)';

let client: Client | null = null;
let deps: DiscordDeps | null = null;
let allowedGuildIds: string[] = [];
let connected = false;
let lastError = '';
let intentWarning = '';
let bindingsCache: DiscordBinding[] | null = null;

function isGuildAllowed(gid: string | null | undefined): boolean {
  return Boolean(gid && allowedGuildIds.includes(gid));
}

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
  const guildNames = allowedGuildIds
    .map(gid => client?.guilds.cache.get(gid)?.name)
    .filter(Boolean);
  return {
    enabled: Boolean(client),
    connected,
    botTag: client?.user?.tag || null,
    guildId: allowedGuildIds.join(','),
    guildName: guildNames.length > 0 ? guildNames.join(', ') : null,
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
  const channels = (await deps.listAsdfChannels()).filter(c => c.type !== 'voice').slice(0, 25);
  const commandDefs: ApplicationCommandDataResolvable[] = [
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
  ];
  for (const gid of allowedGuildIds) {
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;
    try {
      await guild.commands.set(commandDefs);
    } catch (err: any) {
      lastError = `コマンド登録失敗 (${gid}): ${err.message}`;
      console.error(`[discord] command registration failed for guild ${gid}:`, err.message);
    }
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (!isGuildAllowed(interaction.guildId)) {
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

function formatDiscordContent(content: string): string {
  if (!content) return '';
  let text = content;
  // カスタム絵文字 <:name:id> / <a:name:id> を Markdown 画像に変換
  text = text.replace(/<a:([a-zA-Z0-9_]+):([0-9]+)>/g, '![$1](https://cdn.discordapp.com/emojis/$2.gif?size=48&quality=lossless)');
  text = text.replace(/<:([a-zA-Z0-9_]+):([0-9]+)>/g, '![$1](https://cdn.discordapp.com/emojis/$2.webp?size=48&quality=lossless)');
  // @everyone / @here を強調
  text = text.replace(/@(everyone|here)\b/g, '**[@$1]**');
  return text;
}

function formatEmbeds(embeds: any[]): string[] {
  const parts: string[] = [];
  for (const e of embeds) {
    if (e.video) continue;
    const lines: string[] = [];
    const title = e.title?.trim();
    const url = e.url?.trim();
    if (title && url) {
      lines.push(`> 🔗 **[${title}](${url})**`);
    } else if (title) {
      lines.push(`> 🔗 **${title}**`);
    } else if (url) {
      lines.push(`> 🔗 <${url}>`);
    }
    if (e.description?.trim()) {
      const desc = e.description.trim().slice(0, 300);
      lines.push(`> ${desc.replace(/\n/g, '\n> ')}`);
    }
    if (e.image?.url) {
      lines.push(`> ![embed-image](${e.image.url})`);
    } else if (e.thumbnail?.url && !e.image) {
      lines.push(`> ![embed-thumb](${e.thumbnail.url})`);
    }
    if (lines.length > 0) {
      parts.push(lines.join('\n'));
    }
  }
  return parts;
}

export interface DiscordMemberInfo {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  activity: string | null;
  roles: string[];
}

export interface DiscordGuildStatus {
  enabled: boolean;
  connected: boolean;
  guildId: string | null;
  guildName: string | null;
  memberCount: number;
  onlineCount: number;
  members: DiscordMemberInfo[];
  voiceChannels: DiscordVoiceChannelInfo[];
}

export async function getDiscordGuildStatus(): Promise<DiscordGuildStatus> {
  if (!client || !connected || allowedGuildIds.length === 0) {
    return {
      enabled: Boolean(client),
      connected,
      guildId: null,
      guildName: null,
      memberCount: 0,
      onlineCount: 0,
      members: [],
      voiceChannels: [],
    };
  }

  const gid = allowedGuildIds[0];
  const guild = client.guilds.cache.get(gid);
  if (!guild) {
    return {
      enabled: true,
      connected: false,
      guildId: gid,
      guildName: null,
      memberCount: 0,
      onlineCount: 0,
      members: [],
      voiceChannels: [],
    };
  }

  // メンバーの取得
  let members: DiscordMemberInfo[] = [];
  try {
    const fetched = await guild.members.fetch({ time: 5000 }).catch(() => guild.members.cache);
    members = Array.from(fetched.values()).map(m => {
      const presence = m.presence;
      const status = presence?.status || 'offline';
      const acts = presence?.activities || [];
      const gameAct = acts.find(a => a.type === 0 || a.type === 1 || a.type === 2);
      const activityText = gameAct ? `${gameAct.name}${gameAct.details ? `: ${gameAct.details}` : ''}` : null;

      return {
        id: m.id,
        username: m.user.username,
        displayName: m.displayName || m.user.globalName || m.user.username,
        avatarUrl: m.displayAvatarURL({ extension: 'png', size: 64 }),
        status: status as any,
        activity: activityText,
        roles: m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).slice(0, 5),
      };
    });
  } catch (_) {
    // フォールバック: キャッシュから
    members = Array.from(guild.members.cache.values()).map(m => ({
      id: m.id,
      username: m.user.username,
      displayName: m.displayName || m.user.username,
      avatarUrl: m.displayAvatarURL({ extension: 'png', size: 64 }),
      status: (m.presence?.status || 'offline') as any,
      activity: null,
      roles: [],
    }));
  }

  const onlineMembers = members.filter(m => m.status !== 'offline');

  return {
    enabled: true,
    connected: true,
    guildId: guild.id,
    guildName: guild.name,
    memberCount: guild.memberCount || members.length,
    onlineCount: onlineMembers.length,
    members: members.slice(0, 50),
    voiceChannels: getDiscordVoiceStatus(),
  };
}

export function getDiscordVoiceStatus(): DiscordVoiceChannelInfo[] {
  if (!client || !connected) return [];
  const result: DiscordVoiceChannelInfo[] = [];
  for (const gid of allowedGuildIds) {
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;
    for (const channel of guild.channels.cache.values()) {
      if (channel.isVoiceBased()) {
        const members = Array.from(channel.members.values()).map(m => ({
          id: m.id,
          name: m.displayName || m.user.globalName || m.user.username,
          avatarUrl: m.displayAvatarURL({ extension: 'png', size: 64 }),
        }));
        if (members.length > 0) {
          result.push({
            guildName: guild.name,
            channelName: channel.name,
            channelId: channel.id,
            members,
          });
        }
      }
    }
  }
  return result;
}

function isVideo(att: { contentType?: string | null; name?: string | null }) {
  return (att.contentType || '').startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(att.name || '');
}

function isImage(att: { contentType?: string | null; name?: string | null }) {
  return (att.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(att.name || '');
}

// サーバーアイコン > ユーザーアイコン の順。アイコンが変わったら別ファイルになる
async function avatarFor(msg: DiscordMessage): Promise<string | null> {
  try {
    const hash = msg.member?.avatar || msg.author.avatar || 'default';
    const url = msg.member?.displayAvatarURL({ extension: 'png', size: 128 }) || msg.author.displayAvatarURL({ extension: 'png', size: 128 });
    return await deps!.saveAvatar(`${msg.author.id}-${hash}`, url);
  } catch (err: any) {
    console.error('[discord] avatar save failed:', err.message);
    return null;
  }
}

async function handleDiscordMessage(msg: DiscordMessage) {
  if (!isGuildAllowed(msg.guildId)) return;
  if (msg.author.bot || msg.webhookId) return; // 自分の転送を再取り込みしない
  const bindings = await getBindings();
  const targets = bindings.filter(b => b.discordChannelId === msg.channelId);
  if (targets.length === 0) return;

  const name = `[Discord] ${msg.member?.displayName || msg.author.globalName || msg.author.username}`;
  const avatarUrl = await avatarFor(msg);
  const parts: string[] = [];
  const rawText = msg.cleanContent?.trim();
  const text = rawText ? formatDiscordContent(rawText) : '';
  if (text) parts.push(text);

  // @everyone / @here 通知
  if (msg.mentions.everyone || /@everyone|@here/.test(msg.content)) {
    const chName = (msg.channel as any)?.name || 'channel';
    deps?.notifyImportant?.(`📢 Discord #${chName} で全体メンション`, `**${name}**: ${text || '(添付ファイル)'}`);
  }

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
      // 一般ファイル (PDF, txt, zip, 音声等)
      if (att.size <= 25 * 1024 * 1024 && deps?.saveFile) {
        try {
          const res = await fetch(att.url, { signal: AbortSignal.timeout(20000) });
          const buf = Buffer.from(await res.arrayBuffer());
          const url = await deps.saveFile(buf, att.name || 'file');
          parts.push(`[📎 ${att.name || '添付ファイル'}](${url})`);
        } catch (err: any) {
          console.error('[discord] file download failed:', err.message);
          parts.push(`(ファイルの取り込みに失敗しました: ${att.name})`);
        }
      } else {
        parts.push(`[📎 ${att.name || '添付ファイル'}](${att.url})`);
      }
    }
  }
  for (const sticker of msg.stickers.values()) parts.push(`(スタンプ: ${sticker.name})`);
  if (msg.embeds.some(e => e.video)) parts.push(VIDEO_NOTICE);

  // Embed (URLプレビュー等) のテキスト追加
  const embedTexts = formatEmbeds(msg.embeds);
  if (embedTexts.length > 0) {
    if (parts.length > 0) {
      parts[0] = `${parts[0]}\n\n${embedTexts.join('\n\n')}`;
    } else {
      parts.push(embedTexts.join('\n\n'));
    }
  }

  if (parts.length === 0) return;

  const replyToDiscordMsgId = msg.reference?.messageId || null;

  for (const t of targets) {
    for (let i = 0; i < parts.length; i++) {
      await deps!.ingest(t.asdfChannelId, name, parts[i], {
        avatarUrl,
        discordChannelId: msg.channelId,
        discordMessageId: i === 0 && text ? msg.id : null,
        replyToDiscordMsgId: i === 0 ? replyToDiscordMsgId : null,
      });
    }
  }
}

// Discord 側の編集: 本文が変わっていれば asdfbase の該当メッセージも書き換える
async function handleDiscordEdit(msg: DiscordMessage | PartialMessage) {
  if (!isGuildAllowed(msg.guildId)) return;
  const full = msg.partial ? await msg.fetch().catch(() => null) : msg;
  if (!full || full.author.bot || full.webhookId) return;
  const bindings = await getBindings();
  if (!bindings.some(b => b.discordChannelId === full.channelId)) return;
  const rawText = full.cleanContent?.trim() || '';
  let text = rawText ? formatDiscordContent(rawText) : '';
  const embedTexts = formatEmbeds(full.embeds);
  if (embedTexts.length > 0) {
    text = text ? `${text}\n\n${embedTexts.join('\n\n')}` : embedTexts.join('\n\n');
  }
  if (!text) return;
  await deps!.ingestEdit(full.id, text);
}

// asdfbase のメッセージを連携先の Discord チャンネルへ送信。送った Discord メッセージを返す (空なら未送信)
export async function relayToDiscordBot(
  asdfChannelId: number,
  username: string,
  content: string,
  replyTargetDiscordMessageId?: string | null
): Promise<RelayedMessage[]> {
  if (!client || !connected || !deps) return [];
  const targets = (await getBindings()).filter(b => b.asdfChannelId === asdfChannelId);
  if (targets.length === 0) return [];

  const files: string[] = [];
  const text = content.replace(/!\[[^\]]*\]\((\/uploads\/[^)\s]+)\)/g, (_m, p: string) => {
    const filePath = path.join(deps!.uploadDir, path.basename(p));
    if (fs.existsSync(filePath)) files.push(filePath);
    return '';
  }).trim();
  const isVideoMsg = /\.(mp4|mov|webm|mkv)(\?|$)/i.test(content);

  const body = isVideoMsg ? VIDEO_NOTICE : text;
  const payload: any = {
    content: `**${username}**${body ? `: ${body}` : ''}`.slice(0, 2000),
    files: isVideoMsg ? [] : files,
    allowedMentions: { parse: [] as never[] },
  };
  if (replyTargetDiscordMessageId) {
    payload.reply = { messageReference: replyTargetDiscordMessageId, failIfNotExists: false };
  }

  const sent: RelayedMessage[] = [];
  for (const t of targets) {
    try {
      const ch = (await client.channels.fetch(t.discordChannelId)) as TextBasedChannel | null;
      if (ch && 'send' in ch && isGuildAllowed((ch as any).guildId)) {
        const m = await (ch as any).send(payload);
        sent.push({ discordChannelId: t.discordChannelId, discordMessageId: m.id });
      }
    } catch (err: any) {
      lastError = `送信失敗: ${err.message}`;
      console.error('[discord] relay failed:', err.message);
    }
  }
  return sent;
}

// asdfbase で付けられたリアクションを Discord に反映
export async function relayReactionToDiscord(discordChannelId: string, discordMessageId: string, emoji: string, isRemove = false) {
  if (!client || !connected) return;
  try {
    const ch = (await client.channels.fetch(discordChannelId)) as TextBasedChannel | null;
    if (!ch || !('messages' in ch) || !isGuildAllowed((ch as any).guildId)) return;
    const msg = await (ch as any).messages.fetch(discordMessageId).catch(() => null);
    if (!msg) return;
    if (isRemove) {
      const r = msg.reactions.resolve(emoji);
      if (r && client.user) {
        await r.users.remove(client.user.id).catch(() => {});
      }
    } else {
      await msg.react(emoji).catch(() => {});
    }
  } catch (err: any) {
    console.warn('[discord] relayReaction failed:', err.message);
  }
}

// asdfbase でピン留めされた状態を Discord に反映
export async function relayPinToDiscord(discordChannelId: string, discordMessageId: string, isPinned: boolean) {
  if (!client || !connected) return;
  try {
    const ch = (await client.channels.fetch(discordChannelId)) as TextBasedChannel | null;
    if (!ch || !('messages' in ch) || !isGuildAllowed((ch as any).guildId)) return;
    const msg = await (ch as any).messages.fetch(discordMessageId).catch(() => null);
    if (!msg) return;
    if (isPinned) {
      if (!msg.pinned) await msg.pin().catch(() => {});
    } else {
      if (msg.pinned) await msg.unpin().catch(() => {});
    }
  } catch (err: any) {
    console.warn('[discord] relayPin failed:', err.message);
  }
}

// Bot が送ったメッセージを編集 (Discord 側にも「編集済み」が付く)。1つでも編集できれば true
export async function editRelayedOnDiscord(links: RelayedMessage[], username: string, content: string): Promise<boolean> {
  if (!client || !connected || links.length === 0) return false;
  const body = content.replace(/!\[[^\]]*\]\((\/uploads\/[^)\s]+)\)/g, '').trim();
  let edited = false;
  for (const l of links) {
    try {
      const ch = (await client.channels.fetch(l.discordChannelId)) as TextBasedChannel | null;
      if (!ch || !('messages' in ch) || !isGuildAllowed((ch as any).guildId)) continue;
      const m = await (ch as any).messages.fetch(l.discordMessageId);
      await m.edit({ content: `**${username}**${body ? `: ${body}` : ''}`.slice(0, 2000), allowedMentions: { parse: [] } });
      edited = true;
    } catch (err: any) {
      lastError = `編集の反映に失敗: ${err.message}`;
      console.error('[discord] edit relay failed:', err.message);
    }
  }
  return edited;
}

function createClient(_withMessageContent: boolean) {
  // 特権インテント (GuildMembers, GuildPresences, MessageContent) を全て有効化
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ];
  return new Client({
    intents,
    // キャッシュしていないメッセージの編集・リアクションも受け取る
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      PresenceManager: 200,
      ReactionManager: 0,
      GuildMemberManager: 200,
      UserManager: 200,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
      VoiceStateManager: 50,
    }),
  });
}

export async function startDiscordBot(d: DiscordDeps) {
  deps = d;
  const token = process.env.DISCORD_BOT_TOKEN || '';
  const rawGuilds = process.env.DISCORD_GUILD_IDS || process.env.DISCORD_GUILD_ID || '';
  allowedGuildIds = rawGuilds.split(',').map(s => s.trim()).filter(Boolean);
  if (!token || allowedGuildIds.length === 0) {
    console.log('[discord] DISCORD_BOT_TOKEN / DISCORD_GUILD_ID(S) not set — bot disabled');
    return;
  }

  const boot = async (withMessageContent: boolean) => {
    const c = createClient(withMessageContent);
    client = c;

    c.once(Events.ClientReady, async ready => {
      connected = true;
      lastError = '';
      console.log(`[discord] logged in as ${ready.user.tag}`);
      const missing = allowedGuildIds.filter(gid => !ready.guilds.cache.has(gid));
      if (missing.length > 0) {
        lastError = `許可されたサーバーの一部に Bot が参加していません: ${missing.join(', ')}`;
      }
      await refreshDiscordCommands();
      if (deps?.onVoiceStatusUpdate) {
        deps.onVoiceStatusUpdate(getDiscordVoiceStatus());
      }
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
    c.on(Events.MessageUpdate, (_old, m) => {
      handleDiscordEdit(m).catch(err => console.error('[discord] edit handling failed:', err));
    });
    c.on(Events.MessageDelete, m => {
      try {
        if (m.guildId && !isGuildAllowed(m.guildId)) return;
        if (deps?.ingestDelete) {
          deps.ingestDelete(m.id).catch(err => console.error('[discord] delete handling failed:', err));
        }
      } catch (err: any) {
        console.error('[discord] delete error:', err.message);
      }
    });
    c.on(Events.MessageReactionAdd, async (reaction, user) => {
      try {
        if (user.bot) return;
        const fullMsg = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
        if (!fullMsg || !isGuildAllowed(fullMsg.guildId)) return;
        const emoji = reaction.emoji.name;
        if (!emoji || !deps?.ingestReaction) return;
        await deps.ingestReaction(fullMsg.id, emoji, user.id, 'add');
      } catch (err: any) {
        console.error('[discord] reactionAdd failed:', err.message);
      }
    });
    c.on(Events.MessageReactionRemove, async (reaction, user) => {
      try {
        if (user.bot) return;
        const fullMsg = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
        if (!fullMsg || !isGuildAllowed(fullMsg.guildId)) return;
        const emoji = reaction.emoji.name;
        if (!emoji || !deps?.ingestReaction) return;
        await deps.ingestReaction(fullMsg.id, emoji, user.id, 'remove');
      } catch (err: any) {
        console.error('[discord] reactionRemove failed:', err.message);
      }
    });
    c.on(Events.ChannelPinsUpdate, async channel => {
      try {
        if (!('guildId' in channel) || !isGuildAllowed((channel as any).guildId)) return;
        if (!deps?.syncPinsForChannel) return;
        const textCh = channel as any;
        if (typeof textCh.messages?.fetchPinned === 'function') {
          const pinnedMessages = await textCh.messages.fetchPinned().catch(() => null);
          if (pinnedMessages) {
            const pinnedIds = Array.from(pinnedMessages.keys()) as string[];
            await deps.syncPinsForChannel(channel.id, pinnedIds);
          }
        }
      } catch (err: any) {
        console.error('[discord] pinsUpdate failed:', err.message);
      }
    });
    c.on(Events.VoiceStateUpdate, (_oldState, newState) => {
      if (!isGuildAllowed(newState.guild?.id)) return;
      if (deps?.onVoiceStatusUpdate) {
        deps.onVoiceStatusUpdate(getDiscordVoiceStatus());
      }
    });
    c.on(Events.TypingStart, async typing => {
      try {
        if (!isGuildAllowed(typing.guild?.id)) return;
        if (typing.user?.bot) return;
        if (!deps?.onTyping) return;
        const targets = (await getBindings()).filter(b => b.discordChannelId === typing.channel.id);
        if (targets.length === 0) return;
        const username = `[Discord] ${typing.member?.displayName || typing.user?.globalName || typing.user?.username || 'ユーザー'}`;
        for (const t of targets) {
          deps.onTyping(t.asdfChannelId, typing.user.id, username);
        }
      } catch (err: any) {
        console.error('[discord] typing handling failed:', err.message);
      }
    });
    c.on(Events.InteractionCreate, i => {
      if (i.isChatInputCommand()) {
        handleCommand(i).catch(err => console.error('[discord] command failed:', err));
      }
    });
    c.on(Events.GuildCreate, g => {
      if (!isGuildAllowed(g.id)) {
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

