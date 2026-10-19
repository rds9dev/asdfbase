"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBoundAsdfChannelIds = getBoundAsdfChannelIds;
exports.isDiscordBotConfigured = isDiscordBotConfigured;
exports.getDiscordStatus = getDiscordStatus;
exports.refreshDiscordCommands = refreshDiscordCommands;
exports.relayToDiscordBot = relayToDiscordBot;
exports.startDiscordBot = startDiscordBot;
// Discord Bot 連携
// - 許可されたサーバー (DISCORD_GUILD_ID) 以外では一切動作しない
// - /setup で「この Discord チャンネル ⇔ asdfbase チャンネル」を連携
// - asdfbase → Discord: Bot がメッセージと画像を送信
// - Discord → asdfbase: メッセージと画像を取り込み (動画は送らず「(動画が送信されています)」表示)
const discord_js_1 = require("discord.js");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const BINDINGS_KEY = 'discord_bindings';
const VIDEO_NOTICE = '(動画が送信されています)';
let client = null;
let deps = null;
let guildId = '';
let connected = false;
let lastError = '';
let intentWarning = '';
let bindingsCache = null;
async function getBindings() {
    if (bindingsCache)
        return bindingsCache;
    try {
        const raw = await deps.getSetting(BINDINGS_KEY, '[]');
        const parsed = JSON.parse(raw);
        bindingsCache = Array.isArray(parsed) ? parsed : [];
    }
    catch {
        bindingsCache = [];
    }
    return bindingsCache;
}
async function saveBindings(list) {
    bindingsCache = list;
    await deps.setSetting(BINDINGS_KEY, JSON.stringify(list));
}
// Bot で Discord に同期している asdfbase チャンネル
async function getBoundAsdfChannelIds() {
    if (!client || !deps)
        return [];
    return [...new Set((await getBindings()).map(b => b.asdfChannelId))];
}
function isDiscordBotConfigured() {
    return Boolean(client);
}
async function getDiscordStatus() {
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
            const ch = client?.channels.cache.get(b.discordChannelId);
            return {
                ...b,
                discordChannelName: ch?.name || b.discordChannelId,
                asdfChannelName: channels.find(c => c.id === b.asdfChannelId)?.name || String(b.asdfChannelId),
            };
        }),
    };
}
// /setup のチャンネル選択肢を asdfbase のチャンネル一覧で更新
async function refreshDiscordCommands() {
    if (!client || !connected || !deps)
        return;
    const guild = client.guilds.cache.get(guildId);
    if (!guild)
        return;
    const channels = (await deps.listAsdfChannels()).filter(c => c.type !== 'voice').slice(0, 25);
    try {
        await guild.commands.set([
            {
                name: 'setup',
                description: 'このチャンネルを asdfbase のチャンネルと同期します',
                defaultMemberPermissions: discord_js_1.PermissionFlagsBits.ManageChannels,
                options: [
                    {
                        name: 'channel',
                        description: '同期する asdfbase のチャンネル',
                        type: discord_js_1.ApplicationCommandOptionType.String,
                        required: true,
                        choices: channels.map(c => ({ name: `#${c.name}`, value: String(c.id) })),
                    },
                ],
            },
            {
                name: 'unsetup',
                description: 'このチャンネルの asdfbase 同期を解除します',
                defaultMemberPermissions: discord_js_1.PermissionFlagsBits.ManageChannels,
            },
            {
                name: 'status',
                description: 'asdfbase との同期状態を表示します',
            },
        ]);
    }
    catch (err) {
        lastError = `コマンド登録失敗: ${err.message}`;
        console.error('[discord] command registration failed:', err.message);
    }
}
async function handleCommand(interaction) {
    if (interaction.guildId !== guildId) {
        await interaction.reply({ content: 'このサーバーでは利用できません。', ephemeral: true });
        return;
    }
    const bindings = await getBindings();
    if (interaction.commandName === 'setup') {
        const asdfChannelId = parseInt(interaction.options.getString('channel', true), 10);
        const channels = await deps.listAsdfChannels();
        const target = channels.find(c => c.id === asdfChannelId);
        if (!target) {
            await interaction.reply({ content: 'asdfbase のチャンネルが見つかりません。', ephemeral: true });
            return;
        }
        const next = bindings.filter(b => b.discordChannelId !== interaction.channelId);
        next.push({ discordChannelId: interaction.channelId, asdfChannelId });
        await saveBindings(next);
        deps.audit('discord_setup', {
            message: `Discord #${interaction.channel?.name || interaction.channelId} ⇔ asdfbase #${target.name} を同期設定`,
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
        deps.audit('discord_unsetup', {
            message: `Discord #${interaction.channel?.name || interaction.channelId} の同期を解除`,
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
function isVideo(att) {
    return (att.contentType || '').startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(att.name || '');
}
function isImage(att) {
    return (att.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(att.name || '');
}
async function handleDiscordMessage(msg) {
    if (msg.guildId !== guildId)
        return;
    if (msg.author.bot || msg.webhookId)
        return; // 自分の転送を再取り込みしない
    const bindings = await getBindings();
    const targets = bindings.filter(b => b.discordChannelId === msg.channelId);
    if (targets.length === 0)
        return;
    const name = `[Discord] ${msg.member?.displayName || msg.author.globalName || msg.author.username}`;
    const parts = [];
    const text = msg.cleanContent?.trim();
    if (text)
        parts.push(text);
    for (const att of msg.attachments.values()) {
        if (isVideo(att)) {
            parts.push(VIDEO_NOTICE);
        }
        else if (isImage(att) && att.size <= 15 * 1024 * 1024) {
            try {
                const res = await fetch(att.url, { signal: AbortSignal.timeout(15000) });
                const buf = Buffer.from(await res.arrayBuffer());
                const url = await deps.saveImage(buf);
                parts.push(`![image](${url})`);
            }
            catch (err) {
                console.error('[discord] image download failed:', err.message);
                parts.push(`(画像の取り込みに失敗しました: ${att.name})`);
            }
        }
        else {
            parts.push(`(ファイルが送信されています: ${att.name})`);
        }
    }
    for (const sticker of msg.stickers.values())
        parts.push(`(スタンプ: ${sticker.name})`);
    if (msg.embeds.some(e => e.video))
        parts.push(VIDEO_NOTICE);
    if (parts.length === 0)
        return;
    for (const t of targets) {
        // 画像は1枚ずつ別メッセージにする (asdfbase のチャット表示に合わせる)
        for (const p of parts)
            await deps.ingest(t.asdfChannelId, name, p);
    }
}
// asdfbase のメッセージを連携先の Discord チャンネルへ送信。送信先が1つでもあれば true
async function relayToDiscordBot(asdfChannelId, username, content) {
    if (!client || !connected || !deps)
        return false;
    const targets = (await getBindings()).filter(b => b.asdfChannelId === asdfChannelId);
    if (targets.length === 0)
        return false;
    const files = [];
    const text = content.replace(/!\[[^\]]*\]\((\/uploads\/[^)\s]+)\)/g, (_m, p) => {
        const filePath = path_1.default.join(deps.uploadDir, path_1.default.basename(p));
        if (fs_1.default.existsSync(filePath))
            files.push(filePath);
        return '';
    }).trim();
    const isVideoMsg = /\.(mp4|mov|webm|mkv)(\?|$)/i.test(content);
    const body = isVideoMsg ? VIDEO_NOTICE : text;
    const payload = {
        content: `**${username}**${body ? `: ${body}` : ''}`.slice(0, 2000),
        files: isVideoMsg ? [] : files,
        allowedMentions: { parse: [] },
    };
    let sent = false;
    for (const t of targets) {
        try {
            const ch = (await client.channels.fetch(t.discordChannelId));
            if (ch && 'send' in ch && ch.guildId === guildId) {
                await ch.send(payload);
                sent = true;
            }
        }
        catch (err) {
            lastError = `送信失敗: ${err.message}`;
            console.error('[discord] relay failed:', err.message);
        }
    }
    return sent;
}
function createClient(withMessageContent) {
    const intents = [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildMessages];
    if (withMessageContent)
        intents.push(discord_js_1.GatewayIntentBits.MessageContent);
    return new discord_js_1.Client({
        intents,
        // VPS のメモリ節約のためキャッシュを最小限に
        makeCache: discord_js_1.Options.cacheWithLimits({
            ...discord_js_1.Options.DefaultMakeCacheSettings,
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
async function startDiscordBot(d) {
    deps = d;
    const token = process.env.DISCORD_BOT_TOKEN || '';
    guildId = process.env.DISCORD_GUILD_ID || '';
    if (!token || !guildId) {
        console.log('[discord] DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set — bot disabled');
        return;
    }
    const boot = async (withMessageContent) => {
        const c = createClient(withMessageContent);
        client = c;
        c.once(discord_js_1.Events.ClientReady, async (ready) => {
            connected = true;
            lastError = '';
            console.log(`[discord] logged in as ${ready.user.tag}`);
            if (!ready.guilds.cache.has(guildId)) {
                lastError = `許可されたサーバーに Bot が参加していません。招待URL: https://discord.com/oauth2/authorize?client_id=${ready.user.id}&scope=bot+applications.commands&permissions=117760&guild_id=${guildId}&disable_guild_select=true`;
            }
            await refreshDiscordCommands();
        });
        c.on(discord_js_1.Events.ShardDisconnect, () => {
            connected = false;
        });
        c.on(discord_js_1.Events.ShardResume, () => {
            connected = true;
        });
        c.on(discord_js_1.Events.ShardReady, () => {
            connected = true;
        });
        c.on(discord_js_1.Events.Error, err => {
            lastError = err.message;
            console.error('[discord] client error:', err.message);
        });
        c.on(discord_js_1.Events.MessageCreate, m => {
            handleDiscordMessage(m).catch(err => console.error('[discord] message handling failed:', err));
        });
        c.on(discord_js_1.Events.InteractionCreate, i => {
            if (i.isChatInputCommand()) {
                handleCommand(i).catch(err => console.error('[discord] command failed:', err));
            }
        });
        c.on(discord_js_1.Events.GuildCreate, g => {
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
        }
        catch (err) {
            connected = false;
            client = null;
            try {
                c.destroy();
            }
            catch (_) { }
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
