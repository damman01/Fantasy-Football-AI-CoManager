import axios, { AxiosInstance } from 'axios';
import { ESPNCookies, LeagueInfo, TeamRoster, Player } from '../types/espn.js';

export class ESPNApiService {
  private axios: AxiosInstance;
  private baseURL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
  private cookies: ESPNCookies | null = null;
  private year: number = ESPNApiService.getCurrentNFLSeasonYear();

  // In-memory cache for NFL pro team bye weeks: proTeamId -> byeWeek
  private proTeamByeWeeks: Map<number, number> = new Map();
  private proTeamSchedulesLoaded = false;

  // Fallback NFL team ID to abbreviation & default bye week mapping (standard ESPN NFL IDs)
  private readonly PRO_TEAMS: { [key: number]: { abbrev: string; defaultByeWeek: number } } = {
    1: { abbrev: 'ATL', defaultByeWeek: 12 },
    2: { abbrev: 'BUF', defaultByeWeek: 12 },
    3: { abbrev: 'CHI', defaultByeWeek: 7 },
    4: { abbrev: 'CIN', defaultByeWeek: 12 },
    5: { abbrev: 'CLE', defaultByeWeek: 10 },
    6: { abbrev: 'DAL', defaultByeWeek: 7 },
    7: { abbrev: 'DEN', defaultByeWeek: 14 },
    8: { abbrev: 'DET', defaultByeWeek: 5 },
    9: { abbrev: 'GB', defaultByeWeek: 10 },
    10: { abbrev: 'TEN', defaultByeWeek: 5 },
    11: { abbrev: 'IND', defaultByeWeek: 14 },
    12: { abbrev: 'KC', defaultByeWeek: 6 },
    13: { abbrev: 'LV', defaultByeWeek: 10 },
    14: { abbrev: 'LAR', defaultByeWeek: 6 },
    15: { abbrev: 'MIA', defaultByeWeek: 6 },
    16: { abbrev: 'MIN', defaultByeWeek: 6 },
    17: { abbrev: 'NE', defaultByeWeek: 14 },
    18: { abbrev: 'NO', defaultByeWeek: 12 },
    19: { abbrev: 'NYG', defaultByeWeek: 11 },
    20: { abbrev: 'NYJ', defaultByeWeek: 12 },
    21: { abbrev: 'PHI', defaultByeWeek: 5 },
    22: { abbrev: 'ARI', defaultByeWeek: 11 },
    23: { abbrev: 'PIT', defaultByeWeek: 9 },
    24: { abbrev: 'LAC', defaultByeWeek: 5 },
    25: { abbrev: 'SF', defaultByeWeek: 9 },
    26: { abbrev: 'SEA', defaultByeWeek: 10 },
    27: { abbrev: 'TB', defaultByeWeek: 11 },
    28: { abbrev: 'WSH', defaultByeWeek: 14 },
    29: { abbrev: 'CAR', defaultByeWeek: 11 },
    30: { abbrev: 'JAX', defaultByeWeek: 12 },
    33: { abbrev: 'BAL', defaultByeWeek: 14 },
    34: { abbrev: 'HOU', defaultByeWeek: 14 }
  };

  /**
   * Fetches and caches the NFL pro team schedules and bye weeks from ESPN API.
   * Uses public view=proTeamSchedules_wl endpoint.
   */
  async getProTeamByeWeeks(season?: number): Promise<Map<number, number>> {
    if (this.proTeamSchedulesLoaded && this.proTeamByeWeeks.size > 0) {
      return this.proTeamByeWeeks;
    }

    const targetYear = season || this.year;
    try {
      const response = await this.axios.get(`/seasons/${targetYear}`, {
        params: { view: 'proTeamSchedules_wl' }
      });

      const proTeams = response.data?.settings?.proTeams || [];
      for (const pt of proTeams) {
        if (pt.id && typeof pt.byeWeek === 'number') {
          this.proTeamByeWeeks.set(pt.id, pt.byeWeek);
        }
      }
      if (this.proTeamByeWeeks.size > 0) {
        this.proTeamSchedulesLoaded = true;
        console.log(`✅ Loaded bye weeks for ${this.proTeamByeWeeks.size} NFL teams from ESPN (season ${targetYear})`);
        return this.proTeamByeWeeks;
      }
    } catch (error: any) {
      console.warn(`⚠️ Could not fetch pro team schedules from ESPN (${error.message}). Using fallback bye weeks.`);
    }

    // Fallback: populate with standard defaults
    for (const [idStr, info] of Object.entries(this.PRO_TEAMS)) {
      this.proTeamByeWeeks.set(parseInt(idStr, 10), info.defaultByeWeek);
    }
    this.proTeamSchedulesLoaded = true;
    return this.proTeamByeWeeks;
  }

  /**
   * Returns the bye week for a given NFL pro team ID.
   */
  getByeWeekForTeam(proTeamId: number): number | undefined {
    if (this.proTeamByeWeeks.has(proTeamId)) {
      return this.proTeamByeWeeks.get(proTeamId);
    }
    return this.PRO_TEAMS[proTeamId]?.defaultByeWeek;
  }

  // The NFL season is named for the year it starts in (Sep-Jan). ESPN rolls
  // leagues over to the new season well before kickoff, so Jan/Feb still
  // belong to the previous season's playoffs/offseason; everything else
  // belongs to the season starting that year. This is what a hardcoded year
  // kept breaking every year when nobody remembered to bump it.
  private static getCurrentNFLSeasonYear(): number {
    const now = new Date();
    return now.getMonth() <= 1 ? now.getFullYear() - 1 : now.getFullYear();
  }

  // Get current NFL week for the active season
  private getCurrentWeek(): number {
    const now = new Date();
    const seasonStart = new Date(`${this.year}-09-04`); // NFL season typically starts first Thursday of September
    const timeDiff = now.getTime() - seasonStart.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
    
    // If before season starts, return 1. Otherwise calculate week
    if (daysDiff <= 0) return 1;
    return Math.min(Math.ceil(daysDiff / 7), 18); // Cap at week 18
  }

  constructor() {
    this.axios = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
  }

  setCookies(cookies: ESPNCookies) {
    this.cookies = cookies;
    if (cookies.espn_s2 && cookies.swid) {
      this.axios.defaults.headers.common['Cookie'] = `espn_s2=${cookies.espn_s2}; SWID=${cookies.swid}`;
    } else {
      delete this.axios.defaults.headers.common['Cookie'];
    }
  }

  getCookies(): ESPNCookies | null {
    return this.cookies;
  }

  async getLeagueInfo(leagueId: string): Promise<LeagueInfo> {
    const fullUrl = `${this.baseURL}/seasons/${this.year}/segments/0/leagues/${leagueId}`;
    
    const headers: any = {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    };
    
    if (this.cookies?.espn_s2 && this.cookies?.swid) {
      headers['Cookie'] = `espn_s2=${this.cookies.espn_s2}; SWID=${this.cookies.swid}`;
    }
    
    try {
      const response = await axios.get(fullUrl, { headers });
      
      if (typeof response.data === 'string' && response.data.trim().startsWith('<')) {
        throw new Error('ESPN API returned HTML instead of JSON - authentication required');
      }
      
      return {
        id: response.data.id,
        name: response.data.settings?.name || 'Unknown League',
        seasonId: response.data.seasonId,
        currentWeek: response.data.scoringPeriodId || 1,
        teams: response.data.teams || [],
        settings: response.data.settings
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error(`ESPN Authentication Failed (401): ESPN cookies (ESPN_S2/SWID) are invalid or expired. Please refresh cookies from https://fantasy.espn.com/`);
      } else if (error.response?.status === 403) {
        throw new Error(`ESPN Access Forbidden (403): You don't have permission to access league ${leagueId}. Check if league is private and requires authentication.`);
      } else if (error.response?.status === 404) {
        throw new Error(`ESPN League Not Found (404): League ${leagueId} doesn't exist or is not accessible.`);
      } else if (error.response) {
        throw new Error(`ESPN API Error (${error.response.status}): ${error.response.statusText || 'Unknown error'} - URL: ${fullUrl}`);
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error(`ESPN Network Error: Cannot connect to ESPN servers. Check internet connection.`);
      } else {
        throw new Error(`ESPN API Request Failed: ${error.message} - League: ${leagueId}`);
      }
    }
  }

  async getTeamRoster(leagueId: string, teamId: string, week?: number): Promise<TeamRoster> {
    try {
      await this.getProTeamByeWeeks();
      const currentWeek = week || this.getCurrentWeek();
      
      // Try to get both current week and projected stats
      const response = await this.axios.get(
        `/seasons/${this.year}/segments/0/leagues/${leagueId}`,
        { 
          params: { 
            view: 'mRoster',
            scoringPeriodId: currentWeek // Request specific week data
          } 
        }
      );
      
      const targetWeek = week || response.data?.scoringPeriodId || currentWeek;
      console.log(`🔍 ESPN API Request - League: ${leagueId}, Target Week: ${targetWeek}, Year: ${this.year}`);
      
      const team = response.data.teams?.find((t: any) => t.id === parseInt(teamId));
      if (!team) {
        throw new Error(`Team ${teamId} not found in league ${leagueId}. Available teams: ${response.data.teams?.map((t: any) => t.id).join(', ') || 'none'}`);
      }
      
      const roster = team.roster?.entries || [];
      
      const processPlayer = (entry: any): Player => {
        const playerData = entry.playerPoolEntry?.player || {};
        const stats = playerData.stats || [];
        const proTeamId = playerData.proTeamId || 0;
        const byeWeek = this.getByeWeekForTeam(proTeamId);
        const isByeWeek = Boolean(byeWeek && byeWeek === targetWeek);
        
        // Optional debug logging (enable by setting DEBUG_ESPN environment variable)
        if (process.env.DEBUG_ESPN && playerData.fullName) {
          console.log(`\n=== DEBUG: ${playerData.fullName} (${this.getPositionName(playerData.defaultPositionId || 0)}) ===`);
          console.log('Raw stats array length:', stats.length);
          stats.forEach((stat: any, index: number) => {
            console.log(`Stats[${index}]:`, {
              seasonId: stat.seasonId,
              scoringPeriodId: stat.scoringPeriodId,
              statSourceId: stat.statSourceId,
              statSplitTypeId: stat.statSplitTypeId,
              appliedTotal: stat.appliedTotal,
              appliedAverage: stat.appliedAverage
            });
          });
        }
        
        let weeklyProjection = 0;
        let seasonTotal = 0;
        let actualPoints = 0;
        
        // Find season total projections (statSourceId 1, no specific scoring period)
        const seasonProjectionStat = stats.find((stat: any) => 
          stat.statSourceId === 1 && 
          (!stat.scoringPeriodId || stat.scoringPeriodId === 0)
        );
        
        if (seasonProjectionStat) {
          seasonTotal = seasonProjectionStat.appliedTotal || 0;
          if (process.env.DEBUG_ESPN && playerData.fullName) {
            console.log(`Season total projection:`, seasonTotal);
          }
        }

        // If player is on a BYE week, their projection for this week is 0
        if (isByeWeek) {
          weeklyProjection = 0;
          if (process.env.DEBUG_ESPN && playerData.fullName) {
            console.log(`⏸️ BYE WEEK: ${playerData.fullName} is on BYE in week ${targetWeek} (projection: 0)`);
          }
        } else {
          // Look for weekly projections first (statSourceId 1 with targetWeek)
          const weeklyProjectionStat = stats.find((stat: any) => 
            stat.statSourceId === 1 && 
            stat.scoringPeriodId === targetWeek
          );
          
          if (weeklyProjectionStat) {
            weeklyProjection = weeklyProjectionStat.appliedTotal || 0;
            if (process.env.DEBUG_ESPN && playerData.fullName) {
              console.log(`Found weekly projection for week ${targetWeek}:`, weeklyProjection);
            }
          } else {
            // Fallback: Look for any projection stat
            const anyProjectionStat = stats.find((stat: any) => stat.statSourceId === 1);
            if (anyProjectionStat) {
              weeklyProjection = anyProjectionStat.appliedTotal || 0;
              if (process.env.DEBUG_ESPN && playerData.fullName) {
                console.log(`Using fallback projection (scoringPeriodId: ${anyProjectionStat.scoringPeriodId}):`, weeklyProjection);
              }
            }
          }
        }
        
        // Find actual points for target week
        const actualStat = stats.find((stat: any) => 
          stat.statSourceId === 0 && 
          stat.scoringPeriodId === targetWeek
        );
        
        if (actualStat) {
          actualPoints = actualStat.appliedTotal || 0;
        }
        
        const playerPosition = this.getPositionName(playerData.defaultPositionId || 0);
        const reasonableWeeklyMax = playerPosition === 'QB' ? 35 : 25;
        
        if (!isByeWeek && weeklyProjection > reasonableWeeklyMax) {
          console.warn(`⚠️ ${playerData.fullName}: Weekly projection too high (${weeklyProjection}), treating as season total`);
          
          // Store as season total and estimate weekly
          if (seasonTotal === 0) {
            seasonTotal = weeklyProjection;
          }
          weeklyProjection = weeklyProjection / 17; // Estimate weekly from season total
          
          if (process.env.DEBUG_ESPN && playerData.fullName) {
            console.log(`🔄 Converted season total to weekly estimate: ${weeklyProjection.toFixed(1)}`);
          }
        }
        
        // Additional validation: Cap weekly projections at reasonable levels
        if (!isByeWeek && weeklyProjection > reasonableWeeklyMax) {
          console.warn(`⚠️ ${playerData.fullName}: Still too high (${weeklyProjection}), capping at ${reasonableWeeklyMax}`);
          weeklyProjection = Math.min(weeklyProjection, reasonableWeeklyMax);
        }
        
        if (process.env.DEBUG_ESPN && playerData.fullName) {
          console.log(`Final values - Weekly: ${weeklyProjection}, Season: ${seasonTotal}, Actual: ${actualPoints}, isByeWeek: ${isByeWeek}`);
          console.log('=== END DEBUG ===\n');
        }
        
        const finalProjectedPoints = isByeWeek ? 0 : (weeklyProjection > 0 ? weeklyProjection : (seasonTotal > 0 ? seasonTotal / 17 : 0));
        
        return {
          id: playerData.id?.toString() || '',
          firstName: playerData.firstName || '',
          lastName: playerData.lastName || '',
          fullName: playerData.fullName || 'Unknown Player',
          position: this.getPositionName(playerData.defaultPositionId || 0),
          team: proTeamId ? this.getTeamAbbreviation(proTeamId) : 'FA',
          proTeamId,
          byeWeek,
          isByeWeek,
          points: actualPoints,
          projectedPoints: finalProjectedPoints, // 0 if on bye
          seasonProjectedPoints: seasonTotal,
          injuryStatus: playerData.injuryStatus || undefined,
          percentStarted: playerData.ownership?.percentStarted || 0,
          percentOwned: playerData.ownership?.percentOwned || 0
        };
      };

      // Process all players first to get injury status information
      const processedRoster = roster.map(processPlayer);
      
      // Filter into categories with proper injury status validation
      const starters = processedRoster.filter((player: Player, index: number) => {
        const entry = roster[index];
        return entry.lineupSlotId !== 20 && entry.lineupSlotId !== 21;
      });
      
      const bench = processedRoster.filter((player: Player, index: number) => {
        const entry = roster[index];
        return entry.lineupSlotId === 20;
      });
      
      // IR: Only include players who are ACTUALLY injured (not just in IR slot)
      const injuredReserve = processedRoster.filter((player: Player, index: number) => {
        const entry = roster[index];
        const isInIRSlot = entry.lineupSlotId === 21;
        const hasInjuryStatus = player.injuryStatus && 
          !['ACTIVE', 'PROBABLE'].includes(player.injuryStatus.toString().toUpperCase());
        
        // Player must be BOTH in IR slot AND have actual injury status
        if (isInIRSlot && !hasInjuryStatus) {
          console.warn(`⚠️ ${player.fullName} is in IR slot but has injury status '${player.injuryStatus}' - should not be in IR section`);
          return false; // Don't include in IR
        }
        
        return isInIRSlot && hasInjuryStatus;
      });
      
      // Move players incorrectly placed in IR slot to bench if they're healthy
      const incorrectlyPlacedPlayers = processedRoster.filter((player: Player, index: number) => {
        const entry = roster[index];
        const isInIRSlot = entry.lineupSlotId === 21;
        const hasInjuryStatus = player.injuryStatus && 
          !['ACTIVE', 'PROBABLE'].includes(player.injuryStatus.toString().toUpperCase());
        
        return isInIRSlot && !hasInjuryStatus;
      });
      
      // Add incorrectly placed healthy players to bench
      bench.push(...incorrectlyPlacedPlayers);

      return {
        teamId: parseInt(teamId),
        teamName: team.name || `Team ${teamId}`,
        starters,
        bench,
        injuredReserve
      };
    } catch (error: any) {
      if (error.message.includes('Team') && error.message.includes('not found')) {
        throw error; // Re-throw team not found error as-is
      } else if (error.response?.status === 401) {
        throw new Error(`ESPN Authentication Failed (401): Cannot access roster for team ${teamId} in league ${leagueId}. ESPN cookies (ESPN_S2/SWID) are invalid or expired.`);
      } else if (error.response?.status === 403) {
        throw new Error(`ESPN Access Forbidden (403): No permission to view roster for team ${teamId} in league ${leagueId}.`);
      } else if (error.response?.status === 404) {
        throw new Error(`ESPN Resource Not Found (404): League ${leagueId} or team ${teamId} doesn't exist.`);
      } else if (error.response) {
        throw new Error(`ESPN Roster API Error (${error.response.status}): ${error.response.statusText || 'Unknown error'} - League: ${leagueId}, Team: ${teamId}`);
      } else {
        throw new Error(`ESPN Roster Request Failed: ${error.message} - League: ${leagueId}, Team: ${teamId}`);
      }
    }
  }

  async getPlayers(leagueId: string, week?: number): Promise<Player[]> {
    await this.getProTeamByeWeeks();
    const currentWeek = week || this.getCurrentWeek();
    const response = await this.axios.get(
      `/seasons/${this.year}/segments/0/leagues/${leagueId}`,
      { 
        params: { 
          view: 'kona_player_info',
          scoringPeriodId: currentWeek // Request current week data
        } 
      }
    );
    
    const targetWeek = week || response.data?.scoringPeriodId || currentWeek;
    const players = response.data.players || [];
    return players.map((p: any) => this.processPlayerData(p, targetWeek));
  }

  async getAvailablePlayers(leagueId: string, week?: number): Promise<Player[]> {
    await this.getProTeamByeWeeks();
    const currentWeek = week || this.getCurrentWeek();
    try {
      const response = await this.axios.get(
        `/seasons/${this.year}/segments/0/leagues/${leagueId}`,
        { 
          params: { 
            view: 'kona_player_info',
            scoringPeriodId: currentWeek // Request current week data
          },
          headers: {
            'X-Fantasy-Filter': JSON.stringify({
              players: {
                filterStatus: {
                  value: ['FREEAGENT', 'WAIVERS']
                }
              }
            })
          }
        }
      );
      
      const targetWeek = week || response.data?.scoringPeriodId || currentWeek;
      const players = response.data.players || [];
      return players
        .map((p: any) => this.processPlayerData(p, targetWeek))
        .filter((p: Player) => (p.percentOwned || 0) < 50); // Focus on widely available players
    } catch (error: any) {
      if (error.response?.status === 400) {
        // Try alternative approach without the filter for troubleshooting
        console.warn('⚠️ Fantasy filter failed, trying without filter...');
        try {
          const response = await this.axios.get(
            `/seasons/${this.year}/segments/0/leagues/${leagueId}`,
            { 
              params: { 
                view: 'kona_player_info',
                scoringPeriodId: currentWeek // Request current week data
              } 
            }
          );
          
          const targetWeek = week || response.data?.scoringPeriodId || currentWeek;
          const players = response.data.players || [];
          return players
            .map((p: any) => this.processPlayerData(p, targetWeek))
            .filter((p: Player) => (p.percentOwned || 0) < 95) // Only exclude universally owned players
            .slice(0, 200); // Limit to reasonable number of players
        } catch (fallbackError: any) {
          throw new Error(`ESPN Available Players API failed: ${error.message} (Status: ${error.response?.status})`);
        }
      } else if (error.response?.status === 401) {
        throw new Error(`ESPN Authentication Failed (401): Cannot access available players for league ${leagueId}. ESPN cookies (ESPN_S2/SWID) are invalid or expired.`);
      } else if (error.response?.status === 403) {
        throw new Error(`ESPN Access Forbidden (403): No permission to view available players for league ${leagueId}.`);
      } else if (error.response?.status === 404) {
        throw new Error(`ESPN League Not Found (404): League ${leagueId} doesn't exist or is not accessible.`);
      } else if (error.response) {
        throw new Error(`ESPN Available Players API Error (${error.response.status}): ${error.response.statusText || 'Unknown error'} - League: ${leagueId}`);
      } else {
        throw new Error(`ESPN Available Players Request Failed: ${error.message} - League: ${leagueId}`);
      }
    }
  }

  async getMatchups(leagueId: string, week: number) {
    const response = await this.axios.get(
      `/seasons/${this.year}/segments/0/leagues/${leagueId}`,
      { 
        params: { 
          view: 'mMatchup',
          scoringPeriodId: week
        } 
      }
    );
    return response.data.schedule || [];
  }

  async getTransactions(leagueId: string) {
    const response = await this.axios.get(
      `/seasons/${this.year}/segments/0/leagues/${leagueId}/transactions`
    );
    return response.data.transactions || [];
  }

  processPlayerData(playerData: any, week?: number): Player {
    const player = playerData.player || playerData;
    const stats = player.stats || [];
    const currentWeek = week || this.getCurrentWeek();
    const proTeamId = player.proTeamId || 0;
    const byeWeek = this.getByeWeekForTeam(proTeamId);
    const isByeWeek = Boolean(byeWeek && byeWeek === currentWeek);

    let weeklyProjection = 0;
    let actualPoints = 0;

    if (isByeWeek) {
      weeklyProjection = 0;
    } else {
      // Look for weekly projections first
      const weeklyProjectionStat = stats.find((stat: any) => 
        stat.statSourceId === 1 && 
        stat.scoringPeriodId === currentWeek
      );
      
      if (weeklyProjectionStat) {
        weeklyProjection = weeklyProjectionStat.appliedTotal || 0;
      } else {
        // Fallback to any projection stat
        const anyProjectionStat = stats.find((stat: any) => stat.statSourceId === 1 && stat.appliedTotal > 0);
        if (anyProjectionStat) {
          weeklyProjection = anyProjectionStat.appliedTotal || 0;
          
          // Apply same validation logic as main roster processing
          const playerPosition = player.defaultPositionId ? this.getPositionName(player.defaultPositionId) : 'Unknown';
          const reasonableWeeklyMax = playerPosition === 'QB' ? 35 : 25;
          
          // If this looks like a season total, estimate weekly
          if (weeklyProjection > reasonableWeeklyMax) {
            weeklyProjection = weeklyProjection / 17;
          }
        }
      }
    }
    
    // Find actual points
    const actualStat = stats.find((stat: any) => 
      stat.statSourceId === 0 && 
      stat.scoringPeriodId === currentWeek
    );
    
    if (actualStat) {
      actualPoints = actualStat.appliedTotal || 0;
    }
    
    return {
      id: player.id?.toString() || '',
      firstName: player.firstName || '',
      lastName: player.lastName || '',
      fullName: player.fullName || '',
      position: player.defaultPositionId ? this.getPositionName(player.defaultPositionId) : 'Unknown',
      team: proTeamId ? this.getTeamAbbreviation(proTeamId) : 'FA',
      proTeamId,
      byeWeek,
      isByeWeek,
      points: actualPoints,
      projectedPoints: isByeWeek ? 0 : weeklyProjection,
      injuryStatus: player.injuryStatus || undefined,
      percentStarted: player.ownership?.percentStarted || 0,
      percentOwned: player.ownership?.percentOwned || 0
    };
  }

  private getPositionName(positionId: number): string {
    const positions: { [key: number]: string } = {
      1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST'
    };
    return positions[positionId] || 'Unknown';
  }

  public getTeamAbbreviation(teamId: number): string {
    const teams: { [key: number]: string } = {
      1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL',
      7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC',
      13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO',
      19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
      25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX',
      33: 'BAL', 34: 'HOU'
    };
    return teams[teamId] || 'FA';
  }
}

export const espnApi = new ESPNApiService();