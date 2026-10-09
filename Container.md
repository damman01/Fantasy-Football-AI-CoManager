# Container-Leitfaden

## 1. Weboberfläche & MCP Server (Standard)

Der Web-Container stellt das vollständige Dashboard bereit:
- **Liga- & Roster-Übersicht:** Aufstellung, Verletzungsstatus und Liga-Tabelle.
- **Freie Spieler & MCP-Waiver-Vorschläge:** Automatische Analyse passender Spieler für die aktuelle Spielwoche mit Prioritäts-Scoring, FAAB-Gebotsempfehlungen und Drop-Kandidaten aus dem eigenen Kader.
- **KI-Briefing:** Zusammenfassung der personellen Lage und taktische Ratschläge via Gemini / LLM.
- **MCP-Schnittstelle:** Standard-konformer MCP JSON-RPC 2.0 Endpunkt unter `/api/mcp` sowie Tool-Definitionen unter `/api/mcp/tools`.
- **Sicherheit:** Alle ESPN-Cookies und API-Keys verbleiben serverseitig im Container.

### Image bauen

```powershell
podman build --target runtime-web -t fantasy-comanager:web -f Containerfile .
```
*(Hinweis: `--target runtime-poc` wird aus Kompatibilitätsgründen weiterhin unterstützt).*

### Container starten

```powershell
podman run -d --name fantasy-comanager-web --restart unless-stopped --env-file .env.local -e PORT=3003 -p 127.0.0.1:3003:3003 fantasy-comanager:web
```

Im Browser erreichbar unter: **http://localhost:3003**

### Logs und Status

```powershell
# Live-Logs ansehen
podman logs -f fantasy-comanager-web

# Container stoppen und wieder starten
podman stop fantasy-comanager-web
podman start fantasy-comanager-web
```

### Container nach Änderungen an `.env.local` aktualisieren

Wurden Einstellungen in `.env.local` (z. B. Team-ID oder Keys) geändert, wird der Container neu erzeugt:

```powershell
podman stop fantasy-comanager-web
podman rm fantasy-comanager-web
podman run -d --name fantasy-comanager-web --restart unless-stopped --env-file .env.local -e PORT=3003 -p 127.0.0.1:3003:3003 fantasy-comanager:web
```

### Caching & Sicherheit
* **Lokale Nutzung:** Die API besitzt keine Benutzeranmeldung – nicht öffentlich ins Internet freigeben.
* **Caching:** Roster- und Ligadaten werden 60 Sekunden zwischengespeichert, Waiver-Analysen 180 Sekunden. Im Dashboard kann die Analyse jederzeit manuell per Button aktualisiert werden.

---

## 2. Automation CLI (Optional)

Für die Ausführung der zeitgesteuerten CLI-Befehle (Scheduled Day Jobs wie `thursday`, `sunday`, `tuesday` oder `init`):

### Image bauen

```powershell
podman build --target runtime-automation -t fantasy-comanager:automation -f Containerfile .
```

### CLI-Befehle ausführen

Der Automation-Container führt den jeweiligen Befehl aus und beendet sich anschliessend:

```powershell
# Verbindungsprüfung
podman run --rm --env-file .env.local fantasy-comanager:automation init

# Verfügbare Befehle anzeigen
podman run --rm --env-file .env.local fantasy-comanager:automation --help

# Beispiel: Dienstags-Waiver-Analyse via CLI ausführen
podman run --rm --env-file .env.local fantasy-comanager:automation tuesday
```