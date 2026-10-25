"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveDiscordGuild = approveDiscordGuild;
exports.removeApprovedDiscordGuild = removeApprovedDiscordGuild;
exports.addDiscordBinding = addDiscordBinding;
exports.removeDiscordBinding = removeDiscordBinding;
exports.getBoundAsdfChannelIds = getBoundAsdfChannelIds;
exports.isDiscordBotConfigured = isDiscordBotConfigured;
exports.getDiscordStatus = getDiscordStatus;
exports.refreshDiscordCommands = refreshDiscordCommands;
exports.getDiscordServers = getDiscordServers;
exports.getDiscordGuildStatus = getDiscordGuildStatus;
exports.getDiscordVoiceStatus = getDiscordVoiceStatus;
exports.syncDiscordHistory = syncDiscordHistory;
exports.relayToDiscordBot = relayToDiscordBot;
exports.relayReactionToDiscord = relayReactionToDiscord;
exports.relayPinToDiscord = relayPinToDiscord;
exports.editRelayedOnDiscord = editRelayedOnDiscord;
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
const APPROVED_GUILDS_KEY = 'discord_approved_guilds';
const VIDEO_NOTICE = '(動画が送信されています)';
let client = null;
let deps = null;
let envGuildIds = [];
let approvedGuildIds = [];
let allowedGuildIds = [];
let connected = false;
let lastError = '';
let intentWarning = '';
let bindingsCache = null;
function rebuildAllowedGuildIds() {
    allowedGuildIds = Array.from(new Set([...envGuildIds, ...approvedGuildIds]));
}
function isGuildAllowed(gid) {
    return Boolean(gid && allowedGuildIds.includes(gid));
}
async function loadApprovedGuilds() {
    if (!deps)
        return;
    try {
        const raw = await deps.getSetting(APPROVED_GUILDS_KEY, '[]');
        const parsed = JSON.parse(raw);
        approvedGuildIds = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    }
    catch {
        approvedGuildIds = [];
    }
    rebuildAllowedGuildIds();
}
async function approveDiscordGuild(guildId) {
    if (!deps)
        return;
    await loadApprovedGuilds();
    if (!approvedGuildIds.includes(guildId)) {
        approvedGuildIds.push(guildId);
        await deps.setSetting(APPROVED_GUILDS_KEY, JSON.stringify(approvedGuildIds));
    }
    rebuildAllowedGuildIds();
    await refreshDiscordCommands();
}
async function removeApprovedDiscordGuild(guildId) {
    if (!deps)
        return;
    await loadApprovedGuilds();
    approvedGuildIds = approvedGuildIds.filter(id => id !== guildId);
    await deps.setSetting(APPROVED_GUILDS_KEY, JSON.stringify(approvedGuildIds));
    rebuildAllowedGuildIds();
}
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
async function addDiscordBinding(discordChannelId, asdfChannelId, guildId) {
    const bindings = await getBindings();
    const ch = client?.channels.cache.get(discordChannelId);
    const resolvedGuildId = guildId || ch?.guildId || undefined;
    const next = bindings.filter(b => b.discordChannelId !== discordChannelId && b.asdfChannelId !== asdfChannelId);
    next.push({ discordChannelId, asdfChannelId, guildId: resolvedGuildId });
    await saveBindings(next);
    if (resolvedGuildId && deps?.assignChannelServer) {
        await deps.assignChannelServer(asdfChannelId, resolvedGuildId).catch(() => { });
    }
    return next;
}
async function removeDiscordBinding(filter) {
    const bindings = await getBindings();
    const next = bindings.filter(b => {
        if (filter.discordChannelId && filter.asdfChannelId) {
            return !(b.discordChannelId === filter.discordChannelId && b.asdfChannelId === filter.asdfChannelId);
        }
        if (filter.discordChannelId)
            return b.discordChannelId !== filter.discordChannelId;
        if (filter.asdfChannelId)
            return b.asdfChannelId !== filter.asdfChannelId;
        return true;
    });
    const removed = bindings.length - next.length;
    if (removed > 0) {
        await saveBindings(next);
    }
    return removed;
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
    const guildNames = allowedGuildIds
        .map(gid => client?.guilds.cache.get(gid)?.name)
        .filter(Boolean);
    const botClientId = client?.user?.id || process.env.DISCORD_CLIENT_ID || null;
    const inviteUrl = botClientId
        ? `https://discord.com/api/oauth2/authorize?client_id=${botClientId}&permissions=274878294080&scope=bot%20applications.commands`
        : null;
    return {
        enabled: Boolean(client),
        connected,
        botTag: client?.user?.tag || null,
        botClientId,
        inviteUrl,
        guildId: allowedGuildIds.join(','),
        guildName: guildNames.length > 0 ? guildNames.join(', ') : null,
        intentWarning,
        lastError,
        bindings: bindings
            .filter(b => !connected || !client || client.channels.cache.has(b.discordChannelId))
            .map(b => {
            const ch = client?.channels.cache.get(b.discordChannelId);
            const gId = b.guildId || ch?.guildId || null;
            const gName = gId ? client?.guilds.cache.get(gId)?.name || null : null;
            return {
                ...b,
                guildId: gId,
                guildName: gName,
                discordGuildName: gName,
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
    const channels = (await deps.listAsdfChannels()).filter(c => c.type !== 'voice').slice(0, 25);
    const commandDefs = [
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
    ];
    for (const gid of allowedGuildIds) {
        const guild = client.guilds.cache.get(gid);
        if (!guild)
            continue;
        try {
            await guild.commands.set(commandDefs);
        }
        catch (err) {
            lastError = `コマンド登録失敗 (${gid}): ${err.message}`;
            console.error(`[discord] command registration failed for guild ${gid}:`, err.message);
        }
    }
}
async function handleCommand(interaction) {
    if (!isGuildAllowed(interaction.guildId)) {
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
        const next = bindings.filter(b => b.discordChannelId !== interaction.channelId && b.asdfChannelId !== asdfChannelId);
        next.push({ discordChannelId: interaction.channelId, asdfChannelId, guildId: interaction.guildId || undefined });
        await saveBindings(next);
        if (interaction.guildId && deps?.assignChannelServer) {
            await deps.assignChannelServer(asdfChannelId, interaction.guildId).catch(() => { });
        }
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
function formatDiscordContent(content) {
    if (!content)
        return '';
    let text = content;
    // カスタム絵文字 <:name:id> / <a:name:id> を Markdown 画像に変換
    text = text.replace(/<a:([a-zA-Z0-9_]+):([0-9]+)>/g, '![$1](https://cdn.discordapp.com/emojis/$2.gif?size=48&quality=lossless)');
    text = text.replace(/<:([a-zA-Z0-9_]+):([0-9]+)>/g, '![$1](https://cdn.discordapp.com/emojis/$2.webp?size=48&quality=lossless)');
    // @everyone / @here を強調
    text = text.replace(/@(everyone|here)\b/g, '**[@$1]**');
    return text;
}
function formatEmbeds(embeds) {
    const parts = [];
    for (const e of embeds) {
        if (e.video)
            continue;
        const lines = [];
        const title = e.title?.trim();
        const url = e.url?.trim();
        if (title && url) {
            lines.push(`> 🔗 **[${title}](${url})**`);
        }
        else if (title) {
            lines.push(`> 🔗 **${title}**`);
        }
        else if (url) {
            lines.push(`> 🔗 <${url}>`);
        }
        if (e.description?.trim()) {
            const desc = e.description.trim().slice(0, 300);
            lines.push(`> ${desc.replace(/\n/g, '\n> ')}`);
        }
        if (e.image?.url) {
            lines.push(`> ![embed-image](${e.image.url})`);
        }
        else if (e.thumbnail?.url && !e.image) {
            lines.push(`> ![embed-thumb](${e.thumbnail.url})`);
        }
        if (lines.length > 0) {
            parts.push(lines.join('\n'));
        }
    }
    return parts;
}
async function resolveGuildIcon(guild) {
    if (!guild?.icon)
        return null;
    const rawUrl = guild.iconURL({ extension: 'png', size: 128 });
    if (!rawUrl)
        return null;
    if (deps?.saveAvatar) {
        const saved = await deps.saveAvatar(`guild-${guild.id}-${guild.icon}`, rawUrl).catch(() => null);
        if (saved)
            return saved;
    }
    return `/api/proxy/media?url=${encodeURIComponent(rawUrl)}`;
}
async function resolveMemberAvatar(m) {
    try {
        const hash = m.avatar || m.user?.avatar || 'default';
        const rawUrl = m.displayAvatarURL({ extension: 'png', size: 64 });
        if (!rawUrl)
            return null;
        if (deps?.saveAvatar) {
            const saved = await deps.saveAvatar(`member-${m.id}-${hash}`, rawUrl).catch(() => null);
            if (saved)
                return saved;
        }
        return `/api/proxy/media?url=${encodeURIComponent(rawUrl)}`;
    }
    catch {
        return null;
    }
}
async function getDiscordServers(includeUnapproved = false) {
    if (!client || !connected)
        return [];
    const bindings = deps ? await getBindings() : [];
    const servers = [];
    for (const guild of client.guilds.cache.values()) {
        const approved = isGuildAllowed(guild.id);
        if (!includeUnapproved && !approved)
            continue;
        const iconUrl = await resolveGuildIcon(guild);
        // ボイスチャンネル情報
        const voiceChannels = [];
        const voiceMemberIds = new Set();
        const speakingMemberIds = new Set();
        for (const channel of guild.channels.cache.values()) {
            if (channel.isVoiceBased()) {
                const rawMembers = Array.from(channel.members.values());
                const vcMembers = await Promise.all(rawMembers.map(async (m) => {
                    const muted = Boolean(m.voice?.mute || m.voice?.selfMute || m.voice?.serverMute);
                    const deafened = Boolean(m.voice?.deaf || m.voice?.selfDeaf || m.voice?.serverDeaf);
                    const speaking = !muted && !deafened;
                    const streaming = Boolean(m.voice?.streaming);
                    const video = Boolean(m.voice?.selfVideo);
                    voiceMemberIds.add(m.id);
                    if (speaking)
                        speakingMemberIds.add(m.id);
                    return {
                        id: m.id,
                        name: m.displayName || m.user.globalName || m.user.username,
                        avatarUrl: await resolveMemberAvatar(m),
                        muted,
                        deafened,
                        speaking,
                        streaming,
                        video,
                    };
                }));
                if (vcMembers.length > 0) {
                    voiceChannels.push({
                        guildId: guild.id,
                        guildName: guild.name,
                        channelName: channel.name,
                        channelId: channel.id,
                        members: vcMembers,
                    });
                }
            }
        }
        // テキスト & アナウンスチャンネル一覧 (簡単紐付け・サーバー別同期用)
        const textChannels = [];
        let channelCollection = guild.channels.cache;
        try {
            channelCollection = await guild.channels.fetch();
        }
        catch {
            channelCollection = guild.channels.cache;
        }
        const asdfChannels = deps?.listAsdfChannels ? await deps.listAsdfChannels().catch(() => []) : [];
        const asdfMap = new Map(asdfChannels.map(c => [c.id, c.name]));
        for (const channel of channelCollection.values()) {
            if (!channel)
                continue;
            // GuildText (0) or GuildAnnouncement (5) or isTextBased
            const chType = channel.type;
            if (chType === 0 || chType === 5 || ('isTextBased' in channel && typeof channel.isTextBased === 'function' && channel.isTextBased() && !channel.isVoiceBased())) {
                const binding = bindings.find(b => b.discordChannelId === channel.id);
                const boundChId = binding ? binding.asdfChannelId : null;
                const parent = channel.parent;
                const parentPos = parent ? ((parent.rawPosition ?? parent.position) ?? 0) : 999;
                const chPos = (channel.rawPosition ?? channel.position) ?? 0;
                textChannels.push({
                    id: channel.id,
                    name: channel.name,
                    parentId: channel.parentId || parent?.id || null,
                    parentName: parent?.name || null,
                    parentPosition: parentPos,
                    position: chPos,
                    type: chType,
                    boundAsdfChannelId: boundChId,
                    boundAsdfChannelName: boundChId ? (asdfMap.get(boundChId) || null) : null,
                });
            }
        }
        // チャンネルを Discord と同じカテゴリ位置・チャンネル位置順でソート
        textChannels.sort((a, b) => {
            const pPosA = a.parentPosition ?? 999;
            const pPosB = b.parentPosition ?? 999;
            if (pPosA !== pPosB)
                return pPosA - pPosB;
            const posA = a.position ?? 0;
            const posB = b.position ?? 0;
            if (posA !== posB)
                return posA - posB;
            return a.name.localeCompare(b.name, 'ja');
        });
        // メンバー & オンライン状態
        let memberCollection = guild.members.cache;
        if (guild.members.cache.size <= 2) {
            memberCollection = await guild.members.fetch({ time: 3500 }).catch(() => guild.members.cache);
        }
        const rawMemberList = Array.from(memberCollection.values());
        let onlineCount = 0;
        for (const m of rawMemberList) {
            const st = m.presence?.status || 'offline';
            if (st !== 'offline' || voiceMemberIds.has(m.id))
                onlineCount++;
        }
        // オンラインまたはVC参加中のメンバーを優先して最大60名取得
        const sortedRaw = rawMemberList
            .filter(m => !m.user.bot || voiceMemberIds.has(m.id) || (m.presence?.status && m.presence.status !== 'offline'))
            .sort((a, b) => {
            const aVc = voiceMemberIds.has(a.id) ? 0 : 1;
            const bVc = voiceMemberIds.has(b.id) ? 0 : 1;
            if (aVc !== bVc)
                return aVc - bVc;
            const order = { online: 0, idle: 1, dnd: 2, offline: 3 };
            const aSt = order[a.presence?.status || 'offline'] ?? 3;
            const bSt = order[b.presence?.status || 'offline'] ?? 3;
            return aSt - bSt;
        })
            .slice(0, 60);
        const members = await Promise.all(sortedRaw.map(async (m) => {
            const presence = m.presence;
            const status = (presence?.status || (voiceMemberIds.has(m.id) ? 'online' : 'offline'));
            const acts = presence?.activities || [];
            const gameAct = acts.find(a => a.type === 0 || a.type === 1 || a.type === 2 || a.type === 4);
            const activityText = gameAct
                ? (gameAct.type === 4 ? (gameAct.state || gameAct.name) : `${gameAct.name}${gameAct.details ? `: ${gameAct.details}` : ''}`)
                : null;
            return {
                id: m.id,
                username: m.user.username,
                displayName: m.displayName || m.user.globalName || m.user.username,
                avatarUrl: await resolveMemberAvatar(m),
                status,
                activity: activityText,
                roles: m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).slice(0, 5),
                isBot: m.user.bot,
                inVoice: voiceMemberIds.has(m.id),
                speaking: speakingMemberIds.has(m.id),
            };
        }));
        servers.push({
            id: guild.id,
            name: guild.name,
            iconUrl,
            approved,
            memberCount: guild.memberCount || rawMemberList.length,
            onlineCount,
            members,
            voiceChannels,
            textChannels,
        });
    }
    return servers;
}
async function getDiscordGuildStatus() {
    if (!client || !connected) {
        return {
            enabled: Boolean(client),
            connected,
            guildId: null,
            guildName: null,
            memberCount: 0,
            onlineCount: 0,
            members: [],
            voiceChannels: [],
            servers: [],
        };
    }
    const servers = await getDiscordServers(false);
    const first = servers[0] || null;
    return {
        enabled: true,
        connected: true,
        guildId: first?.id || null,
        guildName: first?.name || null,
        memberCount: first?.memberCount || 0,
        onlineCount: first?.onlineCount || 0,
        members: first?.members || [],
        voiceChannels: getDiscordVoiceStatus(),
        servers,
    };
}
function getDiscordVoiceStatus() {
    if (!client || !connected)
        return [];
    const result = [];
    for (const gid of allowedGuildIds) {
        const guild = client.guilds.cache.get(gid);
        if (!guild)
            continue;
        for (const channel of guild.channels.cache.values()) {
            if (channel.isVoiceBased()) {
                const members = Array.from(channel.members.values()).map(m => {
                    const muted = Boolean(m.voice?.mute || m.voice?.selfMute || m.voice?.serverMute);
                    const deafened = Boolean(m.voice?.deaf || m.voice?.selfDeaf || m.voice?.serverDeaf);
                    const rawUrl = m.displayAvatarURL({ extension: 'png', size: 64 });
                    return {
                        id: m.id,
                        name: m.displayName || m.user.globalName || m.user.username,
                        avatarUrl: rawUrl ? `/api/proxy/media?url=${encodeURIComponent(rawUrl)}` : null,
                        muted,
                        deafened,
                        speaking: !muted && !deafened,
                        streaming: Boolean(m.voice?.streaming),
                        video: Boolean(m.voice?.selfVideo),
                    };
                });
                if (members.length > 0) {
                    result.push({
                        guildId: guild.id,
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
function isVideo(att) {
    return (att.contentType || '').startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(att.name || '');
}
function isImage(att) {
    return (att.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(att.name || '');
}
// サーバーアイコン > ユーザーアイコン の順。アイコンが変わったら別ファイルになる
async function avatarFor(msg) {
    try {
        const hash = msg.member?.avatar || msg.author.avatar || 'default';
        const url = msg.member?.displayAvatarURL({ extension: 'png', size: 128 }) || msg.author.displayAvatarURL({ extension: 'png', size: 128 });
        return await deps.saveAvatar(`${msg.author.id}-${hash}`, url);
    }
    catch (err) {
        console.error('[discord] avatar save failed:', err.message);
        return null;
    }
}
async function processDiscordMessage(msg, targets, isHistorySync = false) {
    if (msg.author.bot || msg.webhookId)
        return 0; // 自分の転送を再取り込みしない
    if (targets.length === 0)
        return 0;
    const name = `[Discord] ${msg.member?.displayName || msg.author.globalName || msg.author.username}`;
    const avatarUrl = await avatarFor(msg);
    const parts = [];
    const rawText = msg.cleanContent?.trim();
    const text = rawText ? formatDiscordContent(rawText) : '';
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
            // 一般ファイル (PDF, txt, zip, 音声等)
            if (att.size <= 25 * 1024 * 1024 && deps?.saveFile) {
                try {
                    const res = await fetch(att.url, { signal: AbortSignal.timeout(20000) });
                    const buf = Buffer.from(await res.arrayBuffer());
                    const url = await deps.saveFile(buf, att.name || 'file');
                    parts.push(`[📎 ${att.name || '添付ファイル'}](${url})`);
                }
                catch (err) {
                    console.error('[discord] file download failed:', err.message);
                    parts.push(`(ファイルの取り込みに失敗しました: ${att.name})`);
                }
            }
            else {
                parts.push(`[📎 ${att.name || '添付ファイル'}](${att.url})`);
            }
        }
    }
    for (const sticker of msg.stickers.values())
        parts.push(`(スタンプ: ${sticker.name})`);
    if (msg.embeds.some(e => e.video))
        parts.push(VIDEO_NOTICE);
    // Embed (URLプレビュー等) のテキスト追加
    const embedTexts = formatEmbeds(msg.embeds);
    if (embedTexts.length > 0) {
        if (parts.length > 0) {
            parts[0] = `${parts[0]}\n\n${embedTexts.join('\n\n')}`;
        }
        else {
            parts.push(embedTexts.join('\n\n'));
        }
    }
    if (parts.length === 0)
        return 0;
    const replyToDiscordMsgId = msg.reference?.messageId || null;
    const createdAt = isHistorySync && msg.createdTimestamp ? new Date(msg.createdTimestamp).toISOString() : null;
    let count = 0;
    for (const t of targets) {
        for (let i = 0; i < parts.length; i++) {
            await deps.ingest(t.asdfChannelId, name, parts[i], {
                avatarUrl,
                discordChannelId: msg.channelId,
                discordMessageId: i === 0 ? msg.id : null,
                replyToDiscordMsgId: i === 0 ? replyToDiscordMsgId : null,
                createdAt,
            });
            count++;
        }
    }
    return count;
}
async function handleDiscordMessage(msg) {
    if (!isGuildAllowed(msg.guildId))
        return;
    if (msg.author.bot || msg.webhookId)
        return;
    const bindings = await getBindings();
    const targets = bindings.filter(b => b.discordChannelId === msg.channelId);
    if (targets.length === 0)
        return;
    await processDiscordMessage(msg, targets, false);
}
// Bot ダウンタイム中などに未取得だった Discord メッセージを遡って同期
async function syncDiscordHistory(opts) {
    if (!client || !connected || !deps)
        return { syncedMessages: 0, checkedChannels: 0 };
    const allBindings = await getBindings();
    const filtered = allBindings.filter(b => {
        if (opts?.asdfChannelId && b.asdfChannelId !== opts.asdfChannelId)
            return false;
        if (opts?.discordChannelId && b.discordChannelId !== opts.discordChannelId)
            return false;
        if (opts?.guildId && b.guildId && b.guildId !== opts.guildId)
            return false;
        return true;
    });
    // 同じ discordChannelId ごとにまとめる
    const byDiscordCh = new Map();
    for (const b of filtered) {
        const arr = byDiscordCh.get(b.discordChannelId) || [];
        arr.push(b);
        byDiscordCh.set(b.discordChannelId, arr);
    }
    const fetchLimit = Math.min(Math.max(opts?.limit || 50, 10), 100);
    let syncedMessages = 0;
    let checkedChannels = 0;
    for (const [discordChannelId, targets] of byDiscordCh.entries()) {
        try {
            const ch = (await client.channels.fetch(discordChannelId).catch(() => null));
            if (!ch || !('messages' in ch) || !isGuildAllowed(ch.guildId))
                continue;
            checkedChannels++;
            const fetched = await ch.messages.fetch({ limit: fetchLimit }).catch(() => null);
            if (!fetched)
                continue;
            const sorted = Array.from(fetched.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            for (const msg of sorted) {
                if (msg.author.bot || msg.webhookId)
                    continue;
                if (deps.isDiscordMessageSynced) {
                    const already = await deps.isDiscordMessageSynced(msg.id);
                    if (already)
                        continue;
                }
                const added = await processDiscordMessage(msg, targets, true);
                syncedMessages += added;
            }
        }
        catch (err) {
            console.warn(`[discord] syncDiscordHistory failed for ${discordChannelId}:`, err.message);
        }
    }
    return { syncedMessages, checkedChannels };
}
// Discord 側の編集: 本文が変わっていれば asdfbase の該当メッセージも書き換える
async function handleDiscordEdit(msg) {
    if (!isGuildAllowed(msg.guildId))
        return;
    const full = msg.partial ? await msg.fetch().catch(() => null) : msg;
    if (!full || full.author.bot || full.webhookId)
        return;
    const bindings = await getBindings();
    if (!bindings.some(b => b.discordChannelId === full.channelId))
        return;
    const rawText = full.cleanContent?.trim() || '';
    let text = rawText ? formatDiscordContent(rawText) : '';
    const embedTexts = formatEmbeds(full.embeds);
    if (embedTexts.length > 0) {
        text = text ? `${text}\n\n${embedTexts.join('\n\n')}` : embedTexts.join('\n\n');
    }
    if (!text)
        return;
    await deps.ingestEdit(full.id, text);
}
// asdfbase のメッセージを連携先の Discord チャンネルへ送信。送った Discord メッセージを返す (空なら未送信)
async function relayToDiscordBot(asdfChannelId, username, content, replyTargetDiscordMessageId) {
    if (!client || !connected || !deps)
        return [];
    const targets = (await getBindings()).filter(b => b.asdfChannelId === asdfChannelId);
    if (targets.length === 0)
        return [];
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
    if (replyTargetDiscordMessageId) {
        payload.reply = { messageReference: replyTargetDiscordMessageId, failIfNotExists: false };
    }
    const sent = [];
    for (const t of targets) {
        try {
            const ch = (await client.channels.fetch(t.discordChannelId));
            if (ch && 'send' in ch && isGuildAllowed(ch.guildId)) {
                const m = await ch.send(payload);
                sent.push({ discordChannelId: t.discordChannelId, discordMessageId: m.id });
            }
        }
        catch (err) {
            lastError = `送信失敗: ${err.message}`;
            console.error('[discord] relay failed:', err.message);
        }
    }
    return sent;
}
// asdfbase で付けられたリアクションを Discord に反映
async function relayReactionToDiscord(discordChannelId, discordMessageId, emoji, isRemove = false) {
    if (!client || !connected)
        return;
    try {
        const ch = (await client.channels.fetch(discordChannelId));
        if (!ch || !('messages' in ch) || !isGuildAllowed(ch.guildId))
            return;
        const msg = await ch.messages.fetch(discordMessageId).catch(() => null);
        if (!msg)
            return;
        const cleanName = emoji.replace(/^:+|:+$/g, '');
        const rx = msg.reactions.resolve(emoji)
            || msg.reactions.cache.find((r) => r.emoji.name === emoji ||
                r.emoji.name === cleanName ||
                r.emoji.identifier === emoji ||
                r.emoji.toString() === emoji);
        if (isRemove) {
            if (rx && client.user) {
                await rx.users.remove(client.user.id).catch((err) => {
                    console.warn('[discord] failed to remove bot reaction:', err.message);
                });
            }
        }
        else {
            await msg.react(emoji).catch(async () => {
                const guild = msg.guild;
                const customEmoji = guild?.emojis.cache.find((e) => e.name === cleanName);
                if (customEmoji)
                    await msg.react(customEmoji).catch(() => { });
            });
        }
    }
    catch (err) {
        console.warn('[discord] relayReaction failed:', err.message);
    }
}
// asdfbase でピン留めされた状態を Discord に反映
async function relayPinToDiscord(discordChannelId, discordMessageId, isPinned) {
    if (!client || !connected)
        return;
    try {
        const ch = (await client.channels.fetch(discordChannelId));
        if (!ch || !('messages' in ch) || !isGuildAllowed(ch.guildId))
            return;
        const msg = await ch.messages.fetch(discordMessageId).catch(() => null);
        if (!msg)
            return;
        if (isPinned) {
            if (!msg.pinned)
                await msg.pin().catch(() => { });
        }
        else {
            if (msg.pinned)
                await msg.unpin().catch(() => { });
        }
    }
    catch (err) {
        console.warn('[discord] relayPin failed:', err.message);
    }
}
// Bot が送ったメッセージを編集 (Discord 側にも「編集済み」が付く)。1つでも編集できれば true
async function editRelayedOnDiscord(links, username, content) {
    if (!client || !connected || links.length === 0)
        return false;
    const body = content.replace(/!\[[^\]]*\]\((\/uploads\/[^)\s]+)\)/g, '').trim();
    let edited = false;
    for (const l of links) {
        try {
            const ch = (await client.channels.fetch(l.discordChannelId));
            if (!ch || !('messages' in ch) || !isGuildAllowed(ch.guildId))
                continue;
            const m = await ch.messages.fetch(l.discordMessageId);
            await m.edit({ content: `**${username}**${body ? `: ${body}` : ''}`.slice(0, 2000), allowedMentions: { parse: [] } });
            edited = true;
        }
        catch (err) {
            lastError = `編集の反映に失敗: ${err.message}`;
            console.error('[discord] edit relay failed:', err.message);
        }
    }
    return edited;
}
function createClient(_withMessageContent) {
    // 特権インテント (GuildMembers, GuildPresences, MessageContent) を全て有効化
    const intents = [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMembers,
        discord_js_1.GatewayIntentBits.GuildPresences,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.GuildMessageTyping,
        discord_js_1.GatewayIntentBits.GuildMessageReactions,
        discord_js_1.GatewayIntentBits.GuildVoiceStates,
        discord_js_1.GatewayIntentBits.MessageContent,
    ];
    return new discord_js_1.Client({
        intents,
        // キャッシュしていないメッセージの編集・リアクションも受け取る
        partials: [discord_js_1.Partials.Message, discord_js_1.Partials.Channel, discord_js_1.Partials.Reaction, discord_js_1.Partials.GuildMember, discord_js_1.Partials.User],
        makeCache: discord_js_1.Options.cacheWithLimits({
            ...discord_js_1.Options.DefaultMakeCacheSettings,
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
async function startDiscordBot(d) {
    deps = d;
    const token = process.env.DISCORD_BOT_TOKEN || '';
    const rawGuilds = process.env.DISCORD_GUILD_IDS || process.env.DISCORD_GUILD_ID || '';
    envGuildIds = rawGuilds.split(',').map(s => s.trim()).filter(Boolean);
    await loadApprovedGuilds();
    if (!token) {
        console.log('[discord] DISCORD_BOT_TOKEN not set — bot disabled');
        return;
    }
    const boot = async (withMessageContent) => {
        const c = createClient(withMessageContent);
        client = c;
        c.once(discord_js_1.Events.ClientReady, async (ready) => {
            connected = true;
            lastError = '';
            console.log(`[discord] logged in as ${ready.user.tag}`);
            // 環境変数も承認済みサーバーも空の場合は、最初に参加しているサーバーを自動承認
            if (allowedGuildIds.length === 0 && ready.guilds.cache.size > 0) {
                const firstId = ready.guilds.cache.first().id;
                await approveDiscordGuild(firstId);
            }
            const missing = envGuildIds.filter(gid => !ready.guilds.cache.has(gid));
            if (missing.length > 0) {
                lastError = `許可されたサーバーの一部に Bot が参加していません: ${missing.join(', ')}`;
            }
            await refreshDiscordCommands();
            if (deps?.onVoiceStatusUpdate) {
                deps.onVoiceStatusUpdate(getDiscordVoiceStatus());
            }
            // ダウンタイム中の未取得メッセージを自動でバックグラウンド取得
            syncDiscordHistory({ limit: 50 }).catch(err => console.warn('[discord] startup history sync error:', err.message));
        });
        c.on(discord_js_1.Events.ShardDisconnect, () => {
            connected = false;
        });
        c.on(discord_js_1.Events.ShardResume, () => {
            connected = true;
            syncDiscordHistory({ limit: 50 }).catch(() => { });
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
        c.on(discord_js_1.Events.MessageUpdate, (_old, m) => {
            handleDiscordEdit(m).catch(err => console.error('[discord] edit handling failed:', err));
        });
        c.on(discord_js_1.Events.MessageDelete, m => {
            try {
                if (m.guildId && !isGuildAllowed(m.guildId))
                    return;
                if (deps?.ingestDelete) {
                    deps.ingestDelete(m.id).catch(err => console.error('[discord] delete handling failed:', err));
                }
            }
            catch (err) {
                console.error('[discord] delete error:', err.message);
            }
        });
        c.on(discord_js_1.Events.MessageReactionAdd, async (reaction, user) => {
            try {
                if (user.bot)
                    return;
                const fullRx = reaction.partial ? await reaction.fetch().catch(() => reaction) : reaction;
                const fullMsg = fullRx.message.partial ? await fullRx.message.fetch().catch(() => null) : fullRx.message;
                if (!fullMsg || !isGuildAllowed(fullMsg.guildId))
                    return;
                const emoji = fullRx.emoji.name;
                if (!emoji || !deps?.ingestReaction)
                    return;
                const finalEmoji = fullRx.emoji.id ? `:${emoji}:` : emoji;
                await deps.ingestReaction(fullMsg.id, finalEmoji, user.id, 'add');
            }
            catch (err) {
                console.error('[discord] reactionAdd failed:', err.message);
            }
        });
        c.on(discord_js_1.Events.MessageReactionRemove, async (reaction, user) => {
            try {
                if (user.bot)
                    return;
                const fullRx = reaction.partial ? await reaction.fetch().catch(() => reaction) : reaction;
                const fullMsg = fullRx.message.partial ? await fullRx.message.fetch().catch(() => null) : fullRx.message;
                if (!fullMsg || !isGuildAllowed(fullMsg.guildId))
                    return;
                const emoji = fullRx.emoji.name;
                if (!emoji || !deps?.ingestReaction)
                    return;
                const finalEmoji = fullRx.emoji.id ? `:${emoji}:` : emoji;
                await deps.ingestReaction(fullMsg.id, finalEmoji, user.id, 'remove');
            }
            catch (err) {
                console.error('[discord] reactionRemove failed:', err.message);
            }
        });
        c.on(discord_js_1.Events.ChannelPinsUpdate, async (channel) => {
            try {
                if (!('guildId' in channel) || !isGuildAllowed(channel.guildId))
                    return;
                if (!deps?.syncPinsForChannel)
                    return;
                const textCh = channel;
                if (typeof textCh.messages?.fetchPinned === 'function') {
                    const pinnedMessages = await textCh.messages.fetchPinned().catch(() => null);
                    if (pinnedMessages) {
                        const pinnedIds = Array.from(pinnedMessages.keys());
                        await deps.syncPinsForChannel(channel.id, pinnedIds);
                    }
                }
            }
            catch (err) {
                console.error('[discord] pinsUpdate failed:', err.message);
            }
        });
        c.on(discord_js_1.Events.VoiceStateUpdate, (_oldState, newState) => {
            if (!isGuildAllowed(newState.guild?.id))
                return;
            if (deps?.onVoiceStatusUpdate) {
                deps.onVoiceStatusUpdate(getDiscordVoiceStatus());
            }
        });
        c.on(discord_js_1.Events.TypingStart, async (typing) => {
            try {
                if (!isGuildAllowed(typing.guild?.id))
                    return;
                if (typing.user?.bot)
                    return;
                if (!deps?.onTyping)
                    return;
                const targets = (await getBindings()).filter(b => b.discordChannelId === typing.channel.id);
                if (targets.length === 0)
                    return;
                const username = `[Discord] ${typing.member?.displayName || typing.user?.globalName || typing.user?.username || 'ユーザー'}`;
                for (const t of targets) {
                    deps.onTyping(t.asdfChannelId, typing.user.id, username);
                }
            }
            catch (err) {
                console.error('[discord] typing handling failed:', err.message);
            }
        });
        c.on(discord_js_1.Events.InteractionCreate, i => {
            if (i.isChatInputCommand()) {
                handleCommand(i).catch(err => console.error('[discord] command failed:', err));
            }
        });
        c.on(discord_js_1.Events.GuildCreate, g => {
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
