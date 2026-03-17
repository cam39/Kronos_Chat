# Kronos Client - Application de Bureau

Application Electron multiplateforme pour se connecter au serveur Kronos Chat.

## Fonctionnalités

- **Connexion manuelle**: Entrez l'IP et le port du serveur
- **Découverte automatique**: Scanne le réseau pour trouver les serveurs Kronos via mDNS/Zeroconf
- **Interface moderne**: Design sombre avec dégradés et animations

## Installation

### Prérequis

- Node.js 18+
- npm ou yarn

### Installation des dépendances

```bash
cd kronos-client
npm install
```

## Utilisation

### Mode développement

```bash
npm start
```

### Construction des installateurs

```bash
# Windows (.exe)
npm run make -- --platform=win32

# Linux (.deb)
npm run make -- --platform=linux

# macOS (.app/.dmg)
npm run make -- --platform=darwin
```

Les fichiers générés seront dans le dossier `out/`.

## Structure du projet

```
kronos-client/
├── src/
│   ├── index.html    # Interface de connexion
│   ├── main.js       # Point d'entrée Electron
│   └── preload.js    # Bridge de sécurité
├── package.json      # Dépendances et scripts
├── forge.config.js   # Configuration Electron Forge
└── README.md         # Ce fichier
```

## Configuration Zeroconf

L'application utilise le protocole mDNS pour découvrir automatiquement les serveurs Kronos sur le réseau local. Le service broadcast est `_http._tcp.local.` avec le nom `Kronos`.

## Notes

- Pour Windows, le fichier `.exe` généré peut nécessiter des droits administrateur pour l'installation
- Pour Linux, le fichier `.deb` peut être installé avec `dpkg -i`
- Pour macOS, le fichier `.dmg` doit être monté et l'application copiée dans Applications
