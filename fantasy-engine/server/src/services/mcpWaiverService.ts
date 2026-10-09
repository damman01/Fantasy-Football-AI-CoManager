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
      const proj = this.extractProjectedPoints(stats, week);
      const isBench = slot === 'BN' || slot === 'IR';

      return {
        id: p.id || entry.playerId,
        name: p.fullName || 'Unbekannt',
        position: pos,
        slot,
        isBench,
        injury,
        projectedPoints: proj,
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
      .map((p: RosterPlayerItem): DropCandidate => {
        let reason = 'Bankspieler';
        if (p.injury && !['ACTIVE', 'NORMAL'].includes(p.injury.toUpperCase())) {
          reason = `Verletzt / Fraglich (${p.injury}) mit wenig Perspektive`;
        } else if (p.projectedPoints < 4) {
          reason = `Sehr geringe Projektion (${p.projectedPoints} Pkt)`;
        } else if (p.percentStarted < 10) {
          reason = `Geringe Start-Quote (${p.percentStarted}%)`;
        } else {
          reason = `Niedrige Prio auf der Bank (${p.projectedPoints} Pkt)`;
        }
        return {
          id: p.id,
          name: p.name,
          position: p.position,
          slot: p.slot,
          injury: p.injury,
          projectedPoints: p.projectedPoints,
          reason
        };
      })
      .sort((a: DropCandidate, b: DropCandidate) => a.projectedPoints - b.projectedPoints)
      .slice(0, 5);

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

      // Calculate priority score
      let priority = Math.round(proj * 1.5);
      const reasons: string[] = [];

      // Scoring factors
      if (proj >= 11) {
        priority += 6;
        reasons.push(`Starke Wochenprojektion: ${proj} Pkt`);
      } else if (proj >= 8) {
        priority += 3;
        reasons.push(`Solide Projektion: ${proj} Pkt`);
      }

      // Rising usage
      if (pctStarted > pctOwned - 15 && pctOwned > 5) {
        priority += 4;
        reasons.push(`Steigender Trend (${pctStarted}% gestartet)`);
      }

      // Sleeper bonus (low owned, good projection)
      if (pctOwned < 35 && proj >= 7) {
        priority += 5;
        reasons.push(`Geheimtipp (nur ${pctOwned}% im Besitz)`);
      }

      // Positional scarcity
      if (['RB', 'TE'].includes(pos) && proj >= 6) {
        priority += 3;
        reasons.push(`Knappe Position: ${pos}`);
      }

      // Positional team need
      if (injuredPositions.has(pos)) {
        priority += 8;
        const matchingStarter = injuredStarters.find((s: RosterPlayerItem) => s.position === pos);
        reasons.push(`Direkter Ersatz für ${matchingStarter ? matchingStarter.name : 'Verletzung'} (${pos})`);
      }

      // Suggested FAAB
      let suggestedFaab = 1;
      let priorityLabel: WaiverTarget['priorityLabel'] = 'Kader-Tiefe';

      if (priority >= 20) {
        suggestedFaab = Math.min(30, Math.max(15, Math.floor(proj * 1.6)));
        priorityLabel = 'Höchste Priorität';
      } else if (priority >= 14) {
        suggestedFaab = Math.min(18, Math.max(8, Math.floor(proj * 1.1)));
        priorityLabel = 'Hohe Priorität';
      } else if (priority >= 9) {
        suggestedFaab = Math.min(10, Math.max(4, Math.floor(proj * 0.7)));
        priorityLabel = pctOwned < 30 ? 'Geheimtipp / Sleeper' : 'Solider Starter';
      } else {
        suggestedFaab = Math.max(1, Math.floor(proj * 0.4));
        priorityLabel = 'Kader-Tiefe';
      }

      // Match best drop candidate from bench
      let bestDrop = dropCandidates.find((d: DropCandidate) => d.position === pos);
      if (!bestDrop && dropCandidates.length > 0) {
        bestDrop = dropCandidates[0];
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
        priorityLabel,
        suggestedFaab,
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

    // Sort by priority descending
    scoredTargets.sort((a: WaiverTarget, b: WaiverTarget) => b.priority - a.priority || b.projectedPoints - a.projectedPoints);
    const topTargets = scoredTargets.slice(0, maxResults);

    // 6. Generate AI briefing (using Gemini if key available, fallback algorithmic)
    const aiBriefing = await this.generateAIBriefing({
      week,
      season,
      teamName,
      wins: team.record?.overall?.wins ?? 0,
      losses: team.record?.overall?.losses ?? 0,
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
    injuredStarters: Array<{ name: string; position: string; injury: string }>;
    dropCandidates: DropCandidate[];
    topTargets: WaiverTarget[];
  }): Promise<WaiverAnalysisResult['aiBriefing']> {
    const { week, season, teamName, wins, losses, injuredStarters, dropCandidates, topTargets } = context;

    const urgency: 'HOCH' | 'MITTEL' | 'NORMAL' =
      injuredStarters.length >= 2 ? 'HOCH' : injuredStarters.length === 1 ? 'MITTEL' : 'NORMAL';

    const injuredList = injuredStarters.map((s: { name: string; position: string; injury: string }) => ({
      name: s.name,
      position: s.position,
      status: s.injury || 'QUESTIONABLE'
    }));

    const geminiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-3.7-flash';

    if (geminiKey && geminiKey.trim()) {
      try {
        const prompt = `Du bist ein erfahrener ESPN Fantasy Football AI Co-Manager für Saison ${season}, Woche ${week}.
Team: "${teamName}" (${wins} Siege - ${losses} Niederlagen).

Angeschlagene/fragliche Starter im Team:
${injuredStarters.length > 0 ? injuredStarters.map((s: { name: string; position: string; injury: string }) => `- ${s.name} (${s.position}, Status: ${s.injury})`).join('\n') : '- Keine verletzten Starter'}

Top freie Spieler auf dem Waiver Wire:
${topTargets.map((t: WaiverTarget) => `- ${t.name} (${t.position}, ${t.team}): ${t.projectedPoints} Pkt projiziert, ${t.percentOwned}% im Besitz. Gründe: ${t.reasons.join(', ')}`).join('\n')}

Mögliche Drop-Kandidaten von der Bank:
${dropCandidates.map((d: DropCandidate) => `- ${d.name} (${d.position}, ${d.slot}): ${d.reason}`).join('\n')}

Erstelle ein prägnantes, professionelles Wochen-Briefing auf Deutsch:
1. Schlagzeile (1 Satz zur Wochenlage)
2. Wichtigste 2-3 Pickups für diese Woche und warum sie genau jetzt helfen
3. Konkreter Drop-Ratschlag (wer kann ohne Reue gehen)
4. FAAB-Empfehlung`;

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
          const lines = text.split('\n').filter((l: string) => l.trim().length > 0);
          const headline = lines[0].replace(/^#+\s*|\*+/g, '').trim();

          const keyAdvice: string[] = [];
          for (const line of lines.slice(1)) {
            const clean = line.replace(/^[-*•\d.]\s*|\*+/g, '').trim();
            if (clean.length > 15 && keyAdvice.length < 4) {
              keyAdvice.push(clean);
            }
          }

          return {
            urgency,
            headline: headline.length > 10 ? headline : `Woche ${week} Waiver-Fokus: ${urgency === 'HOCH' ? 'Verletzungen absichern' : 'Kader optimieren'}`,
            injuredStarters: injuredList,
            keyAdvice: keyAdvice.length > 0 ? keyAdvice : [
              topTargets[0] ? `Top-Claim: ${topTargets[0].name} (${topTargets[0].position}) für ${topTargets[0].suggestedFaab}$ FAAB priorisieren.` : 'Verfügbare Optionen prüfen.',
              dropCandidates[0] ? `Als Drop bietet sich ${dropCandidates[0].name} (${dropCandidates[0].position}) an.` : 'Bankplätze analysieren.'
            ],
            fullAnalysis: text,
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

    const headline = urgency === 'HOCH'
      ? `Woche ${week}: ${injuredStarters.length} Starter fraglich – Sofortige Absicherung empfohlen!`
      : urgency === 'MITTEL'
      ? `Woche ${week}: ${injuredStarters[0]?.name} (${injuredStarters[0]?.position}) ist fraglich – Tiefe verstärken.`
      : `Woche ${week}: Solide Kaderlage – Gezielte Verstärkung über Waiver Wire nutzen.`;

    const keyAdvice: string[] = [];
    if (topPick) {
      keyAdvice.push(`Priorität 1: ${topPick.name} (${topPick.position}, ${topPick.team}) mit ${topPick.projectedPoints} projizierten Punkten.`);
    }
    if (injuredStarters.length > 0) {
      const positions = [...new Set(injuredStarters.map((s: { name: string; position: string; injury: string }) => s.position))].join(', ');
      keyAdvice.push(`Fokus auf Positionen mit Ausfällen: ${positions}.`);
    }
    if (topDrop) {
      keyAdvice.push(`Empfohlener Drop: ${topDrop.name} (${topDrop.position}) von der Bank entlassen.`);
    }
    if (topPick) {
      keyAdvice.push(`Empfohlenes FAAB-Gebot für ${topPick.name}: ca. ${topPick.suggestedFaab}$ (Budget schonen für die Playoffs).`);
    }

    const fullAnalysis = `### MCP Wochen-Analyse für Woche ${week}
**Lage:** ${headline}

**Top-Empfehlungen:**
${topTargets.slice(0, 3).map((t: WaiverTarget, idx: number) => `${idx + 1}. **${t.name}** (${t.position}, ${t.team}): ${t.projectedPoints} Pkt - ${t.reasons.join('; ')} (FAAB: ca. ${t.suggestedFaab}$)`).join('\n')}

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
