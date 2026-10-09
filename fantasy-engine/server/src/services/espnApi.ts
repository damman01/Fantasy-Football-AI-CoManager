import axios, { AxiosInstance } from 'axios';

interface ESPNCookies {
  espn_s2: string;
  swid: string;
}

// The NFL season is named for the year it starts in (Sep-Jan); Jan/Feb still
// belong to the previous season's playoffs/offseason. A hardcoded year here
// kept silently breaking every year when nobody remembered to bump it.
export function getCurrentNFLSeasonYear(): number {
  const now = new Date();
  return now.getMonth() <= 1 ? now.getFullYear() - 1 : now.getFullYear();
}

export class ESPNApiService {
  private axios: AxiosInstance;
  private baseURL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
  private cookies: ESPNCookies | null = null;

  constructor() {
    this.axios = axios.create({
      baseURL: this.baseURL,
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        // Don't set Content-Type for GET requests
      }
    });
  }

  setCookies(cookies: ESPNCookies) {
    this.cookies = cookies;
    // Set cookie header properly for all requests
    if (cookies.espn_s2 && cookies.swid) {
      this.axios.defaults.headers.common['Cookie'] = `espn_s2=${cookies.espn_s2}; SWID=${cookies.swid}`;
      console.log('Cookies set in ESPN API service');
    } else {
      // Remove cookie header for public leagues
      delete this.axios.defaults.headers.common['Cookie'];
      console.log('No cookies set - using public access');
    }
  }

  getCookies(): ESPNCookies | null {
    return this.cookies;
  }

  async getDashboard(leagueId: string) {
    const params = new URLSearchParams();
    for (const view of ['mSettings', 'mTeam', 'mRoster']) params.append('view', view);
    const response = await this.axios.get(
      `/seasons/${getCurrentNFLSeasonYear()}/segments/0/leagues/${leagueId}`,
      { params }
    );
    if (!response.data || typeof response.data !== 'object' || !Array.isArray(response.data.teams)) {
      throw new Error('Invalid ESPN response');
    }
    return response.data;
  }

  async getAvailablePlayers(leagueId: string, scoringPeriodId?: number) {
    const year = getCurrentNFLSeasonYear();
    const params = new URLSearchParams();
    params.append('view', 'kona_player_info');
    if (scoringPeriodId) params.append('scoringPeriodId', String(scoringPeriodId));

    const filterHeader = JSON.stringify({
      players: {
        filterStatus: {
          value: ['FREEAGENT', 'WAIVERS']
        },
        limit: 150,
        sortPercOwned: {
          sortAsc: false,
          sortPriority: 1
        }
      }
    });

    try {
      const response = await this.axios.get(
        `/seasons/${year}/segments/0/leagues/${leagueId}`,
        {
          params,
          headers: {
            'X-Fantasy-Filter': filterHeader
          }
        }
      );
      if (response.data && Array.isArray(response.data.players)) {
        return response.data.players;
      }
      return [];
    } catch (error: any) {
      console.warn('Filter query failed, falling back to unfiltered request:', error.message);
      try {
        const fallback = await this.axios.get(
          `/seasons/${year}/segments/0/leagues/${leagueId}`,
          { params }
        );
        const players = fallback.data?.players || [];
        return players.filter((p: any) => {
          const status = p.status;
          const pct = p.player?.ownership?.percentOwned ?? 0;
          return status === 'FREEAGENT' || status === 'WAIVERS' || pct < 75;
        });
      } catch (fallbackError: any) {
        throw new Error(`Konnte verfügbare Spieler nicht laden: ${fallbackError.message}`);
      }
    }
  }

  async getLeagueInfo(leagueId: string, year: number = getCurrentNFLSeasonYear()) {
    const fullUrl = `${this.baseURL}/seasons/${year}/segments/0/leagues/${leagueId}`;
    console.log('Fetching URL:', fullUrl);
    
    // Use raw axios instead of the instance to avoid header conflicts
    const headers: any = {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    };
    
    // Only add cookies if they exist
    if (this.cookies?.espn_s2 && this.cookies?.swid) {
      headers['Cookie'] = `espn_s2=${this.cookies.espn_s2}; SWID=${this.cookies.swid}`;
      console.log('Using cookies for request');
    } else {
      console.log('No cookies - attempting public access');
    }
    
    console.log('Request headers:', headers);
    
    const response = await axios.get(fullUrl, { headers });
    
    // Check if response is HTML (string starting with '<')
    if (typeof response.data === 'string' && response.data.trim().startsWith('<')) {
      console.error('Received HTML instead of JSON - authentication may have failed');
      console.log('First 500 chars of response:', response.data.substring(0, 500));
      throw new Error('ESPN API returned HTML instead of JSON - please check your authentication');
    }
    
    console.log('League Info Response Type:', typeof response.data);
    console.log('League ID:', response.data.id);
    console.log('League Name:', response.data.settings?.name);
    console.log('Season ID:', response.data.seasonId);
    return response.data;
  }

  async getTeams(leagueId: string, year: number = getCurrentNFLSeasonYear()) {
    const response = await this.axios.get(
      `/seasons/${year}/segments/0/leagues/${leagueId}`,
      { params: { view: 'mTeam' } }
    );
    return response.data;
  }

  async getRoster(leagueId: string, teamId: string, year: number = getCurrentNFLSeasonYear()) {
    const response = await this.axios.get(
      `/seasons/${year}/segments/0/leagues/${leagueId}`,
      { 
        params: { 
          view: 'mRoster',
          scoringPeriodId: 0 
        } 
      }
    );
    
    const team = response.data.teams?.find((t: any) => t.id === parseInt(teamId));
    return team?.roster || null;
  }

  async getPlayers(leagueId: string, year: number = getCurrentNFLSeasonYear()) {
    const response = await this.axios.get(
      `/seasons/${year}/segments/0/leagues/${leagueId}`,
      { 
        params: { 
          view: 'kona_player_info'
        } 
      }
    );
    return response.data.players;
  }

  async getMatchups(leagueId: string, week: number, year: number = getCurrentNFLSeasonYear()) {
    const response = await this.axios.get(
      `/seasons/${year}/segments/0/leagues/${leagueId}`,
      { 
        params: { 
          view: 'mMatchup',
          scoringPeriodId: week
        } 
      }
    );
    return response.data.schedule;
  }

  async getTransactions(leagueId: string, year: number = getCurrentNFLSeasonYear()) {
    const response = await this.axios.get(
      `/seasons/${year}/segments/0/leagues/${leagueId}/transactions`
    );
    return response.data.transactions;
  }

  async testEndpoint(endpoint: string, params: any = {}) {
    const response = await this.axios.get(endpoint, { params });
    return response.data;
  }
}

export const espnApi = new ESPNApiService();