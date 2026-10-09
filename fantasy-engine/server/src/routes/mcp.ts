import { Router, Request, Response } from 'express';
import { ESPNApiService } from '../services/espnApi';
import { MCPWaiverService } from '../services/mcpWaiverService';

const router = Router();

function getLeagueConfig(key: string = '1') {
  const leagueId = process.env[`LEAGUE_${key}_ID`];
  const teamId = process.env[`LEAGUE_${key}_TEAM_ID`];
  const name = process.env[`LEAGUE_${key}_NAME`] || `Liga ${key}`;
  return leagueId && teamId ? { key, id: leagueId, teamId, name } : null;
}

const MCP_TOOLS = [
  {
    name: 'find_waiver_targets',
    description: 'Ermittelt freie Spieler (Waiver & Free Agents) für die aktuelle NFL-Woche mit Prioritäts-Scoring, FAAB-Budget-Empfehlung, Analyse verletzter Starter und Drop-Vorschlägen.',
    inputSchema: {
      type: 'object',
      properties: {
        leagueKey: {
          type: 'string',
          description: 'Liga-Schlüssel (z. B. "1" oder "2", Standard: "1")',
          default: '1'
        },
        position: {
          type: 'string',
          description: 'Positionsfilter: ALL, QB, RB, WR, TE, K, D/ST, DEF',
          default: 'ALL'
        },
        maxResults: {
          type: 'number',
          description: 'Maximale Anzahl an Vorschlägen (Standard: 15)',
          default: 15
        }
      }
    }
  },
  {
    name: 'analyze_team_health',
    description: 'Analysiert das aktuelle Team auf verletzte oder fragliche Spieler für den kommenden Spieltag.',
    inputSchema: {
      type: 'object',
      properties: {
        leagueKey: {
          type: 'string',
          description: 'Liga-Schlüssel (Standard: "1")',
          default: '1'
        }
      }
    }
  }
];

// Tools listing endpoint
router.get('/tools', (_req: Request, res: Response) => {
  res.json({ tools: MCP_TOOLS });
});

// JSON-RPC 2.0 MCP Handler
router.post('/', async (req: Request, res: Response) => {
  const { jsonrpc, id, method, params } = req.body || {};

  if (method === 'tools/list') {
    res.json({
      jsonrpc: '2.0',
      id: id ?? 1,
      result: { tools: MCP_TOOLS }
    });
    return;
  }

  if (method === 'ping') {
    res.json({
      jsonrpc: '2.0',
      id: id ?? 1,
      result: {}
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (!process.env.ESPN_S2 || !process.env.ESPN_SWID) {
      res.status(503).json({
        jsonrpc: '2.0',
        id: id ?? 1,
        error: { code: -32001, message: 'ESPN-Cookies fehlen in der Umgebung.' }
      });
      return;
    }

    const leagueKey = String(args.leagueKey || '1');
    const league = getLeagueConfig(leagueKey);
    if (!league) {
      res.status(404).json({
        jsonrpc: '2.0',
        id: id ?? 1,
        error: { code: -32602, message: `Liga ${leagueKey} ist nicht konfiguriert.` }
      });
      return;
    }

    try {
      const espn = new ESPNApiService();
      espn.setCookies({ espn_s2: process.env.ESPN_S2, swid: process.env.ESPN_SWID });
      const waiverService = new MCPWaiverService(espn);

      if (toolName === 'find_waiver_targets') {
        const result = await waiverService.analyzeWaiversForTeam(league.id, league.teamId, {
          position: args.position || 'ALL',
          maxResults: Number(args.maxResults) || 15
        });

        res.json({
          jsonrpc: '2.0',
          id: id ?? 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          }
        });
        return;
      }

      if (toolName === 'analyze_team_health') {
        const result = await waiverService.analyzeWaiversForTeam(league.id, league.teamId, {
          maxResults: 1
        });

        res.json({
          jsonrpc: '2.0',
          id: id ?? 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  team: result.teamName,
                  week: result.week,
                  urgency: result.aiBriefing.urgency,
                  injuredStarters: result.aiBriefing.injuredStarters,
                  headline: result.aiBriefing.headline,
                  dropCandidates: result.dropCandidates
                }, null, 2)
              }
            ]
          }
        });
        return;
      }

      res.status(404).json({
        jsonrpc: '2.0',
        id: id ?? 1,
        error: { code: -32601, message: `Unbekanntes Tool: ${toolName}` }
      });
    } catch (error: any) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: id ?? 1,
        error: { code: -32000, message: error.message || 'Interner Fehler' }
      });
    }
    return;
  }

  res.status(400).json({
    jsonrpc: '2.0',
    id: id ?? 1,
    error: { code: -32600, message: `Ungültige oder nicht unterstützte Methode: ${method}` }
  });
});

export default router;
