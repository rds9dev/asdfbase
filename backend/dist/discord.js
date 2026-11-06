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
exports.invalidateDiscordServerCache = invalidateDiscordServerCache;
exports.getDiscordServers = getDiscordServers;
exports.getDiscordGuildStatus = getDiscordGuildStatus;
exports.getDiscordVoiceStatus = getDiscordVoiceStatus;
exports.handleThreadAutoBind = handleThreadAutoBind;
exports.syncDiscordHistory = syncDiscordHistory;
exports.syncGuildChannels = syncGuildChannels;
exports.startChannelAutoSyncTimer = startChannelAutoSyncTimer;
exports.relayToDiscordBot = relayToDiscordBot;
exports.relayReactionToDiscord = relayReactionToDiscord;
exports.relayPinToDiscord = relayPinToDiscord;
exports.editRelayedOnDiscord = editRelayedOnDiscord;
exports.deleteRelayedOnDiscord = deleteRelayedOnDiscord;
exports.discordUserIdToPseudoId = discordUserIdToPseudoId;
exports.resolveDiscordReactionUsers = resolveDiscordReactionUsers;
exports.getDiscordUserPresence = getDiscordUserPresence;
exports.startDiscordBot = startDiscordBot;
exports.sendDiscordDm = sendDiscordDm;
exports.deleteDiscordDm = deleteDiscordDm;
exports.triggerDiscordDmTyping = triggerDiscordDmTyping;
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
    invalidateDiscordServerCache();
    await refreshDiscordCommands();
}
async function removeApprovedDiscordGuild(guildId) {
    if (!deps)
        return;
    await loadApprovedGuilds();
    approvedGuildIds = approvedGuildIds.filter(id => id !== guildId);
    await deps.setSetting(APPROVED_GUILDS_KEY, JSON.stringify(approvedGuildIds));
    rebuildAllowedGuildIds();
    invalidateDiscordServerCache();
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
    invalidateDiscordServerCache();
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
function formatDiscordContent(content, guild) {
    if (!content)
        return '';
    let text = content;
    // カスタム絵文字 <:name:id> / <a:name:id> を Markdown 画像に変換
    text = text.replace(/<a:([a-zA-Z0-9_]+):([0-9]+)>/g, '![$1](https://cdn.discordapp.com/emojis/$2.gif?size=48&quality=lossless)');
    text = text.replace(/<:([a-zA-Z0-9_]+):([0-9]+)>/g, '![$1](https://cdn.discordapp.com/emojis/$2.webp?size=48&quality=lossless)');
    // チャンネルメンション <#channelId> を #チャンネル名 に変換
    text = text.replace(/<#([0-9]+)>/g, (match, chId) => {
        if (client) {
            const ch = client.channels.cache.get(chId) || (guild?.channels?.cache?.get(chId));
            if (ch && 'name' in ch && ch.name)
                return `#${ch.name}`;
        }
        return match;
    });
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
        if (e.author?.name?.trim()) {
            lines.push(`> 👤 **${e.author.name.trim().replace(/\n/g, ' ')}**`);
        }
        const rawTitle = e.title?.trim();
        const title = rawTitle ? rawTitle.replace(/\n/g, ' ') : '';
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
            const desc = e.description.trim().slice(0, 1000);
            lines.push(`> ${desc.replace(/\n/g, '\n> ')}`);
        }
        if (Array.isArray(e.fields) && e.fields.length > 0) {
            for (const f of e.fields.slice(0, 10)) {
                if (!f.name && !f.value)
                    continue;
                const fname = (f.name || '').trim().replace(/\n/g, ' ');
                const fval = (f.value || '').trim();
                lines.push(`> **${fname}**\n> ${fval.replace(/\n/g, '\n> ')}`);
            }
        }
        if (e.image?.url) {
            lines.push(`> ![embed-image](${e.image.url})`);
        }
        else if (e.thumbnail?.url && !e.image) {
            lines.push(`> ![embed-thumb](${e.thumbnail.url})`);
        }
        if (e.footer?.text?.trim()) {
            lines.push(`> ⎯⎯⎯\n> ℹ️ *${e.footer.text.trim().replace(/\n/g, ' ')}*`);
        }
        if (lines.length > 0) {
            parts.push(lines.join('\n'));
        }
    }
    return parts;
}
// サーバー情報キャッシュ (TTL: 15秒)
let cachedDiscordServers = null;
let pendingServersPromise = null;
function invalidateDiscordServerCache() {
    cachedDiscordServers = null;
}
async function resolveGuildIcon(guild) {
    if (!guild?.icon)
        return null;
    const rawUrl = guild.iconURL({ extension: 'png', size: 128 });
    if (!rawUrl)
        return null;
    const key = `guild-${guild.id}-${guild.icon}`.replace(/[^A-Za-z0-9_-]/g, '');
    if (deps?.uploadDir) {
        const localWebpPath = path_1.default.join(deps.uploadDir, `discord-avatar-${key}.webp`);
        if (fs_1.default.existsSync(localWebpPath)) {
            return `/uploads/discord-avatar-${key}.webp`;
        }
    }
    if (deps?.saveAvatar) {
        try {
            const saved = await deps.saveAvatar(key, rawUrl);
            if (saved)
                return saved;
        }
        catch { }
    }
    return `/api/proxy/media?url=${encodeURIComponent(rawUrl)}`;
}
// アバターの取得: ブロッキングを排除して即時プロキシURLを返し、バックグラウンドでローカルWebP化
const avatarSaveInProgress = new Set();
async function resolveMemberAvatar(m) {
    try {
        const hash = m.avatar || m.user?.avatar || 'default';
        const rawUrl = m.displayAvatarURL({ extension: 'png', size: 64 });
        if (!rawUrl)
            return null;
        const key = `member-${m.id}-${hash}`.replace(/[^A-Za-z0-9_-]/g, '');
        if (deps?.uploadDir) {
            const localWebpPath = path_1.default.join(deps.uploadDir, `discord-avatar-${key}.webp`);
            if (fs_1.default.existsSync(localWebpPath)) {
                return `/uploads/discord-avatar-${key}.webp`;
            }
        }
        if (deps?.saveAvatar && !avatarSaveInProgress.has(key)) {
            avatarSaveInProgress.add(key);
            deps.saveAvatar(key, rawUrl).catch(() => { }).finally(() => {
                avatarSaveInProgress.delete(key);
            });
        }
        return `/api/proxy/media?url=${encodeURIComponent(rawUrl)}`;
    }
    catch {
        return null;
    }
}
async function getDiscordServers(includeUnapproved = false) {
    if (!client || !connected) {
        // 接続直後などで connected が一時的にずれていても cache があれば利用
        if (!client?.guilds?.cache || client.guilds.cache.size === 0)
            return [];
    }
    // 15秒以内の有効なキャッシュがあればそれを返す
    const now = Date.now();
    if (cachedDiscordServers && now - cachedDiscordServers.time < 15000) {
        if (includeUnapproved)
            return cachedDiscordServers.data;
        return cachedDiscordServers.data.filter(s => s.approved);
    }
    if (pendingServersPromise) {
        const res = await pendingServersPromise;
        if (includeUnapproved)
            return res;
        return res.filter(s => s.approved);
    }
    pendingServersPromise = (async () => {
        try {
            const bindings = deps ? await getBindings() : [];
            const servers = [];
            for (const guild of client.guilds.cache.values()) {
                const approved = isGuildAllowed(guild.id);
                const iconUrl = await resolveGuildIcon(guild);
                // ボイスチャンネル情報
                const voiceChannels = [];
                const voiceMemberIds = new Set();
                const speakingMemberIds = new Set();
                for (const channel of guild.channels.cache.values()) {
                    if (channel.isVoiceBased()) {
                        const rawMembers = Array.from(channel.members.values());
                        const vcMembers = [];
                        for (const m of rawMembers) {
                            const muted = Boolean(m.voice?.mute || m.voice?.selfMute || m.voice?.serverMute);
                            const deafened = Boolean(m.voice?.deaf || m.voice?.selfDeaf || m.voice?.serverDeaf);
                            const speaking = !muted && !deafened;
                            const streaming = Boolean(m.voice?.streaming);
                            const video = Boolean(m.voice?.selfVideo);
                            voiceMemberIds.add(m.id);
                            if (speaking)
                                speakingMemberIds.add(m.id);
                            vcMembers.push({
                                id: m.id,
                                name: m.displayName || m.user.globalName || m.user.username,
                                avatarUrl: await resolveMemberAvatar(m),
                                muted,
                                deafened,
                                speaking,
                                streaming,
                                video,
                            });
                        }
                        const binding = bindings.find(b => b.discordChannelId === channel.id);
                        const vcPos = (channel.rawPosition ?? channel.position) ?? 0;
                        voiceChannels.push({
                            guildId: guild.id,
                            guildName: guild.name,
                            channelName: channel.name,
                            channelId: channel.id,
                            id: channel.id,
                            name: channel.name,
                            boundAsdfChannelId: binding ? binding.asdfChannelId : null,
                            position: vcPos,
                            members: vcMembers,
                        });
                    }
                }
                voiceChannels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
                // テキスト & アナウンス & スレッド一覧 (キャッシュ優先で即座に取得)
                const textChannels = [];
                const channelCollection = guild.channels.cache;
                const threadCollection = guild.threads?.cache;
                const allCandidates = [
                    ...channelCollection.values(),
                    ...(threadCollection ? threadCollection.values() : []),
                ];
                const seenCandidateIds = new Set();
                const asdfChannels = deps?.listAsdfChannels ? await deps.listAsdfChannels().catch(() => []) : [];
                const asdfMap = new Map(asdfChannels.map(c => [c.id, c.name]));
                for (const channel of allCandidates) {
                    if (!channel || seenCandidateIds.has(channel.id))
                        continue;
                    seenCandidateIds.add(channel.id);
                    const chType = channel.type;
                    const isThread = Boolean((typeof channel.isThread === 'function' && channel.isThread()) ||
                        chType === 10 || chType === 11 || chType === 12);
                    if (chType === 0 || chType === 5 || isThread || ('isTextBased' in channel && typeof channel.isTextBased === 'function' && channel.isTextBased() && !channel.isVoiceBased())) {
                        const binding = bindings.find(b => b.discordChannelId === channel.id);
                        const boundChId = binding ? binding.asdfChannelId : null;
                        const parent = channel.parent;
                        const grandParent = isThread && parent ? parent.parent : null;
                        const effectiveCategory = grandParent || (!isThread ? parent : null);
                        const parentPos = effectiveCategory ? ((effectiveCategory.rawPosition ?? effectiveCategory.position) ?? 0) : 999;
                        const parentName = effectiveCategory ? (effectiveCategory.name || null) : null;
                        const chPos = (channel.rawPosition ?? channel.position) ?? 0;
                        textChannels.push({
                            id: channel.id,
                            name: channel.name,
                            parentId: channel.parentId || parent?.id || null,
                            parentName,
                            parentPosition: parentPos,
                            position: chPos,
                            type: chType,
                            isThread,
                            boundAsdfChannelId: boundChId,
                            boundAsdfChannelName: boundChId ? (asdfMap.get(boundChId) || null) : null,
                        });
                    }
                }
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
                const rawMemberList = Array.from(guild.members.cache.values());
                let onlineCount = 0;
                for (const m of rawMemberList) {
                    const st = m.presence?.status || 'offline';
                    if (st !== 'offline' || voiceMemberIds.has(m.id))
                        onlineCount++;
                }
                // オンラインまたはVC参加中を優先して最大300名
                const sortedRaw = rawMemberList
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
                    .slice(0, 300);
                const members = [];
                for (const m of sortedRaw) {
                    const presence = m.presence;
                    const status = (presence?.status || (voiceMemberIds.has(m.id) ? 'online' : 'offline'));
                    const acts = presence?.activities || [];
                    const customAct = acts.find(a => a.type === 4);
                    const customStatus = customAct ? [customAct.emoji?.name, customAct.state].filter(Boolean).join(' ') || null : null;
                    const gameAct = acts.find(a => a.type === 0 || a.type === 1 || a.type === 2 || a.type === 3 || a.type === 5);
                    const activityText = gameAct ? `${gameAct.name}${gameAct.details ? `: ${gameAct.details}` : ''}` : customStatus;
                    const activities = acts
                        .filter(a => a.type !== 4)
                        .map(a => ({
                        name: a.name,
                        type: a.type,
                        details: a.details || null,
                        state: a.state || null,
                    }));
                    const sortedRoles = Array.from(m.roles.cache.values())
                        .filter(r => r.name !== '@everyone')
                        .sort((a, b) => b.position - a.position);
                    const roleDetails = sortedRoles.map(r => ({
                        id: r.id,
                        name: r.name,
                        color: r.hexColor && r.hexColor !== '#000000' ? r.hexColor : '#94a3b8',
                    }));
                    const topRoleColor = roleDetails.find(r => r.color && r.color !== '#94a3b8')?.color || null;
                    const bannerColor = (m.displayHexColor && m.displayHexColor !== '#000000' ? m.displayHexColor : null) ||
                        (m.user.hexAccentColor || null);
                    const clientStatus = presence?.clientStatus ? Object.keys(presence.clientStatus) : [];
                    members.push({
                        id: m.id,
                        username: m.user.username,
                        globalName: m.user.globalName || null,
                        nickname: m.nickname || null,
                        displayName: m.displayName || m.user.globalName || m.user.username,
                        avatarUrl: await resolveMemberAvatar(m),
                        bannerColor,
                        topRoleColor,
                        status,
                        activity: activityText,
                        customStatus,
                        activities,
                        clientStatus,
                        roles: sortedRoles.map(r => r.name),
                        roleDetails,
                        createdAt: m.user.createdAt ? m.user.createdAt.toISOString() : null,
                        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
                        premiumSince: m.premiumSince ? m.premiumSince.toISOString() : null,
                        voiceChannelName: m.voice?.channel?.name || null,
                        isBot: m.user.bot,
                        inVoice: voiceMemberIds.has(m.id),
                        speaking: speakingMemberIds.has(m.id),
                    });
                }
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
            cachedDiscordServers = { time: Date.now(), data: servers };
            return servers;
        }
        finally {
            pendingServersPromise = null;
        }
    })();
    const allServers = await pendingServersPromise;
    if (includeUnapproved)
        return allServers;
    return allServers.filter(s => s.approved);
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
// Webhook 送信管理: チャンネルごとの Webhook キャッシュ & 自送信エコーバック除外
const webhookCache = new Map();
const ourWebhookIds = new Set();
async function getOrCreateWebhook(channel) {
    if (!channel || !('fetchWebhooks' in channel))
        return null;
    const channelId = channel.id;
    const cached = webhookCache.get(channelId);
    if (cached)
        return cached;
    try {
        const webhooks = await channel.fetchWebhooks();
        let hook = webhooks.find((w) => w.name === 'asdfbase-relay' || (client?.user && w.owner?.id === client.user.id)) || webhooks.first();
        if (!hook && 'createWebhook' in channel) {
            hook = await channel.createWebhook({
                name: 'asdfbase-relay',
                reason: 'asdfbase message relay',
            });
        }
        if (hook) {
            webhookCache.set(channelId, hook);
            ourWebhookIds.add(hook.id);
            return hook;
        }
    }
    catch (err) {
        console.warn('[discord] webhook fetch/create failed:', err.message);
    }
    return null;
}
// 本文中の @メンバー名 を Discord の <@userId> 記法に変換 (最長一致でスペース・記号入り名前にも対応)
async function resolveDiscordMentions(guild, text) {
    if (!guild)
        return text;
    let resolved = text;
    try {
        const members = Array.from(guild.members.cache.values());
        // 名前の長い順にソートして、部分一致よりも最長一致を優先 (スペース・記号入り完全対応)
        const sortedMembers = [];
        for (const m of members) {
            if (m.displayName)
                sortedMembers.push({ name: m.displayName, id: m.id });
            if (m.user?.globalName && m.user.globalName !== m.displayName)
                sortedMembers.push({ name: m.user.globalName, id: m.id });
            if (m.user?.username && m.user.username !== m.displayName && m.user.username !== m.user?.globalName)
                sortedMembers.push({ name: m.user.username, id: m.id });
        }
        sortedMembers.sort((a, b) => b.name.length - a.name.length);
        for (const sm of sortedMembers) {
            if (sm.name.length < 2)
                continue;
            const targetTag = `@${sm.name}`;
            if (resolved.includes(targetTag)) {
                resolved = resolved.split(targetTag).join(`<@${sm.id}>`);
            }
        }
        // 残りの単語メンション (@user)
        resolved = resolved.replace(/@([^\s@#]+)/g, (match, name) => {
            if (name === 'everyone' || name === 'here')
                return match;
            const target = members.find((m) => m.displayName === name || m.user?.username === name || m.user?.globalName === name);
            return target ? `<@${target.id}>` : match;
        });
        // #チャンネル名 を <#channelId> に変換
        if (resolved.includes('#')) {
            const channels = Array.from(guild.channels.cache.values());
            const sortedChannels = channels
                .filter((c) => c.name && c.id)
                .sort((a, b) => b.name.length - a.name.length);
            for (const ch of sortedChannels) {
                const tag = `#${ch.name}`;
                if (resolved.includes(tag)) {
                    resolved = resolved.split(tag).join(`<#${ch.id}>`);
                }
            }
        }
    }
    catch {
        return text;
    }
    return resolved;
}
// 自分の送信・Webhookエコー判定 (他の外部Botや他Webhookは通す)
function isOurEchoMessage(msg) {
    if (msg.webhookId && ourWebhookIds.has(msg.webhookId))
        return true;
    if (client?.user && msg.author?.id === client.user.id)
        return true;
    return false;
}
async function processDiscordMessage(msg, targets, isHistorySync = false) {
    if (isOurEchoMessage(msg))
        return 0; // 自分の転送を再取り込みしない
    if (targets.length === 0)
        return 0;
    const name = `[Discord] ${msg.member?.displayName || msg.author.globalName || msg.author.username}`;
    const avatarUrl = await avatarFor(msg);
    const parts = [];
    const rawText = msg.cleanContent?.trim();
    const text = rawText ? formatDiscordContent(rawText, msg.guild) : '';
    if (text)
        parts.push(text);
    // Discord 転送メッセージ (Forwarded Messages / messageSnapshots) の展開
    const snapshots = msg.messageSnapshots;
    if (snapshots && (snapshots.size > 0 || (Array.isArray(snapshots) && snapshots.length > 0))) {
        const snapList = snapshots.values ? Array.from(snapshots.values()) : snapshots;
        for (const snap of snapList) {
            const snapLines = ['> ↪ **転送されたメッセージ**'];
            const snapText = (snap.cleanContent || snap.content || '').trim();
            if (snapText) {
                const formattedSnap = formatDiscordContent(snapText, msg.guild);
                snapLines.push(`> ${formattedSnap.replace(/\n/g, '\n> ')}`);
            }
            if (snap.attachments) {
                const attList = snap.attachments.values ? Array.from(snap.attachments.values()) : snap.attachments;
                for (const att of attList) {
                    if (isVideo(att)) {
                        snapLines.push(`> ${VIDEO_NOTICE}`);
                    }
                    else if (isImage(att) && att.url) {
                        snapLines.push(`> ![image](${att.url})`);
                    }
                    else if (att.url) {
                        snapLines.push(`> [📎 ${att.name || '添付ファイル'}](${att.url})`);
                    }
                }
            }
            if (snap.embeds && snap.embeds.length > 0) {
                const snapEmbeds = formatEmbeds(snap.embeds);
                if (snapEmbeds.length > 0) {
                    snapLines.push(snapEmbeds.join('\n\n'));
                }
            }
            parts.push(snapLines.join('\n'));
        }
    }
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
                authorDiscordId: msg.author.id,
                createdAt,
                isBot: Boolean(msg.author.bot || msg.webhookId),
            });
            count++;
        }
    }
    return count;
}
async function handleThreadAutoBind(thread) {
    if (!client || !connected || !deps)
        return null;
    const guildId = thread.guildId || thread.guild?.id;
    if (!guildId || !isGuildAllowed(guildId))
        return null;
    const bindings = await getBindings();
    const existing = bindings.find(b => b.discordChannelId === thread.id);
    if (existing)
        return existing;
    const existingChannels = await deps.listAsdfChannels().catch(() => []);
    const parentDiscordId = thread.parentId || thread.parent?.id;
    let parentAsdfId = null;
    if (parentDiscordId) {
        const parentBinding = bindings.find(b => b.discordChannelId === parentDiscordId);
        if (parentBinding)
            parentAsdfId = parentBinding.asdfChannelId;
    }
    const boundAsdfIds = new Set(bindings.map(b => b.asdfChannelId));
    let targetAsdfCh = existingChannels.find(c => c.server_id === guildId && c.type === 'thread' && c.name.toLowerCase() === String(thread.name || '').toLowerCase() && !boundAsdfIds.has(c.id));
    if (!targetAsdfCh && deps.createAsdfChannel) {
        targetAsdfCh = (await deps.createAsdfChannel(thread.name || 'スレッド', 'thread', 0, guildId, parentAsdfId)) || undefined;
    }
    if (targetAsdfCh) {
        const nextBindings = await addDiscordBinding(thread.id, targetAsdfCh.id, guildId);
        deps.onBindingsUpdated?.();
        return nextBindings.find(b => b.discordChannelId === thread.id) || null;
    }
    return null;
}
async function handleDiscordMessage(msg) {
    if (msg.author.bot)
        return;
    // DM メッセージの処理
    if (!msg.guildId) {
        if (deps?.ingestDmMessage) {
            const attachments = [];
            for (const a of msg.attachments.values()) {
                try {
                    const res = await fetch(a.url);
                    if (res.ok) {
                        const buf = Buffer.from(await res.arrayBuffer());
                        const isImg = a.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name);
                        const savedUrl = isImg ? await deps.saveImage(buf) : (deps.saveFile ? await deps.saveFile(buf, a.name) : await deps.saveImage(buf));
                        attachments.push({ url: savedUrl, name: a.name });
                    }
                }
                catch (err) {
                    console.warn('[discord] DM attachment download failed:', err.message);
                }
            }
            let avatarUrl = msg.author.displayAvatarURL({ extension: 'webp', size: 128 });
            if (deps.saveAvatar) {
                avatarUrl = (await deps.saveAvatar(msg.author.id, avatarUrl)) || avatarUrl;
            }
            await deps.ingestDmMessage({
                discordUserId: msg.author.id,
                discordUsername: msg.author.username,
                discordDisplayName: msg.author.displayName || msg.author.globalName || msg.author.username,
                discordAvatarUrl: avatarUrl,
                content: msg.cleanContent || msg.content || '',
                attachments,
                discordMessageId: msg.id,
            });
        }
        return;
    }
    if (!isGuildAllowed(msg.guildId))
        return;
    if (isOurEchoMessage(msg))
        return;
    const bindings = await getBindings();
    let targets = bindings.filter(b => b.discordChannelId === msg.channelId);
    if (targets.length === 0) {
        const ch = msg.channel;
        const isThread = Boolean((typeof ch?.isThread === 'function' && ch.isThread()) ||
            ch?.type === 10 || ch?.type === 11 || ch?.type === 12);
        if (isThread) {
            const bound = await handleThreadAutoBind(ch);
            if (bound) {
                targets = [bound];
            }
        }
    }
    if (targets.length === 0)
        return;
    await processDiscordMessage(msg, targets, false);
}
// Bot ダウンタイム中などに未取得だった Discord メッセージを遡って同期 (古いメッセージは除外)
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
    // 古いメッセージを同期しないよう、直近指定時間以内のみを対象にする (デフォルト2時間)
    const maxAgeHours = opts?.maxAgeHours ?? 2;
    const oldestAllowedTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
    const fetchLimit = Math.min(Math.max(opts?.limit || 20, 5), 30);
    let syncedMessages = 0;
    let checkedChannels = 0;
    for (const [discordChannelId, targets] of byDiscordCh.entries()) {
        try {
            const ch = (await client.channels.fetch(discordChannelId).catch(() => null));
            if (!ch || !('messages' in ch) || !isGuildAllowed(ch.guildId))
                continue;
            if (opts?.guildId && ch.guildId && ch.guildId !== opts.guildId)
                continue;
            checkedChannels++;
            // 紐付き先チャンネルのメッセージ数が30件未満なら、日付制限を無視して30件まで遡る
            let isLowFrequencyChannel = false;
            if (deps.getMessageCount) {
                for (const t of targets) {
                    const count = await deps.getMessageCount(t.asdfChannelId).catch(() => 30);
                    if (count < 30) {
                        isLowFrequencyChannel = true;
                        break;
                    }
                }
            }
            const channelFetchLimit = isLowFrequencyChannel ? 30 : fetchLimit;
            const fetched = await ch.messages.fetch({ limit: channelFetchLimit }).catch(() => null);
            if (!fetched)
                continue;
            const sorted = Array.from(fetched.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            for (const msg of sorted) {
                if (isOurEchoMessage(msg))
                    continue;
                // 30件未満のチャンネルでない場合は、古いメッセージ (指定時間以上前) はスキップ
                if (!isLowFrequencyChannel && msg.createdTimestamp < oldestAllowedTime)
                    continue;
                if (deps.isDiscordMessageSynced) {
                    const already = await deps.isDiscordMessageSynced(msg.id);
                    if (already)
                        continue;
                }
                const added = await processDiscordMessage(msg, targets, true);
                syncedMessages += added;
            }
            // Discord API レートリミット & サーバー負荷緩和のための微小ウェイト
            await new Promise(r => setTimeout(r, 60));
        }
        catch (err) {
            console.warn(`[discord] syncDiscordHistory failed for ${discordChannelId}:`, err.message);
        }
    }
    return { syncedMessages, checkedChannels };
}
// 承認済みサーバーの全チャンネル (テキスト & VC) を自動走査・同期して asdfbase にバインド
async function syncGuildChannels(targetGuildId) {
    if (!client || !connected || !deps)
        return { createdCount: 0, boundCount: 0 };
    const targetGuildIds = targetGuildId ? [targetGuildId] : allowedGuildIds;
    let totalCreated = 0;
    let totalBound = 0;
    for (const gid of targetGuildIds) {
        if (!isGuildAllowed(gid))
            continue;
        const guild = client.guilds.cache.get(gid);
        if (!guild)
            continue;
        const existingChannels = await deps.listAsdfChannels().catch(() => []);
        const bindings = await getBindings();
        const boundDiscordIds = new Set(bindings.map(b => b.discordChannelId));
        const boundAsdfIds = new Set(bindings.map(b => b.asdfChannelId));
        const channelCandidates = Array.from(guild.channels.cache.values());
        if (guild.threads?.cache) {
            for (const th of guild.threads.cache.values()) {
                if (!channelCandidates.some(c => c.id === th.id))
                    channelCandidates.push(th);
            }
        }
        for (const ch of channelCandidates) {
            if (!ch)
                continue;
            if (boundDiscordIds.has(ch.id))
                continue;
            const isVoice = typeof ch.isVoiceBased === 'function' ? ch.isVoiceBased() : false;
            const isThread = Boolean((typeof ch.isThread === 'function' && ch.isThread()) ||
                ch.type === 10 || ch.type === 11 || ch.type === 12);
            const isText = 'isTextBased' in ch && typeof ch.isTextBased === 'function' && ch.isTextBased() && !isVoice;
            if (!isText && !isVoice)
                continue;
            const chType = isVoice ? 'voice' : isThread ? 'thread' : 'text';
            const pos = (ch.rawPosition ?? ch.position) ?? 0;
            let parentAsdfId = null;
            if (isThread) {
                const parentId = ch.parentId || ch.parent?.id;
                if (parentId) {
                    const parentBinding = bindings.find(b => b.discordChannelId === parentId);
                    if (parentBinding)
                        parentAsdfId = parentBinding.asdfChannelId;
                }
            }
            // 同一サーバーかつ同一type、同一名前で未バインドの既存チャンネルがあれば再利用
            let targetAsdfCh = existingChannels.find(c => c.server_id === gid && c.type === chType && c.name.toLowerCase() === ch.name.toLowerCase() && !boundAsdfIds.has(c.id));
            if (!targetAsdfCh && deps.createAsdfChannel) {
                targetAsdfCh = (await deps.createAsdfChannel(ch.name, chType, pos, gid, parentAsdfId)) || undefined;
                if (targetAsdfCh) {
                    existingChannels.push(targetAsdfCh);
                    totalCreated++;
                }
            }
            if (targetAsdfCh) {
                await addDiscordBinding(ch.id, targetAsdfCh.id, gid);
                boundDiscordIds.add(ch.id);
                boundAsdfIds.add(targetAsdfCh.id);
                totalBound++;
            }
        }
    }
    if (totalCreated > 0 || totalBound > 0) {
        if (deps?.onBindingsUpdated) {
            deps.onBindingsUpdated();
        }
    }
    return { createdCount: totalCreated, boundCount: totalBound };
}
let autoSyncTimer = null;
function startChannelAutoSyncTimer() {
    if (autoSyncTimer)
        clearInterval(autoSyncTimer);
    // 10分間隔で走査 (Discord APIのキャッシュを参照するためレートリミット消費なし)
    autoSyncTimer = setInterval(async () => {
        try {
            await syncGuildChannels();
        }
        catch (err) {
            console.warn('[discord] auto sync channels error:', err.message);
        }
    }, 10 * 60 * 1000);
}
// Discord 側の編集: 本文が変わっていれば asdfbase の該当メッセージも書き換える
async function handleDiscordEdit(msg) {
    if (!isGuildAllowed(msg.guildId))
        return;
    const full = msg.partial ? await msg.fetch().catch(() => null) : msg;
    if (!full || isOurEchoMessage(full))
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
// asdfbase のメッセージを連携先の Discord チャンネルへ送信 (Webhook によるアイコン・名前直接反映)。送った Discord メッセージを返す (空なら未送信)
async function relayToDiscordBot(asdfChannelId, username, content, replyTargetDiscordMessageId, avatarUrl, replyQuote) {
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
    const baseOrigin = process.env.PUBLIC_ORIGIN || process.env.BASE_URL || 'https://asdfbase.onrender.com';
    const resolvedAvatarUrl = avatarUrl
        ? (avatarUrl.startsWith('http') ? avatarUrl : `${baseOrigin.replace(/\/+$/, '')}/${avatarUrl.replace(/^\/+/, '')}`)
        : undefined;
    const sent = [];
    for (const t of targets) {
        try {
            const ch = (await client.channels.fetch(t.discordChannelId));
            if (!ch || !isGuildAllowed(ch.guildId))
                continue;
            const guild = ch.guild;
            const mentionResolvedText = await resolveDiscordMentions(guild, isVideoMsg ? VIDEO_NOTICE : text);
            const body = mentionResolvedText.slice(0, 1900);
            const fullContent = (replyQuote ? `${replyQuote}${body}` : body) || (files.length > 0 ? '' : ' ');
            const webhook = await getOrCreateWebhook(ch);
            if (webhook) {
                const payload = {
                    username: username.slice(0, 80),
                    avatarURL: resolvedAvatarUrl,
                    content: fullContent.slice(0, 2000),
                    files: isVideoMsg ? [] : files,
                    allowedMentions: { parse: ['users', 'roles', 'everyone'] },
                };
                const m = await webhook.send(payload);
                if (m?.id) {
                    ourWebhookIds.add(webhook.id);
                    sent.push({ discordChannelId: t.discordChannelId, discordMessageId: m.id });
                    continue;
                }
            }
            // Webhook が使えない場合のフォールバック (Bot送信)
            if ('send' in ch) {
                const payload = {
                    content: `**${username}**${fullContent ? `: ${fullContent}` : ''}`.slice(0, 2000),
                    files: isVideoMsg ? [] : files,
                    allowedMentions: { parse: ['users', 'roles', 'everyone'] },
                };
                if (replyTargetDiscordMessageId) {
                    payload.reply = { messageReference: replyTargetDiscordMessageId, failIfNotExists: false };
                }
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
        const customMatch = emoji.match(/^<a?:([a-zA-Z0-9_]+):([0-9]+)>$/);
        const emojiName = customMatch ? customMatch[1] : emoji.replace(/^:+|:+$/g, '').replace(/\uFE0F/g, '');
        const emojiId = customMatch ? customMatch[2] : null;
        const rx = msg.reactions.resolve(emoji)
            || msg.reactions.resolve(emojiId || '')
            || msg.reactions.cache.find((r) => (emojiId && r.emoji.id === emojiId) ||
                r.emoji.name === emoji ||
                r.emoji.name === emojiName ||
                r.emoji.name?.replace(/\uFE0F/g, '') === emojiName ||
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
            if (emojiId) {
                await msg.react(emojiId).catch(async () => {
                    await msg.react(emoji).catch(() => { });
                });
            }
            else {
                await msg.react(emoji).catch(async () => {
                    const guild = msg.guild;
                    const customEmoji = guild?.emojis.cache.find((e) => e.name === emojiName);
                    if (customEmoji)
                        await msg.react(customEmoji).catch(() => { });
                });
            }
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
// 編集の Discord 反映: 元メッセージを削除して新しいメッセージを送信し、新しいリンク一覧を返す
async function editRelayedOnDiscord(links, username, content, avatarUrl) {
    if (!client || !connected || links.length === 0)
        return [];
    const files = [];
    const text = content
        .replace(/!\[[^\]]*\]\((\/uploads\/[^)\s]+)\)/g, (_m, p) => {
        if (deps) {
            const f = path_1.default.join(deps.uploadDir, path_1.default.basename(p));
            if (fs_1.default.existsSync(f))
                files.push(f);
        }
        return '';
    })
        .trim();
    const isVideoMsg = content.trim() === VIDEO_NOTICE;
    let resolvedAvatarUrl;
    if (avatarUrl) {
        if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
            resolvedAvatarUrl = avatarUrl;
        }
        else if (avatarUrl.startsWith('/')) {
            const publicBase = process.env.PUBLIC_URL || 'https://asdf.rds9.net';
            resolvedAvatarUrl = `${publicBase.replace(/\/$/, '')}${avatarUrl}`;
        }
    }
    const updatedLinks = [];
    for (const l of links) {
        try {
            const ch = (await client.channels.fetch(l.discordChannelId));
            if (!ch || !isGuildAllowed(ch.guildId))
                continue;
            const guild = ch.guild;
            const mentionResolvedText = await resolveDiscordMentions(guild, isVideoMsg ? VIDEO_NOTICE : text);
            const body = mentionResolvedText.slice(0, 2000);
            const webhook = await getOrCreateWebhook(ch);
            // 1. Webhook でその場編集を試みる (新規再投稿による順序狂い・スレッド破壊を防止)
            if (webhook) {
                try {
                    const payload = {
                        content: body || (files.length > 0 ? '' : ' '),
                        files: isVideoMsg ? [] : files,
                        allowedMentions: { parse: ['users', 'roles', 'everyone'] },
                    };
                    await webhook.editMessage(l.discordMessageId, payload);
                    ourWebhookIds.add(webhook.id);
                    // メッセージIDはそのまま維持
                    continue;
                }
                catch (err) {
                    console.warn(`[discord] webhook.editMessage failed for ${l.discordMessageId}, trying bot edit/delete fallback:`, err.message);
                }
            }
            // 2. 通常Botメッセージとして編集を試みる
            if ('messages' in ch) {
                const oldMsg = await ch.messages.fetch(l.discordMessageId).catch(() => null);
                if (oldMsg && oldMsg.editable) {
                    await oldMsg.edit({
                        content: `**${username}**${body ? `: ${body}` : ''}`.slice(0, 2000),
                        files: isVideoMsg ? [] : files,
                        allowedMentions: { parse: ['users', 'roles', 'everyone'] },
                    });
                    continue;
                }
            }
            // 3. 編集がどうしてもできない場合のみ削除して再送信フォールバック
            let deletedOld = false;
            if (webhook) {
                try {
                    await webhook.deleteMessage(l.discordMessageId);
                    deletedOld = true;
                }
                catch (_) { }
            }
            if (!deletedOld && 'messages' in ch) {
                const oldMsg = await ch.messages.fetch(l.discordMessageId).catch(() => null);
                if (oldMsg && oldMsg.deletable) {
                    await oldMsg.delete().catch(() => { });
                }
            }
            if (webhook) {
                const payload = {
                    username: username.slice(0, 80),
                    avatarURL: resolvedAvatarUrl,
                    content: body || (files.length > 0 ? '' : ' '),
                    files: isVideoMsg ? [] : files,
                    allowedMentions: { parse: ['users', 'roles', 'everyone'] },
                };
                const m = await webhook.send(payload);
                if (m?.id) {
                    ourWebhookIds.add(webhook.id);
                    updatedLinks.push({
                        discordChannelId: l.discordChannelId,
                        oldDiscordMessageId: l.discordMessageId,
                        newDiscordMessageId: m.id,
                    });
                    continue;
                }
            }
            if ('send' in ch) {
                const payload = {
                    content: `**${username}**${body ? `: ${body}` : ''}`.slice(0, 2000),
                    files: isVideoMsg ? [] : files,
                    allowedMentions: { parse: ['users', 'roles', 'everyone'] },
                };
                const m = await ch.send(payload);
                if (m?.id) {
                    updatedLinks.push({
                        discordChannelId: l.discordChannelId,
                        oldDiscordMessageId: l.discordMessageId,
                        newDiscordMessageId: m.id,
                    });
                }
            }
        }
        catch (err) {
            lastError = `編集の反映に失敗: ${err.message}`;
            console.error('[discord] edit relay failed:', err.message);
        }
    }
    return updatedLinks;
}
// asdfbase で削除されたメッセージを Discord 側でも削除 (権限不足時は「メッセージが削除されました」に編集)
async function deleteRelayedOnDiscord(links) {
    if (!client || !connected || links.length === 0)
        return false;
    let deleted = false;
    for (const l of links) {
        try {
            const ch = (await client.channels.fetch(l.discordChannelId));
            if (!ch || !isGuildAllowed(ch.guildId))
                continue;
            // 1. Webhook で送信されたメッセージの削除を試みる
            const webhook = await getOrCreateWebhook(ch);
            if (webhook) {
                try {
                    await webhook.deleteMessage(l.discordMessageId);
                    deleted = true;
                    continue;
                }
                catch {
                    // Webhook による削除が失敗した場合は下記へフォールバック
                }
            }
            // 2. 通常のメッセージ取得・削除
            if ('messages' in ch) {
                const m = await ch.messages.fetch(l.discordMessageId).catch(() => null);
                if (m) {
                    if (m.deletable) {
                        await m.delete();
                        deleted = true;
                    }
                    else if (m.editable) {
                        await m.edit({ content: '*(メッセージが削除されました)*', allowedMentions: { parse: [] } });
                        deleted = true;
                    }
                }
            }
        }
        catch (err) {
            console.error('[discord] delete relay failed:', err.message);
        }
    }
    return deleted;
}
function discordUserIdToPseudoId(discordUserId) {
    return -Math.abs(Array.from(String(discordUserId)).reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0)) || -1;
}
// Discord メッセージのリアクションユーザーおよびキャッシュ済みユーザーから pseudoId -> 表示名 を解決
async function resolveDiscordReactionUsers(links) {
    const result = new Map();
    if (!client || !connected)
        return result;
    // 1. キャッシュ済みの全サーバーメンバー・ユーザーを走査
    for (const guild of client.guilds.cache.values()) {
        for (const m of guild.members.cache.values()) {
            const pid = discordUserIdToPseudoId(m.id);
            const name = m.displayName || m.user.globalName || m.user.username;
            if (name)
                result.set(pid, name);
        }
    }
    for (const u of client.users.cache.values()) {
        const pid = discordUserIdToPseudoId(u.id);
        if (!result.has(pid)) {
            const name = u.globalName || u.username;
            if (name)
                result.set(pid, name);
        }
    }
    // 2. 対象メッセージのリアクションユーザーを Discord API から直接取得
    for (const l of links) {
        try {
            const ch = (await client.channels.fetch(l.discordChannelId).catch(() => null));
            if (!ch || !('messages' in ch))
                continue;
            const guild = ch.guild;
            const msg = await ch.messages.fetch(l.discordMessageId).catch(() => null);
            if (!msg)
                continue;
            for (const reaction of msg.reactions.cache.values()) {
                const users = await reaction.users.fetch().catch(() => null);
                if (!users)
                    continue;
                for (const u of users.values()) {
                    if (u.bot && client.user && u.id === client.user.id)
                        continue;
                    const pid = discordUserIdToPseudoId(u.id);
                    const member = guild?.members?.cache?.get(u.id) || (await guild?.members?.fetch(u.id).catch(() => null));
                    const name = member?.displayName || u.globalName || u.username;
                    if (name)
                        result.set(pid, name);
                }
            }
        }
        catch {
            // ignore fetch errors
        }
    }
    return result;
}
function createClient(_withMessageContent) {
    // 特権インテント (GuildMembers, GuildPresences, MessageContent) を全て有効化 + DM インテント
    const intents = [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMembers,
        discord_js_1.GatewayIntentBits.GuildPresences,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.GuildMessageTyping,
        discord_js_1.GatewayIntentBits.GuildMessageReactions,
        discord_js_1.GatewayIntentBits.GuildVoiceStates,
        discord_js_1.GatewayIntentBits.MessageContent,
        discord_js_1.GatewayIntentBits.DirectMessages,
        discord_js_1.GatewayIntentBits.DirectMessageTyping,
        discord_js_1.GatewayIntentBits.DirectMessageReactions,
    ];
    return new discord_js_1.Client({
        intents,
        // キャッシュしていないメッセージの編集・リアクションも受け取る
        partials: [discord_js_1.Partials.Message, discord_js_1.Partials.Channel, discord_js_1.Partials.Reaction, discord_js_1.Partials.GuildMember, discord_js_1.Partials.User],
        makeCache: discord_js_1.Options.cacheWithLimits({
            ...discord_js_1.Options.DefaultMakeCacheSettings,
            MessageManager: 0,
            PresenceManager: 2000,
            ReactionManager: 0,
            GuildMemberManager: 2000,
            UserManager: 2000,
            GuildEmojiManager: 0,
            GuildStickerManager: 0,
            VoiceStateManager: 50,
        }),
    });
}
function getDiscordUserPresence(discordUserId) {
    if (!client)
        return { status: 'offline', activity: null };
    for (const guild of client.guilds.cache.values()) {
        const member = guild.members.cache.get(discordUserId);
        if (member) {
            const p = member.presence;
            const status = (p?.status || (member.voice?.channelId ? 'online' : 'offline'));
            const acts = p?.activities || [];
            const gameAct = acts.find(a => a.type === 0 || a.type === 1 || a.type === 2 || a.type === 3 || a.type === 5);
            const customAct = acts.find(a => a.type === 4);
            const activityText = gameAct ? `${gameAct.name}${gameAct.details ? `: ${gameAct.details}` : ''}` : (customAct?.state || null);
            if (status !== 'offline') {
                return { status, activity: activityText };
            }
        }
    }
    return { status: 'offline', activity: null };
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
            // ダウンタイム中の未取得メッセージを自動でバックグラウンド取得 (直近1時間以内のみ)
            syncDiscordHistory({ limit: 10, maxAgeHours: 1 }).catch(err => console.warn('[discord] startup history sync error:', err.message));
            // 起動時に全チャンネルを自動走査して同期 & 10分おきの自動定期走査を開始
            syncGuildChannels().catch(err => console.warn('[discord] startup channel sync error:', err.message));
            startChannelAutoSyncTimer();
            // 全サーバーのメンバー一覧とオンラインプレゼンスをキャッシュにロード
            for (const guild of ready.guilds.cache.values()) {
                guild.members.fetch({ withPresences: true }).catch(err => {
                    console.warn(`[discord] Failed to fetch members with presences for ${guild.name}:`, err.message);
                });
            }
        });
        c.on(discord_js_1.Events.ShardDisconnect, () => {
            connected = false;
        });
        c.on(discord_js_1.Events.ShardResume, () => {
            connected = true;
            syncDiscordHistory({ limit: 10, maxAgeHours: 1 }).catch(() => { });
        });
        c.on(discord_js_1.Events.ShardReady, () => {
            connected = true;
        });
        c.on(discord_js_1.Events.PresenceUpdate, () => {
            // メンバーのステータス変更時にサーバーキャッシュを無効化
            cachedDiscordServers = null;
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
        c.on(discord_js_1.Events.MessageBulkDelete, messages => {
            try {
                if (!deps?.ingestDelete)
                    return;
                for (const m of messages.values()) {
                    if (m.guildId && !isGuildAllowed(m.guildId))
                        continue;
                    deps.ingestDelete(m.id).catch(() => { });
                }
            }
            catch (err) {
                console.error('[discord] bulkDelete error:', err.message);
            }
        });
        c.on(discord_js_1.Events.MessageReactionAdd, async (reaction, user) => {
            try {
                if (user.partial)
                    await user.fetch().catch(() => { });
                if (user.bot)
                    return;
                const fullRx = reaction.partial ? await reaction.fetch().catch(() => reaction) : reaction;
                const fullMsg = fullRx.message.partial ? await fullRx.message.fetch().catch(() => null) : fullRx.message;
                if (!fullMsg || !isGuildAllowed(fullMsg.guildId))
                    return;
                const emojiName = fullRx.emoji.name;
                if (!emojiName || !deps?.ingestReaction)
                    return;
                const finalEmoji = fullRx.emoji.id
                    ? `<${fullRx.emoji.animated ? 'a' : ''}:${emojiName}:${fullRx.emoji.id}>`
                    : emojiName;
                const member = fullMsg.guild
                    ? (fullMsg.guild.members.cache.get(user.id) || await fullMsg.guild.members.fetch(user.id).catch(() => null))
                    : null;
                const senderName = member?.displayName || user.globalName || user.username || undefined;
                await deps.ingestReaction(fullMsg.id, finalEmoji, user.id, 'add', senderName);
            }
            catch (err) {
                console.error('[discord] reactionAdd failed:', err.message);
            }
        });
        c.on(discord_js_1.Events.MessageReactionRemove, async (reaction, user) => {
            try {
                if (user.partial)
                    await user.fetch().catch(() => { });
                if (user.bot)
                    return;
                const fullRx = reaction.partial ? await reaction.fetch().catch(() => reaction) : reaction;
                const messageId = fullRx.message?.id || reaction.message?.id;
                const guildId = fullRx.message?.guildId || reaction.message?.guildId;
                if (guildId && !isGuildAllowed(guildId))
                    return;
                const emojiName = fullRx.emoji?.name || reaction.emoji?.name;
                const emojiId = fullRx.emoji?.id || reaction.emoji?.id;
                if (!emojiName || !messageId || !deps?.ingestReaction)
                    return;
                const isAnimated = Boolean(fullRx.emoji?.animated || reaction.emoji?.animated);
                const finalEmoji = emojiId
                    ? `<${isAnimated ? 'a' : ''}:${emojiName}:${emojiId}>`
                    : emojiName;
                const guild = fullRx.message?.guild || reaction.message?.guild;
                const member = guild
                    ? (guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null))
                    : null;
                const senderName = member?.displayName || user.globalName || user.username || undefined;
                await deps.ingestReaction(messageId, finalEmoji, user.id, 'remove', senderName);
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
        // 新規チャンネル作成時の即時自動同期 (テキスト & VC)
        c.on(discord_js_1.Events.ChannelCreate, async (channel) => {
            try {
                const guildId = channel.guildId || channel.guild?.id;
                if (guildId && isGuildAllowed(guildId)) {
                    await syncGuildChannels(guildId);
                }
            }
            catch (err) {
                console.error('[discord] channelCreate sync failed:', err.message);
            }
        });
        // チャンネル削除時のバインド解除
        c.on(discord_js_1.Events.ChannelDelete, async (channel) => {
            try {
                const guildId = channel.guildId || channel.guild?.id;
                if (guildId && isGuildAllowed(guildId)) {
                    await removeDiscordBinding({ discordChannelId: channel.id });
                    deps?.onBindingsUpdated?.();
                }
            }
            catch (err) {
                console.error('[discord] channelDelete cleanup failed:', err.message);
            }
        });
        // スレッド作成・削除・同期イベントの検知
        c.on(discord_js_1.Events.ThreadCreate, async (thread) => {
            try {
                const guildId = thread.guildId || thread.guild?.id;
                if (guildId && isGuildAllowed(guildId)) {
                    await handleThreadAutoBind(thread);
                }
            }
            catch (err) {
                console.error('[discord] threadCreate handling failed:', err.message);
            }
        });
        c.on(discord_js_1.Events.ThreadDelete, async (thread) => {
            try {
                const guildId = thread.guildId || thread.guild?.id;
                if (guildId && isGuildAllowed(guildId)) {
                    await removeDiscordBinding({ discordChannelId: thread.id });
                    deps?.onBindingsUpdated?.();
                }
            }
            catch (err) {
                console.error('[discord] threadDelete cleanup failed:', err.message);
            }
        });
        c.on(discord_js_1.Events.ThreadListSync, async (threads, guild) => {
            try {
                if (guild && isGuildAllowed(guild.id)) {
                    for (const thread of threads.values()) {
                        await handleThreadAutoBind(thread);
                    }
                }
            }
            catch (err) {
                console.error('[discord] threadListSync handling failed:', err.message);
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
                if (typing.user?.bot)
                    return;
                if (!typing.guild) {
                    if (deps?.onDmTyping) {
                        deps.onDmTyping(typing.user.id);
                    }
                    return;
                }
                if (!isGuildAllowed(typing.guild?.id))
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
// ---------------- DM (ダイレクトメッセージ) 送信・管理関数 ----------------
async function sendDiscordDm(discordUserId, text, attachments) {
    if (!client || !connected) {
        throw new Error('Discord Bot が起動または接続されていません');
    }
    try {
        const user = await client.users.fetch(discordUserId);
        if (!user)
            throw new Error('Discord ユーザーが見つかりません');
        const files = [];
        if (attachments && attachments.length > 0 && deps?.uploadDir) {
            for (const att of attachments) {
                const cleanPath = att.url.replace(/^\/uploads\//, '');
                const localPath = path_1.default.join(deps.uploadDir, cleanPath);
                if (fs_1.default.existsSync(localPath)) {
                    files.push({ attachment: localPath, name: att.name || path_1.default.basename(localPath) });
                }
            }
        }
        const payload = {};
        if (text && text.trim())
            payload.content = text;
        if (files.length > 0)
            payload.files = files;
        if (!payload.content && (!payload.files || payload.files.length === 0)) {
            throw new Error('送信内容がありません');
        }
        const sent = await user.send(payload);
        return sent.id;
    }
    catch (err) {
        if (err.code === 50278 || err.code === 50007 || (typeof err.message === 'string' && err.message.includes('mutual guilds'))) {
            throw new Error('相手のDiscord設定で、共通サーバーからのダイレクトメッセージが許可されていません。相手にDiscordでサーバー設定（プライバシー設定 → ダイレクトメッセージ）をONにしてもらってください。');
        }
        console.error(`[discord] sendDiscordDm failed to ${discordUserId}:`, err.message);
        throw err;
    }
}
async function deleteDiscordDm(discordUserId, discordMessageId) {
    if (!client || !connected)
        return false;
    try {
        const user = await client.users.fetch(discordUserId);
        const dmChannel = user.dmChannel || (await user.createDM());
        const msg = await dmChannel.messages.fetch(discordMessageId).catch(() => null);
        if (msg && msg.deletable) {
            await msg.delete().catch(() => { });
            return true;
        }
        return false;
    }
    catch (err) {
        console.warn('[discord] deleteDiscordDm error:', err);
        return false;
    }
}
async function triggerDiscordDmTyping(discordUserId) {
    if (!client || !connected)
        return;
    try {
        const user = await client.users.fetch(discordUserId);
        const dmChannel = user.dmChannel || (await user.createDM());
        await dmChannel.sendTyping().catch(() => { });
    }
    catch {
        // ignore
    }
}
