const element = id => document.getElementById(id);
let roster = [];
let waiverData = null;
let currentPosFilter = 'ALL';
let requestNumber = 0;
let waiverRequestNumber = 0;
const numberFormat = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });

function refreshLucide() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}
refreshLucide();

function cell(row, text, className) {
  const result = document.createElement('td');
  result.textContent = text;
  if (className) result.className = className;
  row.append(result);
  return result;
}

function renderRoster() {
  const query = element('search').value.toLowerCase().trim();
  const filtered = roster.filter(player => `${player.name} ${player.position} ${player.slot}`.toLowerCase().includes(query));
  const rows = filtered.map(player => {
    const row = document.createElement('tr');
    cell(row, player.slot, `slot ${['BN', 'IR'].includes(player.slot) ? 'bench' : ''}`);
    const name = cell(row, '');
    const wrapper = document.createElement('div');
    wrapper.className = 'player';
    if (player.image) {
      const image = document.createElement('img');
      image.className = 'portrait';
      image.src = player.image;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => { image.remove(); });
      wrapper.append(image);
    }
    const label = document.createElement('span');
    label.textContent = player.name;
    wrapper.append(label);
    name.append(wrapper);
    cell(row, player.position);

    // Ist-Punkte
    const ptsTd = cell(row, '');
    if (player.hasPlayed) {
      ptsTd.innerHTML = `<strong class="points-actual">${numberFormat.format(player.actualPoints ?? 0)}</strong><span class="points-tag">Beendet</span>`;
    } else {
      ptsTd.innerHTML = `<span class="points-pending">Offen</span>`;
    }

    // Proj. Punkte
    cell(row, `${numberFormat.format(player.projectedPoints || 0)} Pkt`, 'points-proj');

    // Status
    const healthy = player.injury === 'ACTIVE' || player.injury === 'NORMAL';
    cell(row, healthy ? 'Verfügbar' : player.injury, healthy ? 'healthy' : 'injured');
    return row;
  });
  element('roster').replaceChildren(...rows);
  element('empty-roster').hidden = rows.length > 0;
  element('empty-roster').textContent = roster.length ? 'Keine passenden Spieler.' : 'Keine Spieler im Roster.';
}

function renderWaiverTargets() {
  if (!waiverData || !waiverData.targets) return;

  const query = (element('waiver-search')?.value || '').toLowerCase().trim();
  const defPositions = ['DT', 'DE', 'LB', 'DL', 'CB', 'S', 'DB', 'DP'];

  const filtered = waiverData.targets.filter(target => {
    // Position filter
    if (currentPosFilter !== 'ALL') {
      if (currentPosFilter === 'DEF') {
        if (!defPositions.includes(target.position)) return false;
      } else if (target.position !== currentPosFilter) {
        return false;
      }
    }
    // Search query
    if (query) {
      const match = `${target.name} ${target.position} ${target.team}`.toLowerCase();
      if (!match.includes(query)) return false;
    }
    return true;
  });

  const grid = element('waiver-grid');
  grid.replaceChildren();

  if (filtered.length === 0) {
    element('empty-waivers').hidden = false;
    return;
  }
  element('empty-waivers').hidden = true;

  for (const target of filtered) {
    const card = document.createElement('article');
    card.className = 'waiver-card';

    // Header with image, name, team, position
    const cardTop = document.createElement('div');
    cardTop.className = 'waiver-card-top';

    const playerBox = document.createElement('div');
    playerBox.className = 'waiver-player-box';

    if (target.image) {
      const img = document.createElement('img');
      img.className = 'waiver-portrait';
      img.src = target.image;
      img.alt = target.name;
      img.loading = 'lazy';
      img.addEventListener('error', () => { img.style.display = 'none'; });
      playerBox.append(img);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'waiver-portrait-placeholder';
      fallback.textContent = target.position;
      playerBox.append(fallback);
    }

    const info = document.createElement('div');
    info.className = 'waiver-player-info';
    const nameEl = document.createElement('h5');
    nameEl.className = 'waiver-name';
    nameEl.textContent = target.name;

    const metaLine = document.createElement('div');
    metaLine.className = 'waiver-meta';

    const posTag = document.createElement('span');
    posTag.className = 'tag-pos';
    posTag.textContent = target.position;

    const teamTag = document.createElement('span');
    teamTag.className = 'tag-team';
    teamTag.textContent = target.team;

    const ownTag = document.createElement('span');
    ownTag.className = 'tag-owned';
    ownTag.textContent = `${target.percentOwned}% im Roster`;

    metaLine.append(posTag, teamTag, ownTag);
    info.append(nameEl, metaLine);
    playerBox.append(info);

    // Points & FAAB badge
    const metricsBox = document.createElement('div');
    metricsBox.className = 'waiver-metrics-box';

    const projNumber = document.createElement('div');
    projNumber.className = 'waiver-proj';
    if (target.actualPoints && target.actualPoints > 0) {
      projNumber.innerHTML = `<span class="proj-label">ERZIELT (W${waiverData.week || '-'})</span><strong class="proj-value actual-pts">${numberFormat.format(target.actualPoints)}</strong><span class="proj-sub">Proj: ${numberFormat.format(target.projectedPoints)}</span>`;
    } else {
      projNumber.innerHTML = `<span class="proj-label">PROJ. PKT</span><strong class="proj-value">${numberFormat.format(target.projectedPoints)}</strong>`;
    }

    const faabBadge = document.createElement('div');
    faabBadge.className = 'waiver-faab-badge';
    faabBadge.innerHTML = `<span class="faab-title">FAAB</span><strong>${target.suggestedFaab}$</strong>`;

    metricsBox.append(projNumber, faabBadge);
    cardTop.append(playerBox, metricsBox);
    card.append(cardTop);

    // Priority pill & reasons
    const cardBody = document.createElement('div');
    cardBody.className = 'waiver-card-body';

    const prioWrap = document.createElement('div');
    prioWrap.className = 'waiver-prio-wrap';

    const prioBadge = document.createElement('span');
    let prioClass = 'prio-normal';
    if (target.priorityLabel === 'Höchste Priorität') prioClass = 'prio-highest';
    else if (target.priorityLabel === 'Hohe Priorität') prioClass = 'prio-high';
    else if (target.priorityLabel === 'Solider Starter') prioClass = 'prio-med';
    else if (target.priorityLabel === 'Geheimtipp / Sleeper') prioClass = 'prio-sleeper';
    else prioClass = 'prio-normal';

    prioBadge.className = `prio-pill ${prioClass}`;
    prioBadge.textContent = target.priorityLabel;
    prioWrap.append(prioBadge);

    if (target.reasons && target.reasons.length > 0) {
      const reasonChips = document.createElement('div');
      reasonChips.className = 'reason-chips';
      for (const r of target.reasons) {
        const chip = document.createElement('span');
        chip.className = 'reason-chip';
        chip.textContent = r;
        reasonChips.append(chip);
      }
      prioWrap.append(reasonChips);
    }
    cardBody.append(prioWrap);

    // Suggested drop candidate
    if (target.suggestedDrop) {
      const dropSuggestion = document.createElement('div');
      dropSuggestion.className = 'waiver-drop-suggestion';
      dropSuggestion.innerHTML = `<span class="drop-hint"><i data-lucide="arrow-down-circle" aria-hidden="true"></i> Möglicher Drop:</span> <strong>${target.suggestedDrop.name}</strong> <span class="drop-pos">(${target.suggestedDrop.position})</span>`;
      cardBody.append(dropSuggestion);
    }

    card.append(cardBody);
    grid.append(card);
  }

  refreshLucide();
}

function renderDropCandidates() {
  const container = element('drop-grid');
  if (!container) return;
  container.replaceChildren();

  if (!waiverData || !waiverData.dropCandidates || waiverData.dropCandidates.length === 0) {
    const none = document.createElement('p');
    none.className = 'no-drops';
    none.textContent = 'Aktuell keine offensichtlichen Drop-Kandidaten empfohlen.';
    container.append(none);
    return;
  }

  for (const drop of waiverData.dropCandidates) {
    const item = document.createElement('div');
    item.className = 'drop-card';

    const header = document.createElement('div');
    header.className = 'drop-card-header';

    const name = document.createElement('strong');
    name.textContent = drop.name;

    const badges = document.createElement('div');
    badges.className = 'drop-badges';

    const pos = document.createElement('span');
    pos.className = 'tag-pos';
    pos.textContent = `${drop.position} · ${drop.slot}`;
    badges.append(pos);

    if (drop.injury && !['ACTIVE', 'NORMAL'].includes(drop.injury.toUpperCase())) {
      const inj = document.createElement('span');
      inj.className = 'tag-injured';
      inj.textContent = drop.injury;
      badges.append(inj);
    }

    header.append(name, badges);

    const desc = document.createElement('p');
    desc.className = 'drop-reason';
    desc.textContent = drop.reason;

    item.append(header, desc);
    container.append(item);
  }
}

function renderMarkdown(md) {
  if (!md || typeof md !== 'string') return '';

  const text = md.replace(/\r\n/g, '\n').trim();

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatInline(str) {
    return str
      .replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
      .replace(/(^|\s)_([^_\s][^_\n]*?[^_\s])_(\s|[.,;:!?]|$)/g, '$1<em>$2</em>$3')
      .replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  }

  const lines = text.split('\n');
  const htmlParts = [];
  let inUl = false;
  let inOl = false;

  function closeLists() {
    if (inUl) {
      htmlParts.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      htmlParts.push('</ol>');
      inOl = false;
    }
  }

  let paragraphBuffer = [];

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      const pText = paragraphBuffer.map(escapeHtml).map(formatInline).join('<br />');
      htmlParts.push(`<p class="briefing-p">${pText}</p>`);
      paragraphBuffer = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      flushParagraph();
      closeLists();
      continue;
    }

    // Divider: --- or *** or ___
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      closeLists();
      htmlParts.push('<hr class="briefing-divider" />');
      continue;
    }

    // Headings: ###, ##, ####
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      closeLists();
      const level = headingMatch[1].length;
      const headingText = formatInline(escapeHtml(headingMatch[2]));
      const tag = level <= 3 ? 'h4' : 'h5';
      htmlParts.push(`<${tag} class="briefing-section-title">${headingText}</${tag}>`);
      continue;
    }

    // Unordered list item: * item, - item, • item
    const ulMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph();
      if (inOl) closeLists();
      if (!inUl) {
        htmlParts.push('<ul class="briefing-list">');
        inUl = true;
      }
      const itemText = formatInline(escapeHtml(ulMatch[1]));
      htmlParts.push(`<li>${itemText}</li>`);
      continue;
    }

    // Ordered list item: 1. item, 2. item
    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph();
      if (inUl) closeLists();
      if (!inOl) {
        htmlParts.push('<ol class="briefing-list-ordered">');
        inOl = true;
      }
      const itemText = formatInline(escapeHtml(olMatch[2]));
      htmlParts.push(`<li>${itemText}</li>`);
      continue;
    }

    // List item continuation (indented)
    if ((inUl || inOl) && (rawLine.startsWith('  ') || rawLine.startsWith('\t'))) {
      const continuationText = formatInline(escapeHtml(trimmed));
      const lastIndex = htmlParts.length - 1;
      if (lastIndex >= 0 && htmlParts[lastIndex].endsWith('</li>')) {
        htmlParts[lastIndex] = htmlParts[lastIndex].replace(/<\/li>$/, ` ${continuationText}</li>`);
        continue;
      }
    }

    closeLists();
    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  closeLists();

  return htmlParts.join('\n');
}

function renderWaiverBriefing() {
  if (!waiverData || !waiverData.aiBriefing) return;
  const briefing = waiverData.aiBriefing;

  element('waiver-week-badge').textContent = `Woche ${waiverData.week}`;
  
  // Clean headline of stray markdown tokens
  const cleanHeadline = (briefing.headline || '')
    .replace(/^#+\s*/, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .trim();
  element('waiver-headline').textContent = cleanHeadline;

  const urgencyEl = element('waiver-urgency');
  urgencyEl.textContent = briefing.urgency;
  urgencyEl.className = `urgency-badge urgency-${briefing.urgency.toLowerCase()}`;

  // Injured starters alerts
  const alertsBox = element('waiver-alerts');
  const alertList = element('waiver-alert-list');
  alertList.replaceChildren();

  if (briefing.injuredStarters && briefing.injuredStarters.length > 0) {
    alertsBox.hidden = false;
    for (const inj of briefing.injuredStarters) {
      const chip = document.createElement('span');
      chip.className = 'alert-chip';
      chip.innerHTML = `<strong>${inj.name}</strong> (${inj.position}): <span class="chip-status">${inj.status}</span>`;
      alertList.append(chip);
    }
  } else {
    alertsBox.hidden = true;
  }

  // AI Content / Advice - Render full Markdown with fallback
  const contentEl = element('waiver-ai-text');
  contentEl.replaceChildren();

  const markdownSource = briefing.fullAnalysis || (Array.isArray(briefing.keyAdvice) && briefing.keyAdvice.length > 0 ? briefing.keyAdvice.map(pt => `- ${pt}`).join('\n') : '');

  if (markdownSource) {
    contentEl.innerHTML = renderMarkdown(markdownSource);
  } else {
    contentEl.innerHTML = '<p class="briefing-p">Keine detaillierte Analyse verfügbar.</p>';
  }

  element('waiver-source-tag').textContent = briefing.source === 'gemini' ? 'Gemini 3.7 AI & MCP' : 'MCP Scoring-Modell';
  element('waiver-updated-tag').textContent = `Stand: ${new Date(waiverData.updatedAt).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen.');
  return data;
}

async function loadWaivers(forceRefresh = false) {
  const current = ++waiverRequestNumber;
  const refreshBtn = element('refresh-waivers-ai');
  if (refreshBtn) refreshBtn.disabled = true;

  element('waiver-headline').textContent = 'MCP-Analyse wird ausgeführt...';
  element('waiver-urgency').textContent = 'LADEN...';
  element('waiver-ai-text').innerHTML = '<p class="briefing-p">Analysiere aktuelle Matchup-Ergebnisse, Starter-Leistungen und Waiver Wire...</p>';

  try {
    const leagueKey = encodeURIComponent(element('league').value);
    const url = `/api/dashboard/league/${leagueKey}/waivers${forceRefresh ? '?refresh=true' : ''}`;
    const data = await fetchJson(url);
    if (current !== waiverRequestNumber) return;

    waiverData = data;
    renderWaiverBriefing();
    renderWaiverTargets();
    renderDropCandidates();
  } catch (error) {
    if (current !== waiverRequestNumber) return;
    element('waiver-headline').textContent = 'Fehler beim Laden der freien Spieler';
    element('waiver-urgency').textContent = 'FEHLER';
    element('waiver-urgency').className = 'urgency-badge urgency-hoch';
    element('waiver-ai-text').textContent = error.message;
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
    refreshLucide();
  }
}

async function loadLeague() {
  const current = ++requestNumber;
  element('refresh').disabled = true;
  element('overview').hidden = true;
  element('message').hidden = false;
  element('message').className = '';
  element('message').textContent = 'ESPN-Daten werden geladen...';

  try {
    const data = await fetchJson(`/api/dashboard/league/${encodeURIComponent(element('league').value)}`);
    if (current !== requestNumber) return;
    element('league-name').textContent = data.name;
    element('team-name').textContent = data.team.name;
    element('week').textContent = data.week ?? '-';
    element('record').textContent = `${data.team.wins} - ${data.team.losses}${data.team.ties ? ` - ${data.team.ties}` : ''}`;
    element('player-count').textContent = data.roster.length;
    element('updated').textContent = `Stand ${new Date(data.updatedAt).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}`;
    element('espn-status').textContent = 'ESPN verbunden';
    element('espn-status').className = 'connected';

    if (data.matchup) {
      const banner = element('matchup-banner');
      banner.hidden = false;
      element('matchup-week-badge').textContent = `Woche ${data.matchup.week}`;
      element('matchup-my-name').textContent = data.team.name;
      element('matchup-my-score').textContent = numberFormat.format(data.matchup.teamScore);
      element('matchup-my-proj').textContent = `Proj: ${numberFormat.format(data.matchup.teamProjected)}`;

      element('matchup-opp-name').textContent = data.matchup.opponentName;
      element('matchup-opp-score').textContent = numberFormat.format(data.matchup.opponentScore);
      element('matchup-opp-proj').textContent = `Proj: ${numberFormat.format(data.matchup.opponentProjected)}`;

      const prob = element('matchup-prob-badge');
      if (data.matchup.winProbability != null) {
        prob.hidden = false;
        prob.textContent = `${data.matchup.winProbability}% Sieg-Chance`;
      } else {
        prob.hidden = true;
      }
    } else {
      element('matchup-banner').hidden = true;
    }

    roster = data.roster;
    renderRoster();
    element('teams').replaceChildren(...data.teams.map((team, index) => {
      const row = document.createElement('tr');
      if (team.own) row.className = 'own';
      cell(row, index + 1);
      cell(row, team.name);
      cell(row, `${team.wins} / ${team.losses}`);
      cell(row, numberFormat.format(team.points));
      return row;
    }));
    element('message').hidden = true;
    element('overview').hidden = false;

    // Pre-load waivers in background
    loadWaivers(false);
  } catch (error) {
    if (current !== requestNumber) return;
    element('message').className = 'error';
    element('message').textContent = error.name === 'TimeoutError' ? 'Zeitlimit erreicht. Bitte erneut versuchen.' : error.message;
    element('espn-status').textContent = 'ESPN nicht erreichbar';
    element('espn-status').className = 'missing';
  } finally {
    if (current === requestNumber) element('refresh').disabled = false;
    refreshLucide();
  }
}

function selectTab(selected) {
  const tabs = ['roster', 'teams', 'waivers'];
  for (const name of tabs) {
    const active = name === selected;
    const tabBtn = element(`${name}-tab`);
    const panel = element(`${name}-panel`);
    if (tabBtn) {
      tabBtn.setAttribute('aria-selected', String(active));
      tabBtn.tabIndex = active ? 0 : -1;
    }
    if (panel) {
      panel.hidden = !active;
    }
  }
  if (selected === 'waivers' && !waiverData) {
    loadWaivers(false);
  }
  refreshLucide();
}

const tabNames = ['roster', 'teams', 'waivers'];
for (const name of tabNames) {
  const tabEl = element(`${name}-tab`);
  if (tabEl) {
    tabEl.addEventListener('click', () => selectTab(name));
    tabEl.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = tabNames.indexOf(name);
      let nextIndex = 0;
      if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabNames.length - 1;
      else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabNames.length;
      else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabNames.length) % tabNames.length;
      const next = tabNames[nextIndex];
      selectTab(next);
      element(`${next}-tab`)?.focus();
    });
  }
}

// Position filter chips
const chipsContainer = element('position-chips');
if (chipsContainer) {
  chipsContainer.addEventListener('click', event => {
    const btn = event.target.closest('button.chip');
    if (!btn) return;
    chipsContainer.querySelectorAll('button.chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPosFilter = btn.dataset.pos || 'ALL';
    renderWaiverTargets();
  });
}

// Search inputs
element('search')?.addEventListener('input', renderRoster);
element('waiver-search')?.addEventListener('input', renderWaiverTargets);

// Refresh buttons
element('refresh')?.addEventListener('click', loadLeague);
element('refresh-waivers-ai')?.addEventListener('click', () => loadWaivers(true));
element('league')?.addEventListener('change', () => {
  waiverData = null;
  loadLeague();
});

async function initialize() {
  try {
    const config = await fetchJson('/api/dashboard/config');
    element('server-status').textContent = 'Server online';
    element('server-status').className = 'connected';
    element('season').textContent = `SAISON ${config.season}`;
    element('espn-status').textContent = config.espnConfigured ? 'ESPN konfiguriert' : 'ESPN-Cookies fehlen';
    element('espn-status').className = config.espnConfigured ? 'connected' : 'missing';
    element('llm-status').textContent = config.llmConfigured ? `${config.provider} konfiguriert` : 'LLM-Key fehlt';
    element('llm-status').className = config.llmConfigured ? 'connected' : 'missing';
    element('league').replaceChildren(...config.leagues.map(league => {
      const option = document.createElement('option');
      option.value = league.key;
      option.textContent = league.name;
      return option;
    }));
    if (!config.leagues.length) {
      element('message').textContent = 'Keine Liga konfiguriert. LEAGUE_1_ID und LEAGUE_1_TEAM_ID in der Container-Umgebung ergänzen.';
      return;
    }
    element('league').disabled = false;
    await loadLeague();
  } catch (error) {
    element('server-status').textContent = 'Server nicht erreichbar';
    element('server-status').className = 'missing';
    element('message').textContent = 'Dashboard konnte nicht geladen werden. Seite erneut laden.';
    element('message').className = 'error';
  }
}

initialize();