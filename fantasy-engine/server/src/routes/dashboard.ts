import { Router } from 'express';
import axios from 'axios';
import NodeCache from 'node-cache';
import { ESPNApiService, getCurrentNFLSeasonYear } from '../services/espnApi';
import { MCPWaiverService } from '../services/mcpWaiverService';

const router = Router();
const cache = new NodeCache({ stdTTL: 60 });
const waiverCache = new NodeCache({ stdTTL: 180 });
const positions: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };
const slots: Record<number, string> = { 0: 'QB', 1: 'TQB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP', 8: 'DT', 9: 'DE', 10: 'LB', 11: 'DL', 12: 'CB', 13: 'S', 14: 'DB', 15: 'DP', 16: 'D/ST', 17: 'K', 18: 'P', 19: 'HC', 20: 'BN', 21: 'IR', 22: 'RES', 23: 'FLEX', 24: 'UTIL', 25: 'SUPERFLEX' };

function configuredLeagues() {
  return [1, 2].flatMap(index => {
    const id = process.env[`LEAGUE_${index}_ID`];
    const teamId = process.env[`LEAGUE_${index}_TEAM_ID`];
    return id && teamId ? [{ key: String(index), id, teamId, name: process.env[`LEAGUE_${index}_NAME`] || `Liga ${index}` }] : [];
  });
}

router.get('/config', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({
    season: getCurrentNFLSeasonYear(),
    espnConfigured: Boolean(process.env.ESPN_S2 && process.env.ESPN_SWID),
    llmConfigured: ['GEMINI_API_KEY', 'CLAUDE_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY'].some(key => Boolean(process.env[key])),
    provider: process.env.PRIMARY_LLM_PROVIDER || 'gemini',
    leagues: configuredLeagues().map(({ key, name }) => ({ key, name }))
  });
});

router.get('/league/:key', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const league = configuredLeagues().find(item => item.key === req.params.key);
  if (!league) { res.status(404).json({ error: 'Liga nicht konfiguriert.' }); return; }
  if (!process.env.ESPN_S2 || !process.env.ESPN_SWID) {
    res.status(503).json({ error: 'ESPN-Zugangsdaten fehlen in der Container-Umgebung.' }); return;
  }
  const cached = cache.get(league.key);
  if (cached) { res.json(cached); return; }
  try {
    const service = new ESPNApiService();
    service.setCookies({ espn_s2: process.env.ESPN_S2, swid: process.env.ESPN_SWID });
    const data = await service.getDashboard(league.id);
    const team = data.teams.find((item: any) => String(item.id) === league.teamId);
    if (!team) { res.status(404).json({ error: 'Das konfigurierte Team wurde in dieser Liga nicht gefunden.' }); return; }
    const teamName = (item: any) => item.name || [item.location, item.nickname].filter(Boolean).join(' ') || `Team ${item.id}`;
    const result = {
      name: data.settings?.name || league.name,
      season: data.seasonId || getCurrentNFLSeasonYear(),
      week: data.scoringPeriodId,
      updatedAt: new Date().toISOString(),
      team: { name: teamName(team), wins: team.record?.overall?.wins ?? 0, losses: team.record?.overall?.losses ?? 0, ties: team.record?.overall?.ties ?? 0 },
      roster: [...(team.roster?.entries || [])].sort((first: any, second: any) => {
        const order = (slot: number) => slot === 20 ? 100 : slot === 21 ? 101 : slot;
        return order(first.lineupSlotId) - order(second.lineupSlotId);
      }).map((entry: any) => {
        const player = entry.playerPoolEntry?.player || {};
        const defensiveSlot = player.eligibleSlots?.find((slot: number) => slot >= 8 && slot <= 15);
        return { id: player.id || entry.playerId, name: player.fullName || 'Unbekannt', position: positions[player.defaultPositionId] || slots[defensiveSlot] || '-', slot: slots[entry.lineupSlotId] || '-', injury: player.injuryStatus || 'ACTIVE', image: player.id && player.defaultPositionId !== 16 ? `https://a.espncdn.com/i/headshots/nfl/players/full/${player.id}.png` : null };
      }),
      teams: data.teams.map((item: any) => ({ id: item.id, name: teamName(item), own: String(item.id) === league.teamId, wins: item.record?.overall?.wins ?? 0, losses: item.record?.overall?.losses ?? 0, points: item.record?.overall?.pointsFor ?? 0 })).sort((first: any, second: any) => second.wins - first.wins || second.points - first.points)
    };
    cache.set(league.key, result);
    res.json(result);
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    res.status(502).json({ error: status === 401 || status === 403 ? 'ESPN lehnt die Zugangsdaten ab. Bitte Cookies erneuern.' : status === 429 ? 'ESPN-Anfragelimit erreicht. Bitte spaeter erneut versuchen.' : 'ESPN-Daten derzeit nicht erreichbar. Saison, Liga-ID und Cookies pruefen.' });
  }
});

router.get('/league/:key/waivers', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const league = configuredLeagues().find(item => item.key === req.params.key);
  if (!league) { res.status(404).json({ error: 'Liga nicht konfiguriert.' }); return; }
  if (!process.env.ESPN_S2 || !process.env.ESPN_SWID) {
    res.status(503).json({ error: 'ESPN-Zugangsdaten fehlen in der Container-Umgebung.' }); return;
  }

  const position = (req.query.position as string) || 'ALL';
  const forceRefresh = req.query.refresh === 'true';
  const cacheKey = `waivers_${league.key}_${position}`;

  if (!forceRefresh) {
    const cached = waiverCache.get(cacheKey);
    if (cached) { res.json(cached); return; }
  }

  try {
    const service = new ESPNApiService();
    service.setCookies({ espn_s2: process.env.ESPN_S2, swid: process.env.ESPN_SWID });
    const waiverService = new MCPWaiverService(service);
    const result = await waiverService.analyzeWaiversForTeam(league.id, league.teamId, {
      position,
      maxResults: 30,
      forceAiRefresh: forceRefresh
    });
    waiverCache.set(cacheKey, result);
    res.json(result);
  } catch (error: any) {
    console.error('Waiver analysis error:', error);
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    res.status(502).json({
      error: status === 401 || status === 403
        ? 'ESPN lehnt die Zugangsdaten ab. Bitte Cookies erneuern.'
        : status === 429
        ? 'ESPN-Anfragelimit erreicht. Bitte spaeter erneut versuchen.'
        : `Fehler bei der Analyse der freien Spieler: ${error.message}`
    });
  }
});

export default router;