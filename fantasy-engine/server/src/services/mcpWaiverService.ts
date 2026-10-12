import axios from 'axios';
import { ESPNApiService, getCurrentNFLSeasonYear } from './espnApi';

export interface WaiverTarget {
  id: number;
  name: string;
  position: string;
  team: string;
  image: string | null;
  projectedPoints: number;
  actualPoints: number;
  percentOwned: number;
  percentStarted: number;
  priority: number;
  priorityLabel: 'Höchste Priorität' | 'Hohe Priorität' | 'Solider Starter' | 'Geheimtipp / Sleeper' | 'Kader-Tiefe';
  suggestedFaab: number;
  reasons: string[];
  suggestedDrop?: {
    id: number;
    name: string;
    position: string;
    slot: string;
  };
}

export interface DropCandidate {
  id: number;
  name: string;
  position: string;
  slot: string;
  injury: string;
  projectedPoints: number;
  reason: string;
}

export interface WaiverAnalysisResult {
  week: number;
  season: number;
  leagueId: string;
  teamId: string;
  teamName: string;
  updatedAt: string;
  aiBriefing: {
    urgency: 'HOCH' | 'MITTEL' | 'NORMAL';
    headline: string;
    injuredStarters: Array<{ name: string; position: string; status: string }>;
    keyAdvice: string[];
    fullAnalysis: string;
    source: 'gemini' | 'algorithmic';
  };
  dropCandidates: DropCandidate[];
  targets: WaiverTarget[];
}

interface RosterPlayerItem {
  id: number;
  name: string;
  position: string;
  slot: string;
  isBench: boolean;
  injury: string;
  projectedPoints: number;
  actualPoints: number | null;
  hasPlayed: boolean;
  percentOwned: number;
  percentStarted: number;
}

const positionsMap: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
  6: 'DT',
  7: 'DE',
  8: 'LB',
  9: 'DL',
  10: 'CB',
  11: 'S',
  12: 'DB',
  13: 'DP',
  14: 'P',
  15: 'HC'
};

const slotsMap: Record<number, string> = {
  0: 'QB',
  1: 'TQB',
  2: 'RB',
  3: 'RB/WR',
  4: 'WR',
  5: 'WR/TE',
  6: 'TE',
  7: 'OP',
  8: 'DT',
  9: 'DE',
  10: 'LB',
  11: 'DL',
  12: 'CB',
  13: 'S',
  14: 'DB',
  15: 'DP',
  16: 'D/ST',
  17: 'K',
  18: 'P',
  19: 'HC',
  20: 'BN',
  21: 'IR',
  22: 'RES',
  23: 'FLEX',
  24: 'UTIL',
  25: 'SUPERFLEX'
};

const proTeams: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL',
  7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC',
  13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO',
  19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX',
  33: 'BAL', 34: 'HOU'
};

export class MCPWaiverService {
  private espn: ESPNApiService;

  constructor(espnService?: ESPNApiService) {
    this.espn = espnService || new ESPNApiService();
  }

  private extractProjectedPoints(stats: any[], week: number): number {
    if (!Array.isArray(stats)) return 0;
    // Look for week projection: statSourceId === 1 && scoringPeriodId === week
    const weekly = stats.find((s: any) => s.statSourceId === 1 && s.scoringPeriodId === week);
    if (weekly && typeof weekly.appliedTotal === 'number') {
      return Math.round(weekly.appliedTotal * 10) / 10;
    }
    // Fallback: any weekly projection with statSourceId === 1 and reasonable points (< 50)
    const anyProj = stats.find((s: any) => s.statSourceId === 1 && s.appliedTotal > 0 && s.appliedTotal < 50);
    if (anyProj && typeof anyProj.appliedTotal === 'number') {
      return Math.round(anyProj.appliedTotal * 10) / 10;
    }
    // Fallback: estimate from season total
    const seasonProj = stats.find((s: any) => s.statSourceId === 1 && s.appliedTotal > 50);
    if (seasonProj && typeof seasonProj.appliedTotal === 'number') {
      return Math.round((seasonProj.appliedTotal / 17) * 10) / 10;
    }
    return 0;
  }

  private extractActualPoints(stats: any[], week: number): number {
    if (!Array.isArray(stats)) return 0;
    const weekly = stats.find((s: any) => s.statSourceId === 0 && s.scoringPeriodId === week);
    return weekly && typeof weekly.appliedTotal === 'number' ? Math.round(weekly.appliedTotal * 10) / 10 : 0;
  }

  async analyzeWaiversForTeam(
    leagueId: string,
    teamId: string,
    options: {
      position?: string;
      maxResults?: number;
      forceAiRefresh?: boolean;
    } = {}
  ): Promise<WaiverAnalysisResult> {
    const { position = 'ALL', maxResults = 25 } = options;

    // 1. Fetch dashboard to get team roster, week, and settings
    const dashboard = await this.espn.getDashboard(leagueId);
    const week = dashboard.scoringPeriodId || 1;
    const season = dashboard.seasonId || getCurrentNFLSeasonYear();

    const team = dashboard.teams.find((t: any) => String(t.id) === String(teamId));
    if (!team) {
      throw new Error(`Team ${teamId} in Liga ${leagueId} nicht gefunden.`);
    }

    const teamName = team.name || [team.location, team.nickname].filter(Boolean).join(' ') || `Team ${team.id}`;
    const rawRoster = team.roster?.entries || [];

    // 2. Parse current roster
    const rosterPlayers: RosterPlayerItem[] = rawRoster.map((entry: any): RosterPlayerItem => {
      const p = entry.playerPoolEntry?.player || {};
      const posId = p.defaultPositionId;
      const slotId = entry.lineupSlotId;
      const pos = positionsMap[posId] || slotsMap[slotId] || '-';
      const slot = slotsMap[slotId] || '-';
      const injury = p.injuryStatus || 'ACTIVE';
      const stats = p.stats || [];
      const actualStat = stats.find((s: any) => s.statSourceId === 0 && s.scoringPeriodId === week);
      const proj = this.extractProjectedPoints(stats, week);
      const actual = actualStat && typeof actualStat.appliedTotal === 'number'
        ? Math.round(actualStat.appliedTotal * 10) / 10
        : null;
      const isBench = slot === 'BN' || slot === 'IR';

      return {
        id: p.id || entry.playerId,
        name: p.fullName || 'Unbekannt',
        position: pos,
        slot,
        isBench,
        injury,
        projectedPoints: proj,
        actualPoints: actual,
        hasPlayed: actualStat != null,
        percentOwned: p.ownership?.percentOwned ?? 0,
        percentStarted: p.ownership?.percentStarted ?? 0
      };
    });

    // 3. Identify injured starters and drop candidates
    const starters = rosterPlayers.filter((p: RosterPlayerItem) => !p.isBench);
    const bench = rosterPlayers.filter((p: RosterPlayerItem) => p.isBench);

    const injuredStarters = starters.filter(
      (p: RosterPlayerItem) => p.injury && !['ACTIVE', 'NORMAL'].includes(p.injury.toUpperCase())
    );

    const dropCandidates: DropCandidate[] = bench
      .filter((p: RosterPlayerItem) => p.slot !== 'IR') // Keep actual IR slots
      .map((p: RosterPlayerItem) => {
        let reason = 'Bankspieler';
        const points = p.actualPoints != null && p.actualPoints > 0 ? p.actualPoints : p.projectedPoints;
        let dropScore = (p.percentOwned || 0) * 0.4 + points * 2;

        if (p.injury && ['OUT', 'IR'].includes(p.injury.toUpperCase())) {
          reason = `Verletzt (${p.injury}), blockiert Bankplatz`;
          dropScore -= 20;
        } else if (p.injury && !['ACTIVE', 'NORMAL'].includes(p.injury.toUpperCase())) {
          reason = `Angeschlagen (${p.injury})`;
          dropScore -= 8;
        } else if (p.percentOwned < 15) {
          reason = `Geringer Liga-Besitz (${p.percentOwned}%), leicht ersetzbar`;
          dropScore -= 10;
        } else if (p.projectedPoints < 5 && (!p.actualPoints || p.actualPoints < 5)) {
          reason = `Geringe Produktion (${p.projectedPoints} Proj. Pkt)`;
        } else {
          reason = `Rolle als Backup (${p.position})`;
        }

        return {
          id: p.id,
          name: p.name,
          position: p.position,
          slot: p.slot,
          injury: p.injury,
          projectedPoints: p.projectedPoints,
          actualPoints: p.actualPoints,
          hasPlayed: p.hasPlayed,
          dropScore,
          reason
        };
      })
      .sort((a, b) => a.dropScore - b.dropScore)
      .slice(0, 5)
      .map(({ dropScore, ...rest }) => rest);

    // 4. Fetch available players from ESPN
    const rawAvailable = await this.espn.getAvailablePlayers(leagueId, week);

    // Positions that the user might urgently need
    const injuredPositions = new Set(injuredStarters.map((s: RosterPlayerItem) => s.position));

    // 5. Transform and score available players
    const scoredTargets: WaiverTarget[] = [];

    for (const item of rawAvailable) {
      const p = item.player || item;
      const posId = p.defaultPositionId || 0;
      const pos = positionsMap[posId] || 'FLEX';
      const name = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim();
      if (!name || name === 'Unknown') continue;

      const proTeamId = p.proTeamId || 0;
      const teamAbbr = proTeams[proTeamId] || 'FA';
      const stats = p.stats || [];
      const proj = this.extractProjectedPoints(stats, week);
      const actual = this.extractActualPoints(stats, week);
      const ownership = p.ownership || {};
      const pctOwned = Math.round((ownership.percentOwned ?? 0) * 10) / 10;
      const pctStarted = Math.round((ownership.percentStarted ?? 0) * 10) / 10;

      // Filter by position if requested (and not 'ALL')
      if (position !== 'ALL') {
        const isDef = ['DT', 'DE', 'LB', 'DL', 'CB', 'S', 'DB', 'DP'].includes(pos);
        if (position === 'DEF') {
          if (!isDef) continue;
        } else if (pos !== position) {
          continue;
        }
      }

      // Calculate priority score (balancing projections, live results, and team needs)
      let priority = 0;
      const reasons: string[] = [];

      if (actual > 0) {
        // Player has played and produced points in the current week
        if (actual >= 15) {
          priority += 18;
          reasons.push(`Top-Spieltag in Woche ${week}: ${actual} Pkt erzielt!`);
        } else if (actual >= 10) {
          priority += 12;
          reasons.push(`Starke Ausbeute in Woche ${week}: ${actual} Pkt`);
        } else if (actual >= 6) {
          priority += 7;
          reasons.push(`Guter Spieltag (Woche ${week}): ${actual} Pkt`);
        } else {
          priority += 2;
          reasons.push(`Bereits gespielt (${actual} Pkt)`);
        }
      } else {
        // Player has not yet played in the current week
        if (proj >= 13) {
          priority += 14;
          reasons.push(`Starke Wochenprojektion: ${proj} Pkt`);
        } else if (proj >= 9) {
          priority += 9;
          reasons.push(`Solide Projektion: ${proj} Pkt`);
        } else if (proj >= 5) {
          priority += 5;
          reasons.push(`Projektion: ${proj} Pkt`);
        } else {
          priority += Math.max(1, Math.round(proj));
        }
      }

      // Rising usage
      if (pctStarted > 25) {
        priority += 4;
        reasons.push(`Hoher Starter-Anteil (${pctStarted}% gestartet)`);
      } else if (pctStarted > pctOwned - 10 && pctOwned > 10) {
        priority += 2;
        reasons.push(`Steigender Trend`);
      }

      // Sleeper bonus (low owned, good projection or breakout)
      if (pctOwned < 30 && (proj >= 7 || actual >= 7)) {
        priority += 3;
        reasons.push(`Geheimtipp (nur ${pctOwned}% im Besitz)`);
      }

      // Positional scarcity (RB/TE/QB)
      if (['RB', 'TE'].includes(pos) && (proj >= 6 || actual >= 6)) {
        priority += 3;
        reasons.push(`Knappe Position: ${pos}`);
      }

      // Positional team need
      if (injuredPositions.has(pos)) {
        priority += 7;
        const matchingStarter = injuredStarters.find((s: RosterPlayerItem) => s.position === pos);
        reasons.push(`Bedarf: Direkter Ersatz für ${matchingStarter ? matchingStarter.name : 'Verletzung'} (${pos})`);
      }

      // Match best drop candidate from bench (position aware)
      let bestDrop: DropCandidate | undefined;
      if (pos === 'K') {
        bestDrop = dropCandidates.find(d => d.position === 'K');
      } else if (['D/ST', 'DST'].includes(pos)) {
        bestDrop = dropCandidates.find(d => ['D/ST', 'DST'].includes(d.position));
      } else if (['DT', 'DE', 'LB', 'DL', 'CB', 'S', 'DB', 'DP'].includes(pos)) {
        bestDrop = dropCandidates.find(d => ['DT', 'DE', 'LB', 'DL', 'CB', 'S', 'DB', 'DP'].includes(d.position)) || dropCandidates[0];
      } else {
        bestDrop = dropCandidates.find(d => d.position === pos) || dropCandidates.find(d => !['K', 'D/ST', 'DST'].includes(d.position)) || dropCandidates[0];
      }

      scoredTargets.push({
        id: p.id,
        name,
        position: pos,
        team: teamAbbr,
        image: p.id && pos !== 'D/ST' ? `https://a.espncdn.com/i/headshots/nfl/players/full/${p.id}.png` : null,
        projectedPoints: proj,
        actualPoints: actual,
        percentOwned: pctOwned,
        percentStarted: pctStarted,
        priority,
        priorityLabel: 'Kader-Tiefe',
        suggestedFaab: 1,
        reasons,
        suggestedDrop: bestDrop
          ? {
              id: bestDrop.id,
              name: bestDrop.name,
              position: bestDrop.position,
              slot: bestDrop.slot
            }
          : undefined
      });
    }

    // Sort by priority descending, breaking ties with actual and projected points
    scoredTargets.sort((a: WaiverTarget, b: WaiverTarget) =>
      b.priority - a.priority ||
      (b.actualPoints || 0) - (a.actualPoints || 0) ||
      b.projectedPoints - a.projectedPoints
    );

    // Differentiate Priority Labels based on relative rank and performance
    scoredTargets.forEach((target, index) => {
      const bestScore = target.actualPoints && target.actualPoints > 0 ? target.actualPoints : target.projectedPoints;
      if (index <= 1 || (index === 2 && target.priority >= 18)) {
        target.priorityLabel = 'Höchste Priorität';
        target.suggestedFaab = Math.min(30, Math.max(12, Math.floor(bestScore * 1.5)));
      } else if (index <= 5) {
        target.priorityLabel = 'Hohe Priorität';
        target.suggestedFaab = Math.min(18, Math.max(6, Math.floor(bestScore * 1.0)));
      } else if (index <= 14) {
        if (target.percentOwned < 30) {
          target.priorityLabel = 'Geheimtipp / Sleeper';
          target.suggestedFaab = Math.min(8, Math.max(2, Math.floor(target.projectedPoints * 0.6)));
        } else {
          target.priorityLabel = 'Solider Starter';
          target.suggestedFaab = Math.min(10, Math.max(4, Math.floor(target.projectedPoints * 0.7)));
        }
      } else {
        target.priorityLabel = 'Kader-Tiefe';
        target.suggestedFaab = Math.max(1, Math.floor(target.projectedPoints * 0.3));
      }
    });

    const topTargets = scoredTargets.slice(0, maxResults);

    // Extract current matchup details for context
    const currentMatch = dashboard.schedule?.find((s: any) =>
      s.matchupPeriodId === week &&
      (String(s.away?.teamId) === String(teamId) || String(s.home?.teamId) === String(teamId))
    );

    let matchupContext: { opponentName: string; teamScore: number; opponentScore: number; winProbability: number | null } | undefined;
    if (currentMatch) {
      const isHome = String(currentMatch.home?.teamId) === String(teamId);
      const myMatch = isHome ? currentMatch.home : currentMatch.away;
      const oppMatch = isHome ? currentMatch.away : currentMatch.home;
      const oppTeam = dashboard.teams?.find((t: any) => t.id === oppMatch?.teamId);
      const oppName = oppTeam ? (oppTeam.name || [oppTeam.location, oppTeam.nickname].filter(Boolean).join(' ') || `Team ${oppTeam.id}`) : 'Gegner';

      const teamScore = myMatch?.totalPointsLive ?? myMatch?.pointsByScoringPeriod?.[week] ?? 0;
      const opponentScore = oppMatch?.totalPointsLive ?? oppMatch?.pointsByScoringPeriod?.[week] ?? 0;
      const winProbability = myMatch?.winProbability != null ? Math.round(myMatch.winProbability * 100) : null;

      matchupContext = {
        opponentName: oppName,
        teamScore: Math.round(teamScore * 10) / 10,
        opponentScore: Math.round(opponentScore * 10) / 10,
        winProbability
      };
    }

    // 6. Generate AI briefing (using Gemini if key available, fallback algorithmic)
    const aiBriefing = await this.generateAIBriefing({
      week,
      season,
      teamName,
      wins: team.record?.overall?.wins ?? 0,
      losses: team.record?.overall?.losses ?? 0,
      matchupContext,
      starters,
      injuredStarters,
      dropCandidates,
      topTargets: topTargets.slice(0, 8)
    });

    return {
      week,
      season,
      leagueId,
      teamId,
      teamName,
      updatedAt: new Date().toISOString(),
      aiBriefing,
      dropCandidates,
      targets: topTargets
    };
  }

  private async generateAIBriefing(context: {
    week: number;
    season: number;
    teamName: string;
    wins: number;
    losses: number;
    matchupContext?: {
      opponentName: string;
      teamScore: number;
      opponentScore: number;
      winProbability: number | null;
    };
    starters: RosterPlayerItem[];
    injuredStarters: Array<{ name: string; position: string; injury: string }>;
    dropCandidates: DropCandidate[];
    topTargets: WaiverTarget[];
  }): Promise<WaiverAnalysisResult['aiBriefing']> {
    const { week, season, teamName, wins, losses, matchupContext, starters, injuredStarters, dropCandidates, topTargets } = context;

    const urgency: 'HOCH' | 'MITTEL' | 'NORMAL' =
      injuredStarters.length >= 2 ? 'HOCH' : injuredStarters.length === 1 ? 'MITTEL' : 'NORMAL';

    const injuredList = injuredStarters.map((s: { name: string; position: string; injury: string }) => ({
      name: s.name,
      position: s.position,
      status: s.injury || 'QUESTIONABLE'
    }));

    const playedStarters = starters.filter(s => s.hasPlayed);
    const pendingStarters = starters.filter(s => !s.hasPlayed);

    const geminiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-3.7-flash';

    if (geminiKey && geminiKey.trim()) {
      try {
        const prompt = `Du bist ein erfahrener ESPN Fantasy Football AI Co-Manager für Saison ${season}, Woche ${week}.
Team: "${teamName}" (${wins} Siege - ${losses} Niederlagen).
${matchupContext ? `Aktueller Matchup-Spielstand (Woche ${week}): ${teamName} (${matchupContext.teamScore} Pkt) vs. ${matchupContext.opponentName} (${matchupContext.opponentScore} Pkt) | Sieg-Chance: ${matchupContext.winProbability != null ? matchupContext.winProbability + '%' : 'offen'}` : ''}

Bereits gespielte Starter (Woche ${week}):
${playedStarters.length > 0 ? playedStarters.map(s => `- ${s.name} (${s.position}): ${s.actualPoints} Punkte erzielt`).join('\n') : '- Noch keine Starter mit beendetem Spiel'}

Noch ausstehende Starter:
${pendingStarters.length > 0 ? pendingStarters.map(s => `- ${s.name} (${s.position}): Proj. ${s.projectedPoints} Pkt, Status: ${s.injury}`).join('\n') : '- Alle Starter haben bereits gespielt'}

Top freie Spieler auf dem Waiver Wire (differenziert nach Priorität):
${topTargets.map((t: WaiverTarget, i: number) => `- [#${i+1} | ${t.priorityLabel}] ${t.name} (${t.position}, ${t.team}): ${t.actualPoints && t.actualPoints > 0 ? t.actualPoints + ' Pkt in W' + week + ' erzielt' : t.projectedPoints + ' Pkt projiziert'}, ${t.percentOwned}% im Besitz. Gründe: ${t.reasons.join(', ')} (FAAB: ${t.suggestedFaab}$)`).join('\n')}

Mögliche Drop-Kandidaten von der Bank:
${dropCandidates.map((d: DropCandidate) => `- ${d.name} (${d.position}, ${d.slot}): ${d.reason}`).join('\n')}

Erstelle ein prägnantes, professionelles Wochen-Briefing auf Deutsch:
1. Schlagzeile (1 prägnanter Satz zum Spieltag und aktuellen Matchup-Stand)
2. Matchup-Einschätzung & bereits erbrachte Leistungen der Starter
3. Wichtigste 1-2 Pickups für die kommende Waiver-Periode (unter Beachtung der Prioritätsstufen)
4. Konkreter Drop-Ratschlag (wer kann ohne Reue gehen, falls nötig)
5. FAAB-Empfehlung`;

        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${geminiKey}`,
          {
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 0.6,
              maxOutputTokens: 1200,
              thinkingConfig: { thinkingLevel: 'low' }
            }
          },
          { timeout: 14000 }
        );

        const candidates = response.data?.candidates;
        const text = candidates?.[0]?.content?.parts?.[0]?.text;

        if (text && text.trim().length > 30) {
          const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);

          let extractedHeadline = '';
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/Schlagzeile/i.test(line)) {
              const afterColon = line.split(/Schlagzeile:?/i)[1];
              if (afterColon && afterColon.replace(/[*#_]/g, '').trim().length > 10) {
                extractedHeadline = afterColon;
                break;
              }
              if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
                extractedHeadline = lines[i + 1];
                break;
              }
            }
          }

          if (!extractedHeadline) {
            for (const line of lines) {
              if (!line.startsWith('---') && !/^hier ist/i.test(line) && !/^guten/i.test(line) && !line.startsWith('#')) {
                extractedHeadline = line;
                break;
              }
            }
          }

          const cleanHeadline = (extractedHeadline || lines[0] || '')
            .replace(/^#+\s*|\*+/g, '')
            .replace(/^_+\s*|_+\s*$/g, '')
            .trim();

          const headline = cleanHeadline.length > 10
            ? cleanHeadline
            : `Woche ${week} Matchup & Waiver: ${matchupContext ? `${matchupContext.teamScore} - ${matchupContext.opponentScore} Pkt` : 'Kader optimieren'}`;

          const keyAdvice: string[] = [];
          for (const line of lines.slice(1)) {
            const clean = line.replace(/^[-*•\d.]\s*|\*+/g, '').trim();
            if (clean.length > 15 && keyAdvice.length < 4 && !clean.toLowerCase().includes('schlagzeile')) {
              keyAdvice.push(clean);
            }
          }

          const cleanedText = text
            .replace(/^Hier ist (?:dein|Ihr)[^\n]+\n*(?:---\n*)?/i, '')
            .trim();

          return {
            urgency,
            headline,
            injuredStarters: injuredList,
            keyAdvice: keyAdvice.length > 0 ? keyAdvice : [
              topTargets[0] ? `Top-Claim [${topTargets[0].priorityLabel}]: ${topTargets[0].name} (${topTargets[0].position}) für ${topTargets[0].suggestedFaab}$ FAAB priorisieren.` : 'Verfügbare Optionen prüfen.',
              dropCandidates[0] ? `Als Drop bietet sich ${dropCandidates[0].name} (${dropCandidates[0].position}) an.` : 'Bankplätze analysieren.'
            ],
            fullAnalysis: cleanedText || text,
            source: 'gemini'
          };
        }
      } catch (err: any) {
        console.warn('Gemini API call failed, falling back to algorithmic briefing:', err.message);
      }
    }

    // Algorithmic briefing fallback
    const topPick = topTargets[0];
    const topDrop = dropCandidates[0];

    const headline = matchupContext
      ? `Woche ${week}: ${teamName} (${matchupContext.teamScore}) vs. ${matchupContext.opponentName} (${matchupContext.opponentScore})${matchupContext.winProbability != null ? ` – Sieg-Chance ${matchupContext.winProbability}%` : ''}`
      : urgency === 'HOCH'
      ? `Woche ${week}: ${injuredStarters.length} Starter fraglich – Sofortige Absicherung empfohlen!`
      : `Woche ${week}: Solide Kaderlage – Gezielte Verstärkung über Waiver Wire nutzen.`;

    const keyAdvice: string[] = [];
    if (playedStarters.length > 0) {
      const topScorer = [...playedStarters].sort((a, b) => (b.actualPoints || 0) - (a.actualPoints || 0))[0];
      if (topScorer && (topScorer.actualPoints || 0) > 0) {
        keyAdvice.push(`Bester Starter der Woche: ${topScorer.name} (${topScorer.position}) mit ${topScorer.actualPoints} Punkten.`);
      }
    }
    if (topPick) {
      const bestPt = topPick.actualPoints && topPick.actualPoints > 0 ? `${topPick.actualPoints} Pkt erzielt` : `${topPick.projectedPoints} Proj. Pkt`;
      keyAdvice.push(`Priorität 1 [${topPick.priorityLabel}]: ${topPick.name} (${topPick.position}, ${topPick.team}) mit ${bestPt}.`);
    }
    if (topDrop) {
      keyAdvice.push(`Empfohlener Drop: ${topDrop.name} (${topDrop.position}) von der Bank entlassen (${topDrop.reason}).`);
    }
    if (topPick) {
      keyAdvice.push(`Empfohlenes FAAB-Gebot für ${topPick.name}: ca. ${topPick.suggestedFaab}$ FAAB.`);
    }

    const fullAnalysis = `### MCP Wochen-Analyse für Woche ${week}
**Lage:** ${headline}

**Matchup-Status:** ${matchupContext ? `${matchupContext.teamScore} : ${matchupContext.opponentScore} vs. ${matchupContext.opponentName} (Sieg-Wahrscheinlichkeit: ${matchupContext.winProbability ?? '-'}%)` : 'Kein Live-Matchup verfügbar'}

**Top-Empfehlungen:**
${topTargets.slice(0, 3).map((t: WaiverTarget, idx: number) => `${idx + 1}. [${t.priorityLabel}] **${t.name}** (${t.position}, ${t.team}): ${t.actualPoints && t.actualPoints > 0 ? `${t.actualPoints} Pkt erzielt` : `${t.projectedPoints} Proj. Pkt`} - ${t.reasons.join('; ')} (FAAB: ca. ${t.suggestedFaab}$)`).join('\n')}

**Drop-Kandidat:**
${topDrop ? `- **${topDrop.name}** (${topDrop.position}): ${topDrop.reason}` : '- Keine zwingenden Drops nötig.'}`;

    return {
      urgency,
      headline,
      injuredStarters: injuredList,
      keyAdvice,
      fullAnalysis,
      source: 'algorithmic'
    };
  }
}
